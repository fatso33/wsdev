/**
 * StudioDeviceView.js
 * Realistic Device Viewport Simulator for Flight Deck Widget Studio
 * Implements hardware frames & dual-orientation grid array sizes:
 * - Compact: 20 × 44 (Portrait: 20 col × 44 row; Landscape: 44 col × 20 row)
 * - Mobile Standard / Pro: 14 × 30 (Portrait: 14 col × 30 row; Landscape: 30 col × 14 row)
 * - Tablet Standard: 24 × 36 (Portrait: 24 col × 36 row; Landscape: 36 col × 24 row)
 * - Tablet Pro / Desktop: 30 × 44 (Portrait: 30 col × 44 row; Landscape: 44 col × 30 row)
 */

import { DEVICE_PROFILES } from './StudioState.js';
import { ComponentRegistry } from '../widgets/components/ComponentRegistry.js';
import { createMockHost } from '../widgets/components/MockWidgetHost.js';
import { resolveThemedColor } from '../widgets/components/ThemeColor.js';
import { openWidgetPopover } from '../widgets/components/WidgetPopoverModal.js';
import { readStateRef } from '../widgets/utils/StateRefPath.js';

export class StudioDeviceView {
  /**
   * @param {HTMLElement} container
   * @param {import('./StudioState.js').StudioState} state
   */
  constructor(container, state) {
    this.container = container;
    this.state = state;

    this.deviceFrameElement = null;
    this.deviceScreenElement = null;
    this.showDeviceGrid = true;
    this.deviceScale = 1.0;
    this.MIN_ZOOM = 0.1;
    this.MAX_ZOOM = 3.0;
    this.ZOOM_STEP = 0.1;
    // Off by default — the drag handle is a small blue overlay on the
    // widget's corner, which obscures a bit of its content; most of the
    // time an author just wants to look at/interact with the widget, and
    // repositioning via the Col/Row fields (always available regardless of
    // this) is precise enough. Only show/enable the handle when explicitly
    // toggled on.
    this.moveWidgetMode = false;

    this.initDOM();
    this.attachEventListeners();
    this.render();
    this.autoFitDevice();

    this.state.subscribe((changeType) => {
      if ([
        'VIEWPORT_MODE_CHANGED',
        'DEVICE_CHANGED',
        'DEVICE_ORIENTATION_CHANGED',
        'WIDGET_DEF_LOADED',
        'WIDGET_LAYOUT_UPDATED',
        'WIDGET_STYLE_UPDATED',
        'COMPONENT_ADDED',
        'COMPONENT_DELETED',
        'COMPONENT_UPDATED',
        'LAYER_GROUPS_UPDATED',
        'SIM_TELEMETRY_UPDATED',
        'PREVIEW_THEME_CHANGED',
        'DEVICE_PLACEMENT_CHANGED'
      ].includes(changeType)) {
        this.render();
      }
      // A new widget, device profile, or orientation gets an auto-fit pass —
      // see autoFitDevice()'s doc comment; same reasoning as StudioCanvas's
      // identical WIDGET_DEF_LOADED/WIDGET_LAYOUT_UPDATED handling.
      if (['WIDGET_DEF_LOADED', 'DEVICE_CHANGED', 'DEVICE_ORIENTATION_CHANGED', 'VIEWPORT_MODE_CHANGED'].includes(changeType) && this.state.viewportMode === 'device') {
        this.autoFitDevice();
      }
    });
  }

  initDOM() {
    this.container.innerHTML = '';
    this.container.className = 'studio-device-root';

    // Top Controls Bar for Device Viewport
    const headerBar = document.createElement('div');
    headerBar.className = 'device-header-bar';
    headerBar.innerHTML = `
      <div class="device-header-left">
        <div class="device-select-group">
          <label for="device-profile-select">DEVICE:</label>
          <select id="device-profile-select" class="device-select">
            <option value="compact" selected>Mobile (20×44 / 44×20)</option>
            <option value="tablet_desktop">Tablet / Desktop (60×88 / 88×60)</option>
          </select>
        </div>

        <div class="canvas-header-divider"></div>

        <div class="orientation-btn-group">
          <button id="btn-orient-portrait" class="orient-btn active" title="Portrait Orientation">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
            Portrait
          </button>
          <button id="btn-orient-landscape" class="orient-btn" title="Landscape Orientation">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2" ry="2"></rect><line x1="18" y1="12" x2="18.01" y2="12"></line></svg>
            Landscape
          </button>
        </div>

        <div class="canvas-header-divider"></div>

        <div class="device-pos-controls">
          <span class="device-pos-label">POS:</span>
          <label class="device-pos-input-wrap">Col <input type="number" id="dev-pos-col" min="1" max="44" value="1" class="dev-pos-num"></label>
          <label class="device-pos-input-wrap">Row <input type="number" id="dev-pos-row" min="1" max="44" value="1" class="dev-pos-num"></label>
        </div>

        <button id="btn-toggle-move-widget" class="canvas-tool-btn" title="Move Widget: Off (click to enable drag-to-reposition)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="5 9 2 12 5 15"></polyline><polyline points="9 5 12 2 15 5"></polyline><polyline points="15 19 12 22 9 19"></polyline><polyline points="19 9 22 12 19 15"></polyline><line x1="2" y1="12" x2="22" y2="12"></line><line x1="12" y1="2" x2="12" y2="22"></line></svg>
        </button>
      </div>

      <div class="device-header-right">
        <div class="device-info-badge">
          <span id="device-grid-summary" class="info-badge-text">14 × 30 Grid</span>
        </div>

        <button id="btn-toggle-dev-grid" class="canvas-tool-btn active" title="Toggle Device Grid Overlay">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="3" y1="15" x2="21" y2="15"></line><line x1="9" y1="3" x2="9" y2="21"></line><line x1="15" y1="3" x2="15" y2="21"></line></svg>
        </button>

        <button id="btn-toggle-preview-theme-device" class="canvas-tool-btn" title="Preview: Dark (click to preview Light)">
          <svg id="preview-theme-icon-device" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
        </button>

        <div class="canvas-header-divider"></div>

        <div class="zoom-controls">
          <button id="btn-dev-zoom-out" class="zoom-btn" title="Zoom Out">−</button>
          <span id="dev-zoom-text" class="zoom-text">100%</span>
          <button id="btn-dev-zoom-in" class="zoom-btn" title="Zoom In">+</button>
          <button id="btn-dev-zoom-fit" class="zoom-btn reset" title="Fit Device to Viewport">Fit</button>
        </div>
      </div>
    `;
    this.container.appendChild(headerBar);

    // Device Viewport Stage. stageElement is the fixed-size, overflow:auto
    // scroll region; stageContentElement is a separate inner wrapper that
    // gets the computed centering padding — see positionDeviceContent() for
    // why these can't be the same element (measuring a scrollable element's
    // own clientWidth/Height after changing ITS OWN padding is circular).
    this.stageElement = document.createElement('div');
    this.stageElement.className = 'device-viewport-stage';

    this.stageContentElement = document.createElement('div');
    this.stageContentElement.className = 'device-viewport-stage-content';

    this.deviceFrameElement = document.createElement('div');
    this.deviceFrameElement.className = 'device-frame frame-compact';

    this.deviceScreenElement = document.createElement('div');
    this.deviceScreenElement.className = 'device-screen fd-widget-preview-scope';

    this.deviceFrameElement.appendChild(this.deviceScreenElement);
    this.stageContentElement.appendChild(this.deviceFrameElement);
    this.stageElement.appendChild(this.stageContentElement);
    this.container.appendChild(this.stageElement);
  }

  attachEventListeners() {
    const select = this.container.querySelector('#device-profile-select');
    select?.addEventListener('change', (e) => {
      this.state.setDeviceProfile(e.target.value);
    });

    const btnPort = this.container.querySelector('#btn-orient-portrait');
    const btnLand = this.container.querySelector('#btn-orient-landscape');

    btnPort?.addEventListener('click', () => {
      this.state.setDeviceOrientation('portrait');
    });
    btnLand?.addEventListener('click', () => {
      this.state.setDeviceOrientation('landscape');
    });

    // Toggle Grid
    const btnGrid = this.container.querySelector('#btn-toggle-dev-grid');
    btnGrid?.addEventListener('click', () => {
      this.showDeviceGrid = !this.showDeviceGrid;
      btnGrid.classList.toggle('active', this.showDeviceGrid);
      this.render();
    });

    // Live theme-preview toggle — this view has no access to StudioCanvas's
    // own button (that toolbar isn't even mounted while viewportMode is
    // 'device'), so it needs its own control wired to the same shared
    // StudioState.previewTheme; updatePreviewThemeButton() keeps both in sync
    // regardless of which one was clicked.
    const btnPreviewTheme = this.container.querySelector('#btn-toggle-preview-theme-device');
    btnPreviewTheme?.addEventListener('click', () => {
      this.state.setPreviewTheme(this.state.previewTheme === 'dark' ? 'light' : 'dark');
    });

    // Move Widget — gates whether the drag handle exists at all (render()
    // only creates it when this is on) and whether dragging is possible;
    // the Col/Row inputs below always work regardless of this toggle.
    const btnMoveWidget = this.container.querySelector('#btn-toggle-move-widget');
    btnMoveWidget?.addEventListener('click', () => {
      this.moveWidgetMode = !this.moveWidgetMode;
      this.updateMoveWidgetButton();
      this.render();
    });

    // Position Col / Row inputs
    const inputCol = this.container.querySelector('#dev-pos-col');
    const inputRow = this.container.querySelector('#dev-pos-row');

    inputCol?.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10) || 1;
      this.state.setDevicePlacement(val, this.state.devicePlacement.row);
    });

    inputRow?.addEventListener('change', (e) => {
      const val = parseInt(e.target.value, 10) || 1;
      this.state.setDevicePlacement(this.state.devicePlacement.col, val);
    });

    // Zoom Controls — 10% steps over [10%, 300%], matching Edit view's
    // granularity (was 15% steps over [40%, 150%]).
    this.container.querySelector('#btn-dev-zoom-in')?.addEventListener('click', () => {
      this.deviceScale = Math.min(this.MAX_ZOOM, Math.round((this.deviceScale + this.ZOOM_STEP) * 100) / 100);
      this.applyDeviceScale();
    });

    this.container.querySelector('#btn-dev-zoom-out')?.addEventListener('click', () => {
      this.deviceScale = Math.max(this.MIN_ZOOM, Math.round((this.deviceScale - this.ZOOM_STEP) * 100) / 100);
      this.applyDeviceScale();
    });

    this.container.querySelector('#btn-dev-zoom-fit')?.addEventListener('click', () => {
      this.autoFitDevice();
    });
  }

  /**
   * Computes a scale that fits the whole device frame into the current
   * stage, then applies it. No upper cap at 1.0 (the old version's `Math.min
   * (1.0, ...)` meant Fit could never zoom IN even when the device was much
   * smaller than the stage, making it look like a no-op) — see
   * StudioCanvas.js's fitZoomToContent() for the identical reasoning.
   */
  autoFitDevice() {
    if (!this.stageElement) return;

    const deviceId = this.state.activeDeviceId || 'compact';
    const orientation = this.state.deviceOrientation || 'portrait';
    const profile = DEVICE_PROFILES[deviceId] || DEVICE_PROFILES.compact;
    const spec = profile[orientation];

    const availableW = this.stageElement.clientWidth - 60;
    const availableH = this.stageElement.clientHeight - 60;
    if (availableW <= 0 || availableH <= 0) return;

    const fitScale = Math.min(availableW / spec.width, availableH / spec.height);
    this.deviceScale = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, Math.round(fitScale * 100) / 100));
    this.applyDeviceScale();
  }

  /**
   * See StudioCanvas.js's positionCanvasContent() for the full explanation —
   * identical bug, identical fix. `.device-viewport-stage` used to be
   * `display:flex; align-items:center; justify-content:center` directly
   * around deviceFrameElement's `transform:scale`; transform doesn't resize
   * the layout box, so overflow beyond the stage was split evenly on every
   * side of a centered child, and a plain `overflow:auto` ancestor can't
   * scroll to a centered child's "negative" overflow — the compact-portrait
   * frame's top being unreachable/clipped was exactly this. Now the frame
   * scales from its own top-left and this computes symmetric padding on the
   * separate (non-flex) stageContentElement instead — centered when it fits,
   * collapsing toward a minimum once it doesn't, so the whole frame stays
   * reachable by ordinary scrolling regardless of zoom or device size.
   */
  positionDeviceContent(deviceWidth, deviceHeight) {
    const scaledW = deviceWidth * this.deviceScale;
    const scaledH = deviceHeight * this.deviceScale;
    const minPad = 30;
    const padX = Math.max(minPad, (this.stageElement.clientWidth - scaledW) / 2);
    const padY = Math.max(minPad, (this.stageElement.clientHeight - scaledH) / 2);
    this.stageContentElement.style.padding = `${padY}px ${padX}px`;
  }

  /**
   * Mirrors StudioCanvas.js's updatePreviewThemeButton() for this view's own
   * sun/moon button — the two are independent DOM elements but share
   * StudioState.previewTheme, so toggling either one keeps both in sync.
   */
  updatePreviewThemeButtonDevice() {
    const btn = this.container.querySelector('#btn-toggle-preview-theme-device');
    const icon = this.container.querySelector('#preview-theme-icon-device');
    if (!btn || !icon) return;
    const isLight = this.state.previewTheme === 'light';
    btn.classList.toggle('active', isLight);
    btn.title = isLight ? 'Preview: Light (click to preview Dark)' : 'Preview: Dark (click to preview Light)';
    icon.innerHTML = isLight
      ? '<circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path>'
      : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>';
  }

  /**
   * Keeps the "Move Widget" button's active state/title in sync with
   * this.moveWidgetMode. render() calls this every pass; the click handler
   * also calls it directly so the button updates immediately on click
   * without waiting for whatever re-render happens to follow.
   */
  updateMoveWidgetButton() {
    const btn = this.container.querySelector('#btn-toggle-move-widget');
    if (!btn) return;
    btn.classList.toggle('active', this.moveWidgetMode);
    btn.title = this.moveWidgetMode
      ? 'Move Widget: On (drag the corner handle to reposition)'
      : 'Move Widget: Off (click to enable drag-to-reposition)';
  }

  applyDeviceScale() {
    if (this.deviceFrameElement) {
      this.deviceFrameElement.style.transformOrigin = 'top left';
      this.deviceFrameElement.style.transform = `scale(${this.deviceScale})`;
    }
    const zoomText = this.container.querySelector('#dev-zoom-text');
    if (zoomText) {
      zoomText.textContent = `${Math.round(this.deviceScale * 100)}%`;
    }
    const deviceId = this.state.activeDeviceId || 'compact';
    const orientation = this.state.deviceOrientation || 'portrait';
    const profile = DEVICE_PROFILES[deviceId] || DEVICE_PROFILES.compact;
    const spec = profile[orientation];
    this.positionDeviceContent(spec.width, spec.height);
  }

  render() {
    if (this.state.viewportMode !== 'device') {
      return;
    }

    const deviceId = this.state.activeDeviceId || 'compact';
    const orientation = this.state.deviceOrientation || 'portrait';
    const profile = DEVICE_PROFILES[deviceId] || DEVICE_PROFILES.compact;
    const spec = profile[orientation];

    // Update Dropdown and Buttons
    const select = this.container.querySelector('#device-profile-select');
    if (select && select.value !== deviceId) select.value = deviceId;

    this.container.querySelector('#btn-orient-portrait')?.classList.toggle('active', orientation === 'portrait');
    this.container.querySelector('#btn-orient-landscape')?.classList.toggle('active', orientation === 'landscape');

    const summaryEl = this.container.querySelector('#device-grid-summary');
    if (summaryEl) {
      summaryEl.textContent = `${profile.name} (${spec.columns} × ${spec.rows} Grid - ${orientation.toUpperCase()})`;
    }

    // Configure Device Frame Dimensions
    this.deviceFrameElement.className = `device-frame frame-${deviceId} orient-${orientation}`;
    this.deviceFrameElement.style.width = `${spec.width}px`;
    this.deviceFrameElement.style.height = `${spec.height}px`;
    this.applyDeviceScale();
    this.updatePreviewThemeButtonDevice();
    this.updateMoveWidgetButton();
    // See StudioCanvas's identical use of .fd-widget-preview-scope — lets a
    // widget-authored var(--text-white, ...)-style color resolve against
    // studio.css's light block here too.
    this.deviceScreenElement.setAttribute('data-theme', this.state.previewTheme);

    // Render Flight Deck Client Interface inside the screen
    this.deviceScreenElement.innerHTML = `
      <div class="fd-mock-topbar">
        <div class="mock-sim-status" title="Sim Connected">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>
        </div>
        <div class="mock-top-title">FLIGHT DECK PAGE 1</div>
        <div class="mock-aircraft-badge">${(this.state.widgetDef.meta?.shortName || 'STUDIO').slice(0, 7).toUpperCase()}</div>
      </div>
      <div class="fd-mock-separator"></div>
      <div class="fd-mock-page-area">
        <div class="fd-device-page-grid ${this.showDeviceGrid ? 'show-grid-cells' : ''}" style="grid-template-columns: repeat(${spec.columns}, minmax(0, 1fr)); gap: ${spec.gap}px; grid-auto-rows: ${spec.rowHeight}px;"></div>
      </div>
    `;

    const pageGrid = this.deviceScreenElement.querySelector('.fd-device-page-grid');
    if (!pageGrid) return;

    // Place the active edited widget on the device grid
    const def = this.state.widgetDef;
    const defW = Math.min(spec.columns, def.layout?.defaultW || 8);
    const defH = Math.min(spec.rows, def.layout?.defaultH || 4);

    const placeCol = Math.min(spec.columns - defW + 1, Math.max(1, this.state.devicePlacement.col || 1));
    const placeRow = Math.min(spec.rows - defH + 1, Math.max(1, this.state.devicePlacement.row || 1));

    // Update position inputs
    const inputCol = this.container.querySelector('#dev-pos-col');
    const inputRow = this.container.querySelector('#dev-pos-row');
    if (inputCol) {
      inputCol.max = `${spec.columns - defW + 1}`;
      inputCol.value = `${placeCol}`;
    }
    if (inputRow) {
      inputRow.max = `${spec.rows - defH + 1}`;
      inputRow.value = `${placeRow}`;
    }

    const widgetSlot = document.createElement('div');
    widgetSlot.className = 'fd-device-widget-slot active-edited-widget';
    widgetSlot.style.gridColumnStart = `${placeCol}`;
    widgetSlot.style.gridColumnEnd = `span ${defW}`;
    widgetSlot.style.gridRowStart = `${placeRow}`;
    widgetSlot.style.gridRowEnd = `span ${defH}`;

    // Render Widget inside the slot
    this.renderWidgetInstanceInsideDevice(widgetSlot, def);

    // A dedicated corner handle, not the whole slot, starts a drag — the
    // slot's only child is the widget's own live-interactive render (buttons,
    // inputs, taps, longpresses all work here, unlike Design mode's static
    // mock), so making the whole slot a drag target would fight every one of
    // those pointerdown handlers. The handle is the one always-safe place to
    // grab. Only exists at all in Move Widget mode — it's a blue overlay
    // that obscures a bit of the widget's own corner, so authors who are
    // just looking at/interacting with the widget (the common case) don't
    // have it in the way; repositioning via the Col/Row fields still always
    // works regardless of this toggle.
    if (this.moveWidgetMode) {
      const dragHandle = document.createElement('div');
      dragHandle.className = 'fd-device-widget-drag-handle';
      dragHandle.title = 'Drag to reposition on the device';
      dragHandle.textContent = '⠿';
      dragHandle.addEventListener('pointerdown', (e) => {
        this.startDraggingDeviceWidget(e, widgetSlot, pageGrid, spec, defW, defH);
      });
      widgetSlot.appendChild(dragHandle);
    }

    pageGrid.appendChild(widgetSlot);
  }

  /**
   * Live-drags widgetSlot to a new col/row via its corner handle, mirroring
   * StudioCanvas.js's startDraggingComponent() — measure the actual rendered
   * grid cell size at drag start (so it's correct at any zoom), move the
   * DOM node directly on every pointermove for immediate feedback, and only
   * commit to StudioState (a single history-free placement write — Device
   * View positioning isn't part of the widget def, so there's nothing to
   * undo/redo here) once on pointerup.
   */
  startDraggingDeviceWidget(e, widgetSlot, pageGrid, spec, defW, defH) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startCol = this.state.devicePlacement.col || 1;
    const startRow = this.state.devicePlacement.row || 1;
    const gridRect = pageGrid.getBoundingClientRect();
    const cellWidth = gridRect.width / spec.columns;
    const cellHeight = gridRect.height / spec.rows;
    widgetSlot.classList.add('dragging');

    let finalCol = startCol;
    let finalRow = startRow;

    const onPointerMove = (moveEv) => {
      const dx = moveEv.clientX - startX;
      const dy = moveEv.clientY - startY;
      const colDelta = Math.round(dx / cellWidth);
      const rowDelta = Math.round(dy / cellHeight);
      finalCol = Math.min(spec.columns - defW + 1, Math.max(1, startCol + colDelta));
      finalRow = Math.min(spec.rows - defH + 1, Math.max(1, startRow + rowDelta));
      widgetSlot.style.gridColumnStart = `${finalCol}`;
      widgetSlot.style.gridRowStart = `${finalRow}`;
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      widgetSlot.classList.remove('dragging');
      if (finalCol !== startCol || finalRow !== startRow) {
        this.state.setDevicePlacement(finalCol, finalRow);
      }
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  renderWidgetInstanceInsideDevice(container, def) {
    const gridCols = def.layout?.grid?.columns || 12;
    const gridRows = def.layout?.grid?.rows || 6;

    const widgetRoot = document.createElement('div');
    widgetRoot.className = 'fd-device-composite-root';
    widgetRoot.style.display = 'grid';
    // minmax(0,1fr), not bare 1fr: matches the real runtime's
    // CompositeWidget.js exactly, so a widget's internal cell sizes compute
    // identically in both apps regardless of content.
    widgetRoot.style.gridTemplateColumns = `repeat(${gridCols}, minmax(0, 1fr))`;
    widgetRoot.style.gridTemplateRows = `repeat(${gridRows}, minmax(0, 1fr))`;
    widgetRoot.style.gap = '4px';
    widgetRoot.style.padding = '4px';
    widgetRoot.style.width = '100%';
    widgetRoot.style.height = '100%';
    widgetRoot.style.boxSizing = 'border-box';
    widgetRoot.style.borderRadius = '8px';
    const rootColorCtx = { componentType: 'widget-root', layerGroup: 'background' };
    // FDWS v1.18: baseTheme/themeMode + style.themeOverride, same as the real
    // runtime's CompositeWidget.js — see MockWidgetHost.js's getThemeConfig().
    const rootThemeOverride = def.style?.themeOverride || {};
    const rootBgColor = resolveThemedColor(
      def.style?.background?.color, rootThemeOverride.background?.color, { ...rootColorCtx, colorKind: 'background' },
      this.state.previewTheme, def.baseTheme === 'light' ? 'light' : 'dark', def.themeMode === 'manual' ? 'manual' : 'auto'
    );
    const rootBorderColor = resolveThemedColor(
      def.style?.border?.color, rootThemeOverride.border?.color, { ...rootColorCtx, colorKind: 'border' },
      this.state.previewTheme, def.baseTheme === 'light' ? 'light' : 'dark', def.themeMode === 'manual' ? 'manual' : 'auto'
    );
    widgetRoot.style.backgroundColor = rootBgColor || 'var(--card-bg, #141721)';
    widgetRoot.style.border = `1px solid ${rootBorderColor || 'var(--card-border, #222736)'}`;
    widgetRoot.style.overflow = 'hidden';

    // Stacking and layer groups
    const layerGroupsMap = new Map();
    (def.layerGroups || []).forEach((lg) => layerGroupsMap.set(lg.id, lg.z || 0));

    const components = (def.components || []).map((comp, idx) => {
      const groupZ = comp.layer?.group ? (layerGroupsMap.get(comp.layer.group) ?? 0) : 0;
      const compZ = comp.layer?.z ?? 0;
      const effectiveZ = groupZ + compZ;
      return { comp, effectiveZ, idx };
    });

    components.sort((a, b) => (a.effectiveZ !== b.effectiveZ ? a.effectiveZ - b.effectiveZ : a.idx - b.idx));

    // Mock host for interactive simulation inside device (FDWS v1.3: also wired to
    // open kind:"popover" widgets via core.openWidgetPopover; see MockWidgetHost.js).
    const dispatchSimEvent = (event, val) => {
      console.log(`[Device View] Event Dispatched: ${event} (${val})`);
      const lower = event.toLowerCase();
      if (this.state.simTelemetry[lower] !== undefined) {
        this.state.updateSimTelemetry(lower, val !== undefined ? val : 1);
      }
    };
    const findPopoverDef = (id) => this.state.getSavedWidgetsByKind('popover').find((w) => w.id === id) || null;

    const mockHost = createMockHost(def, {
      dispatchSimEvent,
      findPopoverDef,
      openWidgetPopover: (openOpts) => openWidgetPopover({ ...openOpts, findPopoverDef, dispatchSimEvent }),
      theme: this.state.previewTheme,
      // State tab's live "Current:" readout (StudioLayersPanel.js) — mirrors
      // this mock host's local state into StudioState as it changes from
      // interacting with the widget here, so an author can verify a tap/
      // input actually moved the state var they expect.
      onLocalStateChange: (name, val) => this.state.setLiveStateValue(name, val)
    });
    // Seed the State tab with each declared var's starting value immediately —
    // otherwise it shows nothing ("—") until the first interaction, even
    // though the mock host already has real default/seeded values right now.
    (def.state || []).forEach((s) => this.state.setLiveStateValue(s.name, mockHost.getLocalState(s.name)));

    components.forEach(({ comp, effectiveZ }) => {
      const RendererClass = ComponentRegistry.getRenderer(comp.type);
      const renderer = new RendererClass(comp, mockHost);
      mockHost.renderers.set(comp.id, renderer);
      const el = renderer.render();
      el.style.zIndex = `${effectiveZ}`;
      widgetRoot.appendChild(el);

      const boundVar = comp.binding?.readSimVar;
      let val = boundVar ? this.state.simTelemetry[boundVar] : undefined;
      // FDWS v1.11 §1.2: a component bound only via binding.stateVar/stateRef
      // (no readSimVar) previously got no initial value here at all — its
      // first paint relied on some later setLocalState() broadcast, or (for
      // core.button's presetSlot) a bespoke render()-time read of its own.
      // Resolve those the same way setLocalState()'s broadcast loop does.
      if (val === undefined && comp.binding?.stateVar) {
        val = mockHost.getLocalState(comp.binding.stateVar);
      } else if (val === undefined && comp.binding?.stateRef) {
        val = readStateRef(mockHost, comp.binding.stateRef);
      }
      renderer.update(val, mockHost.getAllStateObject());
    });

    container.appendChild(widgetRoot);
  }
}
