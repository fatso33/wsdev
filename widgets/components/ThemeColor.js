/**
 * ThemeColor.js
 * Derives a light-theme counterpart for a widget's literal authored hex colors.
 *
 * Widget colors (style.background.color, style.border.color, style.typography.color)
 * are authored once in Widget Studio as literal hex and written straight into inline
 * styles by BaseComponent.applyStyles() — they never reference the app's
 * [data-theme]-driven CSS custom properties, so the PWA's dark/light toggle has
 * historically had zero effect on custom widgets. themeAdjustColor() fixes that
 * without any new FDWS spec field or widget re-authoring: it infers a semantic role
 * (background/surface/border/text/accent) from context BaseComponent already has —
 * the color's own HSL saturation, the component's `type`, and its `layer.group` — and
 * remaps lightness/saturation in HSL space, preserving hue exactly. Gradient and image
 * backgrounds are left untouched; there's no safe generic transform for those.
 *
 * The per-role curves below are calibrated against Flight Deck's own hand-authored
 * light theme (flight-deck-pwa/css/main.css's `[data-theme="light"]` token block) —
 * running each dark chrome token through deriveVariant(hex, role, 'light') lands
 * within a few points of lightness of what a human designer actually picked for
 * backgrounds, borders, and primary text. Mid-lightness accents (e.g. a saturated
 * cyan or red) drift further; that's an inherent limit of an unsupervised transform,
 * not a bug — see FDWS v1.18's manual theme override for the escape hatch when an
 * author needs to eyeball and fix a bad conversion for one specific field.
 *
 * FDWS v1.18 also lets an author flip which theme is "authored" — style.* can be the
 * base for dark (the historical default) OR light, via the widget's own `baseTheme`
 * field. ROLE_CURVES_TO_DARK below is the mirror-image transform used whenever the
 * derivation direction runs light-authored -> dark-derived instead of the original
 * dark-authored -> light-derived. It's an algebraic mirror of ROLE_CURVES rather than
 * independently calibrated against a hand-authored dark palette (main.css's dark
 * tokens ARE the app chrome's actual dark palette, but there's no equivalent
 * "light widget, need a dark counterpart" reference set to calibrate against) — same
 * "good starting point, not gospel" posture as the light-derivation curves, and the
 * same manual-override escape hatch applies in either direction.
 *
 * Gradients (style.background.type: "gradient") get the same 'surface' treatment,
 * via themeAdjustGradient() below: every color token found inside the CSS gradient
 * string (hex or rgb()/rgba(), which is what Widget Studio's own gradient field
 * suggests and what real widgets use) is individually re-derived, and the gradient
 * syntax around it — function name, angle, stop percentages, alpha — is left exactly
 * as authored. A gradient's own alpha channel is preserved verbatim; only hue/
 * saturation/lightness move, same as everywhere else in this module.
 *
 * Every "fill" color (a component's own background, regardless of whether it's the
 * widget's root bezel, a content panel, a button, or an inset display) shares ONE
 * 'surface' curve rather than a role per component type. An earlier version split
 * these into background/surface/surface-raised/surface-well, picked by componentType
 * and layer.group — but a real widget (reported 2026-08-27: a collapsible COM1/COM2
 * radio panel) authors its content panel and several unrelated labels with the exact
 * same literal background hex on purpose, to look like one seamless surface. Splitting
 * by componentType made two IDENTICAL authored colors drift into two slightly
 * different derived lightnesses — the seam became visible as light-mode "squares."
 * See themeAdjustComponentColors() below for the other half of that same fix.
 */

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

function hexToRgb(hex) {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h.split('').map((c) => c + c).join('');
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16)
  };
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    switch (max) {
      case r: h = 60 * (((g - b) / d) % 6); break;
      case g: h = 60 * ((b - r) / d + 2); break;
      case b: h = 60 * ((r - g) / d + 4); break;
    }
  }
  if (h < 0) h += 360;
  return { h, s: s * 100, l: l * 100 };
}

function hexToHsl(hex) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHsl(r, g, b);
}

function rgbToHex(r, g, b) {
  const toHex = (v) => Math.round(v).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const toHex = (v) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// h/s/l in, {h,s,l} out — every curve preserves hue exactly and only moves
// lightness/saturation. Constants calibrated against main.css's real dark/light
// token pairs (see module doc comment above). Used when deriving LIGHT from a
// DARK-authored color (the historical/default direction).
const ROLE_CURVES = {
  surface: (h, s, l) => ({ h, s: s * 0.4, l: clamp(94 - l * 0.2, 88, 97) }),
  border: (h, s, l) => ({ h, s: s * 0.55, l: clamp(96 - l * 0.6, 65, 90) }),
  'text-primary': (h, s, l) => ({ h, s: s * 0.5, l: clamp(100 - l, 8, 18) }),
  'text-secondary': (h, s, l) => ({ h, s: s * 0.6, l: clamp(58 - (l - 50) * 0.3, 38, 52) }),
  accent: (h, s, l) => ({ h, s: clamp(s, 0, 100), l: clamp(l - 24, 20, 45) })
};

// FDWS v1.18: the mirror-image curve set, used when deriving DARK from a
// LIGHT-authored color (baseTheme: "light"). Algebraic mirror of ROLE_CURVES
// above — see the module doc comment for why this isn't independently
// calibrated the way the light-derivation curves are.
const ROLE_CURVES_TO_DARK = {
  surface: (h, s, l) => ({ h, s: clamp(s * 1.3, 0, 100), l: clamp(l * 0.16, 8, 20) }),
  border: (h, s, l) => ({ h, s: clamp(s * 1.2, 0, 100), l: clamp(l * 0.4, 20, 42) }),
  'text-primary': (h, s, l) => ({ h, s: clamp(s * 1.2, 0, 100), l: clamp(100 - l, 82, 96) }),
  'text-secondary': (h, s, l) => ({ h, s: clamp(s * 1.1, 0, 100), l: clamp(100 - l, 55, 72) }),
  accent: (h, s, l) => ({ h, s: clamp(s, 0, 100), l: clamp(l + 24, 45, 68) })
};

// A color's own saturation is what separates a purposeful accent (a frequency
// readout's green, a mode chip's cyan) from the desaturated slate tones used for
// structural chrome — vivid colors get the accent curve regardless of colorKind.
const ACCENT_SATURATION_THRESHOLD = 35;
const TEXT_PRIMARY_LIGHTNESS_THRESHOLD = 65;

/**
 * Infers which ROLE_CURVES entry a given authored color/context pair should use,
 * using only data BaseComponent already has at applyStyles() time — no new FDWS field.
 * @param {{h:number,s:number,l:number}} hsl
 * @param {{colorKind:'typography'|'border'|'background', componentType?:string, layerGroup?:string}} ctx
 * @returns {string}
 */
function inferColorRole(hsl, ctx) {
  const { colorKind } = ctx;
  const isVivid = hsl.s >= ACCENT_SATURATION_THRESHOLD;

  if (colorKind === 'typography') {
    if (isVivid) return 'accent';
    return hsl.l >= TEXT_PRIMARY_LIGHTNESS_THRESHOLD ? 'text-primary' : 'text-secondary';
  }
  if (colorKind === 'border') {
    return isVivid ? 'accent' : 'border';
  }
  // background — one neutral 'surface' treatment for every fill, regardless of
  // componentType/layerGroup (still accepted in ctx, just no longer branched on
  // here) — see the module doc comment for why.
  return 'surface';
}

const deriveCache = new Map();

/**
 * Pure hex-in/hex-out remap for a given role and target theme — memoized since
 * applyStyles() can re-resolve the same authored color across many component
 * instances.
 * @param {string} hex
 * @param {string} role
 * @param {'light'|'dark'} targetTheme - which direction to derive toward
 * @returns {string}
 */
function deriveVariant(hex, role, targetTheme) {
  const key = `${hex}|${role}|${targetTheme}`;
  const cached = deriveCache.get(key);
  if (cached) return cached;

  const { h, s, l } = hexToHsl(hex);
  const curves = targetTheme === 'light' ? ROLE_CURVES : ROLE_CURVES_TO_DARK;
  const curve = curves[role] || curves['text-secondary'];
  const out = curve(h, s, l);
  const result = hslToHex(out.h, clamp(out.s, 0, 100), clamp(out.l, 3, 98));
  deriveCache.set(key, result);
  return result;
}

/** Back-compat/explicit wrapper: derive a color's light counterpart. */
export function deriveLightVariant(hex, role) {
  return deriveVariant(hex, role, 'light');
}

/** FDWS v1.18: derive a color's dark counterpart (mirror of deriveLightVariant). */
export function deriveDarkVariant(hex, role) {
  return deriveVariant(hex, role, 'dark');
}

/**
 * Theme-adjusts one authored color. Returns `hex` unchanged when `theme` equals
 * `baseTheme` (the theme it was literally authored for — no derivation needed),
 * when `hex` is falsy, or when it isn't a literal `#rgb`/`#rrggbb` string (a
 * gradient, `transparent`, or a CSS var() fallback passes straight through —
 * there's no safe generic transform for those).
 * @param {string|undefined|null} hex
 * @param {{colorKind:'typography'|'border'|'background', componentType?:string, layerGroup?:string}} ctx
 * @param {string} theme - the theme being RENDERED: 'dark' | 'light'
 * @param {string} [baseTheme='dark'] - FDWS v1.18: the theme `hex` was AUTHORED for
 * @returns {string|undefined|null}
 */
export function themeAdjustColor(hex, ctx, theme, baseTheme = 'dark') {
  if (theme === baseTheme || typeof hex !== 'string' || !HEX_RE.test(hex)) return hex;
  const role = inferColorRole(hexToHsl(hex), ctx);
  return deriveVariant(hex, role, theme);
}

/**
 * Theme-adjusts one component's typography/border/background colors TOGETHER,
 * instead of independently — the other half of the surface-unification fix above.
 * An author can also intentionally set typography.color (or border.color) to the
 * EXACT same literal hex as that same component's OWN background.color — a common
 * trick to hide leftover placeholder text, or to make a border blend flush into its
 * own fill. themeAdjustColor() alone would still break that: text/border and
 * background get different role curves on purpose (text needs to stay legible
 * against a surface, a border needs to read as an outline), so two identical
 * authored colors can diverge into two different derived ones — text that was
 * invisible-by-design becomes visible. This resolves background first, then reuses
 * ITS derived output for border/typography whenever their raw value exactly matches
 * the raw background (or, for typography, the raw border) — so the match survives.
 * @param {{typographyColor?: string|null, borderColor?: string|null, backgroundColor?: string|null}} raw
 * @param {{componentType?: string, layerGroup?: string}} ctx
 * @param {string} theme - the theme being RENDERED: 'dark' | 'light'
 * @param {string} [baseTheme='dark'] - FDWS v1.18: the theme `raw` was AUTHORED for
 * @returns {{typographyColor: string|null|undefined, borderColor: string|null|undefined, backgroundColor: string|null|undefined}}
 */
export function themeAdjustComponentColors(raw, ctx, theme, baseTheme = 'dark') {
  const { typographyColor, borderColor, backgroundColor } = raw;
  if (theme === baseTheme) return { typographyColor, borderColor, backgroundColor };

  const isHex = (v) => typeof v === 'string' && HEX_RE.test(v);
  const backgroundOut = themeAdjustColor(backgroundColor, { ...ctx, colorKind: 'background' }, theme, baseTheme);
  const borderOut = isHex(borderColor) && borderColor === backgroundColor
    ? backgroundOut
    : themeAdjustColor(borderColor, { ...ctx, colorKind: 'border' }, theme, baseTheme);

  let typographyOut;
  if (isHex(typographyColor) && typographyColor === backgroundColor) {
    typographyOut = backgroundOut;
  } else if (isHex(typographyColor) && typographyColor === borderColor) {
    typographyOut = borderOut;
  } else {
    typographyOut = themeAdjustColor(typographyColor, { ...ctx, colorKind: 'typography' }, theme, baseTheme);
  }

  return { typographyColor: typographyOut, borderColor: borderOut, backgroundColor: backgroundOut };
}

// Matches a hex color (3/4/6/8-digit, the 4/8-digit forms carrying an alpha nibble/byte)
// or an rgb()/rgba() function — the two color formats Widget Studio's own gradient
// field suggests as defaults and that real authored gradients use. hsl()/hsla() and
// named colors ("steelblue") aren't matched and pass through unchanged.
const GRADIENT_COLOR_TOKEN_RE = /#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi;

function parseGradientColorToken(token) {
  if (token[0] === '#') {
    let h = token.slice(1);
    let alphaSuffix = '';
    if (h.length === 4) { alphaSuffix = h[3] + h[3]; h = h.slice(0, 3); }
    else if (h.length === 8) { alphaSuffix = h.slice(6, 8); h = h.slice(0, 6); }
    if (h.length !== 3 && h.length !== 6) return null;
    const { r, g, b } = hexToRgb(`#${h}`);
    return { r, g, b, isHex: true, alphaSuffix };
  }
  const m = token.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/i);
  if (!m) return null;
  return { r: parseFloat(m[1]), g: parseFloat(m[2]), b: parseFloat(m[3]), isHex: false, alpha: m[4] };
}

function serializeGradientColor(rgb, parsed) {
  if (parsed.isHex) {
    return rgbToHex(rgb.r, rgb.g, rgb.b) + parsed.alphaSuffix;
  }
  if (parsed.alpha !== undefined) {
    return `rgba(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)}, ${parsed.alpha})`;
  }
  return `rgb(${Math.round(rgb.r)}, ${Math.round(rgb.g)}, ${Math.round(rgb.b)})`;
}

/**
 * Theme-adjusts every color stop inside a CSS gradient string (linear-gradient,
 * radial-gradient, conic-gradient — any function works, since this only touches the
 * color tokens inside it and leaves the rest of the string untouched). Each stop is
 * treated as a 'surface' color, same role a solid style.background.color would get,
 * since a gradient IS that component's background. Alpha is preserved verbatim.
 * @param {string|undefined|null} gradient
 * @param {{componentType?: string, layerGroup?: string}} ctx
 * @param {string} theme - the theme being RENDERED: 'dark' | 'light'
 * @param {string} [baseTheme='dark'] - FDWS v1.18: the theme `gradient` was AUTHORED for
 * @returns {string|undefined|null}
 */
export function themeAdjustGradient(gradient, ctx, theme, baseTheme = 'dark') {
  if (theme === baseTheme || typeof gradient !== 'string') return gradient;
  return gradient.replace(GRADIENT_COLOR_TOKEN_RE, (token) => {
    const parsed = parseGradientColorToken(token);
    if (!parsed) return token;
    const derivedHex = themeAdjustColor(rgbToHex(parsed.r, parsed.g, parsed.b), { ...ctx, colorKind: 'background' }, theme, baseTheme);
    return serializeGradientColor(hexToRgb(derivedHex), parsed);
  });
}

/**
 * FDWS v1.18: resolves ONE authored color for rendering, honoring a manual
 * per-theme override when the widget opts out of auto-derivation for it.
 * - Rendering the base/authored theme: always the literal raw value (an override
 *   only ever applies to the NON-base theme — the base theme's `style.*` IS the
 *   authored value, there's nothing to override).
 * - Rendering the other theme in "manual" mode with an override present: the
 *   override, verbatim, no derivation.
 * - Otherwise (auto mode, or manual mode with no override for this field): the
 *   same HSL-derived value as always.
 * @param {string|undefined|null} rawHex
 * @param {string|undefined|null} overrideHex
 * @param {{colorKind:'typography'|'border'|'background', componentType?:string, layerGroup?:string}} ctx
 * @param {string} renderTheme - 'dark' | 'light'
 * @param {string} baseTheme - 'dark' | 'light'
 * @param {'auto'|'manual'} themeMode
 * @returns {string|undefined|null}
 */
export function resolveThemedColor(rawHex, overrideHex, ctx, renderTheme, baseTheme, themeMode) {
  if (renderTheme === baseTheme) return rawHex;
  if (themeMode === 'manual' && overrideHex) return overrideHex;
  return themeAdjustColor(rawHex, ctx, renderTheme, baseTheme);
}

/**
 * FDWS v1.18: the typography+border sibling of resolveThemedColor() — kept as a
 * bundle (rather than two resolveThemedColor() calls) so the exact-match
 * preservation trick in themeAdjustComponentColors() still works for whichever
 * of the two fields DOESN'T have its own manual override.
 * @param {{typographyColor?: string|null, borderColor?: string|null, backgroundColor?: string|null}} raw
 *   backgroundColor is only used internally, for the exact-match check — see themeAdjustComponentColors().
 * @param {{typographyColor?: string|null, borderColor?: string|null}} overrides
 * @param {{componentType?: string, layerGroup?: string}} ctx
 * @param {string} renderTheme
 * @param {string} baseTheme
 * @param {'auto'|'manual'} themeMode
 * @returns {{typographyColor: string|null|undefined, borderColor: string|null|undefined}}
 */
export function resolveThemedColors(raw, overrides, ctx, renderTheme, baseTheme, themeMode) {
  if (renderTheme === baseTheme) {
    return { typographyColor: raw.typographyColor, borderColor: raw.borderColor };
  }
  const auto = themeAdjustComponentColors(raw, ctx, renderTheme, baseTheme);
  if (themeMode !== 'manual') {
    return { typographyColor: auto.typographyColor, borderColor: auto.borderColor };
  }
  const ov = overrides || {};
  return {
    typographyColor: ov.typographyColor != null ? ov.typographyColor : auto.typographyColor,
    borderColor: ov.borderColor != null ? ov.borderColor : auto.borderColor
  };
}

/**
 * FDWS v1.18: resolves a component's full `background` descriptor for rendering,
 * honoring a manual override (which, unlike the color fields, replaces the WHOLE
 * background object — a gradient override can't be merged field-by-field with a
 * solid-color raw background). An 'image' background is never derived and never
 * overridden by this path (still opt-outable per FDWS v1.18 by authoring a manual
 * `type: "color"`/`type: "gradient"` override, same as any other background type).
 * @param {{type?: string, color?: string, gradient?: string, image?: object}|undefined} rawBg
 * @param {object|undefined} overrideBg - same shape as rawBg
 * @param {{componentType?: string, layerGroup?: string}} ctx
 * @param {string} renderTheme
 * @param {string} baseTheme
 * @param {'auto'|'manual'} themeMode
 * @returns {object|undefined}
 */
export function resolveThemedBackground(rawBg, overrideBg, ctx, renderTheme, baseTheme, themeMode) {
  if (!rawBg) return rawBg;
  if (renderTheme === baseTheme) return rawBg;
  if (themeMode === 'manual' && overrideBg) return overrideBg;
  if (rawBg.type === 'color' && rawBg.color) {
    return { ...rawBg, color: themeAdjustColor(rawBg.color, { ...ctx, colorKind: 'background' }, renderTheme, baseTheme) };
  }
  if (rawBg.type === 'gradient' && rawBg.gradient) {
    return { ...rawBg, gradient: themeAdjustGradient(rawBg.gradient, ctx, renderTheme, baseTheme) };
  }
  return rawBg;
}
