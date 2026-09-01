/**
 * StepperComponent.js
 * Renderer for core.stepper (+/- step increment/decrement control)
 */

import { BaseComponent } from './BaseComponent.js';

export class StepperComponent extends BaseComponent {
  render() {
    super.render();
    this.element.classList.add('fd-comp-stepper');

    const props = this.def.props || {};
    const decBtn = document.createElement('button');
    decBtn.type = 'button';
    decBtn.className = 'fd-step-btn fd-step-dec';
    decBtn.textContent = '−';

    const incBtn = document.createElement('button');
    incBtn.type = 'button';
    incBtn.className = 'fd-step-btn fd-step-inc';
    incBtn.textContent = '+';

    decBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleStep(-1);
      this.widget?.handleInteraction?.(this.def, 'decrement', { step: props.step || 1 });
    });

    incBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.handleStep(1);
      this.widget?.handleInteraction?.(this.def, 'increment', { step: props.step || 1 });
    });

    // FDWS v1.25: 'pressed' state style, per-button (the +/- buttons need
    // independent looks) via applyOptionalStateStyle -- replaces/layers over
    // the default hardcoded .fd-step-btn:active CSS the same way
    // ButtonComponent's momentary variant does. A click's own pointerdown
    // already fires :active natively for the default look; this only adds
    // the author-customizable override on top, cleared on pointerup/cancel/
    // leave same as everywhere else this pattern's used.
    [decBtn, incBtn].forEach((stepBtn) => {
      const clearPressed = () => this.applyOptionalStateStyle(stepBtn, 'pressed', false);
      stepBtn.addEventListener('pointerdown', () => this.applyOptionalStateStyle(stepBtn, 'pressed', true));
      stepBtn.addEventListener('pointerup', clearPressed);
      stepBtn.addEventListener('pointercancel', clearPressed);
      stepBtn.addEventListener('pointerleave', clearPressed);
    });

    this.element.appendChild(decBtn);
    this.element.appendChild(incBtn);
    return this.element;
  }

  handleStep(direction) {
    const props = this.def.props || {};
    const step = (props.step || 1) * direction;
    const targetVar = this.def.binding?.stateVar;
    if (targetVar) {
      const current = Number(this.widget.getLocalState(targetVar)) || 0;
      let next = current + step;
      if (props.min !== undefined) next = Math.max(props.min, next);
      if (props.max !== undefined) next = Math.min(props.max, next);
      this.widget.setLocalState(targetVar, next);
    }
  }
}
