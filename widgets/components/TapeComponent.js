/**
 * TapeComponent.js
 * Renderer for core.tape (FDWS v1.20 §3) — a continuously-scrolling ruler strip
 * (airspeed/altitude tape) with tick marks and numeric labels generated from a few
 * authored numbers, not an artist-drawn asset, plus a fixed index line marking the
 * current reading. Distinct from core.list (a discrete array-of-state-values
 * repeater) — this is a value-driven, effectively infinite ruler with no backing
 * array at all: the visible window of ticks is computed fresh from the bound value
 * on every update(), so it works for any open-ended range (e.g. altitude 0–50,000)
 * without pre-generating anything past what's currently on screen.
 *
 * The current value itself isn't rendered as a number by this component — that's a
 * separate core.display layered on top at the index line, same multi-layer-
 * component convention every other instrument in this library already uses (a
 * needle over a dial face, a fill over an arc track, etc.).
 */

import { BaseComponent } from './BaseComponent.js';

export class TapeComponent extends BaseComponent {
  render() {
    super.render();
    this.element.classList.add('fd-comp-tape');
    this.element.style.position = 'relative';
    this.element.style.overflow = 'hidden';

    const props = this.def.props || {};
    const axis = props.axis === 'x' ? 'x' : 'y';

    const strip = document.createElement('div');
    strip.className = 'fd-tape-strip';
    strip.style.position = 'absolute';
    strip.style.inset = '0';

    const indexLine = document.createElement('div');
    indexLine.className = 'fd-tape-index-line';
    indexLine.style.position = 'absolute';
    indexLine.style.background = props.indexLineColor || 'var(--accent-cyan, #22d3ee)';
    indexLine.style.pointerEvents = 'none';
    if (axis === 'y') {
      indexLine.style.left = '0';
      indexLine.style.right = '0';
      indexLine.style.top = '50%';
      indexLine.style.height = '2px';
      indexLine.style.transform = 'translateY(-1px)';
    } else {
      indexLine.style.top = '0';
      indexLine.style.bottom = '0';
      indexLine.style.left = '50%';
      indexLine.style.width = '2px';
      indexLine.style.transform = 'translateX(-1px)';
    }

    this.element.appendChild(strip);
    this.element.appendChild(indexLine);

    this.stripEl = strip;
    this.lastValue = undefined;

    // rebuildTicks() needs this.element's real laid-out size (getBoundingClientRect()),
    // which is still 0×0 the instant render() returns — CompositeWidget's mount flow
    // calls update() synchronously right after render(), before the grid has actually
    // been laid out/painted. A ResizeObserver decouples "size became known/changed"
    // from "value changed" (update()), so the very first real layout pass (and any
    // later resize/orientation change) reliably (re)builds the tick window instead of
    // silently staying empty forever whenever that race is lost.
    this.resizeObserver = new ResizeObserver(() => {
      if (this.lastValue !== undefined) this.rebuildTicks(this.lastValue);
    });
    this.resizeObserver.observe(this.element);

    return this.element;
  }

  destroy() {
    this.resizeObserver?.disconnect();
    super.destroy();
  }

  /**
   * Rebuilds the strip's visible tick marks + labels for the given center value.
   * Full re-render on every update() rather than incremental DOM diffing — the
   * element count is small (a screenful of ticks) and this matches the rest of
   * this codebase's "just re-render, don't diff" style (see ListComponent.js).
   * @param {number} centerVal
   */
  rebuildTicks(centerVal) {
    const props = this.def.props || {};
    const axis = props.axis === 'x' ? 'x' : 'y';
    const tickInterval = Number(props.tickInterval) || 10;
    const majorEvery = Math.max(1, Number(props.majorEvery) || 5);
    const pxPerUnit = Number(props.pxPerUnit) || 2;
    const minorLen = Number(props.minorTickLength) || 8;
    const majorLen = Number(props.majorTickLength) || 16;
    const tickColor = props.tickColor || '#94a3b8';
    const labelColor = props.labelColor || tickColor;
    const decimals = Number.isFinite(props.decimals) ? props.decimals : 0;
    const reverse = Boolean(props.reverse);

    const rect = this.element.getBoundingClientRect();
    const sizePx = axis === 'y' ? rect.height : rect.width;
    if (!sizePx) return false;

    const halfSpanUnits = (sizePx / 2) / pxPerUnit;
    // One extra tickInterval of buffer past each edge so a tick doesn't pop in
    // right at the visible boundary as the value scrolls.
    const lo = Math.floor((centerVal - halfSpanUnits - tickInterval) / tickInterval) * tickInterval;
    const hi = Math.ceil((centerVal + halfSpanUnits + tickInterval) / tickInterval) * tickInterval;

    const frag = document.createDocumentFragment();
    for (let tickVal = lo; tickVal <= hi; tickVal += tickInterval) {
      const majorIndex = Math.round(tickVal / tickInterval);
      const isMajor = majorIndex % majorEvery === 0;
      const delta = (tickVal - centerVal) * pxPerUnit * (reverse ? -1 : 1);

      const tick = document.createElement('div');
      tick.style.position = 'absolute';
      tick.style.background = tickColor;

      const len = isMajor ? majorLen : minorLen;
      if (axis === 'y') {
        tick.style.top = `calc(50% + ${delta}px)`;
        tick.style.right = '0';
        tick.style.width = `${len}px`;
        tick.style.height = '1.5px';
        tick.style.transform = 'translateY(-0.75px)';
      } else {
        tick.style.left = `calc(50% + ${delta}px)`;
        tick.style.bottom = '0';
        tick.style.height = `${len}px`;
        tick.style.width = '1.5px';
        tick.style.transform = 'translateX(-0.75px)';
      }
      frag.appendChild(tick);

      if (isMajor) {
        const label = document.createElement('div');
        label.className = 'fd-tape-label';
        label.textContent = tickVal.toFixed(decimals);
        label.style.position = 'absolute';
        label.style.color = labelColor;
        label.style.fontSize = '11px';
        label.style.fontFamily = 'inherit';
        label.style.whiteSpace = 'nowrap';
        if (axis === 'y') {
          label.style.top = `calc(50% + ${delta}px)`;
          label.style.right = `${len + 4}px`;
          label.style.transform = 'translateY(-50%)';
        } else {
          label.style.left = `calc(50% + ${delta}px)`;
          label.style.bottom = `${len + 4}px`;
          label.style.transform = 'translateX(-50%)';
        }
        frag.appendChild(label);
      }
    }

    this.stripEl.innerHTML = '';
    this.stripEl.appendChild(frag);
    return true;
  }

  update(val, allState) {
    super.update(val, allState);
    if (!this.stripEl) return;
    const num = Number(val);
    const centerVal = Number.isFinite(num) ? num : 0;
    this.lastValue = centerVal;

    // CompositeWidget.render() calls every component's initial update() while
    // its whole component tree is still detached (it appends each rendered
    // component to an offscreen container throughout its mount loop, then
    // attaches that container to the live DOM only once the loop finishes) —
    // so this component's very first rebuildTicks() call always measures a
    // 0×0 box and (correctly) no-ops. A microtask re-check — guaranteed to run
    // after that synchronous mount loop (and its final attach) has completed,
    // regardless of whether the browser has produced an actual animation
    // frame yet — catches that one-time initial race. The ResizeObserver
    // above is a separate, ongoing mechanism for genuine later resizes
    // (window resize, orientation change, an edit-mode resize drag).
    if (!this.rebuildTicks(centerVal)) {
      queueMicrotask(() => {
        if (this.stripEl && this.lastValue === centerVal) this.rebuildTicks(centerVal);
      });
    }
  }
}
