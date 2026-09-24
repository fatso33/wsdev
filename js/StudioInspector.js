/**
 * StudioInspector.js
 * Right Sidebar Property Inspector for Flight Deck Widget Studio
 * Organized into intuitive, structured accordion property groups adhering strictly to FDWS v1.4
 */

import { StudioValidator, isWriteEventConsumed, proposeWireUp, SELF_DISPATCHING_WRITE_EVENT_TYPES, findUnrecognisedComponentPaths, findUnrecognisedDefPaths } from './StudioValidator.js';
import { SecurityValidator } from '../core/SecurityValidator.js';
import { getDeckEventsByKind, getDeckEventsByCategory, DECK_EVENTS, DECK_EVENT_NAMES } from '../core/deckEvents.js';
import { extractCustomDeckEvents } from '../core/widgetVarExtractor.js';
import { getPackSuggestedEvents } from '../core/deckEventPacks.js';
import { openModal, confirmModal, showToast } from './StudioModal.js';
import { summarizeCondition, computeScrollAnchorDelta } from './InspectorLogic.js';
// Widget Studio 2.0, Phase 1: TRIGGERS/ACTIONS are now read from
// PropertyRegistry.js instead of being hand-copied arrays here — the exact
// "UI list is stale relative to runtime" bug class found four times in the
// original Studio audit (this file's own trigger/action lists were two of
// those four instances).
import { TRIGGERS as REGISTRY_TRIGGERS, ACTIONS as REGISTRY_ACTIONS, TYPE_FIELDS as REGISTRY_TYPE_FIELDS, getFieldsForType } from '../widgets/PropertyRegistry.js';
import { themeAdjustColor, themeAdjustGradient } from '../widgets/components/ThemeColor.js';
import { CUSTOM_OPTION_VALUE, GRADIENT_VALUE_RE, escapeHtmlAttr, CATEGORY_LABELS } from './inspector/inspectorMarkup.js';
import { createFieldRenderers } from './inspector/fieldRenderers.js';
import { getFieldValue, commitRotaryFeelContext, commitRotaryFeelEntry, commitField, updateCompProp, updateCompJsonProp } from './inspector/InspectorEdits.js';
import { enhanceNumberInputs, getNumberStep, decimalPlaces, roundToDecimals, renderRangeEditor, renderRowListEditor, toHexColor, wireColorPair, humanizeFieldLabel, fieldDomId, resolveFeelFloorHint, resolvePulseFeelDescription, renderPlainField, renderCheckboxField, renderSelectField, renderColorField, renderRowListField, renderStateVarField, renderAssetField, renderRangeField, renderPivotField } from './inspector/ui/FieldFactory.js';
import { renderRegistryFieldGroups, renderRegistryFields, renderCompoundGroup, assembleCompoundRow, buildFieldWrap, formatShowWhenReason, evaluateShowWhen, resolveEffectiveValue } from './inspector/ui/FieldGroups.js';
import { buildModeToggle, tierHidesField, applyUiMode, applySubtitleVisibility, applyTierMoreBadges, applySectionJsonViews, buildInspectorTabShell, buildLayoutBadge, buildAppearanceBadge, buildDataBadge, buildBehaviorBadge, buildAccordionGroup } from './inspector/InspectorShell.js';
import { renderComponentAppearance, getThemeEditContext, remapAppearancePath, retargetAppearanceFields, renderAppearanceSection, renderBaseThemeAwareAppearanceFields } from './inspector/sections/AppearanceSection.js';
import { buildMultiSelectStyleProxy, applyMultiSelectFieldAvailability, renderMultiSelectInspector } from './inspector/MultiSelectInspector.js';
// Widget Studio 2.0, Phase 2: interactions[].feedback (FDWS v1.2 §4.1 haptic/
// audio) — a real, working runtime feature since v1.2 that never had Studio
// UI until now. Not imported from PropertyRegistry.js's INTERACTION_FIELDS
// directly (that array documents the two sub-fields for future registry-
// driven rendering) — this modal still hand-builds its markup like every
// other action-specific field here, so the two are wired by hand below,
// consistent with the rest of this modal's un-generic-ized fields.

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



// V14 ("Use This Component's Own Value"): a fourth option shared by every
// condition-source dropdown (visibleWhen row, style.rules condition, an
// interaction's "Only Run If"), alongside declared state[] vars and the
// existing Custom/nested-path escape hatch. Picking it declares (or reuses)
// a syncFrom state var mirroring the CURRENTLY SELECTED component's own
// binding.readSimVar — the "hop nothing in the UI points at" the proposal's
// V14/G8 finding describes. One shared fragment so the three editors can't
// drift in wording/ordering; each editor still wires its own commit timing.
const OWN_VALUE_OPTION = '__own_value__';
function conditionStateOptionsHtml(stateVars, currentValue, ownValueSelected, ownValueSimVar) {
  const isCustom = !ownValueSelected && !!currentValue && !stateVars.some((s) => s.name === currentValue);
  return `
    <option value="">— state var —</option>
    ${ownValueSimVar ? `<option value="${OWN_VALUE_OPTION}" ${ownValueSelected ? 'selected' : ''} title="Declares (or reuses) a state variable that mirrors this component's own binding, so its live value can drive this condition.">Use This Component's Own Value</option>` : ''}
    ${stateVars.map((s) => `<option value="${escapeHtmlAttr(s.name)}" ${!ownValueSelected && currentValue === s.name ? 'selected' : ''}>${escapeHtmlAttr(s.name)}</option>`).join('')}
    <option value="${CUSTOM_OPTION_VALUE}" ${isCustom ? 'selected' : ''}>Custom / nested path…</option>
  `;
}

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
    const def = this.state.widgetDef;

    // Header
    const header = document.createElement('div');
    header.className = 'inspector-header';
    header.innerHTML = `
      <div class="inspector-title-row">
        <span class="inspector-badge">WIDGET</span>
        <h3 class="inspector-title">${def.meta?.name || 'Untitled Widget'}</h3>
        ${this.uiTier === 'full' ? '<button type="button" class="bar-btn" id="btn-full-json">{ } Full JSON</button>' : ''}
      </div>
      <div class="inspector-sub">${def.id || 'com.flightdeck.widget'} (FDWS v${def.fdws || '1.1'})</div>
    `;
    this.container.appendChild(header);
    header.querySelector('#btn-full-json')?.addEventListener('click', () => this.openFullJsonPanel());

    // Build tab shell (reusing ticket 01's mechanism and design tokens)
    const { tabBar, panelsContainer, panels } = this.buildInspectorTabShell();
    this.container.appendChild(tabBar);
    this.container.appendChild(panelsContainer);

    // Group 1: Metadata & Identification
    panels['general'].appendChild(this.buildAccordionGroup('METADATA & SPECIFICATION', true, (body) => {
      body.innerHTML = `
        <div class="prop-field">
          <label>Display Name (Title)</label>
          <input type="text" id="w-meta-name" class="prop-input" value="${def.meta?.name || ''}" placeholder="e.g. NAV 1 Radio" />
        </div>
        <div class="prop-row-2" data-tier="build">
          <div class="prop-field">
            <label>Short Name</label>
            <input type="text" id="w-meta-short" class="prop-input" value="${def.meta?.shortName || ''}" placeholder="NAV1" />
          </div>
          <div class="prop-field">
            <label>Category</label>
            <select id="w-meta-category" class="prop-select">
              <option value="Avionics" ${def.meta?.category === 'Avionics' ? 'selected' : ''}>Avionics</option>
              <option value="Controls" ${def.meta?.category === 'Controls' ? 'selected' : ''}>Controls</option>
              <option value="Gauges" ${def.meta?.category === 'Gauges' ? 'selected' : ''}>Gauges</option>
              <option value="Alerts" ${def.meta?.category === 'Alerts' ? 'selected' : ''}>Alerts</option>
              <option value="Utilities" ${def.meta?.category === 'Utilities' ? 'selected' : ''}>Utilities</option>
            </select>
          </div>
        </div>
        <div class="prop-field" data-tier="build">
          <label>Package ID (Reverse-DNS)</label>
          <input type="text" id="w-id" class="prop-input" value="${def.id || ''}" placeholder="com.author.widgetname" />
        </div>
        <div class="prop-row-2" data-tier="build">
          <div class="prop-field">
            <label>Revision</label>
            <input type="number" id="w-revision" class="prop-input" value="${def.revision || 1}" min="1" />
          </div>
          <div class="prop-field">
            <label>Author</label>
            <input type="text" id="w-author" class="prop-input" value="${def.meta?.author || ''}" placeholder="Author Name" />
          </div>
        </div>
        <div class="prop-field" data-tier="build">
          <label>Description</label>
          <textarea id="w-desc" class="prop-textarea" rows="2" placeholder="Brief widget description...">${def.meta?.description || ''}</textarea>
        </div>
      `;

      body.querySelector('#w-meta-name')?.addEventListener('change', (e) => this.state.updateWidgetMeta({ name: e.target.value }));
      body.querySelector('#w-meta-short')?.addEventListener('change', (e) => this.state.updateWidgetMeta({ shortName: e.target.value }));
      body.querySelector('#w-meta-category')?.addEventListener('change', (e) => this.state.updateWidgetMeta({ category: e.target.value }));
      body.querySelector('#w-id')?.addEventListener('change', (e) => this.state.updateWidgetMeta({ id: e.target.value }));
      body.querySelector('#w-revision')?.addEventListener('change', (e) => this.state.updateWidgetMeta({ revision: parseInt(e.target.value, 10) || 1 }));
      body.querySelector('#w-author')?.addEventListener('change', (e) => this.state.updateWidgetMeta({ author: e.target.value }));
      body.querySelector('#w-desc')?.addEventListener('change', (e) => this.state.updateWidgetMeta({ description: e.target.value }));
    }, undefined, {
      // G10: id/revision live on `def` directly, everything else under `def.meta` —
      // see StudioState.updateWidgetMeta(), which lifts only those two out of the
      // meta spread. Mirroring that split here rather than showing `def.meta` alone.
      name: def.meta?.name, shortName: def.meta?.shortName, category: def.meta?.category,
      id: def.id, revision: def.revision, author: def.meta?.author, description: def.meta?.description
    }));

    // Group 2: Grid Layout & Sizing
    panels['general'].appendChild(this.buildAccordionGroup('GRID & DIMENSIONS', false, (body) => {
      const layout = def.layout || {};
      const grid = layout.grid || { columns: 12, rows: 6 };

      body.innerHTML = `
        <div class="prop-section-subtitle" data-tier="build">Internal Sub-Grid</div>
        <div class="prop-row-2" data-tier="build">
          <div class="prop-field">
            <label>Sub-Grid Columns</label>
            <input type="number" id="w-grid-cols" class="prop-input" value="${grid.columns || 12}" min="2" max="64" />
          </div>
          <div class="prop-field">
            <label>Sub-Grid Rows</label>
            <input type="number" id="w-grid-rows" class="prop-input" value="${grid.rows || 6}" min="2" max="64" />
          </div>
        </div>

        <div class="prop-section-subtitle" style="margin-top:10px;" data-tier="build">Page Slot Footprint (Columns × Rows)</div>
        <div class="prop-row-2" data-tier="build">
          <div class="prop-field">
            <label>Default Width (W)</label>
            <input type="number" id="w-def-w" class="prop-input" value="${layout.defaultW || 8}" min="1" max="44" />
          </div>
          <div class="prop-field">
            <label>Default Height (H)</label>
            <input type="number" id="w-def-h" class="prop-input" value="${layout.defaultH || 4}" min="1" max="44" />
          </div>
        </div>
        <div class="prop-row-2" data-tier="advanced">
          <div class="prop-field">
            <label>Min Size (W × H)</label>
            <div style="display:flex;gap:4px;">
              <input type="number" id="w-min-w" class="prop-input" value="${layout.minW || 4}" min="1" placeholder="Min W" />
              <input type="number" id="w-min-h" class="prop-input" value="${layout.minH || 2}" min="1" placeholder="Min H" />
            </div>
          </div>
          <div class="prop-field">
            <label>Max Size (W × H)</label>
            <div style="display:flex;gap:4px;">
              <input type="number" id="w-max-w" class="prop-input" value="${layout.maxW || 44}" min="1" placeholder="Max W" />
              <input type="number" id="w-max-h" class="prop-input" value="${layout.maxH || 44}" min="1" placeholder="Max H" />
            </div>
          </div>
        </div>
      `;

      body.querySelector('#w-grid-cols')?.addEventListener('change', (e) => {
        this.state.updateWidgetLayout({ grid: { columns: parseInt(e.target.value, 10) || 12, rows: grid.rows } });
      });
      body.querySelector('#w-grid-rows')?.addEventListener('change', (e) => {
        this.state.updateWidgetLayout({ grid: { columns: grid.columns, rows: parseInt(e.target.value, 10) || 6 } });
      });
      body.querySelector('#w-def-w')?.addEventListener('change', (e) => this.state.updateWidgetLayout({ defaultW: parseInt(e.target.value, 10) || 8 }));
      body.querySelector('#w-def-h')?.addEventListener('change', (e) => this.state.updateWidgetLayout({ defaultH: parseInt(e.target.value, 10) || 4 }));
      body.querySelector('#w-min-w')?.addEventListener('change', (e) => this.state.updateWidgetLayout({ minW: parseInt(e.target.value, 10) || 4 }));
      body.querySelector('#w-min-h')?.addEventListener('change', (e) => this.state.updateWidgetLayout({ minH: parseInt(e.target.value, 10) || 2 }));
      body.querySelector('#w-max-w')?.addEventListener('change', (e) => this.state.updateWidgetLayout({ maxW: parseInt(e.target.value, 10) || 44 }));
      body.querySelector('#w-max-h')?.addEventListener('change', (e) => this.state.updateWidgetLayout({ maxH: parseInt(e.target.value, 10) || 44 }));
    // G10: def.layout can itself be undefined (this section's own body above
    // already guards with `const layout = def.layout || {};`) — normalized the
    // same way, same reasoning as DECK EVENTS' jsonData above.
    }, undefined, def.layout || {}));

    // Group 3: Widget Canvas Appearance & Border
    panels['style'].appendChild(this.buildAccordionGroup('CANVAS APPEARANCE & BORDER', false, (body) => {
      const style = def.style || {};
      const border = style.border || { width: 1, color: '#1f2937', radius: 10 };
      const bg = style.background || { type: 'color', color: '#0b0f17' };
      const themeEdit = this.getThemeEditContext();
      // FDWS v1.18: in Manual mode, while the canvas is previewing the
      // non-base theme, Border Color and the whole Background block target
      // style.themeOverride instead of style.* — see getThemeEditContext().
      const override = style.themeOverride || {};
      const rootColorCtx = { componentType: 'widget-root', layerGroup: 'background' };
      const effBorderColor = themeEdit.isOverrideEdit
        ? (override.border?.color ?? themeAdjustColor(border.color, { ...rootColorCtx, colorKind: 'border' }, this.state.previewTheme, themeEdit.baseTheme))
        : border.color;
      const effBg = themeEdit.isOverrideEdit
        ? (override.background || (
            bg.type === 'color' && bg.color
              ? { ...bg, color: themeAdjustColor(bg.color, { ...rootColorCtx, colorKind: 'background' }, this.state.previewTheme, themeEdit.baseTheme) }
              : bg.type === 'gradient' && bg.gradient
                ? { ...bg, gradient: themeAdjustGradient(bg.gradient, rootColorCtx, this.state.previewTheme, themeEdit.baseTheme) }
                : bg
          ))
        : bg;

      body.innerHTML = `
        ${themeEdit.isOverrideEdit ? `<div class="theme-override-banner">Editing ${this.state.previewTheme.toUpperCase()} theme override</div>` : ''}
        <div class="prop-row-2" data-tier="build">
          <div class="prop-field">
            <label>Border Width (px)</label>
            <input type="number" id="w-border-w" class="prop-input" value="${border.width ?? 1}" min="0" max="10" ${themeEdit.isOverrideEdit ? 'disabled title="Structural — edit on the base theme."' : ''} />
          </div>
          <div class="prop-field">
            <label>Corner Radius (px)</label>
            <input type="number" id="w-border-rad" class="prop-input" value="${border.radius ?? 10}" min="0" max="24" ${themeEdit.isOverrideEdit ? 'disabled title="Structural — edit on the base theme."' : ''} />
          </div>
        </div>
        <div class="prop-field" data-tier="build">
          <label>Border Color</label>
          <div class="color-picker-wrap">
            <button type="button" class="color-swatch" id="w-border-clr-pick" data-color="${this.toHexColor(effBorderColor) || '#1f2937'}" style="background:${this.toHexColor(effBorderColor) || '#1f2937'}" aria-label="Pick color"></button>
            <input type="text" id="w-border-clr-txt" class="prop-input" value="${effBorderColor || '#1f2937'}" />
          </div>
        </div>

        <div class="prop-field" style="margin-top:10px;" data-tier="build">
          <label>Background Type</label>
          <select id="w-bg-type" class="prop-select">
            <option value="color" ${effBg.type === 'color' ? 'selected' : ''}>Solid Color</option>
            <option value="gradient" ${effBg.type === 'gradient' ? 'selected' : ''}>CSS Gradient</option>
            <option value="image" ${effBg.type === 'image' ? 'selected' : ''}>Embedded Asset Image</option>
          </select>
        </div>
        <div id="w-bg-custom-field" class="prop-field" data-tier="build">
          <label>Background Value</label>
          ${effBg.type === 'color' ? `
            <div class="color-picker-wrap">
              <button type="button" class="color-swatch" id="w-bg-val-pick" data-color="${this.toHexColor(effBg.color) || '#0b0f17'}" style="background:${this.toHexColor(effBg.color) || '#0b0f17'}" aria-label="Pick color"></button>
              <input type="text" id="w-bg-val" class="prop-input" value="${effBg.color || '#0b0f17'}" />
            </div>
          ` : `
            <input type="text" id="w-bg-val" class="prop-input" value="${effBg.gradient || effBg.image?.assetId || ''}" />
          `}
        </div>
      `;

      const updateBorder = (updates) => {
        const curBorder = this.state.widgetDef.style?.border || {};
        this.state.updateWidgetStyle({ border: { ...curBorder, ...updates } });
      };
      const updateBorderColor = (color) => {
        if (themeEdit.isOverrideEdit) {
          const curOverride = this.state.widgetDef.style?.themeOverride || {};
          this.state.updateWidgetStyle({ themeOverride: { ...curOverride, border: { ...(curOverride.border || {}), color } } });
        } else {
          updateBorder({ color });
        }
      };
      const updateBg = (nextBg) => {
        if (themeEdit.isOverrideEdit) {
          const curOverride = this.state.widgetDef.style?.themeOverride || {};
          this.state.updateWidgetStyle({ themeOverride: { ...curOverride, background: nextBg } });
        } else {
          this.state.updateWidgetStyle({ background: nextBg });
        }
      };

      body.querySelector('#w-border-w')?.addEventListener('change', (e) => updateBorder({ width: parseInt(e.target.value, 10) || 0 }));
      body.querySelector('#w-border-rad')?.addEventListener('change', (e) => updateBorder({ radius: parseInt(e.target.value, 10) || 0 }));
      this.wireColorPair(body, 'w-border-clr-pick', 'w-border-clr-txt', updateBorderColor);

      body.querySelector('#w-bg-type')?.addEventListener('change', (e) => {
        const type = e.target.value;
        if (type === 'color') updateBg({ type: 'color', color: '#0b0f17' });
        if (type === 'gradient') updateBg({ type: 'gradient', gradient: 'linear-gradient(180deg, #141a24 0%, #0b0f17 100%)' });
        if (type === 'image') updateBg({ type: 'image', image: { assetId: this.state.widgetDef.assets?.[0]?.id || '' } });
      });

      // #w-bg-val doubles as the color/gradient/asset-id value field depending
      // on Background Type — only the "color" case has a paired swatch
      // (#w-bg-val-pick), so only that case goes through wireColorPair (V22);
      // gradient/image stay a single plain text field on 'change', unchanged.
      const bgValApplyFn = (value) => {
        const bgType = body.querySelector('#w-bg-type').value;
        if (bgType === 'color' && GRADIENT_VALUE_RE.test(value.trim())) {
          updateBg({ type: 'gradient', gradient: value.trim() });
          showToast('That looks like a CSS gradient, not a color — switched Background Type to "CSS Gradient" so it stays theme-aware.');
          this.render();
          return;
        }
        if (bgType === 'color') updateBg({ type: 'color', color: value });
        if (bgType === 'gradient') updateBg({ type: 'gradient', gradient: value });
        if (bgType === 'image') updateBg({ type: 'image', image: { assetId: value } });
      };
      if (effBg.type === 'color') {
        this.wireColorPair(body, 'w-bg-val-pick', 'w-bg-val', bgValApplyFn, { allowGradient: true });
      } else {
        body.querySelector('#w-bg-val')?.addEventListener('change', (e) => bgValApplyFn(e.target.value));
      }
    // G10: def.style can itself be undefined (this section's own body above
    // already guards with `const style = def.style || {};`) — same reasoning
    // as DECK EVENTS'/GRID & DIMENSIONS' jsonData above.
    }, undefined, def.style || {}));

    // Group 3.5: Theme (FDWS v1.18) — which theme style.* was authored for,
    // and whether the OTHER theme is auto-derived (default) or manually
    // authored via each component's style.themeOverride.
    panels['style'].appendChild(this.buildAccordionGroup('THEME', false, (body) => {
      const baseTheme = def.baseTheme === 'light' ? 'light' : 'dark';
      const themeMode = def.themeMode === 'manual' ? 'manual' : 'auto';
      const otherTheme = baseTheme === 'light' ? 'dark' : 'light';

      body.innerHTML = `
        <div class="prop-field" data-tier="build">
          <label>Designed For <span class="prop-hint" title="Which theme this widget's style properties are literally authored for. Every component's style.* is that theme's color — switching this does NOT recolor anything, it just changes which theme is treated as the base.">ⓘ</span></label>
          <select id="w-theme-base" class="prop-select">
            <option value="dark" ${baseTheme === 'dark' ? 'selected' : ''}>Dark</option>
            <option value="light" ${baseTheme === 'light' ? 'selected' : ''}>Light</option>
          </select>
        </div>
        <div class="prop-field" data-tier="advanced">
          <label>${otherTheme === 'light' ? 'Light' : 'Dark'} Theme <span class="prop-hint" title="Auto: the app's dark/light switcher derives this theme's colors automatically from the ones above. Manual: author it yourself, field by field, per component.">ⓘ</span></label>
          <select id="w-theme-mode" class="prop-select">
            <option value="auto" ${themeMode === 'auto' ? 'selected' : ''}>Auto-derive</option>
            <option value="manual" ${themeMode === 'manual' ? 'selected' : ''}>Manual</option>
          </select>
        </div>
        ${themeMode === 'manual' ? `
          <div class="empty-tree-notice" style="margin-top:8px;" data-tier="advanced">
            Switch the canvas's Live Theme Preview (sun/moon button) to <strong>${otherTheme}</strong> to edit that theme's colors — every component's Text/Stroke/Glow/Border/Border Glow/Background Color fields will target the ${otherTheme} override instead of the base ${baseTheme} style. New components start from an auto-derived ${otherTheme} color you can then adjust.
          </div>
        ` : ''}
      `;

      body.querySelector('#w-theme-base')?.addEventListener('change', (e) => {
        this.state.updateWidgetThemeConfig({ baseTheme: e.target.value });
        this.render();
      });
      body.querySelector('#w-theme-mode')?.addEventListener('change', (e) => {
        this.state.updateWidgetThemeConfig({ themeMode: e.target.value });
        showToast(e.target.value === 'manual'
          ? `Manual mode on — every component's ${otherTheme}-theme colors were seeded from the current auto-derived values.`
          : `${otherTheme === 'light' ? 'Light' : 'Dark'} theme is auto-derived again.`);
        this.render();
      });
    }, undefined, { baseTheme: def.baseTheme, themeMode: def.themeMode }));

    // Add empty Data tab message
    const dataEmpty = document.createElement('div');
    dataEmpty.className = 'empty-tree-notice';
    dataEmpty.style.padding = '16px';
    dataEmpty.textContent = 'No properties available';
    panels['data'].appendChild(dataEmpty);

    // Group 3b: FDWS v1.27 (1.0-A) — Deck Events this widget declares, with the
    // binding each one should default to. Authoring UI ships with the spec
    // field, per the standing rule that no FDWS addition goes out JSON-only.
    panels['events'].appendChild(this.buildAccordionGroup('DECK EVENTS (v1.27)', false, (body) => {
      const events = def.deckEvents || [];
      // Part 2, Slice 3: wholly Full-tier (declaring custom Deck Events for
      // other authors' profile mapping is advanced work, not build-a-widget
      // work) — one wrap around the whole section rather than tagging every
      // row, since the entire section hides or shows together.
      body.innerHTML = `
        <div data-tier="advanced">
        <p class="prop-help">
          Names this widget binds to, plus the SimVar/event each should map to by
          default. PC Bridge copies a suggestion into its profile table on
          install, so the widget arrives working instead of leaving empty rows.
          A row the user later edits is never overwritten by an update.
        </p>
        <p class="prop-help">
          Namespace custom names with a dot — <code>fenix.xpndrIdent</code> — so
          two authors can each define an "xpndrIdent" without colliding. A name
          matching a built-in Deck Event is rejected on import.
        </p>
        <div id="de-list"></div>
        <button id="de-add" class="panel-full-btn" style="margin-top:8px;">+ Declare a Deck Event</button>
        </div>
      `;

      const list = body.querySelector('#de-list');
      if (!events.length) {
        list.innerHTML = '<div class="caps-empty" style="padding:6px 0;">None declared.</div>';
      }
      events.forEach((ev, i) => {
        const row = document.createElement('div');
        row.className = 'de-row';
        const isRead = ev.kind === 'read';
        row.innerHTML = `
          <div class="de-row-head">
            <span class="caps-tag ${isRead ? 'read' : 'write'}">${isRead ? 'READ' : 'WRITE'}</span>
            <strong>${ev.name || '(unnamed)'}</strong>
            <button type="button" class="btn-mini-close" data-de-del="${i}" title="Remove">✕</button>
          </div>
          <div class="de-row-sub">${ev.label || ev.name || ''}${ev.category ? ' · ' + ev.category : ''}</div>
          <div class="de-row-sub">${
            isRead
              ? (ev.suggest?.simvar ? `→ ${ev.suggest.simvar}${ev.suggest.unit ? ' / ' + ev.suggest.unit : ''}` : '→ no suggested binding')
              : (ev.suggest?.event ? `⇄ ${ev.suggest.event}${ev.suggest.valueFormat ? ' / ' + ev.suggest.valueFormat : ''}` : '⇄ no suggested binding')
          }</div>
        `;
        list.appendChild(row);
      });

      body.querySelectorAll('[data-de-del]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = Number(btn.dataset.deDel);
          const next = (this.state.widgetDef.deckEvents || []).slice();
          next.splice(idx, 1);
          this.state.setDeckEvents(next);
          this.render();
        });
      });

      body.querySelector('#de-add')?.addEventListener('click', async () => {
        const result = await openModal({
          title: 'Declare a Deck Event',
          submitLabel: 'Add',
          bodyHtml: `
            <div class="modal-form-row"><label>Name</label>
              <input type="text" id="de-name" class="prop-input" placeholder="fenix.xpndrIdent" /></div>
            <div class="modal-form-row"><label>Direction</label>
              <select id="de-kind" class="prop-select">
                <option value="read">Read — telemetry in (a lamp, a readout)</option>
                <option value="write">Write — a command out (a button, a switch)</option>
              </select></div>
            <div class="modal-form-row"><label>Label</label>
              <input type="text" id="de-label" class="prop-input" placeholder="Fenix Transponder Ident" /></div>
            <div class="modal-form-row"><label>Category</label>
              <input type="text" id="de-category" class="prop-input" value="custom" /></div>
            <div class="modal-form-row"><label id="de-sug-label">Suggested SimVar</label>
              <input type="text" id="de-sug-a" class="prop-input" placeholder="L:S_XPDR_IDENT" /></div>
            <div class="modal-form-row"><label id="de-sug2-label">Unit</label>
              <input type="text" id="de-sug-b" class="prop-input" placeholder="Number" /></div>
            <p class="modal-confirm-text">The suggestion is optional — without one the row installs empty and the user maps it themselves.</p>
          `,
          onMount: (card) => {
            const kind = card.querySelector('#de-kind');
            const relabel = () => {
              const w = kind.value === 'write';
              card.querySelector('#de-sug-label').textContent = w ? 'Suggested Event' : 'Suggested SimVar';
              card.querySelector('#de-sug2-label').textContent = w ? 'Value Format' : 'Unit';
              card.querySelector('#de-sug-a').placeholder = w ? 'XPNDR_IDENT_ON  or  H:A320_XPDR_IDENT' : 'L:S_XPDR_IDENT';
              card.querySelector('#de-sug-b').placeholder = w ? 'FIXED_1' : 'Number';
            };
            kind.addEventListener('change', relabel);
            relabel();
            card.querySelector('#de-name')?.focus();
          },
          onSubmit: (card) => {
            const name = card.querySelector('#de-name').value.trim();
            if (!name) return { error: 'A name is required.' };
            if (/^[ALHK]:/i.test(name)) {
              return { error: 'That is a raw address, not a Deck Event — raw addresses bypass profiles and need no declaration.' };
            }
            if (DECK_EVENT_NAMES.includes(name)) {
              return { error: `"${name}" is a built-in Deck Event. Namespace yours instead, e.g. "myaircraft.${name}".` };
            }
            if ((this.state.widgetDef.deckEvents || []).some((e) => e.name === name)) {
              return { error: `"${name}" is already declared by this widget.` };
            }
            const kind = card.querySelector('#de-kind').value;
            const a = card.querySelector('#de-sug-a').value.trim();
            const b = card.querySelector('#de-sug-b').value.trim();
            const entry = {
              name, kind,
              label: card.querySelector('#de-label').value.trim() || name,
              category: card.querySelector('#de-category').value.trim() || 'custom'
            };
            if (a) entry.suggest = kind === 'write'
              ? { event: a, ...(b ? { valueFormat: b } : {}) }
              : { simvar: a, ...(b ? { unit: b } : {}) };
            return { value: entry };
          }
        });
        if (!result) return;
        const next = (this.state.widgetDef.deckEvents || []).concat([result]);
        this.state.setDeckEvents(next);
        showToast(`Declared "${result.name}".`);
        this.render();
      });
    // G10: def.deckEvents is legitimately undefined when nothing's declared
    // (setDeckEvents() deletes the key rather than storing []) — normalized to
    // [] here (matching this section's own `const events = def.deckEvents || [];`
    // above) so the View JSON toggle still appears and shows "[]" rather than
    // silently vanishing, which buildAccordionGroup()'s jsonData!==undefined
    // recording check would otherwise treat as "no data for this section."
    }, undefined, def.deckEvents || []));

    // Group 4: Capabilities Summary (§11 Rule 5)
    panels['events'].appendChild(this.buildAccordionGroup('CAPABILITIES MATRIX (§11)', false, (body) => {
      const caps = def.capabilities || { readSimVars: [], writeEvents: [] };
      // Part 2, Slice 3: wholly Full-tier — diagnostic/export-time summary,
      // not build-time work. One wrap around the whole section, same
      // reasoning as DECK EVENTS above.
      body.innerHTML = `
        <div data-tier="advanced">
        <div class="caps-summary-box">
          <div class="caps-sub-title">READ SIMVARS (${caps.readSimVars?.length || 0}):</div>
          <div class="caps-tags-list">
            ${(caps.readSimVars || []).map((sv) => `<span class="caps-tag read">${sv}</span>`).join('') || '<span class="caps-empty">None</span>'}
          </div>

          <div class="caps-sub-title" style="margin-top:10px;">WRITE EVENTS (${caps.writeEvents?.length || 0}):</div>
          <div class="caps-tags-list">
            ${(caps.writeEvents || []).map((ev) => `<span class="caps-tag write">${ev}</span>`).join('') || '<span class="caps-empty">None</span>'}
          </div>
        </div>
        <button id="btn-sync-caps" class="panel-full-btn" style="margin-top:8px;">Sync Capabilities with Components</button>
        </div>
      `;

      body.querySelector('#btn-sync-caps')?.addEventListener('click', () => {
        StudioValidator.syncCapabilities(this.state.widgetDef);
        this.state.notify('WIDGET_META_UPDATED');
        showToast('Capabilities synchronized with components.');
      });
    // G10: def.capabilities can itself be undefined (this section's own body
    // above already guards with a default) — same reasoning as the other root
    // sections' jsonData above.
    }, undefined, def.capabilities || { readSimVars: [], writeEvents: [] }));

    // Wave 4, §10.4: a wholly new top-level def key this build's registry
    // doesn't recognise — no existing section is a "relevant group" for that
    // (we can't know what it's for), so it gets its own, appended only when
    // non-empty. No data-tier — a data-safety guarantee, not a tier-hideable
    // convenience. (Appended to general tab to keep unrecognised metadata together)
    const unrecognisedDef = findUnrecognisedDefPaths(def);
    if (unrecognisedDef.length > 0) {
      panels['general'].appendChild(this.buildAccordionGroup('UNRECOGNISED PROPERTIES', true, (body) => {
        const block = this.renderUnrecognisedPropertiesBlock(unrecognisedDef, def.fdws, 'wroot', (path, value) => {
          this.state.updateWidgetRawField(path, value);
        });
        if (block) body.appendChild(block);
      }));
    }
  }

  /**
   * Wave 4, G10: the full whole-widget JSON read/apply panel — the bigger,
   * editable sibling of Wave 2's per-section read-only JSON view
   * (applySectionJsonViews() above). Built entirely on setWidgetDef(), which
   * was already the complete, safe "apply a whole new widget definition"
   * primitive (full clone, no allowlist stripping, auto-defaults missing
   * optional arrays, resets selectedComponentId, records undo history) —
   * confirmed twice this Wave via Import's own round-trip. No new
   * state-layer code needed, this is purely a new UI surface.
   */
  async openFullJsonPanel() {
    const currentJson = JSON.stringify(this.state.widgetDef, null, 2);
    const result = await openModal({
      title: 'Full Widget JSON (Read & Apply)',
      wide: true,
      bodyHtml: `
        <p class="modal-confirm-text">Edit the widget's complete JSON definition
        directly. Apply re-validates the JSON and replaces the current widget's
        whole definition — this participates in Undo (Ctrl+Z) like any other edit.</p>
        <textarea id="full-json-textarea" class="prop-textarea full-json-textarea" spellcheck="false">${escapeHtmlAttr(currentJson)}</textarea>
      `,
      submitLabel: 'Apply',
      onSubmit: (card) => {
        const raw = card.querySelector('#full-json-textarea').value;
        let parsed;
        try {
          parsed = JSON.parse(raw);
        } catch (err) {
          return { error: `Invalid JSON: ${err.message}` };
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return { error: 'Must be a JSON object (a widget definition), not an array or a bare value.' };
        }
        return { value: parsed };
      }
    });
    if (!result) return;
    this.state.setWidgetDef(result, true, 'Apply Full JSON');
    showToast('Applied — Undo (Ctrl+Z) to revert if something looks wrong.');
  }

  /**
   * Opens a condition editor (rule condition or visibility condition) in a popover modal.
   * Shared logic extracted from duplicate handlers in renderStyleTab and renderVisibilityAndGuard.
   *
   * @param {string} title - Modal title (e.g., 'Edit Rule Condition')
   * @param {(rerender: () => void) => {html: string, wire: (mountEl: HTMLElement) => void}} buildEditor
   *        Builds a fresh {html, wire} editor from current state. Called once on mount and again
   *        after every add/remove so the popover's own DOM reflects the change in place — same
   *        local-recursive-re-render pattern the interaction modal's "Only Run If" editor already
   *        uses, rather than relying on a close/reopen to pick up the new state.
   * @returns {Promise<void>} Resolves after modal closes
   */
  async openConditionEditorPopover(title, buildEditor) {
    let mountEl;
    const render = () => {
      const editor = buildEditor(render);
      mountEl.innerHTML = editor.html;
      editor.wire(mountEl);
    };

    const result = await openModal({
      title,
      bodyHtml: '',
      onMount: (card) => {
        mountEl = card.querySelector('.modal-body');
        render();
      },
      submitLabel: 'Done',
      cancelLabel: 'Cancel',
      onSubmit: () => {
        // Just close the modal; changes are committed immediately via onCommit in the editor
        return { value: true };
      }
    });

    // After the modal closes, re-render to update the summary line
    if (result) {
      this.render();
    }
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
    ((body) => {
      const binding = comp.binding || {};
      const stateVars = def.state || [];

      // Custom Deck Events suggested from two sources: (1) already in use by
      // another widget in this Studio's saved-widget library (see
      // shared/widgetVarExtractor.js) — same provenance-scan pattern as
      // flight-deck-pwa's PropertyInspector.js, scanning localStorage's
      // 'fdws_saved_widgets' instead of PC Bridge's synced widget store —
      // and (2) any Community Deck Events Packs imported via the Library tab
      // (core/deckEventPacks.js), so a fresh install isn't limited to only
      // names this one user has already typed somewhere else.
      const savedWidgets = this.state.loadSavedWidgets().filter((w) => w.id !== def.id);
      const customDeckEvents = extractCustomDeckEvents(savedWidgets, DECK_EVENT_NAMES).map((e) => ({
        ...e,
        source: e.widgetIds.length ? `used by ${e.widgetIds.join(', ')}` : ''
      }));
      const packEvents = getPackSuggestedEvents()
        .filter((e) => !customDeckEvents.some((c) => c.name === e.name))
        .map((e) => ({ name: e.name, kind: e.kind, source: `from pack: ${e.fromPack}` }));
      const mergedCustom = [...customDeckEvents, ...packEvents];
      const customReads = mergedCustom.filter((e) => e.kind === 'read');
      const customWrites = mergedCustom.filter((e) => e.kind === 'write');

      const buildDefaultOptions = (kind, currentValue) => {
        const items = getDeckEventsByKind(kind);
        const isKnownDefault = items.some((e) => e.name === currentValue);
        return `
          <option value="" ${!currentValue && !isKnownDefault ? 'selected' : ''}>— none —</option>
          ${items.map((e) => `<option value="${e.name}" ${currentValue === e.name ? 'selected' : ''}>${e.label}</option>`).join('')}
          <option value="${CUSTOM_OPTION_VALUE}" ${currentValue && !isKnownDefault ? 'selected' : ''}>Custom…</option>
        `;
      };

      const buildCustomOptions = (entries, currentValue) => {
        const isKnownCustom = entries.some((e) => e.name === currentValue);
        const placeholder = entries.length > 0 ? '— select or type below —' : '(no custom Deck Events in use yet — try importing a Community Pack in the Library tab)';
        return `
          <option value="">${placeholder}</option>
          ${entries.map((e) => `<option value="${e.name}" ${isKnownCustom && currentValue === e.name ? 'selected' : ''}>${e.name}${e.source ? ` (${e.source})` : ''}</option>`).join('')}
        `;
      };

      // Widget Studio 2.0, Phase 8: Simple mode's guided two-step "Connect to
      // Simulator" picker — Category, then the specific value within it —
      // writes to the exact same binding.readSimVar/writeEvent field
      // Advanced mode's flat dropdown above uses. Only default (catalog)
      // Deck Events are groupable by category this way; a component already
      // bound to a custom/raw name has no matching category to preselect, so
      // both selects just start blank (still fully editable in Advanced).
      const buildConnectSimPicker = (kind, idPrefix, currentValue) => {
        const currentCategory = DECK_EVENTS.find((e) => e.kind === kind && e.name === currentValue)?.category || '';
        const categories = [...new Set(DECK_EVENTS.filter((e) => e.kind === kind).map((e) => e.category))];
        const variableOptions = currentCategory
          ? getDeckEventsByCategory(currentCategory).filter((e) => e.kind === kind).map((e) => `<option value="${e.name}" ${currentValue === e.name ? 'selected' : ''}>${e.label}</option>`).join('')
          : '';
        return `
          <select id="${idPrefix}-category" class="prop-select">
            <option value="">— choose a category —</option>
            ${categories.map((c) => `<option value="${c}" ${currentCategory === c ? 'selected' : ''}>${CATEGORY_LABELS[c] || c}</option>`).join('')}
          </select>
          <select id="${idPrefix}-variable" class="prop-select" ${currentCategory ? '' : 'disabled'}>
            <option value="">${currentCategory ? '— choose a value —' : '— choose a category first —'}</option>
            ${variableOptions}
          </select>
        `;
      };

      const readIsCustom = !!binding.readSimVar && !getDeckEventsByKind('read').some((e) => e.name === binding.readSimVar);
      // FDWS v1.2 §1.5: only a raw A:/L:/H:/K: address's unit is ours to set —
      // a bare Deck Event's unit is resolved from the active PC Bridge
      // profile, and typing a value here would just be ignored at runtime.
      const isRawAddress = /^(A|L|H|K):/i.test(binding.readSimVar || '');
      const writeIsCustom = !!binding.writeEvent && !getDeckEventsByKind('write').some((e) => e.name === binding.writeEvent);

      const ackIsCustom = !!binding.ackEvent && !getDeckEventsByKind('write').some((e) => e.name === binding.ackEvent);
      const pushIsCustom = !!binding.pushEvent && !getDeckEventsByKind('write').some((e) => e.name === binding.pushEvent);
      const stateIsCustom = !!binding.stateVar && !stateVars.some((s) => s.name === binding.stateVar);
      const isFastPoll = Number(binding.pollFrequencyHz) > 2;

      // Ticket 18: PropertyRegistry.js already declares binding.incrementEvent/
      // decrementEvent (appliesTo core.rotary, showWhen props.writeMode==='pulse')
      // but this panel is hand-built and never calls getFieldsForType() for
      // Bindings rows (see this file's renderRegistryFields doc comment) — so
      // the registry entry alone doesn't make it authorable. Two more
      // hand-built fields, same shape as Write Deck Event just above, gated
      // on Pulse mode instead of always shown. Re-evaluated fresh on every
      // render (this IIFE reruns on COMPONENT_UPDATED — see the subscribe()
      // in the constructor), so flipping Write Mode elsewhere in this same
      // panel shows/hides these without needing a reselect, and — since
      // nothing here ever clears binding.incrementEvent/decrementEvent —
      // toggling back to Absolute only hides them, it never discards a
      // value already set.
      // NOTE: the two field wraps below gate on isPulseRotary via an inline
      // `style="display:none"`, NOT the shared `.hidden` class the rest of
      // this panel uses — applyUiMode() (called after every render) does a
      // blanket `classList.toggle('hidden', ...)` over every `[data-tier]`
      // element based on tier alone, which would silently stomp a `.hidden`
      // set here for Pulse-gating instead (found live: the field rendered
      // visible regardless of Write Mode once in Full tier, since Full
      // always clears `.hidden` off `data-tier="advanced"` elements).
      // Inline style is untouched by that pass, so it composes correctly:
      // hidden if EITHER the tier system's `.hidden` OR this inline
      // display:none applies. The two custom-event blocks just below don't
      // carry `data-tier` at all, so the ordinary `.hidden`-class toggle
      // (matching every other custom block in this panel) is safe for them.
      const isPulseRotary = comp.type === 'core.rotary' && comp.props?.writeMode === 'pulse';
      const incrementIsCustom = !!binding.incrementEvent && !getDeckEventsByKind('write').some((e) => e.name === binding.incrementEvent);
      const decrementIsCustom = !!binding.decrementEvent && !getDeckEventsByKind('write').some((e) => e.name === binding.decrementEvent);

      // Acceleration's fast step events: only a Pulse Rotary with Acceleration enabled ever
      // sends them. Gated like Increment/Decrement above (inline display, so the tier pass
      // cannot undo it) and, like them, never cleared when hidden, so switching Acceleration
      // off and on again finds the events still set. Advanced tier only: they are for
      // aircraft that expose a dedicated fast step event, which is the uncommon case.
      const isFastEventRotary = isPulseRotary && comp.props?.acceleration === true;
      const fastEventFields = (kind, field, label, direction) => {
        const isCustom = !!binding[field] && !getDeckEventsByKind('write').some((e) => e.name === binding[field]);
        return `
        <div class="prop-field" data-tier="advanced" id="c-bind-${kind}-field" style="${isFastEventRotary ? '' : 'display:none;'}">
          <label>${label} <span class="prop-hint" title="FDWS v1.30: dispatched once per step turned ${direction} in the coarse Acceleration tier, in place of the ordinary event above, when Write Mode is Pulse and Acceleration is on. Bind both fast events or neither: a single one is ignored.">ⓘ</span></label>
          <select id="c-bind-${kind}" class="prop-select">${buildDefaultOptions('write', binding[field])}</select>
        </div>
        <div class="prop-field prop-custom-block ${(isFastEventRotary && isCustom) ? '' : 'hidden'}" id="c-bind-${kind}-custom-block">
          <label>Custom Deck Event (used by another saved widget)</label>
          <select id="c-bind-${kind}-custom-select" class="prop-select">${buildCustomOptions(customWrites, binding[field])}</select>
          <label>Or type a new custom event / raw SimConnect event (H:/K:...)</label>
          <div class="prop-paste-row">
            <input type="text" id="c-bind-${kind}-custom-input" class="prop-input" value="${isCustom ? (binding[field] || '') : ''}" placeholder="e.g. myCustomEvent, H:GTN750_DirectToPush" />
          </div>
          <div class="prop-sanitize-diff hidden" id="c-bind-${kind}-custom-diff"></div>
        </div>`;
      };

      body.innerHTML = `
        <div class="prop-field" data-tier="simple-only">
          <label>Connect to Simulator — Value to Show <span class="prop-hint" title="Pick a category, then the specific value this component should read. Fills in the same field Advanced mode's Read Deck Event dropdown below uses — switch to Advanced any time to see the raw name or type a custom one.">ⓘ</span></label>
          <div class="connect-sim-picker">${buildConnectSimPicker('read', 'c-connect-read', binding.readSimVar)}</div>
        </div>
        <div class="prop-hint-block" style="font-size:11px;opacity:0.75;margin:-4px 0 8px;" data-tier="simple-only">
          Don't see it? <button type="button" class="btn-mini-inline" id="c-connect-read-findit">Find it by moving it →</button>
          or <button type="button" class="btn-mini-inline" id="c-connect-read-full">switch to Full mode</button> for Raw Address / Custom.
        </div>
        <div class="prop-field" data-tier="advanced">
          <label>Read Deck Event (Telemetry In)</label>
          <div class="prop-row-2">
            <select id="c-bind-read" class="prop-select">${buildDefaultOptions('read', binding.readSimVar)}</select>
            <button type="button" class="btn-small" id="c-bind-read-connect" style="flex:0 0 auto;">Connect…</button>
          </div>
        </div>
        <div class="prop-field prop-custom-block ${readIsCustom ? '' : 'hidden'}" id="c-bind-read-custom-block">
          <label>Custom Deck Event (used by another saved widget)</label>
          <select id="c-bind-read-custom-select" class="prop-select">${buildCustomOptions(customReads, binding.readSimVar)}</select>
          <label>Or type a new custom variable / raw SimVar (L:/A:...)</label>
          <div class="prop-paste-row">
            <input type="text" id="c-bind-read-custom-input" class="prop-input" value="${readIsCustom ? (binding.readSimVar || '') : ''}" placeholder="e.g. myCustomVar, L:FBW_TAXI_LIGHT_INTENSITY" />
            <button type="button" class="btn-small" id="c-bind-read-paste">Paste</button>
          </div>
          <div class="prop-sanitize-diff hidden" id="c-bind-read-custom-diff"></div>
        </div>

        <div class="prop-row-2">
          <div class="prop-field">
            <label>Poll Rate <span class="prop-hint" title="FDWS v1.7: how often PC Bridge asks SimConnect for this value. Normal (1Hz) is right for almost everything — frequencies, switches, annunciators. Fast is for values that change continuously and need to look smooth, like an attitude indicator's pitch/bank — it routes this SimVar onto PC Bridge's fastest available SimConnect polling tier (in practice tens of Hz, tied to the sim's own update rate, not a literal guaranteed number). Every fast-tier binding reading the same SimVar should use the same setting.">ⓘ</span></label>
            <select id="c-bind-pollrate" class="prop-select">
              <option value="1" ${!isFastPoll ? 'selected' : ''}>Normal (1Hz)</option>
              <option value="100" ${isFastPoll ? 'selected' : ''}>Fast (~100Hz)</option>
            </select>
          </div>
          <div class="prop-field" data-tier="advanced">
            <label>Dead Band <span class="prop-hint" title="Minimum change in value before this binding re-renders — filters out imperceptible jitter. 0 means every update renders.">ⓘ</span></label>
            <input type="number" step="any" min="0" id="c-bind-deadband" class="prop-input" value="${binding.deadband ?? 0}" />
          </div>
        </div>

        <div class="prop-row-2" data-tier="advanced">
          <div class="prop-field">
            <label>Transition (ms) <span class="prop-hint" title="How long this binding's CSS transition eases toward a new value. Keep this short (well under the gap between updates) — a long transition against Fast-tier updates makes the display feel MORE sluggish, not less, since it ends up averaging across many stale intermediate values.">ⓘ</span></label>
            <input type="number" step="1" min="0" id="c-bind-transition-ms" class="prop-input" value="${binding.transition?.durationMs ?? ''}" placeholder="none" />
          </div>
          <div class="prop-field">
            <label>Easing</label>
            <select id="c-bind-transition-easing" class="prop-select">
              <option value="linear" ${(!binding.transition?.easing || binding.transition?.easing === 'linear') ? 'selected' : ''}>Linear</option>
              <option value="ease-out" ${binding.transition?.easing === 'ease-out' ? 'selected' : ''}>Ease Out</option>
              <option value="ease-in-out" ${binding.transition?.easing === 'ease-in-out' ? 'selected' : ''}>Ease In-Out</option>
            </select>
          </div>
        </div>

        <div class="prop-field" data-tier="advanced">
          <label>SimConnect Unit ${isRawAddress ? `<span class="prop-hint" title="Tells SimConnect what type to return the raw value as (e.g. degrees, knots, Bool, Number). Leave blank to use the host's default ('Number'). For a TEXT variable (TITLE, ATC MODEL, ATC ID) type 'string' — those have no unit at all, and reading one as a number silently returns 0.">ⓘ</span>` : `<span class="prop-hint" title="Unit is set by PC Bridge for this Deck Event.">ⓘ</span>`}</label>
          <input type="text" id="c-bind-unit" class="prop-input" value="${binding.unit || ''}" placeholder="${isRawAddress ? 'Number' : 'Unit is set by PC Bridge for this Deck Event'}" ${isRawAddress ? '' : 'disabled'} />
          <div class="prop-live-info hidden" id="c-bind-resolved-info"></div>
        </div>



        <div class="prop-field" data-tier="advanced">
          <label>Poll Group <span class="prop-hint" title="FDWS v1.26: which PC Bridge polling chunk this SimVar's data definition joins. Leave blank to default to this widget's own id — already groups all of this widget's own bindings together, away from unrelated widgets' vars. Only set this to deliberately merge chunks across widgets, or split an unusually noisy var out of an otherwise-quiet widget.">ⓘ</span></label>
          <input type="text" id="c-bind-pollgroup" class="prop-input" value="${binding.pollGroup || ''}" placeholder="(defaults to this widget's id)" />
        </div>

        <div class="prop-field" data-tier="simple-only">
          <label>Connect to Simulator — Value to Send <span class="prop-hint" title="Pick a category, then the specific command this component should send. Fills in the same field Advanced mode's Write Deck Event dropdown below uses — switch to Advanced any time to see the raw name or type a custom one.">ⓘ</span></label>
          <div class="connect-sim-picker">${buildConnectSimPicker('write', 'c-connect-write', binding.writeEvent)}</div>
        </div>
        <div class="prop-hint-block" style="font-size:11px;opacity:0.75;margin:-4px 0 8px;" data-tier="simple-only">
          Don't see it? <button type="button" class="btn-mini-inline" id="c-connect-write-findit">Find it by moving it →</button>
          or <button type="button" class="btn-mini-inline" id="c-connect-write-full">switch to Full mode</button> for Raw Address / Custom.
        </div>
        ${isPulseRotary ? `
        <div class="prop-hint-block" id="c-bind-write-pulse-note" style="font-size:11px;opacity:0.75;margin:0 0 8px;">
          Write Deck Event is not used in Pulse mode: this Rotary sends the Increment and Decrement events below instead. ${binding.writeEvent ? 'The value here is kept, so switching back to Absolute finds it, but it is not declared to PC Bridge.' : ''}
        </div>` : ''}
        <div class="prop-field" data-tier="advanced">
          <label>Write Deck Event (SimConnect Out)</label>
          <div class="prop-row-2">
            <select id="c-bind-write" class="prop-select">${buildDefaultOptions('write', binding.writeEvent)}</select>
            <button type="button" class="btn-small" id="c-bind-write-connect" style="flex:0 0 auto;">Connect…</button>
          </div>
        </div>
        <div class="prop-field prop-custom-block ${writeIsCustom ? '' : 'hidden'}" id="c-bind-write-custom-block">
          <label>Custom Deck Event (used by another saved widget)</label>
          <select id="c-bind-write-custom-select" class="prop-select">${buildCustomOptions(customWrites, binding.writeEvent)}</select>
          <label>Or type a new custom event / raw SimConnect event (H:/K:...)</label>
          <div class="prop-paste-row">
            <input type="text" id="c-bind-write-custom-input" class="prop-input" value="${writeIsCustom ? (binding.writeEvent || '') : ''}" placeholder="e.g. myCustomEvent, H:GTN750_DirectToPush" />
            <button type="button" class="btn-small" id="c-bind-write-paste">Paste</button>
          </div>
          <div class="prop-sanitize-diff hidden" id="c-bind-write-custom-diff"></div>
        </div>

        ${comp.type === 'core.rotary' ? `
        <div class="prop-field" data-tier="simple-only" id="c-bind-increment-simple-field" style="${isPulseRotary ? '' : 'display:none;'}">
          <label>Connect to Simulator — Increment Event (Pulse Clockwise) <span class="prop-hint" title="Pick a category, then the specific command dispatched once per step turned clockwise. Fills in the same field Advanced mode's Increment Deck Event dropdown below uses — switch to Advanced any time to see the raw name or type a custom one.">ⓘ</span></label>
          <div class="connect-sim-picker">${buildConnectSimPicker('write', 'c-connect-increment', binding.incrementEvent)}</div>
        </div>
        <div class="prop-hint-block" data-tier="simple-only" id="c-bind-increment-simple-hint" style="font-size:11px;opacity:0.75;margin:-4px 0 8px;${isPulseRotary ? '' : 'display:none;'}">
          Don't see it? <button type="button" class="btn-mini-inline" id="c-connect-increment-findit">Find it by moving it →</button>
          or <button type="button" class="btn-mini-inline" id="c-connect-increment-full">switch to Full mode</button> for Raw Address / Custom.
        </div>
        <div class="prop-field" data-tier="advanced" id="c-bind-increment-field" style="${isPulseRotary ? '' : 'display:none;'}">
          <label>Increment Deck Event (Pulse Clockwise) <span class="prop-hint" title="FDWS v1.30: dispatched once per step turned clockwise, when Write Mode (Range panel) is set to Pulse. Only used in Pulse mode — Absolute mode uses Write Deck Event above instead.">ⓘ</span></label>
          <div class="prop-row-2">
            <select id="c-bind-increment" class="prop-select">${buildDefaultOptions('write', binding.incrementEvent)}</select>
            <button type="button" class="btn-small" id="c-bind-increment-connect" style="flex:0 0 auto;">Connect…</button>
          </div>
        </div>
        <div class="prop-field prop-custom-block ${(isPulseRotary && incrementIsCustom) ? '' : 'hidden'}" id="c-bind-increment-custom-block">
          <label>Custom Deck Event (used by another saved widget)</label>
          <select id="c-bind-increment-custom-select" class="prop-select">${buildCustomOptions(customWrites, binding.incrementEvent)}</select>
          <label>Or type a new custom event / raw SimConnect event (H:/K:...)</label>
          <div class="prop-paste-row">
            <input type="text" id="c-bind-increment-custom-input" class="prop-input" value="${incrementIsCustom ? (binding.incrementEvent || '') : ''}" placeholder="e.g. myCustomEvent, H:GTN750_DirectToPush" />
          </div>
          <div class="prop-sanitize-diff hidden" id="c-bind-increment-custom-diff"></div>
        </div>

        <div class="prop-field" data-tier="simple-only" id="c-bind-decrement-simple-field" style="${isPulseRotary ? '' : 'display:none;'}">
          <label>Connect to Simulator — Decrement Event (Pulse Counter-Clockwise) <span class="prop-hint" title="Pick a category, then the specific command dispatched once per step turned counter-clockwise. Fills in the same field Advanced mode's Decrement Deck Event dropdown below uses — switch to Advanced any time to see the raw name or type a custom one.">ⓘ</span></label>
          <div class="connect-sim-picker">${buildConnectSimPicker('write', 'c-connect-decrement', binding.decrementEvent)}</div>
        </div>
        <div class="prop-hint-block" data-tier="simple-only" id="c-bind-decrement-simple-hint" style="font-size:11px;opacity:0.75;margin:-4px 0 8px;${isPulseRotary ? '' : 'display:none;'}">
          Don't see it? <button type="button" class="btn-mini-inline" id="c-connect-decrement-findit">Find it by moving it →</button>
          or <button type="button" class="btn-mini-inline" id="c-connect-decrement-full">switch to Full mode</button> for Raw Address / Custom.
        </div>
        <div class="prop-field" data-tier="advanced" id="c-bind-decrement-field" style="${isPulseRotary ? '' : 'display:none;'}">
          <label>Decrement Deck Event (Pulse Counter-Clockwise) <span class="prop-hint" title="FDWS v1.30: dispatched once per step turned counter-clockwise, when Write Mode (Range panel) is set to Pulse. Only used in Pulse mode — Absolute mode uses Write Deck Event above instead.">ⓘ</span></label>
          <div class="prop-row-2">
            <select id="c-bind-decrement" class="prop-select">${buildDefaultOptions('write', binding.decrementEvent)}</select>
            <button type="button" class="btn-small" id="c-bind-decrement-connect" style="flex:0 0 auto;">Connect…</button>
          </div>
        </div>
        <div class="prop-field prop-custom-block ${(isPulseRotary && decrementIsCustom) ? '' : 'hidden'}" id="c-bind-decrement-custom-block">
          <label>Custom Deck Event (used by another saved widget)</label>
          <select id="c-bind-decrement-custom-select" class="prop-select">${buildCustomOptions(customWrites, binding.decrementEvent)}</select>
          <label>Or type a new custom event / raw SimConnect event (H:/K:...)</label>
          <div class="prop-paste-row">
            <input type="text" id="c-bind-decrement-custom-input" class="prop-input" value="${decrementIsCustom ? (binding.decrementEvent || '') : ''}" placeholder="e.g. myCustomEvent, H:GTN750_DirectToPush" />
          </div>
          <div class="prop-sanitize-diff hidden" id="c-bind-decrement-custom-diff"></div>
        </div>
        ${fastEventFields('fastincrement', 'fastIncrementEvent', 'Fast Increment Deck Event (Coarse Clockwise)', 'clockwise')}
        ${fastEventFields('fastdecrement', 'fastDecrementEvent', 'Fast Decrement Deck Event (Coarse Counter-Clockwise)', 'counter-clockwise')}
        ` : ''}

        <div class="prop-field prop-custom-block ${stateIsCustom ? '' : 'hidden'}" id="c-bind-state-custom-block">
          <label>Custom / $context reference <span class="prop-hint" title="FDWS v1.3: for a popover widget, bind to data the host passed in via $context.&lt;key&gt;.value — the key must match one declared in the host's Open Widget Popover Context Map. Also used for any other raw stateVar string not in this widget's own state[] list.">ⓘ</span></label>
          <input type="text" id="c-bind-state-custom-input" class="prop-input" value="${stateIsCustom ? (binding.stateVar || '') : ''}" placeholder="e.g. $context.currentFreq.value" />
        </div>

        <div class="prop-field" data-tier="advanced">
          <label>Bind to Local State Path <span class="prop-hint" title="FDWS v1.11: unlike 'Bound Local State Var' above (a whole top-level state[] var), this addresses a specific nested/indexed value inside one — e.g. presets[0].label to show one preset slot's label on a separate core.label above its button. Uses the same 'name[index].field' path grammar as popover Context Map entries. Leave blank unless you need this — it's an alternative to the field above, not used together with it. FDWS v1.14: on core.button, this drives the button's own Primary Label reactively (falling back to the static Primary Label text in Props whenever the resolved value is empty) instead of being display-only on core.label/core.display.">ⓘ</span></label>
          <input type="text" id="c-bind-stateref" class="prop-input" value="${binding.stateRef || ''}" placeholder="e.g. presets[0].label" />
        </div>
        ${comp.type === 'core.button' ? `
          <div class="prop-field" data-tier="advanced">
            <label>Bind Sublabel to State Path <span class="prop-hint" title="FDWS v1.14: same 'name[index].field' grammar as the field above, but drives this button's Sublabel (Props panel) instead of its Primary Label — independent path, can point at a different state var entirely. Resolved value falls back to the static Sublabel text whenever empty.">ⓘ</span></label>
            <input type="text" id="c-bind-sublabelstateref" class="prop-input" value="${binding.sublabelStateRef || ''}" placeholder="e.g. presets[0].freq" />
          </div>
        ` : ''}
        ${comp.type === 'core.indicator' ? `
          <div class="prop-field" data-tier="advanced">
            <label>Test State Var <span class="prop-hint" title="FDWS v1.15: local state[] variable that, when true, forces this indicator lit regardless of its own bound value — for a 'press to test' lamp-test button. Wire the SAME state var into every indicator that should light up together, then have a button toggle that one var.">ⓘ</span></label>
            <select id="c-bind-teststatevar" class="prop-select">
              <option value="" ${!binding.testStateVar ? 'selected' : ''}>None</option>
              ${stateVars.map((s) => `<option value="${s.name}" ${binding.testStateVar === s.name ? 'selected' : ''}>${s.name} (${s.type})</option>`).join('')}
            </select>
          </div>
        ` : ''}

        <button type="button" id="c-bind-advanced-toggle" class="panel-full-btn" style="margin-top:4px;">
          ${this._bindingAdvancedOpen ? '▾' : '▸'} Advanced (Acknowledge / Push Events, Event Category)
        </button>
        <div id="c-bind-advanced-fields" class="${this._bindingAdvancedOpen ? '' : 'hidden'}">
          <div class="prop-field">
            <label>Acknowledge Event <span class="prop-hint" title="Fired when this component's built-in acknowledge/silence action is used (e.g. core.indicator annunciator ack). Rarely needed outside annunciator-style components.">ⓘ</span></label>
            <select id="c-bind-ack" class="prop-select">${buildDefaultOptions('write', binding.ackEvent)}</select>
          </div>
          <div class="prop-field prop-custom-block ${ackIsCustom ? '' : 'hidden'}" id="c-bind-ack-custom-block">
            <select id="c-bind-ack-custom-select" class="prop-select">${buildCustomOptions(customWrites, binding.ackEvent)}</select>
            <input type="text" id="c-bind-ack-custom-input" class="prop-input" value="${ackIsCustom ? (binding.ackEvent || '') : ''}" placeholder="Custom acknowledge event" />
            <div class="prop-sanitize-diff hidden" id="c-bind-ack-custom-diff"></div>
          </div>
          <div class="prop-field">
            <label>Push Event <span class="prop-hint" title="Optional second write event for a component that has a separate press action alongside its main write — dispatched on press-and-hold, for spring-loaded/momentary controls. No core component dispatches it today (core.rotary's centre push was removed in FDWS v1.30), so leave it as None unless the component you are configuring documents one.">ⓘ</span></label>
            <select id="c-bind-push" class="prop-select">${buildDefaultOptions('write', binding.pushEvent)}</select>
          </div>
          <div class="prop-field prop-custom-block ${pushIsCustom ? '' : 'hidden'}" id="c-bind-push-custom-block">
            <select id="c-bind-push-custom-select" class="prop-select">${buildCustomOptions(customWrites, binding.pushEvent)}</select>
            <input type="text" id="c-bind-push-custom-input" class="prop-input" value="${pushIsCustom ? (binding.pushEvent || '') : ''}" placeholder="Custom push event" />
            <div class="prop-sanitize-diff hidden" id="c-bind-push-custom-diff"></div>
          </div>
          <div class="prop-field">
            <label>Event Category <span class="prop-hint" title="SimConnect event category for Write/Ack/Push events. K_EVENT covers almost everything — only change this if a specific SimConnect event documents a different category.">ⓘ</span></label>
            <input type="text" id="c-bind-eventcategory" class="prop-input" value="${binding.eventCategory || 'K_EVENT'}" />
          </div>
        </div>
      `;

      const updateBinding = (updates) => {
        this.state.updateComponent(comp.id, { binding: { ...(comp.binding || {}), ...updates } });
      };

      // Wires one default-select + custom-block pair (kind: 'read'/'write'/
      // 'ack'/'push'). readSimVar uses the SimVar character class, the
      // other three are all SimConnect event names.
      const wireBindingKind = (kind, bindingField) => {
        const defaultSelect = body.querySelector(`#c-bind-${kind}`);
        const customBlock = body.querySelector(`#c-bind-${kind}-custom-block`);
        const customSelect = body.querySelector(`#c-bind-${kind}-custom-select`);
        const customInput = body.querySelector(`#c-bind-${kind}-custom-input`);
        const diffEl = body.querySelector(`#c-bind-${kind}-custom-diff`);
        const sanitizeKind = bindingField === 'readSimVar' ? 'simvar' : 'event';

        // Shows what sanitizeWithReport() would strip, live as the user
        // types — doesn't touch the field itself, just surfaces the diff
        // before a stray forum-paste character silently vanishes at
        // import/export time instead (see 0.2-D's finding: this input used
        // to be a bare .trim() with no validation at all).
        const updateDiffHint = () => {
          if (!diffEl || !customInput) return;
          const { removed } = SecurityValidator.sanitizeWithReport(sanitizeKind, customInput.value);
          if (removed.length > 0) {
            diffEl.textContent = `Removed ${removed.map((c) => `"${c}"`).join(' ')} — did you mean to paste forum syntax like "(A:TRANSPONDER IDENT:1, Bool)"? Only the cleaned text will be saved.`;
            diffEl.classList.remove('hidden');
          } else {
            diffEl.textContent = '';
            diffEl.classList.add('hidden');
          }
        };
        customInput?.addEventListener('input', updateDiffHint);

        defaultSelect?.addEventListener('change', () => {
          if (defaultSelect.value === CUSTOM_OPTION_VALUE) {
            // Just reveal the custom block — don't write back yet. Committing
            // here with the still-empty customInput value would trigger a
            // synchronous COMPONENT_UPDATED re-render (StudioState.notify()
            // has no debounce) that rebuilds this panel from that still-empty
            // value, snapping the select back to its default option and
            // hiding the block before the user can type or pick anything.
            customBlock?.classList.remove('hidden');
          } else {
            customBlock?.classList.add('hidden');
            if (customSelect) customSelect.value = '';
            if (customInput) customInput.value = '';
            updateDiffHint();
            updateBinding({ [bindingField]: defaultSelect.value || undefined });
          }
        });

        customSelect?.addEventListener('change', () => {
          if (customSelect.value && customInput) customInput.value = customSelect.value;
          updateDiffHint();
          const { cleaned } = SecurityValidator.sanitizeWithReport(sanitizeKind, customInput?.value || '');
          updateBinding({ [bindingField]: cleaned || undefined });
        });

        customInput?.addEventListener('change', () => {
          const { cleaned } = SecurityValidator.sanitizeWithReport(sanitizeKind, customInput.value);
          updateBinding({ [bindingField]: cleaned || undefined });
        });
      };

      wireBindingKind('read', 'readSimVar');
      wireBindingKind('write', 'writeEvent');
      wireBindingKind('ack', 'ackEvent');
      wireBindingKind('push', 'pushEvent');
      if (comp.type === 'core.rotary') {
        wireBindingKind('increment', 'incrementEvent');
        wireBindingKind('decrement', 'decrementEvent');
        wireBindingKind('fastincrement', 'fastIncrementEvent');
        wireBindingKind('fastdecrement', 'fastDecrementEvent');
      }

      // Part 5a, Slice 1: additive — the dropdown/custom-input fields above
      // stay the direct-edit escape hatch; Connect is the new recommended path.
      body.querySelector('#c-bind-read-connect')?.addEventListener('click', () => this.openConnectDialog(comp, def, 'read'));
      body.querySelector('#c-bind-write-connect')?.addEventListener('click', () => this.openConnectDialog(comp, def, 'write'));
      // Ticket 18: both use kind 'write' (increment/decrement events are
      // write-kind Deck Events same as Write Deck Event above) but target a
      // different binding field — see openConnectDialog()'s bindingField param.
      body.querySelector('#c-bind-increment-connect')?.addEventListener('click', () => this.openConnectDialog(comp, def, 'write', 'incrementEvent'));
      body.querySelector('#c-bind-decrement-connect')?.addEventListener('click', () => this.openConnectDialog(comp, def, 'write', 'decrementEvent'));

      // Wires one Connect-to-Simulator category+variable pair (kind: 'read'
      // or 'write') straight onto the same bindingField the Advanced dropdown
      // above uses — see buildConnectSimPicker().
      const wireConnectSimPicker = (kind, idPrefix, bindingField) => {
        const categorySelect = body.querySelector(`#${idPrefix}-category`);
        const variableSelect = body.querySelector(`#${idPrefix}-variable`);
        categorySelect?.addEventListener('change', () => {
          const category = categorySelect.value;
          if (!variableSelect) return;
          if (!category) {
            variableSelect.innerHTML = '<option value="">— choose a category first —</option>';
            variableSelect.disabled = true;
            return;
          }
          const entries = getDeckEventsByCategory(category).filter((e) => e.kind === kind);
          variableSelect.innerHTML = `<option value="">— choose a value —</option>${entries.map((e) => `<option value="${e.name}">${e.label}</option>`).join('')}`;
          variableSelect.disabled = false;
          // Picking a new category with no value chosen yet doesn't write
          // anything — only committing a variable below does.
        });
        variableSelect?.addEventListener('change', () => {
          if (variableSelect.value) updateBinding({ [bindingField]: variableSelect.value });
        });
      };
      wireConnectSimPicker('read', 'c-connect-read', 'readSimVar');
      wireConnectSimPicker('write', 'c-connect-write', 'writeEvent');
      // Fix pass (code review): the Simple/Guided-tier "Connect to Simulator"
      // picker is what actually makes a field reachable without leaving the
      // default tier — the data-tier="advanced" dropdown alone (originally
      // the only thing added here) left Increment/Decrement invisible by
      // default despite PropertyRegistry.js declaring both `tier: 'simple',
      // guided: true`. Mirrors Write Deck Event's own picker exactly, one
      // level up: category+variable both filtered on kind 'write' (these are
      // write-kind Deck Events too), landing on incrementEvent/decrementEvent
      // instead of writeEvent via wireConnectSimPicker's existing
      // bindingField param.
      if (comp.type === 'core.rotary') {
        wireConnectSimPicker('write', 'c-connect-increment', 'incrementEvent');
        wireConnectSimPicker('write', 'c-connect-decrement', 'decrementEvent');
      }

      // Post-implementation review §7: the 4-category Simple picker above has
      // no escape hatch when an author's value isn't Radios/AP/Lights/Yoke —
      // the category select just has no matching option, with nothing
      // pointing at Raw Address or the SimVar Tester's wiggle-to-find. Same
      // two-link fix on both read and write pickers.
      const simplePickerKinds = comp.type === 'core.rotary' ? ['read', 'write', 'increment', 'decrement'] : ['read', 'write'];
      simplePickerKinds.forEach((kind) => {
        body.querySelector(`#c-connect-${kind}-findit`)?.addEventListener('click', () => this.simVarTester?.open());
        body.querySelector(`#c-connect-${kind}-full`)?.addEventListener('click', () => {
          this.uiTier = 'full';
          localStorage.setItem('fdws_studio_uiMode', 'full');
          this.render();
        });
      });

      const stateSelect = body.querySelector('#c-bind-state');
      const stateCustomBlock = body.querySelector('#c-bind-state-custom-block');
      const stateCustomInput = body.querySelector('#c-bind-state-custom-input');
      stateSelect?.addEventListener('change', () => {
        if (stateSelect.value === CUSTOM_OPTION_VALUE) {
          // Just reveal the text field — don't write back yet. binding.stateVar
          // is still whatever it was (likely empty), so writing here would
          // immediately re-trigger a synchronous COMPONENT_UPDATED re-render
          // that rebuilds this panel from that still-empty value, snapping the
          // select back to "None" and hiding the field before the user can type.
          stateCustomBlock?.classList.remove('hidden');
        } else {
          stateCustomBlock?.classList.add('hidden');
          if (stateCustomInput) stateCustomInput.value = '';
          updateBinding({ stateVar: stateSelect.value || undefined });
        }
      });
      stateCustomInput?.addEventListener('change', () => {
        updateBinding({ stateVar: stateCustomInput.value.trim() || undefined });
      });
      body.querySelector('#c-bind-stateref')?.addEventListener('change', (e) => updateBinding({ stateRef: e.target.value.trim() || undefined }));
      body.querySelector('#c-bind-sublabelstateref')?.addEventListener('change', (e) => updateBinding({ sublabelStateRef: e.target.value.trim() || undefined }));
      body.querySelector('#c-bind-teststatevar')?.addEventListener('change', (e) => updateBinding({ testStateVar: e.target.value || undefined }));
      body.querySelector('#c-bind-pollrate')?.addEventListener('change', (e) => updateBinding({ pollFrequencyHz: Number(e.target.value) }));
      body.querySelector('#c-bind-pollgroup')?.addEventListener('change', (e) => updateBinding({ pollGroup: e.target.value.trim() || undefined }));
      body.querySelector('#c-bind-deadband')?.addEventListener('change', (e) => updateBinding({ deadband: Number(e.target.value) || 0 }));
      body.querySelector('#c-bind-unit')?.addEventListener('change', (e) => updateBinding({ unit: e.target.value.trim() || undefined }));
      body.querySelector('#c-bind-eventcategory')?.addEventListener('change', (e) => updateBinding({ eventCategory: e.target.value.trim() || undefined }));

      // 0.4-B: Paste from the bottom-bar SimVar Tester into this binding.
      // Same four-state rule as PC Bridge's config table: nothing parsed,
      // wrong shape, or good. (There is no locked-row state here — a widget
      // definition is always editable.)
      {
        const applyPaste = (kind) => {
          const parsed = this.state.testerParsed;
          const inputId = kind === 'read' ? 'c-bind-read-custom-input' : 'c-bind-write-custom-input';
          const selectId = kind === 'read' ? 'c-bind-read' : 'c-bind-write';
          const blockId = kind === 'read' ? 'c-bind-read-custom-block' : 'c-bind-write-custom-block';
          if (!parsed) { showToast('Nothing parsed yet — use the SimVar Tester in the bottom bar first.'); return; }
          if (parsed.kind === 'complex') { showToast('That one is test-only — conditionals and multi-token RPN can’t be stored in a binding.'); return; }
          const parsedIsRead = parsed.kind === 'read';
          if (kind === 'read' && !parsedIsRead) { showToast('That’s a write event — paste it into the Write Deck Event field instead.'); return; }
          if (kind === 'write' && parsedIsRead) { showToast('That’s a read expression — paste it into the Read Deck Event field instead.'); return; }

          body.querySelector(`#${selectId}`).value = CUSTOM_OPTION_VALUE;
          body.querySelector(`#${blockId}`)?.classList.remove('hidden');
          const input = body.querySelector(`#${inputId}`);

          if (kind === 'read') {
            input.value = parsed.name;
            const updates = { readSimVar: parsed.name };
            // Gate on whether the PARSED name is raw, not the unit field's
            // current disabled attribute -- that still reflects the OLD
            // binding at this point (see 0.3-B's note on the same trap).
            if (parsed.unit && /^(A|L|H|K):/i.test(parsed.name)) updates.unit = parsed.unit;
            showToast(`Pasted ${parsed.name}${updates.unit ? ` (unit ${updates.unit})` : ''}.`);
            updateBinding(updates);
            return;
          }

          const event = parsed.kind === 'write' ? parsed.event.replace(/^K:/i, '') : parsed.event;
          input.value = event;
          // A pasted write carries a value a binding has nowhere to store --
          // report it rather than dropping it. See StudioBindingParse.js.
          showToast(parsed.value !== null && parsed.value !== undefined
            ? `Pasted ${event}. It also sends the value ${parsed.value} — a binding has no value field, so set that on this component’s interaction action.`
            : `Pasted ${event}.`);
          updateBinding({ writeEvent: event });
        };
        body.querySelector('#c-bind-read-paste')?.addEventListener('click', () => applyPaste('read'));
        body.querySelector('#c-bind-write-paste')?.addEventListener('click', () => applyPaste('write'));
      }

      // 0.1-C(c): show what a bare Deck Event actually resolves to right
      // now, e.g. "Unit: Bco16 - from profile 'Default'". Stays in the
      // sidebar in 0.4-B while the tester moved to the bottom bar: this is a
      // property annotation about the SELECTED binding, not a tester, and it
      // is the only place in Studio that shows what a Deck Event resolves to.
      {
        const resolvedInfoEl = body.querySelector('#c-bind-resolved-info');
        if (resolvedInfoEl && !isRawAddress && binding.readSimVar && this.simBridge?.connected) {
          resolvedInfoEl.textContent = 'Resolving…';
          resolvedInfoEl.classList.remove('hidden');
          this.simBridge.resolveDeckEvent(binding.readSimVar).then((resolved) => {
            // Panel may have re-rendered (different component selected, or a
            // binding edit) by the time this resolves -- only touch the DOM
            // if this exact element is still live.
            if (!resolvedInfoEl.isConnected) return;
            resolvedInfoEl.textContent = resolved
              ? `Unit: ${resolved.unit} — from profile "${resolved.profileName}"`
              : `"${binding.readSimVar}" has no mapping in the active profile.`;
          });
        }
      }

      const updateTransition = () => {
        const msRaw = body.querySelector('#c-bind-transition-ms')?.value;
        const easing = body.querySelector('#c-bind-transition-easing')?.value || 'linear';
        if (msRaw === '' || msRaw === undefined) {
          updateBinding({ transition: undefined });
        } else {
          updateBinding({ transition: { durationMs: Number(msRaw) || 0, easing } });
        }
      };
      body.querySelector('#c-bind-transition-ms')?.addEventListener('change', updateTransition);
      body.querySelector('#c-bind-transition-easing')?.addEventListener('change', updateTransition);

      body.querySelector('#c-bind-advanced-toggle')?.addEventListener('click', () => {
        this._bindingAdvancedOpen = !this._bindingAdvancedOpen;
        body.querySelector('#c-bind-advanced-fields')?.classList.toggle('hidden');
        const toggleBtn = body.querySelector('#c-bind-advanced-toggle');
        if (toggleBtn) toggleBtn.textContent = `${this._bindingAdvancedOpen ? '▾' : '▸'} Advanced (Acknowledge / Push Events, Event Category)`;
      });
    })(dataBody.appendChild(document.createElement('div')));

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
    ((body) => {
      const interactions = comp.interactions || [];

      body.innerHTML = `
        <div class="interactions-list">
          ${interactions.length === 0 ? '<div class="caps-empty">No interaction triggers attached.</div>' : ''}
          ${interactions.map((inter, idx) => `
            <div class="interaction-card">
              <div class="inter-hdr">
                <span class="inter-tag">${inter.trigger || 'tap'}</span>
                <span class="inter-action-type">${inter.action?.type?.replace('core.', '') || ''}</span>
                <div class="inter-hdr-actions">
                  <button class="btn-edit-inter" data-idx="${idx}" title="Edit this interaction">✎</button>
                  <button class="btn-del-inter" data-idx="${idx}" title="Remove this interaction">✕</button>
                </div>
              </div>
              <div class="inter-desc">
                ${inter.action?.event ? `Event: <strong>${inter.action.event}</strong>` : ''}
                ${inter.action?.field ? `Field: <strong>${inter.action.field}</strong>` : ''}
                ${inter.action?.fields ? `Swap: <strong>${inter.action.fields.join(' ↔ ')}</strong>` : ''}
                ${inter.action?.popoverWidgetId ? `Popover: <strong>${inter.action.popoverWidgetId}</strong>` : ''}
                ${inter.action?.contextKey ? `Context Key: <strong>${inter.action.contextKey}</strong>` : ''}
                ${inter.action?.fromStateRef ? `From: <strong>${inter.action.fromStateRef}</strong>` : ''}
                ${inter.feedback?.haptic || inter.feedback?.sound ? `Feedback: <strong>${[inter.feedback.haptic ? `${inter.feedback.haptic} haptic` : '', inter.feedback.sound ? `sound: ${inter.feedback.sound}` : ''].filter(Boolean).join(', ')}</strong>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
        <button id="btn-add-interaction" class="panel-full-btn" style="margin-top:8px;">+ Add Interaction Trigger</button>
      `;

      body.querySelectorAll('.btn-edit-inter').forEach((btn) => {
        btn.addEventListener('click', () => {
          const idx = parseInt(btn.dataset.idx, 10);
          this.openAddInteractionModal(comp, idx);
        });
      });

      body.querySelectorAll('.btn-del-inter').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const idx = parseInt(btn.dataset.idx, 10);
          const target = (comp.interactions || [])[idx];
          const ok = await confirmModal(`Remove the "${target?.trigger}" → ${target?.action?.type?.replace('core.', '') || ''} interaction?`, { title: 'Remove Interaction', danger: true });
          if (!ok) return;
          const next = [...(comp.interactions || [])];
          next.splice(idx, 1);
          this.state.updateComponent(comp.id, { interactions: next });
        });
      });

      body.querySelector('#btn-add-interaction')?.addEventListener('click', () => {
        this.openAddInteractionModal(comp);
      });
    })(outerBody.appendChild(document.createElement('div')));

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
    const assets = def.assets || [];
    const guard = comp.layout?.guard || {};
    const conditionSummary = summarizeCondition(comp.visibleWhen);

    body.innerHTML = `
      <div class="prop-section-subtitle">Conditional Visibility (visibleWhen) <span class="prop-hint" title="FDWS v1.13: each condition's state can be a declared state[] var, or — via the 'Custom / nested path…' option — a nested/indexed path like presets[0].label, addressing one specific array-slot field instead of a whole variable.">ⓘ</span></div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
        <div style="flex:1;padding:6px 8px;background:var(--studio-panel-bg);border:1px solid var(--studio-panel-border);border-radius:3px;font-size:12px;color:var(--studio-text-secondary);">${escapeHtmlAttr(conditionSummary)}</div>
        <button type="button" id="vw-edit-condition" class="bar-btn" title="Edit condition in popover">Edit</button>
      </div>

      <div class="prop-section-subtitle" style="margin-top:14px;">Guard Overlay (layout.guard §2.2)</div>
      <div class="prop-field">
        <label><input type="checkbox" id="guard-enabled" ${guard.enabled ? 'checked' : ''} /> Enable safety cover (tap to open, then tap control)</label>
      </div>
      ${guard.enabled ? `
        <div class="prop-row-2">
          <div class="prop-field">
            <label>Closed Asset</label>
            <select id="guard-closed-asset" class="prop-select">
              <option value="">— none —</option>
              ${assets.map((a) => `<option value="${a.id}" ${guard.closedAsset === a.id ? 'selected' : ''}>${a.id}</option>`).join('')}
            </select>
          </div>
          <div class="prop-field">
            <label>Open Asset</label>
            <select id="guard-open-asset" class="prop-select">
              <option value="">— none —</option>
              ${assets.map((a) => `<option value="${a.id}" ${guard.openAsset === a.id ? 'selected' : ''}>${a.id}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="prop-field">
          <label>Auto-Close After (ms, 0 = never)</label>
          <input type="number" id="guard-autoclose" class="prop-input" value="${guard.autoCloseAfterMs ?? 0}" min="0" />
        </div>
      ` : ''}
    `;

    // Wire up the edit button to open the popover
    body.querySelector('#vw-edit-condition')?.addEventListener('click', async () => {
      await this.openConditionEditorPopover('Edit Conditional Visibility', (rerender) =>
        this.renderConditionListEditor(comp, def, comp.visibleWhen || null, 'vw', (nextValue, recordHistory = true) => {
          this.state.updateComponent(comp.id, { visibleWhen: nextValue }, recordHistory);
          rerender();
        })
      );
    });

    // --- guard wiring ---
    body.querySelector('#guard-enabled')?.addEventListener('change', (e) => {
      this.state.updateComponent(comp.id, { layout: { ...(comp.layout || {}), guard: { ...guard, enabled: e.target.checked } } });
    });
    body.querySelector('#guard-closed-asset')?.addEventListener('change', (e) => {
      this.state.updateComponent(comp.id, { layout: { ...(comp.layout || {}), guard: { ...guard, closedAsset: e.target.value || undefined } } });
    });
    body.querySelector('#guard-open-asset')?.addEventListener('change', (e) => {
      this.state.updateComponent(comp.id, { layout: { ...(comp.layout || {}), guard: { ...guard, openAsset: e.target.value || undefined } } });
    });
    body.querySelector('#guard-autoclose')?.addEventListener('change', (e) => {
      const ms = parseInt(e.target.value, 10) || 0;
      this.state.updateComponent(comp.id, { layout: { ...(comp.layout || {}), guard: { ...guard, autoCloseAfterMs: ms || undefined } } });
    });
  }

  // Wave 2 Part B2: the old row-list editor for style.rules (with its own
  // compact typography.color/border.color/background controls + per-row
  // JSON fallback) is DELETED — superseded by rule chips in the Appearance
  // panel's target strip (main IIFE in renderComponentInspector()), which
  // render every rule's style through the same generic field engine
  // Normal/State already use. See renderAppearanceSection()'s doc comment.

  /**
   * Wave 3, G6 slice 1: shared one-level compound condition editor —
   * combinator (ALL/ANY) + N leaf condition rows (state/op/value, with the
   * declared-var/custom-path/"use this component's own value" options every
   * condition-source dropdown in this file already shares via
   * conditionStateOptionsHtml()) — plus a JSON-textarea fallback for a
   * genuinely nested/complex expression, so a hand-authored two-level
   * condition is never silently destroyed by an editor that can't render it
   * (same "don't destroy what you can't render" principle as V18's rule-style
   * fix). Originally hand-built only for visibleWhen (renderVisibilityAndGuard);
   * extracted here so style.rules[].when (this slice) and, later,
   * interactions[].condition can reach the same one-level compound capability
   * instead of staying single-leaf-only.
   * @param {object} comp
   * @param {object} def widgetDef
   * @param {object|null} expr the raw stored condition value
   * @param {string} idPrefix DOM id prefix, so two instances on one panel
   *        never collide (e.g. 'vw' vs 'rulecond')
   * @param {(next: object|undefined, recordHistory?: boolean) => void} onCommit
   *        called with the next ready-to-store value (or undefined to clear)
   * @returns {{ html: string, wire: (mountEl: HTMLElement) => void }}
   */
  renderConditionListEditor(comp, def, expr, idPrefix, onCommit, options = {}) {
    const stateVars = def.state || [];

    // A compound expression is normalized to a flat condition list under one
    // combinator (allOf/anyOf) for the visual editor. G6 slice 3: each item
    // in that list can now be EITHER a leaf OR a one-level-deep group
    // (itself {allOf|anyOf: [...leaves]}) — exactly "two levels," matching
    // the proposal's own wording, not arbitrary recursive nesting. Anything
    // deeper (a group containing a group) has no bounded visual form and
    // still falls back to the JSON escape hatch below.
    const combinator = expr?.anyOf ? 'anyOf' : 'allOf';
    // Post-implementation review §3: `expr.state` used to be read as a
    // truthiness test, so a fresh rule's `{state:'', equals:''}` (empty
    // string is falsy) fell straight through to the JSON fallback below —
    // on exactly the widget-with-no-declared-state-vars case a first-time
    // author is most likely building. `typeof` matches isLeafCondition's
    // own (already-correct) check a few lines down.
    const conditions = expr ? (expr[combinator] || (typeof expr.state === 'string' ? [expr] : [])) : [];
    const isGroupCondition = (c) => !!c && typeof c === 'object' && (Array.isArray(c.allOf) || Array.isArray(c.anyOf));
    // Bug found live during G6 slice 1 verification, pre-existing (not
    // introduced here — this was visibleWhen's own original check, copied
    // verbatim before that fix): the old check only looked at the OUTERMOST
    // shape, so a genuinely nested expression passed as "simple" because the
    // top level has `allOf`/`anyOf`. Each array member must itself be
    // recognized as a leaf or a (leaves-only) group, or this falls back to
    // the JSON escape hatch instead of silently destroying what it can't
    // render on the next row edit.
    const isLeafCondition = (c) => !!c && typeof c === 'object' && typeof c.state === 'string' && !isGroupCondition(c);
    const isSimpleItem = (c) => isLeafCondition(c) || (isGroupCondition(c) && (c.allOf || c.anyOf).every(isLeafCondition));
    const isNestedOrComplex = !!expr && (!(expr.allOf || expr.anyOf || typeof expr.state === 'string') || !conditions.every(isSimpleItem));

    const OPS = ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'between'];
    // Post-implementation review §9: the dropdown used to show these raw
    // JSON keys verbatim (gt, gte, notEquals...) — plain-English labels only,
    // the stored `value` (and cond[op] lookups elsewhere) stay the raw key.
    const OP_LABELS = { equals: 'is', notEquals: 'is not', gt: 'is greater than', gte: 'is at least', lt: 'is less than', lte: 'is at most', between: 'is between' };

    // FDWS v1.13: a condition's `state` can address a nested/indexed path
    // (e.g. "presets[0].label"), not just a declared state[] var — same
    // grammar as binding.stateRef (v1.11). Any name not in the declared
    // list is treated as a custom/path value, same "Custom…" pattern used
    // elsewhere in this panel (bindings, event pickers).
    const stateIsCustomPath = (name) => !!name && !stateVars.some((s) => s.name === name);

    // G6 slice 3: the leaf field markup (state/op/value), extracted so both
    // a top-level leaf row and a group-nested leaf row render identically —
    // one template, not two copies to keep in sync.
    const leafFieldsHtml = (cond) => {
      const isCustom = stateIsCustomPath(cond.state);
      return `
        <div class="${idPrefix}-state-wrap" style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:0;">
          <select class="row-field ${idPrefix}-state prop-select" data-field="state">
            ${conditionStateOptionsHtml(stateVars, cond.state, false, comp.binding?.readSimVar)}
          </select>
          <input type="text" class="row-field ${idPrefix}-state-custom prop-input ${isCustom ? '' : 'hidden'}" value="${isCustom ? escapeHtmlAttr(cond.state) : ''}" placeholder="e.g. presets[0].label" title="FDWS v1.13: 'name[index].field' path into an array/object state var — same grammar as a component's Bind to Local State Path." />
        </div>
        <select class="row-field ${idPrefix}-op prop-select" data-field="op">
          ${OPS.map((op) => `<option value="${op}" ${OPS.find((o) => cond[o] !== undefined) === op ? 'selected' : ''}>${OP_LABELS[op] || op}</option>`).join('')}
        </select>
        <input type="text" class="row-field ${idPrefix}-val" data-field="val" value="${(() => { const op = OPS.find((o) => cond[o] !== undefined); return op ? (op === 'between' ? (cond.between || []).join(',') : cond[op]) : ''; })()}" placeholder="${(OPS.find((o) => cond[o] !== undefined) === 'between') ? 'lo,hi' : 'value'}" />
      `;
    };

    // G6 slice 3: a top-level item is either a plain leaf row (unchanged
    // markup) or a bordered group box containing its own combinator + N
    // leaf rows — nested leaf rows are structurally one level deeper in the
    // DOM (inside .cond-group-rows), not a different CSS class, so the
    // top-level wiring's `>` direct-child query naturally excludes them.
    const conditionRowHtml = (cond, idx) => {
      if (isGroupCondition(cond)) {
        const groupCombinator = cond.anyOf ? 'anyOf' : 'allOf';
        const groupLeaves = cond[groupCombinator] || [];
        return `
      <div class="row-list-item cond-group" data-idx="${idx}" style="flex-direction:column;align-items:stretch;">
        <div class="cond-group-header">
          <select class="row-field ${idPrefix}-group-combinator prop-select">
            <option value="allOf" ${groupCombinator === 'allOf' ? 'selected' : ''}>Group: ALL of these are true</option>
            <option value="anyOf" ${groupCombinator === 'anyOf' ? 'selected' : ''}>Group: ANY of these are true</option>
          </select>
          <button type="button" class="btn-mini-close ${idPrefix}-remove" title="Remove Group">✕</button>
        </div>
        <div class="cond-group-rows">
          ${groupLeaves.map((leaf, leafIdx) => `
            <div class="row-list-item" data-leaf-idx="${leafIdx}">
              ${leafFieldsHtml(leaf)}
              <button type="button" class="btn-mini-close ${idPrefix}-remove-leaf" title="Remove">✕</button>
            </div>
          `).join('') || '<div class="caps-empty">Empty group — add a condition.</div>'}
        </div>
        <button type="button" class="bar-btn row-add ${idPrefix}-add-group-leaf">+ Add Condition to Group</button>
      </div>
    `;
      }
      return `
      <div class="row-list-item" data-idx="${idx}">
        ${leafFieldsHtml(cond)}
        <button type="button" class="btn-mini-close ${idPrefix}-remove" title="Remove">✕</button>
      </div>
    `;
    };

    const html = `
      ${isNestedOrComplex ? `
        <div class="caps-empty">This condition is too complex for the visual editor (hand-authored/nested). Edit it as JSON below, or clear it to start over with the visual editor.</div>
        <textarea id="${idPrefix}-raw-json" class="prop-input" rows="4">${escapeHtmlAttr(JSON.stringify(expr, null, 0))}</textarea>
        <div id="${idPrefix}-raw-error" class="prop-json-error hidden"></div>
        <button type="button" id="${idPrefix}-clear" class="bar-btn">Clear & Use Visual Editor</button>
      ` : `
        <div class="prop-field">
          <label>Match when…</label>
          <select id="${idPrefix}-combinator" class="prop-select" ${conditions.length === 0 ? 'disabled' : ''}>
            <option value="allOf" ${combinator === 'allOf' ? 'selected' : ''}>ALL of these are true</option>
            <option value="anyOf" ${combinator === 'anyOf' ? 'selected' : ''}>ANY of these are true</option>
          </select>
        </div>
        <div id="${idPrefix}-conditions">${conditions.map(conditionRowHtml).join('') || '<div class="caps-empty">No conditions set.</div>'}</div>
        <div class="prop-row-2" style="margin-top:6px;">
          <button type="button" id="${idPrefix}-add-condition" class="bar-btn row-add">+ Add Condition</button>
          <button type="button" id="${idPrefix}-add-group" class="bar-btn row-add" title="A nested ALL/ANY group — for e.g. 'X AND (Y OR Z)'">+ Add Group</button>
        </div>
      `}
    `;

    const wire = (mountEl) => {
      const commit = (nextConditions, nextCombinator, recordHistory = true) => {
        const value = nextConditions.length === 0 ? undefined : { [nextCombinator]: nextConditions };
        onCommit(value, recordHistory);
      };

      mountEl.querySelector(`#${idPrefix}-combinator`)?.addEventListener('change', (e) => commit(conditions, e.target.value));

      // G6 slice 3: shared leaf-field wiring (state/op/value, including
      // "Use This Component's Own Value") — `writeValue(nextLeaf,
      // recordHistory)` is the only thing that differs between a top-level
      // leaf and a group-nested one, so this one function backs both.
      const wireLeafFields = (rowEl, writeValue) => {
        const stateSelect = rowEl.querySelector(`.${idPrefix}-state`);
        const stateCustomInput = rowEl.querySelector(`.${idPrefix}-state-custom`);

        // V14: `stateOverride` lets the "Use This Component's Own Value" branch
        // below reuse this same op/value-reading logic rather than duplicating it.
        const applyRowChange = (recordHistory = true, stateOverride = undefined) => {
          const state = stateOverride !== undefined ? stateOverride
            : stateSelect.value === CUSTOM_OPTION_VALUE ? stateCustomInput.value.trim() : stateSelect.value;
          const op = rowEl.querySelector(`.${idPrefix}-op`).value;
          const rawVal = rowEl.querySelector(`.${idPrefix}-val`).value;
          const cond = { state };
          if (op === 'between') {
            const [lo, hi] = rawVal.split(',').map((s) => Number(s.trim()));
            cond.between = [lo || 0, hi || 0];
          } else if (['gt', 'gte', 'lt', 'lte'].includes(op)) {
            cond[op] = Number(rawVal) || 0;
          } else {
            cond[op] = rawVal;
          }
          writeValue(cond, recordHistory);
        };
        stateSelect?.addEventListener('change', () => {
          if (stateSelect.value === OWN_VALUE_OPTION) {
            const simVar = comp.binding?.readSimVar;
            if (!simVar) return;
            const name = this.state.resolveSyncFromVarName(simVar);
            stateCustomInput?.classList.add('hidden');
            // G6 slice 2: a deferred (Save/Cancel-transactional) caller
            // derives and applies the syncFrom var itself, once, at real
            // Submit time — resolveSyncFromVarName() above is already pure,
            // so the row still shows the right name either way.
            if (!options.deferred) {
              this.state.saveHistory("Use This Component's Own Value");
              this.state.ensureSyncFromVar(simVar);
            }
            applyRowChange(false, name);
          } else if (stateSelect.value === CUSTOM_OPTION_VALUE) {
            // Just reveal the text field — don't commit yet. Committing here
            // with the still-empty custom input would trigger a synchronous
            // re-render (no debounce) that rebuilds this row from that empty
            // value, snapping the select back to "— state var —" and hiding
            // the field before the user can type anything into it — same
            // "reveal, don't write yet" pattern used for every other
            // Custom… dropdown in this panel.
            stateCustomInput?.classList.remove('hidden');
          } else {
            stateCustomInput?.classList.add('hidden');
            if (stateCustomInput) stateCustomInput.value = '';
            applyRowChange();
          }
        });
        stateCustomInput?.addEventListener('change', applyRowChange);
        rowEl.querySelector(`.${idPrefix}-op`)?.addEventListener('change', applyRowChange);
        rowEl.querySelector(`.${idPrefix}-val`)?.addEventListener('change', applyRowChange);
      };

      mountEl.querySelectorAll(`#${idPrefix}-conditions > .row-list-item`).forEach((rowEl) => {
        const idx = Number(rowEl.dataset.idx);

        if (rowEl.classList.contains('cond-group')) {
          rowEl.querySelector(`.${idPrefix}-group-combinator`)?.addEventListener('change', (e) => {
            const item = conditions[idx];
            const groupLeaves = item[item.anyOf ? 'anyOf' : 'allOf'] || [];
            const next = [...conditions];
            next[idx] = { [e.target.value]: groupLeaves };
            commit(next, combinator);
          });
          rowEl.querySelector(`.${idPrefix}-remove`)?.addEventListener('click', () => {
            commit(conditions.filter((_, i) => i !== idx), combinator);
          });
          rowEl.querySelectorAll('.cond-group-rows > .row-list-item').forEach((leafEl) => {
            const leafIdx = Number(leafEl.dataset.leafIdx);
            wireLeafFields(leafEl, (nextLeaf, recordHistory) => {
              const item = conditions[idx];
              const gc = item.anyOf ? 'anyOf' : 'allOf';
              const nextLeaves = [...(item[gc] || [])];
              nextLeaves[leafIdx] = nextLeaf;
              const next = [...conditions];
              next[idx] = { [gc]: nextLeaves };
              commit(next, combinator, recordHistory);
            });
            leafEl.querySelector(`.${idPrefix}-remove-leaf`)?.addEventListener('click', () => {
              const item = conditions[idx];
              const gc = item.anyOf ? 'anyOf' : 'allOf';
              const nextLeaves = (item[gc] || []).filter((_, i) => i !== leafIdx);
              const next = [...conditions];
              // No empty groups — removing a group's last leaf removes the
              // whole group rather than leaving a stray {allOf: []}.
              if (nextLeaves.length === 0) {
                next.splice(idx, 1);
              } else {
                next[idx] = { [gc]: nextLeaves };
              }
              commit(next, combinator);
            });
          });
          rowEl.querySelector(`.${idPrefix}-add-group-leaf`)?.addEventListener('click', () => {
            const item = conditions[idx];
            const gc = item.anyOf ? 'anyOf' : 'allOf';
            const nextLeaves = [...(item[gc] || []), { state: stateVars[0]?.name || '', equals: '' }];
            const next = [...conditions];
            next[idx] = { [gc]: nextLeaves };
            commit(next, combinator);
          });
        } else {
          wireLeafFields(rowEl, (nextLeaf, recordHistory) => {
            const next = [...conditions];
            next[idx] = nextLeaf;
            commit(next, combinator, recordHistory);
          });
          rowEl.querySelector(`.${idPrefix}-remove`)?.addEventListener('click', () => {
            commit(conditions.filter((_, i) => i !== idx), combinator);
          });
        }
      });

      mountEl.querySelector(`#${idPrefix}-add-condition`)?.addEventListener('click', () => {
        commit([...conditions, { state: stateVars[0]?.name || '', equals: '' }], combinator);
      });

      mountEl.querySelector(`#${idPrefix}-add-group`)?.addEventListener('click', () => {
        commit([...conditions, { allOf: [{ state: stateVars[0]?.name || '', equals: '' }] }], combinator);
      });

      mountEl.querySelector(`#${idPrefix}-clear`)?.addEventListener('click', () => {
        onCommit(undefined);
      });

      mountEl.querySelector(`#${idPrefix}-raw-json`)?.addEventListener('change', (e) => {
        try {
          const parsed = JSON.parse(e.target.value);
          onCommit(parsed);
          mountEl.querySelector(`#${idPrefix}-raw-error`)?.classList.add('hidden');
        } catch (err) {
          const errEl = mountEl.querySelector(`#${idPrefix}-raw-error`);
          if (errEl) {
            errEl.textContent = `Invalid JSON — edit not applied: ${err.message}`;
            errEl.classList.remove('hidden');
          }
        }
      });
    };

    return { html, wire };
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
        notice.textContent = 'Alignment moved to the "VISUAL STYLING & TYPOGRAPHY" panel below (FDWS v1.8) — now shared by every component type instead of being label-only.';
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
        notice.textContent = 'Thickness, color, and dash style are set on the "VISUAL STYLING & TYPOGRAPHY" panel\'s Border section below — this line reuses those same fields.';
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

  /**
   * Modal-based interaction builder — replaces the old chained prompt()/confirm()
   * flow (free-typed enum values, no autocomplete, restart-from-scratch to fix a
   * typo) with a single reviewable form. Trigger and action type are real
   * dropdowns; the action-specific fields swap in below as the action type changes.
   */
  async openAddInteractionModal(comp, editIdx = null) {
    const existing = editIdx !== null ? (comp.interactions || [])[editIdx] : null;
    const existingAction = existing?.action || null;
    // Sourced from PropertyRegistry.js (single source, shared with
    // InteractionDispatcher.js's own action switch) instead of hand-copied
    // here. 'hold'/'doubleTap'/'release' are kept in the dropdown for
    // backward compatibility with already-authored widgets that may
    // reference them (registry marks them live:false) — nothing in
    // BaseComponent.attachInteractions() actually wires them up; only
    // 'tap'/'longpress' (pointer events) and 'change'/'focus'/'blur' (native
    // DOM events, core.input only, wired in InputComponent.js) do anything
    // at runtime. core.openPopover is excluded — it's Studio's own internal
    // affordance (registry marks it internal:true), not a real widget action.
    //
    // Widget Studio 2.0, Phase 8: Simple mode gets a shorter, plain-language
    // action list instead of the full technical catalog — the same 5 actions
    // that cover the vast majority of real widgets (send a value to the sim,
    // flip a switch, set/swap local values, open a popup). The remaining
    // ones (commitToHost, closePopover, ackIndicator) are genuinely
    // popover-authoring/annunciator-specific — real power, but not something
    // a first-time author needs to understand to build a working widget.
    // Every action still submits through the exact same dynamicFieldsHtml/
    // onSubmit logic below regardless of which list produced it.
    const SIMPLE_ACTION_LABELS = {
      'core.dispatchEvent': 'Send a Value to the Simulator',
      'core.toggleLocalState': 'Toggle On / Off',
      'core.setLocalState': 'Set a Value',
      'core.swapLocalState': 'Swap Two Values',
      'core.openWidgetPopover': 'Open a Popup'
    };
    // Part 2: Guided is a strict subset of Build, so both see the short,
    // plain-language action list — only Full gets the complete technical one.
    const isSimpleUi = this.uiTier !== 'full';
    const ACTION_TYPES = REGISTRY_ACTIONS
      .filter((a) => !a.internal)
      .filter((a) => !isSimpleUi || SIMPLE_ACTION_LABELS[a.type])
      .map((a) => ({
        type: a.type,
        label: isSimpleUi ? (SIMPLE_ACTION_LABELS[a.type] || a.label) : (a.deprecated ? `${a.label} (legacy)` : a.label)
      }));
    // Wave 0b (V19): every component type used to see the identical flat list
    // regardless of relevance (a core.button offered fineChange/itemTap/etc,
    // and a core.stepper had no increment/decrement to pick at all). Filtered
    // by the registry's new componentTypes ('*' = every type, BaseComponent-level).
    const TRIGGER_TYPES = REGISTRY_TRIGGERS
      .filter((t) => !isSimpleUi ? true : t.live)
      .filter((t) => t.componentTypes.includes('*') || t.componentTypes.includes(comp.type));
    const initialActionType = (existingAction && ACTION_TYPES.some((a) => a.type === existingAction.type))
      ? existingAction.type
      : ACTION_TYPES[0].type;

    // G6 slice 2: interaction.condition now uses the same shared compound
    // editor as visibleWhen/style.rules (renderConditionListEditor(),
    // { deferred: true } since this modal's commit is Save/Cancel, not
    // immediate). Fixes a real lossy bug the old single-leaf UI had: it used
    // to seed from ONLY a hand-authored compound condition's first sub-clause
    // (existing?.condition?.allOf?.[0] || .anyOf?.[0] || existing.condition),
    // silently dropping every other sub-clause on the next Save. Keeping the
    // full raw value here means nothing is lost.
    let conditionExpr = existing?.condition || null;
    // V14: set (derived at Submit, below) when the final condition actually
    // uses "Use This Component's Own Value" — the syncFrom var isn't created
    // until Submit (this modal's commit is deferred), unlike the two
    // condition editors that commit immediately on every change.
    let ownValueSimVar = null;

    let contextRows = (existingAction?.type === 'core.openWidgetPopover' && existingAction.context)
      ? Object.entries(existingAction.context).map(([key, v]) => ({
          key,
          stateRef: v.value?.stateRef || '',
          writable: !!v.writable,
          applyOn: v.applyOn
        }))
      : [];

    const eventPickerHtml = (id, current) => `
      <select id="${id}" class="prop-select">
        <option value="" ${!current ? 'selected' : ''}>— none —</option>
        ${getDeckEventsByKind('write').map((e) => `<option value="${e.name}" ${current === e.name ? 'selected' : ''}>${e.label}</option>`).join('')}
        <option value="${CUSTOM_OPTION_VALUE}" ${current && !DECK_EVENT_NAMES.includes(current) ? 'selected' : ''}>Custom…</option>
      </select>
      <input type="text" id="${id}-custom" class="prop-input ${current && !DECK_EVENT_NAMES.includes(current) ? '' : 'hidden'}" value="${current && !DECK_EVENT_NAMES.includes(current) ? current : ''}" placeholder="Custom event name" />
    `;

    // When editing, dynamicFieldsHtml prefills from the interaction's own
    // saved action — but only for the action type it was actually saved as;
    // switching the Action dropdown to something else during an edit falls
    // straight back to the same fresh defaults Add uses, since the old
    // action's fields don't mean anything for a different action type.
    const dynamicFieldsHtml = (actionType) => {
      const prior = existingAction?.type === actionType ? existingAction : null;
      if (actionType === 'core.dispatchEvent') {
        return `
          <div class="modal-form-row"><label>Event to Dispatch</label>${eventPickerHtml('im-event', prior?.event || comp.binding?.writeEvent || '')}</div>
          <div class="modal-form-row"><label>Value</label><input type="text" id="im-value" class="prop-input" value="${prior?.value !== undefined ? prior.value : 1}" placeholder="1" /></div>
          <div class="modal-form-row">
            <label>From State Ref (optional) <span class="prop-hint" title="Overrides Value above — reads via the same 'name[index].field' path grammar popovers use, e.g. presets[0].freq, instead of a static literal. Needed because a plain tap carries no value of its own to dispatch.">ⓘ</span></label>
            <input type="text" id="im-fromstateref" class="prop-input" value="${prior?.fromStateRef || ''}" placeholder="e.g. presets[0].freq — leave blank to use Value above" />
          </div>
        `;
      }
      if (actionType === 'core.toggleLocalState') {
        return `<div class="modal-form-row"><label>State Field to Toggle</label><input type="text" id="im-field" class="prop-input" value="${prior?.field || comp.binding?.stateVar || 'switchOn'}" /></div>`;
      }
      if (actionType === 'core.setLocalState') {
        return `
          <div class="modal-form-row"><label>State Field</label><input type="text" id="im-field" class="prop-input" value="${prior?.field || 'activeMode'}" /></div>
          <div class="modal-form-row"><label>Value (true / false / number / text)</label><input type="text" id="im-value" class="prop-input" value="${prior?.value !== undefined ? prior.value : 'true'}" /></div>
          <div class="modal-form-row">
            <label>From State Ref (optional) <span class="prop-hint" title="Overrides Value above — reads via the same 'name[index].field' path grammar popovers use, e.g. presets[0].freq, instead of a static literal. Needed because a plain tap carries no value of its own to set.">ⓘ</span></label>
            <input type="text" id="im-fromstateref" class="prop-input" value="${prior?.fromStateRef || ''}" placeholder="e.g. presets[0].freq — leave blank to use Value above" />
          </div>
        `;
      }
      if (actionType === 'core.swapLocalState') {
        return `
          <div class="modal-form-row"><label>First Field</label><input type="text" id="im-field1" class="prop-input" value="${prior?.fields?.[0] || 'actFreq'}" /></div>
          <div class="modal-form-row"><label>Second Field</label><input type="text" id="im-field2" class="prop-input" value="${prior?.fields?.[1] || 'stbyFreq'}" /></div>
        `;
      }
      if (actionType === 'core.openWidgetPopover') {
        const popovers = this.state.getSavedWidgetsByKind('popover');
        return `
          <div class="modal-form-row">
            <label>Popover Widget</label>
            ${popovers.length === 0
              ? '<div class="caps-empty">No saved popover widgets yet. Use "New Popover" in the bottom bar to design one first, then save it.</div>'
              : `<select id="im-popover-id" class="prop-select">${popovers.map((w) => `<option value="${w.id}" ${prior?.popoverWidgetId === w.id ? 'selected' : ''}>${w.meta?.name || w.id}</option>`).join('')}</select>`}
          </div>
          <div class="modal-form-row">
            <label>Context Map (data passed into the popover)</label>
            <div id="im-context-rows"></div>
            <button type="button" id="im-context-add" class="bar-btn row-add">+ Add Context Entry</button>
          </div>
        `;
      }
      if (actionType === 'core.commitToHost') {
        return `
          <div class="modal-form-row"><label>Context Key to Commit</label><input type="text" id="im-contextkey" class="prop-input" value="${prior?.contextKey || 'currentLabel'}" placeholder="Must match a key the host declared writable" /></div>
          <div class="modal-form-row">
            <label>Local State Field to Commit (optional) <span class="prop-hint" title="Leave blank to commit whatever value triggered this interaction (e.g. a core.input's own change event). Set this to commit a NAMED local state var instead — needed for a Save button, whose own tap carries no value: stage edits into local state first via core.setLocalState, then have Save read that field name here.">ⓘ</span></label>
            <input type="text" id="im-commit-field" class="prop-input" value="${prior?.field || ''}" placeholder="e.g. scratchLabel — leave blank to use the triggering event's own value" />
          </div>
        `;
      }
      if (actionType === 'core.ackIndicator') {
        return `
          <div class="modal-form-row">
            <label>Acknowledge Event (optional) <span class="prop-hint" title="Leave blank to use this component's own binding.ackEvent at runtime.">ⓘ</span></label>
            ${eventPickerHtml('im-event', prior?.event || comp.binding?.ackEvent || '')}
          </div>
        `;
      }
      return '<div class="caps-empty">This action takes no additional fields.</div>';
    };

    const result = await openModal({
      title: existing ? 'Edit Interaction Trigger' : 'Add Interaction Trigger',
      wide: true,
      bodyHtml: `
        <div class="modal-form-row">
          <label>Trigger</label>
          <select id="im-trigger" class="prop-select">${TRIGGER_TYPES.map((t) => `<option value="${t.id}" ${existing?.trigger === t.id ? 'selected' : ''}>${t.id}${t.live ? '' : ' (inactive — kept for old widgets)'}</option>`).join('')}</select>
        </div>
        <div class="modal-form-row">
          <label>Action</label>
          <select id="im-action-type" class="prop-select">${ACTION_TYPES.map((a) => `<option value="${a.type}" ${a.type === initialActionType ? 'selected' : ''}>${a.label}</option>`).join('')}</select>
        </div>
        <div id="im-dynamic-fields">${dynamicFieldsHtml(initialActionType)}</div>
        <div class="modal-form-row" style="margin-top:6px;border-top:1px solid var(--studio-panel-border);padding-top:10px;">
          <label style="display:flex;align-items:center;gap:6px;">
            <input type="checkbox" id="im-condition-on" ${existing?.condition ? 'checked' : ''} />
            Only Run If (optional) <span class="prop-hint" title="FDWS v1.23: the action (and feedback) above only fires when this is true — the interaction still runs its trigger normally otherwise, it just no-ops. Reuses the same condition grammar as Visible When. Example: skip a preset button's dispatch when its own presets[0].freq is still empty, instead of sending an empty/zeroed value.">ⓘ</span>
          </label>
          <div id="im-condition-row" class="${existing?.condition ? '' : 'hidden'}"></div>
        </div>
        <div class="modal-form-row" style="margin-top:6px;border-top:1px solid var(--studio-panel-border);padding-top:10px;">
          <label>Feedback (optional) <span class="prop-hint" title="FDWS v1.2 §4.1: fires alongside the action above, on every device that supports it. Independent of which action is chosen.">ⓘ</span></label>
          <div class="modal-form-row">
            <label style="font-weight:400;">Haptic</label>
            <select id="im-feedback-haptic" class="prop-select">
              <option value="" ${!existing?.feedback?.haptic ? 'selected' : ''}>None</option>
              <option value="light" ${existing?.feedback?.haptic === 'light' ? 'selected' : ''}>Light</option>
              <option value="medium" ${existing?.feedback?.haptic === 'medium' ? 'selected' : ''}>Medium</option>
              <option value="heavy" ${existing?.feedback?.haptic === 'heavy' ? 'selected' : ''}>Heavy</option>
            </select>
          </div>
          <div class="modal-form-row">
            <label style="font-weight:400;">Sound</label>
            <select id="im-feedback-sound" class="prop-select">
              <option value="" ${!existing?.feedback?.sound ? 'selected' : ''}>None</option>
              ${(this.state.widgetDef.assets || []).map((a) => `<option value="${a.id}" ${existing?.feedback?.sound === a.id ? 'selected' : ''}>${a.id}</option>`).join('')}
            </select>
            ${(this.state.widgetDef.assets || []).length === 0 ? '<div class="caps-empty">No assets uploaded yet — add one on the Assets tab for a switch-click sound.</div>' : ''}
          </div>
        </div>
      `,
      onMount: (card) => {
        const actionSel = card.querySelector('#im-action-type');
        const dynamicMount = card.querySelector('#im-dynamic-fields');

        const wireEventPicker = () => {
          const sel = card.querySelector('#im-event');
          const custom = card.querySelector('#im-event-custom');
          sel?.addEventListener('change', () => custom?.classList.toggle('hidden', sel.value !== CUSTOM_OPTION_VALUE));
        };

        const renderContextRows = () => {
          const mount = card.querySelector('#im-context-rows');
          if (!mount) return;
          mount.innerHTML = contextRows.length === 0 ? '<div class="caps-empty">None yet.</div>' : contextRows.map((row, idx) => `
            <div class="row-list-item" data-ctx-idx="${idx}">
              <input type="text" class="row-field ctx-key" value="${row.key}" placeholder="Context key" />
              <input type="text" class="row-field ctx-stateref" value="${row.stateRef}" placeholder="Host stateRef path" />
              <label style="display:flex;align-items:center;gap:4px;font-size:10px;"><input type="checkbox" class="ctx-writable" ${row.writable ? 'checked' : ''} /> Writable</label>
              <select class="row-field ctx-applyon prop-select ${row.writable ? '' : 'hidden'}">
                <option value="immediate" ${row.applyOn === 'immediate' ? 'selected' : ''}>Apply immediately</option>
                <option value="onHostTap" ${row.applyOn === 'onHostTap' ? 'selected' : ''}>Apply on host tap</option>
              </select>
              <button type="button" class="btn-mini-close ctx-remove">✕</button>
            </div>
          `).join('');

          mount.querySelectorAll('[data-ctx-idx]').forEach((rowEl) => {
            const idx = Number(rowEl.dataset.ctxIdx);
            rowEl.querySelector('.ctx-key')?.addEventListener('change', (e) => { contextRows[idx].key = e.target.value; });
            rowEl.querySelector('.ctx-stateref')?.addEventListener('change', (e) => { contextRows[idx].stateRef = e.target.value; });
            rowEl.querySelector('.ctx-writable')?.addEventListener('change', (e) => {
              contextRows[idx].writable = e.target.checked;
              if (!contextRows[idx].applyOn) contextRows[idx].applyOn = 'onHostTap';
              renderContextRows();
            });
            rowEl.querySelector('.ctx-applyon')?.addEventListener('change', (e) => { contextRows[idx].applyOn = e.target.value; });
            rowEl.querySelector('.ctx-remove')?.addEventListener('click', () => { contextRows.splice(idx, 1); renderContextRows(); });
          });
        };

        const wireDynamicFields = () => {
          wireEventPicker();
          card.querySelector('#im-context-add')?.addEventListener('click', () => {
            contextRows.push({ key: '', stateRef: '', writable: false, applyOn: undefined });
            renderContextRows();
          });
          renderContextRows();
        };

        actionSel.addEventListener('change', () => {
          contextRows = [];
          dynamicMount.innerHTML = dynamicFieldsHtml(actionSel.value);
          wireDynamicFields();
        });

        wireDynamicFields();

        // G6 slice 2: "Only Run If" now uses the same shared compound
        // condition editor as visibleWhen/style.rules, deferred (nothing
        // mutates real state until Submit, below).
        const conditionToggle = card.querySelector('#im-condition-on');
        const conditionMount = card.querySelector('#im-condition-row');

        const renderConditionEditor = () => {
          const editor = this.renderConditionListEditor(comp, this.state.widgetDef, conditionExpr, 'imcond', (nextValue) => {
            conditionExpr = nextValue;
            renderConditionEditor();
          }, { deferred: true });
          conditionMount.innerHTML = editor.html;
          editor.wire(conditionMount);
        };
        renderConditionEditor();

        conditionToggle?.addEventListener('change', (e) => {
          conditionMount.classList.toggle('hidden', !e.target.checked);
        });
      },
      onSubmit: (card) => {
        const trigger = card.querySelector('#im-trigger').value;
        const actionType = card.querySelector('#im-action-type').value;
        const actionObj = { type: actionType };

        if (actionType === 'core.dispatchEvent') {
          const sel = card.querySelector('#im-event');
          const custom = card.querySelector('#im-event-custom');
          const ev = sel.value === CUSTOM_OPTION_VALUE ? custom.value.trim() : sel.value;
          if (!ev) return { error: 'Choose or type an event to dispatch.' };
          actionObj.event = ev;
          const fromStateRef = card.querySelector('#im-fromstateref')?.value.trim();
          if (fromStateRef) {
            actionObj.fromStateRef = fromStateRef;
          } else {
            const raw = card.querySelector('#im-value')?.value.trim() ?? '1';
            actionObj.value = raw === 'true' ? true : (raw === 'false' ? false : (raw !== '' && !isNaN(Number(raw)) ? Number(raw) : raw));
          }
        } else if (actionType === 'core.toggleLocalState') {
          const field = card.querySelector('#im-field').value.trim();
          if (!field) return { error: 'State field name is required.' };
          actionObj.field = field;
        } else if (actionType === 'core.setLocalState') {
          const field = card.querySelector('#im-field').value.trim();
          if (!field) return { error: 'State field name is required.' };
          actionObj.field = field;
          const fromStateRef = card.querySelector('#im-fromstateref')?.value.trim();
          if (fromStateRef) {
            actionObj.fromStateRef = fromStateRef;
          } else {
            const raw = card.querySelector('#im-value').value.trim();
            actionObj.value = raw === 'true' ? true : (raw === 'false' ? false : (raw !== '' && !isNaN(Number(raw)) ? Number(raw) : raw));
          }
        } else if (actionType === 'core.swapLocalState') {
          const f1 = card.querySelector('#im-field1').value.trim();
          const f2 = card.querySelector('#im-field2').value.trim();
          if (!f1 || !f2) return { error: 'Both fields are required.' };
          actionObj.fields = [f1, f2];
        } else if (actionType === 'core.openWidgetPopover') {
          const sel = card.querySelector('#im-popover-id');
          if (!sel || !sel.value) return { error: 'Save a popover widget first, then pick it here.' };
          actionObj.popoverWidgetId = sel.value;
          const context = {};
          contextRows.forEach((row) => {
            if (!row.key) return;
            context[row.key] = { value: { stateRef: row.stateRef }, writable: !!row.writable, ...(row.writable && row.applyOn ? { applyOn: row.applyOn } : {}) };
          });
          actionObj.context = context;
        } else if (actionType === 'core.commitToHost') {
          const contextKey = card.querySelector('#im-contextkey').value.trim();
          if (!contextKey) return { error: 'Context key is required.' };
          actionObj.contextKey = contextKey;
          const field = card.querySelector('#im-commit-field')?.value.trim();
          if (field) actionObj.field = field;
        } else if (actionType === 'core.ackIndicator') {
          const sel = card.querySelector('#im-event');
          const custom = card.querySelector('#im-event-custom');
          const ev = sel.value === CUSTOM_OPTION_VALUE ? custom.value.trim() : sel.value;
          if (ev) actionObj.event = ev;
        }
        // core.closePopover takes no payload.

        const feedback = {};
        const haptic = card.querySelector('#im-feedback-haptic')?.value;
        const sound = card.querySelector('#im-feedback-sound')?.value;
        if (haptic) feedback.haptic = haptic;
        if (sound) feedback.sound = sound;

        // G6 slice 2: interaction.condition — omitted entirely unless the
        // author actually enabled it AND it has at least one condition,
        // matching every other optional-field pattern in this form
        // (empty/unchecked means "not declared", not "declared as
        // always-false"). conditionExpr is already in ready-to-store shape
        // (renderConditionListEditor's own onCommit contract).
        const conditionObj = card.querySelector('#im-condition-on')?.checked ? conditionExpr : null;

        // Derive whether the FINAL condition actually uses "Use This
        // Component's Own Value" by checking every leaf, rather than tracking
        // it incrementally per-keystroke (the old single-leaf code's
        // approach) — correctly handles even two different rows both picking
        // it, and doesn't need resetting on every unrelated row change.
        if (conditionObj) {
          const simVar = comp.binding?.readSimVar;
          const ownValueVarName = simVar ? this.state.resolveSyncFromVarName(simVar) : null;
          const leaves = conditionObj.allOf || conditionObj.anyOf || (conditionObj.state ? [conditionObj] : []);
          if (ownValueVarName && leaves.some((c) => c.state === ownValueVarName)) {
            ownValueSimVar = simVar;
          }
        }

        return {
          value: {
            trigger,
            action: actionObj,
            ...(conditionObj ? { condition: conditionObj } : {}),
            ...(Object.keys(feedback).length ? { feedback } : {})
          }
        };
      }
    });

    if (!result) return;
    const nextInteractions = [...(comp.interactions || [])];
    if (editIdx !== null) {
      nextInteractions[editIdx] = result;
    } else {
      nextInteractions.push(result);
    }
    // V14: the syncFrom var behind "Use This Component's Own Value" is only
    // created now, at the real commit — cancelling the modal must leave
    // nothing behind. One undo step for both, same pasteStyleToSelection-style
    // inline saveHistory + direct mutation the two immediate-commit condition
    // editors already use.
    if (ownValueSimVar) {
      this.state.saveHistory(editIdx !== null ? 'Edit Interaction' : 'Add Interaction');
      this.state.ensureSyncFromVar(ownValueSimVar);
      this.state.updateComponent(comp.id, { interactions: nextInteractions }, false);
    } else {
      this.state.updateComponent(comp.id, { interactions: nextInteractions });
    }
  }

  /**
   * Part 5a, Slice 1: the Connect dialog — Catalogue + Raw Address tabs.
   * `kind` is 'read' (binding.readSimVar) or 'write' (binding.writeEvent).
   * Additive: the existing Advanced dropdown/custom-input fields and the
   * Simple-mode two-step picker are untouched and stay fully usable — this
   * is a new, recommended entry point, not a replacement (design principle
   * 6, "escape hatches stay, and stop being the only route" — not "become
   * the only route").
   *
   * The write-kind commit is the V20 fix: picking a write target here also
   * proposes (default-checked) the interaction that makes it actually fire,
   * reusing StudioValidator's isWriteEventConsumed()/proposeWireUp() so a
   * Connect-created binding can't end up in the "looks wired, does nothing"
   * state those exist to detect. Test tab (SimVar Tester reuse) and "Use
   * this component's own value" (syncFrom, V14) are deliberately not part
   * of this slice — see the plan file's Context section.
   */
  // Ticket 18: `bindingField` defaults to the read/write pair every existing
  // caller relies on, but core.rotary's Increment/Decrement Deck Event
  // fields are also 'write'-kind Deck Events (for catalogue/pairing
  // purposes) that need to land on binding.incrementEvent/decrementEvent
  // instead of binding.writeEvent — so it's an explicit override rather
  // than re-deriving a third case from `kind`. Everything below the initial
  // `current`/`updates` already reads `bindingField` as a variable except
  // the self-dispatching pairing branch a few dozen lines down, which is
  // safe unmodified: core.rotary is in SELF_DISPATCHING_WRITE_EVENT_TYPES,
  // so proposeWireUp(comp) always returns null for it regardless of which
  // binding field is actually being set, and that branch is a no-op.
  async openConnectDialog(comp, def, kind, bindingField = (kind === 'write' ? 'writeEvent' : 'readSimVar')) {
    const isWrite = kind === 'write';
    const sanitizeKind = isWrite ? 'event' : 'simvar';
    const current = comp.binding?.[bindingField] || '';

    const stateVars = def.state || [];
    const savedWidgets = this.state.loadSavedWidgets().filter((w) => w.id !== def.id);
    const customDeckEvents = extractCustomDeckEvents(savedWidgets, DECK_EVENT_NAMES).map((e) => ({
      ...e,
      source: e.widgetIds.length ? `used by ${e.widgetIds.join(', ')}` : ''
    }));
    const packEvents = getPackSuggestedEvents()
      .filter((e) => !customDeckEvents.some((c) => c.name === e.name))
      .map((e) => ({ name: e.name, kind: e.kind, source: `from pack: ${e.fromPack}` }));
    // Same "previously used" data the existing Custom… dropdown already
    // reads (buildCustomOptions, above) — surfaced here as browsable rows
    // and as autocomplete suggestions on the Raw Address tab, not a new
    // list. This project does not grow simvar/event coverage lists by any
    // method (see project memory) — this is existing in-app data only.
    const mergedCustom = [...customDeckEvents, ...packEvents].filter((e) => e.kind === kind);

    const catalogueItems = getDeckEventsByKind(kind);
    const categories = [...new Set(catalogueItems.map((e) => e.category))];

    // Dialog-local state, mutated in place across re-renders (same pattern
    // openAddInteractionModal's contextRows uses) rather than re-opening
    // the modal on every interaction.
    let activeTab = /^(A|L|H|K):/i.test(current) ? 'raw' : 'catalogue';
    let selectedName = current;
    let searchQuery = '';
    let rawUnit = comp.binding?.unit || '';
    let testResult = '';
    let testBusy = false;

    const proposedRows = isWrite ? proposeWireUp(comp) : null;

    const catalogueRowsHtml = () => {
      const q = searchQuery.trim().toLowerCase();
      const matches = (e) => !q || e.label.toLowerCase().includes(q) || e.name.toLowerCase().includes(q);
      const rows = catalogueItems.filter(matches).map((e) => `
        <button type="button" class="row-list-item cn-pick" data-name="${escapeHtmlAttr(e.name)}" style="width:100%;text-align:left;cursor:pointer;${selectedName === e.name ? 'outline:1px solid var(--accent-cyan);' : ''}">
          <div style="flex:1;min-width:0;">
            <div>${escapeHtmlAttr(e.label)}</div>
            <div style="font-size:10px;color:var(--text-label);">${escapeHtmlAttr(e.name)} · ${escapeHtmlAttr(CATEGORY_LABELS[e.category] || e.category)}</div>
          </div>
        </button>
      `).join('');
      const customRows = mergedCustom.filter(matches).map((e) => `
        <button type="button" class="row-list-item cn-pick" data-name="${escapeHtmlAttr(e.name)}" style="width:100%;text-align:left;cursor:pointer;${selectedName === e.name ? 'outline:1px solid var(--accent-cyan);' : ''}">
          <div style="flex:1;min-width:0;">
            <div>${escapeHtmlAttr(e.name)}</div>
            <div style="font-size:10px;color:var(--text-label);">${escapeHtmlAttr(e.source || '')}</div>
          </div>
        </button>
      `).join('');
      return `
        ${rows || `<div class="caps-empty">No matches in this widget's Deck Events catalogue. <button type="button" class="btn-mini-inline" id="cn-findit">Find it by moving it →</button></div>`}
        ${customRows ? `<div class="prop-section-subtitle" style="margin-top:8px;">Previously Used</div>${customRows}` : ''}
      `;
    };

    const rawTabHtml = () => `
      <div class="prop-field">
        <label>${isWrite ? 'Raw SimConnect Event (H:/K:...)' : 'Raw SimVar (A:/L:...)'}</label>
        <input type="text" id="cn-raw-input" class="prop-input" value="${escapeHtmlAttr(activeTab === 'raw' ? selectedName : '')}" placeholder="${isWrite ? 'e.g. H:GTN750_DirectToPush' : 'e.g. L:FBW_TAXI_LIGHT_INTENSITY'}" list="cn-raw-suggestions" />
        <datalist id="cn-raw-suggestions">${mergedCustom.map((e) => `<option value="${escapeHtmlAttr(e.name)}"></option>`).join('')}</datalist>
        <div class="prop-sanitize-diff hidden" id="cn-raw-diff"></div>
      </div>
      ${!isWrite ? `
        <div class="prop-field">
          <label>SimConnect Unit <span class="prop-hint" title="Only a raw address's unit is yours to set — a Deck Event's unit comes from the active PC Bridge profile, which is why this field only appears here, not on the Catalogue tab. Leave blank to use the host's default ('Number'). For a TEXT variable (TITLE, ATC MODEL, ATC ID) type 'string'.">ⓘ</span></label>
          <input type="text" id="cn-raw-unit" class="prop-input" value="${escapeHtmlAttr(rawUnit)}" placeholder="Number" />
        </div>
      ` : ''}
    `;

    const pairingHtml = () => {
      if (!isWrite || !selectedName) return '';
      // Matches StudioValidator's own exemptions exactly (comp.type dictates
      // this, never the chosen event) — these types dispatch binding.writeEvent
      // themselves at runtime, so no interaction is needed or meaningful.
      if (SELF_DISPATCHING_WRITE_EVENT_TYPES.includes(comp.type)) {
        return `<div class="prop-hint-block" style="font-size:11px;opacity:0.7;margin-top:8px;">This component type sends this value automatically — no interaction needed.</div>`;
      }
      if (isWriteEventConsumed({ ...comp, binding: { ...comp.binding, writeEvent: selectedName } })) {
        return `<div class="prop-hint-block" style="font-size:11px;opacity:0.7;margin-top:8px;">Already wired — an existing interaction dispatches this event.</div>`;
      }
      if (!proposedRows) {
        return `<div class="prop-hint-block" style="font-size:11px;opacity:0.7;margin-top:8px;">This component type has no single-trigger auto-wire — add an interaction manually (Behavior panel) once connected, or it won't do anything yet.</div>`;
      }
      const rowsDesc = proposedRows.map((r) => `<code>${escapeHtmlAttr(r.trigger)}</code>`).join(' + ');
      return `
        <label class="prop-field" style="display:flex;align-items:center;gap:6px;font-size:11px;margin-top:8px;">
          <input type="checkbox" id="cn-pair-checkbox" checked />
          Also add: ${rowsDesc} → Dispatch Sim Event — without this, setting the event alone does nothing when tapped.
        </label>
      `;
    };

    const testTabHtml = () => {
      if (isWrite) {
        return `
          <div class="prop-hint-block" style="font-size:11px;opacity:0.7;">A write event can't be verified by reading it back — firing it and watching a SimVar change is the only real proof. That's Fire &amp; Watch, in the SimVar Tester drawer below; this hands off there with the event pre-filled.</div>
          <button type="button" class="bar-btn" id="cn-test-firewatch" style="margin-top:8px;" ${selectedName ? '' : 'disabled'}>Open in Fire &amp; Watch →</button>
        `;
      }
      if (!selectedName) {
        return `<div class="prop-hint-block" style="font-size:11px;opacity:0.7;">Pick or type a SimVar first, then come back here to test it live.</div>`;
      }
      return `
        <div class="prop-field">
          <label>${escapeHtmlAttr(selectedName)}</label>
          <button type="button" class="bar-btn" id="cn-test-probe" ${testBusy ? 'disabled' : ''}>${testBusy ? 'Testing…' : 'Test'}</button>
        </div>
        <div class="svt-result">${escapeHtmlAttr(testResult)}</div>
      `;
    };

    const bodyHtml = () => `
      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <button type="button" class="mode-toggle-btn ${activeTab === 'catalogue' ? 'active' : ''}" id="cn-tab-catalogue" style="flex:1;">Catalogue</button>
        <button type="button" class="mode-toggle-btn ${activeTab === 'raw' ? 'active' : ''}" id="cn-tab-raw" style="flex:1;">Raw Address</button>
        <button type="button" class="mode-toggle-btn ${activeTab === 'test' ? 'active' : ''}" id="cn-tab-test" style="flex:1;">Test</button>
      </div>
      ${activeTab === 'catalogue' ? `
        <input type="text" id="cn-search" class="prop-input" placeholder="Search by name…" value="${escapeHtmlAttr(searchQuery)}" style="margin-bottom:8px;" />
        <div id="cn-catalogue-rows" style="display:flex;flex-direction:column;gap:4px;max-height:260px;overflow-y:auto;">${catalogueRowsHtml()}</div>
      ` : activeTab === 'raw' ? rawTabHtml() : testTabHtml()}
      <div id="cn-pairing">${activeTab === 'test' ? '' : pairingHtml()}</div>
    `;

    const result = await openModal({
      title: `Connect — ${isWrite ? 'Write to' : 'Read from'} Simulator`,
      bodyHtml: bodyHtml(),
      submitLabel: 'Connect',
      wide: true,
      onMount: (card) => {
        const pairingMount = () => card.querySelector('#cn-pairing');
        const refreshPairing = () => { pairingMount().innerHTML = pairingHtml(); };

        const wireCatalogueTab = () => {
          card.querySelector('#cn-search')?.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            card.querySelector('#cn-catalogue-rows').innerHTML = catalogueRowsHtml();
            wireCatalogueRows();
          });
          wireCatalogueRows();
        };
        const wireCatalogueRows = () => {
          card.querySelectorAll('.cn-pick').forEach((btn) => {
            btn.addEventListener('click', () => {
              selectedName = btn.dataset.name;
              rawUnit = ''; // FDWS v1.2 §1.5: a catalogue pick's unit comes from the PC Bridge profile — a stale raw unit left over from a prior raw-address value would now be silently inert.
              card.querySelectorAll('.cn-pick').forEach((b) => b.style.outline = b.dataset.name === selectedName ? '1px solid var(--accent-cyan)' : '');
              refreshPairing();
            });
          });
          // Post-implementation review §7: a zero-match search used to be a
          // dead end — point at the SimVar Tester's wiggle-to-find instead.
          // The overlay-modal chrome sits above the app's own drawers, so the
          // tester wouldn't be visible without closing this dialog first.
          card.querySelector('#cn-findit')?.addEventListener('click', () => {
            card.querySelector('[data-modal-cancel]')?.click();
            this.simVarTester?.open();
          });
        };
        const wireRawTab = () => {
          const input = card.querySelector('#cn-raw-input');
          const unitInput = card.querySelector('#cn-raw-unit');
          const diffEl = card.querySelector('#cn-raw-diff');
          const updateDiff = () => {
            if (!input || !diffEl) return;
            const { removed } = SecurityValidator.sanitizeWithReport(sanitizeKind, input.value);
            diffEl.classList.toggle('hidden', removed.length === 0);
            if (removed.length) diffEl.textContent = `Removed ${removed.map((c) => `"${c}"`).join(' ')} — only the cleaned text will be saved.`;
          };
          input?.addEventListener('input', () => {
            const { cleaned } = SecurityValidator.sanitizeWithReport(sanitizeKind, input.value);
            selectedName = cleaned;
            updateDiff();
            refreshPairing();
          });
          unitInput?.addEventListener('input', () => { rawUnit = unitInput.value.trim(); });
        };
        const rerenderTestTab = () => {
          card.querySelector('.modal-body').innerHTML = bodyHtml();
          wireTestTab();
        };
        const wireTestTab = () => {
          card.querySelector('#cn-test-firewatch')?.addEventListener('click', () => {
            this.simVarTester?.prefillFireAndWatch(selectedName);
          });
          card.querySelector('#cn-test-probe')?.addEventListener('click', async () => {
            if (!this.simBridge?.connected) {
              testResult = 'Not connected to PC Bridge — set the server address from the status pill in the top bar.';
              rerenderTestTab();
              return;
            }
            testBusy = true;
            testResult = '';
            rerenderTestTab();
            try {
              // Same shape-check openConnectDialog uses to decide the initial
              // tab (:3650) — a raw address always matches, a Deck Event
              // logical name never does, so this is provenance-free.
              if (/^(A|L):/i.test(selectedName)) {
                const value = await this.simBridge.probeReadSimVar(selectedName, rawUnit);
                testResult = `✅ Live value: ${value}`;
              } else {
                const resolved = await this.simBridge.resolveDeckEvent(selectedName);
                if (!resolved) {
                  testResult = `"${selectedName}" has no mapping in the active profile.`;
                } else {
                  const value = await this.simBridge.probeReadSimVar(resolved.simVar, resolved.unit);
                  testResult = `✅ Live value: ${value} (${resolved.simVar}, unit ${resolved.unit})`;
                }
              }
            } catch (err) {
              testResult = `❌ ${err.message}`;
            } finally {
              testBusy = false;
              rerenderTestTab();
            }
          });
        };

        card.querySelector('#cn-tab-catalogue')?.addEventListener('click', () => {
          activeTab = 'catalogue';
          card.querySelector('.modal-body').innerHTML = bodyHtml();
          wireCatalogueTab();
        });
        card.querySelector('#cn-tab-raw')?.addEventListener('click', () => {
          activeTab = 'raw';
          card.querySelector('.modal-body').innerHTML = bodyHtml();
          wireRawTab();
        });
        card.querySelector('#cn-tab-test')?.addEventListener('click', () => {
          activeTab = 'test';
          card.querySelector('.modal-body').innerHTML = bodyHtml();
          wireTestTab();
        });

        if (activeTab === 'catalogue') wireCatalogueTab(); else wireRawTab();
      },
      onSubmit: (card) => {
        if (!selectedName) return { error: `Choose or type a ${isWrite ? 'write event' : 'SimVar'} first.` };
        const pairChecked = card.querySelector('#cn-pair-checkbox')?.checked ?? true;
        return { value: { name: selectedName, unit: activeTab === 'raw' ? rawUnit : undefined, pair: pairChecked } };
      }
    });

    if (!result) return;

    const updates = { [bindingField]: result.name };
    if (!isWrite) updates.unit = result.unit || undefined;

    if (isWrite && result.pair) {
      const withNewEvent = { ...comp, binding: { ...comp.binding, writeEvent: result.name } };
      if (!isWriteEventConsumed(withNewEvent)) {
        const rows = proposeWireUp(comp);
        if (rows) {
          this.state.updateComponent(comp.id, {
            binding: { ...(comp.binding || {}), ...updates },
            interactions: [...(comp.interactions || []), ...rows]
          });
          return;
        }
      }
    }
    this.state.updateComponent(comp.id, { binding: { ...(comp.binding || {}), ...updates } });
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
