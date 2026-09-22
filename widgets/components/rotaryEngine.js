/**
 * rotaryEngine.js
 *
 * Pure decision layer for the Rotary component family (Rotary rebuild, ticket 01).
 *
 * No DOM access, no timer registration, no reads of ambient time or Math.random,
 * and no module-level/global mutable state. Every call is a pure function of its
 * arguments:
 *
 *   resolveRotary(config, gestureEvent, telemetry, now)
 *     -> { value, angle, activeRing, tier, emits, haptics, state }
 *
 * Because the engine cannot hold state itself (no globals), the caller is
 * responsible for threading continuity between calls: pass the `state` field
 * from one call's result back in as `config.previousState` on the next call.
 * That `state` bag is intentionally opaque to callers and tests — it exists so
 * a real gesture (many pointermove events) and a reconciliation window
 * (spanning several telemetry ticks) can be resolved one call at a time
 * without the module remembering anything on its own. Treat it as "the thing
 * you hand back next time", never as something to inspect.
 *
 * Scope for ticket 01 (per the ticket): Arc gesture, Bounded range, Absolute
 * write mode, single Ring, and the Reconciliation window. Scrub/Tap (03),
 * Continuous/Detented (04), Pulse (05) and Acceleration tiers (06) all widen
 * this same signature rather than replacing it — `activeRing` and `tier` are
 * already part of the return shape for that reason. `tier` is 'fine' or, with
 * Acceleration on, 'coarse'; `activeRing` is still always a single ring.
 *
 * Ticket 03 widens the gesture axis: `config.gesture` selects 'arc' (default),
 * 'scrub' or 'tap'. All three share the SAME `degreesPerUnit` config field as
 * their sensitivity/"Feel" knob, reinterpreted per gesture (degrees of arc,
 * pixels of linear drag, or units per discrete tap) rather than adding a
 * parallel field per gesture — this is what lets an Author switch gesture in
 * the Inspector without reconfiguring range, steps or bindings. All three
 * gestures also share `clamp()`/the Bounded range and the Reconciliation
 * window untouched, and emit the identical trigger vocabulary (turnStart/
 * turn/turnEnd) with the identical payload shape — a downstream binding or
 * interaction does not care which gesture drove it.
 *
 * ---------------------------------------------------------------------------
 * config shape (all fields optional unless noted; caller — ticket 02's
 * Component — is expected to supply real values, these are safe fallbacks
 * for tests/early callers):
 *
 *   {
 *     min: number,                 // Bounded range floor (default 0)
 *     max: number,                 // Bounded range ceiling (default 100)
 *     initialValue: number,        // used only if no telemetry has arrived yet
 *     gesture: string,              // 'arc' (default) | 'scrub' | 'tap'. Selects HOW a
 *                                  // move/tap is interpreted; see the file header note
 *                                  // above ticket 03 added this.
 *     degreesPerUnit: number,      // the gesture's sensitivity ("Feel"), reinterpreted per
 *                                  // `gesture` (default 1):
 *                                  //   arc:   arc degrees that move the value by 1 unit.
 *                                  //   scrub: pixels of linear drag that move the value by 1 unit.
 *                                  //   tap:   units moved by a single discrete tap.
 *                                  // Used as a divisor for arc/scrub, so its magnitude is
 *                                  // floored at MIN_DEGREES_PER_UNIT below — 0 is not reachable.
 *                                  // In Pulse write mode, arc and scrub are floored higher
 *                                  // still: see resolveFeelFloor.
 *     minEffectiveRadius: number,  // px floor for the grab radius (default 24 — roughly
 *                                  // a fingertip contact radius; see ADR 0001)
 *     sweepDegrees: number,        // visual sweep the returned `angle` is mapped onto
 *                                  // across the full [min,max] range (default 270)
 *     pollPeriodMs: number,        // the *actual* poll period of the bound telemetry;
 *                                  // used to derive the Reconciliation timeout. Ticket 02
 *                                  // supplies the real value; DEFAULT_POLL_PERIOD_MS below
 *                                  // is only a fallback for callers that don't know it yet.
 *     reconciliationTolerance: number, // absolute tolerance for the telemetry-echo match;
 *                                  // defaults to 0.1% of the [min,max] span.
 *     frameQuantumMs: number,      // ticket 20: the width of one "frame" for the two
 *                                  // per-frame write limiters, in the same unit as
 *                                  // `now` (default 1000/60). 0 means exact `now`
 *                                  // equality — pre-ticket-20 behaviour, which only a
 *                                  // test driving synthetic timestamps should ask for.
 *                                  // Not an authored FDWS prop: it exists so the
 *                                  // engine's abstract-time contract stays testable.
 *     ringId: string,              // echoed back as `activeRing` (default 'default')
 *     acceleration: boolean,       // true turns Acceleration on (default off). Returned `tier`
 *                                  // is then 'fine' or 'coarse'; with it off, always 'fine'.
 *                                  // Inert for the Tap gesture and the Detented range, which
 *                                  // have no rate of turn and no continuous value to scale.
 *     accelerationEnterRate: number, // steps per second (one step is one unit of Feel) at or
 *                                  // above which the Ring enters the coarse tier (default 20).
 *                                  // A non-positive or non-numeric enter rate is not usable and
 *                                  // is replaced by the default.
 *     accelerationExitRate: number,  // steps per second strictly below which it returns to the
 *                                  // fine tier. Must be above 0 and under the enter rate: unset,
 *                                  // zero, negative, non-numeric, or not under the enter rate,
 *                                  // all run half the enter rate, so the gap between the two
 *                                  // is never lost.
 *     accelerationCoarseStep: number, // how many fine steps one step of travel becomes in the
 *                                  // coarse tier (default 10; below 1 means 1, which makes the
 *                                  // coarse tier move like the fine one). Enforced through the
 *                                  // Feel floor: see resolveCoarseFeel.
 *     accelerationFastEvents: boolean, // the caller has both fast step events bound. Pulse only:
 *                                  // coarse steps are then tagged `fast` and NOT scaled by the
 *                                  // coarse step, since the aircraft's own fast event is it.
 *     hasReadableValue: boolean,   // the sim reports this Ring's value back. In Pulse, steps
 *                                  // toward a bound the sim reports as reached are not sent.
 *     previousState: object|undefined, // the `state` this module returned last call
 *   }
 *
 * gestureEvent shape (or null/undefined if nothing happened this call):
 *
 *   {
 *     type: 'start' | 'move' | 'end',
 *     dx: number,  // pointer X relative to the Rotary's own center
 *     dy: number,  // pointer Y relative to the Rotary's own center
 *   }
 *
 * telemetry shape (or null/undefined if nothing new arrived this call):
 *
 *   {
 *     value: number,          // latest known value from the sim
 *     dispatchFailed: boolean // true exactly on the call reporting that the most
 *                              // recent write attempt for this Rotary failed
 *   }
 *
 * now: number — caller-supplied timestamp (any consistent monotonic unit; tests
 * use plain milliseconds). Never read from Date.now()/performance.now() inside
 * this module.
 * ---------------------------------------------------------------------------
 */

import {
  TIER_FINE,
  accelerateTravel,
  createAccelerationState,
  resolveAcceleration
} from './rotary/rotaryAcceleration.js';

import {
  DEFAULT_MAX,
  DEFAULT_MIN,
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
const DEFAULT_POLL_PERIOD_MS = 1000; // matches the normal 1Hz poll tier (CLAUDE.md)
const DEFAULT_RING_ID = 'default';

/**
 * The rest-state index a cold-started Detented Ring falls back to when the index it
 * would otherwise seed (matched telemetry, or the authored initialValue) lands on a
 * Momentary position with no prior state to fall back to instead (see
 * createRotaryState's own comment on this). Picks the first authored position that
 * ISN'T Momentary, since that's the closest available reading of "a position this
 * control could actually rest at"; falls back to `min` (index 0) in the degenerate
 * case where every authored position is Momentary and there is truly nothing else to
 * pick.
 *
 * Invariant this relies on: every element of `positions` is a non-null object. The
 * predicate reads `p.momentary` with no guard, so a null or primitive entry throws.
 * That holds because the only caller passes a `normalizePositions()`-filtered array.
 * A second caller must filter the same way, or this needs a `p &&` guard first.
 */
function firstRestablePositionIndex(positions, min) {
  const idx = positions.findIndex((p) => !p.momentary);
  return idx >= 0 ? idx : min;
}

/**
 * Deliberately carried over from the deleted Selector's isSamePosition(): an
 * Enum-unit SimVar arrives as a NUMBER while authored position values are very often
 * text ("OFF"/"L"/"BOTH") — comparing with `===` would silently never match, the
 * exact bug the old Selector needed this same coercion to avoid. Returns -1 (not
 * found) rather than null so it composes directly with an Array index.
 */
function matchPositionIndex(positions, rawValue) {
  if (rawValue === undefined || rawValue === null) return -1;
  return positions.findIndex((p) => String(p.value) === String(rawValue));
}

// Deliberate implementation choices, not values pulled from the spec:
// - The floor stops the Reconciliation window collapsing to a near-zero
//   duration even on a very fast poll tier.
// - "roughly twice" the poll period, per the ticket, so at least one full
//   telemetry tick has a chance to arrive and echo back before we give up.
const RECONCILIATION_TIMEOUT_FLOOR_MS = 250;
const RECONCILIATION_TIMEOUT_MULTIPLIER = 2;

/**
 * Builds the state bag for a Rotary that has never been engaged before.
 * Exported so a caller can seed `config.previousState` on its very first call
 * without needing to know the bag's internal shape ahead of time.
 */
export function createRotaryState(config, telemetry) {
  const cfg = config || {};
  const { mode, min, max, positions } = resolveEffectiveRange(cfg);

  if (mode === 'detented') {
    // Detented matches by String()-coerced identity (see matchPositionIndex), so
    // unlike Bounded/Continuous it isn't restricted to a numeric telemetry.value —
    // a position can just as well be driven by a local state var as by a SimVar.
    const seeded = telemetry && telemetry.value !== undefined && telemetry.value !== null;
    const matchedIndex = seeded ? matchPositionIndex(positions, telemetry.value) : -1;
    const index = matchedIndex >= 0
      ? matchedIndex
      : clamp(Math.round(cfg.initialValue ?? 0), min, max);
    // stableIndex is what a Momentary position springs back to on release (see
    // applyDetentedPostProcessing). There is no prior state yet on a cold start, so
    // if the seeded index itself is Momentary (e.g. telemetry seeds the Ring
    // directly onto a magneto's START before any gesture has ever run), it cannot
    // fall back to "whatever was held before" the way the runtime idle-telemetry
    // path below does — fall back to the first non-Momentary authored position
    // instead, so release doesn't no-op onto the position already showing.
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
      // Idle telemetry read that matches no authored position: nothing is active, and
      // stays that way (never resolves to a stale earlier position) until either a
      // later telemetry reading matches or the Ring is grabbed — see
      // applyDetentedPostProcessing's own comment for the bug this avoids.
      telemetryUnmatched: seeded && matchedIndex < 0,
      unmatchedValue: seeded && matchedIndex < 0 ? telemetry.value : null,
      stableIndex,
      // Seeded to the same index the Ring starts at (not null) so the very first
      // grab's `index !== previousDetentIndex` check in applyDetentedPostProcessing
      // correctly reads as "nothing has moved yet" rather than firing a spurious
      // detent/limit on a bare grab that never turned.
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
    // Seeded from the starting position itself, not `null` — a Rotary that
    // starts resting at `min` (the common unseeded-by-telemetry case) has
    // not "just reached" that bound by existing there, so the very first
    // grab must not read as a fresh min->min transition and fire a spurious
    // boundReached cue. Continuous never has a "bound" to reach at all.
    atBoundSide: mode === 'continuous' ? null : boundSideOf(displayValue, min, max),
    telemetryUnmatched: false,
    unmatchedValue: null,
    stableIndex: null,
    ...createDispatchState(),
    ...createAccelerationState()
  };
}

/**
 * Resolves this frame's gesture (start/move/end) against the current state,
 * dispatching to Arc/Scrub/Tap per `cfg.gesture` (default Arc). See each
 * gesture's own function for what makes it distinct; everything else —
 * bounds, the Reconciliation window, the emitted trigger vocabulary — is
 * shared, which is what lets a downstream binding or interaction not care
 * which gesture drove it. Ticket 05: Pulse write mode intercepts here, before the
 * per-gesture dispatch, since it changes what an emit MEANS (a step, not a value)
 * uniformly across all three gestures.
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
 * Checks the three Reconciliation-window release conditions, in the order
 * the ticket specifies, and releases on the first one that's true:
 *   1. a dispatch failure — revert to telemetry immediately, don't wait.
 *   2. telemetry echoing the dispatched value within tolerance.
 *   3. a timeout derived from the actual poll period (never a hardcoded
 *      constant on its own — always `max(floor, pollPeriod * 2)`).
 */
function applyReconciliation(state, cfg, telemetry, now, mode, positions) {
  if (state.phase !== 'reconciling') {
    return state;
  }

  if (mode === 'detented') {
    return applyDetentedReconciliation(state, cfg, telemetry, now, positions);
  }

  if (telemetry && telemetry.dispatchFailed) {
    const revertValue = typeof telemetry.value === 'number' ? telemetry.value : state.rawValue;
    return toIdleFromTelemetry(state, revertValue);
  }

  const tolerance = cfg.reconciliationTolerance ??
    Math.abs((cfg.max ?? DEFAULT_MAX) - (cfg.min ?? DEFAULT_MIN)) * 0.001;

  if (
    telemetry &&
    typeof telemetry.value === 'number' &&
    state.pendingDispatchValue != null &&
    Math.abs(telemetry.value - state.pendingDispatchValue) <= tolerance
  ) {
    return toIdleFromTelemetry(state, telemetry.value);
  }

  const pollPeriod = cfg.pollPeriodMs ?? DEFAULT_POLL_PERIOD_MS;
  const timeoutMs = Math.max(RECONCILIATION_TIMEOUT_FLOOR_MS, pollPeriod * RECONCILIATION_TIMEOUT_MULTIPLIER);
  if (state.reconcileStartedAt != null && now - state.reconcileStartedAt >= timeoutMs) {
    // Timed out with no confirming echo: accept whatever telemetry we do
    // have (if any — it just wasn't within tolerance) as the new truth,
    // rather than holding onto the never-confirmed dispatched value forever.
    const revertValue = telemetry && typeof telemetry.value === 'number' ? telemetry.value : state.rawValue;
    return toIdleFromTelemetry(state, revertValue);
  }

  return state;
}

/**
 * Detented's own Reconciliation logic: `state.pendingDispatchValue` here holds the
 * INDEX the Ring committed to (set by applyDetentedPostProcessing below), not a raw
 * number a numeric tolerance could compare against directly — an authored position
 * value is very often text. The echo/timeout/failure conditions are the same three,
 * in the same order, just matched by identity (String-coerced) against a position
 * instead of by numeric closeness.
 */
function applyDetentedReconciliation(state, cfg, telemetry, now, positions) {
  const matchAgainstPending = (value) => {
    const idx = matchPositionIndex(positions, value);
    return idx >= 0 && idx === state.pendingDispatchValue;
  };

  if (telemetry && telemetry.dispatchFailed) {
    const idx = matchPositionIndex(positions, telemetry.value);
    if (idx >= 0) return toIdleFromTelemetry(state, idx);
    return { ...toIdleFromTelemetry(state, state.rawValue), telemetryUnmatched: true, unmatchedValue: telemetry.value };
  }

  if (telemetry && telemetry.value !== undefined && telemetry.value !== null && matchAgainstPending(telemetry.value)) {
    return toIdleFromTelemetry(state, state.pendingDispatchValue);
  }

  const pollPeriod = cfg.pollPeriodMs ?? DEFAULT_POLL_PERIOD_MS;
  const timeoutMs = Math.max(RECONCILIATION_TIMEOUT_FLOOR_MS, pollPeriod * RECONCILIATION_TIMEOUT_MULTIPLIER);
  if (state.reconcileStartedAt != null && now - state.reconcileStartedAt >= timeoutMs) {
    if (telemetry && telemetry.value !== undefined && telemetry.value !== null) {
      const idx = matchPositionIndex(positions, telemetry.value);
      if (idx >= 0) return toIdleFromTelemetry(state, idx);
      return { ...toIdleFromTelemetry(state, state.rawValue), telemetryUnmatched: true, unmatchedValue: telemetry.value };
    }
    return toIdleFromTelemetry(state, state.rawValue);
  }

  return state;
}

function toIdleFromTelemetry(state, value) {
  return {
    ...state,
    phase: 'idle',
    rawValue: value,
    pendingDispatchValue: null,
    reconcileStartedAt: null,
    telemetryUnmatched: false,
    unmatchedValue: null
  };
}

/** Which bound (if either) `value` currently sits on. Tracked as a side
 * rather than a boolean so a knob resting at `min` (the common starting
 * position, since an unseeded value defaults to `min`) doesn't suppress the
 * cue the first time it's later turned all the way to `max`. */
function boundSideOf(value, min, max) {
  if (value === max) return 'max';
  if (value === min) return 'min';
  return null;
}

function deriveHaptics(state, cfg, min, max, emits) {
  const haptics = [];
  if (emits.some((e) => e.trigger === 'turnStart')) {
    haptics.push('turnStart');
  }
  const value = clamp(state.rawValue, min, max);
  const side = boundSideOf(value, min, max);
  const isTurnEmit = emits.some((e) => e.trigger === 'turn' || e.trigger === 'turnStart');
  if (side && side !== state.atBoundSide && isTurnEmit) {
    haptics.push('boundReached');
  }
  return haptics;
}

/**
 * Detented-only post-processing, run once per resolveRotary call after the shared
 * gesture/telemetry machinery above has produced this frame's `state`/`emits`
 * (`emits` still carries the raw index-space `value` those functions produced,
 * since they know nothing about positions). It:
 *   - maps that index-space value in every emit this frame onto the matching
 *     position's own authored `value` — the write triggers (`turn`/`turnEnd`)
 *     dispatch "OFF"/"L"/"BOTH" to the sim, never a bare index.
 *   - fires 'detent' (a step was crossed) and, additionally, 'limit' (the step
 *     crossed is either end of the list) as their own non-writing trigger AND
 *     haptic cue, exactly the "crossing a step or hitting a bound" split the
 *     ticket calls for.
 *   - springs a Momentary position back to the last non-Momentary one on
 *     release: arrival already reported the Momentary position itself (a
 *     magneto's START genuinely engages the instant it's reached), but the
 *     value this frame actually COMMITS — what the write triggers carry, and
 *     what a later telemetry echo is compared against — is whatever was held
 *     immediately before, or the control would read as stuck in START forever.
 */
function applyDetentedPostProcessing(state, positions, min, max, emits, previousDetentIndex, gestureEvent, ring) {
  // Idle, with the last telemetry reading matching no authored position: report
  // that reading verbatim, with nothing highlighted, for as long as nothing new
  // happens — never resolving to some earlier position and reading as though
  // the pointer never moved on. (This is the exact bug the old Selector had: a
  // value matching no position left its pointer aimed at the last valid one.)
  if (state.telemetryUnmatched && !gestureEvent) {
    return { state, emits, value: state.unmatchedValue, haptics: [], activeIndex: null };
  }

  const isTurnEmit = emits.some((e) => e.trigger === 'turn' || e.trigger === 'turnStart' || e.trigger === 'turnEnd');
  const index = clamp(Math.round(state.rawValue), min, max);
  const position = positions[index] || null;

  const haptics = [];
  const extraEmits = [];
  if (position && isTurnEmit && index !== previousDetentIndex) {
    extraEmits.push({ trigger: 'detent', payload: { value: position.value, delta: 0, direction: null, ring } });
    haptics.push('detent');
    // A ring with 2 (or fewer) positions has every index at both bounds
    // simultaneously — min===0 and max===positions.length-1 collapse onto the
    // same two indices — so without this guard 'limit' would fire on literally
    // every toggle, identically to 'detent', forever. Only rings with a real
    // middle (3+ positions) have a bound distinct from "the other end", so only
    // those ever emit 'limit'.
    if (positions.length > 2 && (index === min || index === max)) {
      extraEmits.push({ trigger: 'limit', payload: { value: position.value, delta: 0, direction: null, ring } });
      haptics.push('limit');
    }
  }

  const stableIndex = (position && !position.momentary) ? index : (state.stableIndex ?? index);
  const released = gestureEvent && gestureEvent.type === 'end';
  const springingBack = released && position && position.momentary;
  const finalIndex = springingBack ? stableIndex : index;
  const finalPosition = springingBack ? (positions[finalIndex] || null) : position;
  const finalValue = finalPosition ? finalPosition.value : state.rawValue;

  // Every emit this frame (turnStart/turn/turnEnd from the shared gesture
  // machinery above) reports the SAME resolved value — they're all one snapshot
  // of one resolveRotary() call. A spring-back overrides them all identically,
  // which is what makes turnEnd carry the sprung-back value rather than the
  // Momentary one it would otherwise have inherited from the gesture functions.
  const remappedEmits = emits.map((e) => ({ ...e, payload: { ...e.payload, value: finalValue } }));

  const nextState = {
    ...state,
    rawValue: finalIndex,
    detentIndex: finalIndex,
    telemetryUnmatched: false,
    unmatchedValue: null,
    stableIndex,
    pendingDispatchValue: state.phase === 'reconciling' ? finalIndex : state.pendingDispatchValue
  };

  return {
    state: nextState,
    emits: [...remappedEmits, ...extraEmits],
    value: finalValue,
    haptics,
    activeIndex: position ? finalIndex : null
  };
}

/**
 * The engine's single pure entry point. See the file header for the full
 * config/gestureEvent/telemetry shapes.
 */
export function resolveRotary(config, gestureEvent, telemetry, now) {
  const cfg = config || {};
  const { mode, min, max, positions } = resolveEffectiveRange(cfg);
  const ring = cfg.ringId ?? DEFAULT_RING_ID;
  const writeMode = resolveWriteMode(cfg.writeMode);
  const dispatchTiming = resolveDispatchTiming(cfg.dispatchTiming, writeMode);
  // Ticket 20: derived ONCE, here, and handed only to the two per-frame limiters.
  // Everything else below — reconciliation's elapsed-time math, the `reconcileStartedAt`
  // stamp it measures against — keeps the raw `now`, deliberately (see frameIdOf).
  const frameId = frameIdOf(now, resolveFrameQuantumMs(cfg.frameQuantumMs));

  let state = cfg.previousState || createRotaryState(cfg, telemetry);

  // Read AFTER state is resolved, not before: on a true cold call (no
  // cfg.previousState at all) `state` was just freshly built by
  // createRotaryState above, which now seeds its own `detentIndex` to the
  // index it starts at (see that function's own comment). Reading only
  // `cfg.previousState?.detentIndex` here would throw that seed away and fall
  // back to `null` on every cold-started Ring's very first call, right back
  // to the spurious first-grab detent/limit fire this was meant to fix.
  const previousDetentIndex = (state.detentIndex != null) ? state.detentIndex : null;

  // 1. Resolve any open Reconciliation window first, using this frame's
  //    telemetry, before this frame's gesture (if any) is applied.
  if (state.phase === 'reconciling') {
    state = applyReconciliation(state, cfg, telemetry, now, mode, positions);
  }

  // 2. Apply this frame's gesture. A fresh 'start' always wins over a
  //    lingering Reconciliation window — the user grabbing again is a
  //    stronger signal than an unconfirmed echo.
  let emits = [];
  if (gestureEvent) {
    if (gestureEvent.type === 'start' && state.phase === 'reconciling') {
      state = { ...state, phase: 'idle', pendingDispatchValue: null, reconcileStartedAt: null };
    }
    const gestureResult = processGesture(state, cfg, gestureEvent, now);
    state = gestureResult.state;
    emits = emits.concat(gestureResult.emits);
    // Every grab starts in the fine tier with a fresh rate sample, and a release
    // returns to it, so no rate of turn is ever carried from one gesture into the next.
    if (gestureEvent.type === 'start') state = { ...state, ...createAccelerationState(now) };
    else if (gestureEvent.type === 'end') state = { ...state, ...createAccelerationState() };
    if (state.phase === 'reconciling' && state.reconcileStartedAt == null) {
      state = { ...state, reconcileStartedAt: now };
    }
  } else if (state.phase === 'engaged') {
    // No gesture this call. A Ring whose finger has stopped moving produces no moves to
    // close a rate-measurement window, so an idle call closes it here instead: the tier
    // reported below then drops with the finger rather than reading coarse indefinitely.
    const gesture = resolveGesture(cfg.gesture);
    const fineFeel = resolveDegreesPerUnit(cfg.degreesPerUnit, gesture, writeMode);
    state = accelerateTravel(state, resolveAcceleration(cfg, gesture, writeMode, mode, fineFeel, now), 0).state;
  }

  // 2b. Pulse's per-frame coalescer: drains the coarse and fine Pulse queues
  //     into real 'turn' emits, capped per distinct frame id. Run unconditionally (even
  //     with no gestureEvent) so a call the Component makes purely to keep draining a
  //     queue after release still flushes whatever is left — see
  //     applyPulseFrameCoalescing's own comment. It runs before this call's telemetry is
  //     applied (step 3), so the coarse queue's bound check sees the previous call's
  //     value; telemetry stays after it because moving it ahead would change when the
  //     fine queue drains.
  if (writeMode === 'pulse') {
    const coalesced = applyPulseFrameCoalescing(state, frameId, min, max, mode, ring, {
      coarseIsFast: cfg.acceleration === true && cfg.accelerationFastEvents === true,
      checkBounds: !!cfg.hasReadableValue
    });
    state = coalesced.state;
    emits = emits.concat(coalesced.emits);
  }

  // 3. While idle (never engaged, or released-and-reconciled), telemetry is
  //    authoritative. While engaged or reconciling, it is not (checklist
  //    item: "While a Rotary is engaged, inbound telemetry does not override
  //    its value; once released and reconciled, it does.") -- that rule is about
  //    Absolute mode specifically: an engaged Absolute Ring OWNS a value, so
  //    telemetry overwriting it mid-drag would be the sim fighting the user's
  //    finger. Ticket 19: Pulse owns no value at all (processPulseGesture never
  //    writes rawValue -- see its own header comment), so there is nothing for
  //    telemetry to fight while a Pulse Ring is engaged either; it is the ONLY
  //    source of truth for what to display, exactly as it already is while idle.
  //    Widened below rather than replacing the 'idle' check, so Absolute's
  //    engaged freeze is completely untouched. No readable value bound means
  //    there is nothing trustworthy to show, so a blind Pulse Ring stays blind.
  const telemetryFollowsWhileEngaged =
    state.phase === 'engaged' && writeMode === 'pulse' && !!cfg.hasReadableValue;
  if ((state.phase === 'idle' || telemetryFollowsWhileEngaged) && telemetry && !telemetry.dispatchFailed) {
    if (mode === 'detented') {
      // See createRotaryState's own comment: matched by coerced identity, so any
      // defined value is eligible, not only a number.
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

  // 4. Resolve this frame's display value/angle/haptics/extra triggers.
  //    Detented is different enough (index/position mapping, the
  //    detent/limit/Momentary vocabulary) that it gets its own dedicated step
  //    rather than folding into the numeric Bounded/Continuous path below.
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

  // 4b. Absolute write mode's own dispatch timing + per-frame rate limiting (ticket
  //     05), applied as the LAST thing before returning — see applyDispatchTiming's
  //     and applyAbsoluteFrameCap's own comments for why the ordering matters
  //     (Detented post-processing and Bounded/Continuous haptics above have already
  //     consumed the un-capped emits by this point). Pulse mode's own cap already ran
  //     earlier (2b) since it needs to run before telemetry/Detented remapping, not
  //     after — Pulse never reaches this branch.
  if (writeMode === 'absolute') {
    const timed = applyDispatchTiming(state, dispatchTiming, emits, gestureEvent, value, mode === 'detented');
    const capped = applyAbsoluteFrameCap(timed.state, frameId, timed.emits);
    state = capped.state;
    emits = capped.emits;
  }

  const span = max - min;
  const sweep = cfg.sweepDegrees ?? DEFAULT_SWEEP_DEGREES;
  let angle;
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
    // Ticket 04: which authored position (by index into cfg.positions) is
    // currently active, when rangeMode is 'detented' — null in every other
    // mode, and null in Detented too when telemetry matches no position. A
    // top-level field alongside activeRing/tier, deliberately NOT read off the
    // opaque `state` bag (see the file header: state is for threading only).
    activePosition,
    emits,
    haptics,
    state
  };
}
