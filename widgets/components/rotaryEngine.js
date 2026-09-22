/**
 * @module rotaryEngine
 * Pure, stateless coordination for Rotary gestures, telemetry and dispatch.
 * The caller owns pointer events, telemetry, writes and clock time. Pass each
 * result's `state` back as `config.previousState`; it is an opaque continuity
 * bag, not a second store held by this module.
 *
 * `resolveRotary(config, gestureEvent, telemetry, now)` returns
 * `{ value, angle, activeRing, tier, activePosition, emits, haptics, state }`.
 * `activePosition` is an authored position index only in Detented mode, and
 * null when no position matches. `tier` is fine/coarse when acceleration is
 * enabled and fine otherwise. `emits` contain trigger/payload pairs; trigger
 * payloads carry value, delta, direction and ring (plus `fast` for fast Pulse).
 *
 * Config accepts mode, range, gesture, write and dispatch settings, Feel,
 * sweep degrees, ring ID, acceleration settings, readable-value status and
 * `previousState`. The imported Config and other rotary modules document
 * their defaults and units. Arc, Scrub and Tap share the same Feel field and
 * turnStart/turn/turnEnd vocabulary, allowing bindings to remain gesture-agnostic.
 * `gestureEvent` is null or `{ type: 'start'|'move'|'end', dx, dy }`, with pointer
 * coordinates relative to the Rotary center. `telemetry` is null or an object
 * with `value` (number or an authored Detented value) and optional
 * `dispatchFailed`. `now` is a caller-supplied monotonic timestamp in
 * milliseconds; this module never reads ambient time or owns timers/DOM.
 */

import {
  TIER_FINE,
  accelerateTravel,
  createAccelerationState,
  resolveAcceleration
} from './rotary/rotaryAcceleration.js';

import {
  clamp,
  resolveDegreesPerUnit,
  resolveDispatchTiming,
  resolveDisplayValue,
  resolveEffectiveRange,
  resolveGesture,
  resolveWriteMode
} from './rotary/rotaryConfig.js';

import {
  processArcGesture,
  processScrubGesture,
  processTapGesture
} from './rotary/rotaryGestures.js';

import {
  applyAbsoluteFrameCap,
  applyDispatchTiming,
  applyPulseFrameCoalescing,
  createDispatchState,
  frameIdOf,
  processPulseGesture,
  resolveFrameQuantumMs
} from './rotary/rotaryDispatch.js';

import {
  applyDetentedPostProcessing,
  boundSideOf,
  deriveHaptics,
  firstRestablePositionIndex,
  matchPositionIndex
} from './rotary/rotaryDetents.js';

import { applyReconciliation } from './rotary/rotaryReconciliation.js';

export { resolveCoarseFeel } from './rotary/rotaryAcceleration.js';

export {
  MIN_DEGREES_PER_UNIT,
  resolveDegreesPerUnit,
  resolveDispatchTiming,
  resolveFeelDefault,
  resolveFeelFloor,
  resolveGesture,
  resolveRangeMode,
  resolveWriteMode
} from './rotary/rotaryConfig.js';

const DEFAULT_SWEEP_DEGREES = 270;
const DEFAULT_RING_ID = 'default';

/**
 * Seeds the single caller-threaded state bag from configuration and optional
 * telemetry. Returns an idle state; it does not retain or mutate inputs.
 */
export function createRotaryState(config, telemetry) {
  const cfg = config || {};
  const { mode, min, max, positions } = resolveEffectiveRange(cfg);

  if (mode === 'detented') {
    // Authored positions match by String()-coerced identity, including local
    // state values that are not numeric.
    const seeded = telemetry && telemetry.value !== undefined && telemetry.value !== null;
    const matchedIndex = seeded ? matchPositionIndex(positions, telemetry.value) : -1;
    const index = matchedIndex >= 0
      ? matchedIndex
      : clamp(Math.round(cfg.initialValue ?? 0), min, max);
    // A cold Momentary seed has no prior stable position. Release therefore
    // springs to the first restable position rather than back to itself.
    const seededPosition = positions[index] || null;
    const stableIndex = (seededPosition && seededPosition.momentary)
      ? firstRestablePositionIndex(positions, min)
      : index;
    return {
      phase: 'idle',
      rawValue: index,
      lastPos: null,
      pendingDispatchValue: null,
      reconcileStartedAt: null,
      atBoundSide: null,
      // Preserve unmatched telemetry as visible but without an active position.
      telemetryUnmatched: seeded && matchedIndex < 0,
      unmatchedValue: seeded && matchedIndex < 0 ? telemetry.value : null,
      stableIndex,
      // A grab without a crossing must not fire a detent or limit cue.
      detentIndex: index,
      ...createDispatchState(),
      ...createAccelerationState()
    };
  }

  const seeded = telemetry && typeof telemetry.value === 'number';
  const rawValue = seeded ? telemetry.value : (cfg.initialValue ?? min);
  const displayValue = resolveDisplayValue(rawValue, min, max, mode);
  return {
    phase: 'idle', // 'idle' | 'engaged' | 'reconciling'
    rawValue,
    lastPos: null,
    pendingDispatchValue: null,
    reconcileStartedAt: null,
    // Resting at a bound is not a bound transition; Continuous has no bound.
    atBoundSide: mode === 'continuous' ? null : boundSideOf(displayValue, min, max),
    telemetryUnmatched: false,
    unmatchedValue: null,
    stableIndex: null,
    ...createDispatchState(),
    ...createAccelerationState()
  };
}

/**
 * Selects a gesture handler for one event. Pulse intercepts all gestures
 * because its turn emit represents a step rather than an absolute value.
 */
function processGesture(state, cfg, gestureEvent, now) {
  const { mode, min, max } = resolveEffectiveRange(cfg);
  const ring = cfg.ringId ?? DEFAULT_RING_ID;
  const gesture = resolveGesture(cfg.gesture);
  const writeMode = resolveWriteMode(cfg.writeMode);
  const degPerUnit = resolveDegreesPerUnit(cfg.degreesPerUnit, gesture, writeMode);
  const accel = resolveAcceleration(cfg, gesture, writeMode, mode, degPerUnit, now);

  if (writeMode === 'pulse') {
    return processPulseGesture(state, cfg, gestureEvent, min, max, mode, ring, degPerUnit, gesture, accel);
  }

  if (gesture === 'scrub') {
    return processScrubGesture(state, cfg, gestureEvent, min, max, mode, ring, degPerUnit, accel);
  }
  if (gesture === 'tap') {
    return processTapGesture(state, cfg, gestureEvent, min, max, mode, ring, degPerUnit);
  }
  return processArcGesture(state, cfg, gestureEvent, min, max, mode, ring, degPerUnit, accel);
}

/**
 * Resolves one gesture/telemetry call against the caller's prior state.
 * Returns the full public result described in the header without side effects.
 */
export function resolveRotary(config, gestureEvent, telemetry, now) {
  const cfg = config || {};
  const { mode, min, max, positions } = resolveEffectiveRange(cfg);
  const ring = cfg.ringId ?? DEFAULT_RING_ID;
  const writeMode = resolveWriteMode(cfg.writeMode);
  const dispatchTiming = resolveDispatchTiming(cfg.dispatchTiming, writeMode);
  // Frame identity is only for write caps. Reconciliation uses raw `now`
  // so its elapsed-time window is independent of the frame quantum.
  const frameId = frameIdOf(now, resolveFrameQuantumMs(cfg.frameQuantumMs));

  let state = cfg.previousState || createRotaryState(cfg, telemetry);

  // Read the resolved state so a cold seed retains its starting detent index.
  const previousDetentIndex = (state.detentIndex != null) ? state.detentIndex : null;

  // Reconcile an open window before applying this call's gesture.
  if (state.phase === 'reconciling') {
    state = applyReconciliation(state, cfg, telemetry, now, mode, positions);
  }

  // A fresh grab outranks an unconfirmed echo in a remaining window.
  let emits = [];
  if (gestureEvent) {
    if (gestureEvent.type === 'start' && state.phase === 'reconciling') {
      state = { ...state, phase: 'idle', pendingDispatchValue: null, reconcileStartedAt: null };
    }
    const gestureResult = processGesture(state, cfg, gestureEvent, now);
    state = gestureResult.state;
    emits = emits.concat(gestureResult.emits);
    // No rate sample carries from one gesture into the next.
    if (gestureEvent.type === 'start') state = { ...state, ...createAccelerationState(now) };
    else if (gestureEvent.type === 'end') state = { ...state, ...createAccelerationState() };
    if (state.phase === 'reconciling' && state.reconcileStartedAt == null) {
      state = { ...state, reconcileStartedAt: now };
    }
  } else if (state.phase === 'engaged') {
    // A call without movement closes an open rate sample, allowing the tier
    // to fall with the finger rather than remain coarse indefinitely.
    const gesture = resolveGesture(cfg.gesture);
    const fineFeel = resolveDegreesPerUnit(cfg.degreesPerUnit, gesture, writeMode);
    state = accelerateTravel(state, resolveAcceleration(cfg, gesture, writeMode, mode, fineFeel, now), 0).state;
  }

  // Drain Pulse queues even without a gesture, including after release. Drain
  // before current telemetry so coarse bound checks use the prior reading.
  if (writeMode === 'pulse') {
    const coalesced = applyPulseFrameCoalescing(state, frameId, min, max, mode, ring, {
      coarseIsFast: cfg.acceleration === true && cfg.accelerationFastEvents === true,
      checkBounds: !!cfg.hasReadableValue
    });
    state = coalesced.state;
    emits = emits.concat(coalesced.emits);
  }

  // Absolute engagement owns its value; inbound telemetry cannot fight the
  // finger. Pulse owns steps instead, so readable telemetry remains the
  // displayed value while engaged. A blind Pulse ring has no trusted reading.
  const telemetryFollowsWhileEngaged =
    state.phase === 'engaged' && writeMode === 'pulse' && !!cfg.hasReadableValue;
  if ((state.phase === 'idle' || telemetryFollowsWhileEngaged) && telemetry && !telemetry.dispatchFailed) {
    if (mode === 'detented') {
      // Detented values match authored positions by coerced identity.
      if (telemetry.value !== undefined && telemetry.value !== null) {
        const idx = matchPositionIndex(positions, telemetry.value);
        if (idx >= 0) {
          state = {
            ...state,
            rawValue: idx,
            telemetryUnmatched: false,
            unmatchedValue: null,
            stableIndex: (positions[idx] && positions[idx].momentary) ? state.stableIndex : idx
          };
        } else {
          state = { ...state, telemetryUnmatched: true, unmatchedValue: telemetry.value };
        }
      }
    } else if (typeof telemetry.value === 'number') {
      state = { ...state, rawValue: telemetry.value };
    }
  }

  // Map Detented indices to authored values and cues; numeric modes derive
  // display values and bound cues directly.
  let value;
  let haptics;
  let activePosition = null;
  if (mode === 'detented') {
    const outcome = applyDetentedPostProcessing(state, positions, min, max, emits, previousDetentIndex, gestureEvent, ring);
    state = outcome.state;
    emits = outcome.emits;
    value = outcome.value;
    haptics = outcome.haptics;
    activePosition = outcome.activeIndex;
  } else {
    value = resolveDisplayValue(state.rawValue, min, max, mode);
    haptics = mode === 'continuous' ? [] : deriveHaptics(state, cfg, min, max, emits);
    if (haptics.includes('boundReached')) {
      haptics = [...haptics, 'limit'];
      emits = [...emits, { trigger: 'limit', payload: { value, delta: 0, direction: null, ring } }];
    }
    state = { ...state, atBoundSide: mode === 'continuous' ? null : boundSideOf(value, min, max) };
  }

  // Filter and cap Absolute turns after detent/bound cues consume uncapped
  // emits. Pulse is capped earlier, before telemetry and Detented remapping.
  if (writeMode === 'absolute') {
    const timed = applyDispatchTiming(state, dispatchTiming, emits, gestureEvent, value, mode === 'detented');
    const capped = applyAbsoluteFrameCap(timed.state, frameId, timed.emits);
    state = capped.state;
    emits = capped.emits;
  }

  const span = max - min;
  const sweep = cfg.sweepDegrees ?? DEFAULT_SWEEP_DEGREES;
  let angle;
  // Detented angle follows the active index; numeric angle maps the visible
  // value onto the authored sweep. A zero span has no meaningful rotation.
  if (mode === 'detented') {
    const denom = Math.max(max, 1);
    const angleIndex = state.detentIndex != null ? state.detentIndex : (previousDetentIndex ?? 0);
    angle = (angleIndex / denom) * sweep;
  } else {
    angle = span === 0 ? 0 : ((value - min) / span) * sweep;
  }

  return {
    value,
    angle,
    activeRing: ring,
    tier: cfg.acceleration === true ? (state.accelTier ?? TIER_FINE) : TIER_FINE,
    activePosition,
    emits,
    haptics,
    state
  };
}
