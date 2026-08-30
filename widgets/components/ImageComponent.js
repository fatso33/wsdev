/**
 * ImageComponent.js
 * Renderer for core.image (Decorative or state-driven image / background art asset)
 *
 * FDWS v1.20 §2: `props.renderMode: "inline"` injects an SVG asset as live DOM markup
 * instead of an opaque `<img src="data:...">`. Every other component's own background/
 * border/typography colors already run through BaseComponent.applyStyles()'s full
 * theme-resolution pipeline before landing on `this.element.style.color` (see
 * BaseComponent.js) — inlining the SVG means any shape inside it authored with
 * `fill="currentColor"`/`stroke="currentColor"` picks that same resolved color up for
 * free via CSS, including state-driven style.rules swaps, with no new binding plumbing
 * and no per-pixel raster recoloring logic needed here at all. A non-SVG asset (or no
 * asset at all) falls back to the normal <img> render regardless of renderMode — nothing
 * to inline, same graceful-degradation posture as everywhere else in this codebase.
 */

import { BaseComponent } from './BaseComponent.js';

export class ImageComponent extends BaseComponent {
  render() {
    super.render();
    this.element.classList.add('fd-comp-image');

    const props = this.def.props || {};
    const assetId = props.assetId;
    const fit = props.fit || 'contain';

    if (props.renderMode === 'inline' && assetId) {
      const svgText = this.widget.resolveAssetSvgText?.(assetId);
      if (svgText) {
        this.renderInlineSvg(svgText, fit);
        return this.element;
      }
      // No SVG to inline (asset missing, or a raster mimeType) — fall through
      // to the normal <img> path below.
    }

    const img = document.createElement('img');
    img.className = 'fd-comp-img-element';
    img.alt = this.def.label || 'Widget Art';

    if (assetId) {
      const assetUrl = this.widget.resolveAssetUrl(assetId);
      if (assetUrl) {
        img.src = assetUrl;
      }
    }

    img.style.objectFit = fit;
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.display = 'block';

    if (this.def.layer?.pointerEvents === 'none') {
      img.style.pointerEvents = 'none';
    }

    this.imgNode = img;
    this.inlineSvgEl = null;
    this.element.appendChild(img);
    return this.element;
  }

  /**
   * @param {string} svgText - already-sanitized SVG source (SecurityValidator.sanitizeSVG()
   *   ran on it at asset-upload time, same as any other SVG asset in the library)
   * @param {string} fit
   */
  renderInlineSvg(svgText, fit) {
    this.element.innerHTML = svgText;
    const svgEl = this.element.querySelector('svg');
    if (svgEl) {
      svgEl.style.width = '100%';
      svgEl.style.height = '100%';
      svgEl.style.display = 'block';
      svgEl.setAttribute('preserveAspectRatio', fit === 'cover' ? 'xMidYMid slice' : 'xMidYMid meet');
      if (this.def.layer?.pointerEvents === 'none') {
        svgEl.style.pointerEvents = 'none';
      }
    }
    this.imgNode = null;
    this.inlineSvgEl = svgEl;
  }

  update(val, allState) {
    super.update(val, allState);
    const props = this.def.props || {};
    // Check if style states swap image or if binding determines asset
    if (this.activeStateName) {
      const stateStyle = this.def.style?.states?.[this.activeStateName];
      const swapAssetId = stateStyle?.background?.image?.assetId;
      if (swapAssetId) {
        if (this.inlineSvgEl && props.renderMode === 'inline') {
          const svgText = this.widget.resolveAssetSvgText?.(swapAssetId);
          if (svgText) this.renderInlineSvg(svgText, props.fit || 'contain');
        } else if (this.imgNode) {
          const url = this.widget.resolveAssetUrl(swapAssetId);
          if (url) this.imgNode.src = url;
        }
      }
    }
  }
}
