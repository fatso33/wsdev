/**
 * @module rotaryAcceleration
 * Pure two-tier Rotary acceleration transitions. The caller owns the threaded state
 * bag and clock; this module owns no timers, listeners, or mutable module state.
 */

import { clamp, resolveDegreesPerUnit } from './rotaryConfig.js';

/** Fine tier identity used when seeding and reporting Rotary state. */
export const TIER_FINE = 'fine';
const TIER_COARSE = 'coarse';
const DEFAULT_ACCELERATION_ENTER_RATE = 20;
const ACCELERATION_EXIT_RATIO = 0.5;
const DEFAULT_ACCELERATION_COARSE_STEP = 10;

// Rate is measured from travel accumulated across a 40 ms window, not from one
// pointer event. Each window stands alone, so tier changes have no momentum or decay.
const ACCELERATION_SAMPLE_MS = 40;

// A coarse step below one would be finer than the fine step; it means one instead.
// Only an unset or non-numeric value falls back to the default.
function resolveCoarseStep(raw) {
  const n = Number(raw ?? DEFAULT_ACCELERATION_COARSE_STEP);
  if (!Number.isFinite(n)) return DEFAULT_ACCELERATION_COARSE_STEP;
  return Math.max(n, 1);
}

/**
 * Resolves the coarse tier's Feel by dividing fine Feel by coarse step, then applying
 * the gesture/write-mode floor. This prevents Pulse Arc or Scrub from exceeding the
 * step-rate safety floor and keeps the authored sign.
 *
 * @param {number|undefined} rawFeel - Authored fine Feel, in degrees or pixels per unit.
 * @param {string|undefined} gesture - Arc, Scrub, or Tap.
 * @param {string|undefined} writeMode - Absolute or Pulse.
 * @param {number|undefined} coarseStep - Fine-step multiple; values below one mean one.
 * @returns {number} Signed coarse Feel with magnitude at least the applicable floor.
 */
export function resolveCoarseFeel(rawFeel, gesture, writeMode, coarseStep) {
  const fine = resolveDegreesPerUnit(rawFeel, gesture, writeMode);
  return resolveDegreesPerUnit(fine / resolveCoarseStep(coarseStep), gesture, writeMode);
}

/**
 * Builds one call's acceleration settings. Tap, Detented, and disabled acceleration
 * return null. Pulse fast events use the aircraft's coarse event without also scaling
 * travel; otherwise effectiveCoarseStep reflects the coarse Feel floor.
 *
 * @param {object} cfg - Authored Rotary configuration.
 * @param {string} gesture - Resolved gesture.
 * @param {string} writeMode - Resolved write mode.
 * @param {string} rangeMode - Resolved range mode.
 * @param {number} fineFeel - Resolved fine Feel in degrees or pixels per unit.
 * @param {number} now - Caller-supplied monotonic time in milliseconds.
 * @returns {object|null} Effective rates, coarse step and time, or null when inapplicable.
 */
export function resolveAcceleration(cfg, gesture, writeMode, rangeMode, fineFeel, now) {
  if (cfg.acceleration !== true || gesture === 'tap' || rangeMode === 'detented') return null;
  const enterRaw = Number(cfg.accelerationEnterRate ?? DEFAULT_ACCELERATION_ENTER_RATE);
  const enterRate = Number.isFinite(enterRaw) && enterRaw > 0 ? enterRaw : DEFAULT_ACCELERATION_ENTER_RATE;
  // Exit must stay below entry to keep the hysteresis gap; invalid values use half.
  const exitRaw = Number(cfg.accelerationExitRate ?? enterRate * ACCELERATION_EXIT_RATIO);
  const exitRate = Number.isFinite(exitRaw) && exitRaw > 0 && exitRaw < enterRate ? exitRaw : enterRate * ACCELERATION_EXIT_RATIO;
  const fastEvents = writeMode === 'pulse' && cfg.accelerationFastEvents === true;
  const coarseFeel = resolveCoarseFeel(cfg.degreesPerUnit, gesture, writeMode, cfg.accelerationCoarseStep);
  return { now, enterRate, exitRate, fastEvents, effectiveCoarseStep: fastEvents ? 1 : Math.abs(fineFeel / coarseFeel) };
}

/**
 * Seeds or resets the caller's acceleration fields without retaining a separate store.
 * @param {number|null} [now=null] - Sample start time on grab, or null on reset.
 * @returns {{accelTier: string, accelSampleStart: number|null, accelSampleTravel: number}} Fresh fields.
 */
export function createAccelerationState(now = null) {
  return { accelTier: TIER_FINE, accelSampleStart: now, accelSampleTravel: 0 };
}

/**
 * Advances the tier and scales this move's travel. Travel is measured in units of
 * fine Feel even while coarse, so switching tiers cannot inflate its own rate. The
 * move that closes a slow window is already fine. Zero travel on an idle call may
 * close a window, letting the feedback tier follow a stopped finger.
 *
 * @param {object} state - Caller-threaded Rotary state; it is not mutated.
 * @param {object|null} accel - Settings from resolveAcceleration.
 * @param {number} travelUnits - Signed finger travel in fine Feel units.
 * @returns {{state: object, deltaValue: number, coarse: boolean}} Updated state and scaled travel.
 */
export function accelerateTravel(state, accel, travelUnits) {
  if (!accel) return { state, deltaValue: travelUnits, coarse: false };
  let tier = state.accelTier ?? TIER_FINE;
  let sampleTravel = (state.accelSampleTravel ?? 0) + Math.abs(travelUnits);
  let sampleStart = state.accelSampleStart ?? accel.now;
  const elapsed = accel.now - sampleStart;
  if (elapsed >= ACCELERATION_SAMPLE_MS) {
    const rate = (sampleTravel * 1000) / elapsed;
    if (tier === TIER_COARSE) tier = rate < accel.exitRate ? TIER_FINE : TIER_COARSE;
    else tier = rate >= accel.enterRate ? TIER_COARSE : TIER_FINE;
    sampleTravel = 0;
    sampleStart = accel.now;
  }
  const coarse = tier === TIER_COARSE;
  return {
    state: { ...state, accelTier: tier, accelSampleStart: sampleStart, accelSampleTravel: sampleTravel },
    deltaValue: coarse ? travelUnits * accel.effectiveCoarseStep : travelUnits,
    coarse
  };
}

/**
 * Adds a move's value change to unclamped raw value. A coarse move on a Bounded
 * Ring clamps at the end stop so scaled overshoot cannot leave an exact bound
 * unreachable after the gesture slows; ordinary fine overshoot is retained.
 *
 * @param {number} rawValue - Current unbounded value.
 * @param {number} deltaValue - Signed value change.
 * @param {boolean} coarse - Whether this move used the coarse tier.
 * @param {number} min - Lower bound.
 * @param {number} max - Upper bound.
 * @param {string} mode - Resolved range mode.
 * @returns {number} Next raw value, clamped only for coarse Bounded moves.
 */
export function advanceRawValue(rawValue, deltaValue, coarse, min, max, mode) {
  const next = rawValue + deltaValue;
  return coarse && mode === 'bounded' ? clamp(next, min, max) : next;
}
