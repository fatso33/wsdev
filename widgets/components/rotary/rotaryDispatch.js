/**
 * @module rotaryDispatch
 * Pure Pulse gesture/queue transitions and Pulse/Absolute write filtering. The
 * facade supplies one caller-threaded state bag and clock; this module retains no
 * state, schedules no frames, and performs no writes or other external effects.
 * Input state and emit arrays are never mutated. Callers supply resolved range,
 * gesture, Feel and acceleration settings. Apart from frame-quantum normalization,
 * helpers assume those internal contracts and propagate invalid-input exceptions.
 */

import { accelerateTravel } from './rotaryAcceleration.js';
import { resolveDispatchTiming, resolveDisplayValue } from './rotaryConfig.js';
import { DEFAULT_MIN_EFFECTIVE_RADIUS, shortestAngleDeltaDeg } from './rotaryGestures.js';

// Deliberate implementation choice, not a value from the spec: caps how many
// discrete Pulse steps a single resolveRotary() call will hand back as real 'turn'
// emits when several calls share the same quantized frame identity. A fast flick
// can cross far more
// steps than this in one frame; the excess is queued in `state.pulsePendingSteps` (fine
// steps) or `state.pulsePendingCoarseSteps` (steps taken in Acceleration's coarse tier)
// and drained on later calls (see applyPulseFrameCoalescing) rather than discarded —
// this is what makes "never drops steps" hold while still bounding how many writes
// (and downstream re-renders elsewhere in the app) happen in one paint.
const MAX_PULSE_STEPS_PER_FRAME = 4;

// Pointer events have distinct timestamps even within one paint. Quantization makes
// them share a write budget: four Pulse steps per 1000/60 ms bucket is about 240/s.
// The configurable quantum uses the caller's clock units; zero explicitly requests
// exact timestamp equality for synthetic clocks.
// Quantized buckets are NOT real browser frames, so two moves straddling a boundary can
// both write. This is a safety valve against a burst,
// not a precision instrument — occasionally passing one extra write costs nothing, while
// dropping a Pulse step would cost correctness.
const DEFAULT_FRAME_QUANTUM_MS = 1000 / 60;

/** Same fallback-on-garbage convention as resolveDegreesPerUnit. A negative or
 * non-finite quantum has no meaning, so it falls back to the default rather than to 0 —
 * exact-equality mode has to be asked for deliberately, never arrived at by accident.
 * Returns a nonnegative numeric width in caller-clock units (normally milliseconds).
 * Number coercion is intentional; uncoercible inputs propagate its exception.
 */
export function resolveFrameQuantumMs(raw) {
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
 * Returns floor(now / quantumMs), or unchanged now for a nonpositive quantum or
 * nonfinite timestamp. Both numeric inputs use the same clock units; no state changes.
 */
export function frameIdOf(now, quantumMs) {
  if (!(quantumMs > 0) || !Number.isFinite(now)) return now;
  return Math.floor(now / quantumMs);
}

/**
 * Returns fresh dispatch fields for both facade state-seeding branches (Detented
 * and Bounded/Continuous), without retaining a separate store. Takes no inputs.
 *   - pulseAccumulator: fractional odometer for Pulse's step-crossing detection
 *     (see processPulseGesture) — NOT the value; whole steps enter the queues and
 *     the fractional remainder survives until release or a fresh grab.
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
export function createDispatchState() {
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
 * Queues `steps` (a signed whole-step count — one whole step is one Pulse write) onto
 * `state.pulsePendingCoarseSteps` when `coarse` is true (the steps were taken in
 * Acceleration's coarse tier) and onto `state.pulsePendingSteps` otherwise, for the
 * per-frame coalescer (applyPulseFrameCoalescing, run once per resolveRotary call) to
 * drain into real 'turn' emits — capped per frame, never dropped by the cap; see that
 * function's own comment for why. The two queues are kept apart because only the
 * coarse one is re-checked against a bound after it is queued.
 *
 * Bounded-range advisory clamp: a Bounded Ring in Pulse mode
 * stops QUEUEING further steps toward a limit only when `cfg.hasReadableValue` is
 * true, checked against `state.rawValue` — which follows numeric Pulse telemetry,
 * never a local count
 * of pulses already sent. That is what "never enforced from a locally-maintained
 * count" means: the moment anything else moves the value, this check sees the real
 * number, not a stale tally this Ring kept for itself. With no readable value at all,
 * there is nothing trustworthy to compare against, so every step is queued regardless
 * and the sim is left to clamp on its own end. Continuous never has a bound to check.
 *
 * The facade follows readable Pulse telemetry while engaged as well as idle, after
 * this call's queueing and drainage. Bounds therefore use the previous call's reading.
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
 * Pulse write mode: the Ring emits one increment/decrement PER STEP
 * instead of ever computing/owning a value itself. `state.rawValue` is NEVER written
 * here — numeric Pulse telemetry following in resolveRotary supplies the value —
 * so it reflects the sim's own last-known
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
 *
 * Receives caller state/config, a start/move/end pointer event (dx/dy in pixels),
 * resolved numeric min/max and range mode, ring identity, signed fine Feel
 * (degrees or pixels per step), gesture name, and this call's acceleration settings.
 * Returns {state, emits}: copied transitions for phase, pointer, accumulator, queues
 * and release fields, plus start/end payloads. Whole-step turn emits are deferred
 * to the coalescer. Unhandled events and inactive moves/releases return unchanged state.
 */
export function processPulseGesture(state, cfg, gestureEvent, min, max, mode, ring, degPerUnit, gesture, accel) {
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
 * emits, one increment or decrement per whole step, capped at
 * MAX_PULSE_STEPS_PER_FRAME per distinct frame id. Calls sharing a frame id (many
 * gesture events landing inside one quantized bucket of
 * `now`, never raw `now`, see frameIdOf) share one cap; a new frame id resets it. A
 * fast flick that queues more steps than the cap allows is never
 * dropped by the cap: the remainder stays in its queue and drains on the NEXT call(s),
 * including calls the Component makes with no gesture at all, purely to keep
 * draining a queue after release (see RotaryComponent's frame scheduling).
 *
 * Held (emits nothing, consumes no budget) while `state.pulseHoldForRelease` is true —
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
 * Receives caller state, frame identity, resolved numeric bounds/range mode and ring
 * identity. Returns {state, emits} with remaining signed queues and shared frame
 * stamp/count. Emit payloads carry display value, unit delta, direction, ring and
 * optional fast tag. Input state is not mutated, including on held or empty calls.
 *
 * @param {{coarseIsFast: boolean, checkBounds: boolean}} pulse - whether coarse steps are
 *   fast step events, and whether the sim reports a value to check a bound against.
 */
export function applyPulseFrameCoalescing(state, frameId, min, max, mode, ring, pulse) {
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
 * Absolute mode's per-frame cap retains the first 'turn' in each frame identity,
 * suppressing later turns without queueing them. The fully-resolved `state.rawValue`
 * keeps advancing on every call regardless, so the visual angle tracks the finger.
 * Frame identity is a quantized bucket of `now`, never the elapsed-time clock.
 * Applied as the very last step before resolveRotary returns, deliberately
 * AFTER Detented post-processing and the Bounded/Continuous haptics derivation have
 * both already consumed the un-capped emits — capping any earlier would make a
 * same-frame repeat move silently stop crossing detents/limits, not just stop writing.
 * Takes caller state, frame identity and ordered emits; returns {state, emits} with
 * updated shared frame stamp/count and a filtered array. Non-turn emits keep their
 * order and identity; inputs are not mutated.
 */
export function applyAbsoluteFrameCap(state, frameId, emits) {
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
 * only to the frame cap above). 'onRelease' drops move-time 'turn' emits while
 * preserving release emits, including Tap's release-time turn and turnEnd.
 * 'perDetent' keeps only the 'turn'
 * that actually crosses a whole display-value unit (Math.trunc(value)
 * changing), the same odometer idea Pulse's own crossing detection uses, so a slow
 * sub-step wobble does not spam writes.
 * Takes caller state, resolved timing, ordered emits, optional pointer event, final
 * display/authored value and a Detented flag. Returns {state, emits}, seeding or
 * advancing lastDispatchedStepIndex and filtering only turn emits. Detented values
 * bypass the numeric move gate; input state and arrays are not mutated.
 */
export function applyDispatchTiming(state, timing, emits, gestureEvent, value, isDetented) {
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
