/**
 * rotaryFace.js
 *
 * Pure Face generator for the Rotary component family (Rotary rebuild, ticket 02):
 * configuration in, inline vector markup out. No DOM, no component instance, no
 * reads of ambient state — the Component owns the wrapper element and the gesture;
 * this owns nothing but the picture inside it.
 *
 * Rendering is deliberately hybrid (ticket 02): the Component's own outer container
 * stays a DOM node, so the existing style cascade / theming / state styles /
 * conditional rules all keep working on it unchanged, and only the knob Face itself
 * is generated markup.
 *
 * The Face carries no pixel size. It is drawn on a fixed 0 0 100 100 viewBox and
 * scales into whatever box the Author's layout gave the Component, which is what
 * lets the Component size to its layout space instead of a fixed pixel size.
 *
 * Scope for ticket 02: the fill, rim and indicator groups only. Ticket 07 adds the
 * remaining groups (ticks, skirt, cap, ...). Each group is marked with
 * `data-face-group="<name>"` so later groups slot in by name — and so tests can
 * assert on groups rather than on one opaque markup blob.
 *
 * ---------------------------------------------------------------------------
 * config (every key optional):
 *   angle: number            // rotation of the indicator, degrees clockwise from
 *                            // straight up (12 o'clock). The Component maps the
 *                            // engine's 0..sweep angle onto this; the Face itself
 *                            // knows nothing about value ranges or sweeps.
 *   faceColor: string        // disc fill. Omitted entirely when unset, so an
 *                            // authored style.background on the Face wrapper shows
 *                            // through instead of being covered by an opaque disc.
 *   rimColor: string         // rim stroke color
 *   rimWidth: number         // rim stroke width, in viewBox units
 *   indicatorColor: string   // pointer color
 *   indicatorWidth: number   // pointer stroke width, in viewBox units
 *   indicatorLength: number  // pointer length inward from the rim, in viewBox units
 * ---------------------------------------------------------------------------
 */

const VIEWBOX_SIZE = 100;
const CENTER = VIEWBOX_SIZE / 2;

const DEFAULT_RIM_COLOR = '#64748b';
const DEFAULT_RIM_WIDTH = 6;
const DEFAULT_INDICATOR_COLOR = '#e2e8f0';
const DEFAULT_INDICATOR_WIDTH = 6;
const DEFAULT_INDICATOR_LENGTH = 30;

/**
 * Colors reach this module as author-supplied strings and leave it inside an
 * attribute the Component injects with innerHTML, so anything that isn't
 * recognisably a plain color literal is dropped in favour of the default rather
 * than interpolated. Same posture as SecurityValidator's own allow-list style
 * checks — reject by shape, don't try to escape.
 *
 * Accepts: #rgb/#rgba/#rrggbb/#rrggbbaa, rgb()/rgba()/hsl()/hsla(), a bare CSS
 * color keyword, and var(--name, fallback) (widget CSS variables are how this
 * project's themed literals are authored today — see widgets.css).
 */
const COLOR_RE = /^(#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([\d\s.,%/]+\)|var\(--[\w-]+(?:\s*,\s*[^()"'<>;]+)?\)|[a-z]+)$/i;

function safeColor(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (!trimmed || !COLOR_RE.test(trimmed)) return fallback;
  return trimmed;
}

function safeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Trims float noise so a continuous gesture doesn't churn the markup with
 * 15 significant digits on every pointermove. */
function round(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Builds the Rotary Face markup for one configuration.
 * @param {object} [config] - see this file's header for the full shape
 * @returns {string} inline SVG markup
 */
export function buildRotaryFace(config = {}) {
  const angle = round(safeNumber(config.angle, 0));
  const faceColor = typeof config.faceColor === 'string' && config.faceColor.trim()
    ? safeColor(config.faceColor, null)
    : null;
  const rimColor = safeColor(config.rimColor, DEFAULT_RIM_COLOR);
  const indicatorColor = safeColor(config.indicatorColor, DEFAULT_INDICATOR_COLOR);

  // Clamped so an over-wide rim can't push the radius to zero or negative and
  // silently render a blank face.
  const rimWidth = Math.max(0, Math.min(VIEWBOX_SIZE, safeNumber(config.rimWidth, DEFAULT_RIM_WIDTH)));
  const indicatorWidth = Math.max(0, safeNumber(config.indicatorWidth, DEFAULT_INDICATOR_WIDTH));
  const indicatorLength = Math.max(0, safeNumber(config.indicatorLength, DEFAULT_INDICATOR_LENGTH));

  const radius = round(Math.max(1, CENTER - rimWidth / 2));
  // The pointer runs inward from just inside the rim. Clamped at the centre so a
  // very long indicator reads as "full radius", never as one crossing to the far side.
  const indicatorOuterY = round(CENTER - radius + rimWidth / 2);
  const indicatorInnerY = round(Math.min(CENTER, indicatorOuterY + indicatorLength));

  const parts = [];

  if (faceColor) {
    parts.push(
      `<circle data-face-group="fill" cx="${CENTER}" cy="${CENTER}" r="${radius}" fill="${faceColor}"/>`
    );
  }

  parts.push(
    `<circle data-face-group="rim" cx="${CENTER}" cy="${CENTER}" r="${radius}" fill="none"`
    + ` stroke="${rimColor}" stroke-width="${rimWidth}"/>`
  );

  parts.push(
    `<line data-face-group="indicator" x1="${CENTER}" y1="${indicatorOuterY}" x2="${CENTER}" y2="${indicatorInnerY}"`
    + ` stroke="${indicatorColor}" stroke-width="${indicatorWidth}" stroke-linecap="round"`
    + ` transform="rotate(${angle} ${CENTER} ${CENTER})"/>`
  );

  return `<svg class="fd-rotary-face-svg" viewBox="0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}"`
    + ` preserveAspectRatio="xMidYMid meet" focusable="false" aria-hidden="true">${parts.join('')}</svg>`;
}
