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

import { escapeHtmlAttr } from '../inspectorMarkup.js';

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

/** Binding renderers, keyed by registry control. */
const BINDING_RENDERERS = {
  text: renderTextField,
  number: renderNumberField,
  select: renderSelectField,
  stateRefPicker: renderTextField,
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
