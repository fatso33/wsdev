/**
 * InputComponent.js
 * Renderer for core.input (Editable value field with touch keyboard & validation)
 */

import { BaseComponent } from './BaseComponent.js';
import { ValueFormatter } from './ValueFormatter.js';
import { SecurityValidator } from '../../core/SecurityValidator.js';

export class InputComponent extends BaseComponent {
  render() {
    super.render();
    this.element.classList.add('fd-comp-input-wrapper');

    const props = this.def.props || {};
    // FDWS v1.11 §1.1: when the chosen format has a Format Catalog entry
    // (ValueFormatter.getFormatSpec), this field becomes a masked, range-
    // enforced numeric entry instead of plain free text. This is deliberately
    // automatic (not opt-in) whenever the format matches — see the v1.11
    // spec's compatibility note for what that means for pre-v1.11 widgets
    // already using FREQ_COM/FREQ_NAV.
    this.formatSpec = ValueFormatter.getFormatSpec(props.format);

    const inputEl = document.createElement('input');
    inputEl.className = 'fd-comp-input-field';
    inputEl.type = 'text';
    inputEl.inputMode = props.format?.includes('INT') || props.format?.includes('FREQ') || props.format?.includes('BCD') ? 'decimal' : 'text';
    inputEl.autocomplete = 'off';
    inputEl.spellcheck = false;
    // Every core.input on a page is its own independent field, never part of a
    // multi-step form — the on-screen keyboard's "Enter" action should just
    // dismiss it (matching the keydown handler below), not advance focus to
    // whatever DOM-order-next input happens to be nearby (e.g. COM1 STBY ->
    // COM2 STBY when COM2 is visible). Without this, mobile keyboards infer
    // a "next" action from focusable-element order rather than "done".
    inputEl.enterKeyHint = 'done';

    if (props.placeholder) {
      inputEl.placeholder = props.placeholder;
    }

    const initialVal = props.defaultValue !== undefined ? props.defaultValue : (props.value || '');
    const initialDisplay = initialVal ? ValueFormatter.format(initialVal, props.format || 'RAW_INT') : '';
    inputEl.value = initialDisplay;
    // The last value this field is known to legitimately hold — either the
    // last successful commit, or the last value pushed in via update() (a
    // fresh SimVar/state tick). This is what an out-of-range commit (v1.11
    // §1.1: reject-and-revert, not clamp) restores the field to.
    this.lastValidDisplay = initialDisplay;
    // Digit-only buffer backing the mask, only meaningful when formatSpec is set.
    this.maskBuffer = this.formatSpec ? this.digitsFromDisplay(initialDisplay) : '';

    // Tracks whether the user has actually typed since focusing, so blur/change
    // don't commit+dispatch a write event just because the field lost focus —
    // see the note on validateAndCommit() below for why this matters.
    this.dirty = false;

    inputEl.addEventListener('focus', (e) => {
      this.isFocused = true;
      this.dirty = false;
      this.element.classList.add('focused');
      // FDWS v1.25: editState — merged style.states.editState (border/
      // background/typography) applies for the whole time this field is
      // focused, author-customizable in place of the old hardcoded
      // .fd-comp-input-wrapper.focused cyan outline (still the default look
      // whenever editState isn't authored — see applyStyles()'s stateStyle
      // merge, which no-ops back to the base style in that case).
      this.setState('editState');
      const wasEmpty = inputEl.value === '';
      if (this.formatSpec && wasEmpty && this.formatSpec.autoPrefill) {
        // FDWS v1.11 §1.1: auto-prefill (e.g. the "1" every COM/NAV
        // frequency starts with) only fires into an EMPTY field — an
        // already-populated field is left alone so editing an existing
        // value never gets silently wiped.
        this.maskBuffer = this.digitsFromDisplay(this.formatSpec.autoPrefill);
        inputEl.value = this.renderMask(this.maskBuffer);
        inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
      } else if (props.selectOnFocus && !wasEmpty) {
        // FDWS v1.11 §1.3, revised in v1.25: used to call inputEl.select()
        // here, which put a real native selection in the field the instant
        // it was tapped -- that's exactly what triggers Android Chrome's
        // cut/copy/paste/select-all toolbar on a value-bearing field, even
        // though the selection was made programmatically rather than by a
        // long-press. Arm a "next keystroke replaces the whole value" flag
        // instead (consumed by the beforeinput listener below) so typing
        // still immediately overwrites the old value, but no native
        // selection ever sits there for the OS to build a toolbar around.
        // editState (above) is the visual cue that the field is armed, in
        // place of the native selection highlight.
        this.pendingReplace = true;
      }
      this.widget?.handleInteraction?.(this.def, 'focus', { value: inputEl.value, originalEvent: e });
    });

    // Consumes the pendingReplace flag set above, exactly once, on whatever
    // the user does first after focusing. Only an actual typed character
    // (inputType 'insertText') gets the replace treatment -- setting the
    // selection to the full value immediately before the browser commits the
    // insertion makes it replace that selection natively, the same outcome
    // select()-then-type used to produce, just without ever leaving a
    // standing selection for the toolbar to attach to. Backspace/Delete/
    // paste/arrow-key-then-type etc. just clear the flag and edit normally
    // from wherever the caret actually is -- those aren't a "type a new
    // value" gesture.
    inputEl.addEventListener('beforeinput', (e) => {
      if (!this.pendingReplace) return;
      this.pendingReplace = false;
      if (e.inputType === 'insertText') {
        inputEl.setSelectionRange(0, inputEl.value.length);
      }
    });

    inputEl.addEventListener('input', () => {
      this.dirty = true;
      if (this.formatSpec) {
        // Re-derive the digit buffer from whatever the browser just produced
        // (handles typed digits, backspage/delete, and paste uniformly) —
        // strip anything non-digit (blocks letters/symbols outright) and cap
        // at the format's total digit count, then re-render the fixed
        // int.dec mask. Cursor always lands at the end; mid-string editing
        // isn't supported for masked fields, a deliberate simplification for
        // this fixed-shape numeric-keypad-style entry.
        const maxDigits = this.formatSpec.intDigits + this.formatSpec.decDigits;
        let digits = inputEl.value.replace(/\D/g, '');
        if (digits.length > maxDigits) digits = digits.slice(0, maxDigits);
        this.maskBuffer = digits;
        inputEl.value = this.renderMask(digits);
        inputEl.setSelectionRange(inputEl.value.length, inputEl.value.length);
      }
    });

    inputEl.addEventListener('blur', (e) => {
      this.isFocused = false;
      this.pendingReplace = false;
      this.element.classList.remove('focused');
      this.setState(undefined);
      if (this.dirty) {
        this.validateAndCommit(inputEl.value);
        this.dirty = false;
      }
      this.widget?.handleInteraction?.(this.def, 'blur', { value: inputEl.value, originalEvent: e });
    });

    inputEl.addEventListener('change', (e) => {
      if (this.dirty) {
        this.validateAndCommit(inputEl.value);
        this.dirty = false;
      }
      this.widget?.handleInteraction?.(this.def, 'change', { value: inputEl.value, originalEvent: e });
    });

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        inputEl.blur();
      }
    });

    this.inputNode = inputEl;
    this.element.appendChild(inputEl);

    // inputNode didn't exist yet when super.render() ran applyStyles(), so its
    // typography/border/background cascade was skipped on that first pass — redo it
    // now that the inner <input> surface actually exists.
    this.applyStyles();

    return this.element;
  }

  /** Strips a formatted display string (e.g. "121.500") down to its raw digits ("121500"). */
  digitsFromDisplay(display) {
    return (display || '').replace(/\D/g, '');
  }

  /** Renders a digit buffer as the fixed intDigits.decDigits mask, growing as digits are typed. */
  renderMask(digits) {
    const { intDigits } = this.formatSpec;
    if (digits.length <= intDigits) return digits;
    return `${digits.slice(0, intDigits)}.${digits.slice(intDigits)}`;
  }

  /**
   * Only ever called when this.dirty is true — i.e. the user actually typed
   * something since the field was focused. blur/change fire on any focus loss
   * regardless of whether the value changed (a stray tab, a widget-drawer
   * closing, focus churn from an unrelated part of the UI), and this
   * component's displayed value can legitimately be a stale, not-yet-synced
   * default at that moment (e.g. right after mount, before the first live
   * telemetry frame arrives) — committing unconditionally on every blur would
   * silently push that stale value out as a real SimConnect write, clobbering
   * whatever the actual live value already was. The dirty check is what keeps
   * "the user genuinely edited this field" the only thing that can trigger a
   * write.
   */
  validateAndCommit(rawVal) {
    const props = this.def.props || {};

    if (this.formatSpec) {
      // FDWS v1.11 §1.1: masked-format commit path — parse the digit buffer
      // against the format's shape, enforce min/max (component-level
      // props.min/props.max override the format's defaults when set), and on
      // any failure REJECT the edit and revert to the last known-good value
      // rather than clamping to a boundary (v1.11 §1.1 ADR).
      const { intDigits, decDigits, min, max } = this.formatSpec;
      const digits = this.maskBuffer || '';
      if (digits.length === 0) {
        this.revertToLastValid();
        return;
      }
      const numStr = digits.length <= intDigits ? digits : `${digits.slice(0, intDigits)}.${digits.slice(intDigits)}`;
      const num = Number(numStr);
      const effMin = props.min !== undefined ? props.min : min;
      const effMax = props.max !== undefined ? props.max : max;
      if (isNaN(num) || (effMin !== undefined && num < effMin) || (effMax !== undefined && num > effMax)) {
        this.revertToLastValid();
        return;
      }
      this.commitValue(num.toFixed(decDigits));
      return;
    }

    // Legacy (no format spec) path — unchanged from pre-v1.11: clamp to
    // props.min/props.max when set, otherwise commit as typed.
    let val = rawVal.trim();
    if (props.min !== undefined && Number(val) < props.min) {
      val = String(props.min);
    }
    if (props.max !== undefined && Number(val) > props.max) {
      val = String(props.max);
    }
    this.commitValue(val);
  }

  commitValue(val) {
    if (this.def.binding?.stateVar) {
      this.widget.setLocalState(this.def.binding.stateVar, val);
    }
    if (this.def.binding?.writeEvent) {
      this.widget.dispatchSimEvent(this.def.binding.writeEvent, val);
    }
    if (this.inputNode) {
      this.inputNode.value = val;
      this.lastValidDisplay = val;
      if (this.formatSpec) this.maskBuffer = this.digitsFromDisplay(val);
    }
  }

  /**
   * Forces any pending (typed-but-not-yet-committed) edit to commit right now,
   * without waiting for a native 'blur'/'change' DOM event. Called by
   * InteractionDispatcher.js before a 'tap'/'longpress' action runs elsewhere in
   * this widget (e.g. a popover's Save button reading this field's committed
   * state) — a real blur normally beats that tap under standard browser focus-
   * shift ordering, but that ordering isn't something this component can rely
   * on across every browser/WebView, and there's no reason to when the actual
   * commit logic is just a direct method call away. No-ops when there's
   * nothing pending (this.dirty is false).
   */
  flushPendingEdit() {
    if (this.dirty && this.inputNode) {
      this.validateAndCommit(this.inputNode.value);
      this.dirty = false;
    }
  }

  /** FDWS v1.11 §1.1: discards an invalid/empty edit, restoring the field to its last known-good value. */
  revertToLastValid() {
    if (this.inputNode) {
      this.inputNode.value = this.lastValidDisplay || '';
      this.maskBuffer = this.formatSpec ? this.digitsFromDisplay(this.lastValidDisplay || '') : '';
    }
  }

  update(val, allState) {
    super.update(val, allState);
    if (this.inputNode && !this.isFocused && val !== undefined && val !== null) {
      const props = this.def.props || {};
      const formatted = ValueFormatter.format(val, props.format || 'RAW_INT');
      this.inputNode.value = formatted;
      this.lastValidDisplay = formatted;
      if (this.formatSpec) this.maskBuffer = this.digitsFromDisplay(formatted);
    }
  }
}
