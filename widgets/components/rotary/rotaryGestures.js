/**
 * @module rotaryGestures
 * Pure Absolute Arc, Scrub, and Tap gesture interpretation. The caller owns the
 * threaded Rotary state and clock; this module owns no timers or mutable store.
 * Pulse reuses the radius and angular-delta helpers through named imports.
 */

import { accelerateTravel, advanceRawValue } from './rotaryAcceleration.js';
import { resolveDisplayValue } from './rotaryConfig.js';

/**
 * Default pixel radius below which Arc projects tangential travel onto the floor;
 * roughly a fingertip contact radius (ADR 0001).
 */
export const DEFAULT_MIN_EFFECTIVE_RADIUS = 24;

/**
 * Converts two pointer angles in radians to the shortest signed turn in degrees,
 * in [-180, 180). Exact angular normalization avoids small-angle error and does
 * not mutate either input.
 */
export function shortestAngleDeltaDeg(fromRad, toRad) {
  const twoPi = Math.PI * 2;
  let d = toRad - fromRad;
  d = ((d + Math.PI) % twoPi + twoPi) % twoPi - Math.PI;
  return d * (180 / Math.PI);
}

/**
 * The 'start' handling shared by Arc and Scrub: both are continuous drags that
 * simply begin tracking the pointer's position, with no value change yet — a
 * grab alone changes nothing. Tap has its own 'start' (below): it additionally
 * has to decide which way a tap at this position will move the value.
 */
function startContinuousDrag(state, min, max, mode, ring, gestureEvent) {
  const next = {
    ...state,
    phase: 'engaged',
    lastPos: { dx: gestureEvent.dx, dy: gestureEvent.dy },
    pendingDispatchValue: null,
    reconcileStartedAt: null
  };
  const value = resolveDisplayValue(state.rawValue, min, max, mode);
  return {
    state: next,
    emits: [{ trigger: 'turnStart', payload: { value, delta: 0, direction: null, ring } }]
  };
}

/**
 * The 'end' handling shared by Arc and Scrub: release the drag and open the
 * Reconciliation window on whatever value dragging has already accumulated.
 * Tap has its own 'end' (below): its value change happens AT release, not
 * during a 'move' that never occurs, so it emits an additional 'turn' first.
 */
function endContinuousDrag(state, min, max, mode, ring) {
  if (state.phase !== 'engaged') {
    return { state, emits: [] };
  }
  const value = resolveDisplayValue(state.rawValue, min, max, mode);
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

/**
 * Arc is a relative gesture (ADR 0001): the Ring accumulates the tangential
 * component of the finger's movement, never the finger's absolute angle. Near
 * the center, the true radius is floored to `minEffectiveRadius` when turning
 * that tangential displacement into an angle — dividing by the floor instead
 * of the (possibly tiny) real radius is what prevents a grab near the center
 * from spinning the Ring out wildly for a small physical finger movement.
 * `state` is the caller-threaded bag, `cfg` supplies the optional radius floor,
 * `gestureEvent` has type and center-relative pixel coordinates, and min/max/mode
 * define the display range. `ring` labels emitted payloads, `degPerUnit` converts
 * angular travel to value units, and `accel` controls the optional coarse tier.
 * Returns the next state and zero or one ordered trigger; unsupported events and
 * moves without an engaged grab return the original state with no emits.
 */
export function processArcGesture(state, cfg, gestureEvent, min, max, mode, ring, degPerUnit, accel) {
  const minRadius = cfg.minEffectiveRadius ?? DEFAULT_MIN_EFFECTIVE_RADIUS;

  if (gestureEvent.type === 'start') {
    return startContinuousDrag(state, min, max, mode, ring, gestureEvent);
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
    const stepped = accelerateTravel(state, accel, deltaAngleDeg / degPerUnit);
    const deltaValue = stepped.deltaValue;

    // Accumulate into the *unclamped* raw value, never the clamped display
    // value. This is what makes a bound reached mid-gesture behave like a
    // physical end-stop: continuing to turn past the limit is "absorbed" and
    // has to be wound back before the value moves again, rather than the
    // knob instantly snapping to follow the finger the moment it reverses.
    const rawValue = advanceRawValue(state.rawValue, deltaValue, stepped.coarse, min, max, mode);
    const value = resolveDisplayValue(rawValue, min, max, mode);
    const next = { ...stepped.state, rawValue, lastPos: curr };

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
    return endContinuousDrag(state, min, max, mode, ring);
  }

  return { state, emits: [] };
}

/**
 * Scrub is a linear drag along one axis, like a trim or VS wheel.
 * Dragging UP (finger's dy decreasing) increases the value,
 * mirroring a vertical slider; `degreesPerUnit` is reinterpreted here as
 * pixels of drag per unit, not degrees of arc — there is no angle involved.
 * No radius/minimum-effective-radius concept applies: a linear drag has no
 * center to measure a radius from.
 * `state` is the caller-threaded bag; `gestureEvent` supplies center-relative
 * pixel coordinates, min/max/mode define the range, `ring` labels payloads,
 * `degPerUnit` is pixels per value unit, and `accel` controls the coarse tier.
 * Returns the next state and ordered triggers; moves outside an engaged drag and
 * unsupported events leave state unchanged with no emits.
 */
export function processScrubGesture(state, cfg, gestureEvent, min, max, mode, ring, degPerUnit, accel) {
  if (gestureEvent.type === 'start') {
    return startContinuousDrag(state, min, max, mode, ring, gestureEvent);
  }

  if (gestureEvent.type === 'move') {
    if (state.phase !== 'engaged' || !state.lastPos) {
      return { state, emits: [] };
    }
    const prev = state.lastPos;
    const curr = { dx: gestureEvent.dx, dy: gestureEvent.dy };
    const deltaPixels = prev.dy - curr.dy; // up (dy decreasing) is positive
    const stepped = accelerateTravel(state, accel, deltaPixels / degPerUnit);
    const deltaValue = stepped.deltaValue;

    // Same "absorb the overshoot at a bound" behaviour as Arc: accumulate into
    // the unclamped raw value so reversing direction has to wind back through
    // whatever overshoot happened before the value actually moves again.
    const rawValue = advanceRawValue(state.rawValue, deltaValue, stepped.coarse, min, max, mode);
    const value = resolveDisplayValue(rawValue, min, max, mode);
    const next = { ...stepped.state, rawValue, lastPos: curr };

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
    return endContinuousDrag(state, min, max, mode, ring);
  }

  return { state, emits: [] };
}

/**
 * Tap is a discrete gesture with no drag required. A tap changes
 * the value by exactly one `degreesPerUnit`-sized step, in a direction decided
 * once, at grab, by which side of center the tap landed (dx >= 0 is the
 * increment side, matching a natural left/right split of the whole Face into
 * two large tap zones — comfortably sized for a finger because each zone is
 * the entire half of whatever layout box the Author gave the Rotary, not a
 * small button drawn inside it). Movement between start and end is ignored
 * entirely: a tap is defined by where it landed, not by any drift before
 * release, and "no drag required" does not mean a drag is disallowed.
 *
 * The step is applied AT RELEASE ('end'), not at grab — a tap is cancellable
 * the same way a button press is (nothing has committed until release) — and
 * is reported as its own 'turn' emit immediately before the 'turnEnd' emit in
 * the same call, since no intervening 'move' ever carries it. This keeps the
 * emitted trigger vocabulary and payload shape identical to Arc/Scrub: an
 * 'end' still always closes with a delta:0/direction:null 'turnEnd'.
 * `state` is the caller-threaded bag; `gestureEvent.dx` chooses the grab side,
 * min/max/mode define the range, `ring` labels payloads, and `degPerUnit` is the
 * magnitude of one value step. `cfg` is retained for the common gesture signature.
 * Returns the next state and ordered triggers; moves and unsupported events
 * leave state unchanged, and release without a grab emits nothing.
 */
export function processTapGesture(state, cfg, gestureEvent, min, max, mode, ring, degPerUnit) {
  if (gestureEvent.type === 'start') {
    const next = {
      ...state,
      phase: 'engaged',
      lastPos: { dx: gestureEvent.dx, dy: gestureEvent.dy },
      tapDirection: gestureEvent.dx >= 0 ? 1 : -1,
      pendingDispatchValue: null,
      reconcileStartedAt: null
    };
    const value = resolveDisplayValue(state.rawValue, min, max, mode);
    return {
      state: next,
      emits: [{ trigger: 'turnStart', payload: { value, delta: 0, direction: null, ring } }]
    };
  }

  if (gestureEvent.type === 'move') {
    // Tap has no drag phase — direction was already decided at grab.
    return { state, emits: [] };
  }

  if (gestureEvent.type === 'end') {
    if (state.phase !== 'engaged') {
      return { state, emits: [] };
    }
    // `Math.abs` deliberately: for Tap the step direction is *spatial* — which
    // half of the Face was tapped — so the general `degreesPerUnit` sign
    // convention documented on resolveDegreesPerUnit ("a negative value simply
    // reverses the turn direction") has nothing to reverse here. Honouring the
    // sign would silently swap which half increments, with no affordance
    // showing it. Only the magnitude is meaningful for Tap.
    const stepAmount = Math.abs(degPerUnit);
    const direction = state.tapDirection ?? 1;
    const deltaValue = direction * stepAmount;
    // Step from the CLAMPED current value, and store the result clamped — the
    // opposite of Arc/Scrub, deliberately. A continuous drag absorbs overshoot
    // at a bound so it has to be wound back, which reads as a physical
    // end-stop under a finger that is still moving. A tap is discrete and
    // independent: there is no continuous motion to feel wound back, so a
    // remembered unclamped raw value just silently eats the next taps in the
    // opposite direction (tapping up at max=20 then back down once would land
    // on 18 instead of 15).
    const value = resolveDisplayValue(resolveDisplayValue(state.rawValue, min, max, mode) + deltaValue, min, max, mode);
    const rawValue = value;

    const emits = [];
    if (deltaValue !== 0) {
      emits.push({
        trigger: 'turn',
        payload: { value, delta: deltaValue, direction: deltaValue > 0 ? 'cw' : 'ccw', ring }
      });
    }
    const next = {
      ...state,
      rawValue,
      phase: 'reconciling',
      lastPos: null,
      tapDirection: null,
      pendingDispatchValue: value,
      reconcileStartedAt: null // stamped with `now` by resolveRotary
    };
    emits.push({ trigger: 'turnEnd', payload: { value, delta: 0, direction: null, ring } });
    return { state: next, emits };
  }

  return { state, emits: [] };
}
