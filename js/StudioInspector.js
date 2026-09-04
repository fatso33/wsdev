/**
 * StudioInspector.js
 * Right Sidebar Property Inspector for Flight Deck Widget Studio
 * Organized into intuitive, structured accordion property groups adhering strictly to FDWS v1.4
 */

import { StudioValidator, isWriteEventConsumed, proposeWireUp, SELF_DISPATCHING_WRITE_EVENT_TYPES } from './StudioValidator.js';
import { SecurityValidator } from '../core/SecurityValidator.js';
import { getDeckEventsByKind, getDeckEventsByCategory, DECK_EVENTS, DECK_EVENT_NAMES } from '../core/deckEvents.js';
import { extractCustomDeckEvents } from '../core/widgetVarExtractor.js';
import { getPackSuggestedEvents } from '../core/deckEventPacks.js';
import { openModal, confirmModal, showToast } from './StudioModal.js';
// Widget Studio 2.0, Phase 1: TRIGGERS/ACTIONS are now read from
// PropertyRegistry.js instead of being hand-copied arrays here — the exact
// "UI list is stale relative to runtime" bug class found four times in the
// original Studio audit (this file's own trigger/action lists were two of
// those four instances).
import { TRIGGERS as REGISTRY_TRIGGERS, ACTIONS as REGISTRY_ACTIONS, TYPE_FIELDS as REGISTRY_TYPE_FIELDS, COMMON_FIELDS as REGISTRY_COMMON_FIELDS, VALUE_FORMATS as REGISTRY_VALUE_FORMATS, getFieldsForType, getStateStyleConfig } from '../widgets/PropertyRegistry.js';
import { STYLE_PRESETS } from './StudioStylePresets.js';
import { themeAdjustColor, themeAdjustGradient } from '../widgets/components/ThemeColor.js';
// Widget Studio 2.0, Phase 2: interactions[].feedback (FDWS v1.2 §4.1 haptic/
// audio) — a real, working runtime feature since v1.2 that never had Studio
// UI until now. Not imported from PropertyRegistry.js's INTERACTION_FIELDS
// directly (that array documents the two sub-fields for future registry-
// driven rendering) — this modal still hand-builds its markup like every
// other action-specific field here, so the two are wired by hand below,
// consistent with the rest of this modal's un-generic-ized fields.

const CUSTOM_OPTION_VALUE = '__custom__';

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


// FDWS v1.25: style.states.<name> (border/background/typography overrides
// merged over the base style while a component is in a named interaction
// state — BaseComponent.applyStyles()'s stateStyle merge, and for multi-
// surface components BaseComponent.applyOptionalStateStyle()) has existed at
// runtime since core.button's toggle variant and core.indicator's severity
// states, but never had Property Inspector UI (PropertyRegistry.js's
// style.states entry was declared with control:'stateStyleEditor' and never
// actually implemented). Which state name (if any) applies to a given
// component type/variant lives in PropertyRegistry.js's
// STATE_STYLE_SUPPORT/getStateStyleConfig() (shared with StudioValidator.js's
// cross-check) rather than a local copy here.
function resolveStateStyleConfig(comp) {
  return getStateStyleConfig(comp.type, comp.props);
}

// Wave 2 Part B2: short chip label for a style.rules[] entry's condition —
// e.g. "oilTempF > 115" — used both as the rule chip's visible text and its
// title tooltip (chips truncate with ellipsis once there are several).
const RULE_OP_SYMBOLS = { equals: '=', notEquals: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤' };
function summarizeRuleCondition(when) {
  if (!when || !when.state) return 'New Rule';
  const op = Object.keys(RULE_OP_SYMBOLS).find((o) => when[o] !== undefined);
  if (op) return `${when.state} ${RULE_OP_SYMBOLS[op]} ${when[op]}`;
  if (Array.isArray(when.between)) return `${when.state} in [${when.between.join(', ')}]`;
  return when.state;
}

// Wave 2 Part B1 (Part 4, first slice): the Appearance panel's field set,
// filtered from COMMON_FIELDS rather than hand-listed, so a future FDWS
// field addition to COMMON_FIELDS appears here automatically. Excludes
// style.rules (Wave 2 Part B2: a rule's own fields are these SAME rows,
// retargeted per-rule — this just excludes the `style.rules` row itself,
// the array/panel-level entry, not its contents) and style.states (this IS
// the panel, not a field within it), and style.themeOverride.* (the Theme
// chip — not part of this slice, see renderAppearanceSection's own comment
// for why Theme stays hand-coded on the Base tab for now).
function getAppearanceFieldSpecs() {
  return REGISTRY_COMMON_FIELDS.filter((f) =>
    f.path.startsWith('style.') &&
    f.path !== 'style.rules' &&
    f.path !== 'style.states' &&
    !f.path.startsWith('style.themeOverride.')
  );
}

// A "Background Color" field pairs a native <input type="color"> (which can
// only ever emit a valid hex) with a free-text sibling — free-text on
// purpose, so an author can type var(--text-white, #fff) or an rgba() value
// the color picker can't produce. That same freedom lets someone paste a
// full linear-gradient(...)/radial-gradient(...) CSS value in while
// background.type is still "color" — it saves fine (still valid CSS as a
// literal string) and even paints correctly the first time, but
// ThemeColor.js can't find an actual color inside it to re-derive for the
// other theme, so the light-mode variant silently comes out identical to
// dark. Caught live on a real widget's button. Detected here so the field
// can self-correct to the matching type instead of saving broken data.
const GRADIENT_VALUE_RE = /^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i;

// Wave 1: the generic field-rendering engine interpolates registry tooltip
// text (which, unlike this file's other hand-written labels, can genuinely
// contain a literal '"' — e.g. props.variant's tooltip quotes "preset") and
// widget-authored prop values directly into HTML attributes, so both need
// real escaping rather than this file's usual "authors just avoid quotes"
// convention.
function escapeHtmlAttr(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Widget Studio 2.0, Phase 8: Simple mode's "Connect to Simulator" picker
// groups deckEvents.js's flat list by this same category tag pc-bridge's own
// config UI uses (see deckEvents.js's file header) — a new author picks
// "Radios" then "COM 1 Standby Freq" in two short dropdowns instead of
// scanning one ~60-item flat list for the right plain-English label. Reuses
// the exact same binding.readSimVar/writeEvent fields Advanced mode's
// dropdown writes to — purely a friendlier front-end onto the same data.
const CATEGORY_LABELS = { radio: 'Radios & Transponder', ap: 'Autopilot', lights: 'Lights', yoke: 'Virtual Yoke' };

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

    this.renderInner();

    if (focusId) {
      const el = this.container.querySelector(`#${CSS.escape(focusId)}`);
      if (el) {
        el.focus({ preventScroll: true });
        if (selRange && 'setSelectionRange' in el) {
          try { el.setSelectionRange(selRange[0], selRange[1]); } catch { /* not a text-selectable input type */ }
        }
      }
    }
  }

  renderInner() {
    this.container.innerHTML = '';
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
  }

  /**
   * Bulk style editor for a 2+ multi-selection. Deliberately scoped to the
   * COMMON fields every component type shares (typography/border/background/
   * align/offset/orientation — the same generic set BaseComponent.applyStyles()
   * cascades to any type), not each type's own props — a mixed selection
   * (e.g. a button and an indicator) has no shared props beyond that, and a
   * same-type-only bulk editor would need to special-case every type
   * combination for little added value over just selecting one type at a
   * time. Every field starts BLANK (not defaulted from any member's current
   * value — a multi-selection's members likely differ) and only writes when
   * the author actually sets it, via StudioState.applyStyleToSelection().
   */
  renderMultiSelectInspector() {
    const ids = [...this.state.multiSelectedIds];
    const comps = ids.map((id) => this.state.getComponent(id)).filter(Boolean);

    const header = document.createElement('div');
    header.className = 'inspector-header';
    header.innerHTML = `
      <div class="inspector-title-row">
        <span class="inspector-badge">${comps.length} SELECTED</span>
        <h3 class="inspector-title">Multiple Components</h3>
      </div>
      <div class="inspector-sub">${comps.map((c) => c.id).join(', ')}</div>
    `;
    this.container.appendChild(header);

    this.container.appendChild(this.buildAccordionGroup('BULK STYLE EDIT', true, (body) => {
      body.innerHTML = `
        <div class="empty-tree-notice">Applies to all ${comps.length} selected components. Each field starts blank — only fields you actually set here are changed; everything else on each component is left as-is.</div>

        <button type="button" id="bulk-paste-style" class="panel-full-btn" style="margin-top:8px;" ${this.state.copiedStyle ? '' : 'disabled'}>
          ${this.state.copiedStyle ? `Paste Copied Style onto All ${comps.length} (replaces each one's full style)` : 'Paste Style — copy a style from a single component\'s panel first'}
        </button>

        <div class="prop-section-subtitle" style="margin-top:10px;">Typography</div>
        <div class="prop-row-2">
          <div class="prop-field">
            <label>Font Size (px)</label>
            <input type="number" id="bulk-typo-size" class="prop-input" placeholder="unchanged" min="8" max="48" />
          </div>
          <div class="prop-field">
            <label>Text Color</label>
            <div class="color-picker-wrap">
              <input type="color" id="bulk-typo-color-pick" value="#f8fafc" />
              <input type="text" id="bulk-typo-color" class="prop-input" placeholder="unchanged" />
            </div>
          </div>
        </div>

        <div class="prop-section-subtitle" style="margin-top:10px;">Border & Radius</div>
        <div class="prop-row-2">
          <div class="prop-field">
            <label>Border Width (px)</label>
            <input type="number" id="bulk-border-w" class="prop-input" placeholder="unchanged" min="0" max="10" />
          </div>
          <div class="prop-field">
            <label>Corner Radius (px)</label>
            <input type="number" id="bulk-border-rad" class="prop-input" placeholder="unchanged" min="0" max="24" />
          </div>
        </div>
        <div class="prop-field">
          <label>Border Color</label>
          <div class="color-picker-wrap">
            <input type="color" id="bulk-border-color-pick" value="#273344" />
            <input type="text" id="bulk-border-color" class="prop-input" placeholder="unchanged" />
          </div>
        </div>

        <div class="prop-section-subtitle" style="margin-top:10px;">Background Fill</div>
        <div class="prop-field">
          <label>Background Color</label>
          <div class="color-picker-wrap">
            <input type="color" id="bulk-bg-color-pick" value="#131b26" />
            <input type="text" id="bulk-bg-color" class="prop-input" placeholder="unchanged" />
          </div>
        </div>

        <div class="prop-section-subtitle" style="margin-top:10px;" data-tier="advanced">Content Alignment</div>
        <div class="prop-row-2" data-tier="advanced">
          <div class="prop-field">
            <label>Horizontal Align</label>
            <select id="bulk-align-h" class="prop-select">
              <option value="">Unchanged</option>
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
          <div class="prop-field">
            <label>Vertical Align</label>
            <select id="bulk-align-v" class="prop-select">
              <option value="">Unchanged</option>
              <option value="top">Top</option>
              <option value="center">Center</option>
              <option value="bottom">Bottom</option>
            </select>
          </div>
        </div>
      `;

      body.querySelector('#bulk-paste-style')?.addEventListener('click', () => {
        this.state.pasteStyleToSelection();
        showToast(`Pasted style onto ${comps.length} components.`);
      });

      body.querySelector('#bulk-typo-size')?.addEventListener('change', (e) => {
        if (e.target.value === '') return;
        this.state.applyStyleToSelection({ typography: { size: parseInt(e.target.value, 10) || 12 } });
      });
      this.wireColorPair(body, 'bulk-typo-color-pick', 'bulk-typo-color', (color) => this.state.applyStyleToSelection({ typography: { color } }), { skipEmpty: true });

      body.querySelector('#bulk-border-w')?.addEventListener('change', (e) => {
        if (e.target.value === '') return;
        this.state.applyStyleToSelection({ border: { width: parseInt(e.target.value, 10) || 0 } });
      });
      body.querySelector('#bulk-border-rad')?.addEventListener('change', (e) => {
        if (e.target.value === '') return;
        this.state.applyStyleToSelection({ border: { radius: parseInt(e.target.value, 10) || 0 } });
      });
      this.wireColorPair(body, 'bulk-border-color-pick', 'bulk-border-color', (color) => this.state.applyStyleToSelection({ border: { color } }), { skipEmpty: true });

      this.wireColorPair(body, 'bulk-bg-color-pick', 'bulk-bg-color', (color) => this.state.applyStyleToSelection({ background: { type: 'color', color } }), { skipEmpty: true });

      body.querySelector('#bulk-align-h')?.addEventListener('change', (e) => {
        if (!e.target.value) return;
        this.state.applyStyleToSelection({ align: { h: e.target.value } });
      });
      body.querySelector('#bulk-align-v')?.addEventListener('change', (e) => {
        if (!e.target.value) return;
        this.state.applyStyleToSelection({ align: { v: e.target.value } });
      });
    }));
  }

  /** Always-visible Guided/Build/Full tier switch, independent of what's selected. */
  buildModeToggle() {
    const bar = document.createElement('div');
    bar.className = 'inspector-mode-toggle';
    bar.innerHTML = `
      <button type="button" class="mode-toggle-btn ${this.uiTier === 'guided' ? 'active' : ''}" data-mode="guided">Guided</button>
      <button type="button" class="mode-toggle-btn ${this.uiTier === 'build' ? 'active' : ''}" data-mode="build">Build</button>
      <button type="button" class="mode-toggle-btn ${this.uiTier === 'full' ? 'active' : ''}" data-mode="full">Full</button>
      <span class="prop-hint" title="Guided shows only what a first widget needs. Build (the default) adds the rest of what most widgets need. Full shows everything, flat — compose transforms, poll tuning, custom bindings, and similar. Fields are never removed, only hidden; nothing you've already set is lost by switching, and every section's '⋯ N more' link reveals its own hidden fields without leaving the tier.">ⓘ</span>
    `;
    bar.querySelectorAll('.mode-toggle-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.uiTier = btn.dataset.mode;
        localStorage.setItem('fdws_studio_uiMode', this.uiTier);
        this.render();
      });
    });
    return bar;
  }

  /**
   * True if a field/section marked with this data-tier value should be
   * HIDDEN at the current uiTier. Three data-tier values exist:
   *  - "advanced": Full only (registry field.tier === 'advanced').
   *  - "build": Build + Full, hidden only in Guided (registry
   *    field.tier === 'simple' && !field.guided — Part 2).
   *  - "simple-only": Guided + Build, hidden only in Full — a small set of
   *    friendlier FRONT ENDS onto a field Full already exposes directly
   *    (Widget Studio 2.0, Phase 8), so showing both at once would just be
   *    two competing controls for the same value.
   * Anything unmarked (no data-tier attribute at all — most fields) is
   * always visible, same as before Part 2.
   */
  tierHidesField(dataTier) {
    if (dataTier === 'advanced') return this.uiTier !== 'full';
    if (dataTier === 'build') return this.uiTier === 'guided';
    if (dataTier === 'simple-only') return this.uiTier === 'full';
    return false;
  }

  /**
   * Applies tierHidesField() to every data-tier'd element, except inside an
   * accordion section the user has explicitly expanded via its own "⋯ N
   * more" link (buildAccordionGroup() marks that section's .inspector-group
   * with .tier-override) — revealing a section's hidden fields must not
   * require leaving the tier for the whole panel. Call after any (re-)render.
   */
  applyUiMode() {
    this.container.querySelectorAll('[data-tier]').forEach((el) => {
      const overridden = el.closest('.inspector-group.tier-override');
      el.classList.toggle('hidden', !overridden && this.tierHidesField(el.dataset.tier));
    });
  }

  /**
   * Part 2: injects the "⋯ N more" link into every accordion section that
   * actually has fields hidden by the current tier — the escape hatch that
   * makes hiding fields by tier acceptable at all (no dead ends). Must run
   * AFTER the whole panel has finished rendering, same requirement as
   * applyUiMode() (call it right alongside that, not from inside
   * buildAccordionGroup() — see the comment there for why).
   */
  applyTierMoreBadges() {
    this.container.querySelectorAll('.inspector-group').forEach((group) => {
      const title = group.querySelector('.group-title')?.textContent;
      if (!title || this.tierOverrideGroups.has(title)) return;
      const body = group.querySelector('.inspector-group-body');
      const hiddenCount = Array.from(body.querySelectorAll('[data-tier]'))
        .filter((el) => this.tierHidesField(el.dataset.tier)).length;
      if (hiddenCount === 0) return;
      const moreBtn = document.createElement('button');
      moreBtn.type = 'button';
      moreBtn.className = 'group-tier-more';
      moreBtn.textContent = `⋯ ${hiddenCount} more`;
      moreBtn.title = `Show ${hiddenCount} more field${hiddenCount === 1 ? '' : 's'} in this section without leaving the current tier.`;
      moreBtn.addEventListener('click', (e) => {
        e.stopPropagation(); // header's own click toggles expand/collapse
        this.tierOverrideGroups.add(title);
        this.expandedGroups.add(title); // revealing fields in a collapsed section is a dead end otherwise
        this.render();
      });
      group.querySelector('.group-title-cluster')?.appendChild(moreBtn);
    });
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
      </div>
      <div class="inspector-sub">${def.id || 'com.flightdeck.widget'} (FDWS v${def.fdws || '1.1'})</div>
    `;
    this.container.appendChild(header);

    // Group 1: Metadata & Identification
    this.container.appendChild(this.buildAccordionGroup('METADATA & SPECIFICATION', true, (body) => {
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
    }));

    // Group 2: Grid Layout & Sizing
    this.container.appendChild(this.buildAccordionGroup('GRID & DIMENSIONS', false, (body) => {
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
    }));

    // Group 3: Widget Canvas Appearance & Border
    this.container.appendChild(this.buildAccordionGroup('CANVAS APPEARANCE & BORDER', false, (body) => {
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
            <input type="color" id="w-border-clr-pick" value="${this.toHexColor(effBorderColor) || '#1f2937'}" />
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
              <input type="color" id="w-bg-val-pick" value="${this.toHexColor(effBg.color) || '#0b0f17'}" />
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
    }));

    // Group 3.5: Theme (FDWS v1.18) — which theme style.* was authored for,
    // and whether the OTHER theme is auto-derived (default) or manually
    // authored via each component's style.themeOverride.
    this.container.appendChild(this.buildAccordionGroup('THEME', false, (body) => {
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
    }));

    // Group 3b: FDWS v1.27 (1.0-A) — Deck Events this widget declares, with the
    // binding each one should default to. Authoring UI ships with the spec
    // field, per the standing rule that no FDWS addition goes out JSON-only.
    this.container.appendChild(this.buildAccordionGroup('DECK EVENTS (v1.27)', false, (body) => {
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
    }));

    // Group 4: Capabilities Summary (§11 Rule 5)
    this.container.appendChild(this.buildAccordionGroup('CAPABILITIES MATRIX (§11)', false, (body) => {
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
    }));
  }

  // ==========================================
  // --- COMPONENT INSPECTOR ---
  // ==========================================
  renderComponentInspector(comp) {
    // Which Appearance style tab ("normal" vs the one state name this
    // component type supports) is showing — transient UI state, not part of
    // the widget, so it's tracked on the inspector instance itself and reset
    // back to "normal" whenever a different component gets selected (this
    // method re-runs on every keystroke within the SAME component too, so
    // this can't just default every time — see below).
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

    // 1. Layout & Layering — Widget Studio 2.0, Phase 6 merges the old
    // "Identification & Layering" + "Sub-Grid Geometry" accordions into one
    // group (an author thinks of "where/how big is this and how does it
    // layer" as one concern, not two). Each original section's own body/event
    // -wiring code is left untouched below, just wrapped in its own IIFE so
    // it can render into its own sub-`body` div instead of the group's outer
    // one — see the divider between them.
    this.container.appendChild(this.buildAccordionGroup('LAYOUT & LAYERING', true, (outerBody) => {
    ((body) => {
      const layer = comp.layer || {};
      body.innerHTML = `
        <div class="prop-field">
          <label>Display Label</label>
          <input type="text" id="c-label" class="prop-input" value="${comp.label || ''}" placeholder="Component label..." />
        </div>
        <div class="prop-row-2">
          <div class="prop-field">
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

        <div class="prop-section-subtitle" style="margin-top:10px;">Layer Group & Z-Index (§9.3)</div>
        <div class="prop-row-2">
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

        <div class="prop-row-2" style="margin-top:6px;">
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
    outerBody.appendChild(geomDivider);

    ((body) => {
      const layout = comp.layout || { col: 1, row: 1, w: 2, h: 2 };
      const maxCols = def.layout?.grid?.columns || 12;
      const maxRows = def.layout?.grid?.rows || 6;

      body.innerHTML = `
        <div class="prop-row-2">
          <div class="prop-field">
            <label>Column (X)</label>
            <input type="number" id="c-layout-col" class="prop-input" value="${layout.col || 1}" min="1" max="${maxCols}" />
          </div>
          <div class="prop-field">
            <label>Row (Y)</label>
            <input type="number" id="c-layout-row" class="prop-input" value="${layout.row || 1}" min="1" max="${maxRows}" />
          </div>
        </div>
        <div class="prop-row-2">
          <div class="prop-field">
            <label>Width (Span Columns)</label>
            <input type="number" id="c-layout-w" class="prop-input" value="${layout.w || 1}" min="1" max="${maxCols}" />
          </div>
          <div class="prop-field">
            <label>Height (Span Rows)</label>
            <input type="number" id="c-layout-h" class="prop-input" value="${layout.h || 1}" min="1" max="${maxRows}" />
          </div>
        </div>
      `;

      const updateLayout = (updates) => {
        this.state.updateComponent(comp.id, { layout: { ...comp.layout, ...updates } });
      };

      body.querySelector('#c-layout-col')?.addEventListener('change', (e) => updateLayout({ col: parseInt(e.target.value, 10) || 1 }));
      body.querySelector('#c-layout-row')?.addEventListener('change', (e) => updateLayout({ row: parseInt(e.target.value, 10) || 1 }));
      body.querySelector('#c-layout-w')?.addEventListener('change', (e) => updateLayout({ w: parseInt(e.target.value, 10) || 1 }));
      body.querySelector('#c-layout-h')?.addEventListener('change', (e) => updateLayout({ h: parseInt(e.target.value, 10) || 1 }));
    })(outerBody.appendChild(document.createElement('div')));
    }, this.buildLayoutBadge(comp)));

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
    const appearanceGroup = this.buildAccordionGroup('APPEARANCE', false, () => {}, this.buildAppearanceBadge(comp));
    const dataGroup = this.buildAccordionGroup('DATA & CONTENT', false, () => {}, this.buildDataBadge(comp));
    this.container.appendChild(appearanceGroup);
    this.container.appendChild(dataGroup);
    const appearanceBody = appearanceGroup.querySelector('.inspector-group-body');
    const dataBody = dataGroup.querySelector('.inspector-group-body');

    ((body) => {
      this.renderTypeSpecificProps(comp, body);
    })(dataBody.appendChild(document.createElement('div')));

    ((body) => {
      const style = comp.style || {};
      const stateCfg = resolveStateStyleConfig(comp);
      // V13: a style.states key that isn't the ONE name this component
      // type/variant actually reads (e.g. left behind by a Button Variant
      // change) — same detection StudioValidator.js:731-751 already flags as
      // a warning; this reuses stateCfg (already computed above) rather than
      // re-deriving that check, and offers the fix inline instead of just
      // reporting it.
      const orphanedStateKeys = style.states && typeof style.states === 'object'
        ? Object.keys(style.states).filter((k) => k !== stateCfg?.name)
        : [];
      const themeEdit = this.getThemeEditContext();
      const assets = this.state.widgetDef.assets || [];
      const stateVars = def.state || [];
      // Wave 2 Part B2: rule chips — a third (fourth, counting Base) target
      // for the same generic field engine, alongside Normal/State. Every
      // component type supports style.rules (unlike interaction-state
      // styling, which is per-type), so this renders regardless of stateCfg.
      const rules = Array.isArray(style.rules) ? style.rules : [];
      const activeRuleIndex = (this._styleTabRuleIndex != null && this._styleTabRuleIndex < rules.length)
        ? this._styleTabRuleIndex : null;
      const activeRule = activeRuleIndex !== null ? rules[activeRuleIndex] : null;

      // Wave 2 Part B1: Text Color, Border Color, and the whole Background
      // section stay hand-coded on the Base tab (see
      // renderAppearanceSection()'s doc comment for why) — these reads feed
      // that, and the theme-override banner text below. Every other
      // Appearance field, on both tabs, now renders via
      // renderAppearanceSection()'s generic per-target field engine.
      const typo = style.typography || {};
      const border = style.border || {};
      const bg = style.background || {};
      const override = style.themeOverride || {};
      // No stored override yet (e.g. a component added after the widget was
      // already switched to Manual mode) falls back to what auto-derivation
      // WOULD produce, not the raw base-theme value — otherwise the color
      // picker would misleadingly show the dark-authored swatch while
      // previewing light.
      const themeColorCtx = { componentType: comp.type, layerGroup: comp.layer?.group };
      const effTypoColor = themeEdit.isOverrideEdit
        ? (override.typography?.color ?? themeAdjustColor(typo.color, { ...themeColorCtx, colorKind: 'typography' }, this.state.previewTheme, themeEdit.baseTheme))
        : typo.color;
      const effBorderColor = themeEdit.isOverrideEdit
        ? (override.border?.color ?? themeAdjustColor(border.color, { ...themeColorCtx, colorKind: 'border' }, this.state.previewTheme, themeEdit.baseTheme))
        : border.color;
      const effBg = themeEdit.isOverrideEdit
        ? (override.background || (
            bg.type === 'color' && bg.color
              ? { ...bg, color: themeAdjustColor(bg.color, { ...themeColorCtx, colorKind: 'background' }, this.state.previewTheme, themeEdit.baseTheme) }
              : bg.type === 'gradient' && bg.gradient
                ? { ...bg, gradient: themeAdjustGradient(bg.gradient, themeColorCtx, this.state.previewTheme, themeEdit.baseTheme) }
                : bg
          ))
        : bg;
      // FDWS v1.29: same isOverrideEdit-redirect pattern as effTypoColor/
      // effBorderColor above, widened to the other three color-valued style
      // fields (text outline, text glow, border glow).
      const effStrokeColor = themeEdit.isOverrideEdit
        ? (override.typography?.stroke?.color ?? themeAdjustColor(typo.stroke?.color, { ...themeColorCtx, colorKind: 'typography' }, this.state.previewTheme, themeEdit.baseTheme))
        : typo.stroke?.color;
      const effGlowColor = themeEdit.isOverrideEdit
        ? (override.typography?.glow?.color ?? themeAdjustColor(typo.glow?.color, { ...themeColorCtx, colorKind: 'typography' }, this.state.previewTheme, themeEdit.baseTheme))
        : typo.glow?.color;
      const effBorderGlowColor = themeEdit.isOverrideEdit
        ? (override.border?.glow?.color ?? themeAdjustColor(border.glow?.color, { ...themeColorCtx, colorKind: 'border' }, this.state.previewTheme, themeEdit.baseTheme))
        : border.glow?.color;

      // FDWS v1.8 §1.1: core.label's pre-v1.8 props.align (horizontal-only) is
      // superseded by the generic style.align.h below. The moment a label with the
      // old field (and no new one yet) is opened here, migrate it immediately —
      // same eager-persist pattern as the presetSlot fix — so the widget moves onto
      // the unified control instead of carrying two competing alignment sources.
      if (comp.type === 'core.label' && comp.props?.align && !(style.align || {}).h) {
        queueMicrotask(() => {
          const { align: _drop, ...restProps } = comp.props || {};
          this.state.updateComponent(comp.id, {
            props: restProps,
            style: { ...(comp.style || {}), align: { ...(comp.style?.align || {}), h: comp.props.align } }
          });
        });
      }

      // "normal" vs the one state name this component supports vs a rule —
      // a rule chip (see renderComponentInspector()'s reset of
      // this._styleTabRuleIndex) takes precedence when set, since it's only
      // ever non-null via an explicit chip click or "+ Rule".
      const activeTab = activeRuleIndex !== null ? 'rule' : ((stateCfg && this._styleTab === 'state') ? 'state' : 'normal');

      // Wave 2 Part B2: the active rule's condition, read for the
      // condition-editor block below — same grammar/fields as
      // renderVisibilityAndGuard's visibleWhen row, deliberately not
      // genericized (Part 4 widens what a rule can STYLE, not how its
      // CONDITION is authored — see ConditionEvaluator.js).
      const RULE_OPS = ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'between'];
      const ruleCond = activeRule?.when || {};
      const ruleCondIsCustom = !!ruleCond.state && !stateVars.some((s) => s.name === ruleCond.state);
      const ruleCondOp = RULE_OPS.find((o) => ruleCond[o] !== undefined) || 'equals';
      const ruleCondVal = ruleCondOp === 'between' ? (ruleCond.between || []).join(',') : (ruleCond[ruleCondOp] ?? '');
      const ruleJsonOpen = activeRuleIndex !== null && !!this._conditionalStyleJsonOpen?.[activeRuleIndex];
      // Wave 2 Part B3: the Theme chip toggles StudioState.previewTheme itself
      // (the canvas header's own sun/moon control) rather than introducing a
      // new target.kind — see getThemeEditContext()'s doc comment. It's a
      // modifier of the Base tab, not a fifth peer target: no state/rule
      // field path ever consults themeEdit, since the runtime has nowhere to
      // put a themed variant of a state or rule.
      const otherTheme = themeEdit.baseTheme === 'light' ? 'dark' : 'light';

      body.innerHTML = `
        ${themeEdit.isOverrideEdit ? `<div class="theme-override-banner">Editing ${this.state.previewTheme.toUpperCase()} theme override — Text/Stroke/Glow/Border/Border Glow/Background Color apply only to this theme; other properties stay shared with the base ${themeEdit.baseTheme} style.</div>` : ''}
        <div class="prop-row-2" style="margin-bottom:4px;">
          <button type="button" id="c-style-copy" class="bar-btn">Copy Style</button>
          <button type="button" id="c-style-paste" class="bar-btn" ${this.state.copiedStyle ? '' : 'disabled'}>Paste Style</button>
        </div>

        <div class="prop-section-subtitle">Style Presets <span class="prop-hint" title="One-click starting points — applies typography, border, and background together, then leave every field below exactly as editable as before.">ⓘ</span></div>
        <div class="style-preset-strip">
          ${STYLE_PRESETS.map((p) => `
            <button type="button" class="style-preset-swatch" data-preset="${p.id}" title="${p.name}" style="--preset-bg:${p.swatch.bg};--preset-fg:${p.swatch.fg};--preset-border:${p.swatch.border};">
              <span class="style-preset-swatch-inner">Aa</span>
              <span class="style-preset-name">${p.name}</span>
            </button>
          `).join('')}
        </div>

        <div class="prop-row-2" style="margin:10px 0 12px;flex-wrap:wrap;gap:6px;">
          <button type="button" class="mode-toggle-btn ${activeTab === 'normal' ? 'active' : ''}" id="c-styletab-normal" style="flex:0 1 auto;">Normal</button>
          ${stateCfg ? `<button type="button" class="mode-toggle-btn ${activeTab === 'state' ? 'active' : ''}" id="c-styletab-state" style="flex:0 1 auto;">${stateCfg.tabLabel}</button>` : ''}
          ${rules.map((r, i) => `<button type="button" class="mode-toggle-btn ${activeRuleIndex === i ? 'active' : ''}" data-rule-chip="${i}" style="flex:0 1 auto;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtmlAttr(summarizeRuleCondition(r.when))}">${escapeHtmlAttr(summarizeRuleCondition(r.when))}</button>`).join('')}
          <button type="button" class="mode-toggle-btn" id="c-styletab-addrule" style="flex:0 1 auto;" title="Add a conditional style rule">+ Rule</button>
          ${themeEdit.themeMode === 'manual' ? `
          <span style="width:1px;align-self:stretch;background:var(--studio-panel-border);margin:0 2px;"></span>
          <button type="button" class="mode-toggle-btn ${themeEdit.isOverrideEdit ? 'active' : ''}" id="c-styletab-theme" style="flex:0 1 auto;" ${activeTab !== 'normal' ? `disabled title="Theme overrides apply to the Base style only — states and rules are already conditional."` : `title="Edit this component's ${otherTheme} theme override — Text/Stroke/Glow/Border/Border Glow/Background Color only."`}>${otherTheme.charAt(0).toUpperCase() + otherTheme.slice(1)} Override</button>
          ` : ''}
        </div>
        ${orphanedStateKeys.map((key) => {
          const canMigrate = !!stateCfg?.name && style.states[stateCfg.name] === undefined;
          return `
          <div class="prop-hint-block" style="font-size:11px;margin-bottom:8px;border-left:2px solid var(--accent-red, #ef4444);padding-left:8px;">
            <div>⚠ style.states.${escapeHtmlAttr(key)} has no effect — ${stateCfg?.name ? `this component only reads style.states.${escapeHtmlAttr(stateCfg.name)}.` : 'this component type has no interaction-state style support at all.'}</div>
            <div style="margin-top:4px;display:flex;gap:8px;align-items:center;">
              ${stateCfg?.name ? (canMigrate
                ? `<button type="button" class="btn-small" data-orphan-migrate="${escapeHtmlAttr(key)}">Migrate to ${escapeHtmlAttr(stateCfg.name)}</button>`
                : `<span class="prop-hint" title="style.states.${escapeHtmlAttr(stateCfg.name)} already has its own data — migrating would overwrite it.">Migrate unavailable ⓘ</span>`
              ) : ''}
              <button type="button" class="btn-small" data-orphan-delete="${escapeHtmlAttr(key)}">Delete</button>
            </div>
          </div>
          `;
        }).join('')}
        ${activeTab === 'state' ? `<div class="prop-hint-block" style="font-size:11px;opacity:0.7;margin-bottom:8px;">Overrides merged over the base style while this component is ${stateCfg.tabLabel.toLowerCase()}. Dimmed fields are inherited from the Normal style — edit one to override it just for this state, or (for Outline/Glow/Border Glow) check its own "Clear (don't inherit)" box to turn it off regardless of Base.</div>` : ''}
        ${activeTab === 'rule' ? `
        <div class="prop-hint-block" style="font-size:11px;opacity:0.7;margin-bottom:8px;">Overrides merged over the base style whenever this rule's condition is true — first matching rule wins over lower rules and over Normal. Dimmed fields are inherited from the Normal style, same as a state.</div>
        <div class="prop-section-subtitle" style="margin-top:0;">Condition <span class="prop-hint" title="Same condition grammar as Visible When — a rule here only changes the STYLE, never whether the component shows at all.">ⓘ</span></div>
        <div class="prop-row-2">
          <div class="prop-field">
            <label>State Var</label>
            <select id="c-rule-cond-state" class="prop-select">
              ${conditionStateOptionsHtml(stateVars, ruleCond.state, false, comp.binding?.readSimVar)}
            </select>
            <input type="text" id="c-rule-cond-state-custom" class="prop-input ${ruleCondIsCustom ? '' : 'hidden'}" value="${ruleCondIsCustom ? escapeHtmlAttr(ruleCond.state) : ''}" placeholder="e.g. presets[0].label" style="margin-top:4px;" />
          </div>
          <div class="prop-field">
            <label>Operator</label>
            <select id="c-rule-cond-op" class="prop-select">
              ${RULE_OPS.map((op) => `<option value="${op}" ${ruleCondOp === op ? 'selected' : ''}>${op}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="prop-field">
          <label>Value</label>
          <input type="text" id="c-rule-cond-val" class="prop-input" value="${escapeHtmlAttr(ruleCondVal)}" placeholder="${ruleCondOp === 'between' ? 'lo,hi' : 'value'}" />
        </div>
        <div class="prop-row-2" style="margin-bottom:8px;">
          <button type="button" id="c-rule-remove" class="bar-btn">Remove This Rule</button>
          <button type="button" id="c-rule-json-toggle" class="bar-btn">${ruleJsonOpen ? 'Hide' : 'Advanced'} JSON</button>
        </div>
        <div class="${ruleJsonOpen ? '' : 'hidden'}" style="margin-bottom:10px;">
          <textarea id="c-rule-json" class="prop-input" rows="4">${escapeHtmlAttr(JSON.stringify(activeRule?.style || {}, null, 0))}</textarea>
          <div id="c-rule-json-error" class="prop-json-error hidden"></div>
        </div>
        ` : ''}

        <div id="c-appearance-fields"></div>
      `;

      body.querySelectorAll('.style-preset-swatch').forEach((btn) => {
        btn.addEventListener('click', () => {
          const preset = STYLE_PRESETS.find((p) => p.id === btn.dataset.preset);
          if (!preset) return;
          this.state.updateComponent(comp.id, { style: { ...(comp.style || {}), ...preset.style } });
          showToast(`Applied "${preset.name}" style — still fully editable below.`);
        });
      });

      body.querySelector('#c-style-copy')?.addEventListener('click', () => {
        this.state.copyComponentStyle(comp.id);
        showToast(`Copied style from "${comp.label || comp.id}".`);
        this.render();
      });
      body.querySelector('#c-style-paste')?.addEventListener('click', () => {
        this.state.pasteStyleToComponent(comp.id);
        showToast(`Pasted style onto "${comp.label || comp.id}".`);
      });

      // FDWS v1.25: Normal/<state> tab toggle. Wave 2 Part B1: now re-renders
      // the whole panel on switch (this.render()) rather than toggling
      // display:none on two pre-built trees, since renderAppearanceSection()
      // only ever builds the currently-active target's fields.
      body.querySelector('#c-styletab-normal')?.addEventListener('click', () => {
        this._styleTab = 'normal';
        this._styleTabRuleIndex = null;
        this.render();
      });
      body.querySelector('#c-styletab-state')?.addEventListener('click', () => {
        this._styleTab = 'state';
        this._styleTabRuleIndex = null;
        this.render();
      });
      // Wave 2 Part B2: rule chips + "+ Rule".
      body.querySelectorAll('[data-rule-chip]').forEach((btn) => {
        btn.addEventListener('click', () => {
          this._styleTabRuleIndex = Number(btn.dataset.ruleChip);
          this.render();
        });
      });
      body.querySelector('#c-styletab-addrule')?.addEventListener('click', () => {
        const nextRules = [...rules, { when: { state: stateVars[0]?.name || '', equals: '' }, style: { typography: { color: '#f87171' } } }];
        this._styleTabRuleIndex = nextRules.length - 1;
        this.state.updateComponent(comp.id, { style: { ...(comp.style || {}), rules: nextRules } });
        this.render();
      });
      // V13: migrate/delete an orphaned style.states key.
      body.querySelectorAll('[data-orphan-migrate]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.orphanMigrate;
          const states = { ...(style.states || {}) };
          states[stateCfg.name] = states[key];
          delete states[key];
          this.state.updateComponent(comp.id, { style: { ...style, states } });
        });
      });
      body.querySelectorAll('[data-orphan-delete]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const key = btn.dataset.orphanDelete;
          const states = { ...(style.states || {}) };
          delete states[key];
          this.state.updateComponent(comp.id, { style: { ...style, states } });
        });
      });
      // Wave 2 Part B3: flips the SAME live-preview toggle the canvas header's
      // sun/moon button already drives — PREVIEW_THEME_CHANGED is already in
      // this class's subscribed change-type list, so the panel (and the
      // banner/redirect logic inside renderBaseThemeAwareAppearanceFields,
      // gated on themeEdit.isOverrideEdit) reacts automatically; no
      // this.render() call needed here. Native `disabled` (set in the
      // template above whenever a State/Rule tab is active) already blocks
      // this handler from firing when the chip isn't clickable.
      body.querySelector('#c-styletab-theme')?.addEventListener('click', () => {
        this.state.setPreviewTheme(themeEdit.isOverrideEdit ? themeEdit.baseTheme : otherTheme);
      });

      if (activeTab === 'rule' && activeRule) {
        // V14: `stateOverride` lets the "Use This Component's Own Value" branch
        // below reuse this same op/value-reading logic instead of duplicating
        // it, supplying the resolved syncFrom var name in place of whatever
        // the (sentinel-valued) select currently reads.
        const commitRuleCondition = (recordHistory = true, stateOverride = undefined) => {
          const stateSelect = body.querySelector('#c-rule-cond-state');
          const stateCustom = body.querySelector('#c-rule-cond-state-custom');
          const state = stateOverride !== undefined ? stateOverride
            : stateSelect.value === CUSTOM_OPTION_VALUE ? stateCustom.value.trim() : stateSelect.value;
          const op = body.querySelector('#c-rule-cond-op').value;
          const rawVal = body.querySelector('#c-rule-cond-val').value;
          const when = { state };
          if (op === 'between') {
            const [lo, hi] = rawVal.split(',').map((s) => Number(s.trim()));
            when.between = [lo || 0, hi || 0];
          } else if (['gt', 'gte', 'lt', 'lte'].includes(op)) {
            when[op] = Number(rawVal) || 0;
          } else {
            when[op] = rawVal;
          }
          // Only `when` is ever touched here — `style` is read-only from this
          // block's perspective, written solely by the generic field engine
          // (or the Advanced JSON textarea below). Unlike the old row-list
          // UI's readCurrentRow(), there is no shared-mutation hazard to
          // guard against (V18): nothing here can accidentally drop a style
          // sub-field, because nothing here ever touches style at all.
          const nextRules = [...rules];
          nextRules[activeRuleIndex] = { ...nextRules[activeRuleIndex], when };
          this.state.updateComponent(comp.id, { style: { ...(comp.style || {}), rules: nextRules } }, recordHistory);
        };
        body.querySelector('#c-rule-cond-state')?.addEventListener('change', (e) => {
          if (e.target.value === OWN_VALUE_OPTION) {
            const simVar = comp.binding?.readSimVar;
            if (!simVar) return;
            const name = this.state.resolveSyncFromVarName(simVar);
            body.querySelector('#c-rule-cond-state-custom')?.classList.add('hidden');
            this.state.saveHistory("Use This Component's Own Value");
            this.state.ensureSyncFromVar(simVar);
            commitRuleCondition(false, name);
          } else if (e.target.value === CUSTOM_OPTION_VALUE) {
            body.querySelector('#c-rule-cond-state-custom')?.classList.remove('hidden');
          } else {
            body.querySelector('#c-rule-cond-state-custom')?.classList.add('hidden');
            commitRuleCondition();
          }
        });
        body.querySelector('#c-rule-cond-state-custom')?.addEventListener('change', commitRuleCondition);
        body.querySelector('#c-rule-cond-op')?.addEventListener('change', commitRuleCondition);
        body.querySelector('#c-rule-cond-val')?.addEventListener('change', commitRuleCondition);

        body.querySelector('#c-rule-remove')?.addEventListener('click', async () => {
          const ok = await confirmModal(`Remove this rule (${summarizeRuleCondition(activeRule.when)})?`, { title: 'Remove Rule', danger: true });
          if (!ok) return;
          const nextRules = rules.filter((_, i) => i !== activeRuleIndex);
          this._styleTabRuleIndex = null;
          this.state.updateComponent(comp.id, { style: { ...(comp.style || {}), rules: nextRules.length ? nextRules : undefined } });
          this.render();
        });

        body.querySelector('#c-rule-json-toggle')?.addEventListener('click', () => {
          this._conditionalStyleJsonOpen = this._conditionalStyleJsonOpen || {};
          this._conditionalStyleJsonOpen[activeRuleIndex] = !this._conditionalStyleJsonOpen[activeRuleIndex];
          this.render();
        });
        body.querySelector('#c-rule-json')?.addEventListener('change', (e) => {
          try {
            const parsedStyle = JSON.parse(e.target.value);
            const nextRules = [...rules];
            nextRules[activeRuleIndex] = { when: activeRule.when, style: parsedStyle };
            body.querySelector('#c-rule-json-error')?.classList.add('hidden');
            this.state.updateComponent(comp.id, { style: { ...(comp.style || {}), rules: nextRules } });
          } catch (err) {
            const errEl = body.querySelector('#c-rule-json-error');
            if (errEl) {
              errEl.textContent = `Invalid JSON — edit not applied: ${err.message}`;
              errEl.classList.remove('hidden');
            }
          }
        });
      }

      const target = activeTab === 'rule' ? { kind: 'rule', index: activeRuleIndex }
        : activeTab === 'state' ? { kind: 'state', name: stateCfg.name }
        : { kind: 'base' };
      this.renderAppearanceSection(comp, body.querySelector('#c-appearance-fields'), target, { themeEdit, effTypoColor, effBorderColor, effBg, effStrokeColor, effGlowColor, effBorderGlowColor, assets });
    })(appearanceBody.appendChild(document.createElement('div')));

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

      body.innerHTML = `
        <div class="prop-field" data-tier="simple-only">
          <label>Connect to Simulator — Value to Show <span class="prop-hint" title="Pick a category, then the specific value this component should read. Fills in the same field Advanced mode's Read Deck Event dropdown below uses — switch to Advanced any time to see the raw name or type a custom one.">ⓘ</span></label>
          <div class="connect-sim-picker">${buildConnectSimPicker('read', 'c-connect-read', binding.readSimVar)}</div>
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
            <label>Push Event <span class="prop-hint" title="Fired when a component with a push/click action (e.g. core.rotary's center push) is pressed, separate from its normal turn/drag write event.">ⓘ</span></label>
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

      // Part 5a, Slice 1: additive — the dropdown/custom-input fields above
      // stay the direct-edit escape hatch; Connect is the new recommended path.
      body.querySelector('#c-bind-read-connect')?.addEventListener('click', () => this.openConnectDialog(comp, def, 'read'));
      body.querySelector('#c-bind-write-connect')?.addEventListener('click', () => this.openConnectDialog(comp, def, 'write'));

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

    // 4. Behavior — Phase 6 merges "Interaction Triggers" + "Visibility &
    // Guard" (visibility-by-state is itself a reactive behavior). Both
    // sections are adjacent in the original file order, so this group merges
    // via simple IIFE wrapping (like Layout & Layering above) rather than the
    // pre-created-shell technique Appearance/Data & Content needed.
    this.container.appendChild(this.buildAccordionGroup('BEHAVIOR', false, (outerBody) => {
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
    }, this.buildBehaviorBadge(comp)));

    // Wave 2 Part B2: Conditional Formatting (style.rules, FDWS v1.15) no
    // longer has its own section here — a rule is now a target-strip chip
    // in the Appearance panel's main IIFE above, alongside Normal/State,
    // rendered through the same generic field engine. See
    // renderAppearanceSection()'s doc comment.
  }

  renderVisibilityAndGuard(comp, def, body) {
    const stateVars = def.state || [];
    const assets = def.assets || [];
    const visibleWhen = comp.visibleWhen || null;
    const guard = comp.layout?.guard || {};

    // visibleWhen is normalized to a flat condition list under one combinator
    // (allOf/anyOf) for the visual editor — arbitrary nested compound
    // expressions remain possible but must be hand-edited via the JSON
    // escape hatch below, since that shape has no bounded visual form.
    const combinator = visibleWhen?.anyOf ? 'anyOf' : 'allOf';
    const conditions = visibleWhen ? (visibleWhen[combinator] || (visibleWhen.state ? [visibleWhen] : [])) : [];
    const isNestedOrComplex = visibleWhen && !(visibleWhen.allOf || visibleWhen.anyOf || visibleWhen.state);

    const OPS = ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'between'];

    // FDWS v1.13: a condition's `state` can address a nested/indexed path
    // (e.g. "presets[0].label"), not just a declared state[] var — same
    // grammar as binding.stateRef (v1.11). Any name not in the declared
    // list is treated as a custom/path value, same "Custom…" pattern used
    // elsewhere in this panel (bindings, event pickers).
    const stateIsCustomPath = (name) => !!name && !stateVars.some((s) => s.name === name);

    const conditionRowHtml = (cond, idx) => {
      const isCustom = stateIsCustomPath(cond.state);
      return `
      <div class="row-list-item" data-idx="${idx}">
        <div class="vw-state-wrap" style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:0;">
          <select class="row-field vw-state prop-select" data-field="state">
            ${conditionStateOptionsHtml(stateVars, cond.state, false, comp.binding?.readSimVar)}
          </select>
          <input type="text" class="row-field vw-state-custom prop-input ${isCustom ? '' : 'hidden'}" value="${isCustom ? cond.state : ''}" placeholder="e.g. presets[0].label" title="FDWS v1.13: 'name[index].field' path into an array/object state var — same grammar as a component's Bind to Local State Path." />
        </div>
        <select class="row-field vw-op prop-select" data-field="op">
          ${OPS.map((op) => `<option value="${op}" ${OPS.find((o) => cond[o] !== undefined) === op ? 'selected' : ''}>${op}</option>`).join('')}
        </select>
        <input type="text" class="row-field vw-val" data-field="val" value="${(() => { const op = OPS.find((o) => cond[o] !== undefined); return op ? (op === 'between' ? (cond.between || []).join(',') : cond[op]) : ''; })()}" placeholder="${(OPS.find((o) => cond[o] !== undefined) === 'between') ? 'lo,hi' : 'value'}" />
        <button type="button" class="btn-mini-close vw-remove" title="Remove">✕</button>
      </div>
    `;
    };

    body.innerHTML = `
      <div class="prop-section-subtitle">Conditional Visibility (visibleWhen) <span class="prop-hint" title="FDWS v1.13: each condition's state can be a declared state[] var, or — via the 'Custom / nested path…' option — a nested/indexed path like presets[0].label, addressing one specific array-slot field instead of a whole variable.">ⓘ</span></div>
      ${isNestedOrComplex ? `
        <div class="caps-empty">This component has a hand-authored compound visibleWhen expression too complex for the visual editor. Edit it as JSON below, or clear it to start over with the visual editor.</div>
        <textarea id="vw-raw-json" class="prop-input" rows="4">${JSON.stringify(visibleWhen, null, 0)}</textarea>
        <div id="vw-raw-error" class="prop-json-error hidden"></div>
        <button type="button" id="vw-clear" class="bar-btn">Clear & Use Visual Editor</button>
      ` : `
        <div class="prop-field">
          <label>Show this component when…</label>
          <select id="vw-combinator" class="prop-select" ${conditions.length === 0 ? 'disabled' : ''}>
            <option value="allOf" ${combinator === 'allOf' ? 'selected' : ''}>ALL of these are true</option>
            <option value="anyOf" ${combinator === 'anyOf' ? 'selected' : ''}>ANY of these are true</option>
          </select>
        </div>
        <div id="vw-conditions">${conditions.map(conditionRowHtml).join('') || '<div class="caps-empty">Always visible — no conditions set.</div>'}</div>
        <button type="button" id="vw-add-condition" class="bar-btn row-add">+ Add Condition</button>
      `}

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

    // --- visibleWhen wiring ---
    const commitVisibleWhen = (nextConditions, nextCombinator, recordHistory = true) => {
      const value = nextConditions.length === 0 ? undefined : { [nextCombinator]: nextConditions };
      this.state.updateComponent(comp.id, { visibleWhen: value }, recordHistory);
    };

    body.querySelector('#vw-combinator')?.addEventListener('change', (e) => commitVisibleWhen(conditions, e.target.value));

    body.querySelectorAll('#vw-conditions .row-list-item').forEach((rowEl) => {
      const idx = Number(rowEl.dataset.idx);
      const stateSelect = rowEl.querySelector('.vw-state');
      const stateCustomInput = rowEl.querySelector('.vw-state-custom');

      // V14: `stateOverride` lets the "Use This Component's Own Value" branch
      // below reuse this same op/value-reading logic rather than duplicating it.
      const applyRowChange = (recordHistory = true, stateOverride = undefined) => {
        const state = stateOverride !== undefined ? stateOverride
          : stateSelect.value === CUSTOM_OPTION_VALUE ? stateCustomInput.value.trim() : stateSelect.value;
        const op = rowEl.querySelector('.vw-op').value;
        const rawVal = rowEl.querySelector('.vw-val').value;
        const next = [...conditions];
        const cond = { state };
        if (op === 'between') {
          const [lo, hi] = rawVal.split(',').map((s) => Number(s.trim()));
          cond.between = [lo || 0, hi || 0];
        } else if (['gt', 'gte', 'lt', 'lte'].includes(op)) {
          cond[op] = Number(rawVal) || 0;
        } else {
          cond[op] = rawVal;
        }
        next[idx] = cond;
        commitVisibleWhen(next, combinator, recordHistory);
      };
      stateSelect?.addEventListener('change', () => {
        if (stateSelect.value === OWN_VALUE_OPTION) {
          const simVar = comp.binding?.readSimVar;
          if (!simVar) return;
          const name = this.state.resolveSyncFromVarName(simVar);
          stateCustomInput?.classList.add('hidden');
          this.state.saveHistory("Use This Component's Own Value");
          this.state.ensureSyncFromVar(simVar);
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
      rowEl.querySelector('.vw-op')?.addEventListener('change', applyRowChange);
      rowEl.querySelector('.vw-val')?.addEventListener('change', applyRowChange);
      rowEl.querySelector('.vw-remove')?.addEventListener('click', () => {
        commitVisibleWhen(conditions.filter((_, i) => i !== idx), combinator);
      });
    });

    body.querySelector('#vw-add-condition')?.addEventListener('click', () => {
      commitVisibleWhen([...conditions, { state: stateVars[0]?.name || '', equals: '' }], combinator);
    });

    body.querySelector('#vw-clear')?.addEventListener('click', () => {
      this.state.updateComponent(comp.id, { visibleWhen: undefined });
    });

    body.querySelector('#vw-raw-json')?.addEventListener('change', (e) => {
      this.updateVisibleWhenJson(comp, e.target.value, body.querySelector('#vw-raw-error'));
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

  updateVisibleWhenJson(comp, rawValue, errorEl) {
    try {
      const parsed = JSON.parse(rawValue);
      this.state.updateComponent(comp.id, { visibleWhen: parsed });
      if (errorEl) errorEl.classList.add('hidden');
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = `Invalid JSON — edit not applied: ${err.message}`;
        errorEl.classList.remove('hidden');
      }
    }
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
        this.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.label']);
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
        this.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.button']);
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
        this.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.indicator'].filter((f) => f.path.startsWith('props.')));
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
        const fieldMount = document.createElement('div');
        body.appendChild(fieldMount);
        this.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.rotary']);
        break;
      }

      default:
        body.innerHTML = `<div class="caps-empty">Standard properties active for ${comp.type}</div>`;
        break;
    }
  }

  /**
   * Parses a JSON-array/object prop field and applies it. On invalid JSON the
   * edit is NOT applied (so a typo can't corrupt the widget def), but unlike
   * the old silent-console-only behavior, this surfaces the parse error
   * inline next to the field so the user actually sees why nothing happened.
   */
  updateCompJsonProp(comp, propKey, rawValue, errorEl) {
    try {
      const parsed = JSON.parse(rawValue);
      this.updateCompProp(comp, propKey, parsed);
      if (errorEl) errorEl.classList.add('hidden');
    } catch (err) {
      if (errorEl) {
        errorEl.textContent = `Invalid JSON — edit not applied: ${err.message}`;
        errorEl.classList.remove('hidden');
      } else {
        console.warn(`[StudioInspector] Invalid JSON for prop "${propKey}"; change ignored.`, err);
      }
    }
  }

  /** A compact two-number range editor (min/max pair) replacing a raw JSON [a,b] text field. */
  // Step 3 Part B (2026-09-04): gained an optional trailing commitOverride, mirroring
  // renderRowListEditor's existing spec.commitOverride pattern — lets a nested path
  // (props.compose.valueRange) commit through commitField instead of always writing a
  // top-level prop via updateCompProp. This is what let renderComposeRange (a
  // byte-for-byte duplicate that existed only because this had no override mechanism)
  // be deleted — see renderRangeField below.
  renderRangeEditor(mount, comp, propKey, currentRange, title, hint, commitOverride) {
    if (!mount) return;
    const [lo, hi] = Array.isArray(currentRange) ? currentRange : [0, 1];
    mount.innerHTML = `
      <div class="prop-field">
        <label>${title}${hint ? `<span class="prop-hint" title="${hint}"> ⓘ</span>` : ''}</label>
        <div class="prop-row-2">
          <input type="number" step="any" class="prop-input range-lo" value="${lo}" />
          <input type="number" step="any" class="prop-input range-hi" value="${hi}" />
        </div>
      </div>
    `;
    const commit = commitOverride || ((v) => this.updateCompProp(comp, propKey, v));
    const apply = () => {
      const nextLo = Number(mount.querySelector('.range-lo').value) || 0;
      const nextHi = Number(mount.querySelector('.range-hi').value) || 0;
      commit([nextLo, nextHi]);
    };
    mount.querySelector('.range-lo')?.addEventListener('change', apply);
    mount.querySelector('.range-hi')?.addEventListener('change', apply);
  }

  /**
   * Generic add/remove/edit row-list editor for structured array props
   * (slider detents, selector positions, rocker zones) — replaces a raw JSON
   * textarea with typed fields per row while keeping the underlying data
   * shape identical to what the runtime component expects.
   */
  renderRowListEditor(mount, comp, propKey, rows, spec) {
    if (!mount) return;
    const list = Array.isArray(rows) ? rows : [];

    const fieldInput = (field, row) => {
      const val = row[field.key] !== undefined ? row[field.key] : field.default;
      if (field.type === 'checkbox') {
        return `<input type="checkbox" class="row-field" data-field="${field.key}" ${val ? 'checked' : ''} title="${field.label}" />`;
      }
      if (field.type === 'deckEvent') {
        const opts = getDeckEventsByKind('write').map((e) => `<option value="${e.name}" ${val === e.name ? 'selected' : ''}>${e.label}</option>`).join('');
        return `
          <select class="row-field prop-select" data-field="${field.key}" title="${field.label}">
            <option value="">— none —</option>
            ${opts}
            <option value="${CUSTOM_OPTION_VALUE}" ${val && !DECK_EVENT_NAMES.includes(val) ? 'selected' : ''}>Custom…</option>
          </select>
          <input type="text" class="row-field row-field-custom ${val && !DECK_EVENT_NAMES.includes(val) ? '' : 'hidden'}" data-field="${field.key}" value="${val && !DECK_EVENT_NAMES.includes(val) ? val : ''}" placeholder="Custom event name" />
        `;
      }
      return `<input type="${field.type}" step="any" class="row-field" data-field="${field.key}" value="${val !== undefined ? val : ''}" placeholder="${field.label}" />`;
    };

    mount.innerHTML = `
      <div class="prop-field">
        <label>${spec.title}${spec.hint ? `<span class="prop-hint" title="${spec.hint}"> ⓘ</span>` : ''}</label>
        <div class="row-list-editor">
          ${list.map((row, idx) => `
            <div class="row-list-item" data-idx="${idx}">
              ${spec.fields.map((f) => fieldInput(f, row)).join('')}
              <button type="button" class="btn-mini-close row-remove" title="Remove">✕</button>
            </div>
          `).join('') || '<div class="caps-empty">None yet.</div>'}
        </div>
        <button type="button" class="bar-btn row-add">+ Add ${spec.title.replace(/s$/, '')}</button>
      </div>
    `;

    // Most callers' array lives directly at props[propKey], so the default
    // commit just replaces that whole prop. A caller whose array is nested
    // deeper (e.g. props.arc.bands) passes commitOverride instead, so
    // committing the edited list doesn't clobber the rest of that parent
    // object.
    const commit = spec.commitOverride || ((nextList) => this.updateCompProp(comp, propKey, nextList));

    mount.querySelectorAll('.row-list-item').forEach((rowEl) => {
      const idx = Number(rowEl.dataset.idx);

      rowEl.querySelectorAll('select.row-field').forEach((sel) => {
        sel.addEventListener('change', () => {
          const key = sel.dataset.field;
          const isCustom = sel.value === CUSTOM_OPTION_VALUE;
          const customInput = rowEl.querySelector(`.row-field-custom[data-field="${key}"]`);
          customInput?.classList.toggle('hidden', !isCustom);
          const next = [...list];
          next[idx] = { ...next[idx], [key]: isCustom ? (customInput?.value || '') : sel.value };
          commit(next);
        });
      });
      rowEl.querySelectorAll('.row-field-custom').forEach((inp) => {
        inp.addEventListener('change', () => {
          const key = inp.dataset.field;
          const next = [...list];
          next[idx] = { ...next[idx], [key]: inp.value };
          commit(next);
        });
      });
      rowEl.querySelectorAll('input.row-field:not(.row-field-custom)').forEach((inp) => {
        inp.addEventListener('change', () => {
          const key = inp.dataset.field;
          const raw = inp.type === 'checkbox' ? inp.checked : (inp.type === 'number' ? Number(inp.value) : inp.value);
          const next = [...list];
          next[idx] = { ...next[idx], [key]: raw };
          commit(next);
        });
      });
      rowEl.querySelector('.row-remove')?.addEventListener('click', () => {
        commit(list.filter((_, i) => i !== idx));
      });
    });

    mount.querySelector('.row-add')?.addEventListener('click', () => {
      const newRow = {};
      spec.fields.forEach((f) => { newRow[f.key] = f.default; });
      commit([...list, newRow]);
    });
  }

  /**
   * FDWS v1.18: resolves whether the color/background fields below should
   * currently be reading/writing the widget's BASE style (style.*) or its
   * MANUAL theme override (style.themeOverride.*). Reuses the existing Live
   * Theme Preview toggle (StudioState.previewTheme, canvas header sun/moon
   * button) as "which theme am I looking at right now" — when the widget is
   * in Manual mode and the preview is showing the non-base theme, every
   * override-eligible field targets the override instead of the base value.
   * @returns {{baseTheme:'dark'|'light', themeMode:'auto'|'manual', isOverrideEdit:boolean}}
   */
  getThemeEditContext() {
    const def = this.state.widgetDef;
    const baseTheme = def.baseTheme === 'light' ? 'light' : 'dark';
    const themeMode = def.themeMode === 'manual' ? 'manual' : 'auto';
    return { baseTheme, themeMode, isOverrideEdit: themeMode === 'manual' && this.state.previewTheme !== baseTheme };
  }

  /** Extracts a plain #rrggbb from a style value, since <input type="color"> rejects anything else (CSS var() refs, gradients, named colors). */
  toHexColor(value) {
    if (typeof value !== 'string') return null;
    const match = value.match(/#[0-9a-fA-F]{6}/);
    return match ? match[0] : null;
  }

  /**
   * Wave 0b (V22): every color field is a swatch+text pair. The two halves
   * used to listen to different events (swatch on 'input' only, text on
   * 'change' only) — a value delivered via the "wrong" channel for a given
   * half (set programmatically, pasted, or delivered by an automation tool)
   * silently never committed. Both halves now listen to both events, deduped
   * through one commit path so a single user gesture (e.g. dragging, which
   * fires many 'input' events then one 'change') doesn't push duplicate
   * undo-history entries or re-render more than once per distinct value. The
   * text field's own 'input' listener only live-commits once its value is a
   * complete, valid color (or, for background fields, a gradient() string) —
   * never on a partial "#f8" mid-type.
   * @param {Element} root - queried for #pickId/#txtId (usually `body` or `this.container`)
   * @param {string} pickId
   * @param {string} txtId
   * @param {(value: string) => void} applyFn
   * @param {{allowGradient?: boolean, skipEmpty?: boolean}} [opts] - skipEmpty:
   *   true for the bulk multi-select editor, where a blank field means "leave
   *   this property unchanged on every selected component," not "clear it."
   */
  wireColorPair(root, pickId, txtId, applyFn, { allowGradient = false, skipEmpty = false } = {}) {
    const pick = root.querySelector(`#${pickId}`);
    const txt = root.querySelector(`#${txtId}`);
    let lastCommitted;
    const commit = (rawVal) => {
      const val = rawVal.trim();
      if (skipEmpty && !val) return;
      if (val === lastCommitted) return;
      lastCommitted = val;
      if (txt) txt.value = val;
      const hex = this.toHexColor(val);
      if (pick && hex) pick.value = hex;
      applyFn(val);
    };
    pick?.addEventListener('input', (e) => commit(e.target.value));
    pick?.addEventListener('change', (e) => commit(e.target.value));
    txt?.addEventListener('change', (e) => commit(e.target.value));
    txt?.addEventListener('input', (e) => {
      const v = e.target.value.trim();
      if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) || (allowGradient && GRADIENT_VALUE_RE.test(v))) commit(v);
    });
  }

  // =========================================================================
  // Wave 1 (Part 1): the generic, registry-driven field-rendering engine.
  //
  // Scoped narrower than first planned. Building this turned up that several
  // of the registry's control names aren't cleanly delegate-able yet:
  // rowListEditor/arcBandsEditor/detentEditor need a per-field row spec
  // (headers, add-row shape) the registry doesn't declare — every existing
  // call site (arc bands, slider detents, selector positions, rocker zones)
  // builds that spec by hand. conditionBuilder/conditionalStyleBuilder read
  // from COMMON_FIELDS (visibleWhen/style.rules), which already have
  // dedicated hand-built panels elsewhere in this file (renderVisibilityAndGuard,
  // and — until Wave 2 Part B2 folded style.rules' STYLE side into the
  // generic engine via rule chips, see renderAppearanceSection() —
  // renderConditionalFormatting) — genericizing those specifically would
  // duplicate/shadow them, not replace them, since this pass only converts
  // two types' OWN TYPE_FIELDS, not COMMON_FIELDS.
  //
  // So FIELD_RENDERERS covers the true plain, single-value primitives —
  // text/number/checkbox/select/color/iconPicker — the ones this pass's
  // conversion (core.label, core.button) actually needs and can fully
  // verify. The rest stay hand-coded; scripts/check-registry-drift.mjs's
  // matching CI check allowlists them as "not yet migrated" rather than
  // silently passing or falsely asserting they're covered.
  // =========================================================================

  FIELD_RENDERERS = {
    text: (comp, field, mount) => this.renderPlainField(comp, field, mount, 'text'),
    iconPicker: (comp, field, mount) => this.renderPlainField(comp, field, mount, 'text'),
    number: (comp, field, mount) => this.renderPlainField(comp, field, mount, 'number'),
    checkbox: (comp, field, mount) => this.renderCheckboxField(comp, field, mount),
    select: (comp, field, mount) => this.renderSelectField(comp, field, mount),
    color: (comp, field, mount) => this.renderColorField(comp, field, mount),
    // Step 3 Part A (2026-09-04): rowListEditor/detentEditor are the same underlying
    // renderRowListEditor() (see that method's own header comment) — both control
    // names stay distinct in the registry for self-documentation, resolving to one
    // implementation here, same as the registry already did before this engine existed.
    rowListEditor: (comp, field, mount) => this.renderRowListField(comp, field, mount),
    detentEditor: (comp, field, mount) => this.renderRowListField(comp, field, mount),
    // Step 3 Part B (2026-09-04): arc.bands is just another row-list field once it
    // declares a rowSpec — same renderer as rowListEditor/detentEditor, no new function.
    arcBandsEditor: (comp, field, mount) => this.renderRowListField(comp, field, mount),
    stateVarPicker: (comp, field, mount) => this.renderStateVarField(comp, field, mount),
    assetPicker: (comp, field, mount) => this.renderAssetField(comp, field, mount),
    rangeEditor: (comp, field, mount) => this.renderRangeField(comp, field, mount),
    pivotEditor: (comp, field, mount) => this.renderPivotField(comp, field, mount)
  };

  /** path.split('.') get, tolerant of missing intermediate objects. */
  getFieldValue(comp, path) {
    return path.split('.').reduce((cur, seg) => (cur == null ? undefined : cur[seg]), comp);
  }

  /**
   * Generic nested-path commit — clones only the objects along `path` (not
   * the whole component), splices in the leaf value, and commits the ONE
   * top-level key via the existing updateComponent(). Mirrors the manual
   * per-field pattern already hand-written throughout this file (e.g.
   * `updateStyle({ typography: { ...(comp.style?.typography||{}), color } })`),
   * generalized once instead of repeated per field.
   */
  commitField(comp, path, value) {
    const segs = path.split('.');
    const topKey = segs[0];
    // Wave 2 Part B2: style.rules is an ARRAY — {...arr} produces a plain
    // object with numeric string keys, silently corrupting Array.isArray()
    // and .length for every downstream consumer (resolveActiveRuleStyle(),
    // the rule chip list). Preserving array-ness here is what makes it safe
    // to commitField() through a `style.rules.<idx>.style.*` path at all.
    const cloneLevel = (obj) => (Array.isArray(obj) ? [...obj] : (obj && typeof obj === 'object' ? { ...obj } : {}));
    const topVal = cloneLevel(comp[topKey]);
    let cur = topVal;
    for (let i = 1; i < segs.length - 1; i++) {
      cur[segs[i]] = cloneLevel(cur[segs[i]]);
      cur = cur[segs[i]];
    }
    if (segs.length > 1) cur[segs[segs.length - 1]] = value;
    this.state.updateComponent(comp.id, { [topKey]: topVal });
  }

  /**
   * The registry's existing {path, equals|equalsAny|notEquals} showWhen grammar.
   *
   * Step 3 Part B (2026-09-04): gained an optional `siblingFields` parameter — found
   * live while converting core.gauge. getFieldValue() reads the RAW stored value; if
   * the referenced field is genuinely unset, that's `undefined`, not its registered
   * `default`. An `equals` gate against a field whose true default is non-obvious
   * (e.g. Pivot's `{path:'props.transform', equals:'rotate'}`, when transform's own
   * default is 'rotate') silently never matched until the user touched that field once
   * — every prior showWhen in this codebase happened to use `notEquals`/a default that
   * coincidentally didn't match its gate, so this never surfaced before now. When
   * `siblingFields` is passed (renderRegistryFields already has the full field list in
   * scope), an undefined raw value falls back to the referenced field's own `default`.
   * Row-list rowSpec per-column showWhen (renderRowListField) intentionally omits this
   * — none of its current uses need it, and doing so would need threading the full
   * type's field list through every FIELD_RENDERERS signature for no live benefit yet.
   */
  evaluateShowWhen(comp, showWhen, siblingFields) {
    let val = this.getFieldValue(comp, showWhen.path);
    if (val === undefined && siblingFields) {
      const referenced = siblingFields.find((f) => f.path === showWhen.path);
      // Wave 2 Part B1: a retargeted (state/rule/theme) field carries
      // inheritedValue — the live Base value — which takes precedence over
      // the static registry default, same reasoning as the default fallback
      // this comment block already documents. Absent on every Base-target/
      // TYPE_FIELDS field, so this is a no-op there.
      if (referenced && referenced.inheritedValue !== undefined) val = referenced.inheritedValue;
      else if (referenced && 'default' in referenced) val = referenced.default;
    }
    if ('equals' in showWhen) return val === showWhen.equals;
    if ('notEquals' in showWhen) return val !== showWhen.notEquals;
    if ('equalsAny' in showWhen) return showWhen.equalsAny.includes(val);
    return true;
  }

  /** path's last segment, camelCase -> "Title Case", with a couple of acronym fixups. */
  humanizeFieldLabel(path) {
    const key = path.split('.').pop();
    const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
    const titled = spaced.charAt(0).toUpperCase() + spaced.slice(1);
    return titled.replace(/\bLed\b/, 'LED').replace(/\bId\b/, 'ID').replace(/\bUrl\b/, 'URL');
  }

  fieldDomId(path) {
    return `rf-${path.replace(/\./g, '-')}`;
  }

  /**
   * Wave 2 Part B1/B2: rewrites a single Appearance field path from Base's
   * storage (style.*) onto another target's storage. `'base'` is a no-op;
   * `'state'` -> `style.states.<name>.`; `'rule'` -> `style.rules.<index>.style.`.
   * Shared by retargetAppearanceFields()/renderClearInheritedToggle()/
   * applyClearedFieldState() so the three don't drift against each other —
   * a future Theme target (Part B3) adds one more case here.
   */
  remapAppearancePath(path, target) {
    if (target.kind === 'state') return path.replace(/^style\./, `style.states.${target.name}.`);
    if (target.kind === 'rule') return path.replace(/^style\./, `style.rules.${target.index}.style.`);
    return path;
  }

  /**
   * Wave 2 Part B1: remaps an Appearance field list from Base's storage onto
   * another target's storage via remapAppearancePath(), applied to both
   * `path` and, if present, `showWhen.path`. `{kind:'base'}` is a no-op. For
   * a non-base target, each cloned field also gets `inheritedValue` — the
   * LIVE value at the original (un-retargeted) path, i.e. what this field
   * currently resolves to one layer up — which resolveEffectiveValue()/
   * evaluateShowWhen() use to show and gate on "what you'd get if you didn't
   * override this here," matching the state tab's old eff()
   * dimmed-inherited-value convention. (A rule's "inherited" value is Base's
   * literal value, not a full base->state->rule runtime preview — the same
   * simplification the state target already uses, since which state is
   * concurrently active isn't knowable from the Inspector's own UI state.)
   */
  retargetAppearanceFields(comp, fields, target) {
    if (target.kind === 'base') return fields;
    return fields.map((f) => ({
      ...f,
      path: this.remapAppearancePath(f.path, target),
      showWhen: f.showWhen ? { ...f.showWhen, path: this.remapAppearancePath(f.showWhen.path, target) } : undefined,
      inheritedValue: this.getFieldValue(comp, f.path)
    }));
  }

  /**
   * Wave 2 Part B1 (Part 4, first slice): the unified Appearance field
   * renderer — one field list (getAppearanceFieldSpecs(), from COMMON_FIELDS)
   * retargeted at whichever storage location `target` names, replacing what
   * used to be ~700 lines of duplicated hand-written markup/handlers for the
   * Base tab and the interaction-state tab separately. Renders in four
   * registry-group sections, in the same visual order the old hand-coded
   * panel used: Typography (absorbs the old separate "Text Outline & Glow"
   * subtitle — the registry doesn't distinguish them), Layout (was "Content
   * Alignment & Position"), Border (was "Border & Radius"), Background (was
   * "Background Fill").
   *
   * Text Color, Stroke Color, Glow Color, Border Color, Border Glow Color,
   * and the whole Background section stay HAND-CODED on the Base target only
   * (rendered by renderBaseThemeAwareAppearanceFields(), called from here) —
   * Manual theme mode (FDWS v1.18, widened v1.29 to cover stroke/glow/border
   * glow alongside the original three) redirects THEIR writes to
   * style.themeOverride.* while every other Appearance field always writes
   * straight to style.* regardless of theme-edit mode. The generic engine's
   * commitField() has no per-field write-redirect concept, and
   * style.themeOverride only ever applies to Base (never state/rule —
   * BaseComponent.js only ever reads it off the base style object), so this
   * split only matters here, never on the state tab, and is deliberately not
   * generalized in this slice — the Theme chip (Wave 2 Part B3) is where
   * that gets solved properly, by making Theme a real retarget target
   * instead of a conditional inside Base.
   */
  renderAppearanceSection(comp, mount, target, baseThemeCtx) {
    mount.innerHTML = '';
    const allFields = getAppearanceFieldSpecs();
    const groupOrder = ['Typography', 'Layout', 'Border', 'Background'];
    // Wave 2 Part A's "clear inherited value" checkboxes (V24's null sentinel)
    // only ever existed on the state tab, one per nested sub-object — ported
    // onto the generic engine here rather than lost in the rewrite. [basePath,
    // label, the leaf field paths under it to disable+dim when cleared].
    const CLEARABLE_SUB_OBJECTS = {
      Typography: [
        ['style.typography.stroke', 'Outline', ['style.typography.stroke.width', 'style.typography.stroke.color']],
        ['style.typography.glow', 'Glow', ['style.typography.glow.color', 'style.typography.glow.blur']]
      ],
      Border: [
        ['style.border.glow', 'Border Glow', ['style.border.glow.color', 'style.border.glow.blur', 'style.border.glow.inset']]
      ]
    };
    groupOrder.forEach((groupName) => {
      let groupFields = allFields.filter((f) => f.group === groupName);
      if (target.kind === 'base') {
        // FDWS v1.29: stroke.color/glow.color/border.glow.color join
        // typography.color/border.color as Base-only hand-coded fields (see
        // renderBaseThemeAwareAppearanceFields()) so Manual theme mode can
        // redirect their writes to style.themeOverride.* — stroke.width/
        // glow.blur/border.glow.inset aren't colors and stay generic here.
        if (groupName === 'Typography') groupFields = groupFields.filter((f) => f.path !== 'style.typography.color' && f.path !== 'style.typography.stroke.color' && f.path !== 'style.typography.glow.color');
        if (groupName === 'Border') groupFields = groupFields.filter((f) => f.path !== 'style.border.color' && f.path !== 'style.border.glow.color');
        if (groupName === 'Background') groupFields = [];
      }
      if (!groupFields.length && !(target.kind === 'base' && groupName === 'Background')) return;
      const subtitle = document.createElement('div');
      subtitle.className = 'prop-section-subtitle';
      subtitle.style.marginTop = '10px';
      subtitle.textContent = groupName;
      mount.appendChild(subtitle);
      const groupMount = mount.appendChild(document.createElement('div'));
      // Separate child mounts: renderRegistryFields() clears its own mount's
      // innerHTML on entry, which would otherwise wipe out the clear-toggle
      // checkboxes appended before it if they shared one mount.
      const isOverridable = target.kind === 'state' || target.kind === 'rule';
      if (isOverridable) {
        const togglesMount = groupMount.appendChild(document.createElement('div'));
        (CLEARABLE_SUB_OBJECTS[groupName] || []).forEach(([basePath, label]) => {
          this.renderClearInheritedToggle(comp, basePath, label, target, togglesMount);
        });
      }
      const fieldsMount = groupMount.appendChild(document.createElement('div'));
      if (groupFields.length) {
        this.renderRegistryFields(comp, fieldsMount, this.retargetAppearanceFields(comp, groupFields, target));
      }
      if (target.kind === 'base' && (groupName === 'Typography' || groupName === 'Border' || groupName === 'Background')) {
        this.renderBaseThemeAwareAppearanceFields(comp, groupName, groupMount.appendChild(document.createElement('div')), baseThemeCtx);
      }
      if (isOverridable) {
        (CLEARABLE_SUB_OBJECTS[groupName] || []).forEach(([basePath, , leafPaths]) => {
          this.applyClearedFieldState(comp, basePath, leafPaths, target, fieldsMount);
        });
      }
    });
  }

  /** Wave 2 Part A's per-sub-object "Clear (don't inherit)" checkbox — writes the V24 `null` sentinel. State/Rule targets only; Base has nothing to inherit from. */
  renderClearInheritedToggle(comp, basePath, label, target, mount) {
    const targetPath = this.remapAppearancePath(basePath, target);
    const isCleared = this.getFieldValue(comp, targetPath) === null;
    const id = `${this.fieldDomId(targetPath)}-clear`;
    const div = document.createElement('div');
    div.className = 'prop-field';
    div.innerHTML = `
      <label style="display:flex;align-items:center;gap:6px;" title="Turns ${escapeHtmlAttr(label.toLowerCase())} off for this state regardless of what Base sets — different from leaving these blank, which inherits Base's ${escapeHtmlAttr(label.toLowerCase())}.">
        <input type="checkbox" id="${id}" ${isCleared ? 'checked' : ''} /> ${escapeHtmlAttr(label)}: Clear (don't inherit)
      </label>
    `;
    mount.appendChild(div);
    div.querySelector(`#${id}`)?.addEventListener('change', (e) => {
      this.commitField(comp, targetPath, e.target.checked ? null : undefined);
    });
  }

  /** Disables+dims a cleared sub-object's own leaf inputs (and color-pick swatch), matching the old hand-coded state tab's behavior. */
  applyClearedFieldState(comp, basePath, leafPaths, target, mount) {
    const targetPath = this.remapAppearancePath(basePath, target);
    if (this.getFieldValue(comp, targetPath) !== null) return;
    leafPaths.forEach((p) => {
      const retargeted = this.remapAppearancePath(p, target);
      const id = this.fieldDomId(retargeted);
      const el = mount.querySelector(`#${id}`);
      const pickEl = mount.querySelector(`#${id}-pick`);
      if (el) { el.disabled = true; el.style.opacity = '0.4'; }
      if (pickEl) pickEl.disabled = true;
    });
  }

  /**
   * Wave 2 Part B1 (widened FDWS v1.29): the Base-tab color fields kept out
   * of the generic engine (see renderAppearanceSection's doc comment) — Text
   * Color / Border Color / Background started as verbatim ports of the
   * pre-existing hand-coded markup and handlers; Stroke Color / Glow Color /
   * Border Glow Color joined them in v1.29, same pattern (an eff*Color read
   * from ctx, a themeEdit.isOverrideEdit-gated writer).
   */
  renderBaseThemeAwareAppearanceFields(comp, groupName, mount, ctx) {
    const { themeEdit, effTypoColor, effBorderColor, effBg, effStrokeColor, effGlowColor, effBorderGlowColor, assets } = ctx;
    const updateStyle = (updates) => {
      this.state.updateComponent(comp.id, { style: { ...(comp.style || {}), ...updates } });
    };
    const updateOverride = (field, updates) => {
      const curOverride = comp.style?.themeOverride || {};
      this.state.updateComponent(comp.id, {
        style: { ...(comp.style || {}), themeOverride: { ...curOverride, [field]: { ...(curOverride[field] || {}), ...updates } } }
      });
    };
    const updateOverrideBackground = (nextBg) => {
      const curOverride = comp.style?.themeOverride || {};
      this.state.updateComponent(comp.id, {
        style: { ...(comp.style || {}), themeOverride: { ...curOverride, background: nextBg } }
      });
    };
    // FDWS v1.29: the stroke/glow siblings of updateOverride() above, one
    // level deeper — themeOverride.typography.stroke.color/
    // themeOverride.typography.glow.color/themeOverride.border.glow.color,
    // vs. updateOverride's themeOverride.typography.color/
    // themeOverride.border.color. Kept separate rather than widening
    // updateOverride's own signature, since its other two callers (Text
    // Color/Border Color) don't need a third path segment.
    const updateOverrideNested = (field, subKey, updates) => {
      const curOverride = comp.style?.themeOverride || {};
      const curField = curOverride[field] || {};
      this.state.updateComponent(comp.id, {
        style: { ...(comp.style || {}), themeOverride: { ...curOverride, [field]: { ...curField, [subKey]: { ...(curField[subKey] || {}), ...updates } } } }
      });
    };

    if (groupName === 'Typography') {
      mount.innerHTML = `
        <div class="prop-field">
          <label>Text Color</label>
          <div class="color-picker-wrap">
            <input type="color" id="c-typo-color-pick" value="${this.toHexColor(effTypoColor) || '#f8fafc'}" />
            <input type="text" id="c-typo-color" class="prop-input" value="${effTypoColor || '#f8fafc'}" />
          </div>
        </div>
        <div class="prop-field">
          <label title="Text outline color. Leave unset for none.">Stroke Color</label>
          <div class="color-picker-wrap">
            <input type="color" id="c-typo-stroke-color-pick" value="${this.toHexColor(effStrokeColor) || '#000000'}" />
            <input type="text" id="c-typo-stroke-color" class="prop-input" value="${escapeHtmlAttr(effStrokeColor || '')}" placeholder="none" />
          </div>
        </div>
        <div class="prop-field">
          <label title="Text glow/bloom color. Leave unset for none.">Glow Color</label>
          <div class="color-picker-wrap">
            <input type="color" id="c-typo-glow-color-pick" value="${this.toHexColor(effGlowColor) || '#000000'}" />
            <input type="text" id="c-typo-glow-color" class="prop-input" value="${escapeHtmlAttr(effGlowColor || '')}" placeholder="none" />
          </div>
        </div>
      `;
      const setTypoColor = (color) => themeEdit.isOverrideEdit
        ? updateOverride('typography', { color })
        : updateStyle({ typography: { ...(comp.style?.typography || {}), color } });
      this.wireColorPair(mount, 'c-typo-color-pick', 'c-typo-color', setTypoColor);
      const setStrokeColor = (color) => themeEdit.isOverrideEdit
        ? updateOverrideNested('typography', 'stroke', { color })
        : updateStyle({ typography: { ...(comp.style?.typography || {}), stroke: { ...(comp.style?.typography?.stroke || {}), color } } });
      this.wireColorPair(mount, 'c-typo-stroke-color-pick', 'c-typo-stroke-color', setStrokeColor);
      const setGlowColor = (color) => themeEdit.isOverrideEdit
        ? updateOverrideNested('typography', 'glow', { color })
        : updateStyle({ typography: { ...(comp.style?.typography || {}), glow: { ...(comp.style?.typography?.glow || {}), color } } });
      this.wireColorPair(mount, 'c-typo-glow-color-pick', 'c-typo-glow-color', setGlowColor);
      return;
    }

    if (groupName === 'Border') {
      mount.innerHTML = `
        <div class="prop-field">
          <label>Border Color</label>
          <div class="color-picker-wrap">
            <input type="color" id="c-border-color-pick" value="${this.toHexColor(effBorderColor) || '#273344'}" />
            <input type="text" id="c-border-color" class="prop-input" value="${effBorderColor || '#273344'}" />
          </div>
        </div>
        <div class="prop-field">
          <label title="Soft glow around the border. Leave unset for none.">Border Glow Color</label>
          <div class="color-picker-wrap">
            <input type="color" id="c-border-glow-color-pick" value="${this.toHexColor(effBorderGlowColor) || '#000000'}" />
            <input type="text" id="c-border-glow-color" class="prop-input" value="${escapeHtmlAttr(effBorderGlowColor || '')}" placeholder="none" />
          </div>
        </div>
      `;
      const setBorderColor = (color) => themeEdit.isOverrideEdit
        ? updateOverride('border', { color })
        : updateStyle({ border: { ...(comp.style?.border || {}), color } });
      this.wireColorPair(mount, 'c-border-color-pick', 'c-border-color', setBorderColor);
      const setBorderGlowColor = (color) => themeEdit.isOverrideEdit
        ? updateOverrideNested('border', 'glow', { color })
        : updateStyle({ border: { ...(comp.style?.border || {}), glow: { ...(comp.style?.border?.glow || {}), color } } });
      this.wireColorPair(mount, 'c-border-glow-color-pick', 'c-border-glow-color', setBorderGlowColor);
      return;
    }

    // Background — the whole section, hand-coded: type/color/gradient/image,
    // unchanged from the pre-Part-4 panel (including the gradient-paste
    // auto-detect and the auto-seed-a-sensible-value-on-type-switch
    // conveniences the generic engine's showWhen-only gating doesn't
    // reproduce — documented, accepted losses for the State tab, which now
    // renders Background generically instead; Base keeps them here).
    const setBg = themeEdit.isOverrideEdit ? updateOverrideBackground : (nextBg) => updateStyle({ background: nextBg });
    const curBg = themeEdit.isOverrideEdit ? (comp.style?.themeOverride?.background || {}) : (comp.style?.background || {});
    mount.innerHTML = `
      <div class="prop-field">
        <label>Background Type</label>
        <select id="c-bg-type" class="prop-select">
          <option value="none" ${effBg.type === 'none' ? 'selected' : ''}>None (Transparent)</option>
          <option value="color" ${(!effBg.type || effBg.type === 'color') ? 'selected' : ''}>Solid Color</option>
          <option value="gradient" ${effBg.type === 'gradient' ? 'selected' : ''}>CSS Gradient</option>
          <option value="image" ${effBg.type === 'image' ? 'selected' : ''}>Image (Asset Library)</option>
        </select>
      </div>
      <div id="c-bg-color-field" class="prop-field" style="${(!effBg.type || effBg.type === 'color') ? '' : 'display:none;'}">
        <label>Background Color</label>
        <div class="color-picker-wrap">
          <input type="color" id="c-bg-color-pick" value="${this.toHexColor(effBg.color) || '#131b26'}" />
          <input type="text" id="c-bg-color" class="prop-input" value="${effBg.color || '#131b26'}" />
        </div>
      </div>
      <div id="c-bg-gradient-field" class="prop-field" style="${effBg.type === 'gradient' ? '' : 'display:none;'}">
        <label>CSS Gradient</label>
        <input type="text" id="c-bg-gradient" class="prop-input" value="${effBg.gradient || ''}" placeholder="linear-gradient(180deg, #1a2332, #0b0f17)" />
      </div>
      <div id="c-bg-image-fields" style="${effBg.type === 'image' ? '' : 'display:none;'}">
        <div class="prop-field">
          <label>Image <span class="prop-hint" title="FDWS v1.8 background.image, already fully supported at runtime. Add images on the Assets tab first. For a switch/control that looks different per position, use Conditional Formatting (below) to swap this per state instead of picking one fixed image here.">ⓘ</span></label>
          <select id="c-bg-image-asset" class="prop-select">
            <option value="">— none —</option>
            ${assets.map((a) => `<option value="${a.id}" ${effBg.image?.assetId === a.id ? 'selected' : ''}>${a.id} (${a.mimeType})</option>`).join('')}
          </select>
          ${assets.length === 0 ? '<div class="caps-empty">No assets uploaded yet — add one on the Assets tab.</div>' : ''}
        </div>
        <div class="prop-row-2">
          <div class="prop-field">
            <label>Fit</label>
            <select id="c-bg-image-fit" class="prop-select">
              <option value="cover" ${(!effBg.image?.fit || effBg.image?.fit === 'cover') ? 'selected' : ''}>Cover</option>
              <option value="contain" ${effBg.image?.fit === 'contain' ? 'selected' : ''}>Contain</option>
              <option value="tile" ${effBg.image?.fit === 'tile' ? 'selected' : ''}>Tile</option>
            </select>
          </div>
          <div class="prop-field">
            <label>Position</label>
            <input type="text" id="c-bg-image-position" class="prop-input" value="${effBg.image?.position || ''}" placeholder="center" />
          </div>
        </div>
      </div>
    `;
    mount.querySelector('#c-bg-type')?.addEventListener('change', (e) => {
      const type = e.target.value;
      mount.querySelector('#c-bg-color-field').style.display = type === 'color' ? '' : 'none';
      mount.querySelector('#c-bg-gradient-field').style.display = type === 'gradient' ? '' : 'none';
      mount.querySelector('#c-bg-image-fields').style.display = type === 'image' ? '' : 'none';
      if (type === 'none') setBg({ type: 'none' });
      else if (type === 'color') setBg({ type: 'color', color: curBg.color || '#131b26' });
      else if (type === 'gradient') setBg({ type: 'gradient', gradient: curBg.gradient || 'linear-gradient(180deg, #1a2332, #0b0f17)' });
      else if (type === 'image') setBg({ type: 'image', image: { assetId: curBg.image?.assetId || assets[0]?.id || '' } });
    });
    this.wireColorPair(mount, 'c-bg-color-pick', 'c-bg-color', (value) => {
      if (GRADIENT_VALUE_RE.test(value.trim())) {
        setBg({ type: 'gradient', gradient: value.trim() });
        showToast('That looks like a CSS gradient, not a color — switched Background Type to "CSS Gradient" so it stays theme-aware.');
        this.render();
        return;
      }
      setBg({ type: 'color', color: value });
    }, { allowGradient: true });
    mount.querySelector('#c-bg-gradient')?.addEventListener('change', (e) => setBg({ type: 'gradient', gradient: e.target.value }));
    const updateBgImage = (updates) => {
      const nextImage = { ...(curBg.image || {}), ...updates };
      setBg({ type: 'image', image: nextImage });
    };
    mount.querySelector('#c-bg-image-asset')?.addEventListener('change', (e) => updateBgImage({ assetId: e.target.value }));
    mount.querySelector('#c-bg-image-fit')?.addEventListener('change', (e) => updateBgImage({ fit: e.target.value }));
    mount.querySelector('#c-bg-image-position')?.addEventListener('change', (e) => updateBgImage({ position: e.target.value || undefined }));
  }

  /**
   * Walks `fields` and dispatches each to FIELD_RENDERERS[control]. Throws
   * (dev-time, loud) on an unregistered control string, so a registry typo
   * can't silently render nothing.
   *
   * Callers pass either a raw TYPE_FIELDS[type] array, or — since Wave 2
   * Part B1 — a retargeted slice of COMMON_FIELDS' style.* rows from
   * renderAppearanceSection()/retargetAppearanceFields(). Deliberately never
   * called with the full getFieldsForType()-merged COMMON_FIELDS set:
   * Bindings/Visibility/Conditional-Formatting rows still have their own
   * dedicated hand-built panels elsewhere in this file, and rendering them
   * again here would duplicate those, not replace them.
   */
  renderRegistryFields(comp, mount, fields) {
    mount.innerHTML = '';
    fields.forEach((field) => {
      if (field.control === null) return; // deprecated/hidden, e.g. props.align
      // Step 3 Part A (2026-09-04): 'bespoke' is a DIFFERENT skip reason from null —
      // the field is real and has working UI, it's just intentionally hand-rendered
      // outside this engine (e.g. core.list's itemTemplate, which needs JSON.parse
      // validation this engine's controls don't have). Distinct from null so a future
      // "which fields have no UI at all" check can tell the two apart.
      if (field.control === 'bespoke') return;
      // Part 2, §2.1 (Ingrid's guarantee): a showWhen-false field is normally
      // skipped entirely, but a GENUINELY AUTHORED value (raw, stored, and
      // different from the field's own default — not just "happens to be
      // set to its own default") must never silently vanish, at any tier.
      // Render it anyway, dimmed, with why it's hidden and a one-click clear.
      let suppressed = false;
      if (field.showWhen && !this.evaluateShowWhen(comp, field.showWhen, fields)) {
        const raw = this.getFieldValue(comp, field.path);
        if (raw === undefined || raw === field.default) return; // unchanged: nothing authored, skip as before
        suppressed = true;
      }
      const renderer = this.FIELD_RENDERERS[field.control];
      if (!renderer) {
        throw new Error(`[StudioInspector] No FIELD_RENDERERS entry for control "${field.control}" (path "${field.path}") — register one before declaring a field with this control.`);
      }
      const wrap = document.createElement('div');
      wrap.className = 'prop-field';
      // Part 2: 'advanced' fields stay Full-only, unchanged. A 'simple' field
      // not in the curated Guided allowlist (field.guided) is Build+Full —
      // hidden only in Guided. A curated Guided field gets no data-tier
      // attribute at all, same as every field before Part 2 existed: always
      // visible, at every tier. A suppressed-but-authored field ALSO gets no
      // data-tier — §2.1 shows "regardless of tier and regardless of
      // showWhen," the same bypass as the showWhen gate itself just got.
      if (!suppressed) {
        if (field.tier === 'advanced') wrap.setAttribute('data-tier', 'advanced');
        else if (field.tier === 'simple' && !field.guided) wrap.setAttribute('data-tier', 'build');
      }
      mount.appendChild(wrap);
      if (suppressed) {
        const raw = this.getFieldValue(comp, field.path);
        const note = document.createElement('div');
        note.className = 'prop-showwhen-note';
        note.innerHTML = `
          <span>${escapeHtmlAttr(this.formatShowWhenReason(field.showWhen))} — still set to "${escapeHtmlAttr(String(raw))}"</span>
          <button type="button" class="prop-showwhen-clear">Clear</button>
        `;
        note.querySelector('.prop-showwhen-clear')?.addEventListener('click', () => this.commitField(comp, field.path, undefined));
        wrap.appendChild(note);
        const fieldMount = document.createElement('div');
        fieldMount.style.opacity = '0.55';
        wrap.appendChild(fieldMount);
        renderer(comp, field, fieldMount);
      } else {
        renderer(comp, field, wrap);
      }
    });
  }

  /**
   * Part 2, §2.1: human-readable reason a showWhen-gated field is currently
   * hidden — "<referenced field's label> <op> <value>", matching the exact
   * wording style the proposal itself uses ("Format ≠ LATLON_DMS").
   */
  formatShowWhenReason(showWhen) {
    const label = this.humanizeFieldLabel(showWhen.path);
    if ('equals' in showWhen) return `${label} ≠ ${showWhen.equals}`;
    if ('notEquals' in showWhen) return `${label} = ${showWhen.notEquals}`;
    if ('equalsAny' in showWhen) return `${label} is not one of: ${showWhen.equalsAny.join(', ')}`;
    return `a condition on ${label}`;
  }

  /**
   * Wave 1 gap-closing pass (2026-09-04): falls back to field.default when unset,
   * mirroring the `??`/`||` fallback every hand-coded panel this engine replaces
   * already showed. Wave 2 Part B1 (2026-09-04): gained a rung ABOVE that —
   * field.inheritedValue (a retargeted field's live Base value, set by
   * retargetAppearanceFields()) wins over the static default when present, and
   * marks the result dimmed so a State/Rule/Theme-target field visually shows
   * "this is Base's value, not yours yet," matching the state tab's old eff()
   * convention. Absent on every Base-target/TYPE_FIELDS field, so `dimmed` is
   * always false and `value` resolves exactly as before there — this is a
   * strict superset of the old fallback, not a behavior change for existing
   * callers. commitField() is unaffected either way: still only ever writes
   * what the user actually changes, never silently backfills a fallback.
   */
  resolveEffectiveValue(comp, field) {
    const raw = this.getFieldValue(comp, field.path);
    if (raw !== undefined) return { value: raw, dimmed: false };
    if (field.inheritedValue !== undefined) return { value: field.inheritedValue, dimmed: true };
    return { value: field.default, dimmed: false };
  }

  renderPlainField(comp, field, mount, inputType) {
    const label = this.humanizeFieldLabel(field.path);
    const id = this.fieldDomId(field.path);
    const { value, dimmed } = this.resolveEffectiveValue(comp, field);
    mount.innerHTML = `
      <label title="${escapeHtmlAttr(field.tooltip || '')}">${escapeHtmlAttr(label)}</label>
      <input type="${inputType}" id="${id}" class="prop-input" style="${dimmed ? 'opacity:0.55;' : ''}" value="${escapeHtmlAttr(value ?? '')}" placeholder="${escapeHtmlAttr(field.placeholder || '')}" />
    `;
    mount.querySelector(`#${id}`)?.addEventListener('change', (e) => {
      const raw = e.target.value;
      const v = inputType === 'number' ? (raw === '' ? undefined : (Number(raw) || 0)) : raw;
      this.commitField(comp, field.path, v);
    });
  }

  renderCheckboxField(comp, field, mount) {
    const label = this.humanizeFieldLabel(field.path);
    const id = this.fieldDomId(field.path);
    const { value, dimmed } = this.resolveEffectiveValue(comp, field);
    mount.innerHTML = `
      <label title="${escapeHtmlAttr(field.tooltip || '')}" style="display:flex;align-items:center;gap:6px;${dimmed ? 'opacity:0.55;' : ''}">
        <input type="checkbox" id="${id}" ${value ? 'checked' : ''} /> ${escapeHtmlAttr(label)}
      </label>
    `;
    mount.querySelector(`#${id}`)?.addEventListener('change', (e) => this.commitField(comp, field.path, e.target.checked));
  }

  renderSelectField(comp, field, mount) {
    const label = this.humanizeFieldLabel(field.path);
    const id = this.fieldDomId(field.path);
    const { value, dimmed } = this.resolveEffectiveValue(comp, field);
    const rawOptions = field.optionsRef === 'VALUE_FORMATS' ? REGISTRY_VALUE_FORMATS : (field.options || []);
    const optionHtml = rawOptions.map((opt) => {
      const optVal = (opt && typeof opt === 'object') ? opt.value : opt;
      const optLabel = (opt && typeof opt === 'object') ? opt.label : String(opt);
      const icon = field.optionIcons?.[optVal];
      const selected = value === optVal ? 'selected' : '';
      return `<option value="${escapeHtmlAttr(optVal)}" ${selected}>${icon ? `${icon} ` : ''}${escapeHtmlAttr(optLabel)}</option>`;
    }).join('');
    mount.innerHTML = `
      <label title="${escapeHtmlAttr(field.tooltip || '')}">${escapeHtmlAttr(label)}</label>
      <select id="${id}" class="prop-select" style="${dimmed ? 'opacity:0.55;' : ''}">${optionHtml}</select>
    `;
    mount.querySelector(`#${id}`)?.addEventListener('change', (e) => {
      // Options are always rendered from string/number literals above (never
      // user text), so a numeric-typed option (e.g. style.typography.weight's
      // [400,500,600,700]) needs coercing back from the <select>'s own
      // always-string e.target.value.
      const original = rawOptions.find((opt) => String((opt && typeof opt === 'object') ? opt.value : opt) === e.target.value);
      const coerced = (original && typeof original === 'object') ? original.value : original;
      this.commitField(comp, field.path, coerced);
    });
  }

  renderColorField(comp, field, mount) {
    const label = this.humanizeFieldLabel(field.path);
    const id = this.fieldDomId(field.path);
    const { value, dimmed } = this.resolveEffectiveValue(comp, field);
    mount.innerHTML = `
      <label title="${escapeHtmlAttr(field.tooltip || '')}">${escapeHtmlAttr(label)}</label>
      <div class="color-picker-wrap">
        <input type="color" id="${id}-pick" value="${this.toHexColor(value) || '#000000'}" />
        <input type="text" id="${id}" class="prop-input" style="${dimmed ? 'opacity:0.55;' : ''}" value="${escapeHtmlAttr(value || '')}" placeholder="${dimmed ? 'inherit' : ''}" />
      </div>
    `;
    this.wireColorPair(mount, `${id}-pick`, id, (v) => this.commitField(comp, field.path, v));
  }

  /**
   * Step 3 Part A (2026-09-04): registry-driven wrapper around the existing,
   * unmodified renderRowListEditor() (used directly by core.gauge's still-hand-coded
   * arc.bands, and by this wrapper for everything else). Reads `field.rowSpec.fields`
   * — the per-field "row spec" the registry previously had no way to declare, so every
   * hand-coded call site built its own — filters columns by their own optional
   * `showWhen` (e.g. core.selector's Angle column, lever-mode-only), and always commits
   * via commitField(comp, field.path, nextList), which already handles both top-level
   * paths (positions/zones/detents, this pass) and nested ones (arc.bands, Part B)
   * identically — no commitOverride hack needed for new callers.
   */
  renderRowListField(comp, field, mount) {
    const rows = this.getFieldValue(comp, field.path) || [];
    const visibleFields = (field.rowSpec?.fields || []).filter((f) => !f.showWhen || this.evaluateShowWhen(comp, f.showWhen));
    this.renderRowListEditor(mount, comp, field.path, rows, {
      title: this.humanizeFieldLabel(field.path),
      hint: field.tooltip,
      fields: visibleFields,
      commitOverride: (nextList) => this.commitField(comp, field.path, nextList)
    });
  }

  /** Step 3 Part A: plain <select> from this widget's state[] vars, mirroring the 3 existing hand-coded instances of this exact pattern. */
  renderStateVarField(comp, field, mount) {
    const label = this.humanizeFieldLabel(field.path);
    const id = this.fieldDomId(field.path);
    const value = this.getFieldValue(comp, field.path) ?? field.default;
    const stateVars = this.state.widgetDef.state || [];
    mount.innerHTML = `
      <label title="${escapeHtmlAttr(field.tooltip || '')}">${escapeHtmlAttr(label)}</label>
      <select id="${id}" class="prop-select">
        <option value="" ${!value ? 'selected' : ''}>— none —</option>
        ${stateVars.map((s) => `<option value="${escapeHtmlAttr(s.name)}" ${value === s.name ? 'selected' : ''}>${escapeHtmlAttr(s.name)} (${escapeHtmlAttr(s.type)})</option>`).join('')}
      </select>
    `;
    mount.querySelector(`#${id}`)?.addEventListener('change', (e) => this.commitField(comp, field.path, e.target.value || undefined));
  }

  /** Step 3 Part A: plain <select> from this widget's assets[], mirroring the existing core.image hand-coded select. */
  renderAssetField(comp, field, mount) {
    const label = this.humanizeFieldLabel(field.path);
    const id = this.fieldDomId(field.path);
    const { value, dimmed } = this.resolveEffectiveValue(comp, field);
    const assets = this.state.widgetDef.assets || [];
    mount.innerHTML = `
      <label title="${escapeHtmlAttr(field.tooltip || '')}">${escapeHtmlAttr(label)}</label>
      <select id="${id}" class="prop-select" style="${dimmed ? 'opacity:0.55;' : ''}">
        <option value="" ${!value ? 'selected' : ''}>None</option>
        ${assets.map((a) => `<option value="${escapeHtmlAttr(a.id)}" ${value === a.id ? 'selected' : ''}>${escapeHtmlAttr(a.id)} (${escapeHtmlAttr(a.mimeType)})</option>`).join('')}
      </select>
    `;
    mount.querySelector(`#${id}`)?.addEventListener('change', (e) => this.commitField(comp, field.path, e.target.value || undefined));
  }

  /**
   * Step 3 Part B (2026-09-04): registry-driven wrapper around the existing,
   * unmodified-in-shape renderRangeEditor() (extended above with an optional
   * commitOverride). Serves both top-level ranges (props.valueRange) and nested ones
   * (props.compose.valueRange) identically via commitField — the same "commitField
   * already handles nested paths generically" pattern renderRowListField already uses,
   * which is what let renderComposeRange's byte-for-byte duplicate be deleted.
   */
  renderRangeField(comp, field, mount) {
    const currentRange = this.getFieldValue(comp, field.path) || [0, 1];
    this.renderRangeEditor(
      mount, comp, field.path, currentRange,
      this.humanizeFieldLabel(field.path), field.tooltip,
      (next) => this.commitField(comp, field.path, next)
    );
  }

  /**
   * Step 3 Part B: props.pivot is an {x, y} object (GaugeComponent.js:91's
   * `${pivot.x} ${pivot.y}` transform-origin), not a plain string — the one field shape
   * in the registry that needs its own dedicated two-input renderer rather than fitting
   * an existing primitive.
   */
  renderPivotField(comp, field, mount) {
    const label = this.humanizeFieldLabel(field.path);
    const id = this.fieldDomId(field.path);
    const pivot = this.getFieldValue(comp, field.path) || {};
    const x = pivot.x ?? '50%';
    const y = pivot.y ?? '50%';
    mount.innerHTML = `
      <label title="${escapeHtmlAttr(field.tooltip || '')}">${escapeHtmlAttr(label)}</label>
      <div class="prop-row-2">
        <input type="text" id="${id}-x" class="prop-input" value="${escapeHtmlAttr(x)}" placeholder="X e.g. 50%" />
        <input type="text" id="${id}-y" class="prop-input" value="${escapeHtmlAttr(y)}" placeholder="Y e.g. 50%" />
      </div>
    `;
    const apply = () => {
      const nx = mount.querySelector(`#${id}-x`)?.value.trim() || '50%';
      const ny = mount.querySelector(`#${id}-y`)?.value.trim() || '50%';
      this.commitField(comp, field.path, { x: nx, y: ny });
    };
    mount.querySelector(`#${id}-x`)?.addEventListener('change', apply);
    mount.querySelector(`#${id}-y`)?.addEventListener('change', apply);
  }

  updateCompProp(comp, propKey, value) {
    const nextProps = { ...(comp.props || {}), [propKey]: value };
    this.state.updateComponent(comp.id, { props: nextProps });
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

    // FDWS v1.23: interaction.condition — single-leaf {state, op, value} UI only
    // (same scope decision as style.rules' Conditional Formatting rows above: a
    // leaf condition covers the target use cases, a hand-authored compound
    // allOf/anyOf isn't offered here). Best-effort seed from an existing compound
    // condition's first sub-clause so re-editing a hand-authored one doesn't just
    // silently drop it into nothing.
    const CONDITION_OPS = ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'between'];
    const seedCond = existing?.condition?.allOf?.[0] || existing?.condition?.anyOf?.[0] || existing?.condition || null;
    const condition = seedCond
      ? { state: seedCond.state || '', op: CONDITION_OPS.find((o) => seedCond[o] !== undefined) || 'notEquals', value: (() => { const op = CONDITION_OPS.find((o) => seedCond[o] !== undefined); return op ? (op === 'between' ? (seedCond.between || []).join(',') : seedCond[op]) : ''; })() }
      : { state: '', op: 'notEquals', value: '' };
    // V14: set when "Use This Component's Own Value" is picked for the
    // condition's state — the syncFrom var isn't created until Submit (this
    // modal's commit is deferred), unlike the two condition editors that
    // commit immediately on every change.
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

        // FDWS v1.23: condition row (Only Run If)
        const conditionToggle = card.querySelector('#im-condition-on');
        const conditionMount = card.querySelector('#im-condition-row');
        const stateVars = this.state.widgetDef.state || [];

        const renderConditionRow = () => {
          const isCustomState = !ownValueSimVar && !!condition.state && !stateVars.some((s) => s.name === condition.state);
          conditionMount.innerHTML = `
            <div class="row-field-grid">
              <div style="display:flex;flex-direction:column;gap:4px;min-width:0;">
                <select class="prop-select cond-state">
                  ${conditionStateOptionsHtml(stateVars, condition.state, !!ownValueSimVar, comp.binding?.readSimVar)}
                </select>
                <input type="text" class="prop-input cond-state-custom ${isCustomState ? '' : 'hidden'}" value="${isCustomState ? condition.state : ''}" placeholder="e.g. presets[0].freq" />
                ${ownValueSimVar ? `<div class="prop-hint-block" style="font-size:10px;opacity:0.7;">Will create/reuse state var "${escapeHtmlAttr(condition.state)}" on Save.</div>` : ''}
              </div>
              <select class="prop-select cond-op">
                ${CONDITION_OPS.map((op) => `<option value="${op}" ${condition.op === op ? 'selected' : ''}>${op}</option>`).join('')}
              </select>
              <input type="text" class="prop-input cond-val" value="${condition.op === 'between' ? condition.value : condition.value}" placeholder="${condition.op === 'between' ? 'lo,hi' : 'value'}" />
            </div>
          `;
          conditionMount.querySelector('.cond-state')?.addEventListener('change', (e) => {
            if (e.target.value === OWN_VALUE_OPTION) {
              const simVar = comp.binding?.readSimVar;
              if (!simVar) return;
              ownValueSimVar = simVar;
              condition.state = this.state.resolveSyncFromVarName(simVar);
              renderConditionRow();
              return;
            }
            ownValueSimVar = null;
            condition.state = e.target.value === CUSTOM_OPTION_VALUE ? '' : e.target.value;
            conditionMount.querySelector('.cond-state-custom')?.classList.toggle('hidden', e.target.value !== CUSTOM_OPTION_VALUE);
          });
          conditionMount.querySelector('.cond-state-custom')?.addEventListener('change', (e) => { condition.state = e.target.value.trim(); ownValueSimVar = null; });
          conditionMount.querySelector('.cond-op')?.addEventListener('change', (e) => { condition.op = e.target.value; renderConditionRow(); });
          conditionMount.querySelector('.cond-val')?.addEventListener('change', (e) => { condition.value = e.target.value; });
        };
        renderConditionRow();

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

        // FDWS v1.23: interaction.condition — omitted entirely unless the
        // author actually enabled it AND gave it a state var, matching every
        // other optional-field pattern in this form (empty/unchecked means
        // "not declared", not "declared as always-false").
        let conditionObj;
        if (card.querySelector('#im-condition-on')?.checked && condition.state) {
          conditionObj = { state: condition.state };
          if (condition.op === 'between') {
            const [lo, hi] = String(condition.value).split(',').map((s) => Number(s.trim()));
            conditionObj.between = [lo || 0, hi || 0];
          } else if (['gt', 'gte', 'lt', 'lte'].includes(condition.op)) {
            conditionObj[condition.op] = Number(condition.value) || 0;
          } else {
            conditionObj[condition.op] = condition.value;
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
  async openConnectDialog(comp, def, kind) {
    const isWrite = kind === 'write';
    const bindingField = isWrite ? 'writeEvent' : 'readSimVar';
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
        ${rows || '<div class="caps-empty">No matches in this widget\'s Deck Events catalogue.</div>'}
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

  // --- Widget Studio 2.0, Phase 6: collapsed-group summary badges ---
  // Deliberately plain, short, scannable strings — not full sentences — since
  // they sit inline in a section header next to the chevron.

  buildLayoutBadge(comp) {
    const layout = comp.layout || {};
    const parts = [`${layout.w ?? '?'}×${layout.h ?? '?'} @ (${layout.col ?? '?'},${layout.row ?? '?'})`];
    if (comp.layer?.group) parts.push(comp.layer.group);
    if (comp.layer?.pointerEvents === 'none') parts.push('pass-through');
    return parts.join(' · ');
  }

  buildAppearanceBadge(comp) {
    const style = comp.style || {};
    const ruleCount = style.rules?.length || 0;
    if (ruleCount > 0) return `${ruleCount} conditional rule${ruleCount === 1 ? '' : 's'}`;
    const customized = !!(style.typography || style.border || style.background || style.align || style.offset || style.orientation);
    return customized ? 'Customized' : 'Default';
  }

  buildDataBadge(comp) {
    const binding = comp.binding || {};
    if (binding.readSimVar && binding.writeEvent) return `↔ ${binding.readSimVar}`;
    if (binding.readSimVar) return `→ ${binding.readSimVar}`;
    if (binding.writeEvent) return `⇄ ${binding.writeEvent}`;
    if (binding.stateVar) return `state: ${binding.stateVar}`;
    if (binding.stateRef) return `state: ${binding.stateRef}`;
    return 'Not bound';
  }

  buildBehaviorBadge(comp) {
    const count = comp.interactions?.length || 0;
    const parts = [`${count} interaction${count === 1 ? '' : 's'}`];
    if (comp.visibleWhen) parts.push('conditional visibility');
    if (comp.layout?.guard) parts.push('guarded');
    return parts.join(' · ');
  }

  /**
   * @param {string} badge — optional plain-text summary shown in the header,
   * visible whether the group is expanded or collapsed (e.g. "3 interactions",
   * "→ nav1ActFreq"). Widget Studio 2.0, Phase 6: previously every collapsed
   * group told you nothing about what it held — a power user had to expand
   * each of a component's 8 sections just to see if anything was set. Purely
   * a summary string computed by the caller (see buildLayoutBadge() and
   * siblings below) — not tied to PropertyRegistry field iteration, since
   * most of these sections still hand-build their markup rather than walking
   * the registry (see the file-header comment on why that's deliberate here).
   */
  buildAccordionGroup(title, isOpenDefault, renderFn, badge) {
    // Only seed from isOpenDefault the first time this title is ever seen;
    // afterwards, the user's own expand/collapse choice (tracked in
    // this.expandedGroups) wins on every re-render.
    if (!this.knownGroupTitles.has(title)) {
      this.knownGroupTitles.add(title);
      if (isOpenDefault) this.expandedGroups.add(title);
    }
    const isOpen = this.expandedGroups.has(title);
    const isTierOverridden = this.tierOverrideGroups.has(title);

    const group = document.createElement('div');
    group.className = `inspector-group${isTierOverridden ? ' tier-override' : ''}`;

    const header = document.createElement('div');
    header.className = 'inspector-group-header';
    header.innerHTML = `
      <span class="group-title-cluster">
        <span class="group-title">${title}</span>
        ${badge ? `<span class="group-badge">${badge}</span>` : ''}
      </span>
      <svg class="group-chevron ${isOpen ? 'open' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
    `;

    const body = document.createElement('div');
    body.className = `inspector-group-body ${isOpen ? 'open' : 'collapsed'}`;

    renderFn(body);
    // Part 2's "⋯ N more" badge is NOT injected here — see
    // applyTierMoreBadges(). APPEARANCE and DATA & CONTENT (below, in
    // renderComponentInspector()) build their accordion shell with an EMPTY
    // renderFn and populate .inspector-group-body separately afterward, so
    // counting hidden fields synchronously at this point would see an empty
    // body for those two sections and always undercount to zero. The badge
    // pass instead runs once, after the ENTIRE panel (every section, however
    // it populates itself) has finished rendering — same timing requirement
    // applyUiMode() already has, and called right alongside it.

    header.addEventListener('click', () => {
      const nowOpen = !body.classList.contains('open');
      body.classList.toggle('open', nowOpen);
      body.classList.toggle('collapsed', !nowOpen);
      header.querySelector('.group-chevron')?.classList.toggle('open', nowOpen);
      if (nowOpen) this.expandedGroups.add(title);
      else this.expandedGroups.delete(title);
    });

    group.appendChild(header);
    group.appendChild(body);
    return group;
  }
}
