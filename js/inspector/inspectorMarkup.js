/**
 * @module inspectorMarkup
 * Pure text and control markers shared by Inspector sections. Importing this
 * module reads no browser state and owns no DOM or mutable resources.
 */

/**
 * Sentinel used by select controls to reveal a free-text custom value. It is
 * distinct from every authored Deck Event or state-variable name.
 * @type {string}
 */
export const CUSTOM_OPTION_VALUE = '__custom__';

/**
 * Matches CSS gradient functions that require gradient-aware appearance handling.
 * A free-text color field accepts gradients, but a value saved while its
 * background type remains "color" cannot be re-derived for the other theme
 * by ThemeColor. Callers trim whitespace before testing; this does not parse CSS.
 * @type {RegExp}
 */
export const GRADIENT_VALUE_RE = /^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i;

/**
 * Escape a value for an HTML attribute or text interpolated into Inspector
 * markup. Registry tooltips can contain literal quotes and authored values can
 * contain markup characters. Nullish values become an empty string; other
 * values are stringified.
 * This does not sanitize CSS or URLs.
 * @param {unknown} value
 * @returns {string} HTML-escaped text.
 */
export function escapeHtmlAttr(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

/**
 * Human-readable labels for the Deck Event category tags shown in both the
 * binding panel and Connect dialog. These match deckEvents.js category tags
 * and help authors browse Deck Events without changing stored binding values.
 * Unknown tags are displayed by callers.
 * @type {Record<string, string>}
 */
export const CATEGORY_LABELS = { radio: 'Radios & Transponder', ap: 'Autopilot', lights: 'Lights', yoke: 'Virtual Yoke' };
