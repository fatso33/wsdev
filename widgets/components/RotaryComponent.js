/**
 * RotaryComponent.js
 * Renderer for core.rotary — the Rotary rebuild's tracer bullet (FDWS v1.30).
 *
 * This is a full replacement of the pre-v1.30 Rotary, not an adaptation of it: the
 * old coarse/fine vertical-drag knob with a centre push button is gone, along with
 * its props (circular/coarseStep/fineStep/pushLabel) and its dragStart/fineChange/
 * dragEnd/push trigger vocabulary. No aliases and no backward compatibility, per the
 * rebuild's ticket 02 — no packaged widget in the repository contains a Rotary, so
 * there is nothing to preserve. An older widget declaring the removed props keeps
 * loading and simply degrades to defaults (FDWS's unknown-field rule).
 *
 * Division of labour:
 *   - rotaryEngine.js (ticket 01) decides everything: value, angle, events, haptics.
 *     It is pure, so this Component owns all the impure parts — the DOM, the clock,
 *     the pointer, and threading the engine's opaque `state` bag between calls.
 *   - rotaryFace.js (this ticket) draws the knob: configuration in, markup out.
 *   - This file is the wiring, and nothing else.
 *
 * Rendering is hybrid, deliberately: `this.element` stays an ordinary DOM node so the
 * existing style cascade, theming, state styles and conditional style rules all keep
 * working unchanged, and only the Face is generated vector markup. The Face WRAPPER
 * (`this.surfaceNode`) — not `this.element` — is registered as BaseComponent's
 * surface target, so an authored border/background/glow lands on the visible knob
 * instead of an invisible square wrapper around it.
 *
 * Scope for ticket 02: the Arc gesture, the Bounded range, the Absolute write mode
 * and just enough appearance to look like a knob. Continuous/Detented (04), Pulse (05),
 * Acceleration (06) and the remaining Face groups (07) widen this without reworking it.
 *
 * Ticket 03 widened the gesture axis (`props.gesture`: arc/scrub/tap) entirely inside
 * rotaryEngine.js — this file's only changes for it are threading the prop through
 * (rotaryConfig()) and setting the `data-gesture` attribute the stylesheets key their
 * cursor/track affordance off of. The pointer wiring itself (attachTurnGesture()) is
 * unchanged: every gesture is driven by the same pointerdown/move/up sequence, and it
 * is the engine, not this Component, that decides what dx/dy mean for the chosen
 * gesture.
 */

import { BaseComponent } from './BaseComponent.js';
import { resolveRotary, createRotaryState, resolveGesture, resolveRangeMode } from './rotaryEngine.js';
import { buildRotaryFace } from './rotaryFace.js';
import { SecurityValidator } from '../../core/SecurityValidator.js';

// Fallback only. The real number comes from the host (`getPollPeriodMs()`), which is
// what makes the engine's Reconciliation timeout derived rather than guessed; this is
// the normal tier's flat 1Hz, used when a host doesn't implement it (e.g. Widget
// Studio's preview host, which has no polling at all).
const FALLBACK_POLL_PERIOD_MS = 1000;

const DEFAULT_MIN = 0;
const DEFAULT_MAX = 100;
const DEFAULT_DEGREES_PER_UNIT = 1;
const DEFAULT_SWEEP_DEGREES = 270;
// -135 pairs with the 270-degree default sweep so mid-range points straight up, the
// same "degrees clockwise from 12 o'clock" convention core.gauge's props.arc.startAngle
// already uses.
const DEFAULT_START_ANGLE = -135;

// Every trigger this Component can emit — the single source of truth for Rotary's
// trigger vocabulary. `resolve()`'s dispatch path derives from this rather than
// repeating the names, and scripts/check-registry-drift.mjs reads this exported
// declaration directly: its usual "grep for a string-literal handleInteraction()
// argument" scan is structurally blind here, since every trigger goes through one
// call site with `emit.trigger` as a variable (see rotaryEngine.js, where these
// names originate).
//
// Ticket 04 adds 'detent' and 'limit' — both pure notifications (a step was
// crossed / a bound was hit), never a write.
export const ROTARY_TRIGGERS = ['turnStart', 'turn', 'turnEnd', 'detent', 'limit'];

/**
 * The subset of `triggers` that also writes to the binding (Absolute write mode).
 *
 * Ticket 04: inverted from a name-based EXCLUSION to an explicit ALLOWLIST. With
 * 'detent'/'limit' added as pure notifications, an exclusion would have started
 * writing them to the sim by default the moment they were added to ROTARY_TRIGGERS
 * above — a Detent notification firing a duplicate write on every crossing, on top
 * of the 'turn' that already wrote. An allowlist means a new trigger has to opt IN
 * here to drive the sim, rather than opt out.
 *
 * Exported (not inlined) so the tests can pin the derivation itself against a
 * mutated input — the only way to tell it apart from a positional slice.
 * @param {string[]} triggers
 * @returns {string[]}
 */
const WRITE_TRIGGER_ALLOWLIST = ['turn', 'turnEnd'];

export function deriveWriteTriggers(triggers) {
  return triggers.filter((trigger) => WRITE_TRIGGER_ALLOWLIST.includes(trigger));
}

export const WRITE_TRIGGERS = deriveWriteTriggers(ROTARY_TRIGGERS);

export class RotaryComponent extends BaseComponent {
  render() {
    super.render();
    this.element.classList.add('fd-comp-rotary');

    const face = document.createElement('div');
    face.className = 'fd-rotary-face';
    // Never let a turn be stolen by page scroll / pull-to-refresh. Set here as well
    // as in widgets.css because this one is load-bearing for the gesture, not styling.
    face.style.touchAction = 'none';
    this.faceNode = face;
    // BaseComponent.applyStyles() resolves its border/background/glow target as
    // `this.surfaceNode || this.btnNode || this.element` — registering the Face
    // wrapper here is what puts authored styling on the knob itself.
    this.surfaceNode = face;
    this.element.appendChild(face);

    this.attachTurnGesture(face);
    this.watchDispatchFailures();

    // The Face wrapper didn't exist when super.render() ran applyStyles(), so that
    // first pass targeted this.element; re-run it now that the real surface exists.
    // (applyStyles() clears the stranded first-pass border/background/glow off
    // this.element itself — see its surfaceTarget comment block.)
    this.applyStyles();

    const guardOverlay = this.setupGuard();
    if (guardOverlay) this.element.appendChild(guardOverlay);

    // Paint the initial Face. No gesture, no telemetry: just "where does the knob
    // sit right now", which is the bound value once update() has been called and
    // the range floor until then.
    this.resolve(null, null);

    return this.element;
  }

  /**
   * The engine's config for this frame, rebuilt each call so an Inspector edit to
   * any prop takes effect immediately, and `previousState` always threads the last
   * result back in (the engine holds no state of its own by design).
   */
  rotaryConfig() {
    const props = this.def.props || {};
    return {
      gesture: resolveGesture(props.gesture),
      rangeMode: resolveRangeMode(props.rangeMode),
      min: props.min ?? DEFAULT_MIN,
      max: props.max ?? DEFAULT_MAX,
      positions: Array.isArray(props.positions) ? props.positions : [],
      degreesPerUnit: props.degreesPerUnit ?? DEFAULT_DEGREES_PER_UNIT,
      sweepDegrees: props.sweepDegrees ?? DEFAULT_SWEEP_DEGREES,
      pollPeriodMs: this.resolvePollPeriodMs(),
      previousState: this.rotaryState
    };
  }

  /**
   * The ACTUAL poll period of this Rotary's own readable binding, which is what the
   * engine derives its Reconciliation timeout from (roughly twice this) instead of a
   * hardcoded constant. The host owns the real answer because only it knows which
   * tier the SimVar is currently subscribed at — including the fast tier this
   * Component requests for itself while engaged.
   * @returns {number} milliseconds
   */
  resolvePollPeriodMs() {
    const hostPeriod = this.widget?.getPollPeriodMs?.(this.def);
    if (Number.isFinite(hostPeriod) && hostPeriod > 0) return hostPeriod;
    const hz = Number(this.def.binding?.pollFrequencyHz);
    if (Number.isFinite(hz) && hz > 0) return 1000 / hz;
    return FALLBACK_POLL_PERIOD_MS;
  }

  /** Caller-supplied time, per the engine's "time is a parameter" contract. */
  now() {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  }

  /**
   * One engine call: resolve, store the threaded state, repaint, emit, write.
   * Every path into the engine goes through here — gesture, telemetry and the
   * dispatch-failure report alike — so there is exactly one place where the
   * Component reacts to a result.
   * @param {object|null} gestureEvent
   * @param {object|null} telemetry
   */
  resolve(gestureEvent, telemetry) {
    // A fresh grab supersedes any failure still waiting to be applied: the user has
    // taken the knob back, so reverting under their finger would be wrong. The
    // repeat-write cache is cleared with it — a new gesture is a new intent, and a
    // cache still holding the previous gesture's FAILED outcome would answer a retry
    // from memory instead of actually retrying it (see writeValue()).
    if (gestureEvent && gestureEvent.type === 'start') {
      this.pendingDispatchFailure = false;
      this.lastDispatchedValue = undefined;
      this.lastDispatchOk = undefined;
    }

    const cfg = this.rotaryConfig();
    // Drives the cursor/track affordance in widgets.css (`.fd-rotary-face[data-gesture=...]`)
    // — a plain attribute rather than a class so it composes with BaseComponent's own
    // state classes (dragging, etc.) instead of fighting them.
    if (this.faceNode) this.faceNode.dataset.gesture = cfg.gesture;
    const result = resolveRotary(cfg, gestureEvent, telemetry, this.now());
    this.rotaryState = result.state;
    this.currentValue = result.value;
    this.renderFace(result.angle);
    this.renderPositions(cfg, result.activePosition);

    result.emits.forEach((emit) => {
      this.widget?.handleInteraction?.(this.def, emit.trigger, { ...emit.payload });
      // The Rotary writes to its binding DIRECTLY — a bound knob needs no interaction
      // wiring to drive the sim (it is registered in StudioValidator's
      // SELF_DISPATCHING_WRITE_EVENT_TYPES for exactly this reason). Absolute write
      // mode: the resolved value itself goes out, not a delta.
      if (WRITE_TRIGGERS.includes(emit.trigger)) {
        // The flag tracks the outcome of the MOST RECENT write, not "did any write in
        // this gesture ever fail". A turn is many writes: if the bridge drops for one
        // frame and recovers, the later writes genuinely reached the sim, and the value
        // standing at release is the one the last write carried — force-reverting it
        // because an earlier, superseded write failed would discard a value the sim
        // really did take. `undefined` means nothing actually went out (no write event
        // bound, or a skipped repeat): no outcome, so it must not clear a real failure.
        const outcome = this.writeValue(emit.payload.value);
        if (outcome === false) this.pendingDispatchFailure = true;
        else if (outcome === true) this.pendingDispatchFailure = false;
      }
    });

    // Reported back into the engine as its own frame (not folded into the one above,
    // which has already returned): a failed write must revert to telemetry rather
    // than leave a value the sim never applied.
    //
    // Held until a Reconciliation window is actually open, because that is the only
    // phase the engine honours `dispatchFailed` in. A failure raised mid-turn (every
    // frame of a turn writes, and the bridge may go down during one) used to be
    // reported into an 'engaged' engine, which correctly ignored it — and then
    // nothing ever raised it again, so release reconciled normally and the knob sat
    // on a value the sim never took. Deferring it here is what makes ticket 01's
    // "a dispatch failure reverts the value to telemetry" hold for a failure that
    // happens while the knob is still being turned.
    if (this.pendingDispatchFailure) {
      if (this.rotaryState.phase === 'reconciling') {
        this.pendingDispatchFailure = false;
        this.resolve(null, { value: this.lastTelemetryValue, dispatchFailed: true });
      } else if (this.rotaryState.phase === 'idle') {
        // Already back on telemetry (the window closed some other way, or the knob
        // was never engaged) — there is nothing left to revert, and holding the flag
        // would misfire on the NEXT release instead.
        this.pendingDispatchFailure = false;
      }
    }
    // Haptic cues (result.haptics) are deliberately not wired here — they arrive with
    // the Detented/Acceleration tickets that give them something to distinguish.
  }

  /**
   * Subscribes to the host's report of a write this Rotary made being rejected
   * downstream — the failure mode `writeValue()`'s synchronous result cannot see.
   *
   * `dispatchSimEvent()` answers immediately, so it can only ever report what is
   * knowable at the send: a rejected event name, or a bridge that isn't connected.
   * A write that IS sent and is then refused by PC Bridge (unmapped Deck Event,
   * SimConnect error) is reported asynchronously, as SIM_EVENT_DISPATCH_FAILED.
   * Both land on the same `pendingDispatchFailure` path, so the engine sees one
   * notion of "that write didn't take" regardless of which layer noticed.
   */
  watchDispatchFailures() {
    this.releaseDispatchFailureWatch = this.widget?.onDispatchFailure?.(
      this.def,
      () => this.reportDispatchFailure()
    ) || null;
  }

  /** Feeds an asynchronously-reported failure into the same path as a synchronous one. */
  reportDispatchFailure() {
    this.pendingDispatchFailure = true;
    // No gesture, no telemetry — just re-run the engine so the deferred failure above
    // is applied the moment a Reconciliation window exists to apply it to.
    this.resolve(null, null);
  }

  /**
   * Sends one Absolute write, skipping a repeat of a value already sent SUCCESSFULLY.
   *
   * Only a success is ever skipped, and a skip reports NO OUTCOME rather than a
   * success. The case the cache exists for is turnEnd re-committing the value the last
   * turn frame already sent: nothing goes out, so nothing new is learned — and
   * answering "sent, fine" from the cache would let that non-event overwrite a
   * genuine failure reported in between (PC Bridge rejecting that very write
   * asynchronously, between the last turn frame and the release).
   *
   * A FAILED value is deliberately not cached as an answer: re-dispatching is a retry,
   * and the conditions that made it fail (a bridge that was down, a sim that refused
   * once) are exactly the kind that change between attempts. Caching the failure
   * instead meant the knob could get permanently stuck on one specific value — after a
   * failed write to X, turning back to X answered "failed" from memory without ever
   * re-sending it, so the value stayed unreachable until some other value was
   * dispatched first. The retry costs one extra dispatch on a turnEnd re-commit whose
   * previous attempt failed, and a failure that repeats still reaches the engine
   * because the retry itself returns false.
   * @param {number} value
   * @returns {boolean|undefined} true/false when a write actually went out and the
   *   host reported on it; undefined when nothing went out at all (no write event
   *   bound, or a skipped repeat), which is not an outcome and must not clear one
   */
  writeValue(value) {
    const writeEvent = this.def.binding?.writeEvent;
    if (!writeEvent) return undefined;
    if (this.lastDispatchedValue === value && this.lastDispatchOk === true) return undefined;
    this.lastDispatchedValue = value;
    this.lastDispatchOk = this.widget?.dispatchSimEvent?.(writeEvent, value);
    return this.lastDispatchOk;
  }

  /** Repaints the Face, skipping the write when the markup is unchanged. */
  renderFace(angle) {
    if (!this.faceNode) return;
    const props = this.def.props || {};
    const markup = buildRotaryFace({
      angle: (props.startAngle ?? DEFAULT_START_ANGLE) + angle,
      faceColor: props.faceColor,
      rimColor: props.rimColor,
      rimWidth: props.rimWidth,
      indicatorColor: props.indicatorColor,
      indicatorWidth: props.indicatorWidth
    });
    if (markup === this.lastFaceMarkup) return;
    this.lastFaceMarkup = markup;
    this.faceNode.innerHTML = markup;
  }

  /**
   * Detented-only: renders the named positions around the Face and highlights
   * whichever one (if any) is currently active. No-ops (and tears itself down) in
   * any other Range Mode.
   *
   * Positioned as a percentage of `this.faceNode` (`.fd-rotary-face`), NOT of
   * `this.element` — widgets.css keeps the Face exactly square (`100cqmin`) no
   * matter what rectangle the Author gave the Rotary as a whole, which is what
   * keeps this circle of markers round on a non-square layout box. The deleted
   * Selector's own position markers used the identical percentage-radius math
   * against `this.element` directly, which is exactly what distorted into an
   * ellipse whenever that box wasn't square.
   */
  renderPositions(cfg, activeIndex) {
    if (!this.faceNode) return;

    if (cfg.rangeMode !== 'detented') {
      if (this.positionsNode) {
        this.positionsNode.remove();
        this.positionsNode = null;
        this.posNodes = null;
        this.lastPositionsSignature = undefined;
      }
      return;
    }

    const positions = cfg.positions;
    if (!this.positionsNode) {
      const wrap = document.createElement('div');
      wrap.style.position = 'absolute';
      wrap.style.inset = '0';
      // Decorative labels only -- the drag surface underneath must stay the one
      // handling pointer events.
      wrap.style.pointerEvents = 'none';
      this.positionsNode = wrap;
      this.posNodes = new Map();
      this.lastPositionsSignature = undefined;
    }
    // renderFace() may have just replaced faceNode's ENTIRE innerHTML (not
    // appended to it), which silently detaches this wrapper -- re-attach on
    // every call rather than only when first created.
    if (this.positionsNode.parentNode !== this.faceNode) {
      this.faceNode.appendChild(this.positionsNode);
    }

    const signature = JSON.stringify(positions);
    if (signature !== this.lastPositionsSignature) {
      this.lastPositionsSignature = signature;
      this.positionsNode.innerHTML = '';
      this.posNodes.clear();
      const props = this.def.props || {};
      const denom = Math.max(positions.length - 1, 1);
      const startAngle = props.startAngle ?? DEFAULT_START_ANGLE;
      const sweep = props.sweepDegrees ?? DEFAULT_SWEEP_DEGREES;
      positions.forEach((pos, idx) => {
        const el = document.createElement('div');
        el.className = 'fd-rotary-position';
        el.style.position = 'absolute';
        el.style.transform = 'translate(-50%, -50%)';
        el.style.fontSize = '9px';
        el.style.lineHeight = '1';
        el.style.whiteSpace = 'nowrap';
        SecurityValidator.setText(el, pos.label !== undefined && pos.label !== '' ? pos.label : pos.value);
        const angleDeg = startAngle + (positions.length > 1 ? (idx / denom) * sweep : 0) - 90;
        const angleRad = angleDeg * (Math.PI / 180);
        const radius = 42; // % of the guaranteed-round Face box, same convention the deleted Selector used against its own (non-square-safe here) box.
        el.style.left = `${50 + radius * Math.cos(angleRad)}%`;
        el.style.top = `${50 + radius * Math.sin(angleRad)}%`;
        this.positionsNode.appendChild(el);
        this.posNodes.set(idx, el);
      });
    }

    this.posNodes.forEach((el, idx) => {
      const isActive = idx === activeIndex;
      el.classList.toggle('active', isActive);
      el.style.color = isActive ? 'var(--accent-cyan, #00e5ff)' : 'rgba(226, 232, 240, 0.6)';
      el.style.fontWeight = isActive ? '700' : '400';
    });
  }

  /**
   * Arc gesture wiring. The engine wants the pointer's offset from the Rotary's own
   * centre and nothing else; everything about what that offset MEANS (relative
   * accumulation, the minimum effective radius, bounds) lives there.
   */
  attachTurnGesture(surface) {
    const offsetFromCenter = (e) => {
      const rect = surface.getBoundingClientRect();
      return {
        dx: e.clientX - (rect.left + rect.width / 2),
        dy: e.clientY - (rect.top + rect.height / 2)
      };
    };

    const onPointerDown = (e) => {
      // The old Component checked pointer events but not the interaction-blocked
      // state, so a closed guard could be dragged straight through.
      if (this.resolvePointerEvents() === 'none' || this.isInteractionBlocked()) return;
      this.activePointerId = e.pointerId;
      // Captured so the turn survives the finger leaving the knob's bounds — a
      // circular gesture on a small control leaves them constantly.
      try { surface.setPointerCapture(e.pointerId); } catch { /* unsupported/synthetic pointer */ }
      this.setState('dragging');
      // While engaged, ask for this binding's fast poll tier so a released Rotary
      // settles on the real value quickly (and so the derived Reconciliation timeout
      // above is short rather than ~2s of the normal tier).
      this.releaseFastPoll = this.widget?.requestFastPoll?.(this.def) || null;
      this.resolve({ type: 'start', ...offsetFromCenter(e) }, null);
    };

    const onPointerMove = (e) => {
      if (this.activePointerId === undefined || e.pointerId !== this.activePointerId) return;
      this.resolve({ type: 'move', ...offsetFromCenter(e) }, null);
    };

    const onPointerUp = (e) => {
      if (this.activePointerId === undefined || e.pointerId !== this.activePointerId) return;
      this.activePointerId = undefined;
      // Explicitly released, not left to the implicit release — an element that keeps
      // capture keeps swallowing every later pointer event on the page.
      try { surface.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      this.setState(undefined);
      if (this.releaseFastPoll) {
        this.releaseFastPoll();
        this.releaseFastPoll = null;
      }
      this.resolve({ type: 'end', ...offsetFromCenter(e) }, null);
    };

    surface.addEventListener('pointerdown', onPointerDown);
    surface.addEventListener('pointermove', onPointerMove);
    surface.addEventListener('pointerup', onPointerUp);
    surface.addEventListener('pointercancel', onPointerUp);
  }

  destroy() {
    // Torn down mid-gesture (widget removed, or the host re-rendering the tree): the
    // fast-tier hold is ref-counted on the host side, so dropping this node without
    // releasing would pin the SimVar to the fast tier for the rest of the session with
    // a listener nothing can reach any more.
    if (this.releaseFastPoll) {
      this.releaseFastPoll();
      this.releaseFastPoll = null;
    }
    // Same reasoning for the failure watch: it is a host-level EventBus subscription
    // that outlives this node unless it is dropped here.
    if (this.releaseDispatchFailureWatch) {
      this.releaseDispatchFailureWatch();
      this.releaseDispatchFailureWatch = null;
    }
    this.activePointerId = undefined;
    super.destroy();
  }

  update(val, allState) {
    super.update(val, allState);
    const num = Number(val);
    if (val === null || val === undefined || !Number.isFinite(num)) return;
    this.lastTelemetryValue = num;
    // Straight into the engine: it decides whether this telemetry is authoritative
    // (idle) or must be held off (engaged, or an open Reconciliation window).
    this.resolve(null, { value: num });
  }
}
