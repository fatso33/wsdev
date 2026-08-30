/**
 * RockerComponent.js
 * Renderer for core.rocker (FDWS v1.2 §2.1) — spring-loaded 2-zone momentary rocker
 * switch (elevator trim, incremental flaps). Press-and-hold auto-repeats at
 * zone.repeatRate ms; releasing (or pointer leaving) immediately springs back to center.
 */

import { BaseComponent } from './BaseComponent.js';
import { SecurityValidator } from '../../core/SecurityValidator.js';

export class RockerComponent extends BaseComponent {
  render() {
    super.render();
    this.element.classList.add('fd-comp-rocker');
    this.element.style.position = 'relative';

    const props = this.def.props || {};
    const axis = props.axis === 'x' ? 'row' : 'column';
    this.element.style.flexDirection = axis;

    this.repeatTimers = new Map();
    const zones = Array.isArray(props.zones) ? props.zones : [];

    zones.forEach((zone) => {
      const zoneEl = document.createElement('div');
      zoneEl.className = 'fd-rocker-zone';
      SecurityValidator.setText(zoneEl, zone.label || '');

      const activate = (e) => {
        if (this.resolvePointerEvents() === 'none' || this.isInteractionBlocked()) return;
        e.preventDefault();
        zoneEl.setPointerCapture?.(e.pointerId);
        zoneEl.classList.add('fd-rocker-zone-active');
        this.widget?.handleInteraction?.(this.def, 'zoneActive', { zoneId: zone.id });
        if (zone.writeEvent) this.widget?.dispatchSimEvent?.(zone.writeEvent, 1);

        const rate = zone.repeatRate || 100;
        clearInterval(this.repeatTimers.get(zone.id));
        const timer = setInterval(() => {
          if (zone.writeEvent) this.widget?.dispatchSimEvent?.(zone.writeEvent, 1);
        }, rate);
        this.repeatTimers.set(zone.id, timer);
      };

      const release = () => {
        clearInterval(this.repeatTimers.get(zone.id));
        this.repeatTimers.delete(zone.id);
        if (zoneEl.classList.contains('fd-rocker-zone-active')) {
          zoneEl.classList.remove('fd-rocker-zone-active');
          this.widget?.handleInteraction?.(this.def, 'zoneReleased', { zoneId: zone.id });
        }
      };

      zoneEl.addEventListener('pointerdown', activate);
      zoneEl.addEventListener('pointerup', release);
      zoneEl.addEventListener('pointercancel', release);
      zoneEl.addEventListener('pointerleave', release);

      this.element.appendChild(zoneEl);
    });

    const guardOverlay = this.setupGuard();
    if (guardOverlay) this.element.appendChild(guardOverlay);

    return this.element;
  }

  destroy() {
    if (this.repeatTimers) {
      this.repeatTimers.forEach((timer) => clearInterval(timer));
      this.repeatTimers.clear();
    }
    super.destroy();
  }
}
