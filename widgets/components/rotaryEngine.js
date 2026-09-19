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
// Arc remains the default: it is the only gesture that reads correctly against the
// Rotary's current visual style (a circular knob face, per rotaryFace.js) — Scrub's
// "drag like a wheel" affordance and Tap's discrete tap zones are both things an
// Author opts into explicitly for a control that should behave like a wheel/switch
// rather than a knob. See ticket 03.
const DEFAULT_GESTURE = 'arc';
const VALID_GESTURES = ['arc', 'scrub', 'tap'];

/** Falls back to the default for anything not one of the three known gestures,
 * rather than silently misbehaving on a typo'd/legacy value. Exported so the
 * Component can resolve the SAME default when deciding the cursor/track
 * affordance to show, rather than re-deriving (and risking drift from) this
 * module's own notion of "the" default gesture. */
export function resolveGesture(raw) {
  return VALID_GESTURES.includes(raw) ? raw : DEFAULT_GESTURE;
}

// Ticket 04: the range axis. Bounded (ticket 01's original, and still the default)
// clamps at each end like a physical end-stop. Continuous wraps past either limit
// instead of clamping — a heading bug moving from 359 back to 0. Detented ignores
// min/max entirely and snaps between a list of named `positions` instead — a value
// on that Ring means "which position", not a number on an arbitrary scale.
const DEFAULT_RANGE_MODE = 'bounded';
const VALID_RANGE_MODES = ['bounded', 'continuous', 'detented'];

/** Same fallback-on-typo convention as resolveGesture. Exported for the same reason. */
export function resolveRangeMode(raw) {
  return VALID_RANGE_MODES.includes(raw) ? raw : DEFAULT_RANGE_MODE;
}

// Ticket 05: the write axis. Absolute (the ticket 01/02 default) writes the resolved
// value itself. Pulse emits one increment/decrement per step and owns no value of its
// own — the aircraft controls it targets (most payware, many stock) expose no way to
// set a value directly, only to nudge it. "Owns no value" is enforced structurally:
// gesture processing in Pulse mode never writes `state.rawValue` (see
// processPulseGesture) — only telemetry ever does, so what the Ring displays/reasons
// about as "the value" is always the sim's own last-known reading, never a locally
// accumulated guess a dispatch failure or a missed step could desync from.
const DEFAULT_WRITE_MODE = 'absolute';
const VALID_WRITE_MODES = ['absolute', 'pulse'];

/** Same fallback-on-typo convention as resolveGesture. Exported for the same reason. */
export function resolveWriteMode(raw) {
  return VALID_WRITE_MODES.includes(raw) ? raw : DEFAULT_WRITE_MODE;
}

// Ticket 05: WHEN a Ring's writes leave the Component, independent of Write Mode.
// 'onChange' writes on every real movement (Absolute's default — matches ticket 01/02/
// 03/04 behaviour exactly, so nothing that predates this ticket changes unless it
// opts in). 'onRelease' holds every write until the gesture ends. 'perDetent' writes
// only when a whole `degreesPerUnit`-sized step is crossed — Pulse's own emit
// granularity IS one step, so 'perDetent' is Pulse's natural default; Absolute can opt
// into the same granularity for a control that should feel discrete despite carrying
// a real value.
const VALID_DISPATCH_TIMINGS = ['onChange', 'onRelease', 'perDetent'];

function defaultDispatchTiming(writeMode) {
  return writeMode === 'pulse' ? 'perDetent' : 'onChange';
}

/** Same fallback-on-typo convention as resolveGesture, but the fallback itself
 * depends on `writeMode` (Pulse and Absolute default to different timings). */
export function resolveDispatchTiming(raw, writeMode) {
  return VALID_DISPATCH_TIMINGS.includes(raw) ? raw : defaultDispatchTiming(writeMode);
}

// Deliberate implementation choice, not a value from the spec: caps how many
// discrete Pulse steps a single resolveRotary() call will hand back as real 'turn'
// emits when several calls share the same `now` (i.e. land inside one animation
// frame, per RotaryComponent's frame scheduling). A fast flick can cross far more
// steps than this in one frame; the excess is queued in `state.pulsePendingSteps`
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

function normalizePositions(raw) {
  return Array.isArray(raw) ? raw.filter((p) => p && typeof p === 'object') : [];
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
 * The numeric [min, max] this Rotary actually operates over this frame. Bounded and
 * Continuous use the Author's own props.min/max; Detented ignores them entirely and
 * operates over the authored positions list's own index range instead (0..N-1) —
 * "value" in that mode means "which named position", not a number on a scale.
 */
function resolveEffectiveRange(cfg) {
  const mode = resolveRangeMode(cfg.rangeMode);
  const positions = normalizePositions(cfg.positions);
  if (mode === 'detented') {
    return { mode, min: 0, max: Math.max(positions.length - 1, 0), positions };
  }
  return { mode, min: cfg.min ?? DEFAULT_MIN, max: cfg.max ?? DEFAULT_MAX, positions };
}

/** Bounded (and Detented, which shares this over its index range) clamps at each
 * limit; Continuous wraps past either one instead — 359 -> 0, not 359 -> stuck. */
function resolveDisplayValue(rawValue, min, max, mode) {
  if (mode === 'continuous') {
    const span = max - min;
    if (!(span > 0)) return min;
    return (((rawValue - min) % span) + span) % span + min;
  }
  return clamp(rawValue, min, max);
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

// `degreesPerUnit` is a DIVISOR (arc degrees -> value units), so it must never reach
// zero. Nothing upstream stops it: the Inspector's number control has no min/max
// plumbing and coerces a blank/garbage entry to 0 (`Number(raw) || 0`), and the
// registry field carries no range either — so an Author typing 0 in the "Feel" field
// used to drive rawValue to Infinity, then to NaN on the first direction reversal,
// after which the NaN threaded through `previousState` forever (clamp() propagates it)
// and the knob was permanently dead until the widget was rebuilt. Floored here rather
// than in the registry because the engine is the only layer every caller goes through
// — Studio's preview host, the PWA and a raw `.fdwidget` import alike.
/** The smallest Feel magnitude any Rotary can resolve to: the guard that keeps the
 * divisor above zero. It is also the "no Feel floor applies" value returned by
 * resolveFeelFloor, so a caller can tell a real floor from an exempt case by comparing
 * against it. */
export const MIN_DEGREES_PER_UNIT = 0.01;

// The Feel floor. Pulse emits one write per step and the frame coalescer drains at most
// MAX_PULSE_STEPS_PER_FRAME (4) per frame, ~240 steps/sec. A Feel fine enough that an
// ordinary turn generates steps faster than that queues the surplus (never dropped, so
// the value landed on is the value turned to) and keeps dispatching long after the finger
// lifts. Flooring Feel where the step stream is unbounded keeps a human turn under the
// ceiling so the queue never forms; the drain itself is untouched.
//
// Arc's 6 is measured: the fastest observed turn was 3.05-3.65 rev/s, which puts the
// ceiling out of reach above roughly 4.5-5.5 degrees per step. Scrub's 10 is a reasoned
// estimate by analogy, not a measurement — drag speed has never been measured. Lowering
// a floor is safe (existing Widgets stay valid and gain headroom); raising one silently
// changes the feel of every Widget authored at it.
const PULSE_ARC_FEEL_FLOOR_DEGREES = 6;
const PULSE_SCRUB_FEEL_FLOOR_PIXELS = 10;

/**
 * The smallest Feel a Rotary honours for a given Gesture and write mode, in the
 * Gesture's own unit (degrees of arc for Arc, pixels of drag for Scrub).
 *
 * Only Pulse Arc and Pulse Scrub have a floor. Pulse Tap is exempt (one tap is one
 * step) and Absolute is exempt in every Gesture (it writes the Ring's value, deduped to
 * one write per frame, so no queue can form); both return MIN_DEGREES_PER_UNIT. Range
 * mode does not participate. Both arguments are raw authored values: an unset or
 * unrecognised one resolves to the engine's own default, so a Rotary that never stored
 * a Gesture or write mode is judged exactly as the engine will run it.
 *
 * @param {string|undefined} gesture - 'arc' | 'scrub' | 'tap'; anything else resolves to Arc.
 * @param {string|undefined} writeMode - 'absolute' | 'pulse'; anything else resolves to Absolute.
 * @returns {number} The floor, always >= MIN_DEGREES_PER_UNIT.
 */
export function resolveFeelFloor(gesture, writeMode) {
  if (resolveWriteMode(writeMode) !== 'pulse') return MIN_DEGREES_PER_UNIT;
  const resolved = resolveGesture(gesture);
  if (resolved === 'arc') return PULSE_ARC_FEEL_FLOOR_DEGREES;
  if (resolved === 'scrub') return PULSE_SCRUB_FEEL_FLOOR_PIXELS;
  return MIN_DEGREES_PER_UNIT;
}

// The Feel a new Pulse Arc or Pulse Scrub Rotary starts with. Absolute's default of 1 is a
// heading knob covering 0-360 in one turn; in Pulse the same number would be 360 steps per
// revolution, far finer than a real knob and well below the Feel floor. 12 is 30 steps per
// revolution for Arc, in the 10-18 range a faithful Pulse Ring occupies, and at that Feel a
// fast spin peaked at 144 steps/sec against the 240/sec drain ceiling. It must stay above
// both floors so a default is never one the engine silently overrides.
const PULSE_FEEL_DEFAULT = 12;

/**
 * The Feel a Rotary is created with for a Gesture and write mode, in the Gesture's own
 * unit. Absolute and Pulse Tap keep the engine's long-standing default of 1; Pulse Arc and
 * Pulse Scrub — the two Gestures that have a Feel floor — get a Feel shaped for a stream
 * of steps. Both arguments are raw authored values and resolve as the engine would run them.
 *
 * @param {string|undefined} gesture - 'arc' | 'scrub' | 'tap'; anything else resolves to Arc.
 * @param {string|undefined} writeMode - 'absolute' | 'pulse'; anything else resolves to Absolute.
 * @returns {number} A Feel that is never below resolveFeelFloor for the same arguments.
 */
export function resolveFeelDefault(gesture, writeMode) {
  return resolveFeelFloor(gesture, writeMode) > MIN_DEGREES_PER_UNIT ? PULSE_FEEL_DEFAULT : DEFAULT_DEGREES_PER_UNIT;
}

/**
 * The effective, always-safe divisor for a configured `degreesPerUnit`.
 * Sign is preserved (a negative value simply reverses the turn direction); only the
 * magnitude is floored, at the Feel floor for this Gesture and write mode. A non-finite
 * value has no usable magnitude or sign at all, so it falls back to the default rather
 * than to the floor — and that default is then held to the floor like any other value,
 * since the default sits below Pulse Arc's and a typo must not reopen the overrun.
 */
export function resolveDegreesPerUnit(raw, gesture, writeMode) {
  const floor = resolveFeelFloor(gesture, writeMode);
  const n = Number(raw ?? DEFAULT_DEGREES_PER_UNIT);
  if (!Number.isFinite(n)) return Math.max(DEFAULT_DEGREES_PER_UNIT, floor);
  const magnitude = Math.max(Math.abs(n), floor);
  return n < 0 ? -magnitude : magnitude;
}

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
 * Ticket 05's own state fields, shared by both createRotaryState() branches below —
 * factored out so the two branches (Detented vs. Bounded/Continuous) can't drift on
 * what a freshly-created Ring's Pulse/dispatch-timing bookkeeping starts at.
 *   - pulseAccumulator: fractional odometer for Pulse's step-crossing detection
 *     (see processPulseGesture) — NOT the value; it never survives past converting
 *     into whole steps.
 *   - pulsePendingSteps: whole Pulse steps queued but not yet handed back as 'turn'
 *     emits, drained by applyPulseFrameCoalescing.
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
      ...createDispatchState()
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
    ...createDispatchState()
  };
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
 * Arc: a *relative* gesture (ADR 0001) — the Ring accumulates the tangential
 * component of the finger's movement, never the finger's absolute angle. Near
 * the center, the true radius is floored to `minEffectiveRadius` when turning
 * that tangential displacement into an angle — dividing by the floor instead
 * of the (possibly tiny) real radius is what prevents a grab near the center
 * from spinning the Ring out wildly for a small physical finger movement.
 */
function processArcGesture(state, cfg, gestureEvent, min, max, mode, ring, degPerUnit) {
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
    const deltaValue = deltaAngleDeg / degPerUnit;

    // Accumulate into the *unclamped* raw value, never the clamped display
    // value. This is what makes a bound reached mid-gesture behave like a
    // physical end-stop: continuing to turn past the limit is "absorbed" and
    // has to be wound back before the value moves again, rather than the
    // knob instantly snapping to follow the finger the moment it reverses.
    const rawValue = state.rawValue + deltaValue;
    const value = resolveDisplayValue(rawValue, min, max, mode);
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
    return endContinuousDrag(state, min, max, mode, ring);
  }

  return { state, emits: [] };
}

/**
 * Scrub: a *linear* drag along a single axis — "feels like dragging a wheel"
 * (a trim wheel or VS wheel), per the ticket 03 spec and CONTEXT.md's Scrub
 * glossary entry. Dragging UP (finger's dy decreasing) increases the value,
 * mirroring a vertical slider; `degreesPerUnit` is reinterpreted here as
 * pixels of drag per unit, not degrees of arc — there is no angle involved.
 * No radius/minimum-effective-radius concept applies: a linear drag has no
 * center to measure a radius from.
 */
function processScrubGesture(state, cfg, gestureEvent, min, max, mode, ring, degPerUnit) {
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
    const deltaValue = deltaPixels / degPerUnit;

    // Same "absorb the overshoot at a bound" behaviour as Arc: accumulate into
    // the unclamped raw value so reversing direction has to wind back through
    // whatever overshoot happened before the value actually moves again.
    const rawValue = state.rawValue + deltaValue;
    const value = resolveDisplayValue(rawValue, min, max, mode);
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
    return endContinuousDrag(state, min, max, mode, ring);
  }

  return { state, emits: [] };
}

/**
 * Tap: a *discrete* gesture — "no drag required" (ticket 03). A tap changes
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
 */
function processTapGesture(state, cfg, gestureEvent, min, max, mode, ring, degPerUnit) {
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

/**
 * Queues `steps` (a signed whole-step count — one whole step is one Pulse write) onto
 * `state.pulsePendingSteps`, for the per-frame coalescer (applyPulseFrameCoalescing,
 * run once per resolveRotary call) to drain into real 'turn' emits — capped per
 * frame, never dropped; see that function's own comment for why.
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
function queuePulseSteps(state, cfg, steps, min, max, mode) {
  let allowedSteps = steps;
  if (steps !== 0 && mode !== 'continuous' && cfg.hasReadableValue && typeof state.rawValue === 'number') {
    const known = state.rawValue;
    if (steps > 0 && known >= max) allowedSteps = 0;
    else if (steps < 0 && known <= min) allowedSteps = 0;
  }
  if (allowedSteps === 0) return state;
  return { ...state, pulsePendingSteps: (state.pulsePendingSteps ?? 0) + allowedSteps };
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
function processPulseGesture(state, cfg, gestureEvent, min, max, mode, ring, degPerUnit, gesture) {
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

    const accumulator = (state.pulseAccumulator ?? 0) + deltaValue;
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
    let next = { ...state, lastPos: curr, pulseAccumulator: nextAccumulator };
    if (steps !== 0) {
      next = queuePulseSteps(next, cfg, steps, min, max, mode);
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
 * The per-frame coalescer's Pulse half (ticket 05): drains `state.pulsePendingSteps`
 * into actual 'turn' emits, one emit per whole step (the literal "one increment or
 * decrement per step" the acceptance criteria call for), capped at
 * MAX_PULSE_STEPS_PER_FRAME per distinct frame id. Calls sharing a frame id (many
 * gesture events landing inside one animation frame — ticket 20: a quantized bucket of
 * `now`, never raw `now`, see frameIdOf) share one cap; a new frame id resets it. A
 * fast flick that queues more steps than the cap allows is never
 * dropped: the remainder stays in `pulsePendingSteps` and drains on the NEXT call(s),
 * including calls the Component makes with no gesture at all, purely to keep
 * draining a queue after release (see RotaryComponent's frame scheduling).
 *
 * Held (emits nothing, cap untouched) while `state.pulseHoldForRelease` is true —
 * 'onRelease' dispatch timing's own gate; steps still queue during the gesture, they
 * just don't drain until it ends.
 */
function applyPulseFrameCoalescing(state, frameId, min, max, mode, ring) {
  const sameFrame = state.frameStamp === frameId;
  const frameEmitCount = sameFrame ? (state.frameEmitCount ?? 0) : 0;
  const pending = state.pulsePendingSteps ?? 0;

  if (state.pulseHoldForRelease || pending === 0) {
    return { state: { ...state, frameStamp: frameId, frameEmitCount }, emits: [] };
  }

  const capRemaining = Math.max(MAX_PULSE_STEPS_PER_FRAME - frameEmitCount, 0);
  const magnitude = Math.min(Math.abs(pending), capRemaining);
  const toEmit = Math.sign(pending) * magnitude;
  const remaining = pending - toEmit;

  const value = resolveDisplayValue(state.rawValue, min, max, mode);
  const emits = [];
  for (let i = 0; i < Math.abs(toEmit); i++) {
    emits.push({
      trigger: 'turn',
      payload: { value, delta: Math.sign(toEmit), direction: toEmit > 0 ? 'cw' : 'ccw', ring }
    });
  }

  const next = {
    ...state,
    pulsePendingSteps: remaining,
    frameStamp: frameId,
    frameEmitCount: frameEmitCount + Math.abs(toEmit)
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
function processGesture(state, cfg, gestureEvent) {
  const { mode, min, max } = resolveEffectiveRange(cfg);
  const ring = cfg.ringId ?? DEFAULT_RING_ID;
  const gesture = resolveGesture(cfg.gesture);
  const writeMode = resolveWriteMode(cfg.writeMode);
  const degPerUnit = resolveDegreesPerUnit(cfg.degreesPerUnit, gesture, writeMode);

  if (writeMode === 'pulse') {
    return processPulseGesture(state, cfg, gestureEvent, min, max, mode, ring, degPerUnit, gesture);
  }

  if (gesture === 'scrub') {
    return processScrubGesture(state, cfg, gestureEvent, min, max, mode, ring, degPerUnit);
  }
  if (gesture === 'tap') {
    return processTapGesture(state, cfg, gestureEvent, min, max, mode, ring, degPerUnit);
  }
  return processArcGesture(state, cfg, gestureEvent, min, max, mode, ring, degPerUnit);
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
    const gestureResult = processGesture(state, cfg, gestureEvent);
    state = gestureResult.state;
    emits = emits.concat(gestureResult.emits);
    if (state.phase === 'reconciling' && state.reconcileStartedAt == null) {
      state = { ...state, reconcileStartedAt: now };
    }
  }

  // 2b. Pulse's per-frame coalescer (ticket 05): drains state.pulsePendingSteps into
  //     real 'turn' emits, capped per distinct `now`. Run unconditionally (even with
  //     no gestureEvent) so a call the Component makes purely to keep draining a
  //     queue after release still flushes whatever is left — see
  //     applyPulseFrameCoalescing's own comment.
  if (writeMode === 'pulse') {
    const coalesced = applyPulseFrameCoalescing(state, frameId, min, max, mode, ring);
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
    tier: cfg.tier ?? DEFAULT_TIER,
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
