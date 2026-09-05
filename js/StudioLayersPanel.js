/**
 * StudioLayersPanel.js
 * Left Sidebar for Flight Deck Widget Studio:
 * - Component Tree & Layer Groups (FDWS v1.2 Z-ordering)
 * - Component Palette (Quick Add)
 * - Local State Manager (state[])
 * - Asset Manager (assets[])
 * - Widget Library & Templates
 */

import { STUDIO_TEMPLATES } from './StudioTemplates.js';
import { openModal, confirmModal, showToast } from './StudioModal.js';
import { StudioValidator, isComponentUnconfigured } from './StudioValidator.js';
import { DECK_EVENT_NAMES, getDeckEventsByKind } from '../core/deckEvents.js';
import { extractCustomDeckEvents } from '../core/widgetVarExtractor.js';
import { loadImportedPacks, removePack, parsePackFile, importPack, buildPackFromCustomEvents } from '../core/deckEventPacks.js';

export class StudioLayersPanel {
  /**
   * @param {HTMLElement} container
   * @param {import('./StudioState.js').StudioState} state
   */
  constructor(container, state) {
    this.container = container;
    this.state = state;
    this.filterText = '';

    this.initDOM();
    this.attachEventListeners();
    this.render();

    this.state.subscribe((changeType) => {
      if (['LEFT_TAB_CHANGED', 'WIDGET_DEF_LOADED', 'COMPONENT_ADDED', 'COMPONENT_DELETED', 'COMPONENT_UPDATED', 'LAYER_GROUPS_UPDATED', 'STATE_VARS_UPDATED', 'ASSETS_UPDATED', 'SELECTION_CHANGED', 'SAVED_WIDGETS_UPDATED', 'HISTORY_CHANGE', 'EDITOR_VISIBILITY_CHANGED', 'LIVE_STATE_VALUE_CHANGED'].includes(changeType)) {
        this.render();
      }
    });
  }

  initDOM() {
    this.container.innerHTML = '';
    this.container.classList.add('studio-left-sidebar');

    // Top Tab Switcher
    const tabHeader = document.createElement('div');
    tabHeader.className = 'sidebar-tab-header';
    tabHeader.innerHTML = `
      <button class="tab-btn active" data-tab="layers" title="Component Tree & Layer Groups">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 2 7 12 12 22 7 12 2"></polygon><polyline points="2 17 12 22 22 17"></polyline><polyline points="2 12 12 17 22 12"></polyline></svg>
        <span>Layers</span>
      </button>
      <button class="tab-btn" data-tab="palette" title="Component Palette">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="14" y="14" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
        <span>Palette</span>
      </button>
      <button class="tab-btn" data-tab="state" title="Local State Variables">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>
        <span>State</span>
      </button>
      <button class="tab-btn" data-tab="assets" title="Asset Table & Textures">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
        <span>Assets</span>
      </button>
      <button class="tab-btn" data-tab="templates" title="Widget Templates & Library">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
        <span>Library</span>
      </button>
    `;
    this.container.appendChild(tabHeader);

    // Tab Content Area
    this.contentArea = document.createElement('div');
    this.contentArea.className = 'sidebar-tab-content';
    this.container.appendChild(this.contentArea);
  }

  attachEventListeners() {
    this.container.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        this.state.setLeftTab(tab);
      });
    });
  }

  render() {
    const currentTab = this.state.leftTab || 'layers';

    // Update active tab buttons
    this.container.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === currentTab);
    });

    this.contentArea.innerHTML = '';

    switch (currentTab) {
      case 'layers':
        this.renderLayersTab();
        break;
      case 'palette':
        this.renderPaletteTab();
        break;
      case 'state':
        this.renderStateTab();
        break;
      case 'assets':
        this.renderAssetsTab();
        break;
      case 'templates':
        this.renderTemplatesTab();
        break;
      default:
        this.renderLayersTab();
    }
  }

  // --- 1. LAYERS & COMPONENT TREE TAB ---
  renderLayersTab() {
    const def = this.state.widgetDef;
    const layerGroups = def.layerGroups || [];
    const components = def.components || [];

    const header = document.createElement('div');
    header.className = 'panel-section-header';
    header.innerHTML = `
      <div class="header-title-group">
        <span class="panel-title">COMPONENTS (${components.length})</span>
      </div>
      <div class="header-actions">
        <button id="btn-add-layer-group" class="panel-mini-btn" title="Add Layer Group (FDWS v1.2)">+ Group</button>
      </div>
    `;
    this.contentArea.appendChild(header);

    header.querySelector('#btn-add-layer-group')?.addEventListener('click', () => {
      this.promptAddLayerGroup();
    });

    // Search bar
    const searchWrap = document.createElement('div');
    searchWrap.className = 'tree-search-wrap';
    searchWrap.innerHTML = `
      <input type="text" id="tree-search-input" class="tree-search-input" placeholder="Filter components..." value="${this.filterText}" />
    `;
    this.contentArea.appendChild(searchWrap);
    searchWrap.querySelector('#tree-search-input')?.addEventListener('input', (e) => {
      this.filterText = e.target.value.toLowerCase();
      this.renderLayersList();
    });

    const treeContainer = document.createElement('div');
    treeContainer.id = 'layers-tree-container';
    treeContainer.className = 'layers-tree-list';
    this.contentArea.appendChild(treeContainer);

    this.renderLayersList();
  }

  renderLayersList() {
    const treeContainer = this.contentArea.querySelector('#layers-tree-container');
    if (!treeContainer) return;
    treeContainer.innerHTML = '';

    const def = this.state.widgetDef;
    const layerGroups = def.layerGroups || [];
    const components = def.components || [];

    const layerGroupsMap = new Map();
    layerGroups.forEach((lg) => layerGroupsMap.set(lg.id, lg.z || 0));

    this.issuesByComponent = StudioValidator.mapIssuesByComponent(StudioValidator.validate(def));

    // Calculate effective Z for all components
    const decoratedComps = components.map((comp) => {
      const groupZ = comp.layer?.group ? (layerGroupsMap.get(comp.layer.group) ?? 0) : 0;
      const compZ = comp.layer?.z ?? 0;
      return { comp, effectiveZ: groupZ + compZ };
    });

    // Filter components if search query, then sort descending by effective
    // Z — highest layer (drawn on top) listed first, matching how an author
    // reasons about stacking ("what's covering what") rather than raw
    // authoring/array order.
    const filteredComps = decoratedComps
      .filter(({ comp }) => {
        if (!this.filterText) return true;
        const str = `${comp.id} ${comp.label || ''} ${comp.type}`.toLowerCase();
        return str.includes(this.filterText);
      })
      .sort((a, b) => b.effectiveZ - a.effectiveZ);

    // Group items by layer group
    if (layerGroups.length > 0) {
      // Groups themselves also list highest-Z first — sorting only the
      // components *within* each group (above) still left the group cards
      // in raw authoring order across groups, which isn't what "highest
      // layer listed first" means for the panel as a whole.
      [...layerGroups].sort((a, b) => (b.z ?? 0) - (a.z ?? 0)).forEach((group) => {
        const groupFolder = document.createElement('div');
        groupFolder.className = 'layer-group-card';
        groupFolder.dataset.groupId = group.id;

        const isGroupSelected = this.state.selectedLayerGroupId === group.id;
        if (isGroupSelected) groupFolder.classList.add('selected-group');
        const isGroupHidden = this.state.hiddenLayerGroupIds.has(group.id);
        if (isGroupHidden) groupFolder.classList.add('editor-hidden');

        groupFolder.innerHTML = `
          <div class="layer-group-header" draggable="true" title="Drag to reorder — reordering reassigns Z-offsets automatically">
            <span class="group-drag-handle">⠿</span>
            <div class="group-title-left">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
              <span class="group-name">${group.id}</span>
              <span class="group-z-tag">Z: ${group.z ?? 0}</span>
            </div>
            <div class="group-actions">
              <button class="btn-group-hide ${isGroupHidden ? 'active' : ''}" title="${isGroupHidden ? 'Show in editor (Device View/export are unaffected either way)' : 'Hide in editor (Device View/export are unaffected either way)'}">${isGroupHidden ? '⦸' : '👁'}</button>
              <button class="btn-group-edit" title="Edit Group Z-offset">✎</button>
              <button class="btn-group-del" title="Delete Group">✕</button>
            </div>
          </div>
          <div class="group-children-list"></div>
        `;

        groupFolder.querySelector('.layer-group-header')?.addEventListener('click', (e) => {
          if (e.target.closest('button')) return;
          this.state.selectLayerGroup(group.id);
        });

        this.wireGroupDragReorder(groupFolder, group.id);

        groupFolder.querySelector('.btn-group-hide')?.addEventListener('click', (e) => {
          e.stopPropagation();
          this.state.toggleLayerGroupHiddenInEditor(group.id);
        });

        groupFolder.querySelector('.btn-group-edit')?.addEventListener('click', () => {
          this.promptEditLayerGroup(group);
        });

        groupFolder.querySelector('.btn-group-del')?.addEventListener('click', async () => {
          const ok = await confirmModal(`Delete layer group "${group.id}"? Components in this group will become ungrouped.`, { title: 'Delete Layer Group', danger: true });
          if (ok) this.state.deleteLayerGroup(group.id);
        });

        const childrenList = groupFolder.querySelector('.group-children-list');
        const inThisGroup = filteredComps.filter(({ comp }) => comp.layer?.group === group.id);

        if (inThisGroup.length === 0) {
          childrenList.innerHTML = `<div class="empty-group-note">No components in group</div>`;
        } else {
          inThisGroup.forEach(({ comp, effectiveZ }) => {
            childrenList.appendChild(this.buildComponentTreeRow(comp, effectiveZ));
          });
        }

        treeContainer.appendChild(groupFolder);
      });

      // Ungrouped section
      const ungrouped = filteredComps.filter(({ comp }) => !comp.layer?.group || !layerGroupsMap.has(comp.layer.group));
      if (ungrouped.length > 0) {
        const ungroupedCard = document.createElement('div');
        ungroupedCard.className = 'layer-group-card ungrouped';
        ungroupedCard.innerHTML = `
          <div class="layer-group-header ungrouped-hdr">
            <span class="group-name">Ungrouped Components</span>
          </div>
          <div class="group-children-list"></div>
        `;
        const childrenList = ungroupedCard.querySelector('.group-children-list');
        ungrouped.forEach(({ comp, effectiveZ }) => {
          childrenList.appendChild(this.buildComponentTreeRow(comp, effectiveZ));
        });
        treeContainer.appendChild(ungroupedCard);
      }
    } else {
      // Flat list
      if (filteredComps.length === 0) {
        treeContainer.innerHTML = `<div class="empty-tree-notice">No components in widget.<br>Add components from the Palette tab.</div>`;
      } else {
        filteredComps.forEach(({ comp, effectiveZ }) => {
          treeContainer.appendChild(this.buildComponentTreeRow(comp, effectiveZ));
        });
      }
    }
  }

  buildComponentTreeRow(comp, effectiveZ) {
    const row = document.createElement('div');
    row.className = 'tree-component-row';
    const isSelected = this.state.selectedComponentId === comp.id;
    if (isSelected) row.classList.add('selected');
    const isHidden = this.state.hiddenInEditorIds.has(comp.id);
    if (isHidden) row.classList.add('editor-hidden');
    // Wave 3, Part 7 item 3 (V15): mirrors StudioCanvas.js's dashed
    // "not connected" cue, same isComponentUnconfigured() check.
    const unconfigured = isComponentUnconfigured(comp);
    if (unconfigured) row.classList.add('unconfigured');

    const pointerEvents = comp.layer?.pointerEvents || 'auto';
    const typeShort = comp.type.replace('core.', '');
    const issues = this.issuesByComponent?.get(comp.id);
    const severity = issues ? (issues.errors.length > 0 ? 'error' : 'warning') : null;

    row.innerHTML = `
      <div class="tree-comp-main">
        <span class="comp-type-badge">${typeShort}</span>
        <span class="comp-name" title="${comp.id}">${comp.label || comp.id}</span>
        ${severity ? `<span class="tree-validation-badge ${severity}" title="${[...issues.errors, ...issues.warnings].join('\n').replace(/"/g, '&quot;')}">${severity === 'error' ? '!' : '?'}</span>` : ''}
        ${unconfigured ? '<span class="tree-unconfigured-badge" title="No binding or interaction wired yet.">⋯</span>' : ''}
      </div>
      <div class="tree-comp-meta">
        <span class="z-badge" title="Effective Z-index">Z:${effectiveZ}</span>
        <button class="tree-action-btn btn-hide ${isHidden ? 'active' : ''}" title="${isHidden ? 'Show in editor (Device View/export are unaffected either way)' : 'Hide in editor (Device View/export are unaffected either way)'}">${isHidden ? '⦸' : '👁'}</button>
        <button class="tree-action-btn btn-dup" title="Duplicate Component">⧉</button>
        <button class="tree-action-btn btn-del" title="Delete Component">✕</button>
      </div>
    `;

    row.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      this.state.selectComponent(comp.id);
    });

    row.querySelector('.btn-hide')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.state.toggleComponentHiddenInEditor(comp.id);
    });

    row.querySelector('.btn-dup')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.state.duplicateComponent(comp.id);
    });

    row.querySelector('.btn-del')?.addEventListener('click', (e) => {
      e.stopPropagation();
      this.state.deleteComponent(comp.id);
    });

    return row;
  }

  async promptAddLayerGroup() {
    const result = await openModal({
      title: 'Add Layer Group',
      bodyHtml: `
        <div class="modal-form-row">
          <label>Layer Group ID</label>
          <input type="text" id="lg-id" class="prop-input" placeholder="e.g. background, artwork, controls, overlays" />
        </div>
        <div class="modal-form-row">
          <label>Base Z-Offset (-1000 to 1000)</label>
          <input type="number" id="lg-z" class="prop-input" value="100" min="-1000" max="1000" />
        </div>
      `,
      onSubmit: (card) => {
        const raw = card.querySelector('#lg-id').value.trim();
        if (!raw) return { error: 'A layer group ID is required.' };
        const cleanId = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '');
        if (!cleanId) return { error: 'ID must contain at least one letter, digit, "_" or "-".' };
        if (this.state.widgetDef.layerGroups?.some((g) => g.id === cleanId)) {
          return { error: `Layer group "${cleanId}" already exists.` };
        }
        const zVal = parseInt(card.querySelector('#lg-z').value, 10) || 0;
        return { value: { id: cleanId, z: Math.max(-1000, Math.min(1000, zVal)), locked: false } };
      }
    });
    if (result) this.state.addLayerGroup(result);
  }

  async promptEditLayerGroup(group) {
    const result = await openModal({
      title: `Edit Layer Group "${group.id}"`,
      bodyHtml: `
        <div class="modal-form-row">
          <label>Base Z-Offset (-1000 to 1000)</label>
          <input type="number" id="lg-z" class="prop-input" value="${group.z ?? 0}" min="-1000" max="1000" />
        </div>
      `,
      onSubmit: (card) => {
        const zVal = parseInt(card.querySelector('#lg-z').value, 10);
        if (isNaN(zVal)) return { error: 'Enter a valid integer.' };
        return { value: Math.max(-1000, Math.min(1000, zVal)) };
      }
    });
    if (result !== null && result !== undefined) this.state.updateLayerGroup(group.id, { z: result });
  }

  /**
   * Native HTML5 drag-and-drop reordering for a layer group card — replaces
   * hand-tuning each group's numeric Z-offset to change stacking order.
   * Dropping reassigns every group's z to its new index × 100 via
   * state.reorderLayerGroups().
   */
  wireGroupDragReorder(groupFolder, groupId) {
    const header = groupFolder.querySelector('.layer-group-header');
    header.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', groupId);
      e.dataTransfer.effectAllowed = 'move';
      groupFolder.classList.add('dragging-group');
    });
    header.addEventListener('dragend', () => {
      groupFolder.classList.remove('dragging-group');
      this.contentArea.querySelectorAll('.layer-group-card').forEach((el) => el.classList.remove('drop-target-above', 'drop-target-below'));
    });
    header.addEventListener('dragover', (e) => {
      e.preventDefault();
      const rect = groupFolder.getBoundingClientRect();
      const isAbove = e.clientY < rect.top + rect.height / 2;
      groupFolder.classList.toggle('drop-target-above', isAbove);
      groupFolder.classList.toggle('drop-target-below', !isAbove);
    });
    header.addEventListener('dragleave', () => {
      groupFolder.classList.remove('drop-target-above', 'drop-target-below');
    });
    header.addEventListener('drop', (e) => {
      e.preventDefault();
      const draggedId = e.dataTransfer.getData('text/plain');
      groupFolder.classList.remove('drop-target-above', 'drop-target-below');
      if (!draggedId || draggedId === groupId) return;

      const currentOrder = (this.state.widgetDef.layerGroups || []).map((g) => g.id);
      const fromIdx = currentOrder.indexOf(draggedId);
      if (fromIdx === -1) return;
      currentOrder.splice(fromIdx, 1);

      const rect = groupFolder.getBoundingClientRect();
      const isAbove = e.clientY < rect.top + rect.height / 2;
      let toIdx = currentOrder.indexOf(groupId);
      if (!isAbove) toIdx += 1;
      currentOrder.splice(toIdx, 0, draggedId);

      this.state.reorderLayerGroups(currentOrder);
    });
  }

  // --- 2. COMPONENT PALETTE TAB ---
  renderPaletteTab() {
    const header = document.createElement('div');
    header.className = 'panel-section-header';
    header.innerHTML = `<span class="panel-title">ADD COMPONENTS</span>`;
    this.contentArea.appendChild(header);

    const searchBox = document.createElement('input');
    searchBox.type = 'text';
    searchBox.className = 'tree-search-input';
    searchBox.placeholder = 'Filter components...';
    searchBox.value = this.paletteFilterText || '';
    this.contentArea.appendChild(searchBox);

    const listMount = document.createElement('div');
    this.contentArea.appendChild(listMount);

    searchBox.addEventListener('input', (e) => {
      this.paletteFilterText = e.target.value;
      this.renderPaletteList(listMount);
    });

    this.renderPaletteList(listMount);
  }

  renderPaletteList(listMount) {
    listMount.innerHTML = '';
    const items = [
      {
        type: 'core.label',
        title: 'Label',
        desc: 'Static or dynamic bound avionics text title',
        category: 'Text & Display',
        icon: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
        defaultProps: { text: 'NAV 1', align: 'left' },
        defaultLayout: { col: 1, row: 1, w: 6, h: 1 }
      },
      {
        // Wave 3, Part 7 item 2 (V15): used to arrive pre-bound to
        // com1ActFreq/FREQ_COM/"ACT"/"MHz" — a real SimVar that has nothing to
        // do with the author's actual intent, propagating as silent junk
        // through Duplicate. Now arrives neutral: no binding, a generic format.
        type: 'core.display',
        title: 'Display Box',
        desc: 'Formatted numeric / frequency readout value box',
        category: 'Text & Display',
        icon: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M7 10h4v4H7z"/>',
        defaultProps: { format: 'RAW_INT' },
        defaultLayout: { col: 1, row: 2, w: 6, h: 3 }
      },
      {
        type: 'core.indicator',
        title: 'Annunciator LED',
        desc: 'Advisory, caution, warning or status indicator tile',
        category: 'Text & Display',
        icon: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/>',
        defaultProps: { shape: 'tile', severity: 'warning', label: 'WARN' },
        defaultBinding: { readSimVar: 'master_warning' },
        defaultLayout: { col: 1, row: 1, w: 4, h: 2 }
      },
      {
        type: 'core.divider',
        title: 'Divider Line (v1.17)',
        desc: 'Grid-snapped horizontal or vertical separator line',
        category: 'Text & Display',
        icon: '<line x1="3" y1="12" x2="21" y2="12"/>',
        defaultProps: { orientation: 'horizontal' },
        defaultStyle: { border: { width: 2, color: '#333c4a', style: 'solid' } },
        defaultLayout: { col: 1, row: 1, w: 8, h: 1 }
      },
      {
        type: 'core.image',
        title: 'Image / Placard',
        desc: 'Background artwork, hardware texture, or placard photo',
        category: 'Text & Display',
        icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
        defaultProps: { fit: 'cover' },
        defaultLayout: { col: 1, row: 1, w: 12, h: 6 }
      },
      {
        // Wave 3, Part 7 item 2 (V15): used to arrive pre-wired to a live
        // dispatchEvent CUSTOM_EVENT interaction — a generic, collision-prone
        // placeholder that looks wired but isn't wired to anything the author
        // meant. Marcus's four preset buttons all ended up non-functional this
        // way after Duplicate. Now arrives with no interaction at all.
        type: 'core.button',
        title: 'Button Control',
        desc: 'Momentary, toggle, swap, or preset push-button',
        category: 'Buttons & Inputs',
        icon: '<rect x="3" y="3" width="18" height="18" rx="4"/><path d="M12 8v8M8 12h8"/>',
        defaultProps: { variant: 'momentary', label: 'ACTIVATE' },
        defaultLayout: { col: 1, row: 1, w: 4, h: 2 }
      },
      {
        type: 'core.input',
        title: 'Editable Input',
        desc: 'Direct frequency, squawk or target input field',
        category: 'Buttons & Inputs',
        icon: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
        defaultProps: { format: 'FREQ_COM', placeholder: '121.500' },
        defaultBinding: { readSimVar: 'com1StbyFreq', writeEvent: 'com1StbySet' },
        defaultLayout: { col: 7, row: 2, w: 6, h: 3 }
      },
      {
        type: 'core.stepper',
        title: 'Stepper Control',
        desc: '+ / − increment control for altitude, heading, or speed',
        category: 'Buttons & Inputs',
        icon: '<rect x="2" y="6" width="20" height="12" rx="2"/><line x1="7" y1="12" x2="11" y2="12"/><line x1="15" y1="12" x2="19" y2="12"/><line x1="17" y1="10" x2="17" y2="14"/>',
        defaultProps: { step: 100, min: 0, max: 50000 },
        defaultBinding: { readSimVar: 'apAltBugValue', writeEvent: 'apAltSet' },
        defaultLayout: { col: 1, row: 1, w: 4, h: 2 }
      },
      {
        type: 'core.pad',
        title: 'Touch Pad (v1.2)',
        desc: '2D touch surface for map pan/zoom or absolute cursor placement',
        category: 'Buttons & Inputs',
        icon: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="2"/>',
        defaultProps: { mode: 'relative', sensitivity: 1.0 },
        defaultLayout: { col: 1, row: 1, w: 20, h: 20 }
      },
      {
        type: 'core.gauge',
        title: 'Gauge (v1.2)',
        desc: 'Display-only needle/bar/arc driven by a bound value transform',
        category: 'Avionics Controls',
        icon: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="12" x2="17" y2="8"/>',
        defaultProps: { transform: 'rotate', valueRange: [0, 400], outputRange: [-25, 230], clamp: true },
        defaultBinding: { readSimVar: 'airspeed_indicated', deadband: 0.5 },
        defaultLayout: { col: 1, row: 1, w: 8, h: 8 }
      },
      {
        type: 'core.tape',
        title: 'Scrolling Tape (v1.20)',
        desc: 'Continuously-scrolling ruler with tick marks/labels driven by a bound value — airspeed/altitude tapes',
        category: 'Avionics Controls',
        icon: '<rect x="3" y="2" width="10" height="20" rx="1"/><line x1="16" y1="12" x2="22" y2="12"/><line x1="6" y1="6" x2="10" y2="6"/><line x1="6" y1="12" x2="10" y2="12"/><line x1="6" y1="18" x2="10" y2="18"/>',
        defaultProps: { axis: 'y', tickInterval: 10, majorEvery: 5, pxPerUnit: 3, decimals: 0 },
        defaultBinding: { readSimVar: 'airspeed_indicated', deadband: 0.5 },
        defaultLayout: { col: 1, row: 1, w: 6, h: 20 }
      },
      {
        type: 'core.slider',
        title: 'Slider (v1.2)',
        desc: 'Absolute-position lever with optional detents (throttle, mixture, flaps)',
        category: 'Avionics Controls',
        icon: '<rect x="9" y="2" width="6" height="20" rx="2"/><rect x="6" y="9" width="12" height="6" rx="1"/>',
        defaultProps: { axis: 'y', min: 0, max: 100, detents: [{ value: 0, label: 'IDLE', snap: true, snapTolerance: 3 }] },
        defaultBinding: { writeEvent: 'THROTTLE1_SET' },
        defaultLayout: { col: 1, row: 1, w: 3, h: 10 }
      },
      {
        type: 'core.selector',
        title: 'Selector (v1.2)',
        desc: 'Discrete multi-position rotary or lever switch (fuel selector, mag switch)',
        category: 'Avionics Controls',
        icon: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="5" r="1.5"/><circle cx="19" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/><circle cx="5" cy="12" r="1.5"/>',
        defaultProps: {
          mode: 'rotary',
          positions: [
            { value: 'OFF', label: 'OFF', angle: 0 },
            { value: 'LEFT', label: 'L', angle: 90 },
            { value: 'BOTH', label: 'BOTH', angle: 180 },
            { value: 'RIGHT', label: 'R', angle: 270 }
          ]
        },
        defaultBinding: { writeEvent: 'FUEL_SELECTOR_SET', stateVar: 'fuelSelectorPos' },
        defaultLayout: { col: 1, row: 1, w: 6, h: 6 }
      },
      {
        type: 'core.rocker',
        title: 'Rocker (v1.2)',
        desc: 'Spring-loaded 2-zone momentary rocker (elevator trim, incremental flaps)',
        category: 'Avionics Controls',
        icon: '<rect x="4" y="4" width="16" height="16" rx="3"/><line x1="12" y1="4" x2="12" y2="20"/>',
        defaultProps: {
          axis: 'y',
          zones: [
            { id: 'nose_down', label: '▼', writeEvent: 'ELEV_TRIM_DN', repeatRate: 100 },
            { id: 'nose_up', label: '▲', writeEvent: 'ELEV_TRIM_UP', repeatRate: 100 }
          ],
          springReturn: true
        },
        defaultLayout: { col: 1, row: 1, w: 4, h: 8 }
      },
      {
        type: 'core.rotary',
        title: 'Rotary Dial',
        desc: 'Dual coarse/fine rotary dial knob with center push. Note: the runtime rotary does not dispatch write events on its own — pair it with an interaction or use core.stepper for a control that writes.',
        category: 'Avionics Controls',
        icon: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="12" x2="12" y2="6"/><circle cx="12" cy="12" r="2"/>',
        defaultProps: { coarseStep: 10, fineStep: 1, circular: true },
        defaultBinding: { readSimVar: 'apHdgBugValue', writeEvent: 'apHdgSet' },
        defaultLayout: { col: 1, row: 1, w: 4, h: 4 }
      },
      {
        type: 'core.list',
        title: 'List (v1.2)',
        desc: 'Scrollable repeater for array-length data (flight plan legs, CAS queue)',
        category: 'Data & Composition',
        icon: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/>',
        defaultProps: { itemsBinding: { stateVar: 'flightPlanLegs' }, maxVisible: 6, scrollable: true, itemTemplate: { components: [] } },
        defaultLayout: { col: 1, row: 1, w: 12, h: 20 }
      },
      {
        type: 'core.ref',
        title: 'Reference (v1.2)',
        desc: 'References a packaged component-library instead of inlining structure',
        category: 'Data & Composition',
        icon: '<circle cx="12" cy="12" r="9"/><path d="M9 12h6M12 9v6"/>',
        defaultProps: { libraryId: 'com.example.componentlibrary' },
        defaultLayout: { col: 1, row: 1, w: 8, h: 10 }
      }
    ];

    const filter = (this.paletteFilterText || '').trim().toLowerCase();
    const matches = (item) => !filter || item.title.toLowerCase().includes(filter) || item.desc.toLowerCase().includes(filter) || item.category.toLowerCase().includes(filter) || item.type.toLowerCase().includes(filter);

    const categories = [...new Set(items.map((i) => i.category))];
    categories.forEach((cat) => {
      const catItems = items.filter((i) => i.category === cat && matches(i));
      if (catItems.length === 0) return;

      const catHeader = document.createElement('div');
      catHeader.className = 'palette-category-label';
      catHeader.textContent = cat;
      listMount.appendChild(catHeader);

      const paletteList = document.createElement('div');
      paletteList.className = 'palette-grid';

      catItems.forEach((item) => {
        const card = document.createElement('div');
        card.className = 'palette-item-card';
        card.innerHTML = `
          <div class="palette-icon-box">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${item.icon}</svg>
          </div>
          <div class="palette-item-text">
            <div class="palette-item-title">${item.title}</div>
            <div class="palette-item-desc">${item.desc}</div>
          </div>
        `;

        card.addEventListener('click', () => {
          this.addComponentFromPalette(item);
        });

        paletteList.appendChild(card);
      });

      listMount.appendChild(paletteList);
    });

    if (filter && categories.every((cat) => items.filter((i) => i.category === cat && matches(i)).length === 0)) {
      const empty = document.createElement('div');
      empty.className = 'empty-tree-notice';
      empty.textContent = `No components match "${this.paletteFilterText}".`;
      listMount.appendChild(empty);
    }
  }

  addComponentFromPalette(template) {
    const def = this.state.widgetDef;
    const maxCols = def.layout?.grid?.columns || 12;
    const maxRows = def.layout?.grid?.rows || 6;

    // Find next available empty position
    let targetCol = 1;
    let targetRow = 1;
    const compW = Math.min(maxCols, template.defaultLayout.w);
    const compH = Math.min(maxRows, template.defaultLayout.h);

    const compCount = def.components?.length || 0;
    targetRow = Math.min(maxRows - compH + 1, 1 + (compCount % 3) * 2);

    const newComponent = {
      id: `${template.type.replace('core.', '')}_${Date.now().toString(36).slice(-3)}`,
      type: template.type,
      label: template.title,
      layout: { col: targetCol, row: targetRow, w: compW, h: compH },
      layer: { z: 0, group: def.layerGroups?.[0]?.id || null, pointerEvents: 'auto', clipToBounds: false },
      props: { ...(template.defaultProps || {}) },
      // A template can override the usual "every new component starts with
      // themed typography" default — core.divider has no text, so a
      // typography block is meaningless; it wants Border (its line's
      // thickness/color/style) prefilled instead. Every other palette entry
      // omits defaultStyle and gets the same typography default as before.
      style: template.defaultStyle ? { ...template.defaultStyle } : {
        typography: { font: 'Chakra Petch', size: 13, weight: 700, color: 'var(--text-white, #ffffff)' }
      },
      binding: template.defaultBinding ? { ...template.defaultBinding } : {},
      interactions: template.defaultInteractions ? JSON.parse(JSON.stringify(template.defaultInteractions)) : []
    };

    this.state.addComponent(newComponent);
    this.state.setLeftTab('layers');
  }

  // --- 3. LOCAL STATE TAB ---
  /**
   * State-tab "Current:" value — `StudioState.liveStateValues` is fed by
   * StudioDeviceView's mock host (MockWidgetHost.js's onLocalStateChange
   * callback) whenever an interaction in Device View changes a local state
   * var, plus an initial seed at mount so this shows something before the
   * first tap too. "—" before Device View has ever been opened for this
   * widget (the map is empty then, not just missing this one name).
   * @param {string} name
   * @returns {string}
   */
  formatLiveStateValue(name) {
    if (!this.state.liveStateValues.has(name)) return '—';
    const val = this.state.liveStateValues.get(name);
    return typeof val === 'object' ? JSON.stringify(val) : String(val);
  }

  renderStateTab() {
    const stateList = this.state.widgetDef.state || [];

    const header = document.createElement('div');
    header.className = 'panel-section-header';
    header.innerHTML = `
      <span class="panel-title">LOCAL STATE (${stateList.length})</span>
      <button id="btn-add-state-var" class="panel-mini-btn">+ State Var</button>
    `;
    this.contentArea.appendChild(header);

    header.querySelector('#btn-add-state-var')?.addEventListener('click', () => {
      this.promptAddStateVar();
    });

    const listWrap = document.createElement('div');
    listWrap.className = 'state-vars-list';

    if (stateList.length === 0) {
      listWrap.innerHTML = `<div class="empty-tree-notice">No local state variables.<br>Add variables for non-telemetry storage (e.g. activeFreq, switchOn, presets).</div>`;
    } else {
      stateList.forEach((st) => {
        const card = document.createElement('div');
        card.className = 'state-var-card';
        const isFastPoll = Number(st.pollFrequencyHz) > 2;
        card.innerHTML = `
          <div class="state-var-header">
            <span class="state-var-name">${st.name}</span>
            <span class="state-var-type">${st.type}</span>
          </div>
          <div class="state-var-body">
            <div class="state-var-prop">Default: <strong>${typeof st.default === 'object' ? JSON.stringify(st.default) : st.default}</strong></div>
            <div class="state-var-prop state-var-current" title="Live value — updates as you interact with the widget in Device View">Current: <strong>${this.formatLiveStateValue(st.name)}</strong></div>
            ${st.persist === true ? '<div class="state-var-tag persist">PERSISTENT</div>' : ''}
            ${st.persist === 'session' ? '<div class="state-var-tag persist" title="Survives switching pages within the running app, but resets the next time the app is launched fresh — never written to device storage.">SESSION ONLY</div>' : ''}
            ${st.syncFrom ? `<div class="state-var-tag sync">Sync: ${st.syncFrom}</div>` : ''}
            ${st.syncFrom && isFastPoll ? '<div class="state-var-tag sync">FAST POLL</div>' : ''}
          </div>
          <div class="state-var-actions">
            <button class="btn-st-edit" title="Edit State Variable">✎</button>
            <button class="btn-st-del" title="Delete State Variable">✕</button>
          </div>
        `;

        card.querySelector('.btn-st-edit')?.addEventListener('click', () => {
          this.promptAddStateVar(st);
        });

        card.querySelector('.btn-st-del')?.addEventListener('click', async () => {
          const ok = await confirmModal(`Delete state variable "${st.name}"?`, { title: 'Delete State Variable', danger: true });
          if (ok) this.state.deleteStateVar(st.name);
        });

        listWrap.appendChild(card);
      });
    }

    this.contentArea.appendChild(listWrap);
  }

  /**
   * Add/Edit State Variable modal. Pass an existing state[] entry to edit it
   * in place (via `updateStateVar`); omit it to create a new one. Previously
   * only exposed `name`/`type`/`default` — `type` also offered a non-standard
   * `"list"` value that FDWS's Appendix A schema doesn't define (the real
   * enum is `string`/`number`/`boolean`/`array`, per FDWS v1.2 §3.2) — and had
   * no way to author `syncFrom` (a state var could never actually be wired to
   * live telemetry from the UI at all), `persist`, `deadband`, or
   * `pollFrequencyHz` (FDWS v1.7 — needed on the state entry itself for any
   * value a `core.gauge.props.compose` secondary transform reads, since
   * `compose.stateVar` is a state sync, not a live component binding).
   */
  async promptAddStateVar(existing = null) {
    const isEdit = !!existing;
    const TYPES = ['string', 'number', 'boolean', 'array'];
    const defaultForType = { string: '108.00', number: '0', boolean: 'false', array: '[]' };
    const readEvents = getDeckEventsByKind('read');
    const CUSTOM = '__custom__';

    const initial = existing || { name: '', type: 'string', default: defaultForType.string, persist: false, syncFrom: '', deadband: 0, pollFrequencyHz: 1 };
    const syncIsCustom = !!initial.syncFrom && !readEvents.some((e) => e.name === initial.syncFrom);
    const isFastPoll = Number(initial.pollFrequencyHz) > 2;

    // Structured "Array Items" builder — replaces having to hand-type a raw
    // JSON array into a text box for type:"array" defaults (e.g. a `presets`
    // array of {label, freq} objects). Each item is either a plain
    // scalar ("text item") or a set of editable key/value pairs
    // ("object item"); `arrayItems` is the single source of truth, kept in
    // sync with the JSON fallback textarea below for shapes this simple
    // row/field grid can't represent (nested arrays, etc).
    let arrayItems = Array.isArray(initial.default) ? JSON.parse(JSON.stringify(initial.default)) : [];
    const escAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
    const displayVal = (v) => (v !== null && typeof v === 'object') ? JSON.stringify(v) : v;
    // Reads a JSON-looking value back to its real type (number/bool/object/array),
    // falling back to the raw string for plain text — so "118.700" round-trips as
    // a string (leading-zero frequencies shouldn't become numbers) while a typed
    // "{\"a\":1}" or "[1,2]" round-trips as real JSON.
    const parseFieldVal = (raw) => {
      const trimmed = raw.trim();
      if (trimmed === '') return '';
      if (/^[[{]/.test(trimmed)) {
        try { return JSON.parse(trimmed); } catch { /* fall through */ }
      }
      return raw;
    };
    // Authoritative read of the array builder's current DOM state, used at
    // submit time so an unblurred/uncommitted edit (change hasn't fired yet)
    // is never silently dropped.
    const readArrayItemsFromDom = (card) => {
      const mount = card.querySelector('#sv-array-items');
      const rows = mount ? [...mount.querySelectorAll('[data-item-idx]')] : [];
      return rows.map((rowEl) => {
        const valInput = rowEl.querySelector('.array-item-value');
        if (valInput) return parseFieldVal(valInput.value);
        const obj = {};
        rowEl.querySelectorAll('.array-field-pair').forEach((pair) => {
          const key = pair.querySelector('.array-field-key').value.trim();
          const val = pair.querySelector('.array-field-val').value;
          if (key) obj[key] = parseFieldVal(val);
        });
        return obj;
      });
    };

    const result = await openModal({
      title: isEdit ? `Edit State Variable "${existing.name}"` : 'Add State Variable',
      wide: true,
      bodyHtml: `
        <div class="modal-form-row">
          <label>Name</label>
          <input type="text" id="sv-name" class="prop-input" value="${initial.name}" placeholder="e.g. stbyFreq, switchOn, presets" ${isEdit ? 'readonly' : ''} />
        </div>
        <div class="modal-form-row">
          <label>Type</label>
          <select id="sv-type" class="prop-select">${TYPES.map((t) => `<option value="${t}" ${initial.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
        </div>
        <div class="modal-form-row" id="sv-default-scalar-row" ${initial.type === 'array' ? 'hidden' : ''}>
          <label>Default Value</label>
          <input type="text" id="sv-default" class="prop-input" value="${typeof initial.default === 'object' ? JSON.stringify(initial.default) : initial.default}" />
        </div>
        <div class="modal-form-row" id="sv-array-editor" ${initial.type === 'array' ? '' : 'hidden'}>
          <label>Default Array Items</label>
          <div id="sv-array-items"></div>
          <div style="display:flex;gap:8px;margin-top:6px;">
            <button type="button" id="sv-array-add-text" class="bar-btn row-add">+ Add Text Item</button>
            <button type="button" id="sv-array-add-object" class="bar-btn row-add">+ Add Object Item</button>
          </div>
          <button type="button" id="sv-array-json-toggle" class="panel-full-btn" style="margin-top:8px;">▸ Advanced: Edit as JSON</button>
          <div id="sv-array-json-block" class="hidden" style="margin-top:6px;">
            <textarea id="sv-array-json" class="prop-input" rows="4" style="width:100%;font-family:monospace;resize:vertical;" placeholder='[{"label":"TWR","freq":"118.700"}]'></textarea>
            <div class="prop-hint" style="margin-top:2px;">Paste/edit raw JSON here for shapes the row builder above can't represent (nested arrays, etc). Applies on blur; syncs back to the builder above if it parses as an array.</div>
          </div>
        </div>
        <div class="modal-form-row">
          <label>Sync From <span class="prop-hint" title="Live telemetry source that keeps this state var updated automatically. For type 'array', this is a structured feed name (e.g. FLIGHTPLAN, CAS_MESSAGES, NEAREST_AIRPORTS) subscribed over the array-data channel. For scalar types, it's a read Deck Event / SimVar, same as a component binding's Read Deck Event. Leave blank for a state var that's only ever written locally (e.g. by an interaction), not synced from the sim.">ⓘ</span></label>
          <select id="sv-syncfrom" class="prop-select">
            <option value="" ${!initial.syncFrom ? 'selected' : ''}>— none (local-only) —</option>
            ${readEvents.map((e) => `<option value="${e.name}" ${initial.syncFrom === e.name ? 'selected' : ''}>${e.label}</option>`).join('')}
            <option value="${CUSTOM}" ${syncIsCustom ? 'selected' : ''}>Custom / array feed name…</option>
          </select>
        </div>
        <div class="modal-form-row prop-custom-block ${syncIsCustom ? '' : 'hidden'}" id="sv-syncfrom-custom-block">
          <input type="text" id="sv-syncfrom-custom" class="prop-input" value="${syncIsCustom ? initial.syncFrom : ''}" placeholder="e.g. myCustomVar, FLIGHTPLAN" />
        </div>
        <div id="sv-live-fields" class="${initial.syncFrom ? '' : 'hidden'}">
          <div class="modal-form-row prop-row-2">
            <div class="prop-field">
              <label>Poll Rate <span class="prop-hint" title="FDWS v1.7: Normal (1Hz) is right for almost everything. Fast routes this SimVar onto PC Bridge's fastest available polling tier — use it for values a core.gauge.props.compose secondary transform reads that need to look smooth (e.g. an attitude indicator's pitch feeding a horizon's translate). Declare the same rate here as on any component binding.readSimVar reading the same underlying value.">ⓘ</span></label>
              <select id="sv-pollrate" class="prop-select">
                <option value="1" ${!isFastPoll ? 'selected' : ''}>Normal (1Hz)</option>
                <option value="100" ${isFastPoll ? 'selected' : ''}>Fast (~100Hz)</option>
              </select>
            </div>
            <div class="prop-field">
              <label>Dead Band</label>
              <input type="number" step="any" min="0" id="sv-deadband" class="prop-input" value="${initial.deadband ?? 0}" />
            </div>
          </div>
          <div class="modal-form-row">
            <div class="prop-field">
              <label>Poll Group <span class="prop-hint" title="FDWS v1.26: which PC Bridge polling chunk this SimVar's data definition joins. Leave blank to default to this widget's own id — already groups all of this widget's own bindings together, away from unrelated widgets' vars. Only set this to deliberately merge chunks across widgets, or split an unusually noisy var out of an otherwise-quiet widget.">ⓘ</span></label>
              <input type="text" id="sv-pollgroup" class="prop-input" value="${initial.pollGroup || ''}" placeholder="(defaults to this widget's id)" />
            </div>
          </div>
        </div>
        <div class="modal-form-row">
          <label>Persistence <span class="prop-hint" title="Don't persist: resets to Default on every widget remount (e.g. switching pages away and back), same as before this field existed. Persist (device storage): saved durably, restored on next app launch — days/weeks later. Session only (FDWS v1.22): survives switching pages within the current running app, but resets the next time the app is actually relaunched — nothing is written to device storage. Disallowed for type &quot;array&quot; with a Sync From set either way — a live feed (flight plans, message queues) is always re-synced fresh and a persisted/session copy of it would just go stale.">ⓘ</span></label>
          <select id="sv-persist" class="prop-select" ${initial.type === 'array' && initial.syncFrom ? 'disabled' : ''}>
            <option value="false" ${!initial.persist ? 'selected' : ''}>Don't persist</option>
            <option value="true" ${initial.persist === true ? 'selected' : ''}>Persist (device storage)</option>
            <option value="session" ${initial.persist === 'session' ? 'selected' : ''}>Session only (this app run)</option>
          </select>
        </div>
        ${this.state.widgetDef.kind === 'popover' ? `
          <div class="modal-form-row">
            <label>Seed From Context Key <span class="prop-hint" title="FDWS v1.12: on popover open, this variable's initial value comes from the named key in the host's Open Widget Popover Context Map (e.g. 'currentLabel') instead of Default Value above — falls back to Default if the key wasn't declared writable by the host, or isn't declared at all. Lets a scratch edit field start pre-filled with the item being edited while still supporting a true Cancel-discards flow (unlike binding the input directly to $context.&lt;key&gt;.value, which can only live-commit on every change).">ⓘ</span></label>
            <input type="text" id="sv-seedfromcontext" class="prop-input" value="${initial.seedFromContext || ''}" placeholder="e.g. currentLabel" />
          </div>
        ` : ''}
      `,
      onMount: (card) => {
        const typeSel = card.querySelector('#sv-type');
        const defaultInput = card.querySelector('#sv-default');
        const defaultScalarRow = card.querySelector('#sv-default-scalar-row');
        const arrayEditor = card.querySelector('#sv-array-editor');
        const persistCb = card.querySelector('#sv-persist');
        const syncSel = card.querySelector('#sv-syncfrom');
        const syncCustomBlock = card.querySelector('#sv-syncfrom-custom-block');
        const liveFields = card.querySelector('#sv-live-fields');

        const renderArrayItems = () => {
          const mount = card.querySelector('#sv-array-items');
          if (!mount) return;
          mount.innerHTML = arrayItems.length === 0 ? '<div class="caps-empty">No items yet.</div>' : arrayItems.map((item, idx) => {
            const isObj = item !== null && typeof item === 'object' && !Array.isArray(item);
            if (isObj) {
              const entries = Object.entries(item);
              return `
                <div class="row-list-item array-item-row" data-item-idx="${idx}" style="flex-direction:column;align-items:stretch;">
                  <div class="array-item-fields" style="display:flex;flex-direction:column;gap:4px;">
                    ${entries.length === 0 ? '<div class="caps-empty">No fields yet — click + Field.</div>' : entries.map(([k, v]) => `
                      <div class="array-field-pair" style="display:flex;gap:6px;">
                        <input type="text" class="prop-input array-field-key" value="${escAttr(k)}" placeholder="key" style="flex:1;" />
                        <input type="text" class="prop-input array-field-val" value="${escAttr(displayVal(v))}" placeholder="value" style="flex:1;" />
                        <button type="button" class="btn-mini-close array-field-remove">✕</button>
                      </div>
                    `).join('')}
                  </div>
                  <div style="display:flex;gap:8px;">
                    <button type="button" class="bar-btn row-add array-field-add">+ Field</button>
                    <button type="button" class="btn-mini-close array-item-remove">✕ Remove Item</button>
                  </div>
                </div>
              `;
            }
            return `
              <div class="row-list-item array-item-row" data-item-idx="${idx}" style="display:flex;gap:6px;">
                <input type="text" class="prop-input array-item-value" value="${escAttr(displayVal(item))}" style="flex:1;" />
                <button type="button" class="btn-mini-close array-item-remove">✕</button>
              </div>
            `;
          }).join('');

          // Any structural change (add/remove item or field) first re-reads the
          // ENTIRE builder's live DOM state into arrayItems, THEN mutates, THEN
          // re-renders — so an edit sitting unblurred in a totally different row
          // is never silently dropped by clicking a button elsewhere in the list.
          // (Earlier version mutated arrayItems[idx] only from 'change' events,
          // which meant renderArrayItems() from an unrelated add/remove button
          // click would rebuild the whole list from stale data and lose it.)
          mount.querySelectorAll('[data-item-idx]').forEach((rowEl) => {
            const idx = Number(rowEl.dataset.itemIdx);

            rowEl.querySelector('.array-item-remove')?.addEventListener('click', () => {
              arrayItems = readArrayItemsFromDom(card);
              arrayItems.splice(idx, 1);
              renderArrayItems();
            });
            rowEl.querySelectorAll('.array-field-remove').forEach((btn) => {
              btn.addEventListener('click', () => {
                const fieldIdx = [...rowEl.querySelectorAll('.array-field-pair')].indexOf(btn.closest('.array-field-pair'));
                arrayItems = readArrayItemsFromDom(card);
                const keys = Object.keys(arrayItems[idx] || {});
                if (fieldIdx >= 0 && fieldIdx < keys.length) delete arrayItems[idx][keys[fieldIdx]];
                renderArrayItems();
              });
            });
            rowEl.querySelector('.array-field-add')?.addEventListener('click', () => {
              arrayItems = readArrayItemsFromDom(card);
              if (typeof arrayItems[idx] !== 'object' || arrayItems[idx] === null || Array.isArray(arrayItems[idx])) {
                arrayItems[idx] = {};
              }
              // Placeholder key avoids colliding with a not-yet-renamed
              // previous blank field if "+ Field" is clicked more than once.
              let newKey = 'field';
              let n = 1;
              while (newKey in arrayItems[idx]) newKey = `field${n++}`;
              arrayItems[idx][newKey] = '';
              renderArrayItems();
            });
          });
        };

        card.querySelector('#sv-array-add-text')?.addEventListener('click', () => {
          arrayItems = readArrayItemsFromDom(card);
          arrayItems.push('');
          renderArrayItems();
        });
        card.querySelector('#sv-array-add-object')?.addEventListener('click', () => {
          arrayItems = readArrayItemsFromDom(card);
          arrayItems.push({});
          renderArrayItems();
        });

        const jsonToggle = card.querySelector('#sv-array-json-toggle');
        const jsonBlock = card.querySelector('#sv-array-json-block');
        const jsonTextarea = card.querySelector('#sv-array-json');
        let jsonOpen = false;
        jsonToggle?.addEventListener('click', () => {
          jsonOpen = !jsonOpen;
          jsonBlock.classList.toggle('hidden', !jsonOpen);
          jsonToggle.textContent = `${jsonOpen ? '▾' : '▸'} Advanced: Edit as JSON`;
          if (jsonOpen) jsonTextarea.value = JSON.stringify(readArrayItemsFromDom(card), null, 2);
        });
        jsonTextarea?.addEventListener('change', () => {
          try {
            const parsed = JSON.parse(jsonTextarea.value);
            if (!Array.isArray(parsed)) throw new Error('not an array');
            arrayItems = parsed;
            renderArrayItems();
          } catch {
            // Leave the row builder untouched on invalid JSON — the textarea
            // itself is the only thing that reverts on next open.
          }
        });

        renderArrayItems();

        const syncCustomInput = card.querySelector('#sv-syncfrom-custom');

        // FDWS v1.21/v1.22: persist (true or "session") is only disallowed
        // for the combination of type:"array" AND a live Sync From — a plain
        // local array (no syncFrom) is free to persist, durably or
        // session-only, like any scalar. Re-checked whenever either field
        // changes, in either direction, so toggling Sync From on/off for an
        // already-array-typed var updates the select live instead of only
        // being evaluated once at dialog-open time.
        const updatePersistAvailability = () => {
          const isArray = typeSel.value === 'array';
          const effectiveSyncFrom = syncSel.value === CUSTOM ? syncCustomInput.value.trim() : syncSel.value;
          const disallowPersist = isArray && !!effectiveSyncFrom;
          persistCb.disabled = disallowPersist;
          if (disallowPersist) persistCb.value = 'false';
        };

        typeSel.addEventListener('change', () => {
          const isArray = typeSel.value === 'array';
          defaultInput.value = defaultForType[typeSel.value];
          defaultScalarRow.hidden = isArray;
          arrayEditor.hidden = !isArray;
          updatePersistAvailability();
        });

        syncSel.addEventListener('change', () => {
          syncCustomBlock.classList.toggle('hidden', syncSel.value !== CUSTOM);
          liveFields.classList.toggle('hidden', !syncSel.value);
          updatePersistAvailability();
        });
        syncCustomInput?.addEventListener('input', updatePersistAvailability);
      },
      onSubmit: (card) => {
        const cleanName = card.querySelector('#sv-name').value.trim();
        if (!cleanName) return { error: 'A variable name is required.' };
        const type = card.querySelector('#sv-type').value;
        const raw = card.querySelector('#sv-default').value;

        let parsedDef = raw;
        if (type === 'number') parsedDef = parseFloat(raw) || 0;
        if (type === 'boolean') parsedDef = raw === 'true';
        if (type === 'array') {
          parsedDef = readArrayItemsFromDom(card);
        }

        const syncSel = card.querySelector('#sv-syncfrom');
        const syncCustom = card.querySelector('#sv-syncfrom-custom');
        const syncFrom = syncSel.value === CUSTOM ? syncCustom.value.trim() : syncSel.value;

        // FDWS v1.21/v1.22: only type:"array" WITH a syncFrom forces persist
        // off — a local-only array is allowed to persist (true or
        // "session") like any scalar. #sv-persist's value is the literal
        // string "false"/"true"/"session"; only "session" carries through
        // as the string sentinel, "true"/"false" become real booleans.
        const persistRaw = card.querySelector('#sv-persist').value;
        const persist = (type === 'array' && syncFrom)
          ? false
          : (persistRaw === 'session' ? 'session' : persistRaw === 'true');
        const value = { name: cleanName, type, default: parsedDef, persist };
        if (syncFrom) {
          value.syncFrom = syncFrom;
          value.pollFrequencyHz = Number(card.querySelector('#sv-pollrate')?.value) || 1;
          value.deadband = Number(card.querySelector('#sv-deadband')?.value) || 0;
          const pollGroup = card.querySelector('#sv-pollgroup')?.value.trim();
          if (pollGroup) value.pollGroup = pollGroup;
        }
        const seedFromContext = card.querySelector('#sv-seedfromcontext')?.value.trim();
        if (seedFromContext) value.seedFromContext = seedFromContext;

        return { value };
      }
    });

    if (!result) return;
    if (isEdit) {
      this.state.updateStateVar(existing.name, result);
    } else {
      this.state.addStateVar(result);
    }
  }

  // --- 4. ASSETS TAB ---
  renderAssetsTab() {
    const assets = this.state.widgetDef.assets || [];

    const header = document.createElement('div');
    header.className = 'panel-section-header';
    header.innerHTML = `
      <span class="panel-title">ASSET TABLE (${assets.length})</span>
      <label class="panel-mini-btn upload-label" title="Upload Image / SVG">
        + Upload
        <input type="file" id="asset-file-input" accept="image/png,image/jpeg,image/webp,image/svg+xml" style="display:none;" />
      </label>
    `;
    this.contentArea.appendChild(header);

    const fileInput = header.querySelector('#asset-file-input');
    fileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) this.handleAssetUpload(file);
    });

    const listWrap = document.createElement('div');
    listWrap.className = 'assets-grid';

    if (assets.length === 0) {
      listWrap.innerHTML = `
        <div class="empty-tree-notice">
          No embedded assets.<br>Upload button textures, switch faceplates, or panel logos (PNG, JPG, WebP, SVG &lt; 2MB).
        </div>
      `;
    } else {
      assets.forEach((asset) => {
        const card = document.createElement('div');
        card.className = 'asset-card';
        const sizeKb = Math.round((asset.data?.length * 3) / 4 / 1024);

        card.innerHTML = `
          <div class="asset-thumb-wrap">
            <img src="data:${asset.mimeType || 'image/png'};base64,${asset.data}" class="asset-thumb-img" alt="${asset.id}" />
          </div>
          <div class="asset-info">
            <div class="asset-id" title="${asset.id}">${asset.id}</div>
            <div class="asset-size">${sizeKb} KB • ${asset.mimeType?.split('/')[1]?.toUpperCase()}</div>
          </div>
          <div class="asset-actions">
            <button class="btn-copy-asset-id" title="Copy Asset ID">📋</button>
            <button class="btn-del-asset" title="Delete Asset">✕</button>
          </div>
        `;

        card.querySelector('.btn-copy-asset-id')?.addEventListener('click', () => {
          navigator.clipboard?.writeText(asset.id);
          showToast(`Copied asset ID: "${asset.id}"`);
        });

        card.querySelector('.btn-del-asset')?.addEventListener('click', async () => {
          const ok = await confirmModal(`Delete asset "${asset.id}"?`, { title: 'Delete Asset', danger: true });
          if (ok) this.state.deleteAsset(asset.id);
        });

        listWrap.appendChild(card);
      });
    }

    this.contentArea.appendChild(listWrap);
  }

  handleAssetUpload(file) {
    if (file.size > 2097152) {
      showToast(`"${file.name}" exceeds the 2MB asset size limit (${(file.size / 1048576).toFixed(2)} MB) — not added.`);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      const base64Data = result.split(',')[1];
      const mimeType = file.type || 'image/png';
      const cleanId = file.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_').replace(/\.[^.]+$/, '');

      this.state.addAsset({
        id: cleanId,
        filename: file.name,
        mimeType: mimeType,
        encoding: 'base64',
        data: base64Data,
        sizeBytes: file.size
      });
    };
    reader.readAsDataURL(file);
  }

  // --- 5. TEMPLATES & LIBRARY TAB ---
  renderTemplatesTab() {
    // Collapsed by default (no `open` attribute) — this tab used to open
    // straight into the full built-in template gallery, so reaching your own
    // saved widgets below meant scrolling past all of them every time. A
    // native <details>/<summary> gets free collapse/expand + keyboard
    // support with no extra state to manage.
    const templatesSection = document.createElement('details');
    templatesSection.className = 'templates-collapsible';

    const summary = document.createElement('summary');
    summary.className = 'panel-section-header templates-summary';
    summary.innerHTML = `
      <span class="panel-title">FDWS v1.4 TEMPLATES (${STUDIO_TEMPLATES.length})</span>
      <svg class="summary-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"></polyline></svg>
    `;
    templatesSection.appendChild(summary);

    const listWrap = document.createElement('div');
    listWrap.className = 'templates-list';

    STUDIO_TEMPLATES.forEach((tmpl) => {
      const card = document.createElement('div');
      card.className = 'template-card';
      card.innerHTML = `
        <div class="template-title">${tmpl.meta.name}</div>
        <div class="template-desc">${tmpl.meta.description || ''}</div>
        <div class="template-meta">
          <span class="tmpl-badge">${tmpl.meta.category || 'Avionics'}</span>
          <span class="tmpl-badge">${tmpl.layout.defaultW}×${tmpl.layout.defaultH}</span>
          <span class="tmpl-badge">${tmpl.components.length} comps</span>
        </div>
        <button class="btn-load-template">Load Template</button>
      `;

      card.querySelector('.btn-load-template')?.addEventListener('click', async () => {
        const ok = await confirmModal(`Load "${tmpl.meta.name}"? Any unsaved edits on the current widget will be replaced.`, { title: 'Load Template' });
        if (ok) this.state.setWidgetDef(tmpl, true, `Load ${tmpl.meta.name}`);
      });

      listWrap.appendChild(card);
    });

    // Widget Studio 2.0, Phase 2: listWrap was built and fully populated with
    // every template card above, but never actually attached to the DOM —
    // a pre-existing bug (unrelated to this session's own template addition)
    // that meant the entire built-in template gallery has been silently
    // unusable through this tab; only the header showed. Found while
    // verifying the new Concentric Dual Knob template actually appears here.
    templatesSection.appendChild(listWrap);
    this.contentArea.appendChild(templatesSection);

    // Saved Widgets Section (FDWS v1.3: split by kind so popover-only widgets — opened
    // via core.openWidgetPopover, never placed on a page — don't clutter the normal
    // placeable-widget gallery)
    const savedWidgetsList = this.state.savedWidgets.filter((w) => (w.kind || 'widget') === 'widget');
    const savedPopoversList = this.state.savedWidgets.filter((w) => w.kind === 'popover');

    this.renderSavedWidgetsSection('MY SAVED WIDGETS', savedWidgetsList, 'No saved custom widgets in browser storage yet. Click "Save Widget" in bottom bar to store your creations!');
    this.renderSavedWidgetsSection('MY SAVED POPOVERS', savedPopoversList, 'No saved popover widgets yet. Use "New Popover" in the bottom bar to design one, then wire it to a host button\'s core.openWidgetPopover action.');

    this.renderDeckEventPacksSection();
  }

  // --- Community Deck Events Packs ---
  renderDeckEventPacksSection() {
    const header = document.createElement('div');
    header.className = 'panel-section-header';
    header.style.marginTop = '16px';
    header.innerHTML = `<span class="panel-title">COMMUNITY DECK EVENTS PACKS</span>`;
    this.contentArea.appendChild(header);

    const blurb = document.createElement('div');
    blurb.className = 'empty-tree-notice';
    blurb.style.marginBottom = '8px';
    blurb.textContent = 'Packs suggest extra logical binding names (e.g. for a specific G1000/G3000 aircraft) in the SIMVARS & BINDINGS "Custom…" picker. Purely an authoring convenience — FDWS §1.2 bare names are host-defined either way, so importing a pack never changes what a widget actually does.';
    this.contentArea.appendChild(blurb);

    const actionsRow = document.createElement('div');
    actionsRow.className = 'saved-card-btns';
    actionsRow.innerHTML = `
      <label class="btn-load-template" style="cursor:pointer;text-align:center;">Import Pack…<input type="file" id="pack-import-input" accept=".json" style="display:none;" /></label>
      <button id="btn-export-pack" class="btn-load-template">Export My Custom Names…</button>
    `;
    this.contentArea.appendChild(actionsRow);

    actionsRow.querySelector('#pack-import-input')?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) this.handlePackImport(file);
    });
    actionsRow.querySelector('#btn-export-pack')?.addEventListener('click', () => this.handlePackExport());

    const packs = loadImportedPacks();
    const listWrap = document.createElement('div');
    listWrap.className = 'templates-list';
    listWrap.style.marginTop = '8px';

    if (packs.length === 0) {
      listWrap.innerHTML = `<div class="empty-tree-notice">No packs imported yet.</div>`;
    } else {
      packs.forEach((pack) => {
        const card = document.createElement('div');
        card.className = 'template-card user-saved';
        card.innerHTML = `
          <div class="template-title">${pack.name}</div>
          <div class="template-desc">${pack.description || `by ${pack.author || 'Unknown'}`}</div>
          <div class="template-meta">
            <span class="tmpl-badge">${pack.events.length} events</span>
          </div>
          <div class="saved-card-btns">
            <button class="btn-del-saved" title="Remove Pack">Remove</button>
          </div>
        `;
        card.querySelector('.btn-del-saved')?.addEventListener('click', async () => {
          const ok = await confirmModal(`Remove pack "${pack.name}"? Widgets already using its suggested names are unaffected — this only removes it from the picker's suggestions.`, { title: 'Remove Pack', danger: true });
          if (ok) { removePack(pack.id); this.render(); }
        });
        listWrap.appendChild(card);
      });
    }

    this.contentArea.appendChild(listWrap);
  }

  handlePackImport(file) {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const raw = JSON.parse(reader.result);
        const pack = parsePackFile(raw);
        importPack(pack);
        showToast(`Imported pack "${pack.name}" (${pack.events.length} events).`);
        this.render();
      } catch (err) {
        await openModal({
          title: 'Import Failed',
          bodyHtml: `<p class="modal-confirm-text">Could not import "${file.name}":</p><div class="modal-error" style="margin:0;">${err.message}</div>`,
          cancelLabel: 'Close',
          onSubmit: () => ({ value: true })
        });
      }
    };
    reader.readAsText(file);
  }

  async handlePackExport() {
    const allWidgets = this.state.loadSavedWidgets();
    const customEvents = extractCustomDeckEvents(allWidgets, DECK_EVENT_NAMES);
    if (customEvents.length === 0) {
      await openModal({
        title: 'Nothing to Export',
        bodyHtml: `<p class="modal-confirm-text">None of your saved widgets use a custom (non-canonical) logical binding name yet — nothing to package into a pack.</p>`,
        cancelLabel: 'Close',
        onSubmit: () => ({ value: true })
      });
      return;
    }

    const result = await openModal({
      title: 'Export Custom Names as Pack',
      bodyHtml: `
        <p class="modal-confirm-text">Packaging ${customEvents.length} custom name(s) found across your saved widgets: ${customEvents.map((e) => e.name).join(', ')}</p>
        <div class="modal-form-row"><label>Pack Name</label><input type="text" id="pk-name" class="prop-input" placeholder="e.g. My G1000 Panel Names" /></div>
        <div class="modal-form-row"><label>Author</label><input type="text" id="pk-author" class="prop-input" placeholder="Your name or handle" /></div>
        <div class="modal-form-row"><label>Description</label><input type="text" id="pk-desc" class="prop-input" placeholder="Optional" /></div>
      `,
      submitLabel: 'Download Pack JSON',
      onSubmit: (card) => {
        const name = card.querySelector('#pk-name').value.trim();
        if (!name) return { error: 'A pack name is required.' };
        return { value: { name, author: card.querySelector('#pk-author').value.trim(), description: card.querySelector('#pk-desc').value.trim() } };
      }
    });
    if (!result) return;

    const pack = buildPackFromCustomEvents(customEvents, result);
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pack.id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported "${pack.name}" — share the downloaded file with the community.`);
  }

  /**
   * @param {string} title
   * @param {Array<object>} widgets
   * @param {string} emptyMessage
   */
  renderSavedWidgetsSection(title, widgets, emptyMessage) {
    const savedHeader = document.createElement('div');
    savedHeader.className = 'panel-section-header';
    savedHeader.style.marginTop = '16px';
    savedHeader.innerHTML = `<span class="panel-title">${title} (${widgets.length})</span>`;
    this.contentArea.appendChild(savedHeader);

    const savedWrap = document.createElement('div');
    savedWrap.className = 'templates-list';

    if (widgets.length === 0) {
      savedWrap.innerHTML = `<div class="empty-tree-notice">${emptyMessage}</div>`;
    } else {
      widgets.forEach((w) => {
        const card = document.createElement('div');
        card.className = 'template-card user-saved';
        card.innerHTML = `
          <div class="template-title">${w.meta?.name || w.id}</div>
          <div class="template-desc">${w.meta?.description || 'Custom widget created in Widget Studio'}</div>
          <div class="template-meta">
            <span class="tmpl-badge">${w.meta?.category || 'Custom'}</span>
            <span class="tmpl-badge">Rev ${w.revision || 1}</span>
          </div>
          <div class="saved-card-btns">
            <button class="btn-load-template">Open</button>
            <button class="btn-del-saved" title="Delete from Library">✕</button>
          </div>
        `;

        card.querySelector('.btn-load-template')?.addEventListener('click', () => {
          this.state.setWidgetDef(w, true, `Open ${w.meta?.name || w.id}`);
        });

        card.querySelector('.btn-del-saved')?.addEventListener('click', async () => {
          const ok = await confirmModal(`Delete "${w.meta?.name || w.id}" from saved library?`, { title: 'Delete Saved Widget', danger: true });
          if (ok) this.state.deleteSavedWidget(w.id);
        });

        savedWrap.appendChild(card);
      });
    }

    this.contentArea.appendChild(savedWrap);
  }
}
