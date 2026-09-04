/**
 * PropertyRegistry.js
 * Widget Studio 2.0, Phase 0 — the single declaration of every editable FDWS field,
 * interaction trigger, interaction action, and value format Widget Studio's Property
 * Inspector can author.
 *
 * WHY THIS FILE EXISTS: every prior "Studio doesn't expose X" bug (see
 * docs/CHANGELOG.md and this repo's own audit history) had the same root cause —
 * StudioInspector.js hand-lists fields in its render functions, TRIGGERS/VALUE_FORMATS
 * were separate hardcoded arrays, and nothing checked either against what the runtime
 * (CompositeWidget.js / shared/widgets/components/*.js) actually reads. Four separate
 * instances of this were found and fixed by hand in one audit session (interaction
 * types, value formats, custom bindings, triggers) before this registry existed.
 *
 * From Widget Studio 2.0 Phase 1 onward, StudioInspector.js renders its panels BY
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
  '1.21', '1.22', '1.23', '1.24', '1.25', '1.26', '1.27', '1.28'
];

// ---------------------------------------------------------------------------
// Interaction triggers — replaces StudioInspector.js's hardcoded TRIGGERS array.
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
// scripts/check-registry-drift.mjs and StudioInspector.js's Trigger dropdown
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
  { id: 'push', fires: 'RotaryComponent — center button press', live: true, componentTypes: ['core.rotary'] },
  { id: 'dragStart', fires: 'RotaryComponent — drag begins', live: true, componentTypes: ['core.rotary'] },
  { id: 'fineChange', fires: 'RotaryComponent — drag delta (the knob’s defining interaction)', live: true, componentTypes: ['core.rotary'] },
  { id: 'dragEnd', fires: 'RotaryComponent — drag ends', live: true, componentTypes: ['core.rotary'] },
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
// dropdown + per-action field list in StudioInspector.js. `params` drives that
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
  // group, hand-coded in StudioInspector.js like meta/layout/revision already
  // are — not registry-driven, same as those). Holds this component's literal
  // authored values for whichever theme ISN'T the widget's baseTheme; unset
  // fields keep auto-deriving from style.* even in manual mode.
  { path: 'style.themeOverride.typography.color', control: 'color', tier: 'advanced', group: 'Theme Override', fdwsMin: '1.18', default: undefined, tooltip: 'Manual text color for the non-base theme. Leave unset to keep auto-deriving it.' },
  { path: 'style.themeOverride.border.color', control: 'color', tier: 'advanced', group: 'Theme Override', fdwsMin: '1.18', default: undefined, tooltip: 'Manual border color for the non-base theme. Leave unset to keep auto-deriving it.' },
  { path: 'style.themeOverride.background.color', control: 'color', tier: 'advanced', group: 'Theme Override', fdwsMin: '1.18', default: undefined, tooltip: 'Manual fill color for the non-base theme, when Background Type is Color. Leave unset to keep auto-deriving it.' },
  { path: 'style.themeOverride.background.gradient', control: 'text', tier: 'advanced', group: 'Theme Override', fdwsMin: '1.18', default: undefined, tooltip: 'Manual CSS gradient for the non-base theme, when Background Type is Gradient. Leave unset to keep auto-deriving it.' },
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
  // states already used it. What's new is Studio UI: StudioInspector.js's
  // component Appearance section now renders a live editor for whichever
  // state name applies to the selected component type (see
  // STATE_STYLE_CONFIG there), so control:'stateStyleEditor' finally has a
  // real implementation instead of being declared-but-unrendered.
  { path: 'style.states', control: 'stateStyleEditor', tier: 'advanced', group: 'Layout', fdwsMin: '1.25', default: undefined, tooltip: 'Style overrides applied when this component enters a named state (e.g. "pressed", "active", "editState", "dragging") — merged over the base typography/border/background above, not a replacement for them. Which state name applies depends on component type; see the "State Style" section in Appearance for this component.' },

  // --- Visibility ---
  { path: 'visibleWhen', control: 'conditionBuilder', tier: 'advanced', group: 'Visibility', default: undefined, tooltip: 'Hides this component entirely unless a condition on state/telemetry is met.' },

  // --- Bindings (binding.*) — SIMVARS & BINDINGS panel ---
  { path: 'binding.readSimVar', control: 'simVarPicker', tier: 'simple', guided: true, group: 'Bindings', default: undefined, tooltip: 'SimVar this component displays. Updates live from the simulator.' },
  { path: 'binding.writeEvent', control: 'eventPicker', tier: 'simple', guided: true, group: 'Bindings', default: undefined, tooltip: 'Deck Event dispatched when this component is interacted with (a button tap, a slider drag, etc.).' },
  { path: 'binding.stateVar', control: 'stateVarPicker', tier: 'simple', group: 'Bindings', default: undefined, tooltip: 'Local state[] variable this component reads and re-renders on when it changes.' },
  { path: 'binding.stateRef', control: 'stateRefPicker', tier: 'advanced', group: 'Bindings', default: undefined, tooltip: 'Nested/indexed local state path (e.g. "presets[0].freq") this component’s primary value resolves from.' },
  { path: 'binding.sublabelStateRef', control: 'stateRefPicker', tier: 'advanced', group: 'Bindings', appliesTo: ['core.button'], default: undefined, tooltip: 'Same as Bind to State Path, but for this button’s second (sublabel) text slot — independent of the primary binding.' },
  { path: 'binding.pollFrequencyHz', control: 'select', options: [{ value: 1, label: 'Normal (1Hz)' }, { value: 20, label: 'Fast (~100Hz cadence)' }], tier: 'simple', group: 'Bindings', default: 1, tooltip: 'How often the sim pushes this SimVar. Fast is for anything that needs to look smooth in motion (an attitude indicator); Normal is enough for slow-changing values (fuel qty). Since FDWS v1.26, PC Bridge only sends a SimVar when its value actually changes, so Normal already reacts within a frame of a real change — Fast is now only about getting a value that’s always fluctuating (motion), not about lag.' },
  { path: 'binding.pollGroup', control: 'text', tier: 'advanced', group: 'Bindings', fdwsMin: '1.26', default: undefined, tooltip: 'Which PC Bridge polling chunk this SimVar joins. Leave blank to default to this widget’s own id, which already groups all of this widget’s own bindings together and away from unrelated widgets’ vars. Only set this to deliberately merge chunks across widgets (e.g. two widgets that share a bus and should always update in lockstep), or to split one unusually noisy var out of an otherwise-quiet widget.' },
  { path: 'binding.deadband', control: 'number', tier: 'advanced', group: 'Bindings', default: 0, tooltip: 'Ignore changes smaller than this, so a jittery sensor doesn’t spam re-renders.' },
  { path: 'binding.transition', control: 'select', options: ['none', 'ease', 'linear'], tier: 'advanced', group: 'Bindings', default: 'none', tooltip: 'Animates value changes instead of snapping instantly.' },
  { path: 'binding.unit', control: 'text', tier: 'advanced', group: 'Bindings', default: undefined, tooltip: 'Unit the SimVar is requested in (e.g. "knots", "degrees").' },
  { path: 'binding.ackEvent', control: 'eventPicker', tier: 'advanced', group: 'Bindings', default: undefined, tooltip: 'Deck Event dispatched by an Acknowledge Indicator action targeting this component.' },
  { path: 'binding.pushEvent', control: 'eventPicker', tier: 'advanced', group: 'Bindings', default: undefined, tooltip: 'Deck Event dispatched on press-and-hold, for spring-loaded/momentary controls.' },
  { path: 'binding.eventCategory', control: 'text', tier: 'advanced', group: 'Bindings', default: undefined, tooltip: 'Groups related Deck Events for the event picker’s filtering — cosmetic, doesn’t affect behavior.' }
];

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
    // matching the hand-coded panel's own conditionals (StudioInspector.js:2647-2649)
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
    { path: 'binding.testStateVar', control: 'stateVarPicker', tier: 'advanced', group: 'Bindings', appliesTo: ['core.indicator'], default: undefined, tooltip: 'Local state[] variable that, when true, forces this indicator lit regardless of its own bound value — for a "press to test" lamp-test button. Wire the same var into every indicator that should participate.' }
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
  'core.rotary': [
    // Wave 1 gap-closing pass (2026-09-04): default was `false`, but
    // RotaryComponent.js:19 computes `props.circular !== false` — the knob is circular
    // (continuous spin) *unless* explicitly set to false, so the effective default is
    // true, not false. Registry had this backwards.
    { path: 'props.circular', control: 'checkbox', tier: 'simple', group: 'Content', default: true, tooltip: 'Allows the knob to spin continuously instead of stopping at endpoints.' },
    { path: 'props.coarseStep', control: 'number', tier: 'simple', guided: true, group: 'Content', default: 10, tooltip: 'Value change per full knob detent.' },
    { path: 'props.fineStep', control: 'number', tier: 'advanced', group: 'Content', default: 1, tooltip: 'Value change per small drag increment, for fine adjustment.' },
    { path: 'props.pushLabel', control: 'text', tier: 'advanced', group: 'Content', default: undefined, tooltip: 'Label shown for this knob’s push/click action, if it has one.' }
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
    // have, so it stays intentionally hand-rendered (see StudioInspector.js's
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
// widget-studio/js/StudioInspector.js (which state-style editor section to
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
