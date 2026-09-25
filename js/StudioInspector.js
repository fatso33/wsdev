/**
 * @module StudioInspector
 * Right sidebar Property Inspector facade. It owns the live host, state subscription,
 * render branches and focus restoration; named inspector modules own the sections,
 * controls and edit paths reached through its stable methods.
 */

import { computeScrollAnchorDelta } from './InspectorLogic.js';
import { createFieldRenderers } from './inspector/fieldRenderers.js';
import { renderWidgetInspector, openFullJsonPanel } from './inspector/sections/WidgetSection.js';
import { getFieldValue, commitRotaryFeelContext, commitRotaryFeelEntry, commitField, updateCompProp, updateCompJsonProp } from './inspector/InspectorEdits.js';
import { enhanceNumberInputs, getNumberStep, decimalPlaces, roundToDecimals, renderRangeEditor, renderRowListEditor, toHexColor, wireColorPair, humanizeFieldLabel, fieldDomId, resolveFeelFloorHint, resolvePulseFeelDescription, renderPlainField, renderCheckboxField, renderSelectField, renderColorField, renderRowListField, renderStateVarField, renderAssetField, renderRangeField, renderPivotField } from './inspector/ui/FieldFactory.js';
import { renderRegistryFieldGroups, renderRegistryFields, renderCompoundGroup, assembleCompoundRow, buildFieldWrap, formatShowWhenReason, evaluateShowWhen, resolveEffectiveValue } from './inspector/ui/FieldGroups.js';
import { buildModeToggle, tierHidesField, applyUiMode, applySubtitleVisibility, applyTierMoreBadges, applySectionJsonViews, buildInspectorTabShell, buildLayoutBadge, buildAppearanceBadge, buildDataBadge, buildBehaviorBadge, buildAccordionGroup } from './inspector/InspectorShell.js';
import { getThemeEditContext, remapAppearancePath, retargetAppearanceFields, renderAppearanceSection, renderBaseThemeAwareAppearanceFields } from './inspector/sections/AppearanceSection.js';
import { buildMultiSelectStyleProxy, applyMultiSelectFieldAvailability, renderMultiSelectInspector } from './inspector/MultiSelectInspector.js';
import { openConditionEditorPopover, renderVisibilityAndGuard, renderConditionListEditor } from './inspector/sections/ConditionsSection.js';
import { openAddInteractionModal } from './inspector/sections/InteractionsSection.js';
import { openConnectDialog } from './inspector/sections/ConnectDialog.js';
import { renderComponentInspector, renderTypeSpecificProps, renderUnrecognisedPropertiesBlock } from './inspector/sections/ComponentSection.js';
export class StudioInspector {
  /**
   * @param {HTMLElement} container
   * @param {import('./StudioState.js').StudioState} state
   */
  constructor(container, state, simBridge) {
    this.container = container;
    this.state = state;
    // The Bridge is optional; connected checks in the binding UI preserve
    // offline rendering while gating live probes and Deck Event resolution.
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

    // The tier is a browser preference, not widget data. Apply its visibility
    // after each render so one markup tree serves all tiers. Legacy binary
    // preferences map to equivalent access levels; a new browser starts Guided.
    const savedTier = localStorage.getItem('fdws_studio_uiMode');
    this.uiTier = savedTier === 'advanced' ? 'full'
      : savedTier === 'simple' ? 'build'
      : (savedTier === 'guided' || savedTier === 'build' || savedTier === 'full') ? savedTier
      : 'guided';
    // Per-accordion-section "show hidden fields anyway, without
    // leaving the tier" override — see buildAccordionGroup()'s "N more"
    // affordance. Keyed by group title, same persists-across-renders pattern
    // as expandedGroups/knownGroupTitles above.
    this.tierOverrideGroups = new Set();
    // Per-section "View JSON" open/closed state, Full tier only
    // — see applySectionJsonViews(). Keyed by group title, same
    // persists-across-renders pattern as expandedGroups/tierOverrideGroups.
    this.jsonViewOpenTitles = new Set();

    // The outer tab (General/Style/Data/Events)
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
   * Preserves focus, text selection and the focused element's scroll position
   * while renderInner() replaces the panel DOM on every edit. The class sets
   * retain accordion choices; DOM focus needs explicit restoration.
   */
  render() {
    const active = this.container.contains(document.activeElement) ? document.activeElement : null;
    const focusId = active?.id || null;
    const selRange = (focusId && 'selectionStart' in active && typeof active.selectionStart === 'number')
      ? [active.selectionStart, active.selectionEnd]
      : null;

    // Anchor the focused element's on-screen position relative to
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
    // Reset each render — every buildAccordionGroup() call below repopulates
    // it fresh, so a section removed between renders (e.g. deselecting a component)
    // can't leave a stale entry behind.
    this._sectionJsonData = {};
    this.container.appendChild(this.buildModeToggle());

    // A multi-selection uses its bulk-edit view instead of a single
    // component's panel, so edits apply to the complete selection.
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
    return renderComponentInspector(this, comp);
  }

  renderVisibilityAndGuard(comp, def, body) {
    return renderVisibilityAndGuard(this, comp, def, body);
  }

  renderConditionListEditor(comp, def, expr, idPrefix, onCommit, options = {}) {
    return renderConditionListEditor(this, comp, def, expr, idPrefix, onCommit, options);
  }

  renderTypeSpecificProps(comp, body) {
    return renderTypeSpecificProps(this, comp, body);
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
   * Renders a small "Unrecognised properties" block for
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
    return renderUnrecognisedPropertiesBlock(this, items, fdwsVersion, idPrefix, onCommit);
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
