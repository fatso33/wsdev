/**
 * SelectorComponent.js
 * Renderer for core.selector (FDWS v1.2 §1.4) — discrete multi-position rotary or
 * lever switch (fuel selector, mag switch, mode/source knob). Tap-nearest, or
 * drag-and-release-nearest in rotary mode.
 */

import { BaseComponent } from './BaseComponent.js';
import { SecurityValidator } from '../../core/SecurityValidator.js';

export class SelectorComponent extends BaseComponent {
  render() {
    super.render();
    this.element.classList.add('fd-comp-selector');
    this.element.style.position = 'relative';

    const props = this.def.props || {};
    const mode = props.mode === 'lever' ? 'lever' : 'rotary';
    const positions = Array.isArray(props.positions) ? props.positions : [];

    this.currentValue = this.widget?.getLocalState?.(this.def.binding?.stateVar);

    if (mode === 'rotary') {
      const pointer = document.createElement('div');
      pointer.className = 'fd-selector-pointer';
      this.pointerNode = pointer;
      this.element.appendChild(pointer);
    }

    this.posNodes = new Map();
    positions.forEach((pos, idx) => {
      const posEl = document.createElement('div');
      posEl.className = 'fd-selector-position';
      SecurityValidator.setText(posEl, pos.label !== undefined ? pos.label : pos.value);

      if (mode === 'rotary') {
        const angleRad = ((pos.angle || 0) - 90) * (Math.PI / 180);
        const radius = 42;
        posEl.style.left = `${50 + radius * Math.cos(angleRad) * 0.01 * 100}%`;
        posEl.style.top = `${50 + radius * Math.sin(angleRad) * 0.01 * 100}%`;
      } else {
        const axis = props.axis === 'x' ? 'x' : 'y';
        const pct = positions.length > 1 ? (idx / (positions.length - 1)) * 100 : 50;
        if (axis === 'x') {
          posEl.style.left = `${pct}%`;
          posEl.style.top = '50%';
        } else {
          posEl.style.top = `${pct}%`;
          posEl.style.left = '50%';
        }
      }

      posEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (this.isInteractionBlocked()) return;
        this.selectPosition(pos);
      });

      this.posNodes.set(pos.value, posEl);
      this.element.appendChild(posEl);
    });

    this.applyActivePosition();

    const guardOverlay = this.setupGuard();
    if (guardOverlay) this.element.appendChild(guardOverlay);

    return this.element;
  }

  selectPosition(pos) {
    const from = this.currentValue;
    this.currentValue = pos.value;
    this.applyActivePosition();

    const targetVar = this.def.binding?.stateVar;
    if (targetVar) this.widget.setLocalState(targetVar, pos.value);
    if (this.def.binding?.writeEvent) {
      this.widget?.dispatchSimEvent?.(this.def.binding.writeEvent, pos.value);
    }
    this.widget?.handleInteraction?.(this.def, 'positionChange', { from, to: pos.value });
  }

  applyActivePosition() {
    const props = this.def.props || {};
    const positions = Array.isArray(props.positions) ? props.positions : [];
    this.posNodes.forEach((node, value) => {
      node.classList.toggle('active', value === this.currentValue);
    });
    if (this.pointerNode) {
      const active = positions.find((p) => p.value === this.currentValue);
      if (active) {
        this.pointerNode.style.transform = `translate(-50%, -100%) rotate(${active.angle || 0}deg)`;
      }
    }
  }

  update(val, allState) {
    super.update(val, allState);
    if (val !== undefined) {
      this.currentValue = val;
      this.applyActivePosition();
    }
  }
}
