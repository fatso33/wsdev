/**
 * StudioApp.js
 * Master Lifecycle & Orchestration Coordinator for Flight Deck Widget Studio v1.5
 */

import { StudioState } from './StudioState.js';
import { StudioLayersPanel } from './StudioLayersPanel.js';
import { StudioCanvas } from './StudioCanvas.js';
import { StudioDeviceView } from './StudioDeviceView.js';
import { StudioInspector } from './StudioInspector.js';
import { StudioSimBench } from './StudioSimBench.js';
import { StudioMenuBar } from './StudioMenuBar.js';
import { StudioStatusBar } from './StudioStatusBar.js';
import { StudioValidator } from './StudioValidator.js';
import { FDWS_VERSIONS } from '../widgets/PropertyRegistry.js';
import { SimBridge } from '../core/SimBridge.js';
import { StudioBridgeAdapter } from './StudioBridgeAdapter.js';

// "What's the current FDWS spec version" display string — previously
// hardcoded as "v1.14" in several places (this header badge, the footer
// validator button, the Telemetry Test Bench title) and left stale through
// the v1.15/v1.16 spec bumps since nothing referenced
// PropertyRegistry.FDWS_VERSIONS, the actual single source of truth for the
// version enum. Each display site (this file, StudioStatusBar.js,
// StudioSimBench.js) derives its own copy from FDWS_VERSIONS rather than
// importing one from another — StudioApp.js imports those two, so importing
// back would be a circular module dependency.
const LATEST_FDWS_VERSION = FDWS_VERSIONS[FDWS_VERSIONS.length - 1];

export class StudioApp {
  constructor(rootContainer) {
    this.root = rootContainer || document.getElementById('app') || document.body;
    this.state = new StudioState();

    this.layersPanel = null;
    this.canvasView = null;
    this.deviceView = null;
    this.inspector = null;
    this.simBench = null;
    this.menuBar = null;
    this.statusBar = null;

    // 0.3-A: PC Bridge connection. getResolvedUrl() (shared/SimBridge.js)
    // picks ws:// vs wss:// off window.location.protocol — a Studio opened
    // locally on the sim PC (http://localhost:3001, say) connects over plain
    // ws://localhost:8080, no certificate involved; only a GitHub Pages
    // (https://) hosted Studio would hit the self-signed-cert wall.
    this.bridgeAdapter = new StudioBridgeAdapter(this.state);
    this.simBridge = new SimBridge(this.bridgeAdapter);
  }

  init() {
    console.log('[Widget Studio v1.5] Initializing graphical studio workspace...');

    this.buildWorkspaceDOM();
    this.mountSubsystems();
    this.wireBridgeConnection();
    this.attachGlobalShortcuts();

    // Initial validation check
    const val = StudioValidator.validate(this.state.widgetDef);
    console.log(`[Widget Studio v1.5] Loaded widget "${this.state.widgetDef.meta?.name || this.state.widgetDef.id}" (Valid: ${val.valid}, Errors: ${val.errors.length}, Warnings: ${val.warnings.length})`);
  }

  buildWorkspaceDOM() {
    this.root.innerHTML = '';
    this.root.className = 'flightdeck-studio-root';

    this.root.innerHTML = `
      <!-- Studio Top Navigation Header -->
      <header class="studio-top-nav">
        <div class="studio-nav-brand">
          <div class="brand-glyph">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4">
              <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
              <path d="M2 17l10 5 10-5"></path>
              <path d="M2 12l10 5 10-5"></path>
            </svg>
          </div>
          <div class="brand-title-wrap">
            <h1 class="brand-heading">FLIGHT DECK</h1>
            <span class="brand-subheading">WIDGET STUDIO</span>
          </div>
          <span class="spec-version-badge">FDWS v${LATEST_FDWS_VERSION}</span>
        </div>

        <div class="studio-nav-center">
          <div class="widget-quick-info">
            <span class="active-widget-icon">⚡</span>
            <span id="nav-widget-name" class="active-widget-name">${this.state.widgetDef.meta?.name || 'NAV 1 Radio'}</span>
            <span id="nav-widget-rev" class="active-widget-rev">r${this.state.widgetDef.revision || 1}</span>
          </div>

          <!-- Prominent View Mode Switcher in Header -->
          <div class="nav-viewport-toggle-group">
            <button id="top-btn-vp-edit" class="nav-vp-btn ${this.state.viewportMode === 'edit' ? 'active' : ''}" title="Single-Widget Sub-Grid Canvas">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
              Edit View
            </button>
            <button id="top-btn-vp-device" class="nav-vp-btn ${this.state.viewportMode === 'device' ? 'active' : ''}" title="Device Outline Simulator View">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="2" width="14" height="20" rx="2" ry="2"></rect><line x1="12" y1="18" x2="12.01" y2="18"></line></svg>
              Device View
            </button>
          </div>
        </div>

        <div class="studio-nav-right">
          <!-- 0.3-A: PC Bridge connection indicator -->
          <div id="studio-bridge-status" class="studio-bridge-status" title="Not connected to PC Bridge">
            <span class="studio-bridge-status-dot"></span>
            <span class="studio-bridge-status-label">Offline</span>
          </div>
          <div class="nav-help-links">
            <span class="nav-help-item" title="Conforming to Flight Deck Widget Standard v${LATEST_FDWS_VERSION}">Standard: <strong>v${LATEST_FDWS_VERSION}.0</strong></span>
          </div>
        </div>
      </header>

      <!-- Main Action Menu Bar (spans full width, under header) -->
      <nav id="studio-top-menubar" class="studio-menubar-top"></nav>

      <!-- Main Workspace Body (3-Column Layout) -->
      <main class="studio-main-layout">
        <!-- Left Sidebar: Layers, Palette, State, Assets, Templates -->
        <aside id="studio-left-sidebar" class="studio-sidebar-left"></aside>

        <!-- Center Viewport Area: Strictly ONE active viewport component rendered at a time -->
        <section id="studio-center-viewport" class="studio-viewport-area"></section>

        <!-- Right Sidebar: Grouped Property Inspector -->
        <aside id="studio-right-sidebar" class="studio-sidebar-right"></aside>
      </main>

      <!-- Sim Telemetry Bench Drawer -->
      <div id="studio-simbench-container"></div>

      <!-- Bottom Sleek Menu Bar -->
      <footer id="studio-bottom-menubar" class="studio-menubar-footer"></footer>
    `;
  }

  mountSubsystems() {
    const leftEl = document.getElementById('studio-left-sidebar');
    const rightEl = document.getElementById('studio-right-sidebar');
    const simBenchEl = document.getElementById('studio-simbench-container');
    const topMenuEl = document.getElementById('studio-top-menubar');
    const statusBarEl = document.getElementById('studio-bottom-menubar');

    this.layersPanel = new StudioLayersPanel(leftEl, this.state);
    this.inspector = new StudioInspector(rightEl, this.state, this.simBridge);
    this.simBench = new StudioSimBench(simBenchEl, this.state);
    this.menuBar = new StudioMenuBar(topMenuEl, this.state);
    this.statusBar = new StudioStatusBar(statusBarEl, this.state, this.simBench);

    // Initial mount of the single active central viewport
    this.renderActiveViewport();

    // Top Navigation Viewport switcher buttons
    const topBtnEdit = document.getElementById('top-btn-vp-edit');
    const topBtnDev = document.getElementById('top-btn-vp-device');

    topBtnEdit?.addEventListener('click', () => this.state.setViewportMode('edit'));
    topBtnDev?.addEventListener('click', () => this.state.setViewportMode('device'));

    // Watch viewport mode changes and metadata updates
    this.state.subscribe((changeType) => {
      if (changeType === 'VIEWPORT_MODE_CHANGED') {
        const isEdit = this.state.viewportMode === 'edit';
        topBtnEdit?.classList.toggle('active', isEdit);
        topBtnDev?.classList.toggle('active', !isEdit);
        this.renderActiveViewport();
      }

      if (['WIDGET_DEF_LOADED', 'WIDGET_META_UPDATED'].includes(changeType)) {
        const nameEl = document.getElementById('nav-widget-name');
        const revEl = document.getElementById('nav-widget-rev');
        if (nameEl) nameEl.textContent = this.state.widgetDef.meta?.name || 'Untitled';
        if (revEl) revEl.textContent = `r${this.state.widgetDef.revision || 1}`;
      }
    });
  }

  /**
   * 0.3-A: connects to PC Bridge and drives the header's connection
   * indicator off BRIDGE_STATUS (WebSocket up/down) and SIM_STATUS
   * (SimConnect up/down on the PC side, independent of the WS connection
   * itself — mirrors the PWA menu button's cyan/magenta distinction).
   */
  wireBridgeConnection() {
    const statusEl = document.getElementById('studio-bridge-status');
    const labelEl = statusEl?.querySelector('.studio-bridge-status-label');
    if (!statusEl || !labelEl) return;

    let bridgeConnected = false;
    let simConnected = false;

    const render = () => {
      statusEl.classList.toggle('bridge-connected', bridgeConnected);
      statusEl.classList.toggle('sim-connected', simConnected);
      if (simConnected) {
        labelEl.textContent = 'Sim Connected';
        statusEl.title = 'PC Bridge connected, SimConnect live';
      } else if (bridgeConnected) {
        labelEl.textContent = 'Bridge Only';
        statusEl.title = 'PC Bridge connected, waiting for MSFS';
      } else {
        labelEl.textContent = 'Offline';
        statusEl.title = 'Not connected to PC Bridge';
      }
    };

    this.bridgeAdapter.subscribe('BRIDGE_STATUS', ({ connected }) => {
      bridgeConnected = connected;
      if (!connected) simConnected = false;
      render();
    });
    this.bridgeAdapter.subscribe('SIM_STATUS', ({ connected }) => {
      simConnected = connected;
      render();
    });

    this.simBridge.connect();
  }

  renderActiveViewport() {
    const centerEl = document.getElementById('studio-center-viewport');
    if (!centerEl) return;

    centerEl.innerHTML = '';

    if (this.state.viewportMode === 'edit') {
      this.canvasView = new StudioCanvas(centerEl, this.state);
      this.deviceView = null;
    } else {
      this.deviceView = new StudioDeviceView(centerEl, this.state);
      this.canvasView = null;
    }
  }

  attachGlobalShortcuts() {
    // Window resize handler to trigger canvas fit
    window.addEventListener('resize', () => {
      // Re-trigger render
      if (this.state.viewportMode === 'edit' && this.canvasView) {
        this.canvasView.render();
      } else if (this.deviceView) {
        this.deviceView.render();
      }
    });
  }
}
