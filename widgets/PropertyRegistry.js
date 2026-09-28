/**
 * PropertyRegistry.js
 * Widget Studio 2.0, Phase 0 — the single declaration of every editable FDWS field,
 * interaction trigger, interaction action, and value format Widget Studio's Property
 * Inspector can author.
 *
 * WHY THIS FILE EXISTS: every prior "Studio doesn't expose X" bug (see
 * docs/CHANGELOG.md and this repo's own audit history) had the same root cause —
 * Widget Studio's inspector sections hand-list fields in their render functions, TRIGGERS/VALUE_FORMATS
 * were separate hardcoded arrays, and nothing checked either against what the runtime
 * (CompositeWidget.js / shared/widgets/components/*.js) actually reads. Four separate
 * instances of this were found and fixed by hand in one audit session (interaction
 * types, value formats, custom bindings, triggers) before this registry existed.
 *
 * Widget Studio's inspector/sections and FieldGroups.js render panels BY
 * WALKING THIS REGISTRY instead of hand-coding each field — so adding a field here is
 * the only step required to make it authorable, and scripts/check-registry-drift.mjs
 * can catch a field the registry forgot by diffing FIELDS' `path`s against a grep of
 * real runtime reads (the exact manual technique the original audit used, automated).
 *
 * This file is intentionally framework-agnostic (no DOM, no imports from Studio) so it
 * can also feed shared/SecurityValidator.js and widget-studio/js/StudioValidator.js —
 * see FDWS_VERSIONS below for how it already collapses one two-file gotcha into one.
 *
 * Lives under shared/widgets/ (not shared/widgets/components/) since it isn't a
 * component renderer and isn't part of the components/definitions sync — copy it into
 * each app's own tree the same way SecurityValidator.js etc. already are; see
 * scripts/sync-shared.mjs.
 */

// ---------------------------------------------------------------------------
// FDWS version enum — single source. shared/SecurityValidator.js's
// validateFDWSDefinition() and widget-studio/js/StudioValidator.js's validate()
// both import this instead of hardcoding their own copy of the enum, closing the
// "two files, easy to forget" gotcha recorded when v1.8 shipped capped at '1.7'
// in both places at once.
// ---------------------------------------------------------------------------
export const FDWS_VERSIONS = [
  '1.0', '1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '1.7', '1.8', '1.9', '1.10',
  '1.11', '1.12', '1.13', '1.14', '1.15', '1.16', '1.17', '1.18', '1.19', '1.20',
  '1.21', '1.22', '1.23', '1.24', '1.25', '1.26', '1.27', '1.28', '1.29',
  // v1.30: the Rotary rebuild. NON-ADDITIVE — core.rotary's props and trigger
  // vocabulary were replaced outright, not extended (see RotaryComponent.js's header).
  '1.30'
];

// ---------------------------------------------------------------------------
// Interaction triggers — consumed by InteractionsSection.js's trigger picker.
// `fires` documents which component types/mechanism actually dispatch it, since
// this exact gap (a real trigger missing from the dropdown) is how 'change'/
// 'focus'/'blur' were found missing, and 'hold'/'doubleTap'/'release' were found
// to never fire at all despite being listed.
//
// Wave 0b (V19): 15 triggers the runtime fires (grep handleInteraction( across
// shared/widgets/components/*.js) were live but had no row here at all — the
// Trigger dropdown could never offer them, so a stepper's increment/decrement,
// a rocker's zone press, a rotary's drag, a slider's detent, a selector/pad's
// position change, a list row tap and a pad's pan/zoom were all unauthorable
// in Studio despite firing correctly today. `componentTypes` (new) is what
// scripts/check-registry-drift.mjs and InteractionsSection.js's Trigger dropdown
// both key off — '*' means every component type (BaseComponent-level), a
// specific list means only those types actually dispatch it.
// ---------------------------------------------------------------------------
export const TRIGGERS = [
  { id: 'tap', fires: 'BaseComponent pointer handler — every component', live: true, componentTypes: ['*'] },
  { id: 'longpress', fires: 'BaseComponent pointer handler (500ms hold) — every component', live: true, componentTypes: ['*'] },
  { id: 'change', fires: 'InputComponent (native DOM listener) and SliderComponent (on commit)', live: true, componentTypes: ['core.input', 'core.slider'] },
  { id: 'focus', fires: 'core.input only — native DOM listener', live: true, componentTypes: ['core.input'] },
  { id: 'blur', fires: 'core.input only — native DOM listener', live: true, componentTypes: ['core.input'] },
  { id: 'guardOpen', fires: 'BaseComponent guard overlay — every component with a guard', live: true, componentTypes: ['*'] },
  { id: 'guardClose', fires: 'BaseComponent guard overlay — every component with a guard', live: true, componentTypes: ['*'] },
  { id: 'itemTap', fires: 'ListComponent — a row tap', live: true, componentTypes: ['core.list'] },
  { id: 'positionChange', fires: 'PadComponent (absolute mode only) and SelectorComponent', live: true, componentTypes: ['core.pad', 'core.selector'] },
  { id: 'zoomDelta', fires: 'PadComponent — pinch/zoom gesture', live: true, componentTypes: ['core.pad'] },
  { id: 'panDelta', fires: 'PadComponent — relative-mode drag (the default mode)', live: true, componentTypes: ['core.pad'] },
  { id: 'zoneActive', fires: 'RockerComponent — one zone pressed', live: true, componentTypes: ['core.rocker'] },
  { id: 'zoneReleased', fires: 'RockerComponent — a pressed zone released', live: true, componentTypes: ['core.rocker'] },
  // FDWS v1.30 (Rotary rebuild): the turn vocabulary replaces the deleted Rotary's
  // push/dragStart/fineChange/dragEnd outright — no aliases, per that rebuild's
  // ticket 02. Every payload carries a `value` key alongside delta/direction/ring, so
  // a core.dispatchEvent action works with no special case (the old fineChange
  // payload's key mismatch is why Studio-suggested wiring dispatched a literal zero).
  // Note a bound Rotary needs NO interaction wiring at all to drive the sim — it
  // writes binding.writeEvent itself (StudioValidator's
  // SELF_DISPATCHING_WRITE_EVENT_TYPES); these are for authoring anything EXTRA on top.
  { id: 'turnStart', fires: 'RotaryComponent — the knob is grabbed', live: true, componentTypes: ['core.rotary'] },
  { id: 'turn', fires: 'RotaryComponent — the knob moves (the knob’s defining interaction)', live: true, componentTypes: ['core.rotary'] },
  { id: 'turnEnd', fires: 'RotaryComponent — the knob is released', live: true, componentTypes: ['core.rotary'] },
  // Ticket 04 (Continuous/Detented ranges): pure notifications, never a write —
  // RotaryComponent.js's WRITE_TRIGGER_ALLOWLIST deliberately does not include
  // either. 'detent' fires when a Detented Ring's turn crosses into a new named
  // position; 'limit' fires when a Bounded or Detented Ring's turn reaches either
  // end (Continuous never fires it — it wraps instead of hitting a bound). A
  // Detented Ring with 2 or fewer positions never fires 'limit' — with only two
  // positions every index is always both bounds at once, so it would otherwise
  // fire identically to 'detent' on every single toggle; 'limit' is reserved for
  // rings with a real middle (3+ positions) where a bound is distinct from "the
  // other end".
  { id: 'detent', fires: 'RotaryComponent — a Detented Ring\'s turn crosses into a new named position', live: true, componentTypes: ['core.rotary'] },
  { id: 'limit', fires: 'RotaryComponent — a Bounded Ring\'s turn reaches either end, or a Detented Ring\'s with 3+ positions', live: true, componentTypes: ['core.rotary'] },
  { id: 'detentReached', fires: 'SliderComponent — commit lands on a declared detent', live: true, componentTypes: ['core.slider'] },
  { id: 'increment', fires: 'StepperComponent — + button', live: true, componentTypes: ['core.stepper'] },
  { id: 'decrement', fires: 'StepperComponent — − button', live: true, componentTypes: ['core.stepper'] },
  // Kept for backward compat with any widget already authored against them —
  // confirmed via repo-wide grep that nothing in shared/widgets/components/
  // ever dispatches these. Not removed from the list (an existing widget file
  // referencing one must still round-trip), but Phase 1's Inspector should
  // visually flag them as "never fires today" rather than presenting them as
  // equivalent options to the five above.
  { id: 'hold', fires: 'dead — no dispatcher wires this up', live: false, componentTypes: ['*'] },
  { id: 'doubleTap', fires: 'dead — no dispatcher wires this up', live: false, componentTypes: ['*'] },
  { id: 'release', fires: 'dead — no dispatcher wires this up', live: false, componentTypes: ['*'] }
];

// ---------------------------------------------------------------------------
// Interaction actions — replaces the Add Interaction modal's hand-coded
// dropdown + per-action field list in InteractionsSection.js. `params` drives that
// modal's form generation directly; `path` (the shared InteractionDispatcher.js
// switch case it maps to) is what scripts/check-registry-drift.mjs cross-checks.
// ---------------------------------------------------------------------------
export const ACTIONS = [
  {
    type: 'core.dispatchEvent',
    label: 'Dispatch Sim Event',
    tooltip: 'Sends a value to the simulator — the write half of a SimVar/K-event binding.',
    params: [
      { key: 'event', control: 'eventPicker', tooltip: 'Deck Event to dispatch. Falls back to this component’s own binding.writeEvent if left blank.' },
      { key: 'value', control: 'text', tooltip: 'Literal value to send. Leave blank to use the trigger’s own value (e.g. an input’s typed text).' },
      { key: 'fromStateRef', control: 'stateRefPicker', tier: 'advanced', tooltip: 'Read the value from local state instead — e.g. "presets[0].freq". Takes priority over Value when set.' }
    ]
  },
  {
    type: 'core.setLocalState',
    label: 'Set Local State',
    tooltip: 'Writes a value into this widget’s own local state (not the simulator) — for staging edits, toggles, and UI-only fields.',
    params: [
      { key: 'field', control: 'stateVarPicker', tooltip: 'Which declared state[] variable to write.' },
      { key: 'value', control: 'text', tooltip: 'Literal value to write. Leave blank to use the trigger’s own value.' },
      { key: 'fromStateRef', control: 'stateRefPicker', tier: 'advanced', tooltip: 'Read the value from local state instead — e.g. "presets[0].freq". Takes priority over Value when set.' }
    ]
  },
  {
    type: 'core.swapLocalState',
    label: 'Swap Local State',
    tooltip: 'Exchanges the values of two state variables in one step — e.g. an ACT/STBY swap button.',
    params: [
      { key: 'fields', control: 'stateVarPair', tooltip: 'The two state variables to swap.' }
    ]
  },
  {
    type: 'core.toggleLocalState',
    label: 'Toggle Local State',
    tooltip: 'Flips a boolean state variable — on/off, shown/hidden.',
    params: [
      { key: 'field', control: 'stateVarPicker', tooltip: 'Which boolean state[] variable to flip. Falls back to this component’s own binding.stateVar if left blank.' }
    ]
  },
  // FDWS v1.16: core.applyPresetToField removed (Widget Studio 2.0 Phase 5) —
  // every shipped widget that used it (sampleWidgets.js, StudioTemplates.js,
  // pc-bridge/widgets/com_flightdeck_com1com2radio.fdwidget) migrated to the
  // chained core.setLocalState + core.dispatchEvent pattern with fromStateRef
  // below; garmin-widgets' navradios.json/navpreseteditor.json and their
  // pc-bridge mirrors were stale/pre-Deck-Events remnants and were deleted
  // outright rather than migrated. See CHANGELOG.md's removal checklist.
  {
    type: 'core.ackIndicator',
    label: 'Acknowledge Indicator',
    tooltip: 'Silences/clears an annunciator — dispatches its ack event and forces the indicator to its off state.',
    params: [
      { key: 'event', control: 'eventPicker', tooltip: 'Ack event to dispatch. Falls back to the target indicator’s own binding.ackEvent if left blank.' }
    ]
  },
  {
    type: 'core.openPopover',
    label: 'Open Property Inspector (Studio-only)',
    tooltip: 'Opens Widget Studio’s own inspector panel for this widget instance. Not a real widget-authoring action — internal Studio affordance.',
    internal: true,
    params: []
  },
  {
    type: 'core.openWidgetPopover',
    label: 'Open Widget Popover',
    tooltip: 'Opens an author-designed popover widget in a modal, optionally feeding it a read-only $context snapshot from this widget’s state.',
    params: [
      { key: 'popoverWidgetId', control: 'popoverPicker', tooltip: 'ID of the popover-kind (kind:"popover") widget to open. FDWS v1.19+: bundled automatically into this widget\'s "popovers" array on export, so installing this one file installs the popover too.' },
      { key: 'context', control: 'contextMapBuilder', tier: 'advanced', tooltip: 'Maps this widget’s state paths into $context keys the popover can read.' }
    ]
  },
  {
    type: 'core.commitToHost',
    label: 'Commit to Host',
    tooltip: 'Popover-only: writes a value back to the host widget’s $context. Used by a popover’s Save button.',
    params: [
      { key: 'contextKey', control: 'text', tooltip: 'Which $context key (declared writable by the host) to write.' },
      { key: 'field', control: 'stateVarPicker', tier: 'advanced', tooltip: 'Commit a named local state field instead of the trigger’s own value — needed for a Save button, whose own tap carries no value.' }
    ]
  },
  {
    type: 'core.closePopover',
    label: 'Close Popover',
    tooltip: 'Popover-only: closes the popover modal. Used by Cancel/Save buttons.',
    params: []
  }
];

// ---------------------------------------------------------------------------
// Interaction-ROW fields — Widget Studio 2.0, Phase 0 (adjustment pass).
// ACTIONS[].params above describes each action's own payload (event, field,
// value…), but `interactions[].feedback` is a property of the interaction
// ROW itself — a sibling of `trigger`/`action`, independent of which action
// is chosen (FDWS v1.2 §4.1, CompositeWidget.js's playFeedback()). It has no
// natural home under any one action's params, so it gets its own small
// section instead of being bolted onto one. Already a fully working runtime
// feature (haptic vibration + an Asset Library sound) with zero Studio UI
// before this — added here as prep for that UI, not new runtime behavior.
// ---------------------------------------------------------------------------
export const INTERACTION_FIELDS = [
  { key: 'feedback.haptic', control: 'select', options: ['', 'light', 'medium', 'heavy'], tier: 'advanced', tooltip: 'Vibration pulse on devices that support it (most phones/tablets). Silently does nothing on devices that don’t — safe to leave set.' },
  { key: 'feedback.sound', control: 'assetPicker', tier: 'advanced', tooltip: 'Plays a sound from this widget’s Asset Library on this interaction — e.g. an authentic switch click. Leave unset for silence.' }
];

// ---------------------------------------------------------------------------
// core.input / core.display value formats — the actual list moved here
// verbatim from StudioValidator.VALUE_FORMATS (the prior single source), so
// the dropdown Inspector renders and the validator that checks against it can
// never drift apart again.
// ---------------------------------------------------------------------------
export const VALUE_FORMATS = [
  'RAW_TEXT', 'RAW_INT', 'DEGREE_3', 'ALTITUDE', 'SIGN_INT', 'FREQ_COM',
  'FREQ_NAV', 'HZ_INT', 'KHZ_INT', 'BCD_HEX', 'SQUAWK_CODE', 'FIXED_0',
  'FIXED_1', 'MACH', 'PERCENT', 'TEMP_C', 'TEMP_F', 'PRESSURE_INHG',
  'PRESSURE_HPA', 'VS_FPM', 'TIME_MMSS', 'TIME_HHMMSS', 'LATLON_DMS',
  'DECIMAL_N',
  // FDWS v1.15
  'COORD_DECIMAL', 'COMPASS_CARDINAL'
];

// Asset Library (Phase 2) upload gate — moved here verbatim from
// StudioValidator.ALLOWED_MIME_TYPES for the same single-source reason.
export const ALLOWED_ASSET_MIME_TYPES = [
  'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'
];

// ---------------------------------------------------------------------------
// Property fields — the Inspector's actual content. `common` fields apply to
// every component type (via BaseComponent.applyStyles()); `perType` fields are
// specific to one core.* type's own renderer.
//
// tier: 'simple' surfaces in both Simple and Advanced mode; 'advanced' only in
// Advanced. See docs/CHANGELOG.md and this repo's Widget Studio 2.0 plan for the
// Simple/Advanced split's rationale — tier is a judgment call on "would a
// first-time author need this to make a recognizable widget," not a measure of
// how obscure a field is.
//
// showWhen: the field is offered only while its condition passes. A condition is
// { path, equals }, { path, notEquals } or { path, equalsAny: [...] }, where an unset
// path counts as the `default` of the row it names. Binding rows may also use
// { all: [condition, ...] }, which passes only when every member passes, and a
// second key, `enabledWhen`, in the same grammar plus { path, rawAddress: true }
// (the value starts with A:, L:, H: or K:, case-insensitive): while it fails the
// field is shown but disabled. `all` and `enabledWhen` stay off every other row,
// because the Appearance section remaps a style row's showWhen.path and has no case
// for either (bindingRegistryRows.test.js pins this).
//
// label / placeholder: the editor's text for a row, where it differs from the
// humanized path. Only binding rows carry them today.
// ---------------------------------------------------------------------------

// Wave 1 (V23): `default` below is populated from the runtime's own fallback
// (grepped across shared/widgets/components/*.js — e.g. `orientation ?? 0`,
// `border.width > 0 ? (border.style || 'solid') : ...`) where one exists, and
// from each field's own tooltip where it states an explicit default (e.g.
// "Defaults to 6"). `undefined` is used, deliberately, wherever the runtime
// genuinely has no fallback — most color/text overrides simply do nothing
// when unset (CSS/stylesheet default applies), which IS their correct
// "default" rather than an unfilled placeholder. This is a prerequisite for
// Part 2's "a non-default value always shows" guarantee, not a behavior
// change on its own — nothing yet reads this key.
export const COMMON_FIELDS = [
  // --- Typography (style.typography.*) ---
  { path: 'style.typography.font', control: 'text', tier: 'advanced', group: 'Typography', default: undefined, tooltip: 'CSS font-family override. Leave blank to use the app’s default cockpit typeface.' },
  { path: 'style.typography.size', control: 'number', tier: 'simple', group: 'Typography', default: undefined, tooltip: 'Text size in pixels.' },
  { path: 'style.typography.weight', control: 'select', options: [400, 500, 600, 700], tier: 'simple', group: 'Typography', default: undefined, tooltip: 'Font weight — higher is bolder.' },
  { path: 'style.typography.color', control: 'color', tier: 'simple', guided: true, group: 'Typography', default: undefined, tooltip: 'Text color.' },
  { path: 'style.typography.stroke.width', control: 'number', tier: 'advanced', group: 'Typography', fdwsMin: '1.15', default: undefined, tooltip: 'Text outline thickness in pixels — keeps a readout legible over a busy background image without darkening the whole tile.' },
  { path: 'style.typography.stroke.color', control: 'color', tier: 'advanced', group: 'Typography', fdwsMin: '1.15', default: undefined, tooltip: 'Text outline color.' },
  { path: 'style.typography.glow.color', control: 'color', tier: 'advanced', group: 'Typography', fdwsMin: '1.15', default: undefined, tooltip: 'Soft glow color behind the text — LCD backlight bloom, annunciator glow. Leave unset for none.' },
  { path: 'style.typography.glow.blur', control: 'number', tier: 'advanced', group: 'Typography', fdwsMin: '1.15', default: 6, tooltip: 'Glow spread radius in pixels. Defaults to 6 if a glow color is set but this is left blank.' },

  // --- Orientation (FDWS v1.15) ---
  { path: 'style.orientation', control: 'select', options: [0, 90, 180, 270], tier: 'advanced', group: 'Layout', fdwsMin: '1.15', default: 0, tooltip: 'Rotates this component’s text — 90/270 set proper vertical typesetting for placards and rotary-style side labels; 180 is upside-down.' },

  // --- Border (style.border.*) ---
  { path: 'style.border.width', control: 'number', tier: 'simple', guided: true, group: 'Border', default: undefined, tooltip: 'Border thickness in pixels. 0 removes the border.' },
  { path: 'style.border.color', control: 'color', tier: 'simple', guided: true, group: 'Border', default: undefined, tooltip: 'Border color.' },
  { path: 'style.border.radius', control: 'number', tier: 'simple', group: 'Border', default: undefined, tooltip: 'Corner rounding in pixels.' },
  { path: 'style.border.style', control: 'select', options: ['solid', 'dashed', 'dotted'], tier: 'advanced', group: 'Border', fdwsMin: '1.17', default: 'solid', tooltip: 'Border line style. Defaults to solid. core.divider uses this same field for its line style.' },
  { path: 'style.border.glow.color', control: 'color', tier: 'advanced', group: 'Border', fdwsMin: '1.24', default: undefined, tooltip: 'Soft glow around the border — annunciator bloom, selected-state ring. Leave unset for none.' },
  { path: 'style.border.glow.blur', control: 'number', tier: 'advanced', group: 'Border', fdwsMin: '1.24', default: 6, tooltip: 'Glow spread radius in pixels. Defaults to 6 if a glow color is set but this is left blank.' },
  { path: 'style.border.glow.inset', control: 'checkbox', tier: 'advanced', group: 'Border', fdwsMin: '1.24', default: false, tooltip: 'Glows inward instead of outward — a highlighted-from-within look instead of a halo around the edge.' },

  // --- Background (style.background.*) — runtime already supports color/gradient/image
  // (BaseComponent.js §3); image support has NO Inspector field today, so it is a
  // Phase 1 registry-fill item, not a new FDWS version like Typography.stroke/orientation.
  { path: 'style.background.type', control: 'select', options: ['none', 'color', 'gradient', 'image'], tier: 'simple', group: 'Background', default: undefined, tooltip: 'What fills this component’s surface.' },
  { path: 'style.background.color', control: 'color', tier: 'simple', group: 'Background', default: undefined, tooltip: 'Fill color, when Background Type is Color.', showWhen: { path: 'style.background.type', equals: 'color' } },
  { path: 'style.background.gradient', control: 'text', tier: 'advanced', group: 'Background', default: undefined, tooltip: 'Raw CSS gradient (e.g. "linear-gradient(...)"), when Background Type is Gradient.', showWhen: { path: 'style.background.type', equals: 'gradient' } },
  { path: 'style.background.image.assetId', control: 'assetPicker', tier: 'simple', group: 'Background', default: undefined, tooltip: 'Image from this widget’s Asset Library to use as the background — e.g. a real switch face or bezel texture.', showWhen: { path: 'style.background.type', equals: 'image' } },

  // --- Theme Override (style.themeOverride.*) — FDWS v1.18. Only meaningful
  // when the widget's own themeMode is "manual" (see the widget-level Theme
  // group, hand-coded in WidgetSection.js like meta/layout/revision already
  // are — not registry-driven, same as those). Holds this component's literal
  // authored values for whichever theme ISN'T the widget's baseTheme; unset
  // fields keep auto-deriving from style.* even in manual mode.
  { path: 'style.themeOverride.typography.color', control: 'color', tier: 'advanced', group: 'Theme Override', fdwsMin: '1.18', default: undefined, tooltip: 'Manual text color for the non-base theme. Leave unset to keep auto-deriving it.' },
  { path: 'style.themeOverride.border.color', control: 'color', tier: 'advanced', group: 'Theme Override', fdwsMin: '1.18', default: undefined, tooltip: 'Manual border color for the non-base theme. Leave unset to keep auto-deriving it.' },
  { path: 'style.themeOverride.background.color', control: 'color', tier: 'advanced', group: 'Theme Override', fdwsMin: '1.18', default: undefined, tooltip: 'Manual fill color for the non-base theme, when Background Type is Color. Leave unset to keep auto-deriving it.' },
  { path: 'style.themeOverride.background.gradient', control: 'text', tier: 'advanced', group: 'Theme Override', fdwsMin: '1.18', default: undefined, tooltip: 'Manual CSS gradient for the non-base theme, when Background Type is Gradient. Leave unset to keep auto-deriving it.' },
  // FDWS v1.29: widens Theme Override coverage from the original 4 fields
  // above to the other three color-valued style fields that also get
  // auto-derived in the other direction (BaseComponent.js's applyStyles()).
  { path: 'style.themeOverride.typography.stroke.color', control: 'color', tier: 'advanced', group: 'Theme Override', fdwsMin: '1.29', default: undefined, tooltip: 'Manual text outline color for the non-base theme. Leave unset to keep auto-deriving it.' },
  { path: 'style.themeOverride.typography.glow.color', control: 'color', tier: 'advanced', group: 'Theme Override', fdwsMin: '1.29', default: undefined, tooltip: 'Manual text glow color for the non-base theme. Leave unset to keep auto-deriving it.' },
  { path: 'style.themeOverride.border.glow.color', control: 'color', tier: 'advanced', group: 'Theme Override', fdwsMin: '1.29', default: undefined, tooltip: 'Manual border glow color for the non-base theme. Leave unset to keep auto-deriving it.' },
  { path: 'style.background.image.fit', control: 'select', options: ['cover', 'contain', 'tile'], tier: 'advanced', group: 'Background', default: undefined, tooltip: 'How the image fills the surface: Cover crops to fill, Contain fits without cropping, Tile repeats it.', showWhen: { path: 'style.background.type', equals: 'image' } },
  { path: 'style.background.image.position', control: 'text', tier: 'advanced', group: 'Background', default: undefined, tooltip: 'CSS background-position (e.g. "center", "top left").', showWhen: { path: 'style.background.type', equals: 'image' } },

  // --- Conditional formatting (new, Phase 2) ---
  { path: 'style.rules', control: 'conditionalStyleBuilder', tier: 'advanced', group: 'Conditional Formatting', fdwsMin: '1.15', default: undefined, tooltip: 'Swap this component’s style when a condition is true — e.g. turn a readout red past a limit, amber approaching it, or swap which background image asset shows for a photorealistic multi-position switch. Reuses the same condition grammar as Visible When.' },

  // --- Alignment / offset (FDWS v1.8) ---
  { path: 'style.align.h', control: 'select', options: ['left', 'center', 'right'], tier: 'advanced', group: 'Layout', default: undefined, tooltip: 'Horizontal content alignment within this component.' },
  { path: 'style.align.v', control: 'select', options: ['top', 'center', 'bottom'], tier: 'advanced', group: 'Layout', default: undefined, tooltip: 'Vertical content alignment. No effect on core.input — use Offset Y instead.' },
  { path: 'style.offset.x', control: 'number', tier: 'advanced', group: 'Layout', default: 0, tooltip: 'Fine horizontal pixel nudge, on top of Align. Paint-only — doesn’t affect layout or tap targets.' },
  { path: 'style.offset.y', control: 'number', tier: 'advanced', group: 'Layout', default: 0, tooltip: 'Fine vertical pixel nudge, on top of Align. Paint-only — doesn’t affect layout or tap targets.' },

  // --- Per-state style overrides ---
  // FDWS v1.25: this field itself (and the runtime that reads it) predates
  // v1.25 -- core.button's toggle variant and core.indicator's severity
  // states already used it. AppearanceSection.js renders the live editor for
  // the state name selected by resolveStateStyleConfig. The generic field
  // engine defers this bespoke control to that section.
  { path: 'style.states', control: 'stateStyleEditor', tier: 'advanced', group: 'Layout', fdwsMin: '1.25', default: undefined, tooltip: 'Style overrides applied when this component enters a named state (e.g. "pressed", "active", "editState", "dragging") — merged over the base typography/border/background above, not a replacement for them. Which state name applies depends on component type; see the "State Style" section in Appearance for this component.' },

  // --- Visibility ---
  { path: 'visibleWhen', control: 'conditionBuilder', tier: 'advanced', group: 'Visibility', default: undefined, tooltip: 'Hides this component entirely unless a condition on state/telemetry is met.' },

  // --- Bindings (binding.*) — SIMVARS & BINDINGS panel ---
  // Declared in the order the panel shows them, under its three sub-headings: 'Read from
  // Simulator', 'Send to Simulator' and 'Local State'. WRITE_EVENT_BINDING_FIELDS below
  // inherits this order, and the PWA's bindings list shows write rows in it. `label` and
  // `placeholder` carry the panel's own text for each row.
  { path: 'binding.readSimVar', control: 'simVarPicker', tier: 'simple', guided: true, group: 'Read from Simulator', label: 'Read Deck Event (Telemetry In)', default: undefined, tooltip: 'SimVar this component displays. Updates live from the simulator.' },
  // PC Bridge owns the unit of a Deck Event, so Unit is editable only for a raw read address.
  { path: 'binding.unit', control: 'text', tier: 'advanced', group: 'Read from Simulator', label: 'SimConnect Unit', placeholder: 'Number', enabledWhen: { path: 'binding.readSimVar', rawAddress: true }, default: undefined, tooltip: 'Tells SimConnect what type to return the raw value as (e.g. degrees, knots, Bool, Number). Leave blank to use the host\'s default (\'Number\'). For a TEXT variable (TITLE, ATC MODEL, ATC ID) type \'string\' — those have no unit at all, and reading one as a number silently returns 0.' },
  { path: 'binding.pollFrequencyHz', control: 'select', options: [{ value: 1, label: 'Normal (1Hz)' }, { value: 100, label: 'Fast (~100Hz)' }], tier: 'simple', group: 'Read from Simulator', label: 'Poll Rate', default: 1, tooltip: 'FDWS v1.7: how often PC Bridge asks SimConnect for this value. Normal (1Hz) is right for almost everything — frequencies, switches, annunciators. Fast is for values that change continuously and need to look smooth, like an attitude indicator\'s pitch/bank — it routes this SimVar onto PC Bridge\'s fastest available SimConnect polling tier (in practice tens of Hz, tied to the sim\'s own update rate, not a literal guaranteed number). Every fast-tier binding reading the same SimVar should use the same setting.' },
  { path: 'binding.pollGroup', control: 'text', tier: 'advanced', group: 'Read from Simulator', fdwsMin: '1.26', label: 'Poll Group', placeholder: '(defaults to this widget\'s id)', default: undefined, tooltip: 'FDWS v1.26: which PC Bridge polling chunk this SimVar\'s data definition joins. Leave blank to default to this widget\'s own id — already groups all of this widget\'s own bindings together, away from unrelated widgets\' vars. Only set this to deliberately merge chunks across widgets, or split an unusually noisy var out of an otherwise-quiet widget.' },
  { path: 'binding.deadband', control: 'number', tier: 'advanced', group: 'Read from Simulator', label: 'Dead Band', default: 0, tooltip: 'Minimum change in value before this binding re-renders — filters out imperceptible jitter. 0 means every update renders.' },
  // `bespoke`: Widget Studio's Bindings panel hand-writes this {durationMs, easing}
  // object outside the generic field engine. `fields` mirrors `ACTIONS[].params`'
  // shape. `easing.default` is the value the Bindings panel preselects and writes;
  // the runtime's fallback for a stored transition without `easing` stays 'ease-out'.
  { path: 'binding.transition', control: 'bespoke', tier: 'advanced', group: 'Read from Simulator', label: 'Transition (ms)', default: undefined, tooltip: 'How long this binding\'s CSS transition eases toward a new value. Keep this short (well under the gap between updates) — a long transition against Fast-tier updates makes the display feel MORE sluggish, not less, since it ends up averaging across many stale intermediate values.', fields: [
    { key: 'durationMs', control: 'number', default: undefined, tooltip: 'Animation length in milliseconds. Leave blank for none.' },
    { key: 'easing', control: 'select', options: ['linear', 'ease-out', 'ease-in-out'], default: 'linear', tooltip: 'Animation curve.' }
  ] },
  // No Write Mode gate: a Pulse Rotary keeps Write Deck Event visible and editable, so
  // switching back to Absolute finds it intact.
  { path: 'binding.writeEvent', control: 'eventPicker', tier: 'simple', guided: true, group: 'Send to Simulator', label: 'Write Deck Event (SimConnect Out)', default: undefined, tooltip: 'Deck Event dispatched when this component is interacted with (a button tap, a slider drag, etc.).' },
  // Pulse write mode's own pair of write events, Rotary-only (a Ring in Pulse mode ignores
  // Write Deck Event above entirely — see RotaryComponent.js's writePulseStep()).
  { path: 'binding.incrementEvent', control: 'eventPicker', tier: 'simple', guided: true, group: 'Send to Simulator', appliesTo: ['core.rotary'], fdwsMin: '1.30', showWhen: { path: 'props.writeMode', equals: 'pulse' }, label: 'Increment Deck Event (Pulse Clockwise)', default: undefined, tooltip: 'FDWS v1.30: dispatched once per step turned clockwise, when Write Mode (Range panel) is set to Pulse. Only used in Pulse mode — Absolute mode uses Write Deck Event above instead.' },
  { path: 'binding.decrementEvent', control: 'eventPicker', tier: 'simple', guided: true, group: 'Send to Simulator', appliesTo: ['core.rotary'], fdwsMin: '1.30', showWhen: { path: 'props.writeMode', equals: 'pulse' }, label: 'Decrement Deck Event (Pulse Counter-Clockwise)', default: undefined, tooltip: 'FDWS v1.30: dispatched once per step turned counter-clockwise, when Write Mode (Range panel) is set to Pulse. Only used in Pulse mode — Absolute mode uses Write Deck Event above instead.' },
  // Acceleration's dedicated fast step events, Rotary-only. Sent instead of repeating the
  // ordinary pair above in the coarse tier, in Pulse write mode with Acceleration on.
  // They only take effect as a pair: see RotaryComponent.js's rotaryConfig().
  { path: 'binding.fastIncrementEvent', control: 'eventPicker', tier: 'advanced', group: 'Send to Simulator', appliesTo: ['core.rotary'], fdwsMin: '1.30', showWhen: { all: [{ path: 'props.writeMode', equals: 'pulse' }, { path: 'props.acceleration', equals: true }] }, label: 'Fast Increment Deck Event (Coarse Clockwise)', default: undefined, tooltip: 'FDWS v1.30: dispatched once per step turned clockwise in the coarse Acceleration tier, in place of the ordinary event above, when Write Mode is Pulse and Acceleration is on. Bind both fast events or neither: a single one is ignored.' },
  { path: 'binding.fastDecrementEvent', control: 'eventPicker', tier: 'advanced', group: 'Send to Simulator', appliesTo: ['core.rotary'], fdwsMin: '1.30', showWhen: { all: [{ path: 'props.writeMode', equals: 'pulse' }, { path: 'props.acceleration', equals: true }] }, label: 'Fast Decrement Deck Event (Coarse Counter-Clockwise)', default: undefined, tooltip: 'FDWS v1.30: dispatched once per step turned counter-clockwise in the coarse Acceleration tier, in place of the ordinary event above, when Write Mode is Pulse and Acceleration is on. Bind both fast events or neither: a single one is ignored.' },
  { path: 'binding.ackEvent', control: 'eventPicker', tier: 'advanced', group: 'Send to Simulator', label: 'Acknowledge Event', default: undefined, tooltip: 'Fired when this component\'s built-in acknowledge/silence action is used (e.g. core.indicator annunciator ack). Rarely needed outside annunciator-style components.' },
  { path: 'binding.pushEvent', control: 'eventPicker', tier: 'advanced', group: 'Send to Simulator', label: 'Push Event', default: undefined, tooltip: 'Optional extra write event this component declares. It makes the component write-capable and is registered with PC Bridge. No core component dispatches it; the native Rotary widget (not core.rotary) sends it with value 1 on a centre push. Leave it as None unless the component you are configuring documents one.' },
  { path: 'binding.eventCategory', control: 'text', tier: 'advanced', group: 'Send to Simulator', label: 'Event Category', default: 'K_EVENT', tooltip: 'SimConnect event category sent with this component\'s write events when they are registered with PC Bridge. It does not change how an event is dispatched. K_EVENT covers almost everything — only change this if a specific SimConnect event documents a different category.' },
  { path: 'binding.stateVar', control: 'stateVarPicker', tier: 'simple', group: 'Local State', label: 'Bound Local State Var', default: undefined, tooltip: 'Local state[] variable this component reads and re-renders on when it changes.' },
  { path: 'binding.stateRef', control: 'stateRefPicker', tier: 'advanced', group: 'Local State', label: 'Bind to Local State Path', placeholder: 'e.g. presets[0].label', default: undefined, tooltip: 'FDWS v1.11: unlike \'Bound Local State Var\' above (a whole top-level state[] var), this addresses a specific nested/indexed value inside one — e.g. presets[0].label to show one preset slot\'s label on a separate core.label above its button. Uses the same \'name[index].field\' path grammar as popover Context Map entries. Leave blank unless you need this — it\'s an alternative to the field above, not used together with it. FDWS v1.14: on core.button, this drives the button\'s own Primary Label reactively (falling back to the static Primary Label text in Props whenever the resolved value is empty) instead of being display-only on core.label/core.display.' },
  { path: 'binding.sublabelStateRef', control: 'stateRefPicker', tier: 'advanced', group: 'Local State', appliesTo: ['core.button'], label: 'Bind Sublabel to State Path', placeholder: 'e.g. presets[0].freq', default: undefined, tooltip: 'FDWS v1.14: same \'name[index].field\' grammar as the field above, but drives this button\'s Sublabel (Props panel) instead of its Primary Label — independent path, can point at a different state var entirely. Resolved value falls back to the static Sublabel text whenever empty.' }
];

// ---------------------------------------------------------------------------
// Write-event binding fields — single source, mirrors FDWS_VERSIONS above.
// Ticket 17: this used to be a hand-listed array duplicated in
// shared/widgetVarExtractor.js's walkBindingSites(), shared/SecurityValidator.js's
// sanitizer, and widget-studio/js/StudioValidator.js (two separate call sites) —
// the exact "update N files by hand" gotcha FDWS_VERSIONS already solved for the
// version enum, and it already cost a ticket a two-round review miss: ticket 05
// added binding.incrementEvent/decrementEvent, review round 1 caught
// SecurityValidator.js missing them, review round 2 caught widgetVarExtractor.js
// missing them too — the second miss meant a Pulse-only Rotary registered zero
// placeholder profile mappings on install, a silent failure.
//
// Derived from COMMON_FIELDS itself (every `binding.*` field whose control is
// 'eventPicker') instead of hand-listed a sixth time, so all four consumers
// automatically pick up a new write-event binding field the moment it's added
// to COMMON_FIELDS above, with no other edit required. Its order is the rows'
// declaration order (writeEvent, the Pulse pair, the fast pair, ackEvent,
// pushEvent), which the PWA's bindings list shows. Deliberately excludes:
//   - binding.readSimVar — a different control ('simVarPicker'), a read not a write.
//   - ACTIONS[].params' `event` keys (core.dispatchEvent, core.ackIndicator) —
//     interaction-site writes, not component bindings; none of their paths
//     start with 'binding.' at all.
//   - core.rocker's props.zones[].writeEvent — a different shape entirely
//     (per-zone, not binding.*), deliberately still hand-coded at its own two
//     call sites in walkBindingSites() and StudioValidator.js.
// ---------------------------------------------------------------------------
export const WRITE_EVENT_BINDING_FIELDS = COMMON_FIELDS
  .filter((f) => f.control === 'eventPicker' && f.path.startsWith('binding.'))
  .map((f) => f.path.slice('binding.'.length));

/**
 * Whether a Component ever sends the event stored in one of its write-event binding
 * fields. A Rotary in Pulse write mode sends binding.incrementEvent/decrementEvent one
 * step at a time and never sends binding.writeEvent, so a writeEvent left on it (kept so
 * switching back to Absolute finds it intact) is not a write the Widget makes and must
 * not be declared as one — in capabilities, or to PC Bridge's install-time registration.
 * The same holds for the fast step events, which only a Pulse Rotary with Acceleration
 * enabled ever sends. Every consumer of WRITE_EVENT_BINDING_FIELDS that turns a field
 * into a declared write asks this first, so the rule lives in one place.
 *
 * @param {{type?: string, props?: {writeMode?: string, acceleration?: boolean}}} comp - A component definition.
 * @param {string} field - One of WRITE_EVENT_BINDING_FIELDS.
 * @returns {boolean} false for writeEvent on a Pulse Rotary, and for a fast step event on a Rotary that is not Pulse with Acceleration on.
 */
export function isWriteEventFieldSent(comp, field) {
  if (comp?.type !== 'core.rotary') return true;
  if (field === 'writeEvent') return comp.props?.writeMode !== 'pulse';
  if (field === 'fastIncrementEvent' || field === 'fastDecrementEvent') {
    return comp.props?.writeMode === 'pulse' && comp.props?.acceleration === true;
  }
  return true;
}

export const TYPE_FIELDS = {
  'core.label': [
    { path: 'props.text', control: 'text', tier: 'simple', guided: true, group: 'Content', default: undefined, tooltip: 'Static label text, shown when nothing overrides it.' },
    { path: 'props.truncate', control: 'checkbox', tier: 'advanced', group: 'Content', default: false, tooltip: 'Cuts off overflowing text with an ellipsis instead of wrapping/overflowing.' },
    // Pre-v1.8, undocumented, horizontal-only alignment. Kept live (LabelComponent.js
    // only applies it when style.align.h is unset) and auto-migrated to style.align.h
    // the moment a label is opened in the Inspector — see COMMON_FIELDS above for the
    // real field. Not shown in either Inspector tier; exists here purely so
    // scripts/check-registry-drift.mjs doesn't flag it as a genuine gap.
    { path: 'props.align', control: null, deprecated: true, default: undefined, tooltip: 'Legacy horizontal-align fallback, superseded by style.align.h (FDWS v1.8). Auto-migrated on open, not user-editable.' }
  ],
  'core.display': [
    // Wave 1 gap-closing pass (2026-09-04): this field previously used
    // optionsRef:'VALUE_FORMATS', which resolves to the *shared* list — one that
    // deliberately excludes 'ODOMETER' (see the tooltip: core.input also reads
    // VALUE_FORMATS via the same optionsRef, and ODOMETER has no meaning as an input
    // mask). Converting this type onto the registry engine with the shared list as-is
    // would have silently dropped ODOMETER from the dropdown — a real regression, not
    // just a display gap. Fixed with a display-only literal `options:` array instead of
    // `optionsRef`, so core.input's own dropdown (which still uses optionsRef) is unaffected.
    { path: 'props.format', control: 'select', options: [...VALUE_FORMATS, 'ODOMETER'], tier: 'simple', guided: true, group: 'Content', default: 'RAW_INT', tooltip: 'How the raw value is formatted for display (e.g. FREQUENCY_COM shows "118.000"). "ODOMETER" (FDWS v1.20) is display-only — appended here rather than to the shared VALUE_FORMATS list, since it has no meaning as a core.input mask.' },
    // FDWS v1.20 §4: mechanical rolling-digit-drum readout — DisplayComponent.js
    // branches its whole render()/update() to renderOdometer()/setOdometerValue()
    // when props.format === 'ODOMETER', bypassing ValueFormatter entirely (a
    // digit-drum readout isn't a formatted string, it's a set of DOM elements).
    // Wave 1 gap-closing pass (2026-09-04): added showWhen to both fields below,
    // matching FieldGroups.js's format-dependent showWhen gating
    // — without it, a registry-driven render would show both for every format.
    { path: 'props.odometerDigits', control: 'number', tier: 'simple', group: 'Content', fdwsMin: '1.20', default: 5, tooltip: 'How many whole-number drum positions to show (e.g. 5 for an altimeter up to 99,999). Only used when Value Format is ODOMETER. Default 5.', showWhen: { path: 'props.format', equals: 'ODOMETER' } },
    // Found during live verification of this pass: default was `undefined`, but
    // ValueFormatter.js:313 falls back to 1 for DECIMAL_N
    // (`Number.isInteger(opts.decimals) ? opts.decimals : 1`) — same gap class as the
    // others in this pass, just missed in the original registry entry.
    { path: 'props.decimals', control: 'number', tier: 'simple', group: 'Content', default: 1, tooltip: 'Decimal places to show, for numeric formats.', showWhen: { path: 'props.format', equals: 'DECIMAL_N' } },
    { path: 'props.prefix', control: 'text', tier: 'advanced', group: 'Content', default: undefined, tooltip: 'Text prepended before the value (e.g. "ALT ").' },
    { path: 'props.suffix', control: 'text', tier: 'advanced', group: 'Content', default: undefined, tooltip: 'Text appended after the value (e.g. " ft").' },
    { path: 'props.defaultValue', control: 'text', tier: 'advanced', group: 'Content', default: undefined, tooltip: 'Shown before the first real value arrives from the sim.' },
    { path: 'props.literalOverride', control: 'text', tier: 'advanced', group: 'Content', default: undefined, tooltip: 'Forces this exact text regardless of the bound value — for testing layouts.' },
    // FDWS v1.15 bugfix: LATLON_DMS/COORD_DECIMAL need to know which
    // hemisphere pair to use (N/S vs E/W) — previously unwireable from the
    // UI at all, so this always silently defaulted to N/S even for longitude.
    { path: 'props.coordAxis', control: 'select', options: ['lat', 'lon'], tier: 'advanced', group: 'Content', default: undefined, tooltip: 'Latitude (N/S) or longitude (E/W) — only used by the LATLON_DMS and COORD_DECIMAL formats.', showWhen: { path: 'props.format', equalsAny: ['LATLON_DMS', 'COORD_DECIMAL'] } }
  ],
  'core.button': [
    { path: 'props.label', control: 'text', tier: 'simple', guided: true, group: 'Content', default: undefined, tooltip: 'Primary button text, shown when binding.stateRef is unset or resolves empty.' },
    { path: 'props.sublabel', control: 'text', tier: 'simple', group: 'Content', default: undefined, tooltip: 'Secondary line of text, shown when binding.sublabelStateRef is unset or resolves empty.' },
    { path: 'props.variant', control: 'select', options: [{ value: 'momentary', label: 'Momentary (Push)' }, { value: 'toggle', label: 'Toggle (On / Off)' }, { value: 'swap', label: 'Swap Active / Standby' }], tier: 'simple', guided: true, group: 'Content', default: 'momentary', tooltip: 'Button behavior style. ("preset" was removed in FDWS v1.14 — use binding.stateRef instead.)' },
    { path: 'props.icon', control: 'iconPicker', tier: 'advanced', group: 'Content', default: undefined, tooltip: 'Optional icon shown alongside the label.' },
    { path: 'props.hasLed', control: 'checkbox', tier: 'advanced', group: 'Content', default: false, tooltip: 'Shows a small status LED on the button.' }
  ],
  'core.input': [
    { path: 'props.format', control: 'select', optionsRef: 'VALUE_FORMATS', tier: 'simple', guided: true, group: 'Content', default: 'RAW_INT', tooltip: 'Input mask/validation applied while typing (e.g. SQUAWK_CODE restricts to 4 octal digits).' },
    { path: 'props.placeholder', control: 'text', tier: 'simple', group: 'Content', default: undefined, tooltip: 'Hint text shown when the field is empty.' },
    { path: 'props.defaultValue', control: 'text', tier: 'advanced', group: 'Content', default: undefined, tooltip: 'Initial value before the user edits it.' },
    // Wave 1 gap-closing pass (2026-09-04): the hand-coded panel derived a *dynamic*
    // placeholder from ValueFormatter.getFormatSpec(props.format) and auto-populated
    // these fields from it on format change. The generic engine has no per-format hook
    // for either — added a static illustrative placeholder instead (a real, if smaller,
    // improvement over the registry's previous total absence of one) and noted the loss
    // in the tooltip. Not a functional regression: InputComponent.js:211-212 already
    // falls back to the format's own min/max at runtime whenever these are unset.
    { path: 'props.min', control: 'number', tier: 'advanced', group: 'Content', default: undefined, placeholder: 'format default, if any', tooltip: 'Overrides the chosen format\'s own minimum, if it has one. Leave blank to use the format\'s default.' },
    { path: 'props.max', control: 'number', tier: 'advanced', group: 'Content', default: undefined, placeholder: 'format default, if any', tooltip: 'Overrides the chosen format\'s own maximum, if it has one. Leave blank to use the format\'s default.' },
    { path: 'props.value', control: 'text', tier: 'advanced', group: 'Content', default: undefined, tooltip: 'Forces this exact current value, overriding what the user typed — for testing layouts, same idea as core.display’s Literal Override.' },
    { path: 'props.selectOnFocus', control: 'checkbox', tier: 'advanced', group: 'Content', default: false, tooltip: 'Selects all existing text when the field gains focus, so typing replaces it instead of appending.' }
  ],
  'core.indicator': [
    { path: 'props.label', control: 'text', tier: 'simple', guided: true, group: 'Content', default: undefined, tooltip: 'Text shown on/near the indicator.' },
    // Wave 1: optionIcons is a colored-circle-emoji prefix per option value —
    // a native <option> can't hold nested markup (no <span> swatch), so this
    // is the actual mechanism behind Part 1.1's "colour-coded select options
    // show their colour" acceptance criterion.
    //
    // Step 3 Part A (2026-09-04): the options/default below were wrong —
    // IndicatorComponent.js:15,18 actually reads severity as
    // 'status'|'advisory'|'caution'|'warning' (default 'status'), not the old
    // 'normal'/'caution'/'warning' set, and the hand-coded panel it's replacing
    // already used the correct 4 values. optionIcons corrected to match, not
    // dropped — widgets.css now defines .fd-ind-sev-advisory (cyan) alongside
    // the pre-existing status/caution/warning rules, so all four are real,
    // visibly distinct colors the icons faithfully mirror.
    { path: 'props.severity', control: 'select', options: [{ value: 'status', label: 'Status (Green)' }, { value: 'advisory', label: 'Advisory (Cyan)' }, { value: 'caution', label: 'Caution (Amber)' }, { value: 'warning', label: 'Warning (Red)' }], tier: 'simple', guided: true, group: 'Content', default: 'status', optionIcons: { status: '🟢', advisory: '🔵', caution: '🟡', warning: '🔴' }, tooltip: 'Color/urgency treatment.' },
    // Step 3 Part A: options/default were 'round'/'square' — IndicatorComponent.js:15
    // actually reads 'tile'/'dot' (default 'tile'); neither old value has any CSS
    // backing at all (widgets.css only defines fd-ind-shape via fd-ind-box/fd-ind-dot).
    { path: 'props.shape', control: 'select', options: [{ value: 'tile', label: 'Tile (Annunciator)' }, { value: 'dot', label: 'Dot (LED)' }], tier: 'advanced', group: 'Content', default: 'tile', tooltip: 'Indicator shape.' },
    // FDWS v1.15: declarative lamp test — wire the same state var into every
    // indicator's Test State Var, then one button toggling that var lights
    // them all, regardless of each indicator's own real bound value.
    { path: 'binding.testStateVar', control: 'stateVarPicker', tier: 'advanced', group: 'Local State', appliesTo: ['core.indicator'], label: 'Test State Var', default: undefined, tooltip: 'FDWS v1.15: local state[] variable that, when true, forces this indicator lit regardless of its own bound value — for a \'press to test\' lamp-test button. Wire the SAME state var into every indicator that should light up together, then have a button toggle that one var.' }
  ],
  'core.gauge': [
    // Primary transform — GaugeComponent.update() calls
    // resolveTransformFn(props, val) directly (cfg === the whole top-level
    // props object), so axis/clamp/valueRange/outputRange below are genuinely
    // top-level fields, siblings of transform/pivot, NOT nested under compose.
    // (An earlier pass of this registry filed axis/clamp under compose only —
    // wrong; corrected after reading GaugeComponent.js's actual call sites.
    // compose, below, is a SEPARATE secondary transform with its own
    // independent axis/clamp/valueRange/outputRange — both sets are real.)
    // Step 3 Part B (2026-09-04): reordered the first six entries (transform,
    // valueRange, outputRange, axis, clamp, pivot) to match the hand-coded panel's
    // visual order this replaces — pure reorder, no content change, on the app's
    // largest panel.
    // Step 3 Part B (2026-09-04): default was `undefined` — GaugeComponent.js's
    // resolveTransformFn's switch falls through `case 'rotate': default:` (:214-216),
    // so the real runtime default is 'rotate', not "no transform". Only "looked" correct
    // in the old hand-coded panel (and briefly in this pass, pre-fix) because 'rotate'
    // happens to be the first <option> — a native <select> shows its first option
    // selected by default with nothing marked, coincidentally matching, not because the
    // value was actually right.
    { path: 'props.transform', control: 'select', options: ['rotate', 'translate', 'arc-fill', 'arc'], tier: 'simple', guided: true, group: 'Gauge', default: 'rotate', tooltip: 'How the bound value visually drives this gauge — a rotating needle, a sliding bar, a straight filling bar ("Arc Fill", despite the name), or a real curved arc sweep ("Arc", FDWS v1.20).' },
    { path: 'props.valueRange', control: 'rangeEditor', tier: 'simple', guided: true, group: 'Gauge', default: undefined, tooltip: 'The raw SimVar value span this gauge reads (e.g. 0–400 for airspeed in knots). For Arc, this is the only range needed — Output Range has no meaning there.' },
    { path: 'props.outputRange', control: 'rangeEditor', tier: 'simple', guided: true, group: 'Gauge', default: undefined, tooltip: 'What the value range maps to on screen — degrees of rotation, or px of translation/arc fill. Not used by Arc — its angular span is Arc Start/End Angle instead.', showWhen: { path: 'props.transform', notEquals: 'arc' } },
    // Step 3 Part B: default was `undefined` — GaugeComponent.js:207
    // (`cfg.axis === 'x' ? 'X' : 'Y'`) falls back to Y for anything else, matching the
    // hand-coded panel's own default.
    { path: 'props.axis', control: 'select', options: ['x', 'y'], tier: 'advanced', group: 'Gauge', default: 'y', tooltip: 'Which axis Translate moves along, or which side Arc Fill sweeps from. Ignored by Rotate/Arc.', showWhen: { path: 'props.transform', equals: 'translate' } },
    { path: 'props.clamp', control: 'checkbox', tier: 'advanced', group: 'Gauge', default: true, tooltip: 'Clamps the output to its declared range instead of overshooting past it. On by default. Applies to Arc too (clamps the fill ratio).' },
    // Step 3 Part B: control was 'text' — GaugeComponent.js:91
    // (`${pivot.x} ${pivot.y}`) and the hand-coded panel it's replacing both treat this
    // as an object {x, y}, not a single CSS-string field. Fixed with a dedicated
    // pivotEditor control (two X/Y text inputs).
    { path: 'props.pivot', control: 'pivotEditor', tier: 'advanced', group: 'Gauge', default: undefined, tooltip: 'Rotation center for the Rotate transform, e.g. X=50% Y=50% for dead-center. Ignored by Translate/Arc Fill/Arc.', showWhen: { path: 'props.transform', equals: 'rotate' } },

    // FDWS v1.20 — a real curved SVG arc (stroke-dashoffset sweep), replacing
    // the "arc-fill" scaleX rectangle hack for anything actually circular.
    // GaugeComponent.renderArc()/update() read these directly off props.arc.
    { path: 'props.arc.radius', control: 'number', tier: 'simple', group: 'Arc', default: 40, tooltip: 'Arc radius, in units of a 0–100 viewBox (the gauge scales to fit its own box regardless). Default 40.', showWhen: { path: 'props.transform', equals: 'arc' } },
    { path: 'props.arc.strokeWidth', control: 'number', tier: 'simple', group: 'Arc', default: 6, tooltip: 'Stroke thickness of the track/bands/fill, same 0–100 viewBox units. Default 6.', showWhen: { path: 'props.transform', equals: 'arc' } },
    { path: 'props.arc.startAngle', control: 'number', tier: 'simple', group: 'Arc', default: -120, tooltip: 'Where the arc begins, in degrees clockwise from straight up (12 o\'clock) — same convention as core.selector\'s rotary Angle°. Default -120.', showWhen: { path: 'props.transform', equals: 'arc' } },
    { path: 'props.arc.endAngle', control: 'number', tier: 'simple', group: 'Arc', default: 120, tooltip: 'Where the arc ends, same convention as Start Angle. Default 120.', showWhen: { path: 'props.transform', equals: 'arc' } },
    { path: 'props.arc.trackColor', control: 'color', tier: 'simple', group: 'Arc', default: undefined, tooltip: 'Background track color, always shown across the full sweep. Default a faint white.', showWhen: { path: 'props.transform', equals: 'arc' } },
    { path: 'props.arc.color', control: 'color', tier: 'simple', group: 'Arc', default: undefined, tooltip: 'Fill color for the value-driven progress sweep.', showWhen: { path: 'props.transform', equals: 'arc' } },
    { path: 'props.arc.showFill', control: 'checkbox', tier: 'advanced', group: 'Arc', default: true, tooltip: 'Shows the value-progress sweep on top of the track/bands. Turn off for a pure zone-marker ring with a separate rotating needle (another core.gauge) on top, instead of a fill-wipe style. On by default.', showWhen: { path: 'props.transform', equals: 'arc' } },
    { path: 'props.arc.lineCap', control: 'select', options: ['round', 'butt'], tier: 'advanced', group: 'Arc', default: 'round', tooltip: 'End-cap style for the track and fill strokes (bands always use a flat "butt" cap so adjacent zones meet cleanly). Default round.', showWhen: { path: 'props.transform', equals: 'arc' } },
    { path: 'props.arc.bands', control: 'arcBandsEditor', tier: 'advanced', group: 'Arc', default: undefined,
      rowSpec: { fields: [
        { key: 'from', label: 'From (0–1)', type: 'number', default: 0.8 },
        { key: 'to', label: 'To (0–1)', type: 'number', default: 1 },
        { key: 'color', label: 'Color', type: 'color', default: '#ef4444' }
      ] },
      tooltip: 'Static colored zone segments (caution/redline) — each {from, to} is a 0–1 ratio of the whole Value Range, not a raw value or an angle.', showWhen: { path: 'props.transform', equals: 'arc' } },

    // FDWS v1.5/v1.6 — a SECOND, independent transform layer, composed after
    // the primary one, with its own axis/clamp/ranges nested under it
    // (resolveTransformFn(props.compose, …), a separate call).
    { path: 'props.compose.transform', control: 'select', options: ['rotate', 'translate', 'arc-fill'], tier: 'advanced', group: 'Compose', default: undefined, tooltip: 'FDWS v1.5: transform mode for the secondary composed layer — independent of the primary Transform above.' },
    // Step 3 Part B: default was `undefined` — same resolveTransformFn code path as the
    // primary props.axis above (GaugeComponent.js:207), so the same 'y' fallback applies.
    { path: 'props.compose.axis', control: 'select', options: ['x', 'y'], tier: 'advanced', group: 'Compose', default: 'y', tooltip: 'Which axis the secondary layer’s translate moves along, when its Transform is "translate".', showWhen: { path: 'props.compose.transform', equals: 'translate' } },
    { path: 'props.compose.clamp', control: 'checkbox', tier: 'advanced', group: 'Compose', default: true, tooltip: 'Clamps the secondary layer’s output to its declared range instead of overshooting past it. On by default.' },
    { path: 'props.compose.stateVar', control: 'stateVarPicker', tier: 'advanced', group: 'Compose', default: undefined, tooltip: 'FDWS v1.5: local state variable this gauge layer composes from, instead of its own SimVar binding.' },
    { path: 'props.compose.relativeToStateVar', control: 'stateVarPicker', tier: 'advanced', group: 'Compose', default: undefined, tooltip: 'FDWS v1.6: a second state variable this layer’s value is computed relative to (e.g. an attitude indicator’s bank line relative to horizon).' },
    { path: 'props.compose.valueRange', control: 'rangeEditor', tier: 'advanced', group: 'Compose', default: undefined, tooltip: 'Input value range this layer expects, before mapping to Output Range.' },
    { path: 'props.compose.outputRange', control: 'rangeEditor', tier: 'advanced', group: 'Compose', default: undefined, tooltip: 'Output range (pixels/degrees/etc.) the input range maps onto.' }
  ],
  'core.container': [
    { path: 'props.direction', control: 'select', options: ['row', 'column', 'grid'], tier: 'simple', guided: true, group: 'Layout', default: 'row', tooltip: 'How child components are arranged.' },
    // Wave 1 gap-closing pass (2026-09-04): default was `undefined`, but
    // ContainerComponent.js:15 falls back to 4 (`props.gap !== undefined ? props.gap : 4`).
    { path: 'props.gap', control: 'number', tier: 'simple', group: 'Layout', default: 4, tooltip: 'Spacing between child components, in pixels.' },
    // Same pass: default was `undefined`, but ContainerComponent.js:18 falls back to 2
    // (`props.columns || 2`).
    { path: 'props.columns', control: 'number', tier: 'simple', group: 'Layout', default: 2, tooltip: 'Number of columns, when Direction is "grid".', showWhen: { path: 'props.direction', equals: 'grid' } }
  ],
  'core.slider': [
    // Step 3 Part A (2026-09-04): options were 'horizontal'/'vertical' — SliderComponent.js:17
    // actually checks `props.axis === 'x' ? 'x' : 'y'`; either old value silently fell
    // through to 'y', same bug class as core.pad's already-fixed props.mode.
    { path: 'props.axis', control: 'select', options: [{ value: 'x', label: 'Horizontal (X)' }, { value: 'y', label: 'Vertical (Y)' }], tier: 'simple', guided: true, group: 'Content', default: 'y', tooltip: 'Slide direction.' },
    { path: 'props.min', control: 'number', tier: 'simple', guided: true, group: 'Content', default: undefined, tooltip: 'Minimum value.' },
    { path: 'props.max', control: 'number', tier: 'simple', guided: true, group: 'Content', default: undefined, tooltip: 'Maximum value.' },
    { path: 'props.detents', control: 'detentEditor', tier: 'advanced', group: 'Content', default: undefined,
      rowSpec: { fields: [
        { key: 'value', label: 'Value', type: 'number', default: 0 },
        { key: 'label', label: 'Label', type: 'text', default: '' },
        { key: 'snap', label: 'Snaps', type: 'checkbox', default: true }
      ] },
      tooltip: 'Positions the slider snaps/clicks to along its travel.' }
  ],
  'core.selector': [
    // Step 3 Part A (2026-09-04): axis/mode below were both wrong and conflated two
    // independent runtime concerns. SelectorComponent.js:18 reads props.mode as
    // 'lever'|'rotary' (old registry had 'discrete'/'continuous' — neither hand-coded
    // panel nor runtime ever used those). props.axis (SelectorComponent.js:42,
    // `=== 'x' ? 'x' : 'y'`) is meaningful ONLY in lever mode (old registry options
    // 'horizontal'/'vertical'/'rotary' matched nothing, and the hand-coded panel it's
    // replacing never even rendered an axis control).
    { path: 'props.mode', control: 'select', options: [{ value: 'rotary', label: 'Rotary' }, { value: 'lever', label: 'Lever' }], tier: 'simple', guided: true, group: 'Content', default: 'rotary', tooltip: 'Rotary snaps between positions arranged in a circle; Lever snaps along a straight track.' },
    { path: 'props.axis', control: 'select', options: [{ value: 'x', label: 'Horizontal (X)' }, { value: 'y', label: 'Vertical (Y)' }], tier: 'advanced', group: 'Content', default: 'y', showWhen: { path: 'props.mode', equals: 'lever' }, tooltip: 'Lever travel direction. Not used by Rotary.' },
    { path: 'props.positions', control: 'rowListEditor', tier: 'simple', guided: true, group: 'Content', default: undefined,
      rowSpec: { fields: [
        { key: 'value', label: 'Value', type: 'text', default: '' },
        { key: 'label', label: 'Label', type: 'text', default: '' },
        { key: 'angle', label: 'Angle°', type: 'number', default: 0, showWhen: { path: 'props.mode', notEquals: 'lever' } }
      ] },
      tooltip: 'The named positions this selector can be set to (e.g. OFF / L / R / BOTH / START). Angle (degrees clockwise from top) only applies in Rotary mode.' }
  ],
  'core.rocker': [
    // Step 3 Part A (2026-09-04): options were 'horizontal'/'vertical' — RockerComponent.js:18
    // actually checks `props.axis === 'x' ? 'row' : 'column'`; same bug class as
    // core.slider's axis above.
    { path: 'props.axis', control: 'select', options: [{ value: 'x', label: 'Horizontal (X)' }, { value: 'y', label: 'Vertical (Y)' }], tier: 'simple', guided: true, group: 'Content', default: 'y', tooltip: 'Rocker tilt direction.' },
    { path: 'props.zones', control: 'rowListEditor', tier: 'advanced', group: 'Content', default: undefined,
      rowSpec: { fields: [
        { key: 'id', label: 'Zone ID', type: 'text', default: '' },
        { key: 'label', label: 'Label', type: 'text', default: '' },
        { key: 'writeEvent', label: 'Write Event', type: 'deckEvent', default: '' },
        { key: 'repeatRate', label: 'Repeat ms', type: 'number', default: 100 }
      ] },
      tooltip: 'Press zones (e.g. up/down halves) and what each dispatches.' }
  ],
  'core.stepper': [
    { path: 'props.min', control: 'number', tier: 'simple', guided: true, group: 'Content', default: undefined, tooltip: 'Minimum value.' },
    { path: 'props.max', control: 'number', tier: 'simple', guided: true, group: 'Content', default: undefined, tooltip: 'Maximum value.' },
    { path: 'props.step', control: 'number', tier: 'simple', guided: true, group: 'Content', default: 1, tooltip: 'Amount each tap increments/decrements by.' }
  ],
  // FDWS v1.30 (Rotary rebuild, ticket 02): a deliberately narrow first configuration
  // surface — the Arc gesture, the Bounded range, the Absolute write mode, and just
  // enough appearance to look like a knob. Later tickets widen each axis (Scrub/Tap,
  // Continuous/Detented, Pulse, Acceleration, the remaining Face groups). The old
  // props (circular/coarseStep/fineStep/pushLabel) are gone with the Component that
  // read them; an older widget still declaring one loads and degrades to defaults.
  // Every `default` here matches RotaryComponent.js/rotaryFace.js's own fallback.
  //
  // Ticket 03 adds props.gesture (Arc/Scrub/Tap). Defaults to 'arc' — the only visual
  // style the Rotary has today (a circular knob face, per rotaryFace.js); Scrub's wheel
  // affordance and Tap's tap zones are both an explicit Author opt-in for a control
  // that should feel like a wheel/switch rather than a knob, not a shape the Rotary can
  // currently look like on its own. Switching gesture never requires touching Range,
  // Steps or the Rotary's binding — props.degreesPerUnit's own tooltip below covers how
  // it's reinterpreted per gesture.
  'core.rotary': [
    { path: 'props.gesture', control: 'select', options: [{ value: 'arc', label: 'Arc (turn)' }, { value: 'scrub', label: 'Scrub (drag like a wheel)' }, { value: 'tap', label: 'Tap (discrete steps)' }], tier: 'simple', guided: true, group: 'Range', fdwsMin: '1.30', default: 'arc', tooltip: 'How the End user turns this knob. Arc turns it by arcing a finger around it — the natural gesture for a circular knob. Scrub drags it like a wheel (a trim wheel or VS wheel) with a straight up/down drag. Tap changes it in discrete steps with no drag at all — tapping the right half increments, the left half decrements. Switching gesture never requires reconfiguring Range, Feel or the binding below.' },
    // Ticket 05: the write axis. Absolute sends the resolved value itself, same as
    // every Rotary before this ticket. Pulse sends one increment/decrement per step
    // and never sends a value at all — for controls that expose no way to set a
    // value directly (most payware, many stock: a heading bug, a course knob, an
    // autopilot altitude selector). Switching this never requires reconfiguring
    // Range/Feel/Gesture above; only which binding fields below apply changes.
    { path: 'props.writeMode', control: 'select', options: [{ value: 'absolute', label: 'Absolute (writes the value)' }, { value: 'pulse', label: 'Pulse (writes increment/decrement steps)' }], tier: 'simple', guided: true, group: 'Range', fdwsMin: '1.30', default: 'absolute', tooltip: 'Absolute writes the knob\'s resolved value on every write event, using Write Event below. Pulse writes one increment or decrement per step instead, using Increment/Decrement Event below — for a control the aircraft only lets you nudge, never set directly.' },
    // Default differs by Write Mode (onChange for Absolute, perDetent for Pulse) —
    // see rotaryEngine.js's resolveDispatchTiming. The registry's own `default` here
    // is only what the Inspector shows before an Author picks one; the real
    // effective default is resolved at runtime against Write Mode.
    { path: 'props.dispatchTiming', control: 'select', options: [{ value: 'onChange', label: 'On Change (continuously while turning)' }, { value: 'onRelease', label: 'On Release (once, when let go)' }, { value: 'perDetent', label: 'Per Detent (once per step)' }], tier: 'advanced', group: 'Range', fdwsMin: '1.30', default: undefined, tooltip: 'When writes leave this Ring. On Change writes continuously while turning (Absolute\'s default). On Release holds every write until the gesture ends. Per Detent writes once per whole step (Pulse\'s default, and Pulse always writes this way regardless of Gesture) — Absolute can opt into the same discrete feel.' },
    // Ticket 04: the range axis. Bounded (the ticket 01/02 default) clamps at each
    // end like a physical end-stop. Continuous wraps past either limit instead — a
    // heading bug moving from 359 back to 0. Detented ignores Min/Max entirely and
    // snaps between the Positions list below instead — a two-position list is just a
    // short Positions list, not a fourth mode of its own.
    { path: 'props.rangeMode', control: 'select', options: [{ value: 'bounded', label: 'Bounded (clamps at each end)' }, { value: 'continuous', label: 'Continuous (wraps around, like a heading bug)' }, { value: 'detented', label: 'Detented (snaps between named positions)' }], tier: 'simple', guided: true, group: 'Range', fdwsMin: '1.30', default: 'bounded', tooltip: 'Bounded clamps at Min/Max like a physical end-stop. Continuous wraps past either limit instead of clamping (359° back to 0°, like a heading bug). Detented ignores Min/Max and snaps between the named Positions below — for a two-position toggle, just author two positions.' },
    { path: 'props.min', control: 'number', tier: 'simple', guided: true, group: 'Range', fdwsMin: '1.30', default: 0, showWhen: { path: 'props.rangeMode', notEquals: 'detented' }, tooltip: 'Lowest value the knob can reach. The knob stops here like a physical end-stop — turning further is absorbed and has to be wound back. Not used when Range Mode is Detented.' },
    { path: 'props.max', control: 'number', tier: 'simple', guided: true, group: 'Range', fdwsMin: '1.30', default: 100, showWhen: { path: 'props.rangeMode', notEquals: 'detented' }, tooltip: 'Highest value the knob can reach. Not used when Range Mode is Detented.' },
    { path: 'props.positions', control: 'rowListEditor', tier: 'simple', guided: true, group: 'Range', fdwsMin: '1.30', default: undefined,
      rowSpec: { fields: [
        { key: 'value', label: 'Value', type: 'text', default: '' },
        { key: 'label', label: 'Label', type: 'text', default: '' },
        { key: 'momentary', label: 'Momentary', type: 'checkbox', default: false }
      ] },
      showWhen: { path: 'props.rangeMode', equals: 'detented' },
      tooltip: 'The named positions this Detented Ring snaps between (e.g. OFF / L / R / BOTH / START), evenly spaced across Sweep°. A position marked Momentary fires on arrival and springs back to the previous position on release, the way a magneto\'s START does.' },
    { path: 'props.degreesPerUnit', control: 'number', tier: 'simple', guided: true, group: 'Range', fdwsMin: '1.30', default: 1, tooltip: 'The knob\'s "feel" — reinterpreted per Gesture above. Arc: degrees of arc travelled per 1 unit of value (or, when Range Mode is Detented, per one step between positions). Scrub: pixels of straight drag per 1 unit. Tap: units changed by a single tap. Higher means finer/slower for Arc and Scrub; for Tap it is the step size itself. In Pulse write mode Feel is the size of one step, since the Ring owns no value: degrees of arc per step for Arc (360 divided by it is the steps per revolution), pixels of drag per step for Scrub. A new Pulse Rotary starts well above the floor below. In Pulse write mode, Arc and Scrub have a higher Feel floor: each step is one write to the sim, and a finer Feel could produce steps faster than the sim link can send them, so the knob would keep moving after the finger lifts. Absolute and Pulse Tap have a floor of 0.01. A Feel typed below the floor is committed as the floor instead; a file that already stores a finer Feel keeps it as stored but runs at the floor. In Absolute write mode, a negative value reverses the knob\'s turn direction for Arc and Scrub (Tap ignores the sign).' },
    // Acceleration: two discrete tiers (the fine step Feel gives, and a coarse step), never a
    // continuous curve. Off by default and enabled per Rotary; the detail fields carry a
    // showWhen on the enable flag so a Rotary without Acceleration shows none of them.
    { path: 'props.acceleration', control: 'checkbox', tier: 'simple', guided: true, group: 'Range', fdwsMin: '1.30', default: false, tooltip: 'Turn faster to move in larger steps. Off by default: a radio being tuned across a wide range needs it, a heading bug does not. There are exactly two tiers, the fine step Feel already gives and the coarse step, with nothing in between, so an exact value is always reachable by slowing down, and slowing down returns it to the fine step almost at once. Arc and Scrub only: a Tap Rotary and a Detented Rotary have no rate of turn to measure, so they ignore it.' },
    { path: 'props.accelerationCoarseStep', control: 'number', tier: 'simple', guided: true, group: 'Range', fdwsMin: '1.30', default: 10, min: 1, showWhen: { path: 'props.acceleration', equals: true }, tooltip: 'How many fine steps one step of travel becomes in the coarse tier: 10 makes a fast turn move ten times as far as a slow one. A value below 1 is treated as 1, which makes the coarse tier move exactly like the fine step. The Feel floor still holds in the coarse tier, so in Pulse write mode the coarse step cannot make an Arc or Scrub Rotary finer than the floor: at a Feel of 12 and an Arc floor of 6, the most it can be is 2. For a bigger jump in Pulse, bind the aircraft\'s Fast Increment and Decrement Events under Bindings; the coarse tier then sends those instead, and this number is not used.' },
    { path: 'props.accelerationEnterRate', control: 'number', tier: 'advanced', group: 'Range', fdwsMin: '1.30', default: 20, showWhen: { path: 'props.acceleration', equals: true }, tooltip: 'How fast the turn must be to enter the coarse tier, in steps per second, where one step is one unit of Feel. The Rotary enters it at or above this rate, so a higher number asks for a faster turn. It must be above 0: a value of 0 or below is ignored and 20 is used.' },
    { path: 'props.accelerationExitRate', control: 'number', tier: 'advanced', group: 'Range', fdwsMin: '1.30', default: undefined, showWhen: { path: 'props.acceleration', equals: true }, tooltip: 'The rate, in steps per second, below which the Rotary returns to the fine tier. Keep it under the Enter Rate: the gap between the two is what stops a steady turn near the Enter Rate flickering between tiers. Left blank, it is half the Enter Rate. So is a value of 0 or below, and a value that is not below the Enter Rate: those are ignored, and half the Enter Rate runs instead.' },
    { path: 'props.sweepDegrees', control: 'number', tier: 'advanced', group: 'Range', fdwsMin: '1.30', default: 270, tooltip: 'How far the knob visibly rotates across its whole range, in degrees. Purely visual — it does not change the values the knob produces.' },
    { path: 'props.startAngle', control: 'number', tier: 'advanced', group: 'Range', fdwsMin: '1.30', default: -135, tooltip: 'Where the indicator points at the minimum value, in degrees clockwise from straight up (12 o\'clock) — same convention as core.gauge\'s Arc Start Angle. Default -135, which puts mid-range straight up over the default 270° sweep.' },
    // Appearance: six groups, every length in the Face's own 100-unit scale so the knob
    // scales with whatever layout box it is given. Each group's headline property is on
    // the simple tier and its detail on the advanced tier, so a recognisable knob does
    // not need a visit to every group. Every "off" default (0 or 'none') is the look the
    // Rotary has always had, and it is the value the dependent fields gate on.
    // Colours are theme-adjusted for the widget's light/dark theme like any Component's.
    // The Face draws in rotaryFace.js; rotaryFaceConfig.js maps these props onto it.
    { path: 'props.fillStyle', control: 'select', options: [{ value: 'solid', label: 'Solid' }, { value: 'linear', label: 'Linear (top to bottom)' }, { value: 'radial', label: 'Radial (edge to centre)' }, { value: 'conic', label: 'Conic (machined metal)' }], tier: 'simple', group: 'Face', fdwsMin: '1.30', default: 'solid', tooltip: 'How the knob disc is filled. Solid is one colour. Linear and Radial blend from Face Color to Second Color. Conic sweeps light and dark bands around the centre, which is what reads as machined metal rather than a flat circle. A blend needs plain hex or rgb() colours; with anything else the disc falls back to a solid Face Color.' },
    { path: 'props.faceColor', control: 'color', tier: 'simple', group: 'Face', fdwsMin: '1.30', default: undefined, tooltip: 'Fills the knob disc, or is the first colour of a blended fill. With a Solid fill, leave unset to let this component’s own Background (and its state/conditional variants) show through instead.' },
    { path: 'props.faceColor2', control: 'color', tier: 'simple', group: 'Face', fdwsMin: '1.30', default: '#1e293b', showWhen: { path: 'props.fillStyle', notEquals: 'solid' }, tooltip: 'The second colour of a Linear, Radial or Conic fill. Not used by a Solid fill.' },
    { path: 'props.rimColor', control: 'color', tier: 'advanced', group: 'Face', fdwsMin: '1.30', default: '#64748b', tooltip: 'Color of the ring around the edge of the knob. Knurling is drawn in this colour too.' },
    { path: 'props.rimWidth', control: 'number', tier: 'advanced', group: 'Face', fdwsMin: '1.30', default: 6, min: 0, tooltip: 'Thickness of the knob’s rim, as a share of a 100-unit knob (6 = 6% of the knob’s width), so it scales with the knob instead of being a fixed pixel size.' },
    { path: 'props.innerShadow', control: 'number', tier: 'advanced', group: 'Face', fdwsMin: '1.30', default: 0, min: 0, tooltip: 'Depth of the shadow just inside the rim, on the same 100-unit scale as Rim Width, which makes the disc read as recessed. 0 draws none.' },
    { path: 'props.knurlStyle', control: 'select', options: [{ value: 'none', label: 'None' }, { value: 'grooves', label: 'Grooves (radial lines)' }, { value: 'teeth', label: 'Teeth (serrated edge)' }, { value: 'dots', label: 'Dots' }], tier: 'simple', group: 'Knurling', fdwsMin: '1.30', default: 'none', tooltip: 'Grip marks around the edge of the knob, drawn in the rim colour just inside the rim. They turn with the knob. Knurling is the single biggest thing that makes a knob read as something a hand would grip.' },
    { path: 'props.knurlCount', control: 'number', tier: 'advanced', group: 'Knurling', fdwsMin: '1.30', default: 24, min: 3, showWhen: { path: 'props.knurlStyle', notEquals: 'none' }, tooltip: 'How many grip marks go around the whole circumference (3 to 120).' },
    { path: 'props.knurlDepth', control: 'number', tier: 'advanced', group: 'Knurling', fdwsMin: '1.30', default: 5, min: 0.5, showWhen: { path: 'props.knurlStyle', notEquals: 'none' }, tooltip: 'How far the grip marks reach inward from the rim, on the same 100-unit scale as Rim Width.' },
    { path: 'props.indicatorShape', control: 'select', options: [{ value: 'line', label: 'Line' }, { value: 'dot', label: 'Dot' }, { value: 'triangle', label: 'Triangle' }], tier: 'simple', group: 'Indicator', fdwsMin: '1.30', default: 'line', tooltip: 'The mark that shows which way the knob is turned. A line runs inward from the rim, a dot sits near the rim, and a triangle points inward from the rim.' },
    { path: 'props.indicatorColor', control: 'color', tier: 'simple', group: 'Indicator', fdwsMin: '1.30', default: '#e2e8f0', tooltip: 'Color of the Indicator, the mark that shows which way the knob is turned.' },
    { path: 'props.indicatorWidth', control: 'number', tier: 'advanced', group: 'Indicator', fdwsMin: '1.30', default: 6, min: 0, tooltip: 'Thickness of a line Indicator, the radius of a dot, or the half-width of a triangle, on the same 100-unit scale as Rim Width.' },
    { path: 'props.indicatorLength', control: 'number', tier: 'advanced', group: 'Indicator', fdwsMin: '1.30', default: 30, min: 0, showWhen: { path: 'props.indicatorShape', notEquals: 'dot' }, tooltip: 'How far a line or triangle Indicator reaches inward from the rim, on the same 100-unit scale as Rim Width. A dot has no length.' },
    { path: 'props.indicatorGlow', control: 'number', tier: 'advanced', group: 'Indicator', fdwsMin: '1.30', default: 0, min: 0, tooltip: 'How far a soft glow in the Indicator’s own colour spreads around it, on the same 100-unit scale as Rim Width. 0 draws none.' },
    { path: 'props.capDiameter', control: 'number', tier: 'simple', group: 'Cap', fdwsMin: '1.30', default: 0, min: 0, tooltip: 'Diameter of the Cap, the static disc at the centre that never turns, as a share of a 100-unit knob. 0 draws no Cap. It cannot grow past the inside of the rim.' },
    { path: 'props.capColor', control: 'color', tier: 'advanced', group: 'Cap', fdwsMin: '1.30', default: '#334155', showWhen: { path: 'props.capDiameter', notEquals: 0 }, tooltip: 'Fill colour of the Cap.' },
    { path: 'props.capContent', control: 'select', options: [{ value: 'none', label: 'Nothing' }, { value: 'label', label: 'A label' }, { value: 'icon', label: 'An icon' }], tier: 'advanced', group: 'Cap', fdwsMin: '1.30', default: 'none', showWhen: { path: 'props.capDiameter', notEquals: 0 }, tooltip: 'What the Cap shows: a short label or a single icon glyph. Its colour is this component’s own Text Color, so it follows the light and dark theme.' },
    { path: 'props.capLabel', control: 'text', tier: 'advanced', group: 'Cap', fdwsMin: '1.30', default: undefined, showWhen: { path: 'props.capContent', equals: 'label' }, tooltip: 'Short text in the Cap, up to 12 characters. A longer label shrinks to fit the Cap.' },
    { path: 'props.capIcon', control: 'iconPicker', tier: 'advanced', group: 'Cap', fdwsMin: '1.30', default: undefined, showWhen: { path: 'props.capContent', equals: 'icon' }, tooltip: 'A single glyph or emoji in the Cap, drawn larger than a label.' },
    { path: 'props.scaleMajorDivisions', control: 'number', tier: 'simple', group: 'Scale', fdwsMin: '1.30', default: 0, min: 0, tooltip: 'How many divisions the graduated scale around the knob is split into by its major marks (up to 60): 10 draws 11 major marks over an arc, or 10 over a full circle. 0 draws no scale. The knob shrinks a little to leave room for it.' },
    { path: 'props.scaleMinorDivisions', control: 'number', tier: 'advanced', group: 'Scale', fdwsMin: '1.30', default: 1, min: 1, showWhen: { path: 'props.scaleMajorDivisions', notEquals: 0 }, tooltip: 'How many parts each major division is split into by minor marks: 5 puts 4 minor marks between each pair of major marks. 1 draws no minor marks.' },
    { path: 'props.scaleTickLength', control: 'number', tier: 'advanced', group: 'Scale', fdwsMin: '1.30', default: 6, min: 1, showWhen: { path: 'props.scaleMajorDivisions', notEquals: 0 }, tooltip: 'Length of a major mark, on the same 100-unit scale as Rim Width. Minor marks are 60% of it.' },
    { path: 'props.scaleLabels', control: 'checkbox', tier: 'advanced', group: 'Scale', fdwsMin: '1.30', default: false, showWhen: { path: 'props.scaleMajorDivisions', notEquals: 0 }, tooltip: 'Label each major mark with its value, evenly spaced from Min to Max. A Detented Rotary already labels its own Positions, so it draws none here.' },
    { path: 'props.scaleSpan', control: 'number', tier: 'advanced', group: 'Scale', fdwsMin: '1.30', default: undefined, min: 1, showWhen: { path: 'props.scaleMajorDivisions', notEquals: 0 }, tooltip: 'How many degrees the scale covers, starting at Start Angle. Leave blank to match Sweep, so the marks line up with where the Indicator can go. 360 draws a full circle.' },
    { path: 'props.scaleColor', control: 'color', tier: 'advanced', group: 'Scale', fdwsMin: '1.30', default: '#94a3b8', showWhen: { path: 'props.scaleMajorDivisions', notEquals: 0 }, tooltip: 'Colour of the scale’s marks and labels.' },
    { path: 'props.dropShadow', control: 'number', tier: 'simple', group: 'Depth', fdwsMin: '1.30', default: 0, min: 0, tooltip: 'Size of the soft shadow under the knob, on the same 100-unit scale as Rim Width (up to 15), which lifts it off the panel. 0 draws none. The knob shrinks a little so the shadow stays inside its box.' }
  ],
  'core.image': [
    { path: 'props.assetId', control: 'assetPicker', tier: 'simple', guided: true, group: 'Content', default: undefined, tooltip: 'Image from this widget’s Asset Library to display.' },
    // Step 3 Part A (2026-09-04): 'tile' is not a valid CSS object-fit keyword —
    // ImageComponent.js:49 writes props.fit straight into img.style.objectFit, so the
    // browser silently ignores it. The hand-coded panel's real third option was 'fill'
    // (valid CSS), missing from the registry.
    { path: 'props.fit', control: 'select', options: ['cover', 'contain', 'fill'], tier: 'advanced', group: 'Content', default: 'contain', tooltip: 'How the image fills its box.' },
    // FDWS v1.20 §2: "inline" only has an effect when the chosen asset is an
    // SVG — a PNG/JPEG/WEBP asset falls back to the normal <img> render
    // regardless of this setting (nothing to inline). See props.renderMode's
    // pairing with style.typography.color below.
    { path: 'props.renderMode', control: 'select', options: ['img', 'inline'], tier: 'advanced', group: 'Content', default: 'img', tooltip: 'FDWS v1.20: "Inline SVG" injects an SVG asset as live markup instead of an opaque <img> — any shape inside it authored with fill="currentColor"/stroke="currentColor" then follows this component\'s Text Color field (below), including that field\'s own state-driven style.rules — so an instrument face can recolor at runtime instead of being permanently baked into one static image. No effect on non-SVG assets.' }
  ],
  'core.list': [
    // Step 3 Part A (2026-09-04): path was 'props.itemsBinding' with control
    // stateVarPicker, implying a plain string. ListComponent.js:22,33 and the
    // hand-coded panel both treat it as an object wrapping { stateVar } — corrected to
    // the real nested path.
    { path: 'props.itemsBinding.stateVar', control: 'stateVarPicker', tier: 'simple', guided: true, group: 'Content', default: undefined, tooltip: 'Array-typed state variable this list renders one row per item from.' },
    // Step 3 Part A: control changed from 'text' to 'bespoke' — this field needs
    // JSON.parse + validation (updateCompJsonProp) the generic text control doesn't
    // have, so it stays intentionally hand-rendered (see ComponentSection.js's
    // core.list case). 'bespoke' is a distinct marker from control:null ("deprecated/
    // hidden") — this field is neither; it's a real, working field with UI on purpose.
    { path: 'props.itemTemplate', control: 'bespoke', tier: 'advanced', group: 'Content', default: undefined, tooltip: 'Template describing how each row is rendered from its item object.' },
    { path: 'props.maxVisible', control: 'number', tier: 'advanced', group: 'Content', default: undefined, tooltip: 'Rows visible before scrolling.' },
    { path: 'props.scrollable', control: 'checkbox', tier: 'advanced', group: 'Content', default: false, tooltip: 'Allows scrolling past Max Visible rows instead of clipping them.' }
    // Step 3 Part A: props.textBinding removed — ListComponent.js never reads
    // this.def.props.textBinding; the only real textBinding read (:71) is on a CHILD
    // component's own props inside itemTemplate.components[], a different object
    // entirely. Declaring it here was dead — it had zero runtime effect on core.list
    // itself.
  ],
  'core.ref': [
    // Step 3 Part A (2026-09-04): control changed from 'widgetLibraryPicker' (never
    // implemented — no such picker exists anywhere) to 'text', matching what the
    // hand-coded panel it's replacing actually was: a plain free-text input.
    { path: 'props.libraryId', control: 'text', tier: 'simple', guided: true, group: 'Content', default: undefined, tooltip: 'ID of a shared widget-library component this one embeds.' }
  ],
  'core.pad': [
    // Wave 1 gap-closing pass (2026-09-04): options were ['xy','x','y'] — stale, and not
    // what PadComponent.js:32 actually reads (`props.mode === 'absolute' ? 'absolute' :
    // 'relative'`). Any of the old three values would have silently fallen through to
    // 'relative' at runtime. Corrected to match the runtime and the hand-coded panel's
    // own (correct) labels.
    { path: 'props.mode', control: 'select', options: [{ value: 'relative', label: 'Relative (Pan)' }, { value: 'absolute', label: 'Absolute (Cursor)' }], tier: 'simple', guided: true, group: 'Content', default: 'relative', tooltip: 'Relative reports drag deltas for panning; Absolute reports normalized cursor position within the pad.' },
    // Same pass: default was `undefined`, but PadComponent.js:33 falls back to 1.0
    // (`props.sensitivity !== undefined ? props.sensitivity : 1.0`).
    { path: 'props.sensitivity', control: 'number', tier: 'advanced', group: 'Content', default: 1.0, tooltip: 'Movement scaling — higher means less physical drag needed for the same output range.' }
  ],
  // FDWS v1.17: a plain grid-snapped separator line — reuses style.border.
  // width/color/style as the line's thickness/color/dash-style instead of a
  // parallel schema, so it's theme-aware for free and shares the Border
  // group's existing controls.
  'core.divider': [
    // Wave 1 gap-closing pass (2026-09-04): default was `undefined`, but
    // DividerComponent.js:67 falls back to 'horizontal'
    // (`this.def.props?.orientation === 'vertical' ? 'vertical' : 'horizontal'`).
    { path: 'props.orientation', control: 'select', options: ['horizontal', 'vertical'], tier: 'simple', guided: true, group: 'Content', fdwsMin: '1.17', default: 'horizontal', tooltip: 'Line direction. Horizontal spans this component’s own width; vertical spans its own height — size the grid box accordingly (wide+short for horizontal, narrow+tall for vertical).' }
  ],
  // FDWS v1.20 §3: a continuously-scrolling ruler/tape (airspeed, altitude) —
  // TapeComponent.js rebuilds the visible window of tick marks/labels from
  // these numbers on every bound-value update, rather than reading a
  // pre-drawn asset or a state[] array. The current value's own numeric
  // readout is a separate core.display layered on top at the index line, not
  // part of this component.
  'core.tape': [
    { path: 'props.axis', control: 'select', options: ['y', 'x'], tier: 'simple', guided: true, group: 'Tape', fdwsMin: '1.20', default: 'y', tooltip: 'Scroll direction — vertical (airspeed/altitude-style) or horizontal (heading-tape-style).' },
    // Wave 1 gap-closing pass (2026-09-04): the six defaults below were all `undefined`
    // despite clear `||` fallbacks in TapeComponent.js (lines 90-95). labelColor and
    // indexLineColor are deliberately left `undefined` — their real fallbacks are
    // dynamic (labelColor mirrors tickColor) or CSS-var-based, not a plain literal.
    { path: 'props.tickInterval', control: 'number', tier: 'simple', guided: true, group: 'Tape', fdwsMin: '1.20', default: 10, tooltip: 'Value spacing between minor ticks (e.g. 10 for an altitude tape in feet).' },
    { path: 'props.majorEvery', control: 'number', tier: 'simple', group: 'Tape', fdwsMin: '1.20', default: 5, tooltip: 'Every Nth minor tick is drawn longer and labeled with its value.' },
    { path: 'props.pxPerUnit', control: 'number', tier: 'simple', guided: true, group: 'Tape', fdwsMin: '1.20', default: 2, tooltip: 'Pixels of scroll travel per 1 unit of value — controls how "zoomed in" the tape reads.' },
    { path: 'props.minorTickLength', control: 'number', tier: 'advanced', group: 'Tape', fdwsMin: '1.20', default: 8, tooltip: 'Length in px of a minor tick mark.' },
    { path: 'props.majorTickLength', control: 'number', tier: 'advanced', group: 'Tape', fdwsMin: '1.20', default: 16, tooltip: 'Length in px of a major (labeled) tick mark.' },
    { path: 'props.tickColor', control: 'color', tier: 'advanced', group: 'Tape', fdwsMin: '1.20', default: '#94a3b8', tooltip: 'Color of the tick marks.' },
    { path: 'props.labelColor', control: 'color', tier: 'advanced', group: 'Tape', fdwsMin: '1.20', default: undefined, tooltip: 'Color of the tick labels. Defaults to Tick Color if unset.' },
    { path: 'props.indexLineColor', control: 'color', tier: 'advanced', group: 'Tape', fdwsMin: '1.20', default: undefined, tooltip: 'Color of the fixed line marking the current reading, at the component\'s center.' },
    { path: 'props.decimals', control: 'number', tier: 'advanced', group: 'Tape', fdwsMin: '1.20', default: 0, tooltip: 'Decimal places shown on major tick labels. Default 0.' },
    { path: 'props.reverse', control: 'checkbox', tier: 'advanced', group: 'Tape', fdwsMin: '1.20', default: false, tooltip: 'Flips scroll direction — higher values move toward the start instead of the end.' }
  ]
};

/**
 * Every known core.* component type — the registry's TYPE_FIELDS keys are the
 * single source now (replaces StudioValidator.CORE_COMPONENT_TYPES's own
 * hand-copied list, a fourth drift-prone array Phase 0 didn't originally
 * catch — see the Widget Studio 2.0 Phase 0 adjustment pass).
 */
export function getComponentTypes() {
  return Object.keys(TYPE_FIELDS);
}

/** All fields (common + type-specific) that apply to a given component type. */
export function getFieldsForType(type) {
  const typeFields = TYPE_FIELDS[type] || [];
  return [...COMMON_FIELDS, ...typeFields].filter(
    (f) => !f.appliesTo || f.appliesTo.includes(type)
  );
}

/** Every declared field path across every type — what check-registry-drift.mjs diffs against real runtime reads. */
export function getAllFieldPaths() {
  const all = new Set();
  COMMON_FIELDS.forEach((f) => all.add(f.path));
  Object.values(TYPE_FIELDS).forEach((fields) => fields.forEach((f) => all.add(f.path)));
  return [...all];
}

// ---------------------------------------------------------------------------
// FDWS v1.25: style.states[stateName] — single source for which state name(s)
// a given component type actually consumes at runtime (see
// shared/widgets/components/BaseComponent.js's applyStyles()/
// applyOptionalStateStyle(), and each component's own render() for where
// setState()/applyOptionalStateStyle() gets called). Both
// widget-studio/js/inspector/sections/AppearanceSection.js (which state-style editor section to
// show) and StudioValidator.js (flagging an authored style.states entry that
// component type never reads) import this instead of each keeping their own
// copy — the same "two files, easy to forget" drift this registry exists to
// prevent everywhere else.
// ---------------------------------------------------------------------------
export const STATE_STYLE_SUPPORT = {
  'core.input': () => ({ name: 'editState', label: 'Edit State (While Focused)', tabLabel: 'Edit State' }),
  'core.button': (props) => (props.variant === 'toggle'
    ? { name: 'active', label: 'Active State (Toggled On)', tabLabel: 'Active' }
    : { name: 'pressed', label: 'Pressed State', tabLabel: 'Pressed' }),
  'core.rocker': () => ({ name: 'pressed', label: 'Pressed State (each zone independently)', tabLabel: 'Pressed' }),
  'core.stepper': () => ({ name: 'pressed', label: 'Pressed State (each button independently)', tabLabel: 'Pressed' }),
  'core.rotary': () => ({ name: 'dragging', label: 'Dragging State', tabLabel: 'Dragging' }),
  'core.slider': () => ({ name: 'dragging', label: 'Dragging State', tabLabel: 'Dragging' }),
  'core.pad': () => ({ name: 'engaged', label: 'Engaged State (pointer down)', tabLabel: 'Engaged' }),
  'core.selector': () => ({ name: 'active', label: 'Active State (each selected position)', tabLabel: 'Active' })
};

/**
 * Resolves the one state-style entry (if any) a given component type/variant
 * actually reads at runtime. Returns null for a type with no state-style
 * support at all (e.g. core.label, core.display) — style.states on one of
 * those is authored but inert.
 * @param {string} type
 * @param {object} [props]
 * @returns {{name: string, label: string, tabLabel: string}|null}
 */
export function getStateStyleConfig(type, props) {
  const resolver = STATE_STYLE_SUPPORT[type];
  return resolver ? resolver(props || {}) : null;
}
