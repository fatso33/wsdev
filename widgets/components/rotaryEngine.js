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
  advanceRawValue,
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
  DEFAULT_MIN_EFFECTIVE_RADIUS,
  processArcGesture,
  processScrubGesture,
  processTapGesture,
  shortestAngleDeltaDeg
} from './rotary/rotaryGestures.js';

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

// Deliberate implementation choice, not a value from the spec: caps how many
// discrete Pulse steps a single resolveRotary() call will hand back as real 'turn'
// emits when several calls share the same `now` (i.e. land inside one animation
// frame, per RotaryComponent's frame scheduling). A fast flick can cross far more
// steps than this in one frame; the excess is queued in `state.pulsePendingSteps` (fine
// steps) or `state.pulsePendingCoarseSteps` (steps taken in Acceleration's coarse tier)
// and drained on later calls (see applyPulseFrameCoalescing) rather than discarded —
// this is what makes "never drops steps" hold while still bounding how many writes
// (and downstream re-renders elsewhere in the app) happen in one paint.
const MAX_PULSE_STEPS_PER_FRAME = 4;

// Ticket 20. Both per-frame limiters above used to decide "same frame?" by comparing
// the raw `now` they were handed for exact equality. One resolveRotary() call happens
// per real pointermove event, each with its own fresh timestamp, so two calls never
// produced identical floats: `sameFrame` was always false and the per-frame budget
// reset on every single pointer event. The cap was therefore per-EVENT, not per-frame —
// effective ceiling `4 x pointer-event-rate` rather than `4 x 60`, which is how a live
// fast turn measured 635 dispatches/sec against a design ceiling of ~240.
//
// Fixed by deriving a quantized frame id from `now` and comparing THAT. The quantum is
// a config value rather than a hardcoded constant for two reasons:
//   - the engine takes `now` as an abstract monotonic unit (see the file header), so
//     a fixed 16.7ms bucket would silently rewrite what "distinct timestamps" means
//     for every existing test that drives small integers;
//   - passing `frameQuantumMs: 0` therefore means "exact equality, as before", which is
//     how a test states that intent explicitly instead of relying on the default
//     happening to be finer than its own spacing.
// Quantized buckets are NOT real browser frames, so two moves straddling a boundary can
// both write. Accepted deliberately (ticket 20): this is a safety valve against a burst,
// not a precision instrument — occasionally passing one extra write costs nothing, while
// dropping a Pulse step would cost correctness.
const DEFAULT_FRAME_QUANTUM_MS = 1000 / 60;

/** Same fallback-on-garbage convention as resolveDegreesPerUnit. A negative or
 * non-finite quantum has no meaning, so it falls back to the default rather than to 0 —
 * exact-equality mode has to be asked for deliberately, never arrived at by accident. */
function resolveFrameQuantumMs(raw) {
  const n = Number(raw ?? DEFAULT_FRAME_QUANTUM_MS);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_FRAME_QUANTUM_MS;
  return n;
}

/**
 * The frame-identity bucket `now` falls in — the ONLY thing the two per-frame limiters
 * compare. Deliberately not used anywhere else: `now` is also the elapsed-time clock
 * applyReconciliation/applyDetentedReconciliation measure their timeout against
 * (`now - state.reconcileStartedAt >= timeoutMs`), and feeding a bucket index to that
 * math would turn a 250ms wait into a difference of ~15 and the window would never
 * close. Frame identity is quantized; the clock never is.
 */
function frameIdOf(now, quantumMs) {
  if (!(quantumMs > 0) || !Number.isFinite(now)) return now;
  return Math.floor(now / quantumMs);
}

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
 * Ticket 05's own state fields, shared by both createRotaryState() branches below —
 * factored out so the two branches (Detented vs. Bounded/Continuous) can't drift on
 * what a freshly-created Ring's Pulse/dispatch-timing bookkeeping starts at.
 *   - pulseAccumulator: fractional odometer for Pulse's step-crossing detection
 *     (see processPulseGesture) — NOT the value; it never survives past converting
 *     into whole steps.
 *   - pulsePendingSteps: whole Pulse steps queued but not yet handed back as 'turn'
 *     emits, drained by applyPulseFrameCoalescing.
 *   - pulsePendingCoarseSteps: the same, for steps taken in the coarse tier. Kept apart
 *     from pulsePendingSteps so the coalescer can drop a coarse queue whose bound the sim
 *     has since reported reached (the fine queue is never re-checked), and so that, with
 *     fast step events, a queued step stays a fast step after the Ring slows to the fine
 *     tier. Drained ahead of pulsePendingSteps.
 *   - pulseHoldForRelease: true while an 'onRelease'-timed Pulse gesture is still
 *     engaged — the coalescer holds pending steps rather than draining them.
 *   - frameStamp / frameEmitCount: the per-frame coalescer's own bookkeeping, shared
 *     between Absolute's cap and Pulse's cap (see applyAbsoluteFrameCap /
 *     applyPulseFrameCoalescing).
 *   - lastDispatchedStepIndex: Absolute's 'perDetent' dispatch timing's own
 *     step-crossing memory (see applyDispatchTiming).
 */
function createDispatchState() {
  return {
    pulseAccumulator: 0,
    pulsePendingSteps: 0,
    pulsePendingCoarseSteps: 0,
    pulseHoldForRelease: false,
    frameStamp: null,
    frameEmitCount: 0,
    lastDispatchedStepIndex: null
  };
}

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
 * Queues `steps` (a signed whole-step count — one whole step is one Pulse write) onto
 * `state.pulsePendingCoarseSteps` when `coarse` is true (the steps were taken in
 * Acceleration's coarse tier) and onto `state.pulsePendingSteps` otherwise, for the
 * per-frame coalescer (applyPulseFrameCoalescing, run once per resolveRotary call) to
 * drain into real 'turn' emits — capped per frame, never dropped by the cap; see that
 * function's own comment for why. The two queues are kept apart because only the
 * coarse one is re-checked against a bound after it is queued.
 *
 * Bounded-range advisory clamp (ticket 05 acceptance): a Bounded Ring in Pulse mode
 * stops QUEUEING further steps toward a limit only when `cfg.hasReadableValue` is
 * true, checked against `state.rawValue` — which in Pulse mode is written EXCLUSIVELY
 * by telemetry (see processPulseGesture's own header comment), never by a local count
 * of pulses already sent. That is what "never enforced from a locally-maintained
 * count" means: the moment anything else moves the value, this check sees the real
 * number, not a stale tally this Ring kept for itself. With no readable value at all,
 * there is nothing trustworthy to compare against, so every step is queued regardless
 * and the sim is left to clamp on its own end. Continuous never has a bound to check.
 *
 * Ticket 19: since resolveRotary now lets telemetry keep updating `state.rawValue`
 * while a Pulse Ring is engaged (not just while idle), this check is re-run every
 * call against whatever the sim reported most recently — never the value frozen at
 * grab time — with no change needed here. This function has always read the live
 * `state.rawValue`; it was resolveRotary withholding telemetry from it while engaged
 * that made it stale, and that is what ticket 19 fixes upstream of this function.
 */
function queuePulseSteps(state, cfg, steps, min, max, mode, coarse = false) {
  let allowedSteps = steps;
  if (steps !== 0 && mode !== 'continuous' && cfg.hasReadableValue && typeof state.rawValue === 'number') {
    const known = state.rawValue;
    if (steps > 0 && known >= max) allowedSteps = 0;
    else if (steps < 0 && known <= min) allowedSteps = 0;
  }
  if (allowedSteps === 0) return state;
  const queue = coarse ? 'pulsePendingCoarseSteps' : 'pulsePendingSteps';
  return { ...state, [queue]: (state[queue] ?? 0) + allowedSteps };
}

/**
 * Pulse write mode (ticket 05): the Ring emits one increment/decrement PER STEP
 * instead of ever computing/owning a value itself. `state.rawValue` is NEVER written
 * here — in Pulse mode it is only ever written by telemetry (resolveRotary's own
 * idle-follow step, unchanged) — so it always reflects the sim's own last-known
 * reading (or the unseeded default), never a locally accumulated guess a missed
 * step or a dispatch failure could desync from.
 *
 * The same angle/pixel math Arc/Scrub use for Absolute decides how many whole steps
 * a gesture crosses — reusing `degreesPerUnit` as the identical "Feel" knob is what
 * lets an Author switch Write Mode without reconfiguring Feel. `state.pulseAccumulator`
 * is a fractional odometer that exists ONLY to detect whole-step crossings (the same
 * role `lastPos` plays for angle tracking) — it is explicitly not "the value" either;
 * see queuePulseSteps' own comment on why that distinction matters for bounds.
 *
 * Tap has no continuous drag to accumulate, so it always steps by exactly 1 unit in
 * the tapped direction on release — the discrete-action shape a payware tap-to-pulse
 * control (many autopilot knobs) actually has.
 */
function processPulseGesture(state, cfg, gestureEvent, min, max, mode, ring, degPerUnit, gesture, accel) {
  if (gestureEvent.type === 'start') {
    const value = resolveDisplayValue(state.rawValue, min, max, mode);
    const next = {
      ...state,
      phase: 'engaged',
      lastPos: { dx: gestureEvent.dx, dy: gestureEvent.dy },
      pulseAccumulator: 0,
      pulseHoldForRelease: resolveDispatchTiming(cfg.dispatchTiming, 'pulse') === 'onRelease',
      tapDirection: gesture === 'tap' ? (gestureEvent.dx >= 0 ? 1 : -1) : state.tapDirection
    };
    return { state: next, emits: [{ trigger: 'turnStart', payload: { value, delta: 0, direction: null, ring } }] };
  }

  if (gestureEvent.type === 'move') {
    if (gesture === 'tap') return { state, emits: [] }; // Tap steps at release only.
    if (state.phase !== 'engaged' || !state.lastPos) return { state, emits: [] };

    const prev = state.lastPos;
    const curr = { dx: gestureEvent.dx, dy: gestureEvent.dy };
    let deltaValue;
    if (gesture === 'scrub') {
      deltaValue = (prev.dy - curr.dy) / degPerUnit;
    } else {
      const minRadius = cfg.minEffectiveRadius ?? DEFAULT_MIN_EFFECTIVE_RADIUS;
      const prevRadius = Math.hypot(prev.dx, prev.dy);
      const prevAngleRad = Math.atan2(prev.dy, prev.dx);
      const currAngleRad = Math.atan2(curr.dy, curr.dx);
      let deltaAngleDeg;
      if (prevRadius >= minRadius) {
        deltaAngleDeg = shortestAngleDeltaDeg(prevAngleRad, currAngleRad);
      } else {
        const tangentX = -Math.sin(prevAngleRad);
        const tangentY = Math.cos(prevAngleRad);
        const ddx = curr.dx - prev.dx;
        const ddy = curr.dy - prev.dy;
        const tangentialDisplacement = ddx * tangentX + ddy * tangentY;
        deltaAngleDeg = (tangentialDisplacement / minRadius) * (180 / Math.PI);
      }
      deltaValue = deltaAngleDeg / degPerUnit;
    }

    const stepped = accelerateTravel(state, accel, deltaValue);
    const accumulator = (state.pulseAccumulator ?? 0) + stepped.deltaValue;
    // Nudged by a tiny epsilon before truncating: the trig round-trip above (degrees
    // -> radians -> degrees) lands a value that SHOULD be an exact whole step (e.g.
    // exactly 10 degrees of arc at degreesPerUnit=10) a hair under it instead (e.g.
    // 0.999999999999999) often enough that Math.trunc() alone would silently eat a
    // genuine, deliberate whole-step turn. 1e-9 is far below any real sub-step gesture
    // magnitude, so it only ever absorbs float dust, never a real fractional turn.
    const EPS = 1e-9;
    const nudged = accumulator + (accumulator >= 0 ? EPS : -EPS);
    const steps = Math.trunc(nudged);
    const nextAccumulator = accumulator - steps;
    let next = { ...stepped.state, lastPos: curr, pulseAccumulator: nextAccumulator };
    if (steps !== 0) {
      next = queuePulseSteps(next, cfg, steps, min, max, mode, stepped.coarse);
    }
    return { state: next, emits: [] };
  }

  if (gestureEvent.type === 'end') {
    if (state.phase !== 'engaged') return { state, emits: [] };
    let next = state;
    if (gesture === 'tap') {
      const direction = state.tapDirection ?? 1;
      next = queuePulseSteps(next, cfg, direction, min, max, mode);
    }
    const value = resolveDisplayValue(next.rawValue, min, max, mode);
    next = {
      ...next,
      // Pulse owns no value, so there is nothing to reconcile a dispatched value
      // against — idle immediately; telemetry is always the sole source of truth
      // for what "the value" is, in every phase.
      phase: 'idle',
      lastPos: null,
      tapDirection: null,
      pulseAccumulator: 0,
      pulseHoldForRelease: false,
      pendingDispatchValue: null,
      reconcileStartedAt: null
    };
    return { state: next, emits: [{ trigger: 'turnEnd', payload: { value, delta: 0, direction: null, ring } }] };
  }

  return { state, emits: [] };
}

/**
 * The per-frame coalescer's Pulse half: drains the two Pulse queues,
 * `state.pulsePendingCoarseSteps` then `state.pulsePendingSteps`, into actual 'turn'
 * emits, one emit per whole step (the literal "one increment or
 * decrement per step" the acceptance criteria call for), capped at
 * MAX_PULSE_STEPS_PER_FRAME per distinct frame id. Calls sharing a frame id (many
 * gesture events landing inside one animation frame — ticket 20: a quantized bucket of
 * `now`, never raw `now`, see frameIdOf) share one cap; a new frame id resets it. A
 * fast flick that queues more steps than the cap allows is never
 * dropped by the cap: the remainder stays in its queue and drains on the NEXT call(s),
 * including calls the Component makes with no gesture at all, purely to keep
 * draining a queue after release (see RotaryComponent's frame scheduling).
 *
 * Held (emits nothing, cap untouched) while `state.pulseHoldForRelease` is true —
 * 'onRelease' dispatch timing's own gate; steps still queue during the gesture, they
 * just don't drain until it ends.
 *
 * The two queues (coarse steps, then fine steps) share the one per-frame cap. With fast
 * step events, emits from the coarse queue carry `payload.fast`, which is how the
 * Component knows to send the aircraft's fast step event for them.
 *
 * A coarse queue is re-checked against the bound every call: with a readable value, steps
 * toward a bound the sim already reports as reached are dropped, since one coarse fling
 * can queue far more than the distance left. The fine queue is never re-checked; it is
 * only bounded when its steps are queued (see queuePulseSteps).
 *
 * The check reads `state.rawValue` as the previous call left it, because resolveRotary
 * applies a call's telemetry after this runs. So up to one frame's cap of coarse steps
 * can still go out on the call that carries the bound reading, and the rest are dropped
 * on the next call. The fine queue's bound check, made when its steps are queued, lags
 * the sim's reading in the same way.
 *
 * @param {{coarseIsFast: boolean, checkBounds: boolean}} pulse - whether coarse steps are
 *   fast step events, and whether the sim reports a value to check a bound against.
 */
function applyPulseFrameCoalescing(state, frameId, min, max, mode, ring, pulse) {
  const sameFrame = state.frameStamp === frameId;
  const frameEmitCount = sameFrame ? (state.frameEmitCount ?? 0) : 0;
  let pendingCoarse = state.pulsePendingCoarseSteps ?? 0;
  const pending = state.pulsePendingSteps ?? 0;

  if (pulse.checkBounds && pendingCoarse !== 0 && mode !== 'continuous' && typeof state.rawValue === 'number') {
    if (pendingCoarse > 0 && state.rawValue >= max) pendingCoarse = 0;
    else if (pendingCoarse < 0 && state.rawValue <= min) pendingCoarse = 0;
  }

  if (state.pulseHoldForRelease || (pending === 0 && pendingCoarse === 0)) {
    return { state: { ...state, pulsePendingCoarseSteps: pendingCoarse, frameStamp: frameId, frameEmitCount }, emits: [] };
  }

  let capRemaining = Math.max(MAX_PULSE_STEPS_PER_FRAME - frameEmitCount, 0);
  const value = resolveDisplayValue(state.rawValue, min, max, mode);
  const emits = [];

  const drain = (queued, fast) => {
    const magnitude = Math.min(Math.abs(queued), capRemaining);
    const toEmit = Math.sign(queued) * magnitude;
    for (let i = 0; i < magnitude; i++) {
      emits.push({
        trigger: 'turn',
        payload: { value, delta: Math.sign(toEmit), direction: toEmit > 0 ? 'cw' : 'ccw', ring, ...(fast ? { fast: true } : {}) }
      });
    }
    capRemaining -= magnitude;
    return queued - toEmit;
  };
  const remainingCoarse = drain(pendingCoarse, pulse.coarseIsFast);
  const remaining = drain(pending, false);

  const next = {
    ...state,
    pulsePendingSteps: remaining,
    pulsePendingCoarseSteps: remainingCoarse,
    frameStamp: frameId,
    frameEmitCount: frameEmitCount + emits.length
  };
  return { state: next, emits };
}

/**
 * Absolute mode's own per-frame cap (ticket 05): "at most one value per animation
 * frame". Unlike Pulse, an Absolute 'turn' emit already carries the fully-resolved
 * value, so nothing is lost by only WRITING the latest one per frame — `state.rawValue`
 * itself keeps advancing on every call regardless (the visual angle always tracks the
 * finger exactly); only the emitted/written 'turn' is deduped down to one per distinct
 * frame id (ticket 20: a quantized bucket of `now`, never raw `now` — see frameIdOf;
 * comparing raw `now` is why this cap never engaged in production at all). Applied as
 * the very last step before resolveRotary returns, deliberately
 * AFTER Detented post-processing and the Bounded/Continuous haptics derivation have
 * both already consumed the un-capped emits — capping any earlier would make a
 * same-frame repeat move silently stop crossing detents/limits, not just stop writing.
 */
function applyAbsoluteFrameCap(state, frameId, emits) {
  const sameFrame = state.frameStamp === frameId;
  let frameEmitCount = sameFrame ? (state.frameEmitCount ?? 0) : 0;
  const filtered = [];
  for (const emit of emits) {
    if (emit.trigger !== 'turn') {
      filtered.push(emit);
      continue;
    }
    if (frameEmitCount >= 1) continue; // Suppressed — a later frame id gets the next write.
    frameEmitCount += 1;
    filtered.push(emit);
  }
  return { state: { ...state, frameStamp: frameId, frameEmitCount }, emits: filtered };
}

/**
 * Applies Absolute write mode's chosen dispatch timing to the FINAL 'turn' emits for
 * this call — never to turnStart/turnEnd/detent/limit, which always fire on their own
 * schedule. Run, like applyAbsoluteFrameCap, as one of the very last steps before
 * resolveRotary returns, for the identical reason: filtering 'turn' out any earlier
 * would rob Detented post-processing / haptics derivation of the `isTurnEmit` signal
 * they need to still fire detent/limit notifications on a filtered-out move.
 *
 * 'onChange' is a no-op — every real move's 'turn' already passes through (subject
 * only to the frame cap above). 'onRelease' drops every 'turn' produced while still
 * engaged; the value only ever leaves via turnEnd. 'perDetent' keeps only the 'turn'
 * that actually crosses a whole `degreesPerUnit`-sized step (Math.trunc(value)
 * changing), the same odometer idea Pulse's own crossing detection uses, so a slow
 * sub-step wobble does not spam writes.
 */
function applyDispatchTiming(state, timing, emits, gestureEvent, value, isDetented) {
  if (gestureEvent && gestureEvent.type === 'start') {
    // Seed the step-crossing baseline at grab time, regardless of the chosen timing
    // (mirrors Detented's own `detentIndex` grab-time seed, same reasoning) — this is
    // what stops 'perDetent''s very first move, however small, from misreading as
    // "a step was crossed" just because nothing was recorded yet.
    const EPS = 1e-9;
    return { state: { ...state, lastDispatchedStepIndex: Math.trunc(value + (value >= 0 ? EPS : -EPS)) }, emits };
  }

  if (timing === 'onChange') return { state, emits };

  if (timing === 'onRelease') {
    if (!gestureEvent || gestureEvent.type !== 'move') return { state, emits };
    return { state, emits: emits.filter((e) => e.trigger !== 'turn') };
  }

  // 'perDetent': doesn't apply to Detented range mode — its value is a string
  // position, already quantized by definition, so there's no fractional wobble to
  // gate against; every 'turn' it produces already IS a whole-step crossing.
  if (isDetented) return { state, emits };
  if (!gestureEvent || gestureEvent.type !== 'move') return { state, emits };
  const hasTurn = emits.some((e) => e.trigger === 'turn');
  if (!hasTurn) return { state, emits };
  // Same float-dust nudge as Pulse's own step-crossing odometer (see
  // processPulseGesture's comment) — the Arc/Scrub trig round-trip can land an
  // intended-exact whole step a hair under it.
  const EPS = 1e-9;
  const currentStep = Math.trunc(value + (value >= 0 ? EPS : -EPS));
  const lastStep = state.lastDispatchedStepIndex ?? currentStep;
  if (lastStep === currentStep) {
    return { state, emits: emits.filter((e) => e.trigger !== 'turn') };
  }
  return { state: { ...state, lastDispatchedStepIndex: currentStep }, emits };
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
