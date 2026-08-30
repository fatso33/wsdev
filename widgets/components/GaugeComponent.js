/**
 * GaugeComponent.js
 * Renderer for core.gauge (FDWS v1.2 §1.1) — display-only needle/bar/arc driven by a
 * bound value through a rotate/translate/arc-fill/arc visual transform. Never
 * interactive; see BaseComponent.resolvePointerEvents() for the always-none-unless-
 * interactions rule.
 *
 * `props.compose` (additive, backward-compatible): lets a single gauge apply a SECOND
 * transform function on top of its primary one — e.g. a rotate(bank) horizon that also
 * translates for pitch, as one rigid body, instead of two independently-moving layers.
 * The secondary value is read from local widget state (`allState`, already passed into
 * every component's update()) rather than a second SimVar subscription — no new binding
 * plumbing needed. `props.compose` shape: { transform, axis?, stateVar, valueRange,
 * outputRange, clamp? }. Composed as `<primary> <secondary>` in that order, so the
 * secondary (typically translate) is applied in the pre-rotation frame and the primary
 * (typically rotate) carries it around the pivot — matching real ADI kinematics. Omitting
 * `props.compose` preserves the original single-transform behavior exactly. `compose` is
 * only meaningful for the `rotate`/`translate`/`arc-fill` CSS-transform primaries — it has
 * no effect on `arc` (an SVG stroke geometry, not a transform) and is silently ignored
 * there, same graceful-degradation posture as everywhere else in this class.
 *
 * `props.transform: "arc"` (FDWS v1.20, additive): a real curved SVG arc — a value-driven
 * stroke-dashoffset sweep along a circular path, plus optional static colored zone bands
 * (caution/redline) — replacing the need to hand-author a curved gauge face as a raster
 * asset. `arc-fill` (pre-v1.20) is kept exactly as-is for back-compat: it's a straight
 * scaleX() bar-fill, useful for a linear/rectangular fill effect, not a circular one. A
 * needle on top of an `arc` gauge is still just a separate `core.gauge` (rotate) layer
 * stacked over it, same multi-layer-component convention the Attitude Indicator already
 * uses for its own rotate+translate composition.
 */

import { BaseComponent } from './BaseComponent.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * A point at `angleDeg` around a circle of `radius` centered at (cx, cy), where 0° is
 * straight up and positive angles sweep clockwise — the same "degrees clockwise from
 * top" convention Widget Studio's core.selector rotary positions already use.
 */
function polarPoint(cx, cy, radius, angleDeg) {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + radius * Math.sin(rad), y: cy - radius * Math.cos(rad) };
}

/**
 * An SVG `<path>` "d" string for the circular arc from startAngle to endAngle (degrees,
 * same clockwise-from-top convention as polarPoint). Handles sweeps in either direction
 * and sweeps greater than 180°.
 */
function describeArcPath(cx, cy, radius, startAngle, endAngle) {
  const start = polarPoint(cx, cy, radius, startAngle);
  const end = polarPoint(cx, cy, radius, endAngle);
  const sweep = endAngle - startAngle;
  const largeArcFlag = Math.abs(sweep) > 180 ? 1 : 0;
  const sweepFlag = sweep >= 0 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${end.x} ${end.y}`;
}

export class GaugeComponent extends BaseComponent {
  render() {
    super.render();
    this.element.classList.add('fd-comp-gauge');

    const props = this.def.props || {};

    if (props.transform === 'arc') {
      this.renderArc(props);
      return this.element;
    }

    const layer = document.createElement('div');
    layer.className = props.transform === 'arc-fill' ? 'fd-gauge-arc-fill' : 'fd-gauge-transform-layer';

    if (props.transform !== 'arc-fill') {
      const assetId = this.def.assets?.image;
      if (assetId) {
        const img = document.createElement('img');
        img.className = 'fd-comp-img-element';
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'contain';
        img.style.pointerEvents = 'none';
        const url = this.widget.resolveAssetUrl(assetId);
        if (url) img.src = url;
        layer.appendChild(img);
      }
    }

    if (props.transform === 'rotate' || props.compose?.transform === 'rotate') {
      const pivot = props.pivot || { x: '50%', y: '50%' };
      layer.style.transformOrigin = `${pivot.x} ${pivot.y}`;
    }

    this.applyTransition(layer, this.def.binding?.transition, 'transform');

    this.transformLayer = layer;
    this.element.appendChild(layer);
    return this.element;
  }

  /**
   * FDWS v1.20: builds the static SVG geometry for `transform: "arc"` — the track
   * (always-visible full sweep), any colored zone bands, and the value-driven fill
   * path (a full-length stroke-dasharray whose dashoffset update() animates). Bands
   * and the track never change after mount; only the fill path's dashoffset moves,
   * so all the path math happens once here rather than on every update().
   * @param {object} props
   */
  renderArc(props) {
    const arc = props.arc || {};
    const cx = 50;
    const cy = 50;
    const radius = Number(arc.radius) || 40;
    const strokeWidth = Number(arc.strokeWidth) || 6;
    const startAngle = Number.isFinite(arc.startAngle) ? arc.startAngle : -120;
    const endAngle = Number.isFinite(arc.endAngle) ? arc.endAngle : 120;
    const lineCap = arc.lineCap === 'butt' ? 'butt' : 'round';
    const trackColor = arc.trackColor || 'rgba(255,255,255,0.12)';
    const fillColor = arc.color || 'var(--accent-cyan, #22d3ee)';
    const showFill = arc.showFill !== false;
    const bands = Array.isArray(arc.bands) ? arc.bands : [];

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.display = 'block';
    svg.style.overflow = 'visible';
    svg.style.pointerEvents = 'none';

    const fullPathD = describeArcPath(cx, cy, radius, startAngle, endAngle);
    const fullLength = radius * (Math.abs(endAngle - startAngle) * Math.PI) / 180;

    const track = document.createElementNS(SVG_NS, 'path');
    track.setAttribute('d', fullPathD);
    track.setAttribute('fill', 'none');
    track.setAttribute('stroke', trackColor);
    track.setAttribute('stroke-width', String(strokeWidth));
    track.setAttribute('stroke-linecap', lineCap);
    svg.appendChild(track);

    // Colored zone bands (e.g. caution/redline) — each a static sub-segment of the
    // same arc, positioned by RATIO (0..1) along the value range, not by raw value or
    // by absolute angle, so a band stays correctly placed if startAngle/endAngle are
    // later adjusted.
    bands.forEach((band) => {
      const from = Math.max(0, Math.min(1, Number(band?.from) || 0));
      const to = Math.max(0, Math.min(1, Number(band?.to) || 0));
      if (to <= from) return;
      const bandStart = startAngle + from * (endAngle - startAngle);
      const bandEnd = startAngle + to * (endAngle - startAngle);
      const bandPath = document.createElementNS(SVG_NS, 'path');
      bandPath.setAttribute('d', describeArcPath(cx, cy, radius, bandStart, bandEnd));
      bandPath.setAttribute('fill', 'none');
      bandPath.setAttribute('stroke', band?.color || '#ef4444');
      bandPath.setAttribute('stroke-width', String(strokeWidth));
      bandPath.setAttribute('stroke-linecap', 'butt');
      svg.appendChild(bandPath);
    });

    let fillPath = null;
    if (showFill) {
      fillPath = document.createElementNS(SVG_NS, 'path');
      fillPath.setAttribute('d', fullPathD);
      fillPath.setAttribute('fill', 'none');
      fillPath.setAttribute('stroke', fillColor);
      fillPath.setAttribute('stroke-width', String(strokeWidth));
      fillPath.setAttribute('stroke-linecap', lineCap);
      fillPath.style.strokeDasharray = `${fullLength} ${fullLength}`;
      fillPath.style.strokeDashoffset = String(fullLength);
      this.applyTransition(fillPath, this.def.binding?.transition, 'stroke-dashoffset');
      svg.appendChild(fillPath);
    }

    this.element.appendChild(svg);

    this.arcFillPath = fillPath;
    this.arcFullLength = fullLength;
  }

  /**
   * Maps a raw bound value through a {transform, axis, valueRange, outputRange, clamp}
   * config into a single CSS transform function string (e.g. "rotate(12deg)").
   * @param {object} cfg
   * @param {any} rawVal
   * @returns {string}
   */
  resolveTransformFn(cfg, rawVal) {
    const [domainMin, domainMax] = cfg.valueRange || [0, 1];
    const [outMin, outMax] = cfg.outputRange || [0, 1];
    const clamp = cfg.clamp !== false;

    let num = Number(rawVal);
    if (isNaN(num)) num = domainMin;

    const domainSpan = domainMax - domainMin || 1;
    let ratio = (num - domainMin) / domainSpan;
    if (clamp) ratio = Math.max(0, Math.min(1, ratio));

    const outSpan = outMax - outMin;
    const outVal = outMin + ratio * outSpan;

    switch (cfg.transform) {
      case 'translate': {
        const axis = cfg.axis === 'x' ? 'X' : 'Y';
        return `translate${axis}(${outVal}px)`;
      }
      case 'arc-fill': {
        const fillRatio = clamp ? Math.max(0, Math.min(1, outVal)) : outVal;
        return `scaleX(${fillRatio})`;
      }
      case 'rotate':
      default:
        return `rotate(${outVal}deg)`;
    }
  }

  /**
   * Maps a raw bound value straight through `props.valueRange` into a 0..1 ratio (no
   * outputRange — the arc's angular span is already fully described by
   * props.arc.startAngle/endAngle, so there's nothing else for an output range to mean).
   * @param {object} props
   * @param {any} rawVal
   * @returns {number}
   */
  resolveArcRatio(props, rawVal) {
    const [domainMin, domainMax] = props.valueRange || [0, 1];
    let num = Number(rawVal);
    if (isNaN(num)) num = domainMin;
    const domainSpan = domainMax - domainMin || 1;
    let ratio = (num - domainMin) / domainSpan;
    if (props.clamp !== false) ratio = Math.max(0, Math.min(1, ratio));
    return ratio;
  }

  update(val, allState) {
    super.update(val, allState);

    const props = this.def.props || {};
    if (props.transform === 'arc') {
      if (!this.arcFillPath) return;
      const ratio = this.resolveArcRatio(props, val);
      this.arcFillPath.style.strokeDashoffset = String(this.arcFullLength * (1 - ratio));
      return;
    }

    if (!this.transformLayer) return;
    let transform = this.resolveTransformFn(props, val);

    if (props.compose && props.compose.stateVar) {
      let secondaryVal = (allState || {})[props.compose.stateVar];
      // v1.5.1 (local extension): compose.relativeToStateVar — for a gauge
      // showing a TARGET against a background that already moved to reflect
      // the CURRENT reading (e.g. an FD command bar over a pitch ladder that
      // itself translates by current pitch), the on-screen delta needs to be
      // (target - current), not target run through the same absolute-value
      // formula the background uses — that only coincides with the fixed
      // reference symbol when target happens to equal current, and renders
      // wrong by exactly (target - current)'s worth of offset otherwise.
      // Optional and additive: omitting it preserves the original absolute-
      // value behavior exactly.
      if (props.compose.relativeToStateVar) {
        const referenceVal = (allState || {})[props.compose.relativeToStateVar];
        secondaryVal = (Number(secondaryVal) || 0) - (Number(referenceVal) || 0);
      }
      transform += ` ${this.resolveTransformFn(props.compose, secondaryVal)}`;
    }

    this.transformLayer.style.transform = transform;
  }
}
