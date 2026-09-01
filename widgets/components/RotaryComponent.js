/**
 * RotaryComponent.js
 * Renderer for core.rotary (Rotary dial with coarse/fine touch dragging and center push,
 * or a linear "wheel" visual when props.circular is false — FDWS v1.2 §1.2)
 */

import { BaseComponent } from './BaseComponent.js';
import { SecurityValidator } from '../../core/SecurityValidator.js';

export class RotaryComponent extends BaseComponent {
  render() {
    super.render();
    this.element.classList.add('fd-comp-rotary');

    const props = this.def.props || {};
    // FDWS v1.2 §1.2: props.circular is now normative. true (default) = knob visual
    // (v1.1 behavior). false = linear scrolling "wheel" track (VS wheel, trim wheel) —
    // reuses attachDragPhysics() unchanged; only the render/CSS path differs.
    const circular = props.circular !== false;

    const knobWrap = document.createElement('div');
    knobWrap.className = circular ? 'fd-rotary-wrap' : 'fd-rotary-wheel-track';

    if (circular) {
      // Outer ring for coarse
      const outerRing = document.createElement('div');
      outerRing.className = 'fd-rotary-outer-ring';
      knobWrap.appendChild(outerRing);

      // Inner ring for fine
      const innerRing = document.createElement('div');
      innerRing.className = 'fd-rotary-inner-ring';
      knobWrap.appendChild(innerRing);

      // Center push button
      if (props.pushLabel || this.def.binding?.pushEvent) {
        const pushBtn = document.createElement('button');
        pushBtn.type = 'button';
        pushBtn.className = 'fd-rotary-center-btn';
        SecurityValidator.setText(pushBtn, props.pushLabel || 'PUSH');
        pushBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.widget?.handleInteraction?.(this.def, 'push', { originalEvent: e });
          if (this.def.binding?.pushEvent) {
            this.widget?.dispatchSimEvent?.(this.def.binding.pushEvent, 0);
          }
        });
        knobWrap.appendChild(pushBtn);
      }
    } else {
      // Linear wheel visual: a fixed centerline indicator over a scrolling tick track
      const indicator = document.createElement('div');
      indicator.className = 'fd-rotary-wheel-indicator';
      knobWrap.appendChild(indicator);
    }

    // Touch / Pointer Drag handling on knob — identical drag-delta/accumulator logic
    // regardless of circular value, per §1.2.
    this.attachDragPhysics(knobWrap, props);

    this.element.appendChild(knobWrap);
    return this.element;
  }

  attachDragPhysics(knobWrap, props) {
    let startY = 0;
    let isDragging = false;
    let accumulated = 0;
    const coarseStep = props.coarseStep || 10;
    const fineStep = props.fineStep || 1;

    const onPointerDown = (e) => {
      if (this.resolvePointerEvents() === 'none') return;
      isDragging = true;
      startY = e.clientY;
      accumulated = 0;
      knobWrap.setPointerCapture?.(e.pointerId);
      // FDWS v1.25: 'dragging' state style — this component had no visual
      // feedback at all while being dragged before this; single surface
      // (this.element, same node the base style already targets), so the
      // ordinary setState()/applyStyles() path applies directly.
      this.setState('dragging');
      this.widget.handleInteraction(this.def, 'dragStart', { originalEvent: e });
    };

    const onPointerMove = (e) => {
      if (!isDragging) return;
      const deltaY = startY - e.clientY;
      accumulated += deltaY;
      startY = e.clientY;

      if (Math.abs(accumulated) >= 15) {
        const steps = Math.trunc(accumulated / 15);
        accumulated -= steps * 15;
        const change = steps * fineStep;
        this.widget.handleInteraction(this.def, 'fineChange', { delta: change });
      }
    };

    const onPointerUp = (e) => {
      if (!isDragging) return;
      isDragging = false;
      this.setState(undefined);
      this.widget.handleInteraction(this.def, 'dragEnd', { originalEvent: e });
    };

    knobWrap.addEventListener('pointerdown', onPointerDown);
    knobWrap.addEventListener('pointermove', onPointerMove);
    knobWrap.addEventListener('pointerup', onPointerUp);
    knobWrap.addEventListener('pointercancel', onPointerUp);
  }
}
