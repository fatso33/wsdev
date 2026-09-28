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
 */

import { CUSTOM_OPTION_VALUE, escapeHtmlAttr } from '../inspectorMarkup.js';

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

/** Label text plus the row's tooltip on an ⓘ span, both escaped. */
function labelMarkup(host, field) {
  const text = escapeHtmlAttr(field.label || host.humanizeFieldLabel(field.path));
  return field.tooltip ? `${text} <span class="prop-hint" title="${escapeHtmlAttr(field.tooltip)}">ⓘ</span>` : text;
}

/** The stored value, else the row's default; never written back. */
function shownValue(host, comp, field) {
  return host.getFieldValue(comp, field.path) ?? field.default;
}

/**
 * Free text, such as a state path (`presets[0].label`), a Poll Group or an Event Category. The trimmed
 * text is written; blank removes the key.
 * @param {object} host Inspector facade.
 * @param {object} comp Component captured for this render.
 * @param {object} field Binding registry row.
 * @param {HTMLElement} mount Element whose contents are replaced.
 * @returns {void}
 */
function renderTextField(host, comp, field, mount) {
  const id = bindingDomId(host, field.path);
  mount.innerHTML = `
      <label>${labelMarkup(host, field)}</label>
      <input type="text" id="${escapeHtmlAttr(id)}" class="prop-input" value="${escapeHtmlAttr(shownValue(host, comp, field) ?? '')}" placeholder="${escapeHtmlAttr(field.placeholder || '')}" />
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

/** Binding renderers, keyed by registry control. */
const BINDING_RENDERERS = {
  text: renderTextField,
  number: renderNumberField,
  select: renderSelectField,
  stateRefPicker: renderTextField,
  stateVarPicker: renderStateVarPicker,
  transitionEditor: renderTransitionField,
};

/**
 * Renders one binding row with the binding renderer for its control.
 * @param {object} host Inspector facade providing getFieldValue, commitField, humanizeFieldLabel and fieldDomId.
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
