/**
 * StudioMenuBar.js
 * Main Action Menu Bar for Flight Deck Widget Studio — spans the full width of the
 * page directly under the top header. Houses primary document actions: New, New
 * Popover, Save, Import, Export, Undo, Redo.
 */

import { StudioValidator } from './StudioValidator.js';
import { STUDIO_TEMPLATES } from './StudioTemplates.js';
import { openModal, confirmModal, showToast } from './StudioModal.js';
import { FDWS_VERSIONS } from '../widgets/PropertyRegistry.js';

const LATEST_FDWS_VERSION = FDWS_VERSIONS[FDWS_VERSIONS.length - 1];

export class StudioMenuBar {
  /**
   * @param {HTMLElement} container
   * @param {import('./StudioState.js').StudioState} state
   */
  constructor(container, state) {
    this.container = container;
    this.state = state;

    this.initDOM();
    this.attachEventListeners();
    this.render();

    this.state.subscribe((changeType) => {
      if (['HISTORY_CHANGE', 'WIDGET_DEF_LOADED', 'WIDGET_SAVED', 'COMPONENT_UPDATED', 'COMPONENT_ADDED', 'COMPONENT_DELETED'].includes(changeType)) {
        this.render();
      }
    });
  }

  initDOM() {
    this.container.innerHTML = '';
    this.container.className = 'studio-menubar-top';

    this.container.innerHTML = `
      <div class="topbar-actions-left">
        <button id="btn-new-widget" class="bar-btn" title="Create New Widget">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          New
        </button>

        <button id="btn-new-popover-widget" class="bar-btn" title="Create New Popover Widget (FDWS v1.3)">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="7" width="18" height="12" rx="2"></rect><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          New Popover
        </button>

        <div class="bar-divider"></div>

        <button id="btn-save-widget" class="bar-btn" title="Save Widget to Local Library">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path><polyline points="17 21 17 13 7 13 7 21"></polyline><polyline points="7 3 7 8 15 8"></polyline></svg>
          Save
        </button>

        <label class="bar-btn file-import-btn" title="Import .json or .fdwidget definition">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
          Import
          <input type="file" id="menu-import-input" accept=".json,.fdwidget" style="display:none;" />
        </label>

        <div class="export-dropdown-wrap">
          <button id="btn-export-dropdown" class="bar-btn primary" title="Export Widget Package">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
            Export ▾
          </button>
          <div id="export-menu" class="export-menu-dropdown export-menu-dropdown-top hidden">
            <button id="btn-export-fdwidget" class="export-item">Export .fdwidget Package</button>
            <button id="btn-export-json" class="export-item">Export JSON Spec</button>
            <button id="btn-export-clipboard" class="export-item">Copy to Clipboard</button>
          </div>
        </div>

        <div class="bar-divider"></div>

        <div class="action-btn-group">
          <button id="btn-undo" class="bar-btn" title="Undo (Ctrl+Z)" disabled>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7v6h6"></path><path d="M21 17a9 9 0 00-9-9 9 9 0 00-6 2.3L3 13"></path></svg>
            Undo
          </button>
          <button id="btn-redo" class="bar-btn" title="Redo (Ctrl+Y)" disabled>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 7v6h-6"></path><path d="M3 17a9 9 0 019-9 9 9 0 016 2.3l3 2.7"></path></svg>
            Redo
          </button>
        </div>
      </div>

      <div class="topbar-actions-right">
        <div id="dirty-status-indicator" class="dirty-pill clean" title="Save status">
          <span class="dirty-dot"></span>
          <span class="dirty-label">Saved</span>
        </div>
      </div>
    `;

    // Global Modal Container (kept here since Import/Export toasts share it)
    this.modalOverlay = document.createElement('div');
    this.modalOverlay.className = 'studio-modal-overlay hidden';
    document.body.appendChild(this.modalOverlay);
  }

  attachEventListeners() {
    // Undo / Redo
    this.container.querySelector('#btn-undo')?.addEventListener('click', () => this.state.undo());
    this.container.querySelector('#btn-redo')?.addEventListener('click', () => this.state.redo());

    // New Widget
    this.container.querySelector('#btn-new-widget')?.addEventListener('click', () => this.promptNewWidget());

    // New Popover Widget (FDWS v1.3)
    this.container.querySelector('#btn-new-popover-widget')?.addEventListener('click', async () => {
      const ok = await confirmModal('Create a new blank popover widget? Unsaved changes to the current widget will be cleared.', { title: 'New Popover Widget' });
      if (ok) {
        this.state.createNewPopoverWidget();
        this.showToast('Created new popover widget.');
      }
    });

    // Save Widget
    this.container.querySelector('#btn-save-widget')?.addEventListener('click', () => {
      const ok = this.state.saveCurrentWidgetToLibrary();
      if (ok) {
        this.showToast(`Saved "${this.state.widgetDef.meta?.name}" (Rev ${this.state.widgetDef.revision}) to local library!`);
      }
    });

    // Import
    const importInput = this.container.querySelector('#menu-import-input');
    importInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) this.handleImportFile(file);
    });

    // Export Dropdown
    const btnExport = this.container.querySelector('#btn-export-dropdown');
    const exportMenu = this.container.querySelector('#export-menu');

    btnExport?.addEventListener('click', (e) => {
      e.stopPropagation();
      exportMenu.classList.toggle('hidden');
    });

    window.addEventListener('click', () => {
      exportMenu?.classList.add('hidden');
    });

    this.container.querySelector('#btn-export-fdwidget')?.addEventListener('click', () => this.confirmExport('fdwidget'));
    this.container.querySelector('#btn-export-json')?.addEventListener('click', () => this.confirmExport('json'));
    this.container.querySelector('#btn-export-clipboard')?.addEventListener('click', () => this.confirmExport('clipboard'));

    // Keyboard Shortcuts (Ctrl+Z, Ctrl+Y, Ctrl+S)
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        if (e.shiftKey) {
          this.state.redo();
        } else {
          this.state.undo();
        }
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        this.state.redo();
        e.preventDefault();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        this.state.saveCurrentWidgetToLibrary();
        this.showToast(`Saved "${this.state.widgetDef.meta?.name}"`);
        e.preventDefault();
      }
    });
  }

  render() {
    const btnUndo = this.container.querySelector('#btn-undo');
    const btnRedo = this.container.querySelector('#btn-redo');

    if (btnUndo) btnUndo.disabled = this.state.undoStack.length === 0;
    if (btnRedo) btnRedo.disabled = this.state.redoStack.length === 0;

    const dirtyInd = this.container.querySelector('#dirty-status-indicator');
    if (dirtyInd) {
      if (this.state.isDirty) {
        dirtyInd.className = 'dirty-pill dirty';
        dirtyInd.querySelector('.dirty-label').textContent = 'Unsaved';
      } else {
        dirtyInd.className = 'dirty-pill clean';
        dirtyInd.querySelector('.dirty-label').textContent = 'Saved';
      }
    }
  }

  async promptNewWidget() {
    const blank = STUDIO_TEMPLATES.find((t) => t.id === 'com.flightdeck.customwidget') || STUDIO_TEMPLATES[0];
    const ok = await confirmModal('Create a new blank widget? Unsaved changes to the current widget will be cleared.', { title: 'New Widget' });
    if (ok) {
      this.state.setWidgetDef(blank, true, 'New Widget');
      this.showToast('Created new widget.');
    }
  }

  async handleImportFile(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      const text = reader.result;
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        await openModal({
          title: 'Import Failed',
          bodyHtml: `<p class="modal-confirm-text">Could not parse "${file.name}" as JSON:</p><div class="modal-error" style="margin:0;">${err.message}</div>`,
          cancelLabel: 'Close',
          onSubmit: () => ({ value: true })
        });
        return;
      }

      const valResult = StudioValidator.validate(parsed);
      if (!valResult.valid) {
        const proceed = await openModal({
          title: 'Import Has Validation Errors',
          bodyHtml: `
            <p class="modal-confirm-text">"${file.name}" has ${valResult.errors.length} FDWS validation error(s):</p>
            <ul class="val-list errors">${valResult.errors.slice(0, 8).map((e) => `<li>${e}</li>`).join('')}</ul>
            <p class="modal-confirm-text">Import anyway in recovery mode?</p>
          `,
          submitLabel: 'Import Anyway'
        });
        if (proceed !== true) return;
      }

      // FDWS v1.19 §1.5: register any bundled popover(s) into the local
      // library before loading the host def, then strip them off — a bundled
      // popover is treated as if it had been imported on its own, not as
      // literal content of the host widget being edited.
      const bundledPopovers = Array.isArray(parsed.popovers) ? parsed.popovers : [];
      if (bundledPopovers.length > 0) {
        this.state.importEmbeddedPopovers(bundledPopovers);
        delete parsed.popovers;
      }

      this.state.setWidgetDef(parsed, true, `Import ${file.name}`);
      const popoverNote = bundledPopovers.length > 0
        ? ` (+ ${bundledPopovers.length} bundled popover${bundledPopovers.length === 1 ? '' : 's'} added to your library)`
        : '';
      this.showToast(`Imported "${parsed.meta?.name || file.name}" successfully!${popoverNote}`);
    };
    reader.readAsText(file);
  }

  /**
   * @param {object} def - a widget definition
   * @returns {string[]} unique popoverWidgetId values referenced anywhere in it
   */
  collectReferencedPopoverIds(def) {
    const ids = new Set();
    (def.components || []).forEach((comp) => {
      (comp.interactions || []).forEach((inter) => {
        if (inter.action?.type === 'core.openWidgetPopover' && inter.action.popoverWidgetId) {
          ids.add(inter.action.popoverWidgetId);
        }
      });
    });
    return [...ids];
  }

  /**
   * FDWS v1.19 §1.5: builds the definition actually exported — a deep clone
   * of the host with every referenced-and-saved popover inlined into a
   * "popovers" array, so the exported file is self-contained. Returns the
   * clone plus which referenced ids couldn't be found in the local library
   * (nothing to bundle for those; same limitation as before this feature).
   * @param {object} def
   * @returns {{exportDef: object, missingIds: string[]}}
   */
  buildBundledExportDef(def) {
    const exportDef = JSON.parse(JSON.stringify(def));
    const popoverIds = this.collectReferencedPopoverIds(exportDef);
    if (popoverIds.length === 0) return { exportDef, missingIds: [] };

    const savedPopovers = this.state.getSavedWidgetsByKind('popover');
    const missingIds = [];
    const popovers = [];
    popoverIds.forEach((id) => {
      const found = savedPopovers.find((w) => w.id === id);
      if (found) popovers.push(JSON.parse(JSON.stringify(found)));
      else missingIds.push(id);
    });
    if (popovers.length > 0) exportDef.popovers = popovers;
    return { exportDef, missingIds };
  }

  /**
   * Gate in front of every export path (file, .fdwidget, clipboard): warns
   * about any referenced-but-unsaved popover (nothing to bundle for it) and
   * asks before proceeding. Silently proceeds straight to the export when
   * there's nothing to warn about, so this adds zero friction to the common
   * case (no popovers, or all of them already saved).
   * @param {'fdwidget'|'json'|'clipboard'} format
   */
  async confirmExport(format) {
    const { exportDef, missingIds } = this.buildBundledExportDef(this.state.widgetDef);

    if (missingIds.length > 0) {
      const proceed = await openModal({
        title: 'This Widget Opens Popovers',
        bodyHtml: `
          <p class="modal-confirm-text">This widget references ${missingIds.length} popover${missingIds.length > 1 ? 's' : ''} via "Open Widget Popover" actions that ${missingIds.length > 1 ? "aren't" : "isn't"} in your saved library, so ${missingIds.length > 1 ? "they" : "it"} can't be bundled into this export:</p>
          <ul class="val-list errors">${missingIds.map((id) => `<li>${id} — NOT FOUND. Save it first, or this widget will fail to open it anywhere it's installed.</li>`).join('')}</ul>
          <p class="modal-confirm-text">Any other referenced popovers that ARE saved will still be bundled automatically.</p>
        `,
        submitLabel: 'Export Anyway',
        cancelLabel: 'Cancel'
      });
      if (!proceed) return;
    }

    if (format === 'clipboard') this.exportClipboard(exportDef);
    else this.exportWidgetFile(format, exportDef);
  }

  exportWidgetFile(format = 'fdwidget', overrideDef = null) {
    const def = overrideDef || this.state.widgetDef;
    StudioValidator.syncCapabilities(def);
    const jsonStr = JSON.stringify(def, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const safeName = (def.meta?.name || def.id || 'widget').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const filename = `${safeName}.v${def.revision || 1}.${format === 'fdwidget' ? 'fdwidget' : 'json'}`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    const popoverNote = def.popovers?.length > 0 ? ` (+ ${def.popovers.length} bundled popover${def.popovers.length === 1 ? '' : 's'})` : '';
    this.showToast(`Exported ${filename}${popoverNote}`);
  }

  exportClipboard(overrideDef = null) {
    const def = overrideDef || this.state.widgetDef;
    StudioValidator.syncCapabilities(def);
    const jsonStr = JSON.stringify(def, null, 2);
    navigator.clipboard?.writeText(jsonStr);
    this.showToast(`Copied full FDWS v${LATEST_FDWS_VERSION} JSON to clipboard!`);
  }

  showToast(message) {
    showToast(message);
  }
}
