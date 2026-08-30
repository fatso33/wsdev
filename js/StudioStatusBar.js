/**
 * StudioStatusBar.js
 * Sleek Bottom Status Bar for Flight Deck Widget Studio
 * Houses spec validation and the Telemetry Test Bench toggle. Document actions
 * (New/Save/Import/Export/Undo/Redo) and the Edit/Device viewport switcher live
 * elsewhere (top menu bar and top header, respectively) to avoid duplication.
 */

import { StudioValidator } from './StudioValidator.js';
import { FDWS_VERSIONS } from '../widgets/PropertyRegistry.js';

// Not imported from StudioApp.js's own copy of this same one-liner — StudioApp.js
// imports StudioStatusBar.js, so importing back would be a circular module
// dependency. Each display site derives it locally from the same canonical
// FDWS_VERSIONS array instead.
const LATEST_FDWS_VERSION = FDWS_VERSIONS[FDWS_VERSIONS.length - 1];

export class StudioStatusBar {
  /**
   * @param {HTMLElement} container
   * @param {import('./StudioState.js').StudioState} state
   * @param {import('./StudioSimBench.js').StudioSimBench} simBench
   */
  constructor(container, state, simBench) {
    this.container = container;
    this.state = state;
    this.simBench = simBench;

    this.initDOM();
    this.attachEventListeners();
    this.updateLiveValidationBadge();

    // Live validation, per the same philosophy as the canvas/layer-tree badges:
    // the error/warning count is always visible, not gated behind clicking
    // "Validate" — that button now opens the full report, but the headline
    // count updates continuously as the widget is edited.
    this.state.subscribe((changeType) => {
      if (['WIDGET_DEF_LOADED', 'WIDGET_META_UPDATED', 'WIDGET_LAYOUT_UPDATED', 'WIDGET_STYLE_UPDATED', 'COMPONENT_ADDED', 'COMPONENT_DELETED', 'COMPONENT_UPDATED', 'LAYER_GROUPS_UPDATED', 'STATE_VARS_UPDATED', 'ASSETS_UPDATED', 'HISTORY_CHANGE'].includes(changeType)) {
        this.updateLiveValidationBadge();
      }
    });
  }

  updateLiveValidationBadge() {
    const badge = this.container.querySelector('#validate-live-badge');
    if (!badge) return;
    const result = StudioValidator.validate(this.state.widgetDef);
    if (result.errors.length > 0) {
      badge.textContent = result.errors.length;
      badge.className = 'validate-live-badge error';
      badge.classList.remove('hidden');
    } else if (result.warnings.length > 0) {
      badge.textContent = result.warnings.length;
      badge.className = 'validate-live-badge warning';
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  }

  initDOM() {
    this.container.innerHTML = '';
    this.container.className = 'studio-menubar-footer';

    this.container.innerHTML = `
      <div class="bottom-bar-left">
        <div class="studio-brand-badge">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M12 2L2 7l10 5 10-5-10-5z"></path><path d="M2 17l10 5 10-5"></path><path d="M2 12l10 5 10-5"></path></svg>
          <span class="brand-text">WIDGET STUDIO</span>
          <span class="brand-ver">v1.5</span>
        </div>
      </div>

      <div class="bottom-bar-center">
        <button id="btn-validate" class="bar-btn highlight" title="Run FDWS v${LATEST_FDWS_VERSION} Specification Validator">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
          Validate (§11)
          <span id="validate-live-badge" class="validate-live-badge hidden"></span>
        </button>

        <button id="btn-simbench" class="bar-btn" title="Open Live Sim Telemetry Test Bench">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
          Sim Bench
        </button>
      </div>

      <div class="bottom-bar-right"></div>
    `;

    // Global Modal Container for the Validation report
    this.modalOverlay = document.createElement('div');
    this.modalOverlay.className = 'studio-modal-overlay hidden';
    document.body.appendChild(this.modalOverlay);
  }

  attachEventListeners() {
    this.container.querySelector('#btn-validate')?.addEventListener('click', () => this.showValidationModal());
    this.container.querySelector('#btn-simbench')?.addEventListener('click', () => this.simBench.toggle());
  }

  showValidationModal() {
    const result = StudioValidator.validate(this.state.widgetDef);

    this.modalOverlay.innerHTML = `
      <div class="studio-modal-box">
        <div class="modal-hdr">
          <div class="modal-title-group">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${result.valid ? '#22c55e' : '#ef4444'}" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
            <span class="modal-title">FDWS v${LATEST_FDWS_VERSION} SPECIFICATION VALIDATION</span>
          </div>
          <button id="btn-close-val-modal" class="btn-mini-close">✕</button>
        </div>

        <div class="modal-body">
          <div class="val-status-banner ${result.valid ? 'banner-valid' : 'banner-invalid'}">
            ${result.valid
              ? `✓ WIDGET FULLY COMPLIANT WITH FLIGHT DECK WIDGET STANDARD v${LATEST_FDWS_VERSION}`
              : `✗ ${result.errors.length} NORMATIVE SPECIFICATION ERROR(S) DETECTED`}
          </div>

          ${result.errors.length > 0 ? `
            <div class="val-section">
              <div class="val-section-title text-red">ERRORS (${result.errors.length}):</div>
              <ul class="val-list errors">
                ${result.errors.map((e) => this.renderValidationListItem(e)).join('')}
              </ul>
            </div>
          ` : ''}

          ${result.warnings.length > 0 ? `
            <div class="val-section">
              <div class="val-section-title text-amber">WARNINGS (${result.warnings.length}):</div>
              <ul class="val-list warnings">
                ${result.warnings.map((w) => this.renderValidationListItem(w)).join('')}
              </ul>
            </div>
          ` : ''}

          <div class="val-section">
            <div class="val-section-title">CAPABILITY MANIFEST SUMMARY:</div>
            <div class="val-caps-summary">
              <div><strong>Read SimVars:</strong> ${result.capabilitiesSummary.readSimVars.join(', ') || 'None'}</div>
              <div style="margin-top:4px;"><strong>Write Events:</strong> ${result.capabilitiesSummary.writeEvents.join(', ') || 'None'}</div>
            </div>
          </div>
        </div>

        <div class="modal-footer">
          <button id="btn-modal-done" class="bar-btn primary">Close</button>
        </div>
      </div>
    `;

    this.modalOverlay.classList.remove('hidden');

    const closeModal = () => this.modalOverlay.classList.add('hidden');
    this.modalOverlay.querySelector('#btn-close-val-modal')?.addEventListener('click', closeModal);
    this.modalOverlay.querySelector('#btn-modal-done')?.addEventListener('click', closeModal);

    this.modalOverlay.querySelectorAll('.val-list-item[data-comp-id]').forEach((li) => {
      li.addEventListener('click', () => {
        const id = li.dataset.compId;
        this.state.setViewportMode('edit');
        this.state.setLeftTab('layers');
        this.state.selectComponent(id);
        closeModal();
      });
    });
  }

  /** Renders one error/warning message as a list item — clickable and jumps to
   * the offending component when the message names one (see StudioValidator's
   * consistent `Component "<id>" ...` message shape). */
  renderValidationListItem(message) {
    const match = message.match(/Component "([^"]+)"/);
    if (!match) return `<li>${message}</li>`;
    return `<li class="val-list-item" data-comp-id="${match[1]}" title="Click to select this component">${message}</li>`;
  }
}
