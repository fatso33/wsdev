/**
 * SliderComponent.js
 * Renderer for core.slider (FDWS v1.2 §1.3) — absolute-position linear lever/track
 * (throttle, mixture, prop, flaps, trim tab), tracking the pointer 1:1 within its bounds
 * with optional snap-to detents[].
 */

import { BaseComponent } from './BaseComponent.js';
import { SecurityValidator } from '../../core/SecurityValidator.js';

export class SliderComponent extends BaseComponent {
  render() {
    super.render();
    this.element.classList.add('fd-comp-slider');

    const props = this.def.props || {};
    this.axis = props.axis === 'x' ? 'x' : 'y';
    this.min = props.min !== undefined ? props.min : 0;
    this.max = props.max !== undefined ? props.max : 100;

    const track = document.createElement('div');
    track.className = 'fd-slider-track';

    (props.detents || []).forEach((detent) => {
      const mark = document.createElement('div');
      mark.className = 'fd-slider-detent-mark';
      SecurityValidator.setText(mark, detent.label || '');
      this.positionAlongAxis(mark, detent.value, this.axis === 'x' ? 'width' : 'height', true);
      track.appendChild(mark);
    });

    const handle = document.createElement('div');
    handle.className = 'fd-slider-handle';
    if (this.axis === 'x') {
      handle.style.top = '0';
      handle.style.bottom = '0';
      handle.style.width = '18px';
    } else {
      handle.style.left = '0';
      handle.style.right = '0';
      handle.style.height = '18px';
    }
    track.appendChild(handle);

    this.trackNode = track;
    this.handleNode = handle;
    this.attachDrag(track);

    this.element.appendChild(track);
    return this.element;
  }

  /** Positions an element at a given value's normalized offset along the track. */
  positionAlongAxis(el, value, _sizeProp, isMarker) {
    const ratio = this.valueToRatio(value);
    const pct = `${ratio * 100}%`;
    if (this.axis === 'x') {
      el.style.left = pct;
      if (isMarker) el.style.top = '2px';
    } else {
      // Bottom = min for a vertical lever (throttle-quadrant convention)
      el.style.bottom = pct;
      if (isMarker) el.style.left = '2px';
    }
  }

  valueToRatio(value) {
    const span = this.max - this.min || 1;
    return Math.max(0, Math.min(1, (value - this.min) / span));
  }

  ratioToValue(ratio) {
    return this.min + ratio * (this.max - this.min);
  }

  attachDrag(track) {
    const props = this.def.props || {};
    let dragging = false;

    const ratioFromEvent = (e) => {
      const rect = track.getBoundingClientRect();
      if (this.axis === 'x') {
        return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      }
      return Math.max(0, Math.min(1, (rect.bottom - e.clientY) / rect.height));
    };

    const setFromRatio = (ratio, commit) => {
      let value = this.ratioToValue(ratio);
      if (commit && Array.isArray(props.detents)) {
        for (const d of props.detents) {
          if (!d.snap) continue;
          const tol = d.snapTolerance !== undefined ? d.snapTolerance : 2;
          if (Math.abs(value - d.value) <= tol) {
            value = d.value;
            this.widget?.handleInteraction?.(this.def, 'detentReached', { value, detent: d.label });
            break;
          }
        }
      }
      this.setPosition(value);
      const targetVar = this.def.binding?.stateVar;
      if (targetVar) this.widget.setLocalState(targetVar, value);
      if (this.def.binding?.writeEvent) {
        this.widget?.dispatchSimEvent?.(this.def.binding.writeEvent, value);
      }
      this.widget?.handleInteraction?.(this.def, 'change', { value });
    };

    const onPointerDown = (e) => {
      if (this.resolvePointerEvents() === 'none' || this.isInteractionBlocked()) return;
      dragging = true;
      track.setPointerCapture?.(e.pointerId);
      // FDWS v1.25: 'dragging' state style — single surface (this.element),
      // same ordinary setState()/applyStyles() path as core.rotary.
      this.setState('dragging');
      setFromRatio(ratioFromEvent(e), false);
    };
    const onPointerMove = (e) => {
      if (!dragging) return;
      setFromRatio(ratioFromEvent(e), false);
    };
    const onPointerUp = (e) => {
      if (!dragging) return;
      dragging = false;
      this.setState(undefined);
      setFromRatio(ratioFromEvent(e), true);
    };

    track.addEventListener('pointerdown', onPointerDown);
    track.addEventListener('pointermove', onPointerMove);
    track.addEventListener('pointerup', onPointerUp);
    track.addEventListener('pointercancel', onPointerUp);
  }

  setPosition(value) {
    if (!this.handleNode) return;
    const ratio = this.valueToRatio(value);
    if (this.axis === 'x') {
      this.handleNode.style.left = `${ratio * 100}%`;
      this.handleNode.style.transform = 'translateX(-50%)';
    } else {
      this.handleNode.style.bottom = `${ratio * 100}%`;
      this.handleNode.style.transform = 'translateY(50%)';
    }
  }

  update(val, allState) {
    super.update(val, allState);
    if (val !== undefined && val !== null) {
      this.setPosition(Number(val));
    }
  }
}
