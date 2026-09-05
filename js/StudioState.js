/**
 * StudioState.js
 * Central Reactive State Manager for Flight Deck Widget Studio
 */

import { STUDIO_TEMPLATES } from './StudioTemplates.js';
import { StudioValidator } from './StudioValidator.js';
import { DECK_EVENTS } from '../core/deckEvents.js';
import { themeAdjustColor, themeAdjustGradient } from '../widgets/components/ThemeColor.js';
import { FDWS_VERSIONS } from '../widgets/PropertyRegistry.js';

const LATEST_FDWS_VERSION = FDWS_VERSIONS[FDWS_VERSIONS.length - 1];

/**
 * Seed a plausible default value for a canonical Deck Event so the Sim Bench
 * has something sane to show before a user pokes it, inferred from the
 * event's name/category rather than a hand-maintained per-key table (which
 * is what silently went stale pre-v1.4 Deck Events unification).
 */
function inferDeckEventDefault(evt) {
  const n = evt.name;
  if (n === 'xpndrCode') return '1200';
  if (/BugValue$/.test(n)) {
    if (n === 'apHdgBugValue') return 360;
    if (n === 'apAltBugValue') return 10000;
    if (n === 'apIasBugValue') return 250;
    return 0;
  }
  if (/Level$/.test(n)) return 50;
  if (/Freq$/.test(n)) return n.startsWith('nav') ? '108.00' : '118.000';
  if (/State$/.test(n) || /ModeState$/.test(n)) return n === 'apFdState' || n === 'apAltModeState' ? 1 : 0;
  return 0;
}

function buildDefaultSimTelemetry() {
  const telem = {};
  DECK_EVENTS.filter((e) => e.kind === 'read').forEach((evt) => {
    telem[evt.name] = inferDeckEventDefault(evt);
  });
  // Non-canonical example vars kept for widgets/templates that intentionally
  // use host-defined custom logical names (FDWS v1.4 §1.2) rather than the
  // Deck Events default list — e.g. the Master Caution & Warning template.
  Object.assign(telem, {
    master_warning: 1,
    master_caution: 0,
    pitot_heat: 0,
    anti_ice: 0,
    gear: 1,
    flaps: 0
  });
  return telem;
}

// A device profile's portrait/landscape entries model one physical screen
// rotated 90° -- columns/rows are an exact swap (e.g. 20x44 <-> 44x20) and
// BOTH orientations share one constant cell pixel size (rowHeight == column
// width, same value in portrait and landscape). This is what keeps a
// widget's rendered proportions and physical size identical regardless of
// device-view orientation: a widget declared W columns x H rows always
// occupies the exact same W*cellSize x H*cellSize px, in either orientation.
//
// columns/rows for 'compact' and 'tablet_desktop' MUST still match
// flight-deck-pwa/js/core/LayoutEngine.js's getGridSpec(orientation, tier)
// exactly -- that's what makes "how many columns/rows will my widget
// occupy" accurate to the real runtime. The real runtime's rowHeight is
// NOT replicated pixel-for-pixel here (it legitimately differs 16px/18px
// between orientations there, since it's a fluid responsive layout, not a
// fixed physical device) -- this simulator instead picks one constant cell
// size per tier so the preview never visually distorts a widget on rotate.
//
// width/height (the frame's outer mock chrome size) are derived FROM the
// grid's pixel size plus the fixed chrome overhead in studio.css
// (.device-frame border, 38px topbar, 2px separator, 6px page-area
// padding) -- see StudioDeviceView.js's render(), which lays the grid out
// at exactly columns*cellSize + (columns-1)*gap px, so the declared
// width/height here must stay in sync with that formula and the tier's
// border-width (12px default, 16px for .frame-tablet_desktop).
// Widget Studio 2.0, Phase 4: the original 4-profile picker (compact +
// mobile_std/tablet_std/tablet_pro) is gone — those three never corresponded
// to anything the real PWA rendered (LayoutEngine.getGridSpec() was
// compact-only, tier-blind). The PWA now has real multi-tier grid support
// (app.js's LayoutEngine.getDeviceTier() + Page.js's per-tier grid specs),
// and these two profiles were already narrowed down to match its actual two
// tiers exactly — mobile (viewport short axis < 600px) and tablet/desktop
// (>= 600px). What was still wrong, found while re-auditing this decision:
// rowHeight had drifted out of sync with LayoutEngine.js's own TIER_GRIDS for
// three of the four orientation/tier combinations (only mobile portrait's 16
// still matched) — mobile landscape and both tablet orientations were all
// using stale numbers. columns/rows/gap were already exactly right; only
// rowHeight needed correcting, to LayoutEngine.js's actual values:
// mobile 16/18 (portrait/landscape), tablet 16/18 (portrait/landscape).
export const DEVICE_PROFILES = {
  compact: {
    id: 'compact',
    name: 'Mobile',
    description: 'Real runtime grid — mobile tier (viewport short axis < 600px)',
    portrait: { columns: 20, rows: 44, rowHeight: 16, gap: 3, width: 413, height: 909 },
    landscape: { columns: 44, rows: 20, rowHeight: 18, gap: 3, width: 869, height: 453 }
  },
  tablet_desktop: {
    id: 'tablet_desktop',
    name: 'Tablet / Desktop',
    description: 'Real runtime grid — tablet/desktop tier (viewport short axis >= 600px)',
    portrait: { columns: 60, rows: 88, rowHeight: 16, gap: 3, width: 1001, height: 1489 },
    landscape: { columns: 88, rows: 60, rowHeight: 18, gap: 3, width: 1449, height: 1041 }
  }
};

/**
 * Wave 0a (V17): a session-local token identifying THIS in-memory editing
 * session, independent of whatever `id` the widget currently claims. Two
 * different blank widgets both still carrying the default
 * `com.flightdeck.customwidget` id get two different tokens, so
 * saveCurrentWidgetToLibrary() can tell "I'm re-saving the widget I've been
 * editing" apart from "a DIFFERENT widget happens to share this id" — the
 * exact ambiguity that let two unrenamed widgets silently overwrite each
 * other.
 */
function randomInstanceId() {
  return `ed_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class StudioState {
  constructor() {
    this.listeners = new Set();

    // Default to NAV1 template
    this.widgetDef = JSON.parse(JSON.stringify(STUDIO_TEMPLATES[0]));
    StudioValidator.syncCapabilities(this.widgetDef);
    this.editorInstanceId = randomInstanceId();

    // Wave 0a (Part 6.4): set by restoreSession() below when an autosaved
    // draft is found, instead of restoring it silently. StudioApp renders a
    // dismissible banner off this — see keepRestoredSession()/
    // discardRestoredSession().
    this.restoredSessionInfo = null;

    // 0.4-B: the single parsed result from the bottom-bar SimVar Tester.
    // Lives on state rather than being threaded through as a dependency so
    // both the tester (writer) and the Property Inspector's Paste buttons
    // (readers) reach it without knowing about each other. `null` until
    // something has been parsed.
    this.testerParsed = null;

    this.selectedComponentId = null;
    this.hoveredComponentId = null;
    this.selectedLayerGroupId = null;
    // Multi-select for canvas align/distribute tooling — selectedComponentId
    // stays the "primary"/most-recently-clicked member (what the Inspector
    // shows single-component detail for); this set additionally tracks every
    // co-selected component when shift-clicking on the canvas.
    this.multiSelectedIds = new Set();
    // UI-only "hidden in editor" sets — Design-canvas visibility only, never
    // serialized into widgetDef (saveCurrentWidgetToLibrary()/exportWidgetFile()
    // both JSON-clone widgetDef itself, never sibling StudioState fields, so
    // these can never leak into a save/export). Device View and export always
    // show everything regardless of what's hidden here.
    this.hiddenInEditorIds = new Set();
    this.hiddenLayerGroupIds = new Set();

    // Viewport & Modes
    this.viewportMode = 'edit'; // 'edit' | 'device'
    this.zoom = 1.0; // granular, clamped [0.1, 3.0] — see StudioCanvas's zoom buttons
    this.showGrid = true;
    this.showOutlines = true;
    this.allowOverlap = true; // FDWS v1.1 free-stacking layering mode
    // Live theme-preview toggle: shows what BaseComponent.applyStyles()'s
    // role-tagged light-mode color derivation will do to THIS widget's authored
    // colors, without touching the widget definition itself. One flag drives
    // Design mode, Interactive Sim mode, and Device View, so toggling it
    // anywhere stays in sync everywhere (see StudioCanvas's canvas-header-bar
    // button, the only place it's currently exposed).
    this.previewTheme = 'dark'; // 'dark' | 'light'

    // Device View Settings
    this.activeDeviceId = 'compact';
    this.deviceOrientation = 'portrait'; // 'portrait' | 'landscape'
    this.devicePlacement = { col: 2, row: 4 };

    // Left Sidebar active tab
    this.leftTab = 'layers'; // 'layers' | 'palette' | 'state' | 'assets' | 'templates'

    // Live values of declared state[] vars while interacting with the widget in
    // Device View (MockWidgetHost.js's onLocalStateChange callback feeds this) —
    // purely a State-tab display aid, never persisted, reseeded to defaults on
    // WIDGET_DEF_LOADED / whenever Device View (re)constructs its mock host.
    this.liveStateValues = new Map();

    // Telemetry Test Bench State — seeded from the canonical Deck Events list
    // (see buildDefaultSimTelemetry above) plus a handful of non-canonical
    // example vars for custom-logical-name testing.
    this.simTelemetry = buildDefaultSimTelemetry();

    // Widget Studio 2.0, Phase 3: one-slot style clipboard (session-only, not
    // persisted) — copy one component's full `style` object, paste it onto
    // another, or onto every multi-selected component at once.
    this.copiedStyle = null;

    // Undo / Redo Stacks
    this.undoStack = [];
    this.redoStack = [];
    this.maxHistory = 40;
    this.isDirty = false;

    // LocalStorage library of saved widgets
    this.savedWidgets = this.loadSavedWidgets();

    // Wave 4, Part 8: most-recently-opened widgets/popovers (by id, saved-library
    // entries only — see touchRecentWidget), for the menu bar's Recent quick-switch.
    this.recentWidgets = this.loadRecentWidgets();

    // Check if previous session exists in localStorage
    this.restoreSession();
  }

  /** 0.4-B: bottom-bar tester -> Property Inspector paste buttons. */
  setTesterParsed(parsed) {
    this.testerParsed = parsed;
    this.notify('TESTER_PARSED');
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  notify(changeType = 'GENERAL', payload = {}) {
    this.listeners.forEach((listener) => {
      try {
        listener(changeType, payload, this);
      } catch (err) {
        console.error('[StudioState] Listener error:', err);
      }
    });
  }

  saveHistory(label = 'Edit') {
    const snapshot = JSON.stringify(this.widgetDef);
    if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1].snapshot === snapshot) {
      return;
    }
    this.undoStack.push({ snapshot, label, timestamp: Date.now() });
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.isDirty = true;
    this.persistSession();
  }

  undo() {
    if (this.undoStack.length === 0) return false;
    const currentSnapshot = JSON.stringify(this.widgetDef);
    this.redoStack.push({ snapshot: currentSnapshot, label: 'Undo step' });
    const prev = this.undoStack.pop();
    this.widgetDef = JSON.parse(prev.snapshot);
    StudioValidator.syncCapabilities(this.widgetDef);
    this.notify('HISTORY_CHANGE', { action: 'undo' });
    this.persistSession();
    return true;
  }

  redo() {
    if (this.redoStack.length === 0) return false;
    const currentSnapshot = JSON.stringify(this.widgetDef);
    this.undoStack.push({ snapshot: currentSnapshot, label: 'Redo step' });
    const next = this.redoStack.pop();
    this.widgetDef = JSON.parse(next.snapshot);
    StudioValidator.syncCapabilities(this.widgetDef);
    this.notify('HISTORY_CHANGE', { action: 'redo' });
    this.persistSession();
    return true;
  }

  setWidgetDef(newDef, recordHistory = true, historyLabel = 'Load Widget') {
    if (recordHistory) {
      this.saveHistory(historyLabel);
    }
    this.editorInstanceId = randomInstanceId();
    // Whatever restoredSessionInfo described no longer matches what's about
    // to be loaded (New/Import/etc.) — the restore banner's Keep/Discard
    // decision is moot once the author has moved on to a different widget.
    this.restoredSessionInfo = null;
    this.widgetDef = JSON.parse(JSON.stringify(newDef));
    if (!this.widgetDef.fdws) this.widgetDef.fdws = '1.2';
    if (!this.widgetDef.schemaVersion) this.widgetDef.schemaVersion = '1.2.0';
    if (!this.widgetDef.layerGroups) this.widgetDef.layerGroups = [];
    if (!this.widgetDef.state) this.widgetDef.state = [];
    if (!this.widgetDef.components) this.widgetDef.components = [];
    if (!this.widgetDef.assets) this.widgetDef.assets = [];

    StudioValidator.syncCapabilities(this.widgetDef);
    this.selectedComponentId = null;
    this.selectedLayerGroupId = null;
    this.hiddenInEditorIds = new Set();
    this.hiddenLayerGroupIds = new Set();
    this.liveStateValues = new Map();
    // Wave 4, Part 8: only touch Recent for a def that already has a stable
    // library identity (opened from Templates/Recent itself) — a brand-new
    // New/New Popover/built-in-template/Import draft has nothing to switch
    // back to until it's actually saved (see saveCurrentWidgetToLibrary below).
    if (this.savedWidgets.some((w) => w.id === this.widgetDef.id)) {
      this.touchRecentWidget(this.widgetDef);
    }
    this.notify('WIDGET_DEF_LOADED', { widgetDef: this.widgetDef });
    this.persistSession();
  }

  /**
   * Editor-only visibility — Design canvas rendering skips these, nothing else
   * does. See the constructor comment above `hiddenInEditorIds`.
   */
  toggleComponentHiddenInEditor(id) {
    if (this.hiddenInEditorIds.has(id)) this.hiddenInEditorIds.delete(id);
    else this.hiddenInEditorIds.add(id);
    this.notify('EDITOR_VISIBILITY_CHANGED', { componentId: id });
  }

  toggleLayerGroupHiddenInEditor(groupId) {
    if (this.hiddenLayerGroupIds.has(groupId)) this.hiddenLayerGroupIds.delete(groupId);
    else this.hiddenLayerGroupIds.add(groupId);
    this.notify('EDITOR_VISIBILITY_CHANGED', { groupId });
  }

  /**
   * Device View's draggable widget-slot position. Was called by the Col/Row
   * number inputs (StudioDeviceView.js) without ever being defined — every
   * edit there has been throwing since that UI shipped.
   */
  setDevicePlacement(col, row) {
    this.devicePlacement = { col, row };
    this.notify('DEVICE_PLACEMENT_CHANGED', { devicePlacement: this.devicePlacement });
  }

  /**
   * State-tab live-value display — see the constructor comment above
   * `liveStateValues`. Not history/persistence — purely a UI read-out.
   */
  setLiveStateValue(name, value) {
    // Device View reseeds every declared var's current value on every render
    // (SIM_TELEMETRY_UPDATED alone can fire quite often) — skip the notify
    // when nothing actually changed so that doesn't thrash the State tab's
    // own re-render on every single frame.
    if (this.liveStateValues.has(name) && this.liveStateValues.get(name) === value) return;
    this.liveStateValues.set(name, value);
    this.notify('LIVE_STATE_VALUE_CHANGED', { name, value });
  }

  updateWidgetMeta(metaUpdates) {
    this.saveHistory('Update Widget Meta');
    this.widgetDef.meta = { ...this.widgetDef.meta, ...metaUpdates };
    if (metaUpdates.id) this.widgetDef.id = metaUpdates.id;
    if (metaUpdates.revision !== undefined) this.widgetDef.revision = metaUpdates.revision;
    this.notify('WIDGET_META_UPDATED', { meta: this.widgetDef.meta });
  }

  /**
   * FDWS v1.27: `deckEvents` is a TOP-LEVEL field, not part of `meta`.
   * updateWidgetMeta() spreads everything it is given into widgetDef.meta and
   * lifts only id/revision out, so routing deck events through it silently
   * buried them at meta.deckEvents where nothing reads them — the validators
   * and the panel all passed while the field went nowhere. Its own setter,
   * so the destination is unambiguous.
   * @param {Array|undefined} events omit/undefined to clear the field entirely
   */
  setDeckEvents(events) {
    this.saveHistory('Update Deck Events');
    if (events && events.length) this.widgetDef.deckEvents = events;
    else delete this.widgetDef.deckEvents;
    this.notify('WIDGET_META_UPDATED', { deckEvents: this.widgetDef.deckEvents });
  }

  updateWidgetLayout(layoutUpdates) {
    this.saveHistory('Update Widget Layout');
    this.widgetDef.layout = { ...this.widgetDef.layout, ...layoutUpdates };
    if (layoutUpdates.grid) {
      this.widgetDef.layout.grid = { ...this.widgetDef.layout.grid, ...layoutUpdates.grid };
    }
    this.notify('WIDGET_LAYOUT_UPDATED', { layout: this.widgetDef.layout });
  }

  updateWidgetStyle(styleUpdates) {
    this.saveHistory('Update Widget Style');
    this.widgetDef.style = { ...(this.widgetDef.style || {}), ...styleUpdates };
    this.notify('WIDGET_STYLE_UPDATED', { style: this.widgetDef.style });
  }

  /**
   * Wave 4, §10.4: raw, unvalidated write-back for a top-level def key this
   * build's registry doesn't recognise (see StudioValidator.findUnrecognisedDefPaths).
   * Only ever called with a single top-level key — unrecognised-property
   * detection is deliberately shallow at the widget-root level.
   * @param {string} key
   * @param {*} value
   */
  updateWidgetRawField(key, value) {
    this.saveHistory('Edit Unrecognised Property');
    this.widgetDef[key] = value;
    this.notify('WIDGET_META_UPDATED', {});
  }

  /**
   * FDWS v1.18: sets the widget's baseTheme ('dark'|'light') and/or themeMode
   * ('auto'|'manual'). Flipping themeMode auto -> manual seeds every
   * component's (and the widget root's) style.themeOverride with whatever
   * would currently be auto-derived for the non-base theme — an editable
   * starting point instead of a blank one, so "I like the auto light theme
   * except this one input's text color" only requires changing that one
   * field. Fields that already carry a manual override are left untouched
   * (re-flipping auto -> manual -> auto -> manual shouldn't clobber edits).
   * @param {{baseTheme?: 'dark'|'light', themeMode?: 'auto'|'manual'}} updates
   */
  updateWidgetThemeConfig(updates) {
    this.saveHistory('Update Widget Theme Config');
    const prevMode = this.widgetDef.themeMode === 'manual' ? 'manual' : 'auto';
    if (updates.baseTheme !== undefined) this.widgetDef.baseTheme = updates.baseTheme;
    if (updates.themeMode !== undefined) this.widgetDef.themeMode = updates.themeMode;

    const nowManual = this.widgetDef.themeMode === 'manual';
    if (nowManual && prevMode !== 'manual') {
      this.seedThemeOverrides();
    }
    this.notify('WIDGET_META_UPDATED', {});
  }

  /**
   * The auto-derivation-as-starting-point prefill described on
   * updateWidgetThemeConfig() above. renderTheme is always "the OTHER theme"
   * (baseTheme flipped) — that's the only theme an override can ever apply
   * to (the base theme's style.* IS the authored value).
   */
  seedThemeOverrides() {
    const baseTheme = this.widgetDef.baseTheme === 'light' ? 'light' : 'dark';
    const otherTheme = baseTheme === 'light' ? 'dark' : 'light';

    const seedOne = (style, ctx) => {
      if (!style) return style;
      const existing = style.themeOverride || {};
      const next = { ...existing };
      if (style.typography?.color && existing.typography?.color === undefined) {
        const derived = themeAdjustColor(style.typography.color, { ...ctx, colorKind: 'typography' }, otherTheme, baseTheme);
        next.typography = { ...(existing.typography || {}), color: derived };
      }
      if (style.border?.color && existing.border?.color === undefined) {
        const derived = themeAdjustColor(style.border.color, { ...ctx, colorKind: 'border' }, otherTheme, baseTheme);
        next.border = { ...(existing.border || {}), color: derived };
      }
      if (style.background && existing.background === undefined) {
        if (style.background.type === 'color' && style.background.color) {
          next.background = { type: 'color', color: themeAdjustColor(style.background.color, { ...ctx, colorKind: 'background' }, otherTheme, baseTheme) };
        } else if (style.background.type === 'gradient' && style.background.gradient) {
          next.background = { type: 'gradient', gradient: themeAdjustGradient(style.background.gradient, ctx, otherTheme, baseTheme) };
        }
      }
      return { ...style, themeOverride: next };
    };

    this.widgetDef.style = seedOne(this.widgetDef.style || {}, { componentType: 'widget-root', layerGroup: 'background' });
    this.widgetDef.components = (this.widgetDef.components || []).map((comp) => ({
      ...comp,
      style: seedOne(comp.style || {}, { componentType: comp.type, layerGroup: comp.layer?.group })
    }));
  }

  /**
   * @param {string} id
   * @param {boolean} additive - true for a shift-click: toggles `id` in the
   *   multi-selection instead of replacing it entirely.
   */
  selectComponent(id, additive = false) {
    if (!additive) {
      this.multiSelectedIds = new Set(id ? [id] : []);
      if (this.selectedComponentId === id) return;
      this.selectedComponentId = id;
      this.selectedLayerGroupId = null;
      this.notify('SELECTION_CHANGED', { selectedComponentId: id });
      return;
    }

    if (this.multiSelectedIds.has(id)) {
      this.multiSelectedIds.delete(id);
    } else {
      this.multiSelectedIds.add(id);
    }
    // Primary selection follows the last-touched member so the Inspector
    // always shows something sensible; falls back to any remaining member.
    this.selectedComponentId = this.multiSelectedIds.has(id) ? id : ([...this.multiSelectedIds][0] || null);
    this.selectedLayerGroupId = null;
    this.notify('SELECTION_CHANGED', { selectedComponentId: this.selectedComponentId });
  }

  selectLayerGroup(groupId) {
    this.selectedLayerGroupId = groupId;
    this.selectedComponentId = null;
    this.multiSelectedIds = new Set();
    this.notify('LAYER_GROUP_SELECTED', { groupId });
  }

  clearSelection() {
    this.selectedComponentId = null;
    this.selectedLayerGroupId = null;
    this.multiSelectedIds = new Set();
    this.notify('SELECTION_CHANGED', { selectedComponentId: null });
  }

  /**
   * Aligns/distributes every currently multi-selected component's grid
   * layout (col/row/w/h are already grid-quantized, so this stays exact —
   * no pixel math). Requires 2+ selected; no-ops otherwise. One undo step
   * for the whole batch, not per-component.
   * @param {'left'|'right'|'top'|'bottom'|'centerX'|'centerY'|'distributeH'|'distributeV'|'stackPivot'} mode
   */
  applyAlignment(mode) {
    const ids = [...this.multiSelectedIds];
    if (ids.length < 2) return;
    const comps = ids.map((id) => this.getComponent(id)).filter(Boolean);
    if (comps.length < 2) return;

    this.saveHistory(`Align (${mode})`);

    if (mode === 'left') {
      const minCol = Math.min(...comps.map((c) => c.layout.col));
      comps.forEach((c) => { c.layout.col = minCol; });
    } else if (mode === 'right') {
      const maxRight = Math.max(...comps.map((c) => c.layout.col + c.layout.w));
      comps.forEach((c) => { c.layout.col = maxRight - c.layout.w; });
    } else if (mode === 'top') {
      const minRow = Math.min(...comps.map((c) => c.layout.row));
      comps.forEach((c) => { c.layout.row = minRow; });
    } else if (mode === 'bottom') {
      const maxBottom = Math.max(...comps.map((c) => c.layout.row + c.layout.h));
      comps.forEach((c) => { c.layout.row = maxBottom - c.layout.h; });
    } else if (mode === 'centerX') {
      const midCol = comps.reduce((sum, c) => sum + (c.layout.col + c.layout.w / 2), 0) / comps.length;
      comps.forEach((c) => { c.layout.col = Math.round(midCol - c.layout.w / 2); });
    } else if (mode === 'centerY') {
      const midRow = comps.reduce((sum, c) => sum + (c.layout.row + c.layout.h / 2), 0) / comps.length;
      comps.forEach((c) => { c.layout.row = Math.round(midRow - c.layout.h / 2); });
    } else if (mode === 'distributeH') {
      const sorted = [...comps].sort((a, b) => a.layout.col - b.layout.col);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const span = (last.layout.col + last.layout.w) - first.layout.col;
      const totalW = sorted.reduce((sum, c) => sum + c.layout.w, 0);
      const gap = sorted.length > 1 ? (span - totalW) / (sorted.length - 1) : 0;
      let cursor = first.layout.col;
      sorted.forEach((c) => { c.layout.col = Math.round(cursor); cursor += c.layout.w + gap; });
    } else if (mode === 'distributeV') {
      const sorted = [...comps].sort((a, b) => a.layout.row - b.layout.row);
      const first = sorted[0];
      const last = sorted[sorted.length - 1];
      const span = (last.layout.row + last.layout.h) - first.layout.row;
      const totalH = sorted.reduce((sum, c) => sum + c.layout.h, 0);
      const gap = sorted.length > 1 ? (span - totalH) / (sorted.length - 1) : 0;
      let cursor = first.layout.row;
      sorted.forEach((c) => { c.layout.row = Math.round(cursor); cursor += c.layout.h + gap; });
    } else if (mode === 'stackPivot') {
      // FDWS v1.20: for a multi-layer instrument built from several
      // independently-rotating core.gauge components that must share one
      // exact visual center (e.g. an HSI's compass card + heading bug +
      // course needle) — hand-aligning col/row/w/h to overlap pixel-for-
      // pixel, then copying pivot to each one, was exactly the tedious
      // per-layer authoring step this initiative set out to remove. Copies
      // the first-selected component's layout box onto every other selected
      // component (so they occupy the identical grid cell), and — for any
      // selected core.gauge, when the anchor is also a core.gauge with a
      // pivot set — copies that pivot too. Non-gauge components in the
      // selection still get the layout match (useful for a static face
      // image sharing the same box) but are left alone otherwise.
      const anchor = comps[0];
      comps.slice(1).forEach((c) => {
        c.layout = { ...c.layout, col: anchor.layout.col, row: anchor.layout.row, w: anchor.layout.w, h: anchor.layout.h };
        if (c.type === 'core.gauge' && anchor.type === 'core.gauge' && anchor.props?.pivot) {
          c.props = { ...(c.props || {}), pivot: { ...anchor.props.pivot } };
        }
      });
    }

    StudioValidator.syncCapabilities(this.widgetDef);
    this.notify('WIDGET_LAYOUT_UPDATED', {});
  }

  /**
   * Widget Studio 2.0, Phase 3: applies the same style update to every
   * currently multi-selected component in one undo step — e.g. setting
   * Border Color once for 5 selected buttons instead of visiting each one's
   * own Inspector panel individually. No-ops below 2 selected (nothing
   * "bulk" about one).
   *
   * Each top-level key in `styleUpdates` (typography/border/background/...)
   * is merged ONE LEVEL DEEP into each component's OWN existing style.<key> —
   * not a wholesale replace. This matters because the bulk editor calls this
   * once per field the author touches (Border Width, then separately Corner
   * Radius, ...): a wholesale replace would make the second call's
   * `{border: {radius}}` silently erase the width the first call had just
   * set, since two different components could each already have their own,
   * different border values before either bulk edit ran.
   * @param {object} styleUpdates - e.g. { typography: { color: '#ff0000' } }
   */
  applyStyleToSelection(styleUpdates) {
    const ids = [...this.multiSelectedIds];
    if (ids.length < 2) return;
    const comps = ids.map((id) => this.getComponent(id)).filter(Boolean);
    if (comps.length < 2) return;

    this.saveHistory(`Bulk Style Edit (${comps.length} components)`);
    comps.forEach((c) => {
      const nextStyle = { ...(c.style || {}) };
      Object.entries(styleUpdates).forEach(([key, val]) => {
        nextStyle[key] = (val && typeof val === 'object' && !Array.isArray(val))
          ? { ...(nextStyle[key] || {}), ...val }
          : val;
      });
      c.style = nextStyle;
    });
    StudioValidator.syncCapabilities(this.widgetDef);
    this.notify('WIDGET_LAYOUT_UPDATED', {});
  }

  /**
   * Widget Studio 2.0, Phase 3: copies one component's full style object
   * (typography/border/background/align/offset/orientation — everything
   * BaseComponent.applyStyles() cascades) onto the session-only clipboard.
   * Deep-cloned so later edits to the source component can't retroactively
   * change what a subsequent paste applies.
   * @param {string} id
   */
  copyComponentStyle(id) {
    const comp = this.getComponent(id);
    if (!comp) return;
    this.copiedStyle = JSON.parse(JSON.stringify(comp.style || {}));
    this.notify('STYLE_CLIPBOARD_UPDATED', {});
  }

  /**
   * Pastes the clipboard style onto one component, wholesale-replacing its
   * existing style (unlike applyStyleToSelection's per-field merge — a
   * paste means "make this look exactly like the copied one," not "layer
   * one more field on top"). One undo step. No-ops if nothing's copied yet.
   * @param {string} id
   */
  pasteStyleToComponent(id) {
    if (!this.copiedStyle) return;
    this.updateComponent(id, { style: JSON.parse(JSON.stringify(this.copiedStyle)) }, true, 'Paste Style');
  }

  /**
   * Pastes the clipboard style onto every multi-selected component at once,
   * wholesale-replacing each one's existing style. One combined undo step.
   * No-ops below 2 selected or with nothing copied.
   */
  pasteStyleToSelection() {
    if (!this.copiedStyle) return;
    const ids = [...this.multiSelectedIds];
    if (ids.length < 2) return;
    const comps = ids.map((id) => this.getComponent(id)).filter(Boolean);
    if (comps.length < 2) return;

    this.saveHistory(`Paste Style (${comps.length} components)`);
    comps.forEach((c) => {
      c.style = JSON.parse(JSON.stringify(this.copiedStyle));
    });
    StudioValidator.syncCapabilities(this.widgetDef);
    this.notify('WIDGET_LAYOUT_UPDATED', {});
  }

  getComponent(id) {
    if (!id) return null;
    return this.widgetDef.components?.find((c) => c.id === id) || null;
  }

  updateComponent(id, updates, recordHistory = true, label = 'Update Component') {
    const comp = this.getComponent(id);
    if (!comp) return;

    if (recordHistory) {
      this.saveHistory(label);
    }

    Object.assign(comp, updates);
    StudioValidator.syncCapabilities(this.widgetDef);
    this.notify('COMPONENT_UPDATED', { componentId: id, component: comp });
  }

  addComponent(newComp, recordHistory = true) {
    if (recordHistory) {
      this.saveHistory(`Add ${newComp.type || 'Component'}`);
    }

    // Ensure unique ID
    let compId = newComp.id || `comp_${Date.now().toString(36).slice(-4)}`;
    let counter = 1;
    while (this.widgetDef.components.some((c) => c.id === compId)) {
      compId = `${newComp.id || 'comp'}_${counter++}`;
    }
    newComp.id = compId;

    if (!newComp.layout) {
      newComp.layout = { col: 1, row: 1, w: 4, h: 2 };
    }
    if (!newComp.layer) {
      newComp.layer = { z: 0, group: null, pointerEvents: 'auto', clipToBounds: false };
    }

    this.widgetDef.components.push(newComp);
    StudioValidator.syncCapabilities(this.widgetDef);
    this.selectedComponentId = newComp.id;
    this.notify('COMPONENT_ADDED', { component: newComp });
    return newComp;
  }

  deleteComponent(id) {
    const idx = this.widgetDef.components?.findIndex((c) => c.id === id);
    if (idx === -1 || idx === undefined) return;

    this.saveHistory('Delete Component');
    const removed = this.widgetDef.components.splice(idx, 1)[0];
    if (this.selectedComponentId === id) {
      this.selectedComponentId = null;
    }
    StudioValidator.syncCapabilities(this.widgetDef);
    this.notify('COMPONENT_DELETED', { componentId: id, component: removed });
  }

  /**
   * Widget Studio 2.0, Phase 3: deletes every currently multi-selected
   * component in one step — Delete/Backspace previously only ever removed
   * `selectedComponentId` (the primary/last-touched member), silently
   * leaving the rest of a multi-selection behind. One combined undo step,
   * same convention as applyAlignment(). No-ops below 1 selected (nothing to
   * do) — falls back to the single-delete id list either way, so this is
   * safe to call unconditionally from a Delete/Backspace handler regardless
   * of whether 1 or several components are selected.
   */
  deleteMultiSelection() {
    const ids = this.multiSelectedIds.size > 0
      ? [...this.multiSelectedIds]
      : (this.selectedComponentId ? [this.selectedComponentId] : []);
    if (ids.length === 0) return;

    this.saveHistory(ids.length > 1 ? `Delete ${ids.length} Components` : 'Delete Component');
    const idSet = new Set(ids);
    this.widgetDef.components = (this.widgetDef.components || []).filter((c) => !idSet.has(c.id));
    if (idSet.has(this.selectedComponentId)) this.selectedComponentId = null;
    this.multiSelectedIds = new Set();
    StudioValidator.syncCapabilities(this.widgetDef);
    this.notify('COMPONENT_DELETED', { componentIds: ids });
  }

  duplicateComponent(id) {
    const comp = this.getComponent(id);
    if (!comp) return null;

    this.saveHistory('Duplicate Component');
    const clone = JSON.parse(JSON.stringify(comp));
    clone.id = `${comp.id}_copy`;
    let counter = 2;
    while (this.widgetDef.components.some((c) => c.id === clone.id)) {
      clone.id = `${comp.id}_copy${counter++}`;
    }

    // Offset layout slightly if space allows
    const maxCols = this.widgetDef.layout?.grid?.columns || 12;
    const maxRows = this.widgetDef.layout?.grid?.rows || 6;
    if (clone.layout.col + 1 <= maxCols) clone.layout.col += 1;
    if (clone.layout.row + 1 <= maxRows) clone.layout.row += 1;

    this.widgetDef.components.push(clone);
    StudioValidator.syncCapabilities(this.widgetDef);
    this.selectedComponentId = clone.id;
    this.notify('COMPONENT_ADDED', { component: clone });
    return clone;
  }

  addLayerGroup(group) {
    this.saveHistory('Add Layer Group');
    if (!this.widgetDef.layerGroups) this.widgetDef.layerGroups = [];
    this.widgetDef.layerGroups.push(group);
    this.notify('LAYER_GROUPS_UPDATED', { layerGroups: this.widgetDef.layerGroups });
  }

  updateLayerGroup(groupId, updates) {
    const group = this.widgetDef.layerGroups?.find((g) => g.id === groupId);
    if (!group) return;
    this.saveHistory('Update Layer Group');
    Object.assign(group, updates);
    this.notify('LAYER_GROUPS_UPDATED', { layerGroups: this.widgetDef.layerGroups });
  }

  /**
   * Reorders layerGroups to match `orderedIds` (drag-and-drop in the Layers
   * tab) and reassigns each group's z to its new index × 100 — the same
   * spacing convention every built-in template already uses, so a reorder
   * always produces a sensible, predictable stacking order without the user
   * having to hand-tune numeric Z-offsets.
   * @param {string[]} orderedIds
   */
  reorderLayerGroups(orderedIds) {
    const groups = this.widgetDef.layerGroups || [];
    const byId = new Map(groups.map((g) => [g.id, g]));
    const reordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);
    if (reordered.length !== groups.length) return;

    this.saveHistory('Reorder Layer Groups');
    reordered.forEach((g, idx) => { g.z = idx * 100; });
    this.widgetDef.layerGroups = reordered;
    this.notify('LAYER_GROUPS_UPDATED', { layerGroups: this.widgetDef.layerGroups });
  }

  deleteLayerGroup(groupId) {
    if (!this.widgetDef.layerGroups) return;
    this.saveHistory('Delete Layer Group');
    this.widgetDef.layerGroups = this.widgetDef.layerGroups.filter((g) => g.id !== groupId);
    // Reset components referencing this group to null
    this.widgetDef.components.forEach((c) => {
      if (c.layer?.group === groupId) {
        c.layer.group = null;
      }
    });
    this.notify('LAYER_GROUPS_UPDATED', { layerGroups: this.widgetDef.layerGroups });
  }

  addStateVar(stateVar) {
    this.saveHistory('Add State Variable');
    if (!this.widgetDef.state) this.widgetDef.state = [];
    this.widgetDef.state.push(stateVar);
    this.notify('STATE_VARS_UPDATED', { state: this.widgetDef.state });
  }

  /**
   * V14: read-only — the name of a state[] var already `syncFrom`-ing this
   * simVar, or the name one WOULD get if created now (camelCased from the
   * simVar, de-duped against existing names). No mutation — safe to call on
   * every render, e.g. to preview "Use This Component's Own Value" before
   * it's picked.
   * @param {string} simVar
   * @returns {string}
   */
  resolveSyncFromVarName(simVar) {
    const existing = (this.widgetDef.state || []).find((s) => s.syncFrom === simVar);
    if (existing) return existing.name;
    const bare = simVar.replace(/^[ALHK]:/i, '').trim();
    const camel = bare.split(/[^a-zA-Z0-9]+/).filter(Boolean)
      .map((w, i) => (i === 0 ? w[0].toLowerCase() + w.slice(1) : w[0].toUpperCase() + w.slice(1).toLowerCase()))
      .join('') || 'ownValue';
    const taken = new Set((this.widgetDef.state || []).map((s) => s.name));
    let name = camel;
    let n = 2;
    while (taken.has(name)) name = `${camel}${n++}`;
    return name;
  }

  /**
   * V14: idempotently ensures a state[] var `syncFrom`-ing this simVar
   * exists — no-op if one already does. Deliberately does NOT call
   * saveHistory: callers bundle this with their own component update into
   * one undo step (same inline-saveHistory-then-direct-mutation pattern as
   * pasteStyleToSelection()). Defaults to a numeric var — the common case
   * for the threshold/gt/lt conditions this exists for; a wrong type is a
   * one-field fix in the State panel afterward, not something to infer here.
   * @param {string} simVar
   */
  ensureSyncFromVar(simVar) {
    if (!this.widgetDef.state) this.widgetDef.state = [];
    if (this.widgetDef.state.some((s) => s.syncFrom === simVar)) return;
    const name = this.resolveSyncFromVarName(simVar);
    this.widgetDef.state.push({ name, type: 'number', default: 0, syncFrom: simVar });
    this.notify('STATE_VARS_UPDATED', { state: this.widgetDef.state });
  }

  updateStateVar(name, updates) {
    const st = this.widgetDef.state?.find((s) => s.name === name);
    if (!st) return;
    this.saveHistory('Update State Variable');
    Object.assign(st, updates);
    this.notify('STATE_VARS_UPDATED', { state: this.widgetDef.state });
  }

  deleteStateVar(name) {
    if (!this.widgetDef.state) return;
    this.saveHistory('Delete State Variable');
    this.widgetDef.state = this.widgetDef.state.filter((s) => s.name !== name);
    this.notify('STATE_VARS_UPDATED', { state: this.widgetDef.state });
  }

  addAsset(asset) {
    this.saveHistory('Upload Asset');
    if (!this.widgetDef.assets) this.widgetDef.assets = [];
    this.widgetDef.assets.push(asset);
    this.notify('ASSETS_UPDATED', { assets: this.widgetDef.assets });
  }

  deleteAsset(assetId) {
    if (!this.widgetDef.assets) return;
    this.saveHistory('Delete Asset');
    this.widgetDef.assets = this.widgetDef.assets.filter((a) => a.id !== assetId);
    this.notify('ASSETS_UPDATED', { assets: this.widgetDef.assets });
  }

  setViewportMode(mode) {
    if (this.viewportMode === mode) return;
    this.viewportMode = mode;
    this.notify('VIEWPORT_MODE_CHANGED', { viewportMode: mode });
  }

  setPreviewTheme(theme) {
    if (this.previewTheme === theme) return;
    this.previewTheme = theme;
    this.notify('PREVIEW_THEME_CHANGED', { previewTheme: theme });
  }

  setZoom(zoomVal) {
    this.zoom = zoomVal;
    this.notify('ZOOM_CHANGED', { zoom: this.zoom });
  }

  setLeftTab(tab) {
    this.leftTab = tab;
    this.notify('LEFT_TAB_CHANGED', { leftTab: tab });
  }

  setDeviceProfile(deviceId) {
    this.activeDeviceId = deviceId;
    this.notify('DEVICE_CHANGED', { deviceId });
  }

  setDeviceOrientation(orientation) {
    this.deviceOrientation = orientation;
    this.notify('DEVICE_ORIENTATION_CHANGED', { orientation });
  }

  updateSimTelemetry(key, value) {
    this.simTelemetry[key] = value;
    this.notify('SIM_TELEMETRY_UPDATED', { key, value, telemetry: this.simTelemetry });
  }

  loadSavedWidgets() {
    try {
      const raw = localStorage.getItem('fdws_saved_widgets');
      const parsed = raw ? JSON.parse(raw) : [];
      // FDWS v1.3: normalize missing kind to 'widget' for entries saved before the
      // popover-kind field existed.
      return parsed.map((w) => (w.kind ? w : { ...w, kind: 'widget' }));
    } catch {
      return [];
    }
  }

  /**
   * FDWS v1.3: saved widgets filtered by kind ('widget' | 'popover'), used by the
   * saved-widgets gallery and the core.openWidgetPopover popoverWidgetId picker.
   * @param {'widget'|'popover'} kind
   * @returns {Array<object>}
   */
  getSavedWidgetsByKind(kind) {
    return this.loadSavedWidgets().filter((w) => (w.kind || 'widget') === kind);
  }

  /**
   * FDWS v1.3: resets the active editor to a blank kind:"popover" widget definition
   * — same shape as a normal widget (components/state/interactions), just tagged so
   * it's opened only via core.openWidgetPopover rather than placed on a page layout.
   */
  createNewPopoverWidget() {
    // Same fix as the blank widget template (StudioTemplates.js, 2026-08-29):
    // stamp whatever this build of Studio actually supports, not a fixed
    // version — a popover built with any field newer than v1.3 previously
    // still exported declaring "fdws": "1.3" forever.
    const blank = {
      fdws: LATEST_FDWS_VERSION,
      schemaVersion: `${LATEST_FDWS_VERSION}.0`,
      id: `com.flightdeck.custompopover${Date.now()}`,
      kind: 'popover',
      revision: 1,
      meta: { name: 'New Popover', category: 'Popovers', description: 'Custom FDWS popover widget' },
      layout: { defaultW: 8, defaultH: 4, grid: { columns: 12, rows: 6 } },
      layerGroups: [],
      state: [],
      components: [],
      capabilities: { readSimVars: [], writeEvents: [] }
    };
    this.setWidgetDef(blank, true, 'New Popover Widget');
  }

  /**
   * FDWS v1.19 §1.5: registers popover definitions embedded in an imported
   * widget's "popovers" array into the same local library createNewPopoverWidget/
   * saveCurrentWidgetToLibrary use, so the popoverWidgetId picker can find them
   * and a later export can re-bundle them — same treatment as if each had been
   * imported into Studio on its own.
   * @param {object[]} popovers
   */
  importEmbeddedPopovers(popovers) {
    if (!Array.isArray(popovers) || popovers.length === 0) return;
    const saved = this.loadSavedWidgets();
    popovers.forEach((p) => {
      const snapshot = { ...JSON.parse(JSON.stringify(p)), kind: 'popover' };
      const existingIdx = saved.findIndex((w) => w.id === snapshot.id);
      if (existingIdx >= 0) saved[existingIdx] = snapshot;
      else saved.push(snapshot);
    });
    try {
      localStorage.setItem('fdws_saved_widgets', JSON.stringify(saved));
      this.savedWidgets = saved;
      this.notify('SAVED_WIDGETS_UPDATED', { savedWidgets: saved });
    } catch (e) {
      console.error('[StudioState] Failed to save embedded popovers to localStorage:', e);
    }
  }

  /**
   * Wave 0a (V17): sync, no side effects — call before saving to find out
   * whether saveCurrentWidgetToLibrary() is about to silently overwrite a
   * DIFFERENT widget that happens to share this id (as opposed to a normal
   * re-save of the widget already being edited, which is always safe).
   * @returns {null|{existingName: string, existingRevision: number}}
   */
  getSaveCollision() {
    const saved = this.loadSavedWidgets();
    const existing = saved.find((w) => w.id === this.widgetDef.id);
    if (!existing) return null;
    if (existing.__editorInstanceId === this.editorInstanceId) return null;
    return {
      existingName: existing.meta?.name || existing.id,
      existingRevision: existing.revision || 1
    };
  }

  saveCurrentWidgetToLibrary() {
    this.widgetDef.revision = (this.widgetDef.revision || 1) + 1;
    StudioValidator.syncCapabilities(this.widgetDef);

    const saved = this.loadSavedWidgets();
    const existingIdx = saved.findIndex((w) => w.id === this.widgetDef.id);
    // __editorInstanceId is stamped onto the LIBRARY snapshot only, never onto
    // this.widgetDef itself — export always serializes this.widgetDef
    // directly, so it can never leak into a .fdwidget/JSON export.
    const widgetSnapshot = { ...JSON.parse(JSON.stringify(this.widgetDef)), __editorInstanceId: this.editorInstanceId };

    if (existingIdx >= 0) {
      saved[existingIdx] = widgetSnapshot;
    } else {
      saved.push(widgetSnapshot);
    }

    try {
      localStorage.setItem('fdws_saved_widgets', JSON.stringify(saved));
      this.savedWidgets = saved;
      this.isDirty = false;
      // Wave 4, Part 8: a freshly-saved widget/popover appears in Recent right
      // away — the common "just built the popover, now switch back to the
      // host" moment shouldn't require re-opening it first.
      this.touchRecentWidget(this.widgetDef);
      this.notify('WIDGET_SAVED', { id: this.widgetDef.id });
      return true;
    } catch (e) {
      console.error('[StudioState] Failed to save widget to localStorage:', e);
      return false;
    }
  }

  /**
   * Wave 0a (V17): the "Save as new ID" branch of the collision prompt —
   * repoints the current widget at a fresh id before saving, so the
   * colliding library entry is left untouched.
   * @param {string} newId
   */
  saveCurrentWidgetToLibraryAsNewId(newId) {
    this.widgetDef.id = newId;
    return this.saveCurrentWidgetToLibrary();
  }

  deleteSavedWidget(id) {
    const saved = this.loadSavedWidgets().filter((w) => w.id !== id);
    try {
      localStorage.setItem('fdws_saved_widgets', JSON.stringify(saved));
      this.savedWidgets = saved;
      this.notify('SAVED_WIDGETS_UPDATED', { savedWidgets: saved });
    } catch (e) {
      console.error('[StudioState] Failed to delete saved widget:', e);
    }
    // Wave 4, Part 8: don't leave a dead Recent entry pointing at a widget
    // that no longer exists — same "no fake affordance" precedent as
    // Part 2's "N more" badges and Part 5a's Test-tab hand-off button.
    if (this.recentWidgets.some((r) => r.id === id)) {
      this.recentWidgets = this.recentWidgets.filter((r) => r.id !== id);
      this.persistRecentWidgets();
    }
  }

  loadRecentWidgets() {
    try {
      const raw = localStorage.getItem('fdws_recent_widgets');
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  }

  persistRecentWidgets() {
    try {
      localStorage.setItem('fdws_recent_widgets', JSON.stringify(this.recentWidgets));
    } catch {
      // Ignore quota error, same as persistSession()
    }
    this.notify('RECENT_WIDGETS_UPDATED', { recentWidgets: this.recentWidgets });
  }

  /**
   * Wave 4, Part 8: record `def` as the most-recently-opened widget/popover, for
   * the menu bar's Recent quick-switch. Only ever called with a def that already
   * has a stable saved-library identity — see the two call sites (setWidgetDef,
   * saveCurrentWidgetToLibrary).
   * @param {object} def
   */
  touchRecentWidget(def) {
    if (!def?.id) return;
    const entry = {
      id: def.id,
      name: def.meta?.name || def.id,
      kind: def.kind === 'popover' ? 'popover' : 'widget'
    };
    this.recentWidgets = [entry, ...this.recentWidgets.filter((r) => r.id !== entry.id)].slice(0, 8);
    this.persistRecentWidgets();
  }

  persistSession() {
    try {
      localStorage.setItem('fdws_current_session', JSON.stringify({ savedAt: Date.now(), widgetDef: this.widgetDef }));
    } catch {
      // Ignore quota error
    }
  }

  /**
   * Wave 0a (Part 6.4): restores an autosaved draft same as before, but no
   * longer silently — a "restored an abandoned draft" banner (StudioApp.js)
   * is the whole point; a silent restore was flagged as a new trap in the
   * opposite direction (reappearing work the author thought they'd walked
   * away from). Sets restoredSessionInfo instead of just applying the def;
   * keepRestoredSession()/discardRestoredSession() resolve it.
   */
  restoreSession() {
    try {
      const raw = localStorage.getItem('fdws_current_session');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      // Back-compat: a session stored before this change is a bare widgetDef
      // (no savedAt wrapper) — still restore it once, just with no timestamp.
      const isWrapped = parsed && typeof parsed === 'object' && parsed.widgetDef;
      const def = isWrapped ? parsed.widgetDef : parsed;
      const savedAt = isWrapped ? parsed.savedAt : null;
      if (def && def.id && def.components) {
        this.widgetDef = def;
        StudioValidator.syncCapabilities(this.widgetDef);
        this.restoredSessionInfo = { name: def.meta?.name || def.id, id: def.id, savedAt };
      }
    } catch {
      // Ignore parse errors
    }
  }

  /** Wave 0a: dismiss the restore banner, keeping the restored draft as-is. */
  keepRestoredSession() {
    this.restoredSessionInfo = null;
    this.notify('GENERAL');
  }

  /**
   * Wave 0a: dismiss the restore banner AND discard the draft — resets to
   * the same default the constructor would have loaded had there been
   * nothing to restore.
   */
  discardRestoredSession() {
    this.restoredSessionInfo = null;
    try {
      localStorage.removeItem('fdws_current_session');
    } catch {
      // Ignore
    }
    this.widgetDef = JSON.parse(JSON.stringify(STUDIO_TEMPLATES[0]));
    this.editorInstanceId = randomInstanceId();
    StudioValidator.syncCapabilities(this.widgetDef);
    this.selectedComponentId = null;
    this.selectedLayerGroupId = null;
    this.notify('WIDGET_DEF_LOADED', { widgetDef: this.widgetDef });
  }
}
