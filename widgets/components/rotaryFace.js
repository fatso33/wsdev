/**
 * rotaryFace.js
 *
 * Pure Face generator for the Rotary component family: configuration in, inline vector
 * markup out. No DOM, no component instance, no reads of ambient state — the Component
 * owns the wrapper element and the gesture; this owns nothing but the picture inside it.
 *
 * Rendering is deliberately hybrid: the Component's own outer container stays a DOM
 * node, so the existing style cascade / theming / state styles / conditional rules all
 * keep working on it unchanged, and only the knob Face itself is generated markup.
 *
 * The Face carries no pixel size. It is drawn on a fixed 0 0 100 100 viewBox and scales
 * into whatever box the Author's layout gave the Component, which is what lets the
 * Component size to its layout space instead of a fixed pixel size. Every length below
 * is in viewBox units.
 *
 * Nothing here uses `id`, `<defs>`, `<clipPath>` or a CSS filter. An id would be shared
 * by every Rotary drawn into one document and would stop resolving if the instance that
 * defined it were hidden, and Safari does not apply CSS filters to SVG children. So the
 * gradients, glow and shadows are all stacks of plain shapes.
 *
 * Six groups, each marked `data-face-group="<name>"` so tests (and the canvas
 * thumbnail's own assertions) can address a group rather than one opaque blob. Drawn
 * back to front:
 *   depth      the drop shadow beneath the knob
 *   fill       the disc: solid, or a linear / radial / conic blend of two colours
 *   inset      the inner shadow: darkening rings just inside the rim
 *   rim        the ring around the edge
 *   knurling   grip marks in a band just inside the rim; turns with the Face
 *   scale      graduations around the knob; static, like the bezel it stands for
 *   indicator  the pointer that shows the value; turns with the Face
 *   cap        the static centre: a disc, optionally with a label or icon
 *
 * ---------------------------------------------------------------------------
 * config (every key optional):
 *   angle: number             rotation of the indicator and knurling, degrees clockwise
 *                             from straight up (12 o'clock). The Component maps the
 *                             engine's 0..sweep angle onto this; the Face itself knows
 *                             nothing about value ranges or sweeps.
 *
 *   Face
 *   fillStyle: string         'solid' (default) | 'linear' | 'radial' | 'conic'
 *   faceColor: string         disc fill / first blend colour. With a solid fill it is
 *                             omitted entirely when unset, so an authored
 *                             style.background on the Face wrapper shows through
 *                             instead of being covered by an opaque disc.
 *   faceColor2: string        second blend colour, for a non-solid fill
 *   rimColor: string          rim colour; also the colour of the knurling
 *   rimWidth: number          rim thickness
 *   innerShadow: number       depth of the inner shadow; 0 or unset draws none
 *
 *   Knurling
 *   knurlStyle: string        'none' (default) | 'grooves' | 'teeth' | 'dots'
 *   knurlCount: number        marks around the circumference
 *   knurlDepth: number        how far the band reaches inward from the rim
 *
 *   Indicator
 *   indicatorShape: string    'line' (default) | 'dot' | 'triangle'
 *   indicatorColor: string    pointer colour
 *   indicatorWidth: number    line thickness, dot radius, or triangle half-width
 *   indicatorLength: number   pointer length inward from the rim (line and triangle)
 *   indicatorGlow: number     spread of the glow behind the pointer; 0 or unset is none
 *
 *   Cap
 *   capDiameter: number       0 or unset draws no cap
 *   capColor: string          cap disc colour
 *   capLabel: string          short text in the cap
 *   capIcon: string           a glyph in the cap; wins over capLabel when both are set
 *                             (the Component passes only the one the Author chose)
 *
 *   Scale
 *   scaleMajorDivisions: number   intervals between major marks; 0 or unset draws no scale
 *   scaleMinorDivisions: number   intervals each major interval is split into (1 = none)
 *   scaleTickLength: number       length of a major mark; minor marks are 60% of it
 *   scaleLabels: string[]         one label per major mark, outside the marks
 *   scaleStartAngle: number       where the first mark sits, degrees clockwise from 12
 *   scaleSpan: number             degrees the marks cover; 360 or more is a full circle
 *   scaleColor: string            mark and label colour
 *
 *   Depth
 *   dropShadow: number        size of the drop shadow; 0 or unset draws none
 * ---------------------------------------------------------------------------
 */

const VIEWBOX_SIZE = 100;
const CENTER = VIEWBOX_SIZE / 2;

/**
 * Fallbacks applied when a colour or size is unset. Exported so the caller that resolves
 * theme-adjusted colours can adjust the defaults too, rather than only the authored ones.
 * @type {Readonly<Record<string, string|number>>}
 */
export const ROTARY_FACE_DEFAULTS = Object.freeze({
  rimColor: '#64748b',
  rimWidth: 6,
  indicatorColor: '#e2e8f0',
  indicatorWidth: 6,
  indicatorLength: 30,
  blendColor: '#94a3b8',
  blendColor2: '#1e293b',
  capColor: '#334155',
  scaleColor: '#94a3b8',
  scaleTickLength: 6,
  knurlCount: 24,
  knurlDepth: 5
});

const DEFAULT_SCALE_SPAN = 270;

const FILL_STYLES = ['solid', 'linear', 'radial', 'conic'];
const KNURL_STYLES = ['grooves', 'teeth', 'dots'];
const INDICATOR_SHAPES = ['line', 'dot', 'triangle'];

const MAX_KNURL_MARKS = 120;
const MAX_SCALE_MAJOR = 60;
const MAX_SCALE_MINOR = 20;
const MAX_DROP_SHADOW = 15;
const MAX_TICK_LENGTH = 20;
const MIN_KNOB_RADIUS = 12;

// Stack sizes. A gradient is drawn as opaque layers painted over one another, so each
// layer is a step of colour; more layers is smoother and more markup.
const LINEAR_STEPS = 24;
const RADIAL_STEPS = 20;
const CONIC_WEDGES = 72;
// Each conic wedge runs this far into the next one, which paints over the overlap, so
// anti-aliasing at a shared edge blends two opaque colours instead of exposing what is
// underneath.
const CONIC_OVERLAP_DEGREES = 0.8;
// A conic fill has two highlights, the way brushed metal catches a light from either
// side. The colour peaks at CONIC_HIGHLIGHT_DEGREES and again half a turn later.
const CONIC_HIGHLIGHT_DEGREES = 45;

const INSET_RINGS = 5;
const INSET_PEAK_OPACITY = 0.34;
const SHADOW_LAYERS = 5;
const SHADOW_LAYER_OPACITY = 0.1;

const LABEL_RESERVE = 9;
const LABEL_FONT_SIZE = 5.5;
const MAX_TEXT_LENGTH = 12;

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

function safeChoice(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

/** Trims float noise so a continuous gesture doesn't churn the markup with
 * 15 significant digits on every pointermove. */
function round(value) {
  return Math.round(value * 100) / 100;
}

/**
 * Text reaches the markup as an element's content, so the characters that could open a
 * tag or an entity are escaped rather than rejected — a label is free text where a
 * colour is a closed vocabulary.
 */
function escapeText(value) {
  return String(value)
    .slice(0, MAX_TEXT_LENGTH)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * A point at `radius` from the centre, `degrees` clockwise from straight up.
 * @returns {{x: number, y: number}} in viewBox units
 */
function polar(radius, degrees) {
  const rad = (degrees * Math.PI) / 180;
  return { x: round(CENTER + radius * Math.sin(rad)), y: round(CENTER - radius * Math.cos(rad)) };
}

/**
 * Reads a colour literal into channels, or null when it is not one this module can blend.
 * Blending needs numbers, so a keyword, hsl() or var() colour is not parsed here; a
 * gradient that includes one falls back to a solid fill rather than guessing.
 * @returns {{r: number, g: number, b: number, a: number}|null}
 */
function parseColor(text) {
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text);
  if (hex) {
    let digits = hex[1];
    if (digits.length <= 4) digits = digits.split('').map((c) => c + c).join('');
    const channel = (i) => parseInt(digits.slice(i, i + 2), 16);
    return { r: channel(0), g: channel(2), b: channel(4), a: digits.length === 8 ? channel(6) / 255 : 1 };
  }
  const fn = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(text);
  if (fn) {
    return { r: Number(fn[1]), g: Number(fn[2]), b: Number(fn[3]), a: fn[4] === undefined ? 1 : Number(fn[4]) };
  }
  return null;
}

function mixColors(from, to, t) {
  const at = (a, b) => Math.round(a + (b - a) * t);
  const alpha = round(from.a + (to.a - from.a) * t);
  const rgb = `${at(from.r, to.r)}, ${at(from.g, to.g)}, ${at(from.b, to.b)}`;
  return alpha >= 1 ? `rgb(${rgb})` : `rgba(${rgb}, ${alpha})`;
}

/**
 * The disc, drawn as opaque layers painted over one another. Returns null when a
 * non-solid fill cannot be built (an unblendable colour), so the caller can fall back.
 */
function buildBlendedFill(style, from, to, radius) {
  const layers = [];
  if (style === 'linear') {
    // Each layer is the part of the disc at or below a horizontal line, so a later layer
    // paints over the bottom of an earlier one and the colour steps down the disc.
    layers.push(`<circle cx="${CENTER}" cy="${CENTER}" r="${radius}" fill="${mixColors(from, to, 0)}"/>`);
    for (let k = 1; k < LINEAR_STEPS; k++) {
      const y = CENTER - radius + (2 * radius * k) / LINEAR_STEPS;
      const half = Math.sqrt(Math.max(0, radius * radius - (y - CENTER) ** 2));
      // The part of the disc below the line is the larger arc while the line is above centre.
      const largeArc = y < CENTER ? 1 : 0;
      layers.push(
        `<path d="M${round(CENTER - half)} ${round(y)}A${radius} ${radius} 0 ${largeArc} 0 ${round(CENTER + half)} ${round(y)}Z"`
        + ` fill="${mixColors(from, to, k / (LINEAR_STEPS - 1))}"/>`
      );
    }
    return layers.join('');
  }
  if (style === 'radial') {
    for (let k = 0; k < RADIAL_STEPS; k++) {
      layers.push(
        `<circle cx="${CENTER}" cy="${CENTER}" r="${round(radius * (1 - k / RADIAL_STEPS))}"`
        + ` fill="${mixColors(from, to, k / (RADIAL_STEPS - 1))}"/>`
      );
    }
    return layers.join('');
  }
  // Conic. Colour follows (1 + cos(2 * (theta - highlight))) / 2: two lobes around the circle.
  const step = 360 / CONIC_WEDGES;
  for (let k = 0; k < CONIC_WEDGES; k++) {
    const start = k * step;
    const middle = start + step / 2;
    const t = (1 + Math.cos((2 * (middle - CONIC_HIGHLIGHT_DEGREES) * Math.PI) / 180)) / 2;
    const a = polar(radius, start);
    const b = polar(radius, start + step + CONIC_OVERLAP_DEGREES);
    layers.push(
      `<path d="M${CENTER} ${CENTER}L${a.x} ${a.y}A${radius} ${radius} 0 0 1 ${b.x} ${b.y}Z" fill="${mixColors(from, to, t)}"/>`
    );
  }
  return layers.join('');
}

/**
 * The fill group. A solid fill is one circle, and is omitted when no colour is set so a
 * background authored on the Face wrapper shows through. A blended fill always draws:
 * choosing one is the Author asking for a disc, so unset colours take the defaults.
 */
function buildFill(config, radius) {
  const style = safeChoice(config.fillStyle, FILL_STYLES, 'solid');
  const authored = typeof config.faceColor === 'string' && config.faceColor.trim()
    ? safeColor(config.faceColor, null)
    : null;
  if (style === 'solid') {
    return authored
      ? `<circle data-face-group="fill" cx="${CENTER}" cy="${CENTER}" r="${radius}" fill="${authored}"/>`
      : '';
  }
  const first = authored || ROTARY_FACE_DEFAULTS.blendColor;
  const second = safeColor(config.faceColor2, ROTARY_FACE_DEFAULTS.blendColor2);
  const from = parseColor(first);
  const to = parseColor(second);
  if (!from || !to) {
    return `<circle data-face-group="fill" cx="${CENTER}" cy="${CENTER}" r="${radius}" fill="${first}"/>`;
  }
  return `<g data-face-group="fill">${buildBlendedFill(style, from, to, radius)}</g>`;
}

/**
 * The inner shadow: rings just inside the rim, darkest at the rim and fading inward.
 * Rings rather than a gradient so it needs no id (see the file header).
 */
function buildInnerShadow(depth, rimInner) {
  const size = clamp(depth, 0, rimInner);
  if (size <= 0) return '';
  const width = size / INSET_RINGS;
  const rings = [];
  for (let k = 0; k < INSET_RINGS; k++) {
    const opacity = round(INSET_PEAK_OPACITY * (1 - k / INSET_RINGS));
    rings.push(
      `<circle cx="${CENTER}" cy="${CENTER}" r="${round(rimInner - (k + 0.5) * width)}" fill="none"`
      + ` stroke="#000" stroke-width="${round(width)}" stroke-opacity="${opacity}"/>`
    );
  }
  return `<g data-face-group="inset">${rings.join('')}</g>`;
}

/**
 * Grip marks in a band of `depth` just inside the rim, in the rim's colour. The whole
 * group turns with the Face, so a knurled knob visibly turns even with no pointer.
 */
function buildKnurling(config, rimInner, rimColor, angle) {
  const style = safeChoice(config.knurlStyle, KNURL_STYLES, null);
  if (!style || rimInner < 4) return '';
  const count = clamp(Math.round(safeNumber(config.knurlCount, ROTARY_FACE_DEFAULTS.knurlCount)), 3, MAX_KNURL_MARKS);
  const depth = clamp(safeNumber(config.knurlDepth, ROTARY_FACE_DEFAULTS.knurlDepth), 0.5, Math.max(0.5, rimInner - 2));
  const outer = rimInner;
  const inner = round(rimInner - depth);
  const turn = `transform="rotate(${angle} ${CENTER} ${CENTER})"`;

  if (style === 'grooves') {
    const stroke = round(clamp((2 * Math.PI * outer) / count * 0.3, 0.4, 1.5));
    const marks = [];
    for (let i = 0; i < count; i++) {
      const a = (360 * i) / count;
      const p0 = polar(outer, a);
      const p1 = polar(inner, a);
      marks.push(`M${p0.x} ${p0.y}L${p1.x} ${p1.y}`);
    }
    return `<g data-face-group="knurling" ${turn}><path d="${marks.join('')}" fill="none" stroke="${rimColor}" stroke-width="${stroke}"/></g>`;
  }
  if (style === 'teeth') {
    // A tooth is a triangle whose base is on the rim's inner edge and whose tip points inward.
    const half = (360 / count) * 0.45;
    const teeth = [];
    for (let i = 0; i < count; i++) {
      const a = (360 * i) / count;
      const b0 = polar(outer, a - half);
      const b1 = polar(outer, a + half);
      const tip = polar(inner, a);
      teeth.push(`M${b0.x} ${b0.y}L${b1.x} ${b1.y}L${tip.x} ${tip.y}Z`);
    }
    return `<g data-face-group="knurling" ${turn}><path d="${teeth.join('')}" fill="${rimColor}"/></g>`;
  }
  const middle = (outer + inner) / 2;
  const dotRadius = round(Math.min(depth / 2, ((2 * Math.PI * middle) / count) / 3));
  const dots = [];
  for (let i = 0; i < count; i++) {
    const p = polar(middle, (360 * i) / count);
    dots.push(`<circle cx="${p.x}" cy="${p.y}" r="${dotRadius}"/>`);
  }
  return `<g data-face-group="knurling" ${turn} fill="${rimColor}">${dots.join('')}</g>`;
}

/**
 * One drawn copy of the pointer. `spread` fattens it for a glow layer: a line by its
 * stroke width, a filled shape by an outline in the same colour.
 */
function pointerElement(shape, geometry, color, spread, extra) {
  const { outerY, innerY, width } = geometry;
  if (shape === 'dot') {
    const radius = Math.max(0.5, width);
    const cy = round(outerY + radius + 1);
    const outline = spread ? ` stroke="${color}" stroke-width="${round(spread)}"` : '';
    return `<circle${extra.lead} cx="${CENTER}" cy="${cy}" r="${round(radius)}" fill="${color}"${outline}${extra.tail}/>`;
  }
  if (shape === 'triangle') {
    const points = `${round(CENTER - width)},${outerY} ${round(CENTER + width)},${outerY} ${CENTER},${innerY}`;
    const outline = spread ? ` stroke="${color}" stroke-width="${round(spread)}" stroke-linejoin="round"` : '';
    return `<polygon${extra.lead} points="${points}" fill="${color}"${outline}${extra.tail}/>`;
  }
  return `<line${extra.lead} x1="${CENTER}" y1="${outerY}" x2="${CENTER}" y2="${innerY}"`
    + ` stroke="${color}" stroke-width="${round(width + spread)}" stroke-linecap="round"${extra.tail}/>`;
}

/**
 * The pointer. With no glow it is a single element carrying its own rotation; with a
 * glow it is one group holding wider, fainter copies beneath the crisp shape.
 */
function buildIndicator(config, rimInner, angle) {
  const shape = safeChoice(config.indicatorShape, INDICATOR_SHAPES, 'line');
  const color = safeColor(config.indicatorColor, ROTARY_FACE_DEFAULTS.indicatorColor);
  const width = Math.max(0, safeNumber(config.indicatorWidth, ROTARY_FACE_DEFAULTS.indicatorWidth));
  const length = Math.max(0, safeNumber(config.indicatorLength, ROTARY_FACE_DEFAULTS.indicatorLength));
  const glow = clamp(safeNumber(config.indicatorGlow, 0), 0, 20);

  // The pointer runs inward from the rim's inner edge. Clamped at the centre so a very
  // long indicator reads as "full radius", never as one crossing to the far side.
  const outerY = round(CENTER - rimInner);
  const innerY = round(Math.min(CENTER, outerY + length));
  const geometry = { outerY, innerY, width };
  const turn = `transform="rotate(${angle} ${CENTER} ${CENTER})"`;

  if (glow <= 0) {
    return pointerElement(shape, geometry, color, 0, {
      lead: ' data-face-group="indicator"',
      tail: ` ${turn}`
    });
  }
  const copies = [];
  const layers = 3;
  for (let k = layers; k >= 1; k--) {
    copies.push(pointerElement(shape, geometry, color, (2 * glow * k) / layers, {
      lead: '',
      tail: ' opacity="0.18"'
    }));
  }
  copies.push(pointerElement(shape, geometry, color, 0, { lead: '', tail: '' }));
  return `<g data-face-group="indicator" ${turn}>${copies.join('')}</g>`;
}

/**
 * The static centre. Its text is filled with `currentColor`, so it takes the Component's
 * own authored text colour — and with it the widget's light/dark theme — instead of a
 * separate colour property.
 */
function buildCap(config, rimInner) {
  const diameter = safeNumber(config.capDiameter, 0);
  if (!(diameter > 0)) return '';
  const radius = round(clamp(diameter / 2, 1, Math.max(1, rimInner - 1)));
  const color = safeColor(config.capColor, ROTARY_FACE_DEFAULTS.capColor);
  const icon = typeof config.capIcon === 'string' ? config.capIcon.trim() : '';
  const label = typeof config.capLabel === 'string' ? config.capLabel.trim() : '';
  let text = '';
  if (icon || label) {
    const content = icon || label;
    const shown = content.slice(0, MAX_TEXT_LENGTH);
    // A glyph fills most of the cap; a label is fitted to its width, at about 0.6em per character.
    const fontSize = icon
      ? round(radius * 1.1)
      : round(Math.min(radius * 0.8, (radius * 1.7) / (0.6 * Math.max(1, shown.length))));
    text = `<text x="${CENTER}" y="${CENTER}" text-anchor="middle" dominant-baseline="central"`
      + ` font-size="${fontSize}" fill="currentColor">${escapeText(shown)}</text>`;
  }
  return `<g data-face-group="cap"><circle cx="${CENTER}" cy="${CENTER}" r="${radius}" fill="${color}"`
    + ` stroke="#000" stroke-opacity="0.35" stroke-width="0.8"/>${text}</g>`;
}

/**
 * How much of the viewBox the scale claims: the outer radius of its marks, the inner
 * radius of its major marks, and the marks themselves once built. Computed before the
 * knob so the knob can shrink to leave room for it.
 */
function planScale(config) {
  const majors = clamp(Math.round(safeNumber(config.scaleMajorDivisions, 0)), 0, MAX_SCALE_MAJOR);
  if (majors < 1) return null;
  const minors = clamp(Math.round(safeNumber(config.scaleMinorDivisions, 1)), 1, MAX_SCALE_MINOR);
  const majorLength = clamp(safeNumber(config.scaleTickLength, ROTARY_FACE_DEFAULTS.scaleTickLength), 1, MAX_TICK_LENGTH);
  const labels = Array.isArray(config.scaleLabels) ? config.scaleLabels : [];
  const tickOuter = CENTER - 1 - (labels.length ? LABEL_RESERVE : 0);
  return { majors, minors, majorLength, labels, tickOuter, tickInner: tickOuter - majorLength };
}

function buildScale(config, plan) {
  const { majors, minors, majorLength, labels, tickOuter } = plan;
  const color = safeColor(config.scaleColor, ROTARY_FACE_DEFAULTS.scaleColor);
  const start = safeNumber(config.scaleStartAngle, -DEFAULT_SCALE_SPAN / 2);
  const span = clamp(safeNumber(config.scaleSpan, DEFAULT_SCALE_SPAN), 1, 360);
  const intervals = majors * minors;
  // An arc has a mark at both ends; a full circle would draw its first mark twice.
  const marks = span >= 360 ? intervals : intervals + 1;
  const minorLength = majorLength * 0.6;

  const major = [];
  const minor = [];
  const texts = [];
  for (let i = 0; i < marks; i++) {
    const angle = start + (span * i) / intervals;
    const isMajor = i % minors === 0;
    const p0 = polar(tickOuter, angle);
    const p1 = polar(tickOuter - (isMajor ? majorLength : minorLength), angle);
    (isMajor ? major : minor).push(`M${p0.x} ${p0.y}L${p1.x} ${p1.y}`);
    const label = isMajor ? labels[i / minors] : undefined;
    if (label !== undefined && label !== null && String(label) !== '') {
      const at = polar(tickOuter + LABEL_RESERVE / 2, angle);
      texts.push(
        `<text x="${at.x}" y="${at.y}" text-anchor="middle" dominant-baseline="central"`
        + ` font-size="${LABEL_FONT_SIZE}" fill="${color}">${escapeText(label)}</text>`
      );
    }
  }
  const parts = [];
  if (major.length) parts.push(`<path data-tick="major" d="${major.join('')}" fill="none" stroke="${color}" stroke-width="1.2"/>`);
  if (minor.length) parts.push(`<path data-tick="minor" d="${minor.join('')}" fill="none" stroke="${color}" stroke-width="0.7"/>`);
  return `<g data-face-group="scale">${parts.join('')}${texts.join('')}</g>`;
}

/**
 * The drop shadow: stacked, offset, translucent discs. The knob has already shrunk by
 * `size` so the shadow's full extent stays inside the viewBox.
 */
function buildDropShadow(size, knobRadius) {
  if (size <= 0) return '';
  const offset = size * 0.4;
  const discs = [];
  for (let k = 0; k < SHADOW_LAYERS; k++) {
    const radius = round(knobRadius + size * 0.6 * (1 - k / SHADOW_LAYERS));
    discs.push(`<circle cx="${CENTER}" cy="${round(CENTER + offset)}" r="${radius}" fill-opacity="${SHADOW_LAYER_OPACITY}"/>`);
  }
  return `<g data-face-group="depth" fill="#000">${discs.join('')}</g>`;
}

/**
 * Builds the Rotary Face markup for one configuration.
 * @param {object} [config] - see this file's header for the full shape
 * @returns {string} inline SVG markup
 */
export function buildRotaryFace(config = {}) {
  const angle = round(safeNumber(config.angle, 0));
  const rimColor = safeColor(config.rimColor, ROTARY_FACE_DEFAULTS.rimColor);

  const scale = planScale(config);
  const shadowSize = clamp(safeNumber(config.dropShadow, 0), 0, MAX_DROP_SHADOW);
  // The knob gives up space to the scale outside it and to its own shadow, in that order.
  const available = scale ? scale.tickInner - 2 : CENTER;
  const knobRadius = Math.max(MIN_KNOB_RADIUS, available - shadowSize);

  // Clamped so an over-wide rim can't push the radius to zero or negative and
  // silently render a blank face.
  const rimWidth = clamp(safeNumber(config.rimWidth, ROTARY_FACE_DEFAULTS.rimWidth), 0, knobRadius);
  const rimCenter = round(Math.max(1, knobRadius - rimWidth / 2));
  const rimInner = Math.max(0, knobRadius - rimWidth);

  const parts = [
    buildDropShadow(shadowSize, knobRadius),
    buildFill(config, rimCenter),
    buildInnerShadow(safeNumber(config.innerShadow, 0), rimInner),
    `<circle data-face-group="rim" cx="${CENTER}" cy="${CENTER}" r="${rimCenter}" fill="none"`
      + ` stroke="${rimColor}" stroke-width="${round(rimWidth)}"/>`,
    buildKnurling(config, rimInner, rimColor, angle),
    scale ? buildScale(config, scale) : '',
    buildIndicator(config, rimInner, angle),
    buildCap(config, rimInner)
  ];

  return `<svg class="fd-rotary-face-svg" viewBox="0 0 ${VIEWBOX_SIZE} ${VIEWBOX_SIZE}"`
    + ` preserveAspectRatio="xMidYMid meet" focusable="false" aria-hidden="true">${parts.join('')}</svg>`;
}
