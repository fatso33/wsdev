/**
 * @module rotaryConfig
 * Pure Rotary mode, range, position, and Feel configuration rules. This leaf owns
 * authored-value defaults and normalization; it reads no ambient state and owns no
 * resources. Sibling runtime modules import the internal helpers by name.
 */

/** Default lower endpoint for Bounded and Continuous Rotaries. */
export const DEFAULT_MIN = 0;
/** Default upper endpoint for Bounded and Continuous Rotaries. */
export const DEFAULT_MAX = 100;
const DEFAULT_DEGREES_PER_UNIT = 1;
const DEFAULT_GESTURE = 'arc';
const DEFAULT_RANGE_MODE = 'bounded';
const DEFAULT_WRITE_MODE = 'absolute';
const DEFAULT_PULSE_FEEL = 12;

// Pulse emits one write per step and the frame coalescer drains at most four
// steps per frame (~240/sec at 60Hz). Flooring Arc/Scrub Feel where the step
// stream is unbounded keeps an ordinary human turn below that ceiling so a
// queue does not continue dispatching after release. The drain itself is unchanged.
// Arc's 6 degrees is measured: the fastest observed turn was 3.05–3.65 rev/s,
// which keeps the ceiling out of reach above roughly 4.5–5.5 degrees per step.
// Scrub's 10 pixels is an estimate by analogy because drag speed is unmeasured.
// Lowering a floor gives existing widgets more headroom; raising one silently
// changes the feel of widgets authored at that value.
const PULSE_ARC_FEEL_FLOOR_DEGREES = 6;
const PULSE_SCRUB_FEEL_FLOOR_PIXELS = 10;

/**
 * Resolves an authored gesture to Arc, Scrub, or Tap. Invalid and unset values
 * select Arc so component affordances and engine behavior share the same default.
 *
 * @param {string|undefined} raw - Authored gesture name.
 * @returns {'arc'|'scrub'|'tap'} The supported gesture.
 */
export function resolveGesture(raw) {
  return raw === 'arc' || raw === 'scrub' || raw === 'tap' ? raw : DEFAULT_GESTURE;
}

/**
 * Resolves an authored range mode. Unknown values retain the bounded end-stop behavior.
 *
 * @param {string|undefined} raw - Authored range mode.
 * @returns {'bounded'|'continuous'|'detented'} The supported range mode.
 */
export function resolveRangeMode(raw) {
  return raw === 'bounded' || raw === 'continuous' || raw === 'detented' ? raw : DEFAULT_RANGE_MODE;
}

/**
 * Resolves Absolute or Pulse write behavior, defaulting to Absolute.
 *
 * @param {string|undefined} raw - Authored write mode.
 * @returns {'absolute'|'pulse'} The supported write mode.
 */
export function resolveWriteMode(raw) {
  return raw === 'absolute' || raw === 'pulse' ? raw : DEFAULT_WRITE_MODE;
}

/** Returns the default dispatch timing for the already-resolved write mode. */
function defaultDispatchTiming(writeMode) {
  return writeMode === 'pulse' ? 'perDetent' : 'onChange';
}

/**
 * Resolves when writes leave the Rotary. Invalid values use the write mode's default.
 *
 * @param {string|undefined} raw - Authored dispatch timing.
 * @param {string|undefined} writeMode - Authored write mode used for the fallback.
 * @returns {'onChange'|'onRelease'|'perDetent'} The supported dispatch timing.
 */
export function resolveDispatchTiming(raw, writeMode) {
  return raw === 'onChange' || raw === 'onRelease' || raw === 'perDetent'
    ? raw
    : defaultDispatchTiming(writeMode);
}

/**
 * Filters authored positions to non-null object entries, preserving order and identity.
 *
 * @param {*} raw - Authored positions value.
 * @returns {object[]} Valid position objects; non-arrays yield an empty list.
 */
export function normalizePositions(raw) {
  return Array.isArray(raw) ? raw.filter((position) => position && typeof position === 'object') : [];
}

/**
 * Resolves the active numeric or position-index range for one Rotary configuration.
 * Detented mode ignores authored min/max and uses the filtered positions' indices.
 *
 * @param {object} cfg - Authored Rotary configuration.
 * @returns {{mode: string, min: number, max: number, positions: object[]}} Range and positions.
 */
export function resolveEffectiveRange(cfg) {
  const mode = resolveRangeMode(cfg.rangeMode);
  const positions = normalizePositions(cfg.positions);
  if (mode === 'detented') {
    return { mode, min: 0, max: Math.max(positions.length - 1, 0), positions };
  }
  return { mode, min: cfg.min ?? DEFAULT_MIN, max: cfg.max ?? DEFAULT_MAX, positions };
}

/**
 * Maps raw value into the visible range: Continuous wraps and other modes clamp.
 * A non-positive Continuous span resolves to its minimum.
 *
 * @param {number} rawValue - Unbounded engine value.
 * @param {number} min - Inclusive lower endpoint.
 * @param {number} max - Upper endpoint, exclusive for Continuous wrapping.
 * @param {string} mode - Resolved range mode.
 * @returns {number} Display value in the active range.
 */
export function resolveDisplayValue(rawValue, min, max, mode) {
  if (mode === 'continuous') {
    const span = max - min;
    if (!(span > 0)) return min;
    return (((rawValue - min) % span) + span) % span + min;
  }
  return clamp(rawValue, min, max);
}

/**
 * The smallest permitted Feel magnitude; it keeps the degrees-per-unit divisor nonzero.
 */
export const MIN_DEGREES_PER_UNIT = 0.01;

/**
 * Resolves the minimum Feel magnitude for the gesture and write mode. Pulse Arc and
 * Pulse Scrub use measured/estimated floors to keep their unbounded step stream under
 * the frame drain ceiling; Pulse Tap and Absolute use the divisor safety floor.
 *
 * @param {string|undefined} gesture - Authored gesture; invalid values resolve to Arc.
 * @param {string|undefined} writeMode - Authored mode; invalid values resolve to Absolute.
 * @returns {number} Positive Feel magnitude floor in the gesture's units.
 */
export function resolveFeelFloor(gesture, writeMode) {
  if (resolveWriteMode(writeMode) !== 'pulse') return MIN_DEGREES_PER_UNIT;
  const resolved = resolveGesture(gesture);
  if (resolved === 'arc') return PULSE_ARC_FEEL_FLOOR_DEGREES;
  if (resolved === 'scrub') return PULSE_SCRUB_FEEL_FLOOR_PIXELS;
  return MIN_DEGREES_PER_UNIT;
}

// Absolute's default Feel of 1 suits a heading knob covering 0–360 in one turn.
// In Pulse that would be 360 steps per revolution, so 12 gives roughly 30 steps
// per Arc revolution (within the 10–18 range of faithful Pulse rings) and stays
// above both floors. At that Feel, a fast spin peaked at 144 steps/sec under the
// ~240/sec drain ceiling.
/**
 * Returns the creation-time Feel default. Pulse Arc/Scrub start above their floors;
 * other gesture/write combinations retain the long-standing default of one.
 *
 * @param {string|undefined} gesture - Authored gesture; invalid values resolve to Arc.
 * @param {string|undefined} writeMode - Authored mode; invalid values resolve to Absolute.
 * @returns {number} Initial Feel in the gesture's units.
 */
export function resolveFeelDefault(gesture, writeMode) {
  return resolveFeelFloor(gesture, writeMode) > MIN_DEGREES_PER_UNIT ? DEFAULT_PULSE_FEEL : DEFAULT_DEGREES_PER_UNIT;
}

/**
 * Resolves a configured Feel to a safe divisor while preserving its sign. Non-finite
 * values use the positive default, then honor the active Feel floor.
 *
 * @param {number|string|undefined} raw - Authored Feel.
 * @param {string|undefined} gesture - Authored gesture.
 * @param {string|undefined} writeMode - Authored write mode.
 * @returns {number} Signed Feel whose magnitude meets the configured floor.
 */
export function resolveDegreesPerUnit(raw, gesture, writeMode) {
  const floor = resolveFeelFloor(gesture, writeMode);
  const n = Number(raw ?? DEFAULT_DEGREES_PER_UNIT);
  if (!Number.isFinite(n)) return Math.max(DEFAULT_DEGREES_PER_UNIT, floor);
  const magnitude = Math.max(Math.abs(n), floor);
  return n < 0 ? -magnitude : magnitude;
}

/**
 * Clamps a number between endpoints regardless of endpoint order. NaN remains NaN.
 *
 * @param {number} value - Value to clamp.
 * @param {number} min - First endpoint.
 * @param {number} max - Second endpoint.
 * @returns {number} Clamped value.
 */
export function clamp(value, min, max) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.min(hi, Math.max(lo, value));
}
