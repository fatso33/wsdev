/**
 * ColorPickerLogic.js
 * Pure hex/HSV conversion + parsing helpers for ColorPickerPopover.js, kept
 * dependency-free (no DOM) so they're directly unit-testable.
 */

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** A short set of common panel colors shown as one-click swatches. */
export const PRESET_SWATCHES = [
  '#ffffff', '#f8fafc', '#94a3b8', '#64748b', '#1f2937', '#0b0f17', '#000000',
  '#ef4444', '#f97316', '#f59e0b', '#facc15', '#84cc16', '#22c55e', '#10b981',
  '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef', '#ec4899'
];

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

/** Expands `#abc`/`#abcd` shorthand to full 6/8-digit hex; passes other hex through unchanged. */
export function expandHex(hex) {
  if (typeof hex !== 'string') return null;
  const v = hex.trim();
  const m = v.match(/^#([0-9a-f]{3}|[0-9a-f]{4})$/i);
  if (!m) return v;
  const digits = m[1];
  return `#${digits.split('').map((d) => d + d).join('')}`;
}

/** Returns true for any hex string this picker can round-trip: #rgb, #rrggbb, #rrggbbaa (and shorthand). */
export function isValidHex(value) {
  if (typeof value !== 'string') return false;
  return HEX_RE.test(expandHex(value.trim()) || '');
}

/** @returns {{r:number,g:number,b:number,a:number}|null} 0-255 channels, alpha 0-1 */
export function hexToRgba(hex) {
  const full = expandHex(hex);
  if (!full || !HEX_RE.test(full)) return null;
  const digits = full.slice(1);
  const bytes = digits.match(/.{2}/g).map((h) => parseInt(h, 16));
  return {
    r: bytes[0],
    g: bytes[1],
    b: bytes[2],
    a: bytes.length > 3 ? bytes[3] / 255 : 1
  };
}

/** @param {{r:number,g:number,b:number,a?:number}} rgba - 0-255 channels, alpha 0-1 (default 1) */
export function rgbaToHex({ r, g, b, a = 1 }) {
  const toByte = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
  const hex = `#${toByte(r)}${toByte(g)}${toByte(b)}`;
  const alphaByte = clamp(Math.round(a * 255), 0, 255);
  return alphaByte < 255 ? `${hex}${alphaByte.toString(16).padStart(2, '0')}` : hex;
}

/** @returns {{h:number,s:number,v:number,a:number}} h in [0,360), s/v/a in [0,1] */
export function rgbaToHsv({ r, g, b, a = 1 }) {
  const rn = r / 255, gn = g / 255, bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / delta) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / delta + 2);
    else h = 60 * ((rn - gn) / delta + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : delta / max;
  const v = max;
  return { h, s, v, a };
}

/** @param {{h:number,s:number,v:number,a?:number}} hsv - h in [0,360), s/v/a in [0,1] */
export function hsvToRgba({ h, s, v, a = 1 }) {
  const c = v * s;
  const hp = ((h % 360) + 360) % 360 / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rn = 0, gn = 0, bn = 0;
  if (hp < 1) [rn, gn, bn] = [c, x, 0];
  else if (hp < 2) [rn, gn, bn] = [x, c, 0];
  else if (hp < 3) [rn, gn, bn] = [0, c, x];
  else if (hp < 4) [rn, gn, bn] = [0, x, c];
  else if (hp < 5) [rn, gn, bn] = [x, 0, c];
  else [rn, gn, bn] = [c, 0, x];
  const m = v - c;
  return {
    r: (rn + m) * 255,
    g: (gn + m) * 255,
    b: (bn + m) * 255,
    a
  };
}

export function hexToHsv(hex) {
  const rgba = hexToRgba(hex);
  return rgba ? rgbaToHsv(rgba) : null;
}

export function hsvToHex(hsv) {
  return rgbaToHex(hsvToRgba(hsv));
}

/**
 * Normalizes free-typed color text into a hex string this picker understands
 * (accepts bare hex with/without '#', and rgb()/rgba()). Returns null for
 * anything else (var(...), named colors, gradients, garbage) — callers should
 * fall back to a neutral default rather than crashing the picker UI on those.
 */
export function normalizeColorInput(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (!v) return null;
  const withHash = v.startsWith('#') ? v : `#${v}`;
  if (isValidHex(withHash)) return expandHex(withHash);
  const rgbMatch = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i);
  if (rgbMatch) {
    const [, r, g, b, a] = rgbMatch;
    return rgbaToHex({ r: Number(r), g: Number(g), b: Number(b), a: a !== undefined ? Number(a) : 1 });
  }
  return null;
}
