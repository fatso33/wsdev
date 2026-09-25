/**
 * StudioInspector.js
 * Right Sidebar Property Inspector for Flight Deck Widget Studio
 * Organized into intuitive, structured accordion property groups adhering strictly to FDWS v1.4
 */

import { StudioValidator, findUnrecognisedComponentPaths } from './StudioValidator.js';
import { showToast } from './StudioModal.js';
import { computeScrollAnchorDelta } from './InspectorLogic.js';
import { TYPE_FIELDS as REGISTRY_TYPE_FIELDS, getFieldsForType } from '../widgets/PropertyRegistry.js';
import { escapeHtmlAttr } from './inspector/inspectorMarkup.js';
import { createFieldRenderers } from './inspector/fieldRenderers.js';
import { renderWidgetInspector, openFullJsonPanel } from './inspector/sections/WidgetSection.js';
import { getFieldValue, commitRotaryFeelContext, commitRotaryFeelEntry, commitField, updateCompProp, updateCompJsonProp } from './inspector/InspectorEdits.js';
import { enhanceNumberInputs, getNumberStep, decimalPlaces, roundToDecimals, renderRangeEditor, renderRowListEditor, toHexColor, wireColorPair, humanizeFieldLabel, fieldDomId, resolveFeelFloorHint, resolvePulseFeelDescription, renderPlainField, renderCheckboxField, renderSelectField, renderColorField, renderRowListField, renderStateVarField, renderAssetField, renderRangeField, renderPivotField } from './inspector/ui/FieldFactory.js';
import { renderRegistryFieldGroups, renderRegistryFields, renderCompoundGroup, assembleCompoundRow, buildFieldWrap, formatShowWhenReason, evaluateShowWhen, resolveEffectiveValue } from './inspector/ui/FieldGroups.js';
import { buildModeToggle, tierHidesField, applyUiMode, applySubtitleVisibility, applyTierMoreBadges, applySectionJsonViews, buildInspectorTabShell, buildLayoutBadge, buildAppearanceBadge, buildDataBadge, buildBehaviorBadge, buildAccordionGroup } from './inspector/InspectorShell.js';
import { renderComponentAppearance, getThemeEditContext, remapAppearancePath, retargetAppearanceFields, renderAppearanceSection, renderBaseThemeAwareAppearanceFields } from './inspector/sections/AppearanceSection.js';
import { buildMultiSelectStyleProxy, applyMultiSelectFieldAvailability, renderMultiSelectInspector } from './inspector/MultiSelectInspector.js';
import { openConditionEditorPopover, renderVisibilityAndGuard, renderConditionListEditor } from './inspector/sections/ConditionsSection.js';
import { renderComponentInteractions, openAddInteractionModal } from './inspector/sections/InteractionsSection.js';
import { openConnectDialog } from './inspector/sections/ConnectDialog.js';
import { renderComponentBindings } from './inspector/sections/BindingsSection.js';
// Wave 3, Part 6 item 5 (V7): the only 3 component types with a runtime
// `props.<field> → def.label` fallback (confirmed in LabelComponent.js,
// ButtonComponent.js, IndicatorComponent.js) — and the only 3 with a matching
// registry Content-group field at that same path. Drives the "Shows"/"Called"
// paired row in LAYOUT & LAYERING below; every other type keeps a plain
// "Display Label" field, unchanged.
const CONTENT_FIELD_BY_TYPE = {
  'core.label': 'props.text',
  'core.button': 'props.label',
  'core.indicator': 'props.label'
};



export class StudioInspector {
  /**
   * @param {HTMLElement} container
   * @param {import('./StudioState.js').StudioState} state
   */
  constructor(container, state, simBridge) {
    this.container = container;
    this.state = state;
    // 0.3-B: live paste-and-test probes + Deck Event unit resolution
    // through StudioApp.js's PC Bridge connection. Optional — every call
    // site below checks it's present and connected before using it, so the
    // inspector still renders fully offline (just without the live-test row).
    this.simBridge = simBridge || null;

    // Every prop edit (even a single keystroke's "change" event, or a color
    // picker's continuous "input" drag) notifies the state and triggers a full
    // render() of this panel. Without remembering which accordion groups the
    // user has opened/closed, each of those re-renders would reset every group
    // back to its hardcoded default — collapsing whatever the user just
    // expanded to edit. This set persists across renders (and across selecting
    // different components) so the panel's expand/collapse state survives edits.
    this.expandedGroups = new Set();
    this.knownGroupTitles = new Set();
    // UI-only (not persisted to the widget def) open/closed state for the
    // binding editor's "Advanced" sub-section — survives re-renders the same
    // way expandedGroups does, for the same reason.
    this._bindingAdvancedOpen = false;

    // Widget Studio 2.0, Phase 1 (binary) -> Part 2 (three tiers). Persisted
    // per-browser (not per-widget, not synced to the widget def) — a user's
    // own experience-level preference, not something that should change when
    // they open a different widget or hand a file to someone else. Fields
    // tagged data-tier="advanced"/"build" in the panels below are hidden per
    // tier via the existing .hidden utility class, toggled after each render
    // rather than baked into the HTML strings, so the same markup serves all
    // three tiers (applyUiMode()).
    //
    // Migration (proposal §2.2): the old binary's only ever-written values
    // were 'simple'/'advanced' — those map onto the new tiers one-for-one
    // (advanced -> full, simple -> build) rather than collapsing into Guided,
    // so an existing user's screen doesn't get MORE sparse than what they were
    // already used to. A genuinely first-run browser (no saved value at all)
    // defaults to the new, more guided tier — that's the actual point of
    // adding it.
    const savedTier = localStorage.getItem('fdws_studio_uiMode');
    this.uiTier = savedTier === 'advanced' ? 'full'
      : savedTier === 'simple' ? 'build'
      : (savedTier === 'guided' || savedTier === 'build' || savedTier === 'full') ? savedTier
      : 'guided';
    // Part 2: per-accordion-section "show hidden fields anyway, without
    // leaving the tier" override — see buildAccordionGroup()'s "N more"
    // affordance. Keyed by group title, same persists-across-renders pattern
    // as expandedGroups/knownGroupTitles above.
    this.tierOverrideGroups = new Set();
    // G10 (Wave 2): per-section "View JSON" open/closed state, Full tier only
    // — see applySectionJsonViews(). Keyed by group title, same
    // persists-across-renders pattern as expandedGroups/tierOverrideGroups.
    this.jsonViewOpenTitles = new Set();

    // t01: Inspector tab shell — outer tab (General/Style/Data/Events)
    // persists across widget selection.
    this.activeInspectorTab = 'general';

    this.initDOM();
    this.render();

    this.state.subscribe((changeType) => {
      if (['SELECTION_CHANGED', 'LAYER_GROUP_SELECTED', 'COMPONENT_UPDATED', 'COMPONENT_ADDED', 'COMPONENT_DELETED', 'WIDGET_DEF_LOADED', 'WIDGET_META_UPDATED', 'WIDGET_LAYOUT_UPDATED', 'WIDGET_STYLE_UPDATED', 'LAYER_GROUPS_UPDATED', 'STATE_VARS_UPDATED', 'ASSETS_UPDATED', 'HISTORY_CHANGE', 'STYLE_CLIPBOARD_UPDATED', 'PREVIEW_THEME_CHANGED'].includes(changeType)) {
        this.render();
      }
    });
  }

  initDOM() {
    this.container.innerHTML = '';
    this.container.classList.add('studio-inspector-root');
  }

  /**
   * Wave 0b (V6): renderInner() unconditionally does `innerHTML = ''` and
   * rebuilds — every prop edit, including every 'input' frame while dragging
   * a color swatch, destroys and recreates the whole panel. expandedGroups
   * (a class-instance Set, not DOM state) already survives that; the actual
   * focused element does not — document.activeElement drops to <body> mid-
   * edit. This wrapper captures which element (by id) had focus and its text
   * selection range before the rebuild, then restores both after, so typing
   * or dragging is never interrupted. Deliberately NOT a rewrite of the
   * render architecture itself (no debounce/patch-in-place infra exists
   * anywhere in this codebase to build on — see Wave 0b plan) — this fixes
   * the actual user-visible symptom at a fraction of that risk.
   */
  render() {
    const active = this.container.contains(document.activeElement) ? document.activeElement : null;
    const focusId = active?.id || null;
    const selRange = (focusId && 'selectionStart' in active && typeof active.selectionStart === 'number')
      ? [active.selectionStart, active.selectionEnd]
      : null;

    // Ticket 14: anchor the focused element's on-screen position relative to
    // its scrollable `.inspector-panel` before the wipe, mirroring the focus
    // preservation just below — restoring a raw scrollTop instead would break
    // the moment the rebuild changes content height above the focused element
    // (e.g. a showWhen-gated field appearing/disappearing).
    const oldPanel = active ? active.closest('.inspector-panel') : null;
    const oldFocusTop = oldPanel ? active.getBoundingClientRect().top : null;
    const oldPanelTop = oldPanel ? oldPanel.getBoundingClientRect().top : null;
    const oldScrollTop = oldPanel ? oldPanel.scrollTop : null;

    this.renderInner();

    if (focusId) {
      const el = this.container.querySelector(`#${CSS.escape(focusId)}`);
      if (el) {
        el.focus({ preventScroll: true });
        if (selRange && 'setSelectionRange' in el) {
          try { el.setSelectionRange(selRange[0], selRange[1]); } catch { /* not a text-selectable input type */ }
        }

        if (oldPanel) {
          const newPanel = el.closest('.inspector-panel');
          if (newPanel) {
            const delta = computeScrollAnchorDelta({
              oldFocusTop,
              oldPanelTop,
              newFocusTop: el.getBoundingClientRect().top,
              newPanelTop: newPanel.getBoundingClientRect().top,
            });
            newPanel.scrollTop += delta;
          }
        }
      } else if (oldPanel) {
        // The previously-focused element didn't survive the rebuild (e.g. it
        // was a showWhen-gated field that just got hidden) — nothing left to
        // anchor to, so fall back to restoring the panel's raw scrollTop
        // rather than snapping to the top.
        const fallbackPanel = this.container.querySelector('.inspector-panel.active');
        if (fallbackPanel) fallbackPanel.scrollTop = oldScrollTop;
      }
    }
  }

  renderInner() {
    this.container.innerHTML = '';
    // G10: reset each render — every buildAccordionGroup() call below repopulates
    // it fresh, so a section removed between renders (e.g. deselecting a component)
    // can't leave a stale entry behind.
    this._sectionJsonData = {};
    this.container.appendChild(this.buildModeToggle());

    // Widget Studio 2.0, Phase 3: a 2+ multi-selection gets its own bulk-edit
    // view instead of falling through to the single "primary" component's
    // full panel — previously selecting several components silently showed
    // just the last-touched one's properties with no indication anything
    // else was even selected.
    if (this.state.multiSelectedIds.size > 1) {
      this.renderMultiSelectInspector();
      this.applyUiMode();
      this.applyTierMoreBadges();
      this.applySectionJsonViews();
      this.enhanceNumberInputs(this.container);
      return;
    }

    const selectedComp = this.state.selectedComponentId
      ? this.state.getComponent(this.state.selectedComponentId)
      : null;

    if (selectedComp) {
      this.renderComponentInspector(selectedComp);
    } else {
      this.renderWidgetInspector();
    }

    this.applyUiMode();
    this.applyTierMoreBadges();
    this.applySectionJsonViews();
    this.enhanceNumberInputs(this.container);
  }

  /** Adds the same chevron and focused wheel controls to every number input in a rendered subtree. */
  enhanceNumberInputs(root) {
    return enhanceNumberInputs(this, root);
  }

  /** Lookup a field's configured step: by its registry field path (data-step-key,
   * set in renderPlainField), falling back to the input's own DOM id (for the
   * hand-coded numeric fields outside the registry engine), falling back to
   * NUMBER_STEP_DEFAULT when neither key is in NUMBER_STEP_LOOKUP. */
  getNumberStep(input) {
    return getNumberStep(this, input);
  }

  /** Decimal places in a step literal like 0.1 (1) or 0.01 (2) or 1 (0). */
  decimalPlaces(step) {
    return decimalPlaces(this, step);
  }

  /** Rounds away the float-arithmetic noise (e.g. 1 + 0.1 !== 1.1) from a
   * wheel/chevron step, to the given number of decimal places. */
  roundToDecimals(value, decimals) {
    return roundToDecimals(this, value, decimals);
  }

  /**
   * Builds the common-value proxy used by multi-selection style fields.
   * @param {Array<object>} realComps - The selected components to merge.
   * @returns {object} The synthetic component passed to the shared field renderer.
   */
  buildMultiSelectStyleProxy(realComps) {
    return buildMultiSelectStyleProxy(this, realComps);
  }

  /**
   * Disables unsupported multi-selection style controls while keeping their wrappers visible.
   * @param {HTMLElement} mount - The rendered multi-selection Style panel.
   * @param {{enabledFieldPaths: string[]}} availability - Paths supported by every selected component type.
   * @returns {void}
   */
  applyMultiSelectFieldAvailability(mount, availability) {
    return applyMultiSelectFieldAvailability(this, mount, availability);
  }

  /** Renders the common Style fields and actions for the current multi-selection. */
  renderMultiSelectInspector() {
    return renderMultiSelectInspector(this);
  }

  /** Always-visible Guided/Build/Full tier switch, independent of what's selected. */
  buildModeToggle() {
    return buildModeToggle(this);
  }

  /** True when a field or section with this data-tier value is hidden at the current tier. */
  tierHidesField(dataTier) {
    return tierHidesField(this, dataTier);
  }

  /** Applies the tier rules to every data-tier element, then the subtitle pass. Call after any (re-)render. */
  applyUiMode() {
    return applyUiMode(this);
  }

  /** Hides a subtitle heading whose fields are all hidden. */
  applySubtitleVisibility() {
    return applySubtitleVisibility(this);
  }

  /** Injects the "⋯ N more" link into every section that has tier-hidden fields. Call after the whole render. */
  applyTierMoreBadges() {
    return applyTierMoreBadges(this);
  }

  /** Full tier's read-only per-section JSON views. Call after the whole render. */
  applySectionJsonViews() {
    return applySectionJsonViews(this);
  }

  // ==========================================
  // --- WIDGET ROOT INSPECTOR ---
  // ==========================================
  renderWidgetInspector() {
    return renderWidgetInspector(this);
  }

  async openFullJsonPanel() {
    return openFullJsonPanel(this);
  }

  async openConditionEditorPopover(title, buildEditor) {
    return openConditionEditorPopover(this, title, buildEditor);
  }

  // ==========================================
  // --- COMPONENT INSPECTOR ---
  // ==========================================

  /**
   * Builds the General/Style/Data/Events tab bar and panels. `disabledTabs` and `forceActiveTab` serve
   * the multi-select shell; the defaults keep the single-selection behavior.
   * @param {{disabledTabs?: string[], forceActiveTab?: string}} [opts]
   */
  buildInspectorTabShell({ disabledTabs = [], forceActiveTab = null } = {}) {
    return buildInspectorTabShell(this, { disabledTabs, forceActiveTab });
  }

  renderComponentInspector(comp) {
    if (this._styleTabCompId !== comp.id) {
      this._styleTabCompId = comp.id;
      this._styleTab = 'normal';
      // Wave 2 Part B2: which rule chip (by index into style.rules[]) is
      // active, if any — takes precedence over _styleTab when set. Reset
      // alongside _styleTab for the same reason: switching components must
      // not leave a stale rule tab selected on a component with fewer (or
      // no) rules.
      this._styleTabRuleIndex = null;
    }

    const def = this.state.widgetDef;
    const layerGroups = def.layerGroups || [];
    const layerGroupsMap = new Map(layerGroups.map((lg) => [lg.id, lg.z || 0]));

    const groupZ = comp.layer?.group ? (layerGroupsMap.get(comp.layer.group) ?? 0) : 0;
    const localZ = comp.layer?.z ?? 0;
    const effectiveZ = groupZ + localZ;

    // Header
    const header = document.createElement('div');
    header.className = 'inspector-header';
    header.innerHTML = `
      <div class="inspector-title-row">
        <span class="inspector-badge comp-type">${comp.type.replace('core.', '')}</span>
        <h3 class="inspector-title">${comp.label || comp.id}</h3>
        <button id="btn-deselect-comp" class="btn-mini-close" title="Back to Widget Root">✕</button>
      </div>
      <div class="inspector-sub">ID: ${comp.id} • Effective Z: ${effectiveZ}</div>
    `;
    this.container.appendChild(header);

    header.querySelector('#btn-deselect-comp')?.addEventListener('click', () => {
      this.state.clearSelection();
    });

    // t01: Build tab shell
    const { tabBar, panelsContainer, panels } = this.buildInspectorTabShell();
    this.container.appendChild(tabBar);
    this.container.appendChild(panelsContainer);

    // 1. Layout & Layering — Widget Studio 2.0, Phase 6 merges the old
    // "Identification & Layering" + "Sub-Grid Geometry" accordions into one
    // group (an author thinks of "where/how big is this and how does it
    // layer" as one concern, not two). Each original section's own body/event
    // -wiring code is left untouched below, just wrapped in its own IIFE so
    // it can render into its own sub-`body` div instead of the group's outer
    // one — see the divider between them.
    panels['general'].appendChild(this.buildAccordionGroup('LAYOUT & LAYERING', true, (outerBody) => {
    ((body) => {
      const layer = comp.layer || {};
      const contentPath = CONTENT_FIELD_BY_TYPE[comp.type];
      // Reuse the registry's own per-type tooltip (already tailored — e.g.
      // core.button's mentions binding.stateRef) rather than a hand-written
      // one-size string, appending only the fallback note this pairing adds.
      const contentFieldDef = contentPath
        ? REGISTRY_TYPE_FIELDS[comp.type]?.find((f) => f.path === contentPath)
        : null;
      const contentTooltip = `${contentFieldDef?.tooltip || ''} Falls back to "Called" (right) if this has never been set.`.trim();
      body.innerHTML = `
        ${contentPath ? `
        <div class="prop-row-2">
          <div class="prop-field">
            <label>Shows <span class="prop-hint" title="${escapeHtmlAttr(contentTooltip)}">ⓘ</span></label>
            <input type="text" id="c-content-field" class="prop-input" value="${escapeHtmlAttr(this.getFieldValue(comp, contentPath) ?? '')}" placeholder="Runtime text..." />
          </div>
          <div class="prop-field">
            <label>Called <span class="prop-hint" title="Studio-only authoring name — shown in the layer tree and this panel's header. Never rendered on the widget itself.">ⓘ</span></label>
            <input type="text" id="c-label" class="prop-input" value="${comp.label || ''}" placeholder="Component label..." />
          </div>
        </div>
        ` : `
        <div class="prop-field">
          <label>Display Label</label>
          <input type="text" id="c-label" class="prop-input" value="${comp.label || ''}" placeholder="Component label..." />
        </div>
        `}
        <div class="prop-row-2">
          <div class="prop-field" data-tier="advanced">
            <label>Component ID</label>
            <input type="text" id="c-id" class="prop-input" value="${comp.id}" />
          </div>
          <div class="prop-field">
            <label>Type</label>
            <select id="c-type" class="prop-select">
              ${StudioValidator.CORE_COMPONENT_TYPES.map((t) => `<option value="${t}" ${comp.type === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="prop-section-subtitle" style="margin-top:10px;" data-tier="advanced">Layer Group & Z-Index (§9.3)</div>
        <div class="prop-row-2" data-tier="advanced">
          <div class="prop-field">
            <label>Layer Group <span class="prop-hint" title="Puts this component on a named z-order layer (e.g. 'background', 'controls') defined in the Layers panel's own Z field — lets a whole group of components move in front of/behind another group at once, instead of hand-tuning every component's Z individually.">ⓘ</span></label>
            <select id="c-layer-group" class="prop-select">
              <option value="" ${!layer.group ? 'selected' : ''}>None (Ungrouped)</option>
              ${layerGroups.map((g) => `<option value="${g.id}" ${layer.group === g.id ? 'selected' : ''}>${g.id} (Z: ${g.z || 0})</option>`).join('')}
            </select>
          </div>
          <div class="prop-field">
            <label>Local Z-Offset <span class="prop-hint" title="Fine z-order adjustment on top of the Layer Group's own Z (Effective Z, shown in the header above, is the group's Z plus this offset) — use this to order two components within the SAME group, e.g. an indicator's glow behind its lens.">ⓘ</span></label>
            <input type="number" id="c-layer-z" class="prop-input" value="${layer.z ?? 0}" min="-1000" max="1000" />
          </div>
        </div>

        <div class="prop-row-2" style="margin-top:6px;" data-tier="advanced">
          <div class="prop-field">
            <label>Pointer Events <span class="prop-hint" title="'none' makes this component visually present but click/tap-through — the component (or whatever's behind it) receives the touch instead. Useful for a purely decorative overlay (a glass glare image, a label sitting on top of a button) that shouldn't steal taps from what's underneath.">ⓘ</span></label>
            <select id="c-pointer-events" class="prop-select">
              <option value="auto" ${layer.pointerEvents !== 'none' ? 'selected' : ''}>auto (Interactive)</option>
              <option value="none" ${layer.pointerEvents === 'none' ? 'selected' : ''}>none (Pass-through)</option>
            </select>
          </div>
          <div class="prop-field">
            <label>Clip to Bounds <span class="prop-hint" title="When true, anything this component draws outside its own grid cell (an oversized background image, a glow/shadow effect) is cut off at the cell edge instead of overflowing into neighboring components.">ⓘ</span></label>
            <select id="c-clip" class="prop-select">
              <option value="false" ${!layer.clipToBounds ? 'selected' : ''}>false (Visible)</option>
              <option value="true" ${layer.clipToBounds ? 'selected' : ''}>true (Clipped)</option>
            </select>
          </div>
        </div>
      `;

      body.querySelector('#c-label')?.addEventListener('change', (e) => this.state.updateComponent(comp.id, { label: e.target.value }));
      body.querySelector('#c-content-field')?.addEventListener('change', (e) => this.commitField(comp, contentPath, e.target.value));
      body.querySelector('#c-id')?.addEventListener('change', (e) => {
        const newId = e.target.value.trim();
        if (newId && newId !== comp.id) {
          this.state.updateComponent(comp.id, { id: newId });
        }
      });
      body.querySelector('#c-type')?.addEventListener('change', (e) => {
        this.state.updateComponent(comp.id, { type: e.target.value });
      });
      body.querySelector('#c-layer-group')?.addEventListener('change', (e) => {
        const val = e.target.value || null;
        this.state.updateComponent(comp.id, { layer: { ...(comp.layer || {}), group: val } });
      });
      body.querySelector('#c-layer-z')?.addEventListener('change', (e) => {
        const zVal = parseInt(e.target.value, 10) || 0;
        this.state.updateComponent(comp.id, { layer: { ...(comp.layer || {}), z: zVal } });
      });
      body.querySelector('#c-pointer-events')?.addEventListener('change', (e) => {
        this.state.updateComponent(comp.id, { layer: { ...(comp.layer || {}), pointerEvents: e.target.value } });
      });
      body.querySelector('#c-clip')?.addEventListener('change', (e) => {
        this.state.updateComponent(comp.id, { layer: { ...(comp.layer || {}), clipToBounds: e.target.value === 'true' } });
      });
    })(outerBody.appendChild(document.createElement('div')));

    const geomDivider = document.createElement('div');
    geomDivider.className = 'prop-section-subtitle';
    geomDivider.style.marginTop = '14px';
    geomDivider.textContent = 'Grid Position & Size';
    // Guided users place/resize on the canvas (drag-to-place); typing exact
    // grid coordinates is a Build+ convenience, matching the same
    // data-tier="build" precedent already set by widget-root's own
    // Sub-Grid/Default-Size fields (GRID & DIMENSIONS accordion above).
    geomDivider.setAttribute('data-tier', 'build');
    outerBody.appendChild(geomDivider);

    ((body) => {
      const layout = comp.layout || { col: 1, row: 1, w: 2, h: 2 };
      const maxCols = def.layout?.grid?.columns || 12;
      const maxRows = def.layout?.grid?.rows || 6;

      body.innerHTML = `
        <div class="prop-row-2" data-tier="build">
          <div class="prop-field">
            <label>Column (X)</label>
            <input type="number" id="c-layout-col" class="prop-input" value="${layout.col || 1}" min="1" max="${maxCols}" />
          </div>
          <div class="prop-field">
            <label>Row (Y)</label>
            <input type="number" id="c-layout-row" class="prop-input" value="${layout.row || 1}" min="1" max="${maxRows}" />
          </div>
        </div>
      `;

      // 10 (review finding, 2026-09-11): built via the SAME assembleCompoundRow()
      // the registry-driven engine uses for style.offset.x/y and props.min/max,
      // rather than hand-writing an equivalent '.prop-field-compound' markup
      // string here — a future change to the shared row shape now only needs
      // to happen in one place.
      const wField = document.createElement('div');
      wField.className = 'prop-field';
      wField.innerHTML = `<label>Width (Span Columns)</label><input type="number" id="c-layout-w" class="prop-input" value="${layout.w || 1}" min="1" max="${maxCols}" />`;
      const hField = document.createElement('div');
      hField.className = 'prop-field';
      hField.innerHTML = `<label>Height (Span Rows)</label><input type="number" id="c-layout-h" class="prop-input" value="${layout.h || 1}" min="1" max="${maxRows}" />`;
      const sizeRow = this.assembleCompoundRow('compound-row-size', [
        { wrap: wField, label: 'W:', tooltip: 'Width (Span Columns)' },
        { wrap: hField, label: 'H:', tooltip: 'Height (Span Rows)' }
      ]);
      sizeRow.setAttribute('data-tier', 'build');
      body.appendChild(sizeRow);

      const updateLayout = (updates) => {
        this.state.updateComponent(comp.id, { layout: { ...comp.layout, ...updates } });
      };

      body.querySelector('#c-layout-col')?.addEventListener('change', (e) => updateLayout({ col: parseInt(e.target.value, 10) || 1 }));
      body.querySelector('#c-layout-row')?.addEventListener('change', (e) => updateLayout({ row: parseInt(e.target.value, 10) || 1 }));
      body.querySelector('#c-layout-w')?.addEventListener('change', (e) => updateLayout({ w: parseInt(e.target.value, 10) || 1 }));
      body.querySelector('#c-layout-h')?.addEventListener('change', (e) => updateLayout({ h: parseInt(e.target.value, 10) || 1 }));
    })(outerBody.appendChild(document.createElement('div')));
    }, this.buildLayoutBadge(comp), { label: comp.label, id: comp.id, type: comp.type, layer: comp.layer, layout: comp.layout }, true));

    // 2 & 3. Appearance, and Data & Content — Phase 6 merges "Visual Styling &
    // Typography" + "Conditional Formatting" into Appearance (conditional
    // formatting IS appearance, just dynamic), and "Props & Configuration" +
    // "SimVars & Bindings" into Data & Content (most props are either static
    // content or a binding target — the old split forced bouncing between two
    // accordions to finish configuring one thing, e.g. a display's format vs.
    // what feeds it). Neither pair is adjacent in this file's original
    // section order (Bindings originally sat after Styling; Conditional
    // Formatting sat at the very end), so both accordion shells are created
    // here, up front and in final visual order, and filled in below as each
    // original section is reached in turn — appending to a body div later in
    // this function doesn't change WHERE inside that div it lands, only the
    // order of appends to that SAME div does.
    // G10: comp.style can itself be undefined for a component with no style
    // customization at all — normalized so the View JSON toggle still shows
    // "{}" rather than silently vanishing, same reasoning as the root sections.
    const appearanceGroup = this.buildAccordionGroup('APPEARANCE', false, () => {}, this.buildAppearanceBadge(comp), comp.style || {}, true);
    const dataGroup = this.buildAccordionGroup('DATA & CONTENT', false, () => {}, this.buildDataBadge(comp), { props: comp.props, binding: comp.binding }, true);
    // Wave 4, §10.4: computed once, appended at the bottom of the two
    // relevant sections below (props+binding into Data & Content, style into
    // Appearance) plus a standalone catch-all section for a wholly
    // unclassified component-root key, if any.
    const unrecognised = findUnrecognisedComponentPaths(comp);
    const commitUnrecognised = (path, value) => this.commitField(comp, path, value);
    // t01: Append to appropriate tab panels
    panels['style'].appendChild(appearanceGroup);
    panels['data'].appendChild(dataGroup);
    const appearanceBody = appearanceGroup.querySelector('.inspector-group-body');
    const dataBody = dataGroup.querySelector('.inspector-group-body');

    ((body) => {
      this.renderTypeSpecificProps(comp, body);
    })(dataBody.appendChild(document.createElement('div')));

    renderComponentAppearance(this, comp, def, appearanceBody.appendChild(document.createElement('div')));

    const unrecStyleBlock = this.renderUnrecognisedPropertiesBlock(unrecognised.style, def.fdws, `${comp.id}-style`, commitUnrecognised);
    if (unrecStyleBlock) appearanceBody.appendChild(unrecStyleBlock);

    const bindDivider = document.createElement('div');
    bindDivider.className = 'prop-section-subtitle';
    bindDivider.style.marginTop = '14px';
    bindDivider.textContent = 'SimVars & Bindings';
    dataBody.appendChild(bindDivider);

    // 5. Simulator & State Bindings
    renderComponentBindings(this, comp, def, dataBody.appendChild(document.createElement('div')));

    const unrecDataBlock = this.renderUnrecognisedPropertiesBlock([...unrecognised.props, ...unrecognised.binding], def.fdws, `${comp.id}-data`, commitUnrecognised);
    if (unrecDataBlock) dataBody.appendChild(unrecDataBlock);

    // 4. Behavior — Phase 6 merges "Interaction Triggers" + "Visibility &
    // Guard" (visibility-by-state is itself a reactive behavior). Both
    // sections are adjacent in the original file order, so this group merges
    // via simple IIFE wrapping (like Layout & Layering above) rather than the
    // pre-created-shell technique Appearance/Data & Content needed.
    // t01: Append to events tab panel
    panels['events'].appendChild(this.buildAccordionGroup('BEHAVIOR', false, (outerBody) => {
    // 6. Interaction Handlers (interactions[])
    renderComponentInteractions(this, comp, outerBody.appendChild(document.createElement('div')));

    const visibilityDivider = document.createElement('div');
    visibilityDivider.className = 'prop-section-subtitle';
    visibilityDivider.style.marginTop = '14px';
    visibilityDivider.textContent = 'Visibility & Guard';
    outerBody.appendChild(visibilityDivider);

    // 7. Conditional Visibility (visibleWhen) & Guard Overlay (layout.guard) —
    // both are fully runtime-supported (BaseComponent.js's applyVisibility/
    // setupGuard) but previously had zero authoring UI — a user wanting either
    // had to hand-edit exported JSON outside the tool entirely.
    this.renderVisibilityAndGuard(comp, def, outerBody.appendChild(document.createElement('div')));
    }, this.buildBehaviorBadge(comp), { interactions: comp.interactions, visibleWhen: comp.visibleWhen, layout: { guard: comp.layout?.guard } }, true));

    // Wave 2 Part B2: Conditional Formatting (style.rules, FDWS v1.15) no
    // longer has its own section here — a rule is now a target-strip chip
    // in the Appearance panel's main IIFE above, alongside Normal/State,
    // rendered through the same generic field engine. See
    // renderAppearanceSection()'s doc comment.

    // Wave 4, §10.4: a wholly unclassified component-root key (not props/
    // binding/style, not one of the known structural keys either) — no
    // historical precedent for this actually occurring, but kept for honesty
    // rather than silently dropping it. No existing accordion is a "relevant
    // group" for something structurally outside props/binding/style, so it
    // gets its own, appended only when non-empty.
    if (unrecognised.other.length > 0) {
      // t01: Append to general tab panel
      panels['general'].appendChild(this.buildAccordionGroup('UNRECOGNISED PROPERTIES', true, (body) => {
        const block = this.renderUnrecognisedPropertiesBlock(unrecognised.other, def.fdws, `${comp.id}-other`, commitUnrecognised);
        if (block) body.appendChild(block);
      }));
    }
  }

  renderVisibilityAndGuard(comp, def, body) {
    return renderVisibilityAndGuard(this, comp, def, body);
  }

  // Wave 2 Part B2: the old row-list editor for style.rules (with its own
  // compact typography.color/border.color/background controls + per-row
  // JSON fallback) is DELETED — superseded by rule chips in the Appearance
  // panel's target strip (main IIFE in renderComponentInspector()), which
  // render every rule's style through the same generic field engine
  // Normal/State already use. See renderAppearanceSection()'s doc comment.

  renderConditionListEditor(comp, def, expr, idPrefix, onCommit, options = {}) {
    return renderConditionListEditor(this, comp, def, expr, idPrefix, onCommit, options);
  }

  renderTypeSpecificProps(comp, body) {
    const props = comp.props || {};
    const assets = this.state.widgetDef.assets || [];

    switch (comp.type) {
      // Wave 1 (Part 1): first type converted onto the registry-driven
      // engine — also fixes a live registry/UI drift bug in the process:
      // props.truncate has been declared in PropertyRegistry.js all along
      // but was never reachable in this hand-coded panel until now.
      case 'core.label': {
        const fieldMount = document.createElement('div');
        body.appendChild(fieldMount);
        this.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.label'].filter((f) => f.path !== CONTENT_FIELD_BY_TYPE['core.label']));
        const notice = document.createElement('div');
        notice.className = 'empty-tree-notice';
        notice.textContent = "Alignment is set in the Style tab's Appearance section, shared by every component type.";
        body.appendChild(notice);
        break;
      }

      // Wave 1 gap-closing pass (2026-09-04): converted onto the registry-driven
      // engine. props.decimals/odometerDigits now carry their own showWhen gates in
      // PropertyRegistry.js (matching this panel's old needsDecimals/needsOdometer
      // conditionals), and props.format gained its own literal ODOMETER-inclusive
      // options list so converting doesn't silently drop it from the dropdown (the
      // shared VALUE_FORMATS list core.input also reads deliberately excludes it).
      // props.coordAxis already had a showWhen (equalsAny LATLON_DMS/COORD_DECIMAL).
      case 'core.display': {
        const fieldMount = document.createElement('div');
        body.appendChild(fieldMount);
        this.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.display']);
        break;
      }

      // Wave 1 (Part 1): converted onto the registry-driven engine — also
      // fixes two live registry/UI drift bugs: props.icon and props.hasLed
      // have been declared in PropertyRegistry.js all along but were never
      // reachable in this hand-coded panel until now.
      //
      // FDWS v1.14: props.presetSlot/emptyLabel and the "preset" variant
      // are gone — superseded entirely by binding.stateRef/
      // sublabelStateRef (below, in SIMVARS & BINDINGS), which generalize
      // to any state path instead of being special-cased to one array
      // shape (presets[n].freq/.label). See that spec's §0 for why.
      case 'core.button': {
        const fieldMount = document.createElement('div');
        body.appendChild(fieldMount);
        this.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.button'].filter((f) => f.path !== CONTENT_FIELD_BY_TYPE['core.button']));
        break;
      }

      // Wave 1 gap-closing pass (2026-09-04): converted onto the registry-driven
      // engine. Trade-off accepted (see PropertyRegistry.js's TYPE_FIELDS['core.input']
      // comment): Min/Max no longer show a *dynamic* per-format placeholder or
      // auto-populate from the format's catalog entry on Format change — the engine has
      // no per-format hook for either. They now carry a static illustrative placeholder
      // instead. Not a functional regression: InputComponent.js:211-212 already falls
      // back to the format's own min/max at runtime whenever these props are unset.
      case 'core.input': {
        const fieldMount = document.createElement('div');
        body.appendChild(fieldMount);
        this.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.input']);
        break;
      }

      // Step 3 Part A (2026-09-04): converted onto the registry-driven engine — also
      // fixes two live registry/UI drift bugs: props.severity and props.shape were both
      // declared in PropertyRegistry.js with option values that matched neither the
      // runtime (IndicatorComponent.js) nor this hand-coded panel. Fixing the registry
      // finally lights up optionIcons (implemented since Wave 1, dark until now since
      // this type was blocked) — Part 1.1's color-swatch acceptance criterion.
      //
      // TYPE_FIELDS['core.indicator'] also declares binding.testStateVar — filtered out
      // here (props.* only) because the existing hand-built Bindings panel already
      // renders it directly (comp.type === 'core.indicator' gate, further up this file);
      // passing it through here would render it a second time.
      case 'core.indicator': {
        const fieldMount = document.createElement('div');
        body.appendChild(fieldMount);
        this.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.indicator'].filter((f) => f.path.startsWith('props.') && f.path !== CONTENT_FIELD_BY_TYPE['core.indicator']));
        break;
      }

      // Step 3 Part A (2026-09-04): converted onto the registry-driven engine — also
      // fixes a live registry/UI drift bug: props.fit's registry options included
      // 'tile', not a valid CSS object-fit keyword (ImageComponent.js writes it
      // straight into img.style.objectFit, so the browser silently ignored it); the
      // real third option, 'fill', was missing. Corrected to match this panel's own
      // (correct) values above.
      case 'core.image': {
        const fieldMount = document.createElement('div');
        body.appendChild(fieldMount);
        this.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.image']);
        break;
      }

      // Step 3 Part B (2026-09-04): converted onto the registry-driven engine — the
      // last of the 18 TYPE_FIELDS types to convert, closing Step 3. Arc's visibility
      // was already a plain, correct showWhen (transform === 'arc') the engine already
      // handles; Axis's showWhen (transform === 'translate') is a deliberate fix over
      // the old panel, which showed it unconditionally even though 'arc-fill' never
      // reads it (GaugeComponent.js's resolveTransformFn). Fixed props.pivot's control
      // type (was 'text', but it's an {x,y} object) with a new pivotEditor control.
      // Compose stays a small hand-coded toggle — it's not a field, it's a whole
      // optional sub-object created-with-defaults on enable and deleted on disable,
      // which commitField's write-only semantics can't express generically.
      case 'core.gauge': {
        const stateVars = this.state.widgetDef.state || [];
        const composeFields = REGISTRY_TYPE_FIELDS['core.gauge'].filter((f) => f.path.startsWith('props.compose'));
        const mainFields = REGISTRY_TYPE_FIELDS['core.gauge'].filter((f) => !f.path.startsWith('props.compose'));

        const fieldMount = document.createElement('div');
        body.appendChild(fieldMount);
        this.renderRegistryFields(comp, fieldMount, mainFields);

        const composeToggleWrap = document.createElement('div');
        composeToggleWrap.className = 'prop-field';
        composeToggleWrap.setAttribute('data-tier', 'advanced');
        composeToggleWrap.innerHTML = `
          <label style="display:flex;align-items:center;gap:6px;">
            <input type="checkbox" id="p-gauge-compose-toggle" ${props.compose ? 'checked' : ''} />
            Composed Secondary Transform <span class="prop-hint" title="FDWS v1.5: a SECOND transform, sourced from a local state[] variable (not a live binding), composed after the primary one on this same gauge — e.g. an attitude horizon that rotates for bank AND translates for pitch as one rigid body. FDWS v1.6 adds an optional 'Relative To' for a target indicator (like a flight-director bar) that needs to render relative to a reference value a sibling gauge already uses for its own current-reading motion. Not meaningful for 'Arc' (it's an SVG stroke sweep, not a CSS transform) — ignored there.">ⓘ</span>
          </label>
        `;
        body.appendChild(composeToggleWrap);

        const composeMount = document.createElement('div');
        composeMount.className = props.compose ? '' : 'hidden';
        composeMount.setAttribute('data-tier', 'advanced');
        body.appendChild(composeMount);
        if (props.compose) this.renderRegistryFields(comp, composeMount, composeFields);

        composeToggleWrap.querySelector('#p-gauge-compose-toggle')?.addEventListener('change', (e) => {
          if (e.target.checked) {
            const nextProps = {
              ...comp.props,
              compose: comp.props.compose || { transform: 'translate', axis: 'y', stateVar: stateVars[0]?.name || '', valueRange: [0, 1], outputRange: [0, 1], clamp: true }
            };
            this.state.updateComponent(comp.id, { props: nextProps });
            composeMount.classList.remove('hidden');
            this.renderRegistryFields(comp, composeMount, composeFields);
          } else {
            const nextProps = { ...comp.props };
            delete nextProps.compose;
            this.state.updateComponent(comp.id, { props: nextProps });
            composeMount.classList.add('hidden');
          }
        });
        break;
      }

      // Step 3 Part A (2026-09-04): core.slider/core.selector/core.rocker/core.ref
      // converted onto the registry-driven engine; core.list is a hybrid (registry
      // fields + the unchanged hand-coded Item Template JSON editor appended after —
      // that field needs JSON.parse validation the generic engine's controls don't
      // have, so it stays intentionally bespoke, see PropertyRegistry.js's
      // itemTemplate comment). Each fixes real registry/UI drift bugs found while
      // verifying the conversion against the runtime, not just display gaps — see
      // PropertyRegistry.js's per-field "Step 3 Part A" comments:
      //   - core.slider/core.rocker's props.axis had options ('horizontal'/'vertical')
      //     that matched neither the runtime's literal 'x'/'y' check nor this file's
      //     own hand-coded selects above — same bug class as core.pad's already-fixed
      //     props.mode. core.selector's props.mode/axis didn't match the runtime OR
      //     this hand-coded panel at all (registry had 'discrete'/'continuous'; runtime
      //     is 'rotary'/'lever', with axis meaningful only in lever mode).
      //   - core.list's props.itemsBinding is now declared at the real nested path
      //     (props.itemsBinding.stateVar) instead of the object itself; props.textBinding
      //     removed entirely — ListComponent.js never reads it on this type's own props,
      //     only on a CHILD component's props inside itemTemplate.components[].
      //   - core.ref's props.libraryId control changed from 'widgetLibraryPicker' (never
      //     implemented) to 'text' — matching what this panel always actually was.
      case 'core.slider': {
        const fieldMount = document.createElement('div');
        body.appendChild(fieldMount);
        this.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.slider']);
        break;
      }

      case 'core.selector': {
        const fieldMount = document.createElement('div');
        body.appendChild(fieldMount);
        this.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.selector']);
        break;
      }

      case 'core.rocker': {
        const fieldMount = document.createElement('div');
        body.appendChild(fieldMount);
        this.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.rocker']);
        break;
      }

      case 'core.list': {
        const fieldMount = document.createElement('div');
        body.appendChild(fieldMount);
        this.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.list']);

        const templateWrap = document.createElement('div');
        templateWrap.className = 'prop-field';
        templateWrap.innerHTML = `
          <label>Item Template (JSON — components[] with props.textBinding: "item.field")
            <button type="button" id="p-list-template-example" class="btn-mini-inline">Insert example</button>
          </label>
          <textarea id="p-list-itemtemplate" class="prop-input" rows="5">${JSON.stringify(props.itemTemplate || { components: [] }, null, 0)}</textarea>
          <div id="p-list-itemtemplate-error" class="prop-json-error hidden"></div>
        `;
        body.appendChild(templateWrap);
        templateWrap.querySelector('#p-list-itemtemplate')?.addEventListener('change', (e) => {
          this.updateCompJsonProp(comp, 'itemTemplate', e.target.value, templateWrap.querySelector('#p-list-itemtemplate-error'));
        });
        templateWrap.querySelector('#p-list-template-example')?.addEventListener('click', () => {
          const example = { components: [{ id: 'row_label', type: 'core.label', layout: { col: 1, row: 1, w: 12, h: 1 }, props: { text: '', textBinding: 'item.label' } }] };
          this.updateCompProp(comp, 'itemTemplate', example);
        });
        break;
      }

      case 'core.ref': {
        const fieldMount = document.createElement('div');
        body.appendChild(fieldMount);
        this.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.ref']);
        break;
      }

      // Wave 1 gap-closing pass (2026-09-04): core.divider/core.tape/core.pad/
      // core.container/core.stepper/core.rotary all converted onto the registry-driven
      // engine (StudioInspector.js's FIELD_RENDERERS/renderRegistryFields — see that
      // section's header comment). Two of these fixed real registry data bugs found
      // while verifying the conversion against each component's runtime source, not
      // just display gaps — see PropertyRegistry.js's per-field "gap-closing pass"
      // comments for the details:
      //   - core.pad's props.mode had stale options (['xy','x','y']) that didn't match
      //     what PadComponent.js actually reads ('relative'/'absolute') — every value in
      //     the old registry silently fell through to 'relative' at runtime. Fixed.
      //   - core.rotary's props.circular had its default backwards (registry said
      //     false; RotaryComponent.js's actual default is true).
      // core.tape's two data-tier="advanced" row-of-2 groupings (tick lengths, tick
      // colors) become individual fields in a single column — renderRegistryFields tags
      // data-tier per field from the registry's own tier (all four already 'advanced'),
      // so Simple/Advanced visibility is unchanged; only the 2-column grouping is lost,
      // same as the earlier core.button/core.label conversions.
      case 'core.divider': {
        const fieldMount = document.createElement('div');
        body.appendChild(fieldMount);
        this.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.divider']);
        const notice = document.createElement('div');
        notice.className = 'empty-tree-notice';
        notice.textContent = "Thickness, color and dash style are set in the Style tab's Appearance section, under Border. This line reuses those fields.";
        body.appendChild(notice);
        break;
      }

      case 'core.tape': {
        const fieldMount = document.createElement('div');
        body.appendChild(fieldMount);
        this.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.tape']);
        const notice = document.createElement('div');
        notice.className = 'empty-tree-notice';
        notice.textContent = "The current value's own numeric readout isn't part of this component — layer a separate core.display on top at the index line, same as a needle over a dial.";
        body.appendChild(notice);
        break;
      }

      case 'core.pad': {
        const fieldMount = document.createElement('div');
        body.appendChild(fieldMount);
        this.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.pad']);
        break;
      }

      case 'core.container': {
        const fieldMount = document.createElement('div');
        body.appendChild(fieldMount);
        this.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.container']);
        break;
      }

      case 'core.stepper': {
        const fieldMount = document.createElement('div');
        body.appendChild(fieldMount);
        this.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.stepper']);
        break;
      }

      case 'core.rotary': {
        this.renderRegistryFieldGroups(comp, body, REGISTRY_TYPE_FIELDS['core.rotary']);
        break;
      }

      default:
        body.innerHTML = `<div class="caps-empty">Standard properties active for ${comp.type}</div>`;
        break;
    }
  }

  updateCompJsonProp(comp, propKey, rawValue, errorEl) {
    return updateCompJsonProp(this, comp, propKey, rawValue, errorEl);
  }

  /** Renders a shared two-endpoint range editor; commitOverride preserves nested-path writes. */
  renderRangeEditor(mount, comp, propKey, currentRange, title, hint, commitOverride) {
    return renderRangeEditor(this, mount, comp, propKey, currentRange, title, hint, commitOverride);
  }

  /**
   * Generic add/remove/edit row-list editor for structured array props
   * (slider detents, selector positions, rocker zones) — replaces a raw JSON
   * textarea with typed fields per row while keeping the underlying data
   * shape identical to what the runtime component expects.
   */
  renderRowListEditor(mount, comp, propKey, rows, spec) {
    return renderRowListEditor(this, mount, comp, propKey, rows, spec);
  }

  /** Resolves whether override-eligible color fields edit the base style or the Manual theme override. */
  getThemeEditContext() {
    return getThemeEditContext(this);
  }

  /** Extracts a plain #rrggbb from a style value, since <input type="color"> rejects anything else (CSS var() refs, gradients, named colors). */
  toHexColor(value) {
    return toHexColor(this, value);
  }

  /** Connects the swatch and text controls while retaining complete-value and duplicate-commit behavior. */
  wireColorPair(root, pickId, txtId, applyFn, { allowGradient = false, skipEmpty = false } = {}) {
    return wireColorPair(this, root, pickId, txtId, applyFn, { allowGradient, skipEmpty });
  }

  FIELD_RENDERERS = createFieldRenderers(this);

  getFieldValue(comp, path) {
    return getFieldValue(comp, path);
  }

  /**
   * Commits a Rotary's Write Mode or Gesture together with whatever Feel change it implies,
   * as ONE update so a single Undo reverts both. RotaryDefaults decides what moves; anything
   * else the Author set is carried across untouched, and the toast says what changed and why.
   */
  commitRotaryFeelContext(comp, path, value) {
    return commitRotaryFeelContext(this, comp, path, value);
  }

  /**
   * Commits a Feel typed into a Rotary's Feel field, held to the floor of that Rotary's own
   * context, as ONE update so a single Undo reverts it. A finer value is committed as the
   * floor and the toast says so; the update always lands, so the rebuilt panel shows what
   * was stored even when that equals the value already there.
   */
  commitRotaryFeelEntry(comp, value) {
    return commitRotaryFeelEntry(this, comp, value);
  }

  commitField(comp, path, value) {
    return commitField(this, comp, path, value);
  }

  /**
   * Wave 4, §10.4: renders a small "Unrecognised properties" block for
   * entries found by StudioValidator's findUnrecognisedComponentPaths()/
   * findUnrecognisedDefPaths() — JSON keys this build's registry doesn't
   * declare, so they'd otherwise be invisible even though they already
   * survive round-trip untouched. Returns null when there's nothing to show
   * (no dead/empty block, same precedent as every other empty-state in this
   * file). Builds and wires a standalone element in one pass — unlike
   * renderConditionListEditor's {html, wire} split, every call site here has
   * a direct element to appendChild onto, so there's no larger template
   * string this needs to be embedded inside first.
   * @param {Array<{path:string,value:*}>} items
   * @param {string} fdwsVersion
   * @param {string} idPrefix
   * @param {(path:string, value:*) => void} onCommit
   * @returns {HTMLElement|null}
   */
  renderUnrecognisedPropertiesBlock(items, fdwsVersion, idPrefix, onCommit) {
    if (!items || items.length === 0) return null;

    const isScalar = (v) => ['number', 'string', 'boolean'].includes(typeof v);

    const rowHtml = (item, idx) => {
      const rid = `${idPrefix}-unrec-${idx}`;
      const badge = `<span class="tmpl-badge">FDWS v${escapeHtmlAttr(fdwsVersion || '?')}</span>`;
      if (!isScalar(item.value)) {
        return `
          <div class="unrec-props-row">
            <div class="unrec-props-path">${escapeHtmlAttr(item.path)} ${badge}</div>
            <pre class="unrec-props-readonly">${escapeHtmlAttr(JSON.stringify(item.value, null, 2))}</pre>
          </div>
        `;
      }
      const valueType = typeof item.value;
      const inputHtml = valueType === 'boolean'
        ? `<input type="checkbox" id="${rid}-input" ${item.value ? 'checked' : ''} />`
        : `<input type="${valueType === 'number' ? 'number' : 'text'}" id="${rid}-input" class="prop-input" value="${escapeHtmlAttr(item.value)}" />`;
      return `
        <div class="unrec-props-row">
          <div class="unrec-props-path">${escapeHtmlAttr(item.path)} ${badge}</div>
          <div class="unrec-props-value-line">
            <span class="unrec-props-value" id="${rid}-display">${escapeHtmlAttr(JSON.stringify(item.value))}</span>
            <button type="button" class="bar-btn" id="${rid}-toggle">✎ Edit (unvalidated)</button>
          </div>
          <div class="unrec-props-edit hidden" id="${rid}-panel">
            <div class="text-amber unrec-props-warning">⚠ Unrecognised field — this build doesn't know what this value means. Editing it is not validated against any schema.</div>
            ${inputHtml}
            <div class="saved-card-btns">
              <button type="button" class="bar-btn primary" id="${rid}-save">Save</button>
              <button type="button" class="bar-btn" id="${rid}-cancel">Cancel</button>
            </div>
          </div>
        </div>
      `;
    };

    const wrap = document.createElement('div');
    wrap.className = 'unrec-props-block';
    wrap.innerHTML = `
      <div class="unrec-props-header">⚠ UNRECOGNISED PROPERTIES <span class="prop-hint" title="Fields present in this widget's saved data that this build's registry doesn't declare — likely from a newer Studio version, or hand-authored. Always preserved on save, never dropped.">ⓘ</span></div>
      ${items.map(rowHtml).join('')}
    `;

    items.forEach((item, idx) => {
      if (!isScalar(item.value)) return;
      const rid = `${idPrefix}-unrec-${idx}`;
      const toggleBtn = wrap.querySelector(`#${rid}-toggle`);
      const panel = wrap.querySelector(`#${rid}-panel`);
      const cancelBtn = wrap.querySelector(`#${rid}-cancel`);
      const saveBtn = wrap.querySelector(`#${rid}-save`);
      const inputEl = wrap.querySelector(`#${rid}-input`);

      toggleBtn?.addEventListener('click', () => panel.classList.toggle('hidden'));
      cancelBtn?.addEventListener('click', () => {
        if (typeof item.value === 'boolean') inputEl.checked = item.value;
        else inputEl.value = item.value;
        panel.classList.add('hidden');
      });
      saveBtn?.addEventListener('click', () => {
        const valueType = typeof item.value;
        let next;
        if (valueType === 'boolean') {
          next = inputEl.checked;
        } else if (valueType === 'number') {
          next = Number(inputEl.value);
          if (Number.isNaN(next)) { showToast('Not a valid number.'); return; }
        } else {
          next = inputEl.value;
        }
        onCommit(item.path, next);
      });
    });

    return wrap;
  }

  /** The registry's {path, equals|equalsAny|notEquals} showWhen grammar, with default fallback. */
  evaluateShowWhen(comp, showWhen, siblingFields) {
    return evaluateShowWhen(this, comp, showWhen, siblingFields);
  }

  /** path's last segment, camelCase -> "Title Case", with a couple of acronym fixups. */
  humanizeFieldLabel(path) {
    return humanizeFieldLabel(this, path);
  }

  fieldDomId(path) {
    return fieldDomId(this, path);
  }

  /** Rewrites a Base `style.*` path onto a state or rule target's storage. */
  remapAppearancePath(path, target) {
    return remapAppearancePath(this, path, target);
  }

  /** Retargets Appearance fields at a state or rule, recording `originalPath` and `inheritedValue`. */
  retargetAppearanceFields(comp, fields, target) {
    return retargetAppearanceFields(this, comp, fields, target);
  }

  /** Renders the Typography/Layout/Border/Background field engine for one Appearance target. */
  renderAppearanceSection(comp, mount, target, baseThemeCtx) {
    return renderAppearanceSection(this, comp, mount, target, baseThemeCtx);
  }

  /** Renders the Base-only theme-aware color fields and the hand-coded Background group. */
  renderBaseThemeAwareAppearanceFields(comp, groupName, mount, ctx) {
    return renderBaseThemeAwareAppearanceFields(this, comp, groupName, mount, ctx);
  }

  /** Renders registry fields under one heading per group, in first-seen order. */
  renderRegistryFieldGroups(comp, body, fields) {
    return renderRegistryFieldGroups(this, comp, body, fields);
  }

  /** Dispatches each registry field to FIELD_RENDERERS; an unregistered control throws. */
  renderRegistryFields(comp, mount, fields, target, groupCoveredPaths) {
    return renderRegistryFields(this, comp, mount, fields, target, groupCoveredPaths);
  }

  /** Builds a curated compound group as one row, or singly when fewer than two members survive. */
  renderCompoundGroup(comp, mount, group, fields, target, groupCoveredPaths, fieldKey) {
    return renderCompoundGroup(this, comp, mount, group, fields, target, groupCoveredPaths, fieldKey);
  }

  /** Assembles the `.prop-field-compound` row shared by registry and hand-built compound rows. */
  assembleCompoundRow(testId, items) {
    return assembleCompoundRow(this, testId, items);
  }

  /** Builds one field wrap (override, suppression, tier, test id, control), or null when it renders nothing. */
  buildFieldWrap(comp, field, fields, target, groupCoveredPaths) {
    return buildFieldWrap(this, comp, field, fields, target, groupCoveredPaths);
  }

  /** Words why a showWhen-gated field is currently hidden. */
  formatShowWhenReason(showWhen) {
    return formatShowWhenReason(this, showWhen);
  }

  /** Stored value, else inherited value (dimmed), else the registered default. */
  resolveEffectiveValue(comp, field) {
    return resolveEffectiveValue(this, comp, field);
  }

  /**
   * A Rotary's Feel field advertises a minimum, as its `min` attribute and a tooltip note,
   * only in Pulse Arc and Pulse Scrub. Which floor that is (and in what unit) depends on
   * two sibling props, so it cannot be a static registry key: it is computed here at
   * render time. The smallest floor of Absolute and Pulse Tap is enforced on commit but
   * not advertised. renderInner() rebuilds the whole panel on
   * every commit, so a Gesture or write mode change re-runs this with no listener.
   *
   * The Gesture and write mode go in as stored, unset included: resolveFeelFloor applies
   * the engine's own defaults, so a Rotary that never stored a Gesture is still judged as
   * the Arc Rotary it runs as. A value typed below the minimum is committed as the floor
   * (see commitRotaryFeelEntry), while a file that already stores a finer Feel is left as
   * stored and floored by the engine at runtime.
   *
   * @returns {{min: number, tooltipNote: string}|null} null when the floor is only the
   *   smallest Feel any Rotary accepts, which the field does not advertise.
   */
  resolveFeelFloorHint(comp, field) {
    return resolveFeelFloorHint(this, comp, field);
  }

  /**
   * The Feel field's Pulse reading — label and a live "N steps per revolution" note — or
   * null for every other field and for a Rotary whose Feel keeps its usual meaning
   * (Absolute, Tap). Recomputed on every render like resolveFeelFloorHint, so a Write Mode
   * or Gesture change updates it with no listener.
   */
  resolvePulseFeelDescription(comp, field, feel) {
    return resolvePulseFeelDescription(this, comp, field, feel);
  }

  renderPlainField(comp, field, mount, inputType) {
    return renderPlainField(this, comp, field, mount, inputType);
  }

  renderCheckboxField(comp, field, mount) {
    return renderCheckboxField(this, comp, field, mount);
  }

  renderSelectField(comp, field, mount) {
    return renderSelectField(this, comp, field, mount);
  }

  renderColorField(comp, field, mount) {
    return renderColorField(this, comp, field, mount);
  }

  /** Renders visible row-list columns and commits edits through the field transaction path. */
  renderRowListField(comp, field, mount) {
    return renderRowListField(this, comp, field, mount);
  }

  /** Renders the widget current state-variable choices for this field. */
  renderStateVarField(comp, field, mount) {
    return renderStateVarField(this, comp, field, mount);
  }

  /** Renders the widget current asset choices for this field. */
  renderAssetField(comp, field, mount) {
    return renderAssetField(this, comp, field, mount);
  }

  /** Renders a registry range field through the Inspector transaction path. */
  renderRangeField(comp, field, mount) {
    return renderRangeField(this, comp, field, mount);
  }

  /** Renders the pivot X/Y coordinates; omitted coordinates retain the centered 50% default. */
  renderPivotField(comp, field, mount) {
    return renderPivotField(this, comp, field, mount);
  }

  updateCompProp(comp, propKey, value) {
    return updateCompProp(this, comp, propKey, value);
  }

  /** Opens the interaction editor; preserves the Promise and edit-index default. */
  async openAddInteractionModal(comp, editIdx = null) {
    return openAddInteractionModal(this, comp, editIdx);
  }

  /** Opens the Connect dialog for a read or write binding and awaits its state update or cancellation. */
  async openConnectDialog(comp, def, kind, bindingField = (kind === 'write' ? 'writeEvent' : 'readSimVar')) {
    return openConnectDialog(this, comp, def, kind, bindingField);
  }

  /** Summarizes grid placement, layer group and pass-through for a collapsed section header. */
  buildLayoutBadge(comp) {
    return buildLayoutBadge(this, comp);
  }

  /** Summarizes conditional rules or whether the base style is customized. */
  buildAppearanceBadge(comp) {
    return buildAppearanceBadge(this, comp);
  }

  /** Summarizes the data binding. */
  buildDataBadge(comp) {
    return buildDataBadge(this, comp);
  }

  /** Summarizes interaction count, conditional visibility and guard. */
  buildBehaviorBadge(comp) {
    return buildBehaviorBadge(this, comp);
  }

  /** Builds one accordion section (or a flat tab section when `nonCollapsible`) and records its section JSON. */
  buildAccordionGroup(title, isOpenDefault, renderFn, badge, jsonData, nonCollapsible = false) {
    return buildAccordionGroup(this, title, isOpenDefault, renderFn, badge, jsonData, nonCollapsible);
  }
}
