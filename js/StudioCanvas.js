/**
 * StudioCanvas.js
 * Interactive Grid Canvas & WYSIWYG Editor for Flight Deck Widget Studio
 */

import { StudioValidator } from './StudioValidator.js';
import { resolveThemedColor, resolveThemedColors, resolveThemedBackground } from '../widgets/components/ThemeColor.js';

const HEX_COLOR_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
// Matches studio.css's .fd-widget-preview-scope block — the canvas's own
// default backdrop when a widget declares no root background of its own.
const WELL_BG_BY_THEME = { dark: '#0b0d13', light: '#edf2f7' };

/**
 * Perceived lightness (0=black, 100=white) of a hex color, via the standard
 * relative-luminance weighting — not a straight RGB average, since green
 * reads much brighter to the eye than blue at the same numeric value.
 * @param {string} hex
 * @returns {number}
 */
function hexPerceivedLightness(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return ((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255) * 100;
}

export class StudioCanvas {
  /**
   * @param {HTMLElement} container
   * @param {import('./StudioState.js').StudioState} state
   */
  constructor(container, state) {
    this.container = container;
    this.state = state;

    this.wrapperElement = null;
    this.viewportElement = null;
    this.gridElement = null;
    this.rulerTopElement = null;
    this.rulerLeftElement = null;
    this.activeDrag = null;
    this.activeResize = null;

    this.MIN_ZOOM = 0.1;
    this.MAX_ZOOM = 3.0;
    this.ZOOM_STEP = 0.1;
    this.BASE_CELL_WIDTH = 48;
    this.BASE_CELL_HEIGHT = 44;

    this.initDOM();
    this.attachEventListeners();
    this.render();
    this.fitZoomToContent();

    this.state.subscribe((changeType, payload) => {
      if (['WIDGET_DEF_LOADED', 'WIDGET_LAYOUT_UPDATED', 'WIDGET_STYLE_UPDATED', 'COMPONENT_ADDED', 'COMPONENT_DELETED', 'COMPONENT_UPDATED', 'LAYER_GROUPS_UPDATED', 'SELECTION_CHANGED', 'ZOOM_CHANGED', 'VIEWPORT_MODE_CHANGED', 'HISTORY_CHANGE', 'SIM_TELEMETRY_UPDATED', 'PREVIEW_THEME_CHANGED', 'EDITOR_VISIBILITY_CHANGED'].includes(changeType)) {
        this.render();
      }
      // A freshly-loaded widget (or one whose grid dimensions just changed,
      // or switching into Edit view at all) gets an auto-fit pass instead of
      // inheriting whatever zoom was already set — otherwise a widget larger
      // than the last one silently opens clipped at 100%, which is exactly
      // what "Fit" is supposed to prevent.
      if (['WIDGET_DEF_LOADED', 'WIDGET_LAYOUT_UPDATED', 'VIEWPORT_MODE_CHANGED'].includes(changeType) && this.state.viewportMode === 'edit') {
        this.fitZoomToContent();
      }
    });
  }

  initDOM() {
    this.container.innerHTML = '';
    this.container.className = 'studio-canvas-root';

    // Toolbar Header above Canvas
    const canvasHeader = document.createElement('div');
    canvasHeader.className = 'canvas-header-bar';
    canvasHeader.innerHTML = `
      <div class="canvas-header-left">
        <div class="canvas-meta-tag">
          <span class="meta-tag-label">GRID:</span>
          <span id="canvas-grid-spec" class="meta-tag-val">12 × 6</span>
        </div>

        <div class="canvas-meta-tag">
          <span class="meta-tag-label">DEFAULT SIZE:</span>
          <span id="canvas-size-spec" class="meta-tag-val">10 × 4</span>
        </div>
      </div>

      <div class="canvas-header-right">
        <button id="btn-toggle-grid" class="canvas-tool-btn active" title="Toggle Grid Lines">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>
        </button>

        <button id="btn-toggle-outlines" class="canvas-tool-btn active" title="Toggle Component Outlines">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path><path d="M22 6l-10 7L2 6"></path></svg>
        </button>

        <button id="btn-toggle-preview-theme" class="canvas-tool-btn" title="Preview: Dark (click to preview Light)">
          <svg id="preview-theme-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
        </button>

        <div class="canvas-header-divider"></div>

        <div class="zoom-controls">
          <button id="btn-zoom-out" class="zoom-btn" title="Zoom Out">−</button>
          <span id="zoom-level-text" class="zoom-text">100%</span>
          <button id="btn-zoom-in" class="zoom-btn" title="Zoom In">+</button>
          <button id="btn-zoom-reset" class="zoom-btn reset" title="Reset Zoom">Fit</button>
        </div>
      </div>
    `;
    this.container.appendChild(canvasHeader);

    // Canvas Stage Workspace
    this.wrapperElement = document.createElement('div');
    this.wrapperElement.className = 'canvas-stage-wrapper';

    // Rulers
    this.rulerTopElement = document.createElement('div');
    this.rulerTopElement.className = 'canvas-ruler-top';
    this.rulerLeftElement = document.createElement('div');
    this.rulerLeftElement.className = 'canvas-ruler-left';

    this.viewportElement = document.createElement('div');
    this.viewportElement.className = 'canvas-viewport-content';

    this.gridElement = document.createElement('div');
    this.gridElement.className = 'canvas-widget-grid fd-widget-preview-scope';

    this.viewportElement.appendChild(this.gridElement);
    this.wrapperElement.appendChild(this.rulerTopElement);
    this.wrapperElement.appendChild(this.rulerLeftElement);
    this.wrapperElement.appendChild(this.viewportElement);
    this.container.appendChild(this.wrapperElement);

    // Floating Coordinate Tooltip
    this.coordBadge = document.createElement('div');
    this.coordBadge.className = 'canvas-coord-badge hidden';
    this.container.appendChild(this.coordBadge);

    // Floating Align/Distribute Toolbar — shown once 2+ components are
    // multi-selected (shift-click). Operates on grid col/row/w/h, so it
    // stays exact with no pixel math.
    this.alignToolbar = document.createElement('div');
    this.alignToolbar.className = 'canvas-align-toolbar hidden';
    this.alignToolbar.innerHTML = `
      <span class="align-toolbar-label" id="align-count-label">2 selected</span>
      <button class="align-btn" data-mode="left" title="Align Left">⯇|</button>
      <button class="align-btn" data-mode="centerX" title="Align Center (Horizontal)">|⯇⯈|</button>
      <button class="align-btn" data-mode="right" title="Align Right">|⯈</button>
      <button class="align-btn" data-mode="top" title="Align Top">⯅‾</button>
      <button class="align-btn" data-mode="centerY" title="Align Middle (Vertical)">‾⯅⯆_</button>
      <button class="align-btn" data-mode="bottom" title="Align Bottom">_⯆</button>
      <span class="canvas-header-divider"></span>
      <button class="align-btn" data-mode="distributeH" title="Distribute Horizontally">⟷</button>
      <button class="align-btn" data-mode="distributeV" title="Distribute Vertically">↕</button>
      <span class="canvas-header-divider"></span>
      <button class="align-btn" data-mode="stackPivot" title="Stack &amp; Match Pivot — FDWS v1.20: for co-centered rotating instrument layers (e.g. an HSI's compass card + heading bug + course needle), copies the first-selected component's box onto the rest and, for core.gauge layers, its Pivot too">⊙</button>
    `;
    this.container.appendChild(this.alignToolbar);
    this.alignToolbar.querySelectorAll('.align-btn').forEach((btn) => {
      btn.addEventListener('click', () => this.state.applyAlignment(btn.dataset.mode));
    });
  }

  attachEventListeners() {
    // Grid / Outline toggles. Both classes are real CSS rules (see studio.css) —
    // the fix here is JS-side: applyWidgetStyles() used to stomp an unconditional
    // inline `backgroundImage: 'none'` on every render, which always wins over
    // the stylesheet's grid-dot rule regardless of which class was present.
    const btnGrid = this.container.querySelector('#btn-toggle-grid');
    btnGrid?.addEventListener('click', () => {
      this.state.showGrid = !this.state.showGrid;
      btnGrid.classList.toggle('active', this.state.showGrid);
      this.gridElement.classList.toggle('no-grid-lines', !this.state.showGrid);
    });

    const btnOutlines = this.container.querySelector('#btn-toggle-outlines');
    btnOutlines?.addEventListener('click', () => {
      this.state.showOutlines = !this.state.showOutlines;
      btnOutlines.classList.toggle('active', this.state.showOutlines);
      this.gridElement.classList.toggle('no-outlines', !this.state.showOutlines);
    });

    // Live theme-preview toggle — routed through StudioState (unlike the two
    // toggles above) so Device View picks up the same flip; see render()'s
    // updatePreviewThemeButton() for keeping this button's own icon in sync.
    const btnPreviewTheme = this.container.querySelector('#btn-toggle-preview-theme');
    btnPreviewTheme?.addEventListener('click', () => {
      this.state.setPreviewTheme(this.state.previewTheme === 'dark' ? 'light' : 'dark');
    });

    // Zoom buttons — 10% steps (was 25%) over a wider [10%, 300%] range so a
    // large sub-grid widget has enough headroom to zoom out far enough to see
    // the whole thing, and fine adjustment near 100% is actually possible.
    this.container.querySelector('#btn-zoom-in')?.addEventListener('click', () => {
      const nextZoom = Math.min(this.MAX_ZOOM, Math.round((this.state.zoom + this.ZOOM_STEP) * 100) / 100);
      this.state.setZoom(nextZoom);
    });
    this.container.querySelector('#btn-zoom-out')?.addEventListener('click', () => {
      const nextZoom = Math.max(this.MIN_ZOOM, Math.round((this.state.zoom - this.ZOOM_STEP) * 100) / 100);
      this.state.setZoom(nextZoom);
    });
    this.container.querySelector('#btn-zoom-reset')?.addEventListener('click', () => {
      this.fitZoomToContent();
    });

    // Blank canvas click -> deselect component
    this.viewportElement.addEventListener('pointerdown', (e) => {
      if (e.target === this.viewportElement || e.target === this.gridElement) {
        this.state.clearSelection();
      }
    });

    // Keyboard shortcuts for arrow keys nudge and delete
    window.addEventListener('keydown', (e) => {
      if (this.state.viewportMode !== 'edit') return;
      if (!this.state.selectedComponentId) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;

      const comp = this.state.getComponent(this.state.selectedComponentId);
      if (!comp) return;

      const maxCols = this.state.widgetDef.layout?.grid?.columns || 12;
      const maxRows = this.state.widgetDef.layout?.grid?.rows || 6;

      let changed = false;
      const newLayout = { ...comp.layout };

      if (e.key === 'ArrowLeft' && newLayout.col > 1) {
        newLayout.col -= 1;
        changed = true;
      } else if (e.key === 'ArrowRight' && newLayout.col + newLayout.w - 1 < maxCols) {
        newLayout.col += 1;
        changed = true;
      } else if (e.key === 'ArrowUp' && newLayout.row > 1) {
        newLayout.row -= 1;
        changed = true;
      } else if (e.key === 'ArrowDown' && newLayout.row + newLayout.h - 1 < maxRows) {
        newLayout.row += 1;
        changed = true;
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // Widget Studio 2.0, Phase 3: deletes the whole multi-selection when
        // one exists, not just the primary/last-touched member — matches
        // the align/distribute toolbar's own "the whole selection is one
        // group" behavior, which Delete previously didn't.
        this.state.deleteMultiSelection();
        e.preventDefault();
        return;
      }

      if (changed) {
        e.preventDefault();
        this.state.updateComponent(comp.id, { layout: newLayout }, true, 'Nudge Component');
      }
    });
  }

  render() {
    if (this.state.viewportMode !== 'edit') {
      return;
    }

    const def = this.state.widgetDef;
    const gridCols = def.layout?.grid?.columns || 12;
    const gridRows = def.layout?.grid?.rows || 6;

    // Update Header badges
    const gridSpecEl = this.container.querySelector('#canvas-grid-spec');
    if (gridSpecEl) gridSpecEl.textContent = `${gridCols} × ${gridRows}`;
    const sizeSpecEl = this.container.querySelector('#canvas-size-spec');
    if (sizeSpecEl) sizeSpecEl.textContent = `${def.layout?.defaultW || 8} × ${def.layout?.defaultH || 4}`;

    this.updatePreviewThemeButton();

    // Zoom level text
    const zoomTextEl = this.container.querySelector('#zoom-level-text');
    if (zoomTextEl) zoomTextEl.textContent = `${Math.round(this.state.zoom * 100)}%`;

    // Configure Grid Template
    this.gridElement.style.gridTemplateColumns = `repeat(${gridCols}, 1fr)`;
    this.gridElement.style.gridTemplateRows = `repeat(${gridRows}, 1fr)`;

    // Calculate realistic aspect ratio box
    const canvasWidth = gridCols * this.BASE_CELL_WIDTH;
    const canvasHeight = gridRows * this.BASE_CELL_HEIGHT;

    this.gridElement.style.width = `${canvasWidth}px`;
    this.gridElement.style.height = `${canvasHeight}px`;

    // Scale from the top-left, not the center — see positionCanvasContent()
    // for why (transform doesn't resize the layout box, so a centered scale
    // makes overflow beyond 100% unreachable by scrolling).
    this.gridElement.style.transformOrigin = 'top left';
    this.gridElement.style.transform = `scale(${this.state.zoom})`;
    this.positionCanvasContent(canvasWidth, canvasHeight);

    // Apply Widget Style / Background
    this.applyWidgetStyles(this.gridElement, def);

    // Build Rulers
    this.buildRulers(gridCols, gridRows, canvasWidth, canvasHeight);

    // Clear previous rendered children
    this.gridElement.innerHTML = '';

    this.renderDesignComponents(def);

    // Align/distribute toolbar visibility
    const selCount = this.state.multiSelectedIds.size;
    if (this.alignToolbar) {
      this.alignToolbar.classList.toggle('hidden', selCount < 2);
      const label = this.alignToolbar.querySelector('#align-count-label');
      if (label) label.textContent = `${selCount} selected`;
    }
  }

  /**
   * Keeps the canvas header's sun/moon button in sync with StudioState.previewTheme,
   * whichever surface changed it (this canvas, or Device View's own subscription).
   */
  updatePreviewThemeButton() {
    const btn = this.container.querySelector('#btn-toggle-preview-theme');
    const icon = this.container.querySelector('#preview-theme-icon');
    if (!btn || !icon) return;
    const isLight = this.state.previewTheme === 'light';
    // Lets a widget-authored var(--text-white, ...)-style color (and the
    // canvas's own var(--well-bg, ...) fallback background) resolve against
    // studio.css's .fd-widget-preview-scope light block instead of silently
    // keeping whichever value it already had.
    this.gridElement.setAttribute('data-theme', this.state.previewTheme);
    btn.classList.toggle('active', isLight);
    btn.title = isLight ? 'Preview: Light (click to preview Dark)' : 'Preview: Dark (click to preview Light)';
    icon.innerHTML = isLight
      ? '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path>'
      : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
  }

  /**
   * .canvas-viewport-content used to be `display:flex; align-items:center;
   * justify-content:center` around gridElement's `transform:scale`. transform
   * never changes an element's own layout box, so at zoom>100% the visual
   * overflow was split evenly on every side of a flex-centered child — and a
   * plain `overflow:auto` ancestor can only scroll toward positive offsets
   * from the top-left, never to a centered child's "negative" overflow. The
   * scaled content was genuinely unreachable by scrolling past a certain
   * size, which is what made "Fit" and large/high-zoom widgets clip.
   *
   * Fix: gridElement now scales from its own top-left (render()'s
   * `transformOrigin`), and this computes symmetric padding on the plain
   * (non-flex) viewportElement instead — centered when the scaled content
   * fits inside the wrapper, collapsing toward a minimum (never negative)
   * once it doesn't, so every pixel of an oversized widget stays reachable
   * via ordinary top-left-anchored scrolling.
   * @param {number} canvasWidth - unscaled grid pixel width
   * @param {number} canvasHeight - unscaled grid pixel height
   */
  positionCanvasContent(canvasWidth, canvasHeight) {
    const scaledW = canvasWidth * this.state.zoom;
    const scaledH = canvasHeight * this.state.zoom;
    const minPad = 40;
    const padX = Math.max(minPad, (this.wrapperElement.clientWidth - scaledW) / 2);
    const padY = Math.max(minPad, (this.wrapperElement.clientHeight - scaledH) / 2);
    this.viewportElement.style.padding = `${padY}px ${padX}px`;
  }

  /**
   * Computes a zoom that fits the widget's whole grid into the current
   * viewport with no scrolling needed, then applies it. Used by the "Fit"
   * button and automatically on WIDGET_DEF_LOADED/WIDGET_LAYOUT_UPDATED (see
   * the constructor's subscribe handler) so opening a widget larger than
   * whatever was last edited doesn't silently start clipped at 100%. No
   * upper cap at 1.0 (unlike the old reset-to-100% "Fit") — a small widget
   * fits better zoomed IN, not left at an arbitrary 100%.
   */
  fitZoomToContent() {
    const def = this.state.widgetDef;
    const gridCols = def.layout?.grid?.columns || 12;
    const gridRows = def.layout?.grid?.rows || 6;
    const canvasWidth = gridCols * this.BASE_CELL_WIDTH;
    const canvasHeight = gridRows * this.BASE_CELL_HEIGHT;
    const availW = this.wrapperElement.clientWidth - 80;
    const availH = this.wrapperElement.clientHeight - 80;
    if (availW <= 0 || availH <= 0 || !canvasWidth || !canvasHeight) return;
    const fitScale = Math.min(availW / canvasWidth, availH / canvasHeight);
    const clamped = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, Math.round(fitScale * 100) / 100));
    this.state.setZoom(clamped);
  }

  applyWidgetStyles(element, def) {
    const style = def.style || {};
    const theme = this.state.previewTheme;
    const baseTheme = def.baseTheme === 'light' ? 'light' : 'dark';
    const themeMode = def.themeMode === 'manual' ? 'manual' : 'auto';
    const themeOverride = style.themeOverride || {};
    const colorCtx = { componentType: 'widget-root', layerGroup: 'background' };
    element.style.backgroundColor = 'var(--well-bg, #0b0f17)';
    element.style.border = '1px solid var(--btn-border, #1f2937)';
    element.style.borderRadius = '10px';
    // '' (not 'none'): an inline style ALWAYS wins over a stylesheet rule for
    // the same property, so a literal 'none' here permanently defeated
    // .canvas-widget-grid:not(.no-grid-lines)'s background-image rule — the
    // grid-dot toggle changed its class every click but had nothing left to
    // reveal. Clearing to '' lets the stylesheet rule (or the image branch
    // below, when the widget itself has one) take over instead.
    element.style.backgroundImage = '';

    if (style.border) {
      if (style.border.width !== undefined) element.style.borderWidth = `${style.border.width}px`;
      if (style.border.color) {
        element.style.borderColor = resolveThemedColor(
          style.border.color, themeOverride.border?.color, { ...colorCtx, colorKind: 'border' }, theme, baseTheme, themeMode
        );
      }
      if (style.border.radius !== undefined) element.style.borderRadius = `${style.border.radius}px`;
    }

    // Effective background hex for the component-outline color below — a
    // literal color wins; a gradient/image/unset background falls back to
    // the canvas's own default backdrop for the current theme, since that's
    // what's actually behind the widget in those cases.
    let effectiveBgHex = WELL_BG_BY_THEME[theme] || WELL_BG_BY_THEME.dark;

    const resolvedBg = resolveThemedBackground(style.background, themeOverride.background, colorCtx, theme, baseTheme, themeMode);
    if (resolvedBg) {
      const bg = resolvedBg;
      if (bg.type === 'color' && bg.color) {
        element.style.backgroundColor = bg.color;
        if (HEX_COLOR_RE.test(bg.color)) effectiveBgHex = bg.color;
      } else if (bg.type === 'gradient' && bg.gradient) {
        element.style.background = bg.gradient;
      } else if (bg.type === 'image' && bg.image) {
        const asset = (def.assets || []).find((a) => a.id === bg.image.assetId);
        if (asset?.data) {
          element.style.backgroundImage = `url("data:${asset.mimeType || 'image/png'};base64,${asset.data}")`;
          element.style.backgroundSize = bg.image.fit || 'cover';
          element.style.backgroundPosition = bg.image.position || 'center';
        }
      }
    }

    // Component-outline color (".no-outlines" toggle, see studio.css) adapts
    // to the widget's own background instead of a flat gray — the flat gray
    // read as "very thin and hard to see," per report, because a light-grey
    // outline all but disappears against a dark-authored widget (the common
    // case) and is still weak against a light one. Perceived-lightness
    // threshold, not a straight RGB average, since green reads much brighter
    // to the eye than blue at the same numeric value.
    const isLightBg = hexPerceivedLightness(effectiveBgHex) > 55;
    element.style.setProperty('--outline-color', isLightBg ? 'rgba(15, 23, 42, 0.55)' : 'rgba(255, 255, 255, 0.55)');
  }

  buildRulers(cols, rows, width, height) {
    if (!this.rulerTopElement || !this.rulerLeftElement) return;

    this.rulerTopElement.innerHTML = '';
    this.rulerTopElement.style.width = `${width * this.state.zoom}px`;
    for (let c = 1; c <= cols; c++) {
      const tick = document.createElement('div');
      tick.className = 'ruler-tick';
      tick.textContent = `${c}`;
      this.rulerTopElement.appendChild(tick);
    }

    this.rulerLeftElement.innerHTML = '';
    this.rulerLeftElement.style.height = `${height * this.state.zoom}px`;
    for (let r = 1; r <= rows; r++) {
      const tick = document.createElement('div');
      tick.className = 'ruler-tick-left';
      tick.textContent = `${r}`;
      this.rulerLeftElement.appendChild(tick);
    }
  }

  renderDesignComponents(def) {
    const layerGroupsMap = new Map();
    (def.layerGroups || []).forEach((lg) => layerGroupsMap.set(lg.id, lg.z || 0));

    // Live §11 validation, badging individual invalid/warned components right
    // on the canvas instead of only surfacing issues in the on-demand report
    // modal with no link back to which component is actually wrong.
    const issuesByComponent = StudioValidator.mapIssuesByComponent(StudioValidator.validate(def));

    // Sort components by effectiveZ ascending for realistic visual stacking
    const components = (def.components || []).map((comp, idx) => {
      const groupZ = comp.layer?.group ? (layerGroupsMap.get(comp.layer.group) ?? 0) : 0;
      const compZ = comp.layer?.z ?? 0;
      const effectiveZ = groupZ + compZ;
      return { comp, effectiveZ, idx };
    });

    components.sort((a, b) => (a.effectiveZ !== b.effectiveZ ? a.effectiveZ - b.effectiveZ : a.idx - b.idx));

    components.forEach(({ comp, effectiveZ }) => {
      // Editor-only visibility (Layers panel eye toggles) — Design canvas
      // only. Device View and export always render every component/group
      // regardless of this, since it's never written into widgetDef itself.
      const groupHidden = comp.layer?.group && this.state.hiddenLayerGroupIds.has(comp.layer.group);
      if (this.state.hiddenInEditorIds.has(comp.id) || groupHidden) return;

      const node = document.createElement('div');
      node.className = `studio-component-node comp-${comp.type.replace('.', '-')}`;
      node.dataset.compId = comp.id;

      const isSelected = this.state.multiSelectedIds.has(comp.id) || this.state.selectedComponentId === comp.id;
      if (isSelected) {
        node.classList.add('selected');
      }

      // Grid position
      const { col = 1, row = 1, w = 1, h = 1 } = comp.layout || {};
      node.style.gridColumnStart = `${col}`;
      node.style.gridColumnEnd = `span ${w}`;
      node.style.gridRowStart = `${row}`;
      node.style.gridRowEnd = `span ${h}`;
      node.style.zIndex = `${effectiveZ}`;

      // Render actual component visual inside
      const visualWrapper = document.createElement('div');
      visualWrapper.className = 'comp-visual-render';
      this.renderComponentVisual(comp, visualWrapper, def);
      node.appendChild(visualWrapper);

      // Component Info Tag badge in design mode
      const infoTag = document.createElement('div');
      infoTag.className = 'comp-info-tag';
      infoTag.textContent = `${comp.label || comp.id} (${comp.type.replace('core.', '')})`;
      node.appendChild(infoTag);

      // Live §11 validation badge
      const issues = issuesByComponent.get(comp.id);
      if (issues) {
        const severity = issues.errors.length > 0 ? 'error' : 'warning';
        node.classList.add(`has-validation-${severity}`);
        const badge = document.createElement('div');
        badge.className = `comp-validation-badge ${severity}`;
        badge.textContent = severity === 'error' ? '!' : '?';
        badge.title = [...issues.errors, ...issues.warnings].join('\n');
        node.appendChild(badge);
      }

      // Selection Frame & 8-point Resize Handles
      if (isSelected) {
        this.attachResizeHandles(node, comp);
      }

      // Click to select — shift-click adds/removes this component from the
      // multi-selection (for the align/distribute toolbar) instead of
      // replacing the whole selection; a shift-click never starts a drag,
      // since dragging one member of a multi-selection alone would be
      // surprising.
      //
      // Widget Studio 2.0, Phase 3: a plain (non-shift) click on a component
      // that's ALREADY part of the current multi-selection must NOT collapse
      // that selection down to just this one component before the drag
      // below starts — that would make startDraggingComponent's own
      // multi-select-aware group-move logic unreachable in practice (it
      // checks multiSelectedIds.size > 1, which selectComponent(id, false)
      // had already reset to 1 by the time it ran). Standard editor
      // convention: clicking a member of an existing selection preserves
      // the group so you can drag it as one; clicking something OUTSIDE the
      // current selection still collapses to just that component, same as
      // before.
      node.addEventListener('pointerdown', (e) => {
        if (e.target.classList.contains('resize-handle')) return;
        e.stopPropagation();
        const alreadyInGroup = this.state.multiSelectedIds.size > 1 && this.state.multiSelectedIds.has(comp.id);
        if (!alreadyInGroup) {
          this.state.selectComponent(comp.id, e.shiftKey);
        }
        if (!e.shiftKey) this.startDraggingComponent(e, comp, node);
      });

      // Hover feedback
      node.addEventListener('pointerenter', () => {
        node.classList.add('hovered');
      });
      node.addEventListener('pointerleave', () => {
        node.classList.remove('hovered');
      });

      this.gridElement.appendChild(node);
    });
  }

  renderComponentVisual(comp, container, def) {
    const type = comp.type;
    const style = comp.style || {};
    const props = comp.props || {};
    const theme = this.state.previewTheme;
    const baseTheme = def.baseTheme === 'light' ? 'light' : 'dark';
    const themeMode = def.themeMode === 'manual' ? 'manual' : 'auto';
    const themeOverride = style.themeOverride || {};
    const colorCtx = { componentType: type, layerGroup: comp.layer?.group };
    // Only the AUTHORED color (when set) goes through the theme-preview
    // transform — the hardcoded fallbacks below are this mock renderer's own
    // placeholder defaults for an unstyled component, not FDWS data, so they
    // stay literal regardless of preview theme. resolveThemedColors()
    // (not independent resolveThemedColor() calls) preserves an author
    // intentionally matching two of these three raw values — e.g. hiding
    // placeholder text by setting typography.color equal to background.color
    // — and, FDWS v1.18, honors style.themeOverride's manual per-field values.
    const { typographyColor: textColor, borderColor } = resolveThemedColors(
      { typographyColor: style.typography?.color, borderColor: style.border?.color, backgroundColor: style.background?.color },
      { typographyColor: themeOverride.typography?.color, borderColor: themeOverride.border?.color },
      colorCtx,
      theme,
      baseTheme,
      themeMode
    );
    const resolvedBg = resolveThemedBackground(style.background, themeOverride.background, colorCtx, theme, baseTheme, themeMode);
    const bgColor = resolvedBg?.type === 'color' ? resolvedBg.color : undefined;

    container.style.position = 'relative';
    container.style.width = '100%';
    container.style.height = '100%';
    container.style.display = 'flex';
    container.style.alignItems = 'center';
    container.style.justifyContent = 'center';
    container.style.borderRadius = `${style.border?.radius ?? 4}px`;
    container.style.border = `${style.border?.width ?? 1}px solid ${borderColor || '#273344'}`;
    container.style.backgroundColor = bgColor || '#131b26';

    if (resolvedBg?.type === 'gradient' && resolvedBg.gradient) {
      container.style.background = resolvedBg.gradient;
    } else if (style.background?.type === 'image' && style.background.image?.assetId) {
      const asset = (def.assets || []).find((a) => a.id === style.background.image.assetId);
      if (asset?.data) {
        container.style.backgroundImage = `url("data:${asset.mimeType || 'image/png'};base64,${asset.data}")`;
        container.style.backgroundSize = style.background.image.fit || 'cover';
      }
    }

    // Type-specific mock visuals
    switch (type) {
      case 'core.label': {
        container.style.background = 'transparent';
        container.style.border = 'none';
        container.style.justifyContent = props.align === 'center' ? 'center' : (props.align === 'right' ? 'flex-end' : 'flex-start');
        const span = document.createElement('span');
        // props.text !== undefined check, not `||` — an intentionally-empty
        // "" is a valid authored value and must render empty, not fall back
        // to comp.label (the Studio-only authoring display name). Same bug
        // found and fixed in the real runtime's LabelComponent.js.
        span.textContent = props.text !== undefined ? props.text : (comp.label || 'LABEL');
        span.style.fontFamily = style.typography?.font || 'Chakra Petch';
        span.style.fontSize = `${style.typography?.size || 12}px`;
        span.style.fontWeight = `${style.typography?.weight || 700}`;
        span.style.color = textColor || 'var(--text-white, #f8fafc)';
        container.appendChild(span);
        break;
      }

      case 'core.display': {
        container.style.justifyContent = 'space-between';
        container.style.padding = '0 8px';
        const prefix = document.createElement('span');
        prefix.textContent = props.prefix || '';
        prefix.style.fontSize = '10px';
        prefix.style.color = 'var(--text-label, #64748b)';
        prefix.style.fontWeight = '700';

        const val = document.createElement('span');
        val.textContent = comp.binding?.readSimVar ? (this.state.simTelemetry[comp.binding.readSimVar] || '---') : '122.800';
        val.style.fontFamily = style.typography?.font || 'Chakra Petch, monospace';
        val.style.fontSize = `${style.typography?.size || 14}px`;
        val.style.fontWeight = `${style.typography?.weight || 700}`;
        val.style.color = textColor || '#22c55e';

        container.appendChild(prefix);
        container.appendChild(val);
        break;
      }

      case 'core.button': {
        container.style.flexDirection = 'column';
        container.style.gap = '2px';
        // var(--btn-bg, ...), not a bare literal: matches widgets.css's real
        // default for an unstyled button (.fd-comp-btn-inner) exactly, which
        // IS theme-aware — an unstyled button correctly went light in Device
        // View/the real PWA already, but this mock's own literal fallback
        // never did, so Design mode showed it staying dark (reported against
        // a 'momentary'-variant preset button, which has no variant-specific
        // override and so falls all the way through to this base default).
        container.style.backgroundColor = bgColor || 'var(--btn-bg, #1e293b)';

        if (props.variant === 'swap') {
          container.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m16 3 4 4-4 4"></path><path d="M20 7H4"></path><path d="m8 21-4-4 4-4"></path><path d="M4 17h16"></path></svg>`;
        } else {
          const lbl = document.createElement('span');
          // props.label !== undefined, not `||` — same empty-string-is-valid
          // fix as core.label above (real runtime's ButtonComponent.js
          // already gets this right).
          lbl.textContent = props.label !== undefined ? props.label : (comp.label || 'BUTTON');
          lbl.style.fontFamily = style.typography?.font || 'Chakra Petch';
          lbl.style.fontSize = `${style.typography?.size || 12}px`;
          lbl.style.fontWeight = `${style.typography?.weight || 700}`;
          lbl.style.color = textColor || 'var(--text-white, #f8fafc)';
          container.appendChild(lbl);

          if (props.sublabel) {
            const sub = document.createElement('span');
            sub.textContent = props.sublabel;
            sub.style.fontSize = '9px';
            sub.style.color = 'var(--text-label, #94a3b8)';
            container.appendChild(sub);
          }
        }
        break;
      }

      case 'core.input': {
        container.style.justifyContent = 'center';
        container.style.backgroundColor = bgColor || '#0f172a';
        const txt = document.createElement('span');
        txt.textContent = props.placeholder || '118.000';
        txt.style.fontFamily = style.typography?.font || 'Chakra Petch, monospace';
        txt.style.fontSize = `${style.typography?.size || 14}px`;
        txt.style.fontWeight = `${style.typography?.weight || 700}`;
        txt.style.color = textColor || '#38bdf8';
        container.appendChild(txt);
        break;
      }

      case 'core.indicator': {
        const shape = props.shape || 'tile';
        const severity = props.severity || 'status';
        let sevColor = '#3b82f6';
        if (severity === 'warning') sevColor = '#ef4444';
        else if (severity === 'caution') sevColor = '#f59e0b';
        else if (severity === 'advisory') sevColor = '#00d8f6';

        if (shape === 'dot') {
          container.style.background = 'transparent';
          container.style.border = 'none';
          const dot = document.createElement('div');
          dot.style.width = '10px';
          dot.style.height = '10px';
          dot.style.borderRadius = '50%';
          dot.style.backgroundColor = sevColor;
          dot.style.boxShadow = `0 0 8px ${sevColor}`;
          container.appendChild(dot);
        } else {
          container.style.backgroundColor = `${sevColor}22`;
          container.style.borderColor = sevColor;
          const lbl = document.createElement('span');
          // props.label !== undefined, not `||` — same empty-string-is-valid
          // fix as core.label above (real runtime's IndicatorComponent.js
          // already gets this right).
          lbl.textContent = props.label !== undefined ? props.label : (comp.label || 'ANNUN');
          lbl.style.fontFamily = style.typography?.font || 'inherit';
          lbl.style.fontSize = `${style.typography?.size || 10}px`;
          lbl.style.fontWeight = `${style.typography?.weight || 700}`;
          lbl.style.color = textColor || sevColor;
          container.appendChild(lbl);
        }
        break;
      }

      case 'core.stepper': {
        container.innerHTML = `
          <button style="flex:1;height:100%;background:#1e293b;border:none;color:#fff;font-weight:700;cursor:pointer;">−</button>
          <button style="flex:1;height:100%;background:#1e293b;border:none;border-left:1px solid #334155;color:#fff;font-weight:700;cursor:pointer;">+</button>
        `;
        break;
      }

      case 'core.rotary': {
        container.innerHTML = `
          <div style="width:32px;height:32px;border-radius:50%;border:2px solid #00d8f6;background:#1e293b;display:flex;align-items:center;justify-content:center;position:relative;">
            <div style="width:3px;height:10px;background:#00d8f6;position:absolute;top:2px;border-radius:2px;"></div>
          </div>
        `;
        break;
      }

      case 'core.image': {
        const asset = (def.assets || []).find((a) => a.id === props.assetId);
        if (asset?.data) {
          const img = document.createElement('img');
          img.src = `data:${asset.mimeType || 'image/png'};base64,${asset.data}`;
          img.style.width = '100%';
          img.style.height = '100%';
          img.style.objectFit = props.fit || 'contain';
          container.appendChild(img);
        } else {
          container.innerHTML = `<span style="font-size:10px;color:#64748b;">[Image: ${props.assetId || 'none'}]</span>`;
        }
        break;
      }

      case 'core.gauge': {
        container.style.background = 'transparent';
        container.style.border = 'none';
        container.innerHTML = `
          <div style="width:34px;height:34px;border-radius:50%;border:2px dashed #00d8f6;display:flex;align-items:center;justify-content:center;position:relative;">
            <div style="width:2px;height:14px;background:#00d8f6;position:absolute;top:1px;border-radius:2px;box-shadow:0 0 4px #00d8f6;"></div>
          </div>
        `;
        break;
      }

      case 'core.slider': {
        const axis = props.axis === 'x' ? 'row' : 'column';
        container.style.padding = '4px';
        container.innerHTML = `
          <div style="flex:1;width:100%;height:100%;background:#0f172a;border:1px solid #334155;border-radius:4px;position:relative;display:flex;flex-direction:${axis};align-items:center;justify-content:center;">
            <div style="width:${axis === 'row' ? '16px' : '80%'};height:${axis === 'row' ? '80%' : '16px'};background:#1e293b;border:2px solid #00d8f6;border-radius:3px;"></div>
          </div>
        `;
        break;
      }

      case 'core.selector': {
        container.style.background = 'transparent';
        container.style.border = 'none';
        container.innerHTML = `
          <div style="width:36px;height:36px;border-radius:50%;border:2px solid #334155;position:relative;">
            <div style="position:absolute;left:50%;top:50%;width:2px;height:16px;background:#00d8f6;transform:translate(-50%,-100%);"></div>
          </div>
        `;
        break;
      }

      case 'core.rocker': {
        const axis = props.axis === 'x' ? 'row' : 'column';
        container.style.flexDirection = axis;
        container.style.gap = '1px';
        container.style.padding = '0';
        container.innerHTML = `
          <div style="flex:1;background:#1e293b;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:10px;">▲</div>
          <div style="flex:1;background:#1e293b;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:10px;">▼</div>
        `;
        break;
      }

      case 'core.list': {
        container.style.flexDirection = 'column';
        container.style.alignItems = 'stretch';
        container.style.gap = '2px';
        container.style.padding = '4px';
        container.innerHTML = `
          <div style="height:14px;background:#1e293b;border-radius:2px;"></div>
          <div style="height:14px;background:#1e293b;border-radius:2px;"></div>
          <div style="height:14px;background:#1e293b;border-radius:2px;opacity:0.5;"></div>
        `;
        break;
      }

      case 'core.ref': {
        container.style.border = '1px dashed #a855f7';
        container.innerHTML = `<span style="font-size:10px;color:#c084fc;">[ref: ${props.libraryId || 'unset'}]</span>`;
        break;
      }

      case 'core.pad': {
        container.style.background = '#0f172a';
        container.innerHTML = `
          <div style="width:8px;height:8px;border-radius:50%;background:#00d8f6;box-shadow:0 0 6px #00d8f6;"></div>
        `;
        break;
      }

      // FDWS v1.17: a plain separator line — reuses style.border.width/color/
      // style as thickness/color/dash-style (see DividerComponent.js, the
      // real renderer Device View/the PWA use). The generic box treatment
      // above (background/uniform border) is meaningless for a line, so it's
      // cleared here the same way core.label clears it for its own transparent
      // wrapper, and a single-edge border is drawn on an inner node instead.
      case 'core.divider': {
        container.style.background = 'transparent';
        container.style.border = 'none';
        const orientation = props.orientation === 'vertical' ? 'vertical' : 'horizontal';
        const thickness = Math.max(1, style.border?.width ?? 2);
        const lineStyle = style.border?.style || 'solid';
        const line = document.createElement('div');
        if (orientation === 'vertical') {
          line.style.width = '0';
          line.style.height = '100%';
          line.style.borderLeft = `${thickness}px ${lineStyle} ${borderColor || '#333c4a'}`;
        } else {
          line.style.height = '0';
          line.style.width = '100%';
          line.style.borderTop = `${thickness}px ${lineStyle} ${borderColor || '#333c4a'}`;
        }
        container.appendChild(line);
        break;
      }

      case 'core.tape': {
        const isY = props.axis !== 'x';
        container.style.background = 'transparent';
        container.style.overflow = 'hidden';
        container.style.position = 'relative';
        const ticks = Array.from({ length: 7 }, (_, i) => i);
        container.innerHTML = `
          <div style="position:absolute;inset:0;">
            ${ticks.map((i) => `<div style="position:absolute;${isY ? `top:${(i / 6) * 100}%;right:0;width:${i % 2 === 0 ? '16px' : '8px'};height:1.5px;` : `left:${(i / 6) * 100}%;bottom:0;height:${i % 2 === 0 ? '16px' : '8px'};width:1.5px;`}background:${props.tickColor || '#94a3b8'};"></div>`).join('')}
            <div style="position:absolute;${isY ? 'top:50%;left:0;right:0;height:2px;' : 'left:50%;top:0;bottom:0;width:2px;'}background:${props.indexLineColor || 'var(--accent-cyan, #00d8f6)'};"></div>
          </div>
        `;
        break;
      }

      default: {
        container.innerHTML = `<span style="font-size:10px;color:#64748b;">[${comp.type}]</span>`;
        break;
      }
    }

    // FDWS v1.8 §1.1/§1.2 — generic align/offset override, applied after the
    // type-specific mock visual above so it always wins when authored. The mock
    // visuals above append their text span(s) directly as children of `container`
    // (no nested box element, unlike the real renderer's core.display/core.indicator
    // markup), so container is always the right flex target here — this is a
    // simplified single-pass version of BaseComponent's real per-node cascade, good
    // enough for the design-canvas preview since Simulate/Device View (the real
    // component classes) is the source of truth for pixel-exact parity.
    const align = style.align || {};
    if (align.h || align.v) {
      if (align.h) {
        container.style.justifyContent = align.h === 'left' ? 'flex-start' : align.h === 'right' ? 'flex-end' : 'center';
        const inputSpan = type === 'core.input' ? container.querySelector('span') : null;
        if (inputSpan) inputSpan.style.textAlign = align.h;
      }
      if (align.v) {
        container.style.alignItems = align.v === 'top' ? 'flex-start' : align.v === 'bottom' ? 'flex-end' : 'center';
      }
    }
    const offset = style.offset || {};
    if (offset.x || offset.y) {
      const target = container.querySelector('span, input, button') || container;
      target.style.transform = `translate(${offset.x || 0}px, ${offset.y || 0}px)`;
    }
  }

  attachResizeHandles(node, comp) {
    const positions = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
    positions.forEach((pos) => {
      const handle = document.createElement('div');
      handle.className = `resize-handle handle-${pos}`;
      handle.dataset.handle = pos;

      handle.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.startResizingComponent(e, comp, pos);
      });

      node.appendChild(handle);
    });
  }

  startDraggingComponent(e, comp, node) {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;

    // Widget Studio 2.0, Phase 3: if the dragged component is part of a 2+
    // multi-selection, move every member together, preserving their
    // relative positions — previously dragging only ever moved the one
    // component under the pointer, silently leaving the rest of the
    // selection behind despite the align/distribute toolbar implying the
    // whole selection was one coherent group. Falls back to single-component
    // behavior when there's no multi-selection (the overwhelmingly common
    // case), so nothing changes for a normal single drag.
    const groupIds = this.state.multiSelectedIds.size > 1 && this.state.multiSelectedIds.has(comp.id)
      ? [...this.state.multiSelectedIds]
      : [comp.id];
    const groupComps = groupIds.map((id) => this.state.getComponent(id)).filter(Boolean);
    const groupStart = new Map(groupComps.map((c) => [c.id, { col: c.layout.col, row: c.layout.row, w: c.layout.w, h: c.layout.h }]));
    const groupNodes = new Map(groupComps.map((c) => [c.id, this.gridElement.querySelector(`[data-comp-id="${c.id}"]`)]));

    const gridCols = this.state.widgetDef.layout?.grid?.columns || 12;
    const gridRows = this.state.widgetDef.layout?.grid?.rows || 6;

    const gridRect = this.gridElement.getBoundingClientRect();
    const cellWidth = (gridRect.width / gridCols);
    const cellHeight = (gridRect.height / gridRows);

    this.showCoordBadge(comp.layout);

    // FDWS/Studio bug fix, same session: this used to call saveHistory()
    // AFTER the drag's mutations had already been applied (in onPointerUp,
    // by which point comp.layout already held the NEW position) — meaning
    // the undo stack captured the post-drag state as if it were the
    // pre-drag one, so hitting Undo right after a drag silently did
    // nothing and the true original position was unrecoverable. Fixed by
    // saving history exactly once, on the FIRST pointermove that actually
    // changes anything — before that move's mutation is applied — same
    // "one undo step for the whole gesture" shape as applyAlignment().
    let historySaved = false;

    // Clamps a proposed group-wide delta so EVERY member stays on-grid,
    // rather than clamping each member independently — independent clamping
    // would let one member hit a wall while others keep moving, breaking
    // the group's relative positions apart mid-drag.
    const clampGroupDelta = (colDelta, rowDelta) => {
      let minColDelta = -Infinity, maxColDelta = Infinity;
      let minRowDelta = -Infinity, maxRowDelta = Infinity;
      groupComps.forEach((c) => {
        const s = groupStart.get(c.id);
        minColDelta = Math.max(minColDelta, 1 - s.col);
        maxColDelta = Math.min(maxColDelta, gridCols - s.w + 1 - s.col);
        minRowDelta = Math.max(minRowDelta, 1 - s.row);
        maxRowDelta = Math.min(maxRowDelta, gridRows - s.h + 1 - s.row);
      });
      return {
        colDelta: Math.max(minColDelta, Math.min(maxColDelta, colDelta)),
        rowDelta: Math.max(minRowDelta, Math.min(maxRowDelta, rowDelta))
      };
    };

    const onPointerMove = (moveEv) => {
      const dx = moveEv.clientX - startX;
      const dy = moveEv.clientY - startY;

      const rawColDelta = Math.round(dx / cellWidth);
      const rawRowDelta = Math.round(dy / cellHeight);
      const { colDelta, rowDelta } = clampGroupDelta(rawColDelta, rawRowDelta);

      const anchorStart = groupStart.get(comp.id);
      const targetCol = anchorStart.col + colDelta;
      const targetRow = anchorStart.row + rowDelta;

      if (targetCol !== comp.layout.col || targetRow !== comp.layout.row) {
        if (!historySaved) {
          this.state.saveHistory(groupComps.length > 1 ? `Move ${groupComps.length} Components` : 'Move Component');
          historySaved = true;
        }

        groupComps.forEach((c) => {
          const s = groupStart.get(c.id);
          c.layout.col = s.col + colDelta;
          c.layout.row = s.row + rowDelta;
          const n = groupNodes.get(c.id);
          if (n) {
            n.style.gridColumnStart = `${c.layout.col}`;
            n.style.gridRowStart = `${c.layout.row}`;
          }
        });

        this.showCoordBadge(comp.layout);
      }
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      this.hideCoordBadge();

      if (historySaved) {
        StudioValidator.syncCapabilities(this.state.widgetDef);
        this.state.notify('COMPONENT_UPDATED', { componentId: comp.id, component: comp });
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }


  startResizingComponent(e, comp, handlePos) {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const orig = { ...comp.layout };

    const gridCols = this.state.widgetDef.layout?.grid?.columns || 12;
    const gridRows = this.state.widgetDef.layout?.grid?.rows || 6;

    const gridRect = this.gridElement.getBoundingClientRect();
    const cellWidth = gridRect.width / gridCols;
    const cellHeight = gridRect.height / gridRows;

    this.showCoordBadge(comp.layout);

    // Same history-ordering fix as startDraggingComponent above: save
    // history once, on the first pointermove that actually changes
    // anything, BEFORE that change is applied — not after the whole resize
    // gesture in onPointerUp, which used to capture the POST-resize state
    // as if it were the pre-resize one (Undo right after a resize did
    // nothing, and the original size was unrecoverable).
    let historySaved = false;

    const onPointerMove = (moveEv) => {
      const dx = moveEv.clientX - startX;
      const dy = moveEv.clientY - startY;

      const colDelta = Math.round(dx / cellWidth);
      const rowDelta = Math.round(dy / cellHeight);

      let newCol = orig.col;
      let newRow = orig.row;
      let newW = orig.w;
      let newH = orig.h;

      if (handlePos.includes('e')) {
        newW = Math.max(1, Math.min(gridCols - orig.col + 1, orig.w + colDelta));
      }
      if (handlePos.includes('s')) {
        newH = Math.max(1, Math.min(gridRows - orig.row + 1, orig.h + rowDelta));
      }
      if (handlePos.includes('w')) {
        const candidateCol = Math.max(1, Math.min(orig.col + orig.w - 1, orig.col + colDelta));
        newW = orig.col + orig.w - candidateCol;
        newCol = candidateCol;
      }
      if (handlePos.includes('n')) {
        const candidateRow = Math.max(1, Math.min(orig.row + orig.h - 1, orig.row + rowDelta));
        newH = orig.row + orig.h - candidateRow;
        newRow = candidateRow;
      }

      if (newCol !== comp.layout.col || newRow !== comp.layout.row || newW !== comp.layout.w || newH !== comp.layout.h) {
        if (!historySaved) {
          this.state.saveHistory('Resize Component');
          historySaved = true;
        }

        comp.layout.col = newCol;
        comp.layout.row = newRow;
        comp.layout.w = newW;
        comp.layout.h = newH;

        const node = this.gridElement.querySelector(`[data-comp-id="${comp.id}"]`);
        if (node) {
          node.style.gridColumnStart = `${newCol}`;
          node.style.gridColumnEnd = `span ${newW}`;
          node.style.gridRowStart = `${newRow}`;
          node.style.gridRowEnd = `span ${newH}`;
        }

        this.showCoordBadge(comp.layout);
      }
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      this.hideCoordBadge();

      if (historySaved) {
        StudioValidator.syncCapabilities(this.state.widgetDef);
        this.state.notify('COMPONENT_UPDATED', { componentId: comp.id, component: comp });
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  showCoordBadge(layout) {
    if (!this.coordBadge) return;
    this.coordBadge.textContent = `Col ${layout.col}, Row ${layout.row} | ${layout.w} × ${layout.h}`;
    this.coordBadge.classList.remove('hidden');
  }

  hideCoordBadge() {
    if (!this.coordBadge) return;
    this.coordBadge.classList.add('hidden');
  }

}
