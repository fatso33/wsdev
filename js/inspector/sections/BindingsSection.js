/**
 * @module BindingsSection
 * Renders a component's simulator and local-state binding controls into a fresh
 * Data tab mount. StudioInspector owns UI tier, the Advanced toggle state,
 * Bridge/Tester collaborators and render lifecycle; StudioState owns binding
 * writes and history. Local DOM listeners live with the discarded mount.
 * The only asynchronous callback updates a resolved-unit node while connected.
 */
import { SecurityValidator } from '../../../core/SecurityValidator.js';
import { getDeckEventsByKind, getDeckEventsByCategory, DECK_EVENTS, DECK_EVENT_NAMES } from '../../../core/deckEvents.js';
import { extractCustomDeckEvents } from '../../../core/widgetVarExtractor.js';
import { getPackSuggestedEvents } from '../../../core/deckEventPacks.js';
import { showToast } from '../../StudioModal.js';
import { CUSTOM_OPTION_VALUE, CATEGORY_LABELS, escapeHtmlAttr } from '../inspectorMarkup.js';

/**
 * Renders binding fields for the selected component in its existing Data mount.
 * Reads current component/definition values, saved widgets and pack suggestions.
 * Writes only through the host's StudioState or existing host delegates; Custom
 * selection merely reveals inputs until a value is chosen. The resolved-unit
 * Promise leaves a detached node untouched; Bridge resolution may reject as it
 * did in the original panel.
 * @param {object} host Live Inspector with state, tier, Bridge and Tester.
 * @param {object} comp Selected component captured for binding updates.
 * @param {object} def Current widget definition and state-variable list.
 * @param {HTMLElement} body Fresh mount receiving markup and DOM listeners.
 * @returns {void} Mutates the mount and registers its listeners.
 */
export function renderComponentBindings(host, comp, def, body) {
      const binding = comp.binding || {};
      const stateVars = def.state || [];

      // Saved widgets and Community Packs both contribute suggestions, so a
      // fresh install can offer custom events before the author has saved one.
      const savedWidgets = host.state.loadSavedWidgets().filter((w) => w.id !== def.id);
      const customDeckEvents = extractCustomDeckEvents(savedWidgets, DECK_EVENT_NAMES).map((e) => ({
        ...e,
        source: e.widgetIds.length ? `used by ${e.widgetIds.join(', ')}` : ''
      }));
      const packEvents = getPackSuggestedEvents()
        .filter((e) => !customDeckEvents.some((c) => c.name === e.name))
        .map((e) => ({ name: e.name, kind: e.kind, source: `from pack: ${e.fromPack}` }));
      const mergedCustom = [...customDeckEvents, ...packEvents];
      const customReads = mergedCustom.filter((e) => e.kind === 'read');
      const customWrites = mergedCustom.filter((e) => e.kind === 'write');

      const buildDefaultOptions = (kind, currentValue) => {
        const items = getDeckEventsByKind(kind);
        const isKnownDefault = items.some((e) => e.name === currentValue);
        return `
          <option value="" ${!currentValue && !isKnownDefault ? 'selected' : ''}>— none —</option>
          ${items.map((e) => `<option value="${e.name}" ${currentValue === e.name ? 'selected' : ''}>${e.label}</option>`).join('')}
          <option value="${CUSTOM_OPTION_VALUE}" ${currentValue && !isKnownDefault ? 'selected' : ''}>Custom…</option>
        `;
      };

      const buildCustomOptions = (entries, currentValue) => {
        const isKnownCustom = entries.some((e) => e.name === currentValue);
        const placeholder = entries.length > 0 ? '— select or type below —' : '(no custom Deck Events in use yet — try importing a Community Pack in the Library tab)';
        return `
          <option value="">${placeholder}</option>
          ${entries.map((e) => `<option value="${escapeHtmlAttr(e.name)}" ${isKnownCustom && currentValue === e.name ? 'selected' : ''}>${escapeHtmlAttr(e.name)}${e.source ? ` (${escapeHtmlAttr(e.source)})` : ''}</option>`).join('')}
        `;
      };

      // The guided category/value picker writes the same binding fields as the
      // flat dropdown. A custom/raw name has no category to preselect.
      const buildConnectSimPicker = (kind, idPrefix, currentValue) => {
        const currentCategory = DECK_EVENTS.find((e) => e.kind === kind && e.name === currentValue)?.category || '';
        const categories = [...new Set(DECK_EVENTS.filter((e) => e.kind === kind).map((e) => e.category))];
        const variableOptions = currentCategory
          ? getDeckEventsByCategory(currentCategory).filter((e) => e.kind === kind).map((e) => `<option value="${e.name}" ${currentValue === e.name ? 'selected' : ''}>${e.label}</option>`).join('')
          : '';
        return `
          <select id="${idPrefix}-category" class="prop-select">
            <option value="">— choose a category —</option>
            ${categories.map((c) => `<option value="${c}" ${currentCategory === c ? 'selected' : ''}>${CATEGORY_LABELS[c] || c}</option>`).join('')}
          </select>
          <select id="${idPrefix}-variable" class="prop-select" ${currentCategory ? '' : 'disabled'}>
            <option value="">${currentCategory ? '— choose a value —' : '— choose a category first —'}</option>
            ${variableOptions}
          </select>
        `;
      };

      const readIsCustom = !!binding.readSimVar && !getDeckEventsByKind('read').some((e) => e.name === binding.readSimVar);
      // FDWS v1.2 §1.5: only a raw A:/L:/H:/K: address's unit is ours to set —
      // a bare Deck Event's unit is resolved from the active PC Bridge
      // profile, and typing a value here would just be ignored at runtime.
      const isRawAddress = /^(A|L|H|K):/i.test(binding.readSimVar || '');
      const writeIsCustom = !!binding.writeEvent && !getDeckEventsByKind('write').some((e) => e.name === binding.writeEvent);

      const ackIsCustom = !!binding.ackEvent && !getDeckEventsByKind('write').some((e) => e.name === binding.ackEvent);
      const pushIsCustom = !!binding.pushEvent && !getDeckEventsByKind('write').some((e) => e.name === binding.pushEvent);
      const stateIsCustom = !!binding.stateVar && !stateVars.some((s) => s.name === binding.stateVar);
      const isFastPoll = Number(binding.pollFrequencyHz) > 2;

      // Pulse gates use inline display because applyUiMode toggles .hidden on
      // data-tier fields after render. Inline display and the tier gate both
      // apply, while stored events survive switching back to Absolute.
      const isPulseRotary = comp.type === 'core.rotary' && comp.props?.writeMode === 'pulse';
      const incrementIsCustom = !!binding.incrementEvent && !getDeckEventsByKind('write').some((e) => e.name === binding.incrementEvent);
      const decrementIsCustom = !!binding.decrementEvent && !getDeckEventsByKind('write').some((e) => e.name === binding.decrementEvent);

      // Acceleration's fast step events: only a Pulse Rotary with Acceleration enabled ever
      // sends them. Gated like Increment/Decrement above (inline display, so the tier pass
      // cannot undo it) and, like them, never cleared when hidden, so switching Acceleration
      // off and on again finds the events still set. Advanced tier only: they are for
      // aircraft that expose a dedicated fast step event, which is the uncommon case.
      const isFastEventRotary = isPulseRotary && comp.props?.acceleration === true;
      const fastEventFields = (kind, field, label, direction) => {
        const isCustom = !!binding[field] && !getDeckEventsByKind('write').some((e) => e.name === binding[field]);
        return `
        <div class="prop-field" data-tier="advanced" id="c-bind-${kind}-field" style="${isFastEventRotary ? '' : 'display:none;'}">
          <label>${label} <span class="prop-hint" title="FDWS v1.30: dispatched once per step turned ${direction} in the coarse Acceleration tier, in place of the ordinary event above, when Write Mode is Pulse and Acceleration is on. Bind both fast events or neither: a single one is ignored.">ⓘ</span></label>
          <select id="c-bind-${kind}" class="prop-select">${buildDefaultOptions('write', binding[field])}</select>
        </div>
        <div class="prop-field prop-custom-block ${(isFastEventRotary && isCustom) ? '' : 'hidden'}" id="c-bind-${kind}-custom-block">
          <label>Custom Deck Event (used by another saved widget)</label>
          <select id="c-bind-${kind}-custom-select" class="prop-select">${buildCustomOptions(customWrites, binding[field])}</select>
          <label>Or type a new custom event / raw SimConnect event (H:/K:...)</label>
          <div class="prop-paste-row">
            <input type="text" id="c-bind-${kind}-custom-input" class="prop-input" value="${escapeHtmlAttr(isCustom ? (binding[field] || '') : '')}" placeholder="e.g. myCustomEvent, H:GTN750_DirectToPush" />
          </div>
          <div class="prop-sanitize-diff hidden" id="c-bind-${kind}-custom-diff"></div>
        </div>`;
      };

      body.innerHTML = `
        <div class="prop-field" data-tier="simple-only">
          <label>Connect to Simulator — Value to Show <span class="prop-hint" title="Pick a category, then the specific value this component should read. Fills in the same field Advanced mode's Read Deck Event dropdown below uses — switch to Advanced any time to see the raw name or type a custom one.">ⓘ</span></label>
          <div class="connect-sim-picker">${buildConnectSimPicker('read', 'c-connect-read', binding.readSimVar)}</div>
        </div>
        <div class="prop-hint-block" style="font-size:11px;opacity:0.75;margin:-4px 0 8px;" data-tier="simple-only">
          Don't see it? <button type="button" class="btn-mini-inline" id="c-connect-read-findit">Find it by moving it →</button>
          or <button type="button" class="btn-mini-inline" id="c-connect-read-full">switch to Full mode</button> for Raw Address / Custom.
        </div>
        <div class="prop-field" data-tier="advanced">
          <label>Read Deck Event (Telemetry In)</label>
          <div class="prop-row-2">
            <select id="c-bind-read" class="prop-select">${buildDefaultOptions('read', binding.readSimVar)}</select>
            <button type="button" class="btn-small" id="c-bind-read-connect" style="flex:0 0 auto;">Connect…</button>
          </div>
        </div>
        <div class="prop-field prop-custom-block ${readIsCustom ? '' : 'hidden'}" id="c-bind-read-custom-block">
          <label>Custom Deck Event (used by another saved widget)</label>
          <select id="c-bind-read-custom-select" class="prop-select">${buildCustomOptions(customReads, binding.readSimVar)}</select>
          <label>Or type a new custom variable / raw SimVar (L:/A:...)</label>
          <div class="prop-paste-row">
            <input type="text" id="c-bind-read-custom-input" class="prop-input" value="${escapeHtmlAttr(readIsCustom ? (binding.readSimVar || '') : '')}" placeholder="e.g. myCustomVar, L:FBW_TAXI_LIGHT_INTENSITY" />
            <button type="button" class="btn-small" id="c-bind-read-paste">Paste</button>
          </div>
          <div class="prop-sanitize-diff hidden" id="c-bind-read-custom-diff"></div>
        </div>

        <div class="prop-row-2">
          <div class="prop-field">
            <label>Poll Rate <span class="prop-hint" title="FDWS v1.7: how often PC Bridge asks SimConnect for this value. Normal (1Hz) is right for almost everything — frequencies, switches, annunciators. Fast is for values that change continuously and need to look smooth, like an attitude indicator's pitch/bank — it routes this SimVar onto PC Bridge's fastest available SimConnect polling tier (in practice tens of Hz, tied to the sim's own update rate, not a literal guaranteed number). Every fast-tier binding reading the same SimVar should use the same setting.">ⓘ</span></label>
            <select id="c-bind-pollrate" class="prop-select">
              <option value="1" ${!isFastPoll ? 'selected' : ''}>Normal (1Hz)</option>
              <option value="100" ${isFastPoll ? 'selected' : ''}>Fast (~100Hz)</option>
            </select>
          </div>
          <div class="prop-field" data-tier="advanced">
            <label>Dead Band <span class="prop-hint" title="Minimum change in value before this binding re-renders — filters out imperceptible jitter. 0 means every update renders.">ⓘ</span></label>
            <input type="number" step="any" min="0" id="c-bind-deadband" class="prop-input" value="${escapeHtmlAttr(binding.deadband ?? 0)}" />
          </div>
        </div>

        <div class="prop-row-2" data-tier="advanced">
          <div class="prop-field">
            <label>Transition (ms) <span class="prop-hint" title="How long this binding's CSS transition eases toward a new value. Keep this short (well under the gap between updates) — a long transition against Fast-tier updates makes the display feel MORE sluggish, not less, since it ends up averaging across many stale intermediate values.">ⓘ</span></label>
            <input type="number" step="1" min="0" id="c-bind-transition-ms" class="prop-input" value="${escapeHtmlAttr(binding.transition?.durationMs ?? '')}" placeholder="none" />
          </div>
          <div class="prop-field">
            <label>Easing</label>
            <select id="c-bind-transition-easing" class="prop-select">
              <option value="linear" ${(!binding.transition?.easing || binding.transition?.easing === 'linear') ? 'selected' : ''}>Linear</option>
              <option value="ease-out" ${binding.transition?.easing === 'ease-out' ? 'selected' : ''}>Ease Out</option>
              <option value="ease-in-out" ${binding.transition?.easing === 'ease-in-out' ? 'selected' : ''}>Ease In-Out</option>
            </select>
          </div>
        </div>

        <div class="prop-field" data-tier="advanced">
          <label>SimConnect Unit ${isRawAddress ? `<span class="prop-hint" title="Tells SimConnect what type to return the raw value as (e.g. degrees, knots, Bool, Number). Leave blank to use the host's default ('Number'). For a TEXT variable (TITLE, ATC MODEL, ATC ID) type 'string' — those have no unit at all, and reading one as a number silently returns 0.">ⓘ</span>` : `<span class="prop-hint" title="Unit is set by PC Bridge for this Deck Event.">ⓘ</span>`}</label>
          <input type="text" id="c-bind-unit" class="prop-input" value="${escapeHtmlAttr(binding.unit || '')}" placeholder="${isRawAddress ? 'Number' : 'Unit is set by PC Bridge for this Deck Event'}" ${isRawAddress ? '' : 'disabled'} />
          <div class="prop-live-info hidden" id="c-bind-resolved-info"></div>
        </div>



        <div class="prop-field" data-tier="advanced">
          <label>Poll Group <span class="prop-hint" title="FDWS v1.26: which PC Bridge polling chunk this SimVar's data definition joins. Leave blank to default to this widget's own id — already groups all of this widget's own bindings together, away from unrelated widgets' vars. Only set this to deliberately merge chunks across widgets, or split an unusually noisy var out of an otherwise-quiet widget.">ⓘ</span></label>
          <input type="text" id="c-bind-pollgroup" class="prop-input" value="${escapeHtmlAttr(binding.pollGroup || '')}" placeholder="(defaults to this widget's id)" />
        </div>

        <div class="prop-field" data-tier="simple-only">
          <label>Connect to Simulator — Value to Send <span class="prop-hint" title="Pick a category, then the specific command this component should send. Fills in the same field Advanced mode's Write Deck Event dropdown below uses — switch to Advanced any time to see the raw name or type a custom one.">ⓘ</span></label>
          <div class="connect-sim-picker">${buildConnectSimPicker('write', 'c-connect-write', binding.writeEvent)}</div>
        </div>
        <div class="prop-hint-block" style="font-size:11px;opacity:0.75;margin:-4px 0 8px;" data-tier="simple-only">
          Don't see it? <button type="button" class="btn-mini-inline" id="c-connect-write-findit">Find it by moving it →</button>
          or <button type="button" class="btn-mini-inline" id="c-connect-write-full">switch to Full mode</button> for Raw Address / Custom.
        </div>
        ${isPulseRotary ? `
        <div class="prop-hint-block" id="c-bind-write-pulse-note" style="font-size:11px;opacity:0.75;margin:0 0 8px;">
          Write Deck Event is not used in Pulse mode: this Rotary sends the Increment and Decrement events below instead. ${binding.writeEvent ? 'The value here is kept, so switching back to Absolute finds it, but it is not declared to PC Bridge.' : ''}
        </div>` : ''}
        <div class="prop-field" data-tier="advanced">
          <label>Write Deck Event (SimConnect Out)</label>
          <div class="prop-row-2">
            <select id="c-bind-write" class="prop-select">${buildDefaultOptions('write', binding.writeEvent)}</select>
            <button type="button" class="btn-small" id="c-bind-write-connect" style="flex:0 0 auto;">Connect…</button>
          </div>
        </div>
        <div class="prop-field prop-custom-block ${writeIsCustom ? '' : 'hidden'}" id="c-bind-write-custom-block">
          <label>Custom Deck Event (used by another saved widget)</label>
          <select id="c-bind-write-custom-select" class="prop-select">${buildCustomOptions(customWrites, binding.writeEvent)}</select>
          <label>Or type a new custom event / raw SimConnect event (H:/K:...)</label>
          <div class="prop-paste-row">
            <input type="text" id="c-bind-write-custom-input" class="prop-input" value="${escapeHtmlAttr(writeIsCustom ? (binding.writeEvent || '') : '')}" placeholder="e.g. myCustomEvent, H:GTN750_DirectToPush" />
            <button type="button" class="btn-small" id="c-bind-write-paste">Paste</button>
          </div>
          <div class="prop-sanitize-diff hidden" id="c-bind-write-custom-diff"></div>
        </div>

        ${comp.type === 'core.rotary' ? `
        <div class="prop-field" data-tier="simple-only" id="c-bind-increment-simple-field" style="${isPulseRotary ? '' : 'display:none;'}">
          <label>Connect to Simulator — Increment Event (Pulse Clockwise) <span class="prop-hint" title="Pick a category, then the specific command dispatched once per step turned clockwise. Fills in the same field Advanced mode's Increment Deck Event dropdown below uses — switch to Advanced any time to see the raw name or type a custom one.">ⓘ</span></label>
          <div class="connect-sim-picker">${buildConnectSimPicker('write', 'c-connect-increment', binding.incrementEvent)}</div>
        </div>
        <div class="prop-hint-block" data-tier="simple-only" id="c-bind-increment-simple-hint" style="font-size:11px;opacity:0.75;margin:-4px 0 8px;${isPulseRotary ? '' : 'display:none;'}">
          Don't see it? <button type="button" class="btn-mini-inline" id="c-connect-increment-findit">Find it by moving it →</button>
          or <button type="button" class="btn-mini-inline" id="c-connect-increment-full">switch to Full mode</button> for Raw Address / Custom.
        </div>
        <div class="prop-field" data-tier="advanced" id="c-bind-increment-field" style="${isPulseRotary ? '' : 'display:none;'}">
          <label>Increment Deck Event (Pulse Clockwise) <span class="prop-hint" title="FDWS v1.30: dispatched once per step turned clockwise, when Write Mode (Range panel) is set to Pulse. Only used in Pulse mode — Absolute mode uses Write Deck Event above instead.">ⓘ</span></label>
          <div class="prop-row-2">
            <select id="c-bind-increment" class="prop-select">${buildDefaultOptions('write', binding.incrementEvent)}</select>
            <button type="button" class="btn-small" id="c-bind-increment-connect" style="flex:0 0 auto;">Connect…</button>
          </div>
        </div>
        <div class="prop-field prop-custom-block ${(isPulseRotary && incrementIsCustom) ? '' : 'hidden'}" id="c-bind-increment-custom-block">
          <label>Custom Deck Event (used by another saved widget)</label>
          <select id="c-bind-increment-custom-select" class="prop-select">${buildCustomOptions(customWrites, binding.incrementEvent)}</select>
          <label>Or type a new custom event / raw SimConnect event (H:/K:...)</label>
          <div class="prop-paste-row">
            <input type="text" id="c-bind-increment-custom-input" class="prop-input" value="${escapeHtmlAttr(incrementIsCustom ? (binding.incrementEvent || '') : '')}" placeholder="e.g. myCustomEvent, H:GTN750_DirectToPush" />
          </div>
          <div class="prop-sanitize-diff hidden" id="c-bind-increment-custom-diff"></div>
        </div>

        <div class="prop-field" data-tier="simple-only" id="c-bind-decrement-simple-field" style="${isPulseRotary ? '' : 'display:none;'}">
          <label>Connect to Simulator — Decrement Event (Pulse Counter-Clockwise) <span class="prop-hint" title="Pick a category, then the specific command dispatched once per step turned counter-clockwise. Fills in the same field Advanced mode's Decrement Deck Event dropdown below uses — switch to Advanced any time to see the raw name or type a custom one.">ⓘ</span></label>
          <div class="connect-sim-picker">${buildConnectSimPicker('write', 'c-connect-decrement', binding.decrementEvent)}</div>
        </div>
        <div class="prop-hint-block" data-tier="simple-only" id="c-bind-decrement-simple-hint" style="font-size:11px;opacity:0.75;margin:-4px 0 8px;${isPulseRotary ? '' : 'display:none;'}">
          Don't see it? <button type="button" class="btn-mini-inline" id="c-connect-decrement-findit">Find it by moving it →</button>
          or <button type="button" class="btn-mini-inline" id="c-connect-decrement-full">switch to Full mode</button> for Raw Address / Custom.
        </div>
        <div class="prop-field" data-tier="advanced" id="c-bind-decrement-field" style="${isPulseRotary ? '' : 'display:none;'}">
          <label>Decrement Deck Event (Pulse Counter-Clockwise) <span class="prop-hint" title="FDWS v1.30: dispatched once per step turned counter-clockwise, when Write Mode (Range panel) is set to Pulse. Only used in Pulse mode — Absolute mode uses Write Deck Event above instead.">ⓘ</span></label>
          <div class="prop-row-2">
            <select id="c-bind-decrement" class="prop-select">${buildDefaultOptions('write', binding.decrementEvent)}</select>
            <button type="button" class="btn-small" id="c-bind-decrement-connect" style="flex:0 0 auto;">Connect…</button>
          </div>
        </div>
        <div class="prop-field prop-custom-block ${(isPulseRotary && decrementIsCustom) ? '' : 'hidden'}" id="c-bind-decrement-custom-block">
          <label>Custom Deck Event (used by another saved widget)</label>
          <select id="c-bind-decrement-custom-select" class="prop-select">${buildCustomOptions(customWrites, binding.decrementEvent)}</select>
          <label>Or type a new custom event / raw SimConnect event (H:/K:...)</label>
          <div class="prop-paste-row">
            <input type="text" id="c-bind-decrement-custom-input" class="prop-input" value="${escapeHtmlAttr(decrementIsCustom ? (binding.decrementEvent || '') : '')}" placeholder="e.g. myCustomEvent, H:GTN750_DirectToPush" />
          </div>
          <div class="prop-sanitize-diff hidden" id="c-bind-decrement-custom-diff"></div>
        </div>
        ${fastEventFields('fastincrement', 'fastIncrementEvent', 'Fast Increment Deck Event (Coarse Clockwise)', 'clockwise')}
        ${fastEventFields('fastdecrement', 'fastDecrementEvent', 'Fast Decrement Deck Event (Coarse Counter-Clockwise)', 'counter-clockwise')}
        ` : ''}

        <div class="prop-field" data-tier="build">
          <label>Bound Local State Var</label>
          <select id="c-bind-state" class="prop-select">
            <option value="" ${!binding.stateVar ? 'selected' : ''}>None</option>
            ${stateVars.map((s) => `<option value="${escapeHtmlAttr(s.name)}" ${!stateIsCustom && binding.stateVar === s.name ? 'selected' : ''}>${escapeHtmlAttr(s.name)} (${escapeHtmlAttr(s.type)})</option>`).join('')}
            <option value="${CUSTOM_OPTION_VALUE}" ${stateIsCustom ? 'selected' : ''}>Custom…</option>
          </select>
        </div>
        <div class="prop-field prop-custom-block ${stateIsCustom ? '' : 'hidden'}" id="c-bind-state-custom-block">
          <label>Custom / $context reference <span class="prop-hint" title="FDWS v1.3: for a popover widget, bind to data the host passed in via $context.&lt;key&gt;.value — the key must match one declared in the host's Open Widget Popover Context Map. Also used for any other raw stateVar string not in this widget's own state[] list.">ⓘ</span></label>
          <input type="text" id="c-bind-state-custom-input" class="prop-input" value="${escapeHtmlAttr(stateIsCustom ? (binding.stateVar || '') : '')}" placeholder="e.g. $context.currentFreq.value" />
        </div>

        <div class="prop-field" data-tier="advanced">
          <label>Bind to Local State Path <span class="prop-hint" title="FDWS v1.11: unlike 'Bound Local State Var' above (a whole top-level state[] var), this addresses a specific nested/indexed value inside one — e.g. presets[0].label to show one preset slot's label on a separate core.label above its button. Uses the same 'name[index].field' path grammar as popover Context Map entries. Leave blank unless you need this — it's an alternative to the field above, not used together with it. FDWS v1.14: on core.button, this drives the button's own Primary Label reactively (falling back to the static Primary Label text in Props whenever the resolved value is empty) instead of being display-only on core.label/core.display.">ⓘ</span></label>
          <input type="text" id="c-bind-stateref" class="prop-input" value="${escapeHtmlAttr(binding.stateRef || '')}" placeholder="e.g. presets[0].label" />
        </div>
        ${comp.type === 'core.button' ? `
          <div class="prop-field" data-tier="advanced">
            <label>Bind Sublabel to State Path <span class="prop-hint" title="FDWS v1.14: same 'name[index].field' grammar as the field above, but drives this button's Sublabel (Props panel) instead of its Primary Label — independent path, can point at a different state var entirely. Resolved value falls back to the static Sublabel text whenever empty.">ⓘ</span></label>
            <input type="text" id="c-bind-sublabelstateref" class="prop-input" value="${escapeHtmlAttr(binding.sublabelStateRef || '')}" placeholder="e.g. presets[0].freq" />
          </div>
        ` : ''}
        ${comp.type === 'core.indicator' ? `
          <div class="prop-field" data-tier="advanced">
            <label>Test State Var <span class="prop-hint" title="FDWS v1.15: local state[] variable that, when true, forces this indicator lit regardless of its own bound value — for a 'press to test' lamp-test button. Wire the SAME state var into every indicator that should light up together, then have a button toggle that one var.">ⓘ</span></label>
            <select id="c-bind-teststatevar" class="prop-select">
              <option value="" ${!binding.testStateVar ? 'selected' : ''}>None</option>
              ${stateVars.map((s) => `<option value="${escapeHtmlAttr(s.name)}" ${binding.testStateVar === s.name ? 'selected' : ''}>${escapeHtmlAttr(s.name)} (${escapeHtmlAttr(s.type)})</option>`).join('')}
            </select>
          </div>
        ` : ''}

        <button type="button" id="c-bind-advanced-toggle" class="panel-full-btn" style="margin-top:4px;">
          ${host._bindingAdvancedOpen ? '▾' : '▸'} Advanced (Acknowledge / Push Events, Event Category)
        </button>
        <div id="c-bind-advanced-fields" class="${host._bindingAdvancedOpen ? '' : 'hidden'}">
          <div class="prop-field">
            <label>Acknowledge Event <span class="prop-hint" title="Fired when this component's built-in acknowledge/silence action is used (e.g. core.indicator annunciator ack). Rarely needed outside annunciator-style components.">ⓘ</span></label>
            <select id="c-bind-ack" class="prop-select">${buildDefaultOptions('write', binding.ackEvent)}</select>
          </div>
          <div class="prop-field prop-custom-block ${ackIsCustom ? '' : 'hidden'}" id="c-bind-ack-custom-block">
            <select id="c-bind-ack-custom-select" class="prop-select">${buildCustomOptions(customWrites, binding.ackEvent)}</select>
            <input type="text" id="c-bind-ack-custom-input" class="prop-input" value="${escapeHtmlAttr(ackIsCustom ? (binding.ackEvent || '') : '')}" placeholder="Custom acknowledge event" />
            <div class="prop-sanitize-diff hidden" id="c-bind-ack-custom-diff"></div>
          </div>
          <div class="prop-field">
            <label>Push Event <span class="prop-hint" title="Optional second write event for a component that has a separate press action alongside its main write — dispatched on press-and-hold, for spring-loaded/momentary controls. No core component dispatches it today (core.rotary's centre push was removed in FDWS v1.30), so leave it as None unless the component you are configuring documents one.">ⓘ</span></label>
            <select id="c-bind-push" class="prop-select">${buildDefaultOptions('write', binding.pushEvent)}</select>
          </div>
          <div class="prop-field prop-custom-block ${pushIsCustom ? '' : 'hidden'}" id="c-bind-push-custom-block">
            <select id="c-bind-push-custom-select" class="prop-select">${buildCustomOptions(customWrites, binding.pushEvent)}</select>
            <input type="text" id="c-bind-push-custom-input" class="prop-input" value="${escapeHtmlAttr(pushIsCustom ? (binding.pushEvent || '') : '')}" placeholder="Custom push event" />
            <div class="prop-sanitize-diff hidden" id="c-bind-push-custom-diff"></div>
          </div>
          <div class="prop-field">
            <label>Event Category <span class="prop-hint" title="SimConnect event category for Write/Ack/Push events. K_EVENT covers almost everything — only change this if a specific SimConnect event documents a different category.">ⓘ</span></label>
            <input type="text" id="c-bind-eventcategory" class="prop-input" value="${escapeHtmlAttr(binding.eventCategory || 'K_EVENT')}" />
          </div>
        </div>
      `;

      const updateBinding = (updates) => {
        host.state.updateComponent(comp.id, { binding: { ...(comp.binding || {}), ...updates } });
      };

      // Wires one default-select + custom-block pair (kind: 'read'/'write'/
      // 'ack'/'push'). readSimVar uses the SimVar character class, the
      // other three are all SimConnect event names.
      const wireBindingKind = (kind, bindingField) => {
        const defaultSelect = body.querySelector(`#c-bind-${kind}`);
        const customBlock = body.querySelector(`#c-bind-${kind}-custom-block`);
        const customSelect = body.querySelector(`#c-bind-${kind}-custom-select`);
        const customInput = body.querySelector(`#c-bind-${kind}-custom-input`);
        const diffEl = body.querySelector(`#c-bind-${kind}-custom-diff`);
        const sanitizeKind = bindingField === 'readSimVar' ? 'simvar' : 'event';

        // Show stripped characters before commit without changing the draft.
        const updateDiffHint = () => {
          if (!diffEl || !customInput) return;
          const { removed } = SecurityValidator.sanitizeWithReport(sanitizeKind, customInput.value);
          if (removed.length > 0) {
            diffEl.textContent = `Removed ${removed.map((c) => `"${c}"`).join(' ')} — did you mean to paste forum syntax like "(A:TRANSPONDER IDENT:1, Bool)"? Only the cleaned text will be saved.`;
            diffEl.classList.remove('hidden');
          } else {
            diffEl.textContent = '';
            diffEl.classList.add('hidden');
          }
        };
        customInput?.addEventListener('input', updateDiffHint);

        defaultSelect?.addEventListener('change', () => {
          if (defaultSelect.value === CUSTOM_OPTION_VALUE) {
            // Just reveal the custom block — don't write back yet. Committing
            // here with the still-empty customInput value would trigger a
            // synchronous COMPONENT_UPDATED re-render (StudioState.notify()
            // has no debounce) that rebuilds this panel from that still-empty
            // value, snapping the select back to its default option and
            // hiding the block before the user can type or pick anything.
            customBlock?.classList.remove('hidden');
          } else {
            customBlock?.classList.add('hidden');
            if (customSelect) customSelect.value = '';
            if (customInput) customInput.value = '';
            updateDiffHint();
            updateBinding({ [bindingField]: defaultSelect.value || undefined });
          }
        });

        customSelect?.addEventListener('change', () => {
          if (customSelect.value && customInput) customInput.value = customSelect.value;
          updateDiffHint();
          const { cleaned } = SecurityValidator.sanitizeWithReport(sanitizeKind, customInput?.value || '');
          updateBinding({ [bindingField]: cleaned || undefined });
        });

        customInput?.addEventListener('change', () => {
          const { cleaned } = SecurityValidator.sanitizeWithReport(sanitizeKind, customInput.value);
          updateBinding({ [bindingField]: cleaned || undefined });
        });
      };

      wireBindingKind('read', 'readSimVar');
      wireBindingKind('write', 'writeEvent');
      wireBindingKind('ack', 'ackEvent');
      wireBindingKind('push', 'pushEvent');
      if (comp.type === 'core.rotary') {
        wireBindingKind('increment', 'incrementEvent');
        wireBindingKind('decrement', 'decrementEvent');
        wireBindingKind('fastincrement', 'fastIncrementEvent');
        wireBindingKind('fastdecrement', 'fastDecrementEvent');
      }

      // Connect and direct binding fields write through the same state path.
      body.querySelector('#c-bind-read-connect')?.addEventListener('click', () => host.openConnectDialog(comp, def, 'read'));
      body.querySelector('#c-bind-write-connect')?.addEventListener('click', () => host.openConnectDialog(comp, def, 'write'));
      // Increment/decrement are write-kind events with distinct binding keys.
      body.querySelector('#c-bind-increment-connect')?.addEventListener('click', () => host.openConnectDialog(comp, def, 'write', 'incrementEvent'));
      body.querySelector('#c-bind-decrement-connect')?.addEventListener('click', () => host.openConnectDialog(comp, def, 'write', 'decrementEvent'));

      // Wires one Connect-to-Simulator category+variable pair (kind: 'read'
      // or 'write') straight onto the same bindingField the Advanced dropdown
      // above uses — see buildConnectSimPicker().
      const wireConnectSimPicker = (kind, idPrefix, bindingField) => {
        const categorySelect = body.querySelector(`#${idPrefix}-category`);
        const variableSelect = body.querySelector(`#${idPrefix}-variable`);
        categorySelect?.addEventListener('change', () => {
          const category = categorySelect.value;
          if (!variableSelect) return;
          if (!category) {
            variableSelect.innerHTML = '<option value="">— choose a category first —</option>';
            variableSelect.disabled = true;
            return;
          }
          const entries = getDeckEventsByCategory(category).filter((e) => e.kind === kind);
          variableSelect.innerHTML = `<option value="">— choose a value —</option>${entries.map((e) => `<option value="${e.name}">${e.label}</option>`).join('')}`;
          variableSelect.disabled = false;
          // Picking a new category with no value chosen yet doesn't write
          // anything — only committing a variable below does.
        });
        variableSelect?.addEventListener('change', () => {
          if (variableSelect.value) updateBinding({ [bindingField]: variableSelect.value });
        });
      };
      wireConnectSimPicker('read', 'c-connect-read', 'readSimVar');
      wireConnectSimPicker('write', 'c-connect-write', 'writeEvent');
      // Guided Pulse pickers target their own keys and filter write events.
      if (comp.type === 'core.rotary') {
        wireConnectSimPicker('write', 'c-connect-increment', 'incrementEvent');
        wireConnectSimPicker('write', 'c-connect-decrement', 'decrementEvent');
      }

      // Each guided picker offers Full mode and the Tester for values outside
      // its four catalog categories.
      const simplePickerKinds = comp.type === 'core.rotary' ? ['read', 'write', 'increment', 'decrement'] : ['read', 'write'];
      for (const kind of simplePickerKinds) {
        body.querySelector(`#c-connect-${kind}-findit`)?.addEventListener('click', () => host.simVarTester?.open());
        body.querySelector(`#c-connect-${kind}-full`)?.addEventListener('click', () => {
          host.uiTier = 'full';
          localStorage.setItem('fdws_studio_uiMode', 'full');
          host.render();
        });
      }

      const stateSelect = body.querySelector('#c-bind-state');
      const stateCustomBlock = body.querySelector('#c-bind-state-custom-block');
      const stateCustomInput = body.querySelector('#c-bind-state-custom-input');
      stateSelect?.addEventListener('change', () => {
        if (stateSelect.value === CUSTOM_OPTION_VALUE) {
          // Just reveal the text field — don't write back yet. binding.stateVar
          // is still whatever it was (likely empty), so writing here would
          // immediately re-trigger a synchronous COMPONENT_UPDATED re-render
          // that rebuilds this panel from that still-empty value, snapping the
          // select back to "None" and hiding the field before the user can type.
          stateCustomBlock?.classList.remove('hidden');
        } else {
          stateCustomBlock?.classList.add('hidden');
          if (stateCustomInput) stateCustomInput.value = '';
          updateBinding({ stateVar: stateSelect.value || undefined });
        }
      });
      stateCustomInput?.addEventListener('change', () => {
        updateBinding({ stateVar: stateCustomInput.value.trim() || undefined });
      });
      body.querySelector('#c-bind-stateref')?.addEventListener('change', (e) => updateBinding({ stateRef: e.target.value.trim() || undefined }));
      body.querySelector('#c-bind-sublabelstateref')?.addEventListener('change', (e) => updateBinding({ sublabelStateRef: e.target.value.trim() || undefined }));
      body.querySelector('#c-bind-teststatevar')?.addEventListener('change', (e) => updateBinding({ testStateVar: e.target.value || undefined }));
      body.querySelector('#c-bind-pollrate')?.addEventListener('change', (e) => updateBinding({ pollFrequencyHz: Number(e.target.value) }));
      body.querySelector('#c-bind-pollgroup')?.addEventListener('change', (e) => updateBinding({ pollGroup: e.target.value.trim() || undefined }));
      body.querySelector('#c-bind-deadband')?.addEventListener('change', (e) => updateBinding({ deadband: Number(e.target.value) || 0 }));
      body.querySelector('#c-bind-unit')?.addEventListener('change', (e) => updateBinding({ unit: e.target.value.trim() || undefined }));
      body.querySelector('#c-bind-eventcategory')?.addEventListener('change', (e) => updateBinding({ eventCategory: e.target.value.trim() || undefined }));

      // A binding accepts parsed read or write values of the matching kind.
      // Complex expressions remain test-only.
      {
        const applyPaste = (kind) => {
          const parsed = host.state.testerParsed;
          const inputId = kind === 'read' ? 'c-bind-read-custom-input' : 'c-bind-write-custom-input';
          const selectId = kind === 'read' ? 'c-bind-read' : 'c-bind-write';
          const blockId = kind === 'read' ? 'c-bind-read-custom-block' : 'c-bind-write-custom-block';
          if (!parsed) { showToast('Nothing parsed yet — use the SimVar Tester in the bottom bar first.'); return; }
          if (parsed.kind === 'complex') { showToast('That one is test-only — conditionals and multi-token RPN can’t be stored in a binding.'); return; }
          const parsedIsRead = parsed.kind === 'read';
          if (kind === 'read' && !parsedIsRead) { showToast('That’s a write event — paste it into the Write Deck Event field instead.'); return; }
          if (kind === 'write' && parsedIsRead) { showToast('That’s a read expression — paste it into the Read Deck Event field instead.'); return; }

          body.querySelector(`#${selectId}`).value = CUSTOM_OPTION_VALUE;
          body.querySelector(`#${blockId}`)?.classList.remove('hidden');
          const input = body.querySelector(`#${inputId}`);

          if (kind === 'read') {
            input.value = parsed.name;
            const updates = { readSimVar: parsed.name };
            // The parsed name determines unit ownership; the unit input still
            // reflects the previous binding until the state update completes.
            if (parsed.unit && /^(A|L|H|K):/i.test(parsed.name)) updates.unit = parsed.unit;
            showToast(`Pasted ${parsed.name}${updates.unit ? ` (unit ${updates.unit})` : ''}.`);
            updateBinding(updates);
            return;
          }

          const event = parsed.kind === 'write' ? parsed.event.replace(/^K:/i, '') : parsed.event;
          input.value = event;
          // Bindings cannot store a write value, so report it to the author.
          showToast(parsed.value !== null && parsed.value !== undefined
            ? `Pasted ${event}. It also sends the value ${parsed.value} — a binding has no value field, so set that on this component’s interaction action.`
            : `Pasted ${event}.`);
          updateBinding({ writeEvent: event });
        };
        body.querySelector('#c-bind-read-paste')?.addEventListener('click', () => applyPaste('read'));
        body.querySelector('#c-bind-write-paste')?.addEventListener('click', () => applyPaste('write'));
      }

      // A bare Deck Event gets its unit from the active Bridge profile.
      {
        const resolvedInfoEl = body.querySelector('#c-bind-resolved-info');
        if (resolvedInfoEl && !isRawAddress && binding.readSimVar && host.simBridge?.connected) {
          resolvedInfoEl.textContent = 'Resolving…';
          resolvedInfoEl.classList.remove('hidden');
          host.simBridge.resolveDeckEvent(binding.readSimVar).then((resolved) => {
            // Panel may have re-rendered (different component selected, or a
            // binding edit) by the time this resolves -- only touch the DOM
            // if this exact element is still live.
            if (!resolvedInfoEl.isConnected) return;
            resolvedInfoEl.textContent = resolved
              ? `Unit: ${resolved.unit} — from profile "${resolved.profileName}"`
              : `"${binding.readSimVar}" has no mapping in the active profile.`;
          });
        }
      }

      const updateTransition = () => {
        const msRaw = body.querySelector('#c-bind-transition-ms')?.value;
        const easing = body.querySelector('#c-bind-transition-easing')?.value || 'linear';
        if (msRaw === '' || msRaw === undefined) {
          updateBinding({ transition: undefined });
        } else {
          updateBinding({ transition: { durationMs: Number(msRaw) || 0, easing } });
        }
      };
      body.querySelector('#c-bind-transition-ms')?.addEventListener('change', updateTransition);
      body.querySelector('#c-bind-transition-easing')?.addEventListener('change', updateTransition);

      body.querySelector('#c-bind-advanced-toggle')?.addEventListener('click', () => {
        host._bindingAdvancedOpen = !host._bindingAdvancedOpen;
        body.querySelector('#c-bind-advanced-fields')?.classList.toggle('hidden');
        const toggleBtn = body.querySelector('#c-bind-advanced-toggle');
        if (toggleBtn) toggleBtn.textContent = `${host._bindingAdvancedOpen ? '▾' : '▸'} Advanced (Acknowledge / Push Events, Event Category)`;
      });

}
