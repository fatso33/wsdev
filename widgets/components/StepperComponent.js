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
