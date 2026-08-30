/**
 * StudioSimBench.js
 * Interactive Telemetry Simulator Test Bench Drawer for Flight Deck Widget Studio
 * Enables real-time testing of SimVar values, annunciator alerts, switch toggles, and frequency transfers
 */

import { DECK_EVENTS, getDeckEventsByCategory } from '../core/deckEvents.js';
import { FDWS_VERSIONS } from '../widgets/PropertyRegistry.js';

const CATEGORY_LABELS = { radio: 'RADIOS & TRANSPONDER', ap: 'AUTOPILOT', lights: 'LIGHTS' };
const LATEST_FDWS_VERSION = FDWS_VERSIONS[FDWS_VERSIONS.length - 1];

// Named telemetry presets a user can apply in one click instead of poking
// values one at a time — realistic starting points for common test scenarios.
const SCENARIOS = {
  coldDark: {
    label: 'Cold & Dark',
    values: { apMasterState: 0, apFdState: 0, apAltModeState: 0, apHdgModeState: 0, taxiLightState: 0, landingLightState: 0, navLightState: 0, beaconLightState: 0, strobeLightState: 0 }
  },
  cruise: {
    label: 'Cruise',
    values: { apMasterState: 1, apFdState: 1, apAltModeState: 1, apHdgModeState: 0, apNavModeState: 1, navLightState: 1, beaconLightState: 1, strobeLightState: 1, taxiLightState: 0, landingLightState: 0 }
  },
  approach: {
    label: 'Approach',
    values: { apMasterState: 1, apFdState: 1, apAprModeState: 1, apAltModeState: 0, taxiLightState: 0, landingLightState: 1, navLightState: 1, beaconLightState: 1, strobeLightState: 1 }
  }
};

export class StudioSimBench {
  /**
   * @param {HTMLElement} container
   * @param {import('./StudioState.js').StudioState} state
   */
  constructor(container, state) {
    this.container = container;
    this.state = state;
    this.isOpen = false;

    this.initDOM();
    this.render();

    this.state.subscribe((changeType) => {
      if (['SIM_TELEMETRY_UPDATED', 'WIDGET_DEF_LOADED'].includes(changeType)) {
        this.render();
      }
    });
  }

  initDOM() {
    this.container.innerHTML = '';
    this.container.className = 'studio-sim-bench-drawer closed';
  }

  toggle() {
    this.isOpen = !this.isOpen;
    this.container.classList.toggle('closed', !this.isOpen);
    this.container.classList.toggle('open', this.isOpen);
  }

  close() {
    this.isOpen = false;
    this.container.classList.add('closed');
    this.container.classList.remove('open');
  }

  render() {
    const telem = this.state.simTelemetry;
    const def = this.state.widgetDef;

    // Detect which SimVars are bound to current widget's components
    const activeWidgetSimVars = new Set();
    (def.components || []).forEach((c) => {
      if (c.binding?.readSimVar) activeWidgetSimVars.add(c.binding.readSimVar);
    });

    this.container.innerHTML = `
      <div class="sim-bench-header">
        <div class="sim-bench-title-wrap">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00d8f6" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
          <span class="sim-bench-title">TELEMETRY TEST BENCH</span>
          <span class="sim-bench-subtitle">Live Mock Injection for FDWS v${LATEST_FDWS_VERSION} Components</span>
        </div>
        <button id="btn-close-simbench" class="btn-mini-close">✕</button>
      </div>

      <div class="sim-bench-body">
        <!-- Section 1: Widget Bound SimVars -->
        <div class="sim-bench-section">
          <div class="sim-section-hdr">WIDGET BOUND VARIABLES (${activeWidgetSimVars.size})</div>
          <div class="sim-controls-grid">
            ${Array.from(activeWidgetSimVars).map((sv) => this.buildSimControl(sv, telem[sv], DECK_EVENTS.find((e) => e.name === sv))).join('') || '<div class="caps-empty">No bound readSimVars in this widget.</div>'}
          </div>
        </div>

        <!-- Section 2: Scenario Presets -->
        <div class="sim-bench-section">
          <div class="sim-section-hdr">SCENARIO PRESETS</div>
          <div class="sim-scenario-row">
            ${Object.entries(SCENARIOS).map(([id, s]) => `<button class="bar-btn sim-scenario-btn" data-scenario="${id}">${s.label}</button>`).join('')}
          </div>
        </div>

        <!-- Section 3: Global Avionics Quick Controls, driven by the canonical Deck Events list -->
        <div class="sim-bench-section">
          <div class="sim-section-hdr">GLOBAL AVIONICS & ANNUNCIATORS</div>
          ${Object.entries(CATEGORY_LABELS).map(([cat, label]) => `
            <div class="sim-category-block">
              <div class="sim-category-label">${label}</div>
              <div class="sim-controls-grid">
                ${getDeckEventsByCategory(cat).filter((e) => e.kind === 'read').map((e) => this.buildSimControl(e.name, telem[e.name], e)).join('')}
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    `;

    this.container.querySelector('#btn-close-simbench')?.addEventListener('click', () => this.close());

    // Attach listeners to input controls
    this.container.querySelectorAll('.sim-input-control').forEach((input) => {
      input.addEventListener('input', (e) => {
        const key = e.target.dataset.simvar;
        const val = e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : (e.target.type === 'number' ? parseFloat(e.target.value) : e.target.value);
        this.state.updateSimTelemetry(key, val);
      });
    });

    // Scenario preset buttons
    this.container.querySelectorAll('.sim-scenario-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const scenario = SCENARIOS[btn.dataset.scenario];
        if (!scenario) return;
        Object.entries(scenario.values).forEach(([key, val]) => this.state.updateSimTelemetry(key, val));
      });
    });
  }

  buildSimControl(key, val, deckEvent) {
    if (key === undefined) return '';
    // A Deck Event's name is the reliable signal for whether it's boolean —
    // every canonical *State read event backed by a toggle is named with
    // that suffix (see core/deckEvents.js); falls back to a value-shape
    // guess only for non-canonical/custom keys with no Deck Event metadata.
    const isBool = deckEvent
      ? /State$/.test(deckEvent.name) && typeof val === 'number'
      : typeof val === 'number' && (val === 0 || val === 1);
    const label = deckEvent?.label || key;

    if (isBool) {
      return `
        <div class="sim-ctrl-card toggle-card" title="${key}">
          <span class="sim-ctrl-label">${label}</span>
          <label class="sim-toggle-switch">
            <input type="checkbox" class="sim-input-control" data-simvar="${key}" ${val ? 'checked' : ''} />
            <span class="sim-slider"></span>
          </label>
        </div>
      `;
    }

    const isNum = typeof val === 'number';

    return `
      <div class="sim-ctrl-card" title="${key}">
        <div class="sim-ctrl-label-row">
          <span class="sim-ctrl-label">${label}</span>
          <span class="sim-ctrl-val">${val !== undefined ? val : ''}</span>
        </div>
        <input
          type="${isNum ? 'number' : 'text'}"
          class="sim-input-control sim-text-input"
          data-simvar="${key}"
          value="${val !== undefined ? val : ''}"
        />
      </div>
    `;
  }
}
