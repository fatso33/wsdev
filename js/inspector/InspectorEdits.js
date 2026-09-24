/**
 * @module InspectorEdits
 * Owns Property Inspector edit transactions. The supplied Inspector host retains
 * the sole StudioState reference; these functions add no state or resources.
 * Each write follows the existing one-update or multi-selection history path.
 */

import { showToast } from '../StudioModal.js';
import { applyRotaryContextChange, applyRotaryFeelEntry, isRotaryFeelContextPath, isRotaryFeelPath } from '../RotaryDefaults.js';

/**
 * Reads a dotted component path. Missing intermediate values yield undefined;
 * the component and path must be supplied by the caller.
 * @param {object} comp Component or multi-selection proxy to read.
 * @param {string} path Dot-separated field path.
 * @returns {*} The stored leaf value, or undefined when a segment is absent.
 */
export function getFieldValue(comp, path) {
  return path.split('.').reduce((cur, seg) => (cur == null ? undefined : cur[seg]), comp);
}

/**
 * Commits a Rotary Write Mode or Gesture together with any implied Feel change
 * in one StudioState update, so one Undo reverts both. RotaryDefaults preserves
 * authored values that fit the new context and supplies an adjustment notice.
 * @param {object} host Inspector with the live state reference.
 * @param {object} comp Rotary component to update.
 * @param {string} path Rotary context path under props.
 * @param {*} value New context value.
 * @returns {void} Shows a toast only when the Feel changes.
 */
export function commitRotaryFeelContext(host, comp, path, value) {
  const { props, message } = applyRotaryContextChange(comp.props, path.slice('props.'.length), value);
  host.state.updateComponent(comp.id, { props });
  if (message) showToast(message);
}

/**
 * Commits a typed Rotary Feel in one StudioState update. Values finer than
 * this Rotary's Feel floor are committed at the floor, with a toast; an
 * unchanged value still updates so the rebuilt panel reflects stored data.
 * @param {object} host Inspector with the live state reference.
 * @param {object} comp Rotary component to update.
 * @param {number} value Authored Feel in degrees, pixels or steps per unit according to Gesture.
 * @returns {void} The update creates one undo entry through StudioState.
 */
export function commitRotaryFeelEntry(host, comp, value) {
  const { props, message } = applyRotaryFeelEntry(comp.props, value);
  host.state.updateComponent(comp.id, { props });
  if (message) showToast(message);
}

/**
 * Commits one component field. For ordinary paths, only containers along the
 * path are cloned, including arrays such as style.rules; sibling references
 * stay intact. A root path writes directly. Rotary Feel and context writes use
 * their coupled one-update delegates. A multi-selection proxy instead asks
 * StudioState to fan out once and announces its returned Feel adjustments.
 * @param {object} host Inspector with live state and Rotary commit delegates.
 * @param {object} comp Component or __multiSelect proxy.
 * @param {string} path Dot-separated component field path.
 * @param {*} value Value to write, including undefined for a cleared override.
 * @returns {void} A single-component update or bulk write creates one undo entry.
 */
export function commitField(host, comp, path, value) {
  if (comp.__multiSelect) {
    const notes = host.state.applyFieldToSelection(path, value);
    if (notes.length === 1) showToast(notes[0].message);
    else if (notes.length > 1) {
      showToast(isRotaryFeelPath(path)
        ? `Feel was raised to the floor on ${notes.length} Rotaries. Ctrl+Z undoes all of it.`
        : `Feel was adjusted on ${notes.length} Rotaries to fit the new setting. Ctrl+Z undoes all of it.`);
    }
    return;
  }
  if (comp.type === 'core.rotary' && isRotaryFeelContextPath(path)) {
    host.commitRotaryFeelContext(comp, path, value);
    return;
  }
  if (comp.type === 'core.rotary' && isRotaryFeelPath(path)) {
    host.commitRotaryFeelEntry(comp, value);
    return;
  }
  const segs = path.split('.');
  const topKey = segs[0];
  // A single-segment path writes the root value rather than re-committing its old value.
  if (segs.length === 1) {
    host.state.updateComponent(comp.id, { [topKey]: value });
    return;
  }
  // Preserving array-ness keeps rule indexes and length valid for style resolution.
  const cloneLevel = (obj) => (Array.isArray(obj) ? [...obj] : (obj && typeof obj === 'object' ? { ...obj } : {}));
  const topVal = cloneLevel(comp[topKey]);
  let cur = topVal;
  for (let i = 1; i < segs.length - 1; i++) {
    cur[segs[i]] = cloneLevel(cur[segs[i]]);
    cur = cur[segs[i]];
  }
  cur[segs[segs.length - 1]] = value;
  host.state.updateComponent(comp.id, { [topKey]: topVal });
}

/**
 * Replaces one props key while retaining sibling props, through one
 * StudioState update and undo entry.
 * @param {object} host Inspector with the live state reference.
 * @param {object} comp Component to update.
 * @param {string} propKey Key below props.
 * @param {*} value Replacement value.
 * @returns {void}
 */
export function updateCompProp(host, comp, propKey, value) {
  const nextProps = { ...(comp.props || {}), [propKey]: value };
  host.state.updateComponent(comp.id, { props: nextProps });
}

/**
 * Parses a JSON prop edit and delegates a valid value to updateCompProp. An
 * invalid JSON value makes no state change. The existing catch also presents
 * any delegate error inline, or warns on the console without an error element.
 * @param {object} host Inspector with the props update delegate.
 * @param {object} comp Component to update.
 * @param {string} propKey Key below props.
 * @param {string} rawValue Text to parse as JSON.
 * @param {HTMLElement | null | undefined} errorEl Optional inline error element.
 * @returns {void} Hides the error element after a successful update.
 */
export function updateCompJsonProp(host, comp, propKey, rawValue, errorEl) {
  try {
    const parsed = JSON.parse(rawValue);
    host.updateCompProp(comp, propKey, parsed);
    if (errorEl) errorEl.classList.add('hidden');
  } catch (err) {
    if (errorEl) {
      errorEl.textContent = `Invalid JSON — edit not applied: ${err.message}`;
      errorEl.classList.remove('hidden');
    } else {
      console.warn(`[StudioInspector] Invalid JSON for prop "${propKey}"; change ignored.`, err);
    }
  }
}
