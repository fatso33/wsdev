/**
 * @module BindingsSection
 * Renders a component's simulator and local-state binding controls into a fresh
 * Data tab mount. StudioInspector owns UI tier, Bridge/Tester collaborators
 * and render lifecycle; StudioState owns binding writes and history. Local DOM
 * listeners live with the discarded mount. The only asynchronous callback
 * updates a resolved-unit node while connected.
 */
import { SecurityValidator } from '../../../core/SecurityValidator.js';
import { getDeckEventsByKind, getDeckEventsByCategory, DECK_EVENTS, DECK_EVENT_NAMES } from '../../../core/deckEvents.js';
import { extractCustomDeckEvents } from '../../../core/widgetVarExtractor.js';
import { getPackSuggestedEvents } from '../../../core/deckEventPacks.js';
import { getFieldsForType } from '../../../widgets/PropertyRegistry.js';
import { showToast } from '../../StudioModal.js';
import { CUSTOM_OPTION_VALUE, CATEGORY_LABELS, escapeHtmlAttr } from '../inspectorMarkup.js';

// Binding paths the panel still builds by hand, ahead of the registry-rendered rows. Every other
// binding row the type claims, a new one included, renders through the field engine.
const HAND_BUILT_BINDING_PATHS = new Set([
  'binding.readSimVar', 'binding.unit', 'binding.writeEvent', 'binding.incrementEvent', 'binding.decrementEvent',
]);

/**
 * Renders binding fields for the selected component in its existing Data mount.
 * Reads current component/definition values, saved widgets and pack suggestions.
 * The type's rows come from `host.getFieldsForType(type)` when the host has it (the drift check
 * supplies its own rows this way), else from Studio's registry. The binding rows outside the
 * hand-built set render through `host.renderRegistryFieldGroups` after the hand-built controls,
 * one heading per registry group, with the whole row list as the gates' default lookup.
 * Writes only through the host's StudioState or existing host delegates; Custom
 * selection merely reveals inputs until a value is chosen. The resolved-unit
 * Promise leaves a detached node untouched; Bridge resolution may reject as it
 * did in the original panel.
 * @param {object} host Live Inspector with state, tier, Bridge, Tester and the field engine.
 * @param {object} comp Selected component captured for binding updates.
 * @param {object} def Current widget definition and state-variable list.
 * @param {HTMLElement} body Fresh mount receiving markup and DOM listeners.
 * @returns {void} Mutates the mount and registers its listeners.
 * @throws {Error} When a registry-rendered row's control has no renderer, naming the control and path.
 */
export function renderComponentBindings(host, comp, def, body) {
      const rows = host.getFieldsForType ? host.getFieldsForType(comp.type) : getFieldsForType(comp.type);
      const binding = comp.binding || {};

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

      // Pulse gates use inline display because applyUiMode toggles .hidden on
      // data-tier fields after render. Inline display and the tier gate both
      // apply, while stored events survive switching back to Absolute.
      const isPulseRotary = comp.type === 'core.rotary' && comp.props?.writeMode === 'pulse';
      const incrementIsCustom = !!binding.incrementEvent && !getDeckEventsByKind('write').some((e) => e.name === binding.incrementEvent);
      const decrementIsCustom = !!binding.decrementEvent && !getDeckEventsByKind('write').some((e) => e.name === binding.decrementEvent);

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

        <div class="prop-field" data-tier="advanced">
          <label>SimConnect Unit ${isRawAddress ? `<span class="prop-hint" title="Tells SimConnect what type to return the raw value as (e.g. degrees, knots, Bool, Number). Leave blank to use the host's default ('Number'). For a TEXT variable (TITLE, ATC MODEL, ATC ID) type 'string' — those have no unit at all, and reading one as a number silently returns 0.">ⓘ</span>` : `<span class="prop-hint" title="Unit is set by PC Bridge for this Deck Event.">ⓘ</span>`}</label>
          <input type="text" id="c-bind-unit" class="prop-input" value="${escapeHtmlAttr(binding.unit || '')}" placeholder="${isRawAddress ? 'Number' : 'Unit is set by PC Bridge for this Deck Event'}" ${isRawAddress ? '' : 'disabled'} />
          <div class="prop-live-info hidden" id="c-bind-resolved-info"></div>
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
        ` : ''}

      `;

      const registryRows = rows.filter((row) => row.path.startsWith('binding.') && !HAND_BUILT_BINDING_PATHS.has(row.path));
      host.renderRegistryFieldGroups(comp, body, registryRows, rows);

      const updateBinding = (updates) => {
        host.state.updateComponent(comp.id, { binding: { ...(comp.binding || {}), ...updates } });
      };

      // Wires one default-select + custom-block pair (kind: 'read'/'write'/
      // 'increment'/'decrement'). readSimVar uses the SimVar character class, the
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
      if (comp.type === 'core.rotary') {
        wireBindingKind('increment', 'incrementEvent');
        wireBindingKind('decrement', 'decrementEvent');
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

      body.querySelector('#c-bind-unit')?.addEventListener('change', (e) => updateBinding({ unit: e.target.value.trim() || undefined }));

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

}
