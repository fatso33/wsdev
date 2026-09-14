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
 * already part of the return shape for that reason, even though this ticket
 * only ever produces a single ring and a single ("base") tier.
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
 *     degreesPerUnit: number,      // arc degrees that move the value by 1 unit (default 1)
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
 *     ringId: string,              // echoed back as `activeRing` (default 'default')
 *     tier: string,                // echoed back as `tier` (default 'base' — ticket 06
 *                                  // is what actually varies this)
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

const DEFAULT_MIN = 0;
const DEFAULT_MAX = 100;
const DEFAULT_MIN_EFFECTIVE_RADIUS = 24;
const DEFAULT_DEGREES_PER_UNIT = 1;
const DEFAULT_SWEEP_DEGREES = 270;
const DEFAULT_POLL_PERIOD_MS = 1000; // matches the normal 1Hz poll tier (CLAUDE.md)
const DEFAULT_RING_ID = 'default';
const DEFAULT_TIER = 'base';

// Deliberate implementation choices, not values pulled from the spec:
// - The floor stops the Reconciliation window collapsing to a near-zero
//   duration even on a very fast poll tier.
// - "roughly twice" the poll period, per the ticket, so at least one full
//   telemetry tick has a chance to arrive and echo back before we give up.
const RECONCILIATION_TIMEOUT_FLOOR_MS = 250;
const RECONCILIATION_TIMEOUT_MULTIPLIER = 2;

function clamp(value, min, max) {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  return Math.min(hi, Math.max(lo, value));
}

/** Shortest signed angular difference from `fromRad` to `toRad`, in degrees,
 * in the range (-180, 180]. Exact — no small-angle approximation. */
function shortestAngleDeltaDeg(fromRad, toRad) {
  const twoPi = Math.PI * 2;
  let d = toRad - fromRad;
  d = ((d + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
  return d * (180 / Math.PI);
}

/**
 * Builds the state bag for a Rotary that has never been engaged before.
 * Exported so a caller can seed `config.previousState` on its very first call
 * without needing to know the bag's internal shape ahead of time.
 */
export function createRotaryState(config, telemetry) {
  const cfg = config || {};
  const min = cfg.min ?? DEFAULT_MIN;
  const max = cfg.max ?? DEFAULT_MAX;
  const seeded = telemetry && typeof telemetry.value === 'number';
  const rawValue = seeded ? telemetry.value : (cfg.initialValue ?? min);
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
    // boundReached cue.
    atBoundSide: boundSideOf(clamp(rawValue, min, max), min, max)
  };
}

/**
 * Resolves this frame's gesture (start/move/end) against the current state.
 * Arc is a *relative* gesture (ADR 0001): the Ring accumulates the tangential
 * component of the finger's movement, never the finger's absolute angle. Near
 * the center, the true radius is floored to `minEffectiveRadius` when turning
 * that tangential displacement into an angle — dividing by the floor instead
 * of the (possibly tiny) real radius is what prevents a grab near the center
 * from spinning the Ring out wildly for a small physical finger movement.
 */
function processGesture(state, cfg, gestureEvent) {
  const min = cfg.min ?? DEFAULT_MIN;
  const max = cfg.max ?? DEFAULT_MAX;
  const degPerUnit = cfg.degreesPerUnit ?? DEFAULT_DEGREES_PER_UNIT;
  const minRadius = cfg.minEffectiveRadius ?? DEFAULT_MIN_EFFECTIVE_RADIUS;
  const ring = cfg.ringId ?? DEFAULT_RING_ID;

  if (gestureEvent.type === 'start') {
    const next = {
      ...state,
      phase: 'engaged',
      lastPos: { dx: gestureEvent.dx, dy: gestureEvent.dy },
      pendingDispatchValue: null,
      reconcileStartedAt: null
    };
    const value = clamp(state.rawValue, min, max);
    return {
      state: next,
      emits: [{ trigger: 'turnStart', payload: { value, delta: 0, direction: null, ring } }]
    };
  }

  if (gestureEvent.type === 'move') {
    if (state.phase !== 'engaged' || !state.lastPos) {
      return { state, emits: [] };
    }
    const prev = state.lastPos;
    const curr = { dx: gestureEvent.dx, dy: gestureEvent.dy };
    const prevRadius = Math.hypot(prev.dx, prev.dy);
    const prevAngleRad = Math.atan2(prev.dy, prev.dx);
    const currAngleRad = Math.atan2(curr.dy, curr.dx);

    let deltaAngleDeg;
    if (prevRadius >= minRadius) {
      // At or beyond the radius floor: track the exact angular change,
      // however large this move's step is — no small-angle approximation.
      deltaAngleDeg = shortestAngleDeltaDeg(prevAngleRad, currAngleRad);
    } else {
      // Below the radius floor: a tiny physical finger movement can produce
      // a huge *exact* angular change purely because of the small
      // denominator near the origin (ADR 0001's "angular error explodes
      // near the centre"). Instead, treat the movement as though it
      // happened at the radius floor: project the physical (tangential)
      // displacement — the part of the raw movement perpendicular to the
      // radius, i.e. actually rotational rather than radial — onto the
      // floor radius rather than the true (tiny) one. This is what keeps a
      // near-center grab from spinning the Ring out of control, and gives
      // the same result for the same physical finger movement regardless of
      // exactly how close to the center the grab was.
      const tangentX = -Math.sin(prevAngleRad);
      const tangentY = Math.cos(prevAngleRad);
      const ddx = curr.dx - prev.dx;
      const ddy = curr.dy - prev.dy;
      const tangentialDisplacement = ddx * tangentX + ddy * tangentY;
      deltaAngleDeg = (tangentialDisplacement / minRadius) * (180 / Math.PI);
    }
    const deltaValue = deltaAngleDeg / degPerUnit;

    // Accumulate into the *unclamped* raw value, never the clamped display
    // value. This is what makes a bound reached mid-gesture behave like a
    // physical end-stop: continuing to turn past the limit is "absorbed" and
    // has to be wound back before the value moves again, rather than the
    // knob instantly snapping to follow the finger the moment it reverses.
    const rawValue = state.rawValue + deltaValue;
    const value = clamp(rawValue, min, max);
    const next = { ...state, rawValue, lastPos: curr };

    const emits = [];
    if (deltaValue !== 0) {
      emits.push({
        trigger: 'turn',
        payload: { value, delta: deltaValue, direction: deltaValue > 0 ? 'cw' : 'ccw', ring }
      });
    }
    return { state: next, emits };
  }

  if (gestureEvent.type === 'end') {
    if (state.phase !== 'engaged') {
      return { state, emits: [] };
    }
    const value = clamp(state.rawValue, min, max);
    const next = {
      ...state,
      phase: 'reconciling',
      lastPos: null,
      pendingDispatchValue: value,
      reconcileStartedAt: null // stamped with `now` by resolveRotary
    };
    return {
      state: next,
      emits: [{ trigger: 'turnEnd', payload: { value, delta: 0, direction: null, ring } }]
    };
  }

  return { state, emits: [] };
}

/**
 * Checks the three Reconciliation-window release conditions, in the order
 * the ticket specifies, and releases on the first one that's true:
 *   1. a dispatch failure — revert to telemetry immediately, don't wait.
 *   2. telemetry echoing the dispatched value within tolerance.
 *   3. a timeout derived from the actual poll period (never a hardcoded
 *      constant on its own — always `max(floor, pollPeriod * 2)`).
 */
function applyReconciliation(state, cfg, telemetry, now) {
  if (state.phase !== 'reconciling') {
    return state;
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

function toIdleFromTelemetry(state, value) {
  return {
    ...state,
    phase: 'idle',
    rawValue: value,
    pendingDispatchValue: null,
    reconcileStartedAt: null
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
 * The engine's single pure entry point. See the file header for the full
 * config/gestureEvent/telemetry shapes.
 */
export function resolveRotary(config, gestureEvent, telemetry, now) {
  const cfg = config || {};
  const min = cfg.min ?? DEFAULT_MIN;
  const max = cfg.max ?? DEFAULT_MAX;
  const ring = cfg.ringId ?? DEFAULT_RING_ID;

  let state = cfg.previousState || createRotaryState(cfg, telemetry);

  // 1. Resolve any open Reconciliation window first, using this frame's
  //    telemetry, before this frame's gesture (if any) is applied.
  if (state.phase === 'reconciling') {
    state = applyReconciliation(state, cfg, telemetry, now);
  }

  // 2. Apply this frame's gesture. A fresh 'start' always wins over a
  //    lingering Reconciliation window — the user grabbing again is a
  //    stronger signal than an unconfirmed echo.
  let emits = [];
  if (gestureEvent) {
    if (gestureEvent.type === 'start' && state.phase === 'reconciling') {
      state = { ...state, phase: 'idle', pendingDispatchValue: null, reconcileStartedAt: null };
    }
    const gestureResult = processGesture(state, cfg, gestureEvent);
    state = gestureResult.state;
    emits = emits.concat(gestureResult.emits);
    if (state.phase === 'reconciling' && state.reconcileStartedAt == null) {
      state = { ...state, reconcileStartedAt: now };
    }
  }

  // 3. While idle (never engaged, or released-and-reconciled), telemetry is
  //    authoritative. While engaged or reconciling, it is not (checklist
  //    item: "While a Rotary is engaged, inbound telemetry does not override
  //    its value; once released and reconciled, it does.").
  if (state.phase === 'idle' && telemetry && typeof telemetry.value === 'number' && !telemetry.dispatchFailed) {
    state = { ...state, rawValue: telemetry.value };
  }

  const value = clamp(state.rawValue, min, max);
  const haptics = deriveHaptics(state, cfg, min, max, emits);
  state = { ...state, atBoundSide: boundSideOf(value, min, max) };

  const span = max - min;
  const sweep = cfg.sweepDegrees ?? DEFAULT_SWEEP_DEGREES;
  const angle = span === 0 ? 0 : ((value - min) / span) * sweep;

  return {
    value,
    angle,
    activeRing: ring,
    tier: cfg.tier ?? DEFAULT_TIER,
    emits,
    haptics,
    state
  };
}
