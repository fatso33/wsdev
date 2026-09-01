/**
 * PadComponent.js
 * Renderer for core.pad (FDWS v1.2 §3.5) — 2-axis touch surface for map pan/zoom or
 * absolute cursor placement (MFD map, TDC control). mode:'relative' emits panDelta
 * {dx,dy} per drag-move frame; mode:'absolute' emits positionChange {x,y} normalized
 * 0-1 within the pad bounds. A two-pointer pinch emits zoomDelta regardless of mode.
 */

import { BaseComponent } from './BaseComponent.js';

export class PadComponent extends BaseComponent {
  render() {
    super.render();
    this.element.classList.add('fd-comp-pad');

    const crosshair = document.createElement('div');
    crosshair.className = 'fd-pad-crosshair';
    crosshair.style.left = '50%';
    crosshair.style.top = '50%';
    crosshair.style.display = 'none';
    this.crosshairNode = crosshair;
    this.element.appendChild(crosshair);

    this.activePointers = new Map();
    this.attachPointerHandlers();

    return this.element;
  }

  attachPointerHandlers() {
    const props = this.def.props || {};
    const mode = props.mode === 'absolute' ? 'absolute' : 'relative';
    const sensitivity = props.sensitivity !== undefined ? props.sensitivity : 1.0;
    let lastX = 0;
    let lastY = 0;
    let pinchStartDist = null;

    const posFromEvent = (e) => {
      const rect = this.element.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height))
      };
    };

    const onPointerDown = (e) => {
      if (this.resolvePointerEvents() === 'none') return;
      this.element.setPointerCapture?.(e.pointerId);
      // FDWS v1.25: 'engaged' state style — single surface (this.element),
      // active for as long as any pointer is down on the pad (pinch included).
      if (this.activePointers.size === 0) this.setState('engaged');
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      lastX = e.clientX;
      lastY = e.clientY;

      if (this.activePointers.size === 2) {
        const pts = [...this.activePointers.values()];
        pinchStartDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      }

      if (mode === 'absolute') {
        const p = posFromEvent(e);
        this.setCrosshair(p);
        this.widget?.handleInteraction?.(this.def, 'positionChange', p);
      }
    };

    const onPointerMove = (e) => {
      if (!this.activePointers.has(e.pointerId)) return;
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this.activePointers.size === 2 && pinchStartDist !== null) {
        const pts = [...this.activePointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const zoomDelta = (dist - pinchStartDist) / pinchStartDist;
        pinchStartDist = dist;
        this.widget?.handleInteraction?.(this.def, 'zoomDelta', { zoomDelta });
        return;
      }

      if (mode === 'relative') {
        const dx = (e.clientX - lastX) * sensitivity;
        const dy = (e.clientY - lastY) * sensitivity;
        lastX = e.clientX;
        lastY = e.clientY;
        this.widget?.handleInteraction?.(this.def, 'panDelta', { dx, dy });
      } else {
        const p = posFromEvent(e);
        this.setCrosshair(p);
        this.widget?.handleInteraction?.(this.def, 'positionChange', p);
      }
    };

    const onPointerUp = (e) => {
      this.activePointers.delete(e.pointerId);
      if (this.activePointers.size < 2) pinchStartDist = null;
      if (this.activePointers.size === 0) this.setState(undefined);
    };

    this.element.addEventListener('pointerdown', onPointerDown);
    this.element.addEventListener('pointermove', onPointerMove);
    this.element.addEventListener('pointerup', onPointerUp);
    this.element.addEventListener('pointercancel', onPointerUp);
  }

  setCrosshair(p) {
    if (!this.crosshairNode) return;
    this.crosshairNode.style.display = '';
    this.crosshairNode.style.left = `${p.x * 100}%`;
    this.crosshairNode.style.top = `${p.y * 100}%`;
  }
}
