import { describe, it, expect } from 'vitest';
import {
  clamp,
  expandHex,
  isValidHex,
  hexToRgba,
  rgbaToHex,
  rgbaToHsv,
  hsvToRgba,
  hexToHsv,
  hsvToHex,
  normalizeColorInput,
  PRESET_SWATCHES
} from '../js/ColorPickerLogic.js';

describe('clamp', () => {
  it('clamps within range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe('expandHex', () => {
  it('expands 3-digit shorthand to 6-digit', () => {
    expect(expandHex('#abc')).toBe('#aabbcc');
  });

  it('expands 4-digit shorthand (with alpha) to 8-digit', () => {
    expect(expandHex('#abcd')).toBe('#aabbccdd');
  });

  it('passes through already-full hex unchanged', () => {
    expect(expandHex('#aabbcc')).toBe('#aabbcc');
    expect(expandHex('#aabbccdd')).toBe('#aabbccdd');
  });

  it('returns null for non-string input', () => {
    expect(expandHex(null)).toBeNull();
    expect(expandHex(undefined)).toBeNull();
  });
});

describe('isValidHex', () => {
  it('accepts 3/6/8-digit hex', () => {
    expect(isValidHex('#abc')).toBe(true);
    expect(isValidHex('#aabbcc')).toBe(true);
    expect(isValidHex('#aabbccdd')).toBe(true);
  });

  it('rejects non-hex values', () => {
    expect(isValidHex('var(--text-white)')).toBe(false);
    expect(isValidHex('linear-gradient(90deg, #fff, #000)')).toBe(false);
    expect(isValidHex('red')).toBe(false);
    expect(isValidHex('')).toBe(false);
    expect(isValidHex(null)).toBe(false);
  });
});

describe('hexToRgba / rgbaToHex round-trip', () => {
  it('round-trips a plain 6-digit hex', () => {
    const rgba = hexToRgba('#ff0080');
    expect(rgba).toEqual({ r: 255, g: 0, b: 128, a: 1 });
    expect(rgbaToHex(rgba)).toBe('#ff0080');
  });

  it('round-trips an 8-digit hex with alpha', () => {
    const rgba = hexToRgba('#ff008080');
    expect(rgba.a).toBeCloseTo(128 / 255, 5);
    expect(rgbaToHex(rgba)).toBe('#ff008080');
  });

  it('omits the alpha byte in output hex when alpha is fully opaque', () => {
    expect(rgbaToHex({ r: 10, g: 20, b: 30, a: 1 })).toBe('#0a141e');
  });

  it('returns null for an invalid hex', () => {
    expect(hexToRgba('not-a-color')).toBeNull();
  });
});

describe('rgbaToHsv / hsvToRgba round-trip', () => {
  it('round-trips pure red', () => {
    const hsv = rgbaToHsv({ r: 255, g: 0, b: 0, a: 1 });
    expect(hsv.h).toBeCloseTo(0, 1);
    expect(hsv.s).toBeCloseTo(1, 5);
    expect(hsv.v).toBeCloseTo(1, 5);
    const rgba = hsvToRgba(hsv);
    expect(Math.round(rgba.r)).toBe(255);
    expect(Math.round(rgba.g)).toBe(0);
    expect(Math.round(rgba.b)).toBe(0);
  });

  it('handles pure white as zero saturation', () => {
    const hsv = rgbaToHsv({ r: 255, g: 255, b: 255, a: 1 });
    expect(hsv.s).toBe(0);
    expect(hsv.v).toBe(1);
  });

  it('handles black as zero value', () => {
    const hsv = rgbaToHsv({ r: 0, g: 0, b: 0, a: 1 });
    expect(hsv.v).toBe(0);
  });
});

describe('hexToHsv / hsvToHex round-trip', () => {
  it('round-trips a known color within rounding tolerance', () => {
    const hex = '#3b82f6';
    const hsv = hexToHsv(hex);
    expect(hsv).not.toBeNull();
    const roundTripped = hsvToHex(hsv);
    // Allow +/-1 per channel for HSV<->RGB rounding.
    const a = hexToRgba(hex);
    const b = hexToRgba(roundTripped);
    expect(Math.abs(a.r - b.r)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.g - b.g)).toBeLessThanOrEqual(1);
    expect(Math.abs(a.b - b.b)).toBeLessThanOrEqual(1);
  });

  it('returns null for an unparseable hex', () => {
    expect(hexToHsv('nope')).toBeNull();
  });
});

describe('normalizeColorInput', () => {
  it('accepts hex with or without a leading #', () => {
    expect(normalizeColorInput('#ff0000')).toBe('#ff0000');
    expect(normalizeColorInput('ff0000')).toBe('#ff0000');
  });

  it('accepts rgb() and rgba() and converts to hex', () => {
    expect(normalizeColorInput('rgb(255, 0, 0)')).toBe('#ff0000');
    expect(normalizeColorInput('rgba(255, 0, 0, 0.5)')).toBe('#ff000080');
  });

  it('returns null for non-color text (var(), gradients, named colors)', () => {
    expect(normalizeColorInput('var(--text-white, #fff)')).toBeNull();
    expect(normalizeColorInput('linear-gradient(90deg, red, blue)')).toBeNull();
    expect(normalizeColorInput('cornflowerblue')).toBeNull();
  });

  it('returns null for empty/whitespace input', () => {
    expect(normalizeColorInput('')).toBeNull();
    expect(normalizeColorInput('   ')).toBeNull();
    expect(normalizeColorInput(null)).toBeNull();
  });
});

describe('PRESET_SWATCHES', () => {
  it('is a non-empty list of valid hex colors', () => {
    expect(PRESET_SWATCHES.length).toBeGreaterThan(0);
    PRESET_SWATCHES.forEach((c) => expect(isValidHex(c)).toBe(true));
  });
});
