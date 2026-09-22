/**
 * @module rotaryReconciliation
 * Pure release-window reconciliation for numeric and Detented Rotary telemetry.
 * The caller supplies raw millisecond time and threads the returned state; this
 * module owns no clock, timer, resource, or mutable state outside that bag.
 */

import { DEFAULT_MAX, DEFAULT_MIN } from './rotaryConfig.js';
import { matchPositionIndex } from './rotaryDetents.js';

const DEFAULT_POLL_PERIOD_MS = 1000; // matches the normal 1Hz poll tier (CLAUDE.md)
// The floor prevents fast polling from collapsing the window. Twice the poll
// period leaves at least one full telemetry tick for a dispatched value to echo.
const RECONCILIATION_TIMEOUT_FLOOR_MS = 250;
const RECONCILIATION_TIMEOUT_MULTIPLIER = 2;

/**
 * Resolves an open release window before this call's gesture and idle telemetry.
 * Dispatch failure wins, then a numeric echo within absolute value tolerance,
 * then a timeout measured from the raw millisecond release stamp. Detented
 * positions use authored identity in the sibling branch. Non-reconciling state
 * passes through by identity; no input object is mutated.
 *
 * @param {object} state - Caller-threaded Rotary state.
 * @param {object} cfg - Rotary config, including poll period and optional tolerance.
 * @param {object|null} telemetry - Current value and optional dispatchFailed flag.
 * @param {number} now - Raw current time in milliseconds.
 * @param {string} mode - Resolved range mode.
 * @param {object[]} positions - Normalized Detented positions.
 * @returns {object} Existing state while open, or a new idle state on release.
 */
export function applyReconciliation(state, cfg, telemetry, now, mode, positions) {
  if (state.phase !== 'reconciling') {
    return state;
  }

  if (mode === 'detented') {
    return applyDetentedReconciliation(state, cfg, telemetry, now, positions);
  }

  if (telemetry?.dispatchFailed) {
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
    // An unconfirmed write yields to the latest telemetry rather than holding
    // its dispatched value indefinitely.
    const revertValue = telemetry && typeof telemetry.value === 'number' ? telemetry.value : state.rawValue;
    return toIdleFromTelemetry(state, revertValue);
  }

  return state;
}

/**
 * Reconciles a Detented window in index space. The pending value is an index;
 * telemetry can contain a string or number and matches the first authored
 * position by String identity. Failure and timeout preserve unmatched raw
 * telemetry for display with no active position. No input is mutated.
 *
 * @param {object} state - Caller-threaded state with pending index.
 * @param {object} cfg - Rotary config with optional poll period in milliseconds.
 * @param {object|null} telemetry - Current value and optional dispatchFailed flag.
 * @param {number} now - Raw current time in milliseconds.
 * @param {object[]} positions - Normalized authored positions.
 * @returns {object} Existing state while open, or a new idle state on release.
 */
export function applyDetentedReconciliation(state, cfg, telemetry, now, positions) {
  const matchAgainstPending = (value) => {
    const idx = matchPositionIndex(positions, value);
    return idx >= 0 && idx === state.pendingDispatchValue;
  };

  if (telemetry?.dispatchFailed) {
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

/**
 * Closes a reconciliation window around an authoritative numeric value or
 * Detented index. Clears pending write, timeout stamp, and stale unmatched
 * telemetry flags while retaining unrelated fields in the caller's state.
 *
 * @param {object} state - Caller-threaded Rotary state.
 * @param {*} value - Authoritative numeric value or Detented index.
 * @returns {object} New idle state; the input is not mutated.
 */
export function toIdleFromTelemetry(state, value) {
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
