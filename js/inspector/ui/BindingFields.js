/**
 * @module BindingFields
 * The Bindings panel's binding renderers: how a `binding.*` registry row is drawn and written, which
 * may differ from the renderer other Inspector sections use for the same control name. Each renderer
 * shows the row's `label` (else the humanized path), its `tooltip` on an ⓘ span and its
 * `placeholder`, escapes every authored string, and writes through `host.commitField`. DOM ids come
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

/**
 * A free-text state path, such as `presets[0].label`. The trimmed text is written; blank removes the key.
 * @param {object} host Inspector facade.
 * @param {object} comp Component captured for this render.
 * @param {object} field Binding registry row.
 * @param {HTMLElement} mount Element whose contents are replaced.
 * @returns {void}
 */
function renderStateRefField(host, comp, field, mount) {
  const id = bindingDomId(host, field.path);
  mount.innerHTML = `
      <label>${labelMarkup(host, field)}</label>
      <input type="text" id="${escapeHtmlAttr(id)}" class="prop-input" value="${escapeHtmlAttr(host.getFieldValue(comp, field.path) ?? '')}" placeholder="${escapeHtmlAttr(field.placeholder || '')}" />
    `;
  mount.querySelector('input')?.addEventListener('change', (e) => {
    host.commitField(comp, field.path, e.target.value.trim() || undefined);
  });
}

/** Binding renderers, keyed by registry control. */
const BINDING_RENDERERS = {
  stateRefPicker: renderStateRefField,
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
