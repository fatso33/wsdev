/**
 * @module rotaryDetents
 * Pure Rotary position matching, detent post-processing, and bound haptics.
 * The caller threads one state bag through these transforms; this module owns
 * no clock, resources, or mutable state outside that returned bag.
 */

import { clamp } from './rotaryConfig.js';

/**
 * Finds a restable index for a cold-seeded Momentary position. Position entries
 * must already be filtered objects. If all are Momentary, the range minimum is
 * the only available fallback.
 *
 * @param {object[]} positions - Normalized authored positions.
 * @param {number} min - Minimum position index.
 * @returns {number} First non-Momentary index, or min.
 */
export function firstRestablePositionIndex(positions, min) {
  const idx = positions.findIndex((p) => !p.momentary);
  return idx >= 0 ? idx : min;
}

/**
 * Matches telemetry to authored positions by string identity because Enum-unit
 * SimVars may arrive as numbers while authored values are strings. The first
 * duplicate wins; absent or unmatched values yield -1.
 *
 * @param {object[]} positions - Normalized authored positions.
 * @param {*} rawValue - Telemetry or authored value to match.
 * @returns {number} Matching index or -1.
 */
export function matchPositionIndex(positions, rawValue) {
  if (rawValue === undefined || rawValue === null) return -1;
  return positions.findIndex((p) => String(p.value) === String(rawValue));
}

/**
 * Identifies the numeric bound occupied by a display value. Max takes precedence
 * when both endpoints coincide; interior values have no bound side.
 *
 * @param {number} value - Display value.
 * @param {number} min - Lower bound.
 * @param {number} max - Upper bound.
 * @returns {'min'|'max'|null} Occupied bound side.
 */
export function boundSideOf(value, min, max) {
  if (value === max) return 'max';
  if (value === min) return 'min';
  return null;
}

/**
 * Derives start and newly reached bound cues from uncapped emits. Tracking the
 * side suppresses repeated cues while resting at a bound but allows a later
 * transition to the opposite bound.
 *
 * @param {object} state - Caller-threaded Rotary state, including atBoundSide.
 * @param {object} cfg - Rotary configuration (retained call contract).
 * @param {number} min - Lower bound.
 * @param {number} max - Upper bound.
 * @param {object[]} emits - Current frame's uncapped trigger payloads.
 * @returns {string[]} Haptic cue names; state is not mutated.
 */
export function deriveHaptics(state, cfg, min, max, emits) {
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
 * Maps Detented index-space emits to authored values and adds detent/limit cues.
 * Only rings with three or more positions have distinct limit cues. On release,
 * a Momentary position commits the last stable index to state, all emitted
 * payloads, and the pending reconciliation index. Arrival at Momentary already
 * reported its own value on the preceding move.
 *
 * @param {object} state - Caller-threaded state after gesture and telemetry steps.
 * @param {object[]} positions - Normalized authored positions.
 * @param {number} min - Minimum position index.
 * @param {number} max - Maximum position index.
 * @param {object[]} emits - Current frame's index-space triggers.
 * @param {number|null} previousDetentIndex - Index before this frame's gesture.
 * @param {object|null} gestureEvent - Current gesture, or none.
 * @param {string} ring - Ring id included in added trigger payloads.
 * @returns {{state: object, emits: object[], value: *, haptics: string[], activeIndex: number|null}}
 *   Resolved snapshot; unmatched idle telemetry leaves state untouched.
 */
export function applyDetentedPostProcessing(state, positions, min, max, emits, previousDetentIndex, gestureEvent, ring) {
  // Unmatched idle telemetry remains visible verbatim with no highlighted
  // position until a new reading matches or the Ring is grabbed.
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
    // Two-position rings reach an endpoint on every toggle; a separate limit
    // cue is meaningful only when a middle position exists.
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

  // Every emit in one call describes the same resolved snapshot, including
  // turnEnd after Momentary spring-back.
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
