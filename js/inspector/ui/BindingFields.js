/**
 * @module BindingFields
 * The Bindings panel's binding renderers: how a `binding.*` registry row is drawn and written, which
 * may differ from the renderer other Inspector sections use for the same control name. Each renderer
 * shows the row's `label` (else the humanized path), its `tooltip` on an ⓘ span and its
 * `placeholder`, escapes every authored string, and writes through `host.commitField`. An unset value
 * shows the row's `default` without writing it. DOM ids come
 * from a Studio-side table keyed by path, so existing ids stay stable while the registry stays free
 * of editor ids; a row missing from the table falls back to `host.fieldDomId(path)`.
 * Renderers hold no state; their listeners live with the mount the engine discards on re-render.
 * The Deck Event pickers (`eventPicker` for a write event, `simVarPicker` for a read) also read the
 * widget's saved-widget and Community Pack events, through `host.state`, for their Custom block's
 * suggestions, and the Read picker adds the resolved-unit line. A `guided` row adds the Guided
 * category picker, and a few rows carry extras keyed by path (Paste, the Pulse note, the Guided
 * picker's text, the text a gated row shows while its gate fails).
 */

import { SecurityValidator } from '../../../core/SecurityValidator.js';
import { getDeckEventsByKind, getDeckEventsByCategory, DECK_EVENT_NAMES } from '../../../core/deckEvents.js';
import { extractCustomDeckEvents } from '../../../core/widgetVarExtractor.js';
import { getPackSuggestedEvents } from '../../../core/deckEventPacks.js';
import { getFieldsForType } from '../../../widgets/PropertyRegistry.js';
import { showToast } from '../../StudioModal.js';
import { CUSTOM_OPTION_VALUE, CATEGORY_LABELS, escapeHtmlAttr } from '../inspectorMarkup.js';

/** Each binding path's DOM id, or the stem its sub-controls' ids extend. */
const BINDING_DOM_IDS = {
  'binding.readSimVar': 'c-bind-read',
  'binding.unit': 'c-bind-unit',
  'binding.pollFrequencyHz': 'c-bind-pollrate',
  'binding.pollGroup': 'c-bind-pollgroup',
  'binding.deadband': 'c-bind-deadband',
  'binding.transition': 'c-bind-transition',
  'binding.writeEvent': 'c-bind-write',
  'binding.incrementEvent': 'c-bind-increment',
  'binding.decrementEvent': 'c-bind-decrement',
  'binding.fastIncrementEvent': 'c-bind-fastincrement',
  'binding.fastDecrementEvent': 'c-bind-fastdecrement',
  'binding.ackEvent': 'c-bind-ack',
  'binding.pushEvent': 'c-bind-push',
  'binding.eventCategory': 'c-bind-eventcategory',
  'binding.stateVar': 'c-bind-state',
  'binding.stateRef': 'c-bind-stateref',
  'binding.sublabelStateRef': 'c-bind-sublabelstateref',
  'binding.testStateVar': 'c-bind-teststatevar',
};

/**
 * The DOM id (or id stem) a binding row's control uses.
 * @param {object} host Inspector facade providing fieldDomId.
 * @param {string} path Binding row path.
 * @returns {string} The table's id, else `host.fieldDomId(path)` (for example `rf-binding-fooEvent`).
 */
function bindingDomId(host, path) {
  return Object.hasOwn(BINDING_DOM_IDS, path) ? BINDING_DOM_IDS[path] : host.fieldDomId(path);
}

/** Label text plus a tooltip (the row's, unless another is given) on an ⓘ span, both escaped. */
function labelMarkup(host, field, tooltip = field.tooltip) {
  const text = escapeHtmlAttr(field.label || host.humanizeFieldLabel(field.path));
  return tooltip ? `${text} <span class="prop-hint" title="${escapeHtmlAttr(tooltip)}">ⓘ</span>` : text;
}

/** The stored value, else the row's default; never written back. */
function shownValue(host, comp, field) {
  return host.getFieldValue(comp, field.path) ?? field.default;
}

/**
 * The placeholder and hint a row shows in place of its own while its `enabledWhen` gate fails. Unit
 * belongs to PC Bridge when Read is a bare Deck Event, and a typed value would be ignored at runtime.
 */
const GATED_TEXT = {
  'binding.unit': {
    placeholder: 'Unit is set by PC Bridge for this Deck Event',
    hint: 'Unit is set by PC Bridge for this Deck Event.',
  },
};

/** The type's full row list, from the host's row source when it has one, else the registry. */
function rowsOf(host, comp) {
  return host.getFieldsForType ? host.getFieldsForType(comp.type) : getFieldsForType(comp.type);
}

/**
 * Free text, such as a state path (`presets[0].label`), a Poll Group, an Event Category or Unit. The
 * trimmed text is written; blank removes the key. A row in `GATED_TEXT` whose `enabledWhen` gate fails
 * shows that text as its placeholder and hint; the engine disables the input itself.
 * @param {object} host Inspector facade.
 * @param {object} comp Component captured for this render.
 * @param {object} field Binding registry row.
 * @param {HTMLElement} mount Element whose contents are replaced.
 * @returns {void}
 */
function renderTextField(host, comp, field, mount) {
  const id = bindingDomId(host, field.path);
  const gated = field.enabledWhen && Object.hasOwn(GATED_TEXT, field.path) && !host.evaluateShowWhen(comp, field.enabledWhen, rowsOf(host, comp))
    ? GATED_TEXT[field.path]
    : null;
  mount.innerHTML = `
      <label>${labelMarkup(host, field, gated ? gated.hint : field.tooltip)}</label>
      <input type="text" id="${escapeHtmlAttr(id)}" class="prop-input" value="${escapeHtmlAttr(shownValue(host, comp, field) ?? '')}" placeholder="${escapeHtmlAttr(gated ? gated.placeholder : field.placeholder || '')}" />
    `;
  mount.querySelector('input')?.addEventListener('change', (e) => {
    host.commitField(comp, field.path, e.target.value.trim() || undefined);
  });
}

/**
 * A number, such as Dead Band. `Number(text) || 0` is written, so blank or unparsable text stores 0.
 * A row `min` becomes the input's `min`, which the Inspector's chevron and wheel stepping respect.
 * The step comes from the Inspector's step lookup, by DOM id.
 * @param {object} host Inspector facade.
 * @param {object} comp Component captured for this render.
 * @param {object} field Binding registry row.
 * @param {HTMLElement} mount Element whose contents are replaced.
 * @returns {void}
 */
function renderNumberField(host, comp, field, mount) {
  const id = bindingDomId(host, field.path);
  const minAttr = Number.isFinite(field.min) ? ` min="${field.min}"` : '';
  mount.innerHTML = `
      <label>${labelMarkup(host, field)}</label>
      <input type="number" step="any"${minAttr} id="${escapeHtmlAttr(id)}" class="prop-input" value="${escapeHtmlAttr(shownValue(host, comp, field) ?? '')}" placeholder="${escapeHtmlAttr(field.placeholder || '')}" />
    `;
  mount.querySelector('input')?.addEventListener('change', (e) => {
    host.commitField(comp, field.path, Number(e.target.value) || 0);
  });
}

/**
 * Maps a stored value to the option shown, for a row whose stored values can fall between its options.
 * Poll Rate offers two tiers, and any stored rate above 2 Hz reads as Fast.
 */
const SHOWN_OPTION = {
  'binding.pollFrequencyHz': (value) => (Number(value) > 2 ? 100 : 1),
};

/**
 * A choice among the row's `options` (`{value, label}` objects or bare values). The chosen option's
 * own value is written, with its type, so a numeric option stores a number.
 * @param {object} host Inspector facade.
 * @param {object} comp Component captured for this render.
 * @param {object} field Binding registry row.
 * @param {HTMLElement} mount Element whose contents are replaced.
 * @returns {void}
 */
function renderSelectField(host, comp, field, mount) {
  const id = bindingDomId(host, field.path);
  const options = (field.options || []).map((opt) => (opt && typeof opt === 'object' ? opt : { value: opt, label: String(opt) }));
  const stored = shownValue(host, comp, field);
  const shown = Object.hasOwn(SHOWN_OPTION, field.path) ? SHOWN_OPTION[field.path](stored) : stored;
  mount.innerHTML = `
      <label>${labelMarkup(host, field)}</label>
      <select id="${escapeHtmlAttr(id)}" class="prop-select">${options.map((opt) => `<option value="${escapeHtmlAttr(opt.value)}" ${opt.value === shown ? 'selected' : ''}>${escapeHtmlAttr(opt.label)}</option>`).join('')}</select>
    `;
  mount.querySelector('select')?.addEventListener('change', (e) => {
    const chosen = options.find((opt) => String(opt.value) === e.target.value);
    host.commitField(comp, field.path, chosen?.value);
  });
}

/** Paths whose state picker also offers Custom…, for a `$context` reference or another raw name. */
const CUSTOM_STATE_PATHS = new Set(['binding.stateVar']);

const CUSTOM_STATE_TOOLTIP = 'FDWS v1.3: for a popover widget, bind to data the host passed in via $context.<key>.value — the key must match one declared in the host\'s Open Widget Popover Context Map. Also used for any other raw stateVar string not in this widget\'s own state[] list.';

/**
 * A choice among the widget's declared state variables, each shown as "name (type)". None removes the
 * key. A path in `CUSTOM_STATE_PATHS` also offers Custom…: it reveals a text input without writing, and
 * the input's trimmed text is written on change. A stored name no variable declares selects Custom…
 * with the name in the input, and nothing is written on render, so a renamed variable is never cleared.
 * @param {object} host Inspector facade.
 * @param {object} comp Component captured for this render.
 * @param {object} field Binding registry row.
 * @param {HTMLElement} mount Element whose contents are replaced.
 * @returns {void}
 */
function renderStateVarPicker(host, comp, field, mount) {
  const id = escapeHtmlAttr(bindingDomId(host, field.path));
  const stateVars = host.state.widgetDef.state || [];
  const stored = shownValue(host, comp, field);
  const allowsCustom = CUSTOM_STATE_PATHS.has(field.path);
  const isCustom = allowsCustom && !!stored && !stateVars.some((s) => s.name === stored);
  mount.innerHTML = `
      <label>${labelMarkup(host, field)}</label>
      <select id="${id}" class="prop-select">
        <option value="" ${!stored ? 'selected' : ''}>None</option>
        ${stateVars.map((s) => `<option value="${escapeHtmlAttr(s.name)}" ${!isCustom && stored === s.name ? 'selected' : ''}>${escapeHtmlAttr(s.name)} (${escapeHtmlAttr(s.type)})</option>`).join('')}
        ${allowsCustom ? `<option value="${CUSTOM_OPTION_VALUE}" ${isCustom ? 'selected' : ''}>Custom…</option>` : ''}
      </select>
      ${allowsCustom ? `
      <div class="prop-field prop-custom-block ${isCustom ? '' : 'hidden'}" id="${id}-custom-block">
        <label>Custom / $context reference <span class="prop-hint" title="${escapeHtmlAttr(CUSTOM_STATE_TOOLTIP)}">ⓘ</span></label>
        <input type="text" id="${id}-custom-input" class="prop-input" value="${escapeHtmlAttr(isCustom ? stored : '')}" placeholder="e.g. $context.currentFreq.value" />
      </div>` : ''}
    `;
  const select = mount.querySelector('select');
  const customBlock = mount.querySelector('.prop-custom-block');
  const customInput = mount.querySelector('.prop-custom-block input');
  select?.addEventListener('change', () => {
    // Custom… only reveals: a write here would re-render the panel from the still-empty value and
    // snap the select back before anything could be typed.
    if (select.value === CUSTOM_OPTION_VALUE) {
      customBlock?.classList.remove('hidden');
      return;
    }
    customBlock?.classList.add('hidden');
    if (customInput) customInput.value = '';
    host.commitField(comp, field.path, select.value || undefined);
  });
  customInput?.addEventListener('change', () => {
    host.commitField(comp, field.path, customInput.value.trim() || undefined);
  });
}

/** Easing option labels, keyed by the option's stored value. */
const EASING_LABELS = { linear: 'Linear', 'ease-out': 'Ease Out', 'ease-in-out': 'Ease In-Out' };

/**
 * A `{ durationMs, easing }` object as a milliseconds input and an easing select, drawn from the row's
 * `fields`. Both controls write `{ durationMs: Number(ms) || 0, easing }` in one update; a blank
 * duration removes the key whatever the easing. The easing shown is the stored one, else the `easing`
 * field's default.
 * @param {object} host Inspector facade.
 * @param {object} comp Component captured for this render.
 * @param {object} field Binding registry row with `fields` describing `durationMs` and `easing`.
 * @param {HTMLElement} mount Element whose contents are replaced.
 * @returns {void}
 * @throws {Error} When the row has no `easing` field to draw.
 */
function renderTransitionField(host, comp, field, mount) {
  const easingField = (field.fields || []).find((f) => f.key === 'easing');
  if (!easingField) {
    throw new Error(`[BindingFields] Row "${field.path}" has no "easing" field for the transition editor.`);
  }
  const id = escapeHtmlAttr(bindingDomId(host, field.path));
  const stored = shownValue(host, comp, field);
  const shownEasing = stored?.easing || easingField.default;
  mount.innerHTML = `
      <div class="prop-row-2">
        <div class="prop-field">
          <label>${labelMarkup(host, field)}</label>
          <input type="number" step="1" min="0" id="${id}-ms" class="prop-input" value="${escapeHtmlAttr(stored?.durationMs ?? '')}" placeholder="none" />
        </div>
        <div class="prop-field">
          <label>Easing</label>
          <select id="${id}-easing" class="prop-select">${(easingField.options || []).map((opt) => `<option value="${escapeHtmlAttr(opt)}" ${opt === shownEasing ? 'selected' : ''}>${escapeHtmlAttr(EASING_LABELS[opt] || opt)}</option>`).join('')}</select>
        </div>
      </div>
    `;
  const msInput = mount.querySelector('input');
  const easingSelect = mount.querySelector('select');
  const commit = () => {
    const easing = easingSelect.value || easingField.default;
    host.commitField(comp, field.path, msInput.value === '' ? undefined : { durationMs: Number(msInput.value) || 0, easing });
  };
  msInput?.addEventListener('change', commit);
  easingSelect?.addEventListener('change', commit);
}

/**
 * What differs between the two Deck Event pickers. A write picker (`eventPicker`) offers the
 * catalogue's write events and sanitizes what is typed as an event name; a read picker
 * (`simVarPicker`) offers its read events and sanitizes as a SimVar.
 */
const PICKER_KINDS = {
  write: {
    sanitize: 'event',
    rawLabel: 'Or type a new custom event / raw SimConnect event (H:/K:...)',
    rawPlaceholder: 'e.g. myCustomEvent, H:GTN750_DirectToPush',
  },
  read: {
    sanitize: 'simvar',
    rawLabel: 'Or type a new custom variable / raw SimVar (L:/A:...)',
    rawPlaceholder: 'e.g. myCustomVar, L:FBW_TAXI_LIGHT_INTENSITY',
  },
};

/**
 * The events of one kind other saved widgets use, then those Community Packs suggest, as Custom block
 * suggestions. The widget being edited is left out of the saved ones.
 * @param {object} host Inspector facade with `state.loadSavedWidgets` and `state.widgetDef`.
 * @param {'read'|'write'} kind Which kind of event to suggest.
 * @returns {Array<{name: string, source: string}>} Each event once, saved widgets first.
 */
function suggestedEvents(host, kind) {
  const savedWidgets = host.state.loadSavedWidgets().filter((w) => w.id !== host.state.widgetDef.id);
  const saved = extractCustomDeckEvents(savedWidgets, DECK_EVENT_NAMES).map((e) => ({
    name: e.name,
    kind: e.kind,
    source: e.widgetIds.length ? `used by ${e.widgetIds.join(', ')}` : '',
  }));
  const packs = getPackSuggestedEvents()
    .filter((e) => !saved.some((c) => c.name === e.name))
    .map((e) => ({ name: e.name, kind: e.kind, source: `from pack: ${e.fromPack}` }));
  return [...saved, ...packs].filter((e) => e.kind === kind);
}

/** The Deck Event dropdown's options: None, the catalogue's events of this kind, and Custom…. */
function deckEventOptions(kind, current) {
  const items = getDeckEventsByKind(kind);
  const isKnown = items.some((e) => e.name === current);
  return `
      <option value="" ${!current && !isKnown ? 'selected' : ''}>— none —</option>
      ${items.map((e) => `<option value="${escapeHtmlAttr(e.name)}" ${current === e.name ? 'selected' : ''}>${escapeHtmlAttr(e.label)}</option>`).join('')}
      <option value="${CUSTOM_OPTION_VALUE}" ${current && !isKnown ? 'selected' : ''}>Custom…</option>`;
}

/** The Custom block's suggestion options; one is selected only when it is the stored value. */
function suggestionOptions(entries, current) {
  const placeholder = entries.length > 0 ? '— select or type below —' : '(no custom Deck Events in use yet — try importing a Community Pack in the Library tab)';
  return `
      <option value="">${placeholder}</option>
      ${entries.map((e) => `<option value="${escapeHtmlAttr(e.name)}" ${current === e.name ? 'selected' : ''}>${escapeHtmlAttr(e.name)}${e.source ? ` (${escapeHtmlAttr(e.source)})` : ''}</option>`).join('')}`;
}

/**
 * Text of a Guided picker by row: the label, and the hint on its ⓘ. A guided row missing here uses its
 * own label and `GUIDED_HINT`.
 */
const GUIDED_TEXT = {
  'binding.readSimVar': {
    label: 'Connect to Simulator — Value to Show',
    hint: 'Pick a category, then the specific value this component should read. Fills in the same field Advanced mode\'s Read Deck Event dropdown below uses — switch to Advanced any time to see the raw name or type a custom one.',
  },
  'binding.writeEvent': {
    label: 'Connect to Simulator — Value to Send',
    hint: 'Pick a category, then the specific command this component should send. Fills in the same field Advanced mode\'s Write Deck Event dropdown below uses — switch to Advanced any time to see the raw name or type a custom one.',
  },
  'binding.incrementEvent': {
    label: 'Connect to Simulator — Increment Event (Pulse Clockwise)',
    hint: 'Pick a category, then the specific command dispatched once per step turned clockwise. Fills in the same field Advanced mode\'s Increment Deck Event dropdown below uses — switch to Advanced any time to see the raw name or type a custom one.',
  },
  'binding.decrementEvent': {
    label: 'Connect to Simulator — Decrement Event (Pulse Counter-Clockwise)',
    hint: 'Pick a category, then the specific command dispatched once per step turned counter-clockwise. Fills in the same field Advanced mode\'s Decrement Deck Event dropdown below uses — switch to Advanced any time to see the raw name or type a custom one.',
  },
};

const GUIDED_HINT = 'Pick a category, then the specific command. Fills in the same field Full mode\'s Deck Event dropdown uses — switch to Full any time to see the raw name or type a custom one.';

/** Paths whose Custom block also has Paste, which takes the SimVar Tester's parsed write event. */
const PASTE_PATHS = new Set(['binding.writeEvent']);

/** Paths that say they are unused while a Rotary is in Pulse mode (its Increment and Decrement send instead). */
const PULSE_NOTE_PATHS = new Set(['binding.writeEvent']);

/**
 * The id stem of a guided row's picker: the row's own id with `c-connect-` in place of `c-bind-`, or
 * the row's fallback id when the table has no entry.
 */
function guidedDomId(host, path) {
  return Object.hasOwn(BINDING_DOM_IDS, path) ? BINDING_DOM_IDS[path].replace(/^c-bind-/, 'c-connect-') : host.fieldDomId(path);
}

/** A category `<option>` list for the events of one kind, with the current category selected. */
function categoryOptions(kind, current) {
  const categories = [...new Set(getDeckEventsByKind(kind).map((e) => e.category))];
  return `
        <option value="">— choose a category —</option>
        ${categories.map((c) => `<option value="${escapeHtmlAttr(c)}" ${current === c ? 'selected' : ''}>${escapeHtmlAttr(CATEGORY_LABELS[c] || c)}</option>`).join('')}`;
}

/** The events of one kind in one category as `<option>`s, with the current value selected. */
function categoryValueOptions(kind, category, current) {
  return getDeckEventsByCategory(category)
    .filter((e) => e.kind === kind)
    .map((e) => `<option value="${escapeHtmlAttr(e.name)}" ${current === e.name ? 'selected' : ''}>${escapeHtmlAttr(e.label)}</option>`)
    .join('');
}

/**
 * Takes the SimVar Tester's parsed write shape (a `K:` write event, an `H:` event or an L:var set)
 * into a Deck Event row: it opens the Custom block on the value, strips a leading `K:` from a write
 * event only (an `H:` event or L:var set keeps its prefix) and writes it, telling the Author what was
 * pasted. A read, a test-only (complex) parse, or nothing, only gets a toast.
 * @param {object} host Inspector facade providing `state.testerParsed` and commitField.
 * @param {object} comp Component captured for this render.
 * @param {object} field Binding registry row.
 * @param {{select: HTMLSelectElement, block: HTMLElement, input: HTMLInputElement}} controls The row's Deck Event dropdown, Custom block and Custom input.
 * @returns {void}
 */
function pasteParsedWriteEvent(host, comp, field, { select, block, input }) {
  const parsed = host.state.testerParsed;
  if (!parsed) { showToast('Nothing parsed yet — use the SimVar Tester in the bottom bar first.'); return; }
  if (parsed.kind === 'complex') { showToast('That one is test-only — conditionals and multi-token RPN can’t be stored in a binding.'); return; }
  if (parsed.kind === 'read') { showToast('That’s a read expression — paste it into the Read Deck Event field instead.'); return; }
  select.value = CUSTOM_OPTION_VALUE;
  block.classList.remove('hidden');
  const event = parsed.kind === 'write' ? parsed.event.replace(/^K:/i, '') : parsed.event;
  input.value = event;
  // Bindings cannot store a write value, so report it to the author.
  showToast(parsed.value !== null && parsed.value !== undefined
    ? `Pasted ${event}. It also sends the value ${parsed.value} — a binding has no value field, so set that on this component’s interaction action.`
    : `Pasted ${event}.`);
  host.commitField(comp, field.path, event);
}

/** A raw SimVar or event address: an `A:`, `L:`, `H:` or `K:` prefix, any case. */
const RAW_ADDRESS = /^(A|L|H|K):/i;

/** Read rows whose unit `binding.unit` holds; another read row's paste never writes it. */
const UNIT_OWNER_PATHS = new Set(['binding.readSimVar']);

/**
 * Takes the SimVar Tester's parsed read into a read row: it opens the Custom block on the value and
 * writes the name in one update. On a row in `UNIT_OWNER_PATHS` the parsed unit is written with it
 * when the name is a raw A:/L:/H:/K: address (a bare Deck Event's unit is PC Bridge's, so a previous
 * unit is left as it was). The Author is told what was pasted. A write event, a test-only (complex)
 * parse, or nothing, only gets a toast.
 * @param {object} host Inspector facade providing `state.testerParsed` and `state.updateComponent`.
 * @param {object} comp Component captured for this render.
 * @param {object} field Binding registry row.
 * @param {{select: HTMLSelectElement, block: HTMLElement, input: HTMLInputElement}} controls The row's Deck Event dropdown, Custom block and Custom input.
 * @returns {void}
 */
function pasteParsedReadValue(host, comp, field, { select, block, input }) {
  const parsed = host.state.testerParsed;
  if (!parsed) { showToast('Nothing parsed yet — use the SimVar Tester in the bottom bar first.'); return; }
  if (parsed.kind === 'complex') { showToast('That one is test-only — conditionals and multi-token RPN can’t be stored in a binding.'); return; }
  if (parsed.kind !== 'read') { showToast('That’s a write event — paste it into the Write Deck Event field instead.'); return; }
  select.value = CUSTOM_OPTION_VALUE;
  block.classList.remove('hidden');
  input.value = parsed.name;
  const updates = { [field.path.slice('binding.'.length)]: parsed.name };
  if (UNIT_OWNER_PATHS.has(field.path) && parsed.unit && RAW_ADDRESS.test(parsed.name)) updates.unit = parsed.unit;
  showToast(`Pasted ${parsed.name}${updates.unit ? ` (unit ${updates.unit})` : ''}.`);
  host.state.updateComponent(comp.id, { binding: { ...(comp.binding || {}), ...updates } });
}

/** Paths whose Custom block is followed by the resolved-unit line, and the line's DOM id. */
const RESOLVED_UNIT_PATHS = new Set(['binding.readSimVar']);
const RESOLVED_UNIT_ID = 'c-bind-resolved-info';

/**
 * A Deck Event as a dropdown of None, the catalogue's events of the row's kind and Custom…, plus
 * Connect…. A write row (`eventPicker`) offers write events; a read row (`simVarPicker`) offers read
 * events. Custom… reveals a block without writing: a suggestion select (events of that kind other saved
 * widgets use, and Community Pack events), a free-text input and a hint showing the characters
 * sanitizing would strip. A suggestion or the input's text is written sanitized (as an event name for
 * a write row, as a SimVar for a read row), and an empty result removes the key. A stored name outside
 * the catalogue selects Custom… with the block open and the name in the input. Connect… opens the
 * Connect dialog for this row's own key and kind. Sub-ids extend the row's id: `-connect`,
 * `-custom-block`, `-custom-select`, `-custom-input` and `-custom-diff`.
 *
 * A `guided` row also gets a Guided part, shown in Guided and Build in place of the dropdown, which
 * Full shows: a category select, then a value select that writes only once a value is chosen, and
 * "Find it by moving it" and "switch to Full mode" (which sets the Inspector's tier and
 * `fdws_studio_uiMode`). Its ids are `c-connect-<stem>-category`, `-variable`, `-findit` and `-full`,
 * with `<row id>-simple-field`, `-simple-hint` and, for the Full part, `-field`. The custom block
 * carries no `data-tier`, so a stored custom name shows at every tier. A read row always has Paste in
 * the block, and a write row does when its path is in `PASTE_PATHS`. A path in `PULSE_NOTE_PATHS` adds
 * the Pulse note between the two parts. A path in `RESOLVED_UNIT_PATHS` whose value is a bare Deck
 * Event, with a connected PC Bridge, gets the resolved-unit line after the block, shown in Full only
 * and filled once the Bridge answers, unless the panel has been re-rendered by then.
 * @param {object} host Inspector facade providing commitField, openConnectDialog, state and simBridge.
 * @param {object} comp Component captured for this render.
 * @param {object} field Binding registry row; its `control` (`simVarPicker`, else `eventPicker`) picks the kind.
 * @param {HTMLElement} mount Element whose contents are replaced.
 * @returns {void}
 */
function renderDeckEventPicker(host, comp, field, mount) {
  const kind = field.control === 'simVarPicker' ? 'read' : 'write';
  const kindText = PICKER_KINDS[kind];
  const rawId = bindingDomId(host, field.path);
  const id = escapeHtmlAttr(rawId);
  const key = field.path.slice('binding.'.length);
  const stored = shownValue(host, comp, field);
  const isCustom = !!stored && !getDeckEventsByKind(kind).some((e) => e.name === stored);
  const hasPaste = kind === 'read' || PASTE_PATHS.has(field.path);
  const showsResolvedUnit = RESOLVED_UNIT_PATHS.has(field.path) && !!stored && !RAW_ADDRESS.test(stored) && !!host.simBridge?.connected;

  const fullPart = `
      <label>${labelMarkup(host, field)}</label>
      <div class="prop-row-2">
        <select id="${id}" class="prop-select">${deckEventOptions(kind, stored)}</select>
        <button type="button" class="btn-small" id="${id}-connect" style="flex:0 0 auto;">Connect…</button>
      </div>`;
  const guidedRaw = field.guided ? guidedDomId(host, field.path) : '';
  const guidedId = escapeHtmlAttr(guidedRaw);
  let guidedPart = '';
  if (field.guided) {
    const text = GUIDED_TEXT[field.path] || { label: field.label || host.humanizeFieldLabel(field.path), hint: GUIDED_HINT };
    const currentCategory = getDeckEventsByKind(kind).find((e) => e.name === stored)?.category || '';
    const pulseNote = PULSE_NOTE_PATHS.has(field.path) && comp.type === 'core.rotary' && comp.props?.writeMode === 'pulse'
      ? `
      <div class="prop-hint-block" id="${id}-pulse-note" style="font-size:11px;opacity:0.75;margin:0 0 8px;">
        Write Deck Event is not used in Pulse mode: this Rotary sends the Increment and Decrement events below instead. ${stored ? 'The value here is kept, so switching back to Absolute finds it, but it is not declared to PC Bridge.' : ''}
      </div>`
      : '';
    guidedPart = `
      <div class="prop-field" data-tier="simple-only" id="${id}-simple-field">
        <label>${escapeHtmlAttr(text.label)} <span class="prop-hint" title="${escapeHtmlAttr(text.hint)}">ⓘ</span></label>
        <div class="connect-sim-picker">
          <select id="${guidedId}-category" class="prop-select">${categoryOptions(kind, currentCategory)}</select>
          <select id="${guidedId}-variable" class="prop-select" ${currentCategory ? '' : 'disabled'}>
            <option value="">${currentCategory ? '— choose a value —' : '— choose a category first —'}</option>
            ${currentCategory ? categoryValueOptions(kind, currentCategory, stored) : ''}
          </select>
        </div>
      </div>
      <div class="prop-hint-block" data-tier="simple-only" id="${id}-simple-hint" style="font-size:11px;opacity:0.75;margin:-4px 0 8px;">
        Don't see it? <button type="button" class="btn-mini-inline" id="${guidedId}-findit">Find it by moving it →</button>
        or <button type="button" class="btn-mini-inline" id="${guidedId}-full">switch to Full mode</button> for Raw Address / Custom.
      </div>${pulseNote}`;
  }
  mount.innerHTML = `${guidedPart}${field.guided ? `<div class="prop-field" data-tier="advanced" id="${id}-field">${fullPart}</div>` : fullPart}
      <div class="prop-field prop-custom-block ${isCustom ? '' : 'hidden'}" id="${id}-custom-block">
        <label>Custom Deck Event (used by another saved widget)</label>
        <select id="${id}-custom-select" class="prop-select">${suggestionOptions(suggestedEvents(host, kind), stored)}</select>
        <label>${kindText.rawLabel}</label>
        <div class="prop-paste-row">
          <input type="text" id="${id}-custom-input" class="prop-input" value="${escapeHtmlAttr(isCustom ? stored : '')}" placeholder="${escapeHtmlAttr(kindText.rawPlaceholder)}" />${hasPaste ? `
          <button type="button" class="btn-small" id="${id}-paste">Paste</button>` : ''}
        </div>
        <div class="prop-sanitize-diff hidden" id="${id}-custom-diff"></div>
      </div>${showsResolvedUnit ? `
      <div class="prop-live-info" id="${RESOLVED_UNIT_ID}" data-tier="advanced">Resolving…</div>` : ''}
    `;
  const part = (suffix) => [...mount.querySelectorAll('[id]')].find((el) => el.id === `${rawId}${suffix}`);
  const defaultSelect = part('');
  const customSelect = part('-custom-select');
  const customBlock = part('-custom-block');
  const customInput = part('-custom-input');
  const diff = part('-custom-diff');
  const commit = (value) => host.commitField(comp, field.path, value || undefined);

  // Shows the stripped characters before commit, without changing the draft.
  const updateDiffHint = () => {
    const { removed } = SecurityValidator.sanitizeWithReport(kindText.sanitize, customInput.value);
    if (removed.length > 0) {
      diff.textContent = `Removed ${removed.map((c) => `"${c}"`).join(' ')} — did you mean to paste forum syntax like "(A:TRANSPONDER IDENT:1, Bool)"? Only the cleaned text will be saved.`;
      diff.classList.remove('hidden');
    } else {
      diff.textContent = '';
      diff.classList.add('hidden');
    }
  };
  customInput.addEventListener('input', updateDiffHint);

  defaultSelect.addEventListener('change', () => {
    // Custom… only reveals: a write here would re-render the panel from the still-empty input and
    // snap the select back before anything could be typed or picked.
    if (defaultSelect.value === CUSTOM_OPTION_VALUE) {
      customBlock.classList.remove('hidden');
      return;
    }
    customBlock.classList.add('hidden');
    customSelect.value = '';
    customInput.value = '';
    updateDiffHint();
    commit(defaultSelect.value);
  });
  customSelect.addEventListener('change', () => {
    if (customSelect.value) customInput.value = customSelect.value;
    updateDiffHint();
    commit(SecurityValidator.sanitizeWithReport(kindText.sanitize, customInput.value).cleaned);
  });
  customInput.addEventListener('change', () => {
    commit(SecurityValidator.sanitizeWithReport(kindText.sanitize, customInput.value).cleaned);
  });
  part('-connect').addEventListener('click', () => host.openConnectDialog(comp, host.state.widgetDef, kind, key));
  const paste = kind === 'read' ? pasteParsedReadValue : pasteParsedWriteEvent;
  part('-paste')?.addEventListener('click', () => paste(host, comp, field, { select: defaultSelect, block: customBlock, input: customInput }));

  if (showsResolvedUnit) {
    // A bare Deck Event's unit comes from the active Bridge profile.
    const resolvedInfo = mount.querySelector(`#${RESOLVED_UNIT_ID}`);
    host.simBridge.resolveDeckEvent(stored).then((resolved) => {
      // The panel may have re-rendered (another component, or a binding edit) by the time this
      // resolves; only touch the DOM if this exact element is still live.
      if (!resolvedInfo.isConnected) return;
      resolvedInfo.textContent = resolved
        ? `Unit: ${resolved.unit} — from profile "${resolved.profileName}"`
        : `"${stored}" has no mapping in the active profile.`;
    });
  }

  if (!field.guided) return;
  const guidedPartAt = (suffix) => [...mount.querySelectorAll('[id]')].find((el) => el.id === `${guidedRaw}${suffix}`);
  const categorySelect = guidedPartAt('-category');
  const variableSelect = guidedPartAt('-variable');
  categorySelect.addEventListener('change', () => {
    // Choosing a category only fills the value select; nothing is written until a value is chosen.
    if (!categorySelect.value) {
      variableSelect.innerHTML = '<option value="">— choose a category first —</option>';
      variableSelect.disabled = true;
      return;
    }
    variableSelect.innerHTML = `<option value="">— choose a value —</option>${categoryValueOptions(kind, categorySelect.value, undefined)}`;
    variableSelect.disabled = false;
  });
  variableSelect.addEventListener('change', () => {
    if (variableSelect.value) commit(variableSelect.value);
  });
  guidedPartAt('-findit').addEventListener('click', () => host.simVarTester?.open());
  guidedPartAt('-full').addEventListener('click', () => {
    host.uiTier = 'full';
    localStorage.setItem('fdws_studio_uiMode', 'full');
    host.render();
  });
}

/** Binding renderers, keyed by registry control. */
const BINDING_RENDERERS = {
  text: renderTextField,
  number: renderNumberField,
  select: renderSelectField,
  stateRefPicker: renderTextField,
  stateVarPicker: renderStateVarPicker,
  transitionEditor: renderTransitionField,
  eventPicker: renderDeckEventPicker,
  simVarPicker: renderDeckEventPicker,
};

/**
 * Renders one binding row with the binding renderer for its control.
 * @param {object} host Inspector facade providing getFieldValue, commitField, evaluateShowWhen, humanizeFieldLabel, fieldDomId, openConnectDialog, state.loadSavedWidgets, state.widgetDef, state.testerParsed and state.updateComponent, plus uiTier, render and simVarTester for a guided row's Guided picker, and simBridge for Read's resolved-unit line. It may also provide getFieldsForType, the row source.
 * @param {object} comp Component captured for this render.
 * @param {object} field Binding registry row.
 * @param {HTMLElement} mount Element whose contents are replaced.
 * @returns {void} Replaces the mount's contents and registers its listeners.
 * @throws {Error} When no binding renderer exists for the row's control.
 */
export function renderBindingField(host, comp, field, mount) {
  const renderer = Object.hasOwn(BINDING_RENDERERS, field.control) ? BINDING_RENDERERS[field.control] : null;
  if (!renderer) {
    throw new Error(`[BindingFields] No binding renderer for control "${field.control}" (path "${field.path}").`);
  }
  renderer(host, comp, field, mount);
}
