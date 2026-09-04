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
import { StudioSimVarTester } from './StudioSimVarTester.js';
import { StudioMenuBar } from './StudioMenuBar.js';
import { StudioStatusBar } from './StudioStatusBar.js';
import { StudioValidator } from './StudioValidator.js';
import { FDWS_VERSIONS } from '../widgets/PropertyRegistry.js';
import { SimBridge } from '../core/SimBridge.js';
import { StudioBridgeAdapter } from './StudioBridgeAdapter.js';
import { openModal, showToast } from './StudioModal.js';

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
    this.simVarTester = null;
    this.menuBar = null;
    this.statusBar = null;

    // 0.3-A: PC Bridge connection.
    //
    // CORRECTION (found live, 2026-09-02): an earlier version of this comment
    // claimed a locally-served Studio reaches PC Bridge over plain ws:// with
    // "no certificate involved." That is wrong. PC Bridge has exactly one
    // server — `https.createServer()` in pc-bridge/server.js — and no
    // plain-HTTP fallback, so it only ever speaks wss://. Meanwhile
    // getResolvedUrl() (shared/SimBridge.js) derives its scheme from
    // window.location.protocol, so an http:// or file:// -served Studio
    // auto-resolves to ws:// and can never reach it.
    //
    // The escape hatch is setServerUrl('wss://<host>:8080'), which persists to
    // localStorage and works from any page scheme — surfaced in the UI by
    // wireBridgeConnection()'s click-to-configure on the status pill. First
    // connection to a self-signed bridge still needs its certificate accepted
    // once, via https://<host>:8080 in a browser tab.
    this.bridgeAdapter = new StudioBridgeAdapter(this.state);
    this.simBridge = new SimBridge(this.bridgeAdapter);
  }

  init() {
    console.log('[Widget Studio v1.5] Initializing graphical studio workspace...');

    this.buildWorkspaceDOM();
    this.mountSubsystems();
    this.wireBridgeConnection();
    this.wireRestoreBanner();
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

      <!-- Wave 0a (Part 6.4): visible autosave-restore banner, hidden unless
           StudioState found a draft on load -->
      <div id="studio-restore-banner" class="restore-draft-banner hidden"></div>

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
      <div id="studio-simvartester-container"></div>

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
    const testerEl = document.getElementById('studio-simvartester-container');
    this.simVarTester = new StudioSimVarTester(testerEl, this.state, this.simBridge);
    this.statusBar = new StudioStatusBar(statusBarEl, this.state, this.simBench, this.simVarTester);
    // Inspector is constructed before the tester exists (above) -- same
    // loosely-coupled cross-panel wiring as state.testerParsed (tester ->
    // inspector paste buttons), just the reverse direction (Connect dialog's
    // Test tab -> Fire & Watch hand-off).
    this.inspector.simVarTester = this.simVarTester;

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
      const target = this.simBridge.getResolvedUrl();
      if (simConnected) {
        labelEl.textContent = 'Sim Connected';
        statusEl.title = `PC Bridge connected (${target}), SimConnect live — click to change server`;
      } else if (bridgeConnected) {
        labelEl.textContent = 'Bridge Only';
        statusEl.title = `PC Bridge connected (${target}), waiting for MSFS — click to change server`;
      } else {
        labelEl.textContent = 'Offline';
        statusEl.title = `Not connected to PC Bridge (trying ${target}) — click to change server`;
      }
    };

    statusEl.classList.add('is-clickable');
    statusEl.setAttribute('role', 'button');
    statusEl.setAttribute('tabindex', '0');
    const openServerSetting = () => this.promptBridgeServerUrl();
    statusEl.addEventListener('click', openServerSetting);
    statusEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        openServerSetting();
      }
    });

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

  /**
   * Wave 0a (Part 6.4): restoreSession() (StudioState.js) still auto-restores
   * an autosaved draft on load, but no longer silently — it sets
   * restoredSessionInfo instead, and this renders the visible banner off of
   * it. Marcus's flagged risk in the other direction: an old, abandoned
   * experiment silently reappearing is its own trap, so Keep/Discard are both
   * one click and neither is hidden behind a badge someone could miss.
   */
  wireRestoreBanner() {
    const banner = document.getElementById('studio-restore-banner');
    if (!banner) return;

    const render = () => {
      const info = this.state.restoredSessionInfo;
      if (!info) {
        banner.classList.add('hidden');
        banner.innerHTML = '';
        return;
      }
      const when = info.savedAt ? new Date(info.savedAt).toLocaleString() : 'an earlier session';
      const safeName = String(info.name ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
      ));
      banner.innerHTML = `
        <span class="restore-draft-text">Restored an autosaved draft — "${safeName}" (saved ${when}).</span>
        <button type="button" id="restore-draft-keep" class="bar-btn">Keep</button>
        <button type="button" id="restore-draft-discard" class="bar-btn">Discard</button>
      `;
      banner.classList.remove('hidden');
      banner.querySelector('#restore-draft-keep')?.addEventListener('click', () => this.state.keepRestoredSession());
      banner.querySelector('#restore-draft-discard')?.addEventListener('click', () => this.state.discardRestoredSession());
    };

    render();
    this.state.subscribe((changeType) => {
      if (changeType === 'GENERAL' || changeType === 'WIDGET_DEF_LOADED') render();
    });
  }

  /**
   * PC Bridge server address dialog, opened from the status pill.
   *
   * Studio needs this in a way the PWA doesn't. The PWA is normally opened
   * from PC Bridge's own https:// address, so getResolvedUrl()'s
   * protocol-derived default (wss://) already points somewhere real. Studio is
   * typically opened from a local file:// or http:// dev server, where that
   * same derivation produces ws:// — a scheme PC Bridge never speaks, since
   * pc-bridge/server.js only ever creates an https server. Without this dialog
   * a locally-opened Studio has no reachable default and no way to say so.
   *
   * setServerUrl() (shared/SimBridge.js) handles normalization (bare host ->
   * scheme, http->ws, https->wss), localStorage persistence under
   * 'flightdeck_bridge_custom_url', and reconnecting the live socket.
   */
  async promptBridgeServerUrl() {
    const current = this.simBridge.customUrl || '';
    const resolved = this.simBridge.getResolvedUrl();

    const result = await openModal({
      title: 'PC Bridge Server',
      submitLabel: 'Connect',
      bodyHtml: `
        <div class="modal-form-row">
          <label for="bridge-url-input">Server address</label>
          <input type="text" id="bridge-url-input" class="prop-input"
                 placeholder="wss://192.168.1.50:8080" value="${current.replace(/"/g, '&quot;')}" />
        </div>
        <p class="modal-confirm-text" style="margin-top:10px;">
          Currently trying <code>${resolved}</code>.
          Leave blank to auto-detect from this page's address.
        </p>
        <p class="modal-confirm-text" style="margin-top:8px;">
          PC Bridge only accepts <code>wss://</code>. If Studio is open over
          <code>http://</code> or <code>file://</code>, auto-detect resolves to
          <code>ws://</code> and cannot connect — set the address explicitly here.
          A self-signed bridge also needs its certificate accepted once: open
          <code>https://&lt;host&gt;:8080</code> in a tab and proceed past the warning.
        </p>
      `,
      onMount: (card) => {
        const input = card.querySelector('#bridge-url-input');
        input?.focus();
        input?.select();
      },
      onSubmit: (card) => {
        const raw = card.querySelector('#bridge-url-input')?.value.trim() || '';
        if (raw && /\s/.test(raw)) return { error: 'Server address cannot contain spaces.' };
        return { value: raw };
      }
    });

    // openModal resolves null on cancel; '' is a deliberate "clear it".
    if (result === null) return;

    this.simBridge.setServerUrl(result || null);
    showToast(result ? `Connecting to ${this.simBridge.getResolvedUrl()}…` : 'Reverting to auto-detected server…');
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
