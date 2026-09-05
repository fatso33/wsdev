/**
 * StudioValidator.js
 * Comprehensive FDWS v1.14 Specification Validator
 * Enforces all normative rules from the FDWS v1.14 Specification (§11 and
 * Appendix A), including the v1.0-v1.13 baseline rules v1.14 leaves untouched.
 */

import { parseStateRef } from '../widgets/utils/StateRefPath.js';
import { DECK_EVENTS } from '../core/deckEvents.js';

/**
 * Post-implementation review §2: walks a visibleWhen/style.rules[].when/
 * interaction-condition expression ({allOf|anyOf:[...]} | {state, ...}) and
 * returns every leaf `state` path string found, however deeply nested under
 * allOf/anyOf. Same grammar shared/widgets/components/ConditionEvaluator.js's
 * evaluateConditionExpr() walks at runtime — kept here as the one place that
 * needs to enumerate rather than evaluate the leaves.
 * @param {object} expr
 * @param {Array<string>} out
 * @returns {Array<string>}
 */
function collectConditionStateRefs(expr, out = []) {
  if (!expr || typeof expr !== 'object') return out;
  if (Array.isArray(expr.allOf)) { expr.allOf.forEach((e) => collectConditionStateRefs(e, out)); return out; }
  if (Array.isArray(expr.anyOf)) { expr.anyOf.forEach((e) => collectConditionStateRefs(e, out)); return out; }
  if (typeof expr.state === 'string' && expr.state) out.push(expr.state);
  return out;
}
// Widget Studio 2.0, Phase 0: these were four separate hand-maintained arrays
// (here, and their real-runtime counterparts in PropertyRegistry.js/
// InteractionDispatcher.js) with no check that they agreed — the exact "UI list
// is stale relative to runtime" bug found four times in one earlier audit
// session (interaction types, value formats, custom bindings, triggers). Now
// re-exported as static properties (unchanged call sites in StudioInspector.js)
// but backed by one literal array each, in PropertyRegistry.js.
import { DECK_EVENT_NAMES } from '../core/deckEvents.js';

// FDWS v1.27: PC Bridge's WRITE encodings — deliberately not PropertyRegistry's
// VALUE_FORMATS, which is the display-formatter set. See the same note in
// shared/SecurityValidator.js.
const WRITE_VALUE_FORMATS = ['HZ_INT', 'KHZ_INT', 'MHZ_FLOAT', 'BCD_HEX', 'RAW_INT', 'FIXED_0', 'FIXED_1'];

import {
  FDWS_VERSIONS,
  ACTIONS,
  VALUE_FORMATS as REGISTRY_VALUE_FORMATS,
  ALLOWED_ASSET_MIME_TYPES,
  getComponentTypes,
  getStateStyleConfig,
  getFieldsForType
} from '../widgets/PropertyRegistry.js';

// A gradient CSS value pasted into a *.color field (background.color most
// commonly — that field pairs a native color-picker input with a free-text
// sibling, and the free text accepts anything) still saves and even paints
// correctly the one time, since it's valid CSS either way — but
// ThemeColor.js can't find an actual color inside a gradient string to
// re-derive for the other theme, so the light/dark counterpart silently
// comes out identical instead of adapting. Caught live on a real widget.
const GRADIENT_VALUE_RE = /^(?:repeating-)?(?:linear|radial|conic)-gradient\(/i;

// Wave 0a (V20): component types whose own runtime component class dispatches
// binding.writeEvent itself (no interaction row required) — see the comment
// at its one call site below for how this was verified.
export const SELF_DISPATCHING_WRITE_EVENT_TYPES = ['core.input', 'core.selector', 'core.slider'];

/**
 * Wave 0a (V20): does an interaction already exist that would dispatch
 * comp.binding.writeEvent? A core.dispatchEvent action with no `event` of
 * its own falls back to this field at runtime (InteractionDispatcher.js),
 * so a blank-event row counts as consuming it too. Extracted here (Part 5a)
 * so the Connect dialog (StudioInspector.js) can call the exact same check
 * the validator's own blocking-issue detection uses, instead of a second,
 * driftable copy.
 * @param {object} comp
 * @returns {boolean}
 */
export function isWriteEventConsumed(comp) {
  if (!comp.binding?.writeEvent) return true;
  return Array.isArray(comp.interactions) && comp.interactions.some((i) => (
    i.action?.type === 'core.dispatchEvent'
    && (!i.action.event || i.action.event.trim() === comp.binding.writeEvent.trim())
  ));
}

/**
 * Wave 3, Part 7 item 3 (V15): "does this component look configured, or is it
 * the same blank state a fresh palette drop leaves it in?" — the affordance
 * StudioCanvas.js/StudioLayersPanel.js both need to render a dashed "not
 * connected" cue, so it lives here once rather than twice.
 *
 * Deliberately scoped to the 4 types where "no read binding and no write
 * mechanism" is unambiguous: core.display/core.indicator (readSimVar/stateVar-
 * driven), core.input (readSimVar/writeEvent/stateVar-driven), core.button
 * (stateRef/sublabelStateRef OR interactions-driven). core.label is NOT
 * included even though binding.readSimVar etc. are technically available to
 * it (COMMON_FIELDS has no appliesTo restriction) — an unbound label is its
 * normal, intentional static-text state (LabelComponent.js only overrides
 * props.text when a bound value actually arrives), not a broken one. Every
 * other type is left alone too — they either always ship with a real
 * deliberate demo binding (untouched by the Part 7 items 2/4 seed-neutraling
 * fix) or use a materially different wiring shape (core.rocker's per-zone
 * props.zones[].writeEvent) that would need its own dedicated look.
 *
 * Deliberately does not attempt to reconcile with validate()'s own
 * UNWIRED_WRITE_EVENT warning — a component can trip both, and that's fine,
 * they're complementary surfaces (a passive canvas/tree cue vs. an active
 * Validate-panel check) not a single source of truth to keep in lockstep.
 * @param {object} comp
 * @returns {boolean}
 */
export function isComponentUnconfigured(comp) {
  const b = comp.binding || {};
  switch (comp.type) {
    case 'core.display':
    case 'core.indicator':
      return !b.readSimVar && !b.stateVar;
    case 'core.input':
      return !b.readSimVar && !b.writeEvent && !b.stateVar;
    case 'core.button':
      return !b.stateRef && !b.sublabelStateRef && (comp.interactions || []).length === 0;
    default:
      return false;
  }
}

// Wave 4, §10.4: component-root keys that are real and known but never
// FIELDS-declared, because a wholly bespoke editor owns them entirely
// (interactions via the Add/Edit Interaction modal, layout via canvas
// drag/resize + the Grid Position & Size panel, layer via hand-coded fields).
// visibleWhen IS registry-declared (one atomic path) so it's covered by the
// exact-path check below without needing to be listed here.
const COMPONENT_KNOWN_STRUCTURAL_KEYS = new Set(['id', 'type', 'label', 'interactions', 'layout', 'layer', 'visibleWhen']);

// Every top-level `def` key that exists today, across every UI surface that
// owns one (the 6 widget-root Inspector accordions plus StudioLayersPanel's
// Layers/State/Assets tabs) — see project docs for the per-section census.
const DEF_KNOWN_TOP_LEVEL_KEYS = new Set([
  'fdws', 'schemaVersion', 'id', 'revision', 'kind', 'meta', 'layout', 'style',
  'baseTheme', 'themeMode', 'deckEvents', 'capabilities', 'layerGroups', 'state',
  'components', 'assets'
]);

/**
 * Wave 4, §10.4: finds JSON keys on a component that this build's registry
 * doesn't declare — imported from a newer Studio, or hand-authored — so they
 * can be surfaced instead of silently doing nothing. Deep-scans only
 * `props`/`binding`/`style`, since that's where FDWS has actually grown new
 * fields historically; `style.rules`/`style.states` are each declared as ONE
 * atomic path even though their own contents are dynamically-keyed by design,
 * so the walk stops the instant it hits a declared path — it never recurses
 * past one, or every real rule/state would false-positive as "unrecognised."
 * @param {object} comp
 * @returns {{props: Array<{path,value}>, binding: Array<{path,value}>, style: Array<{path,value}>, other: Array<{path,value}>}}
 */
export function findUnrecognisedComponentPaths(comp) {
  const fields = getFieldsForType(comp.type);
  const exact = new Set(fields.map((f) => f.path));
  const prefixes = new Set();
  exact.forEach((p) => {
    const segs = p.split('.');
    for (let i = 1; i < segs.length; i++) prefixes.add(segs.slice(0, i).join('.'));
  });

  const walk = (obj, prefix, out) => {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    Object.keys(obj).forEach((key) => {
      const path = `${prefix}.${key}`;
      if (exact.has(path)) return;
      if (prefixes.has(path)) { walk(obj[key], path, out); return; }
      out.push({ path, value: obj[key] });
    });
  };

  const result = { props: [], binding: [], style: [], other: [] };
  ['props', 'binding', 'style'].forEach((key) => walk(comp[key], key, result[key]));
  Object.keys(comp).forEach((key) => {
    if (!COMPONENT_KNOWN_STRUCTURAL_KEYS.has(key) && key !== 'props' && key !== 'binding' && key !== 'style') {
      result.other.push({ path: key, value: comp[key] });
    }
  });
  return result;
}

/**
 * Wave 4, §10.4: same idea as findUnrecognisedComponentPaths but for the
 * widget-root definition object — shallow, top-level-keys-only. Unlike
 * component fields, def.meta/def.style/def.layout's own internals are
 * hand-coded in renderWidgetInspector() with no registry backing, so a real
 * deep diff would mean hand-maintaining a second, undrift-checked allowlist
 * for marginal benefit (widget-root style has grown far less than component
 * style historically) — a deliberate scope boundary, not an oversight.
 * @param {object} def
 * @returns {Array<{path,value}>}
 */
export function findUnrecognisedDefPaths(def) {
  return Object.keys(def)
    .filter((k) => !DEF_KNOWN_TOP_LEVEL_KEYS.has(k))
    .map((k) => ({ path: k, value: def[k] }));
}

/**
 * Wave 0b (V20 export block), moved here Part 5a so both StudioMenuBar's
 * export-time "Wire this up" flow AND the Connect dialog can propose the
 * same correct trigger(s) — only for component types where a single
 * correct trigger genuinely exists. Excluded deliberately:
 * core.input/core.selector/core.slider never reach this at all (they
 * self-dispatch binding.writeEvent, see SELF_DISPATCHING_WRITE_EVENT_TYPES
 * above); core.rocker has no sensible single-trigger fix (it reads a
 * completely different field, props.zones[].writeEvent) so it falls
 * through to `null` here too. Each row deliberately leaves `action.event`
 * unset — it rides the same fallback-to-binding.writeEvent precedence
 * `isWriteEventConsumed()` above already checks for, so a later Connect
 * re-pick of the write event doesn't orphan an already-wired interaction.
 * @param {object} comp
 * @returns {Array<{trigger: string, action: {type: string}}>|null}
 */
export function proposeWireUp(comp) {
  const row = (trigger) => ({ trigger, action: { type: 'core.dispatchEvent' } });
  switch (comp.type) {
    case 'core.button':
      return [row('tap')];
    case 'core.rotary': {
      const rows = [row('fineChange')];
      if (comp.binding?.pushEvent) rows.push(row('push'));
      return rows;
    }
    case 'core.stepper':
      return [row('increment'), row('decrement')];
    case 'core.list':
      return [row('itemTap')];
    case 'core.pad':
      // PadComponent only fires positionChange in absolute mode (the
      // default relative mode fires panDelta instead) — proposing the
      // wrong one would pass this validator's check but never fire.
      return [row(comp.props?.mode === 'absolute' ? 'positionChange' : 'panDelta')];
    default:
      return null;
  }
}

export class StudioValidator {
  // Widget Studio 2.0, Phase 0 (adjustment pass): this was a fourth
  // hand-copied list, separate from PropertyRegistry.js's TYPE_FIELDS, that
  // the original Phase 0 pass missed — adding a new component type (e.g. the
  // planned concentric dual-rotary knob) meant remembering to update it here
  // too. Now derived from the registry directly.
  static CORE_COMPONENT_TYPES = getComponentTypes();

  static CORE_ACTION_TYPES = ACTIONS.map((a) => a.type);

  static VALUE_FORMATS = REGISTRY_VALUE_FORMATS;

  static ALLOWED_MIME_TYPES = ALLOWED_ASSET_MIME_TYPES;

  /**
   * Validates a complete Widget Definition against FDWS v1.1
   * @param {object} def
   * @returns {{ valid: boolean, errors: string[], warnings: string[], blockingIssues: Array<{code: string, componentId: string, message: string}>, capabilitiesSummary: { readSimVars: string[], writeEvents: string[] } }}
   */
  static validate(def) {
    const errors = [];
    const warnings = [];
    // Wave 0b (V20): a small, separately-typed subset of "real" issues that
    // can gate an action (export) beyond just warning about them — a
    // dedicated `code`, not a string-match against `warnings[]`, since this
    // is the one push site this validator already fully controls. Additive:
    // warnings/errors keep their existing flat-string shape for every other
    // consumer (the live badge, the report modal).
    const blockingIssues = [];

    if (!def || typeof def !== 'object') {
      return { valid: false, errors: ['Widget Definition must be a valid JSON object.'], warnings: [], blockingIssues: [], capabilitiesSummary: { readSimVars: [], writeEvents: [] } };
    }

    // 1. Top-Level Specification Envelope
    if (!FDWS_VERSIONS.includes(def.fdws)) {
      errors.push(`Invalid "fdws" version: "${def.fdws}". Must be one of: ${FDWS_VERSIONS.map((v) => `"${v}"`).join(', ')}.`);
    }

    // FDWS v1.3: kind discriminates a normal placeable widget from a "popover" widget
    // (opened only via core.openWidgetPopover). Missing kind is treated as "widget".
    if (def.kind !== undefined && !['widget', 'popover'].includes(def.kind)) {
      warnings.push(`Unknown "kind": "${def.kind}". Expected "widget" or "popover"; will be treated as "widget".`);
    }

    if (!def.schemaVersion || typeof def.schemaVersion !== 'string') {
      errors.push('Missing or invalid "schemaVersion" (must be semver string, e.g. "1.1.0").');
    }

    // FDWS v1.27: widget-declared Deck Events. Checked here as well as in
    // SecurityValidator so an author sees the problem while authoring, rather
    // than at import time on another machine — the same reason 0.2-D moved
    // binding validation into the Studio box.
    if (def.deckEvents !== undefined) {
      if (!Array.isArray(def.deckEvents)) {
        errors.push('"deckEvents" must be an array (FDWS v1.27).');
      } else {
        const seen = new Set();
        def.deckEvents.forEach((entry, i) => {
          const where = `deckEvents[${i}]`;
          if (!entry || typeof entry !== 'object') {
            errors.push(`${where} must be an object.`);
            return;
          }
          const name = typeof entry.name === 'string' ? entry.name.trim() : '';
          if (!name) {
            errors.push(`${where} is missing a "name".`);
            return;
          }
          // Tracked so the namespace *advice* below stays quiet on a name that
          // is already rejected outright — suggesting
          // "fenix.A:TRANSPONDER IDENT:1" is noise, and a validator that emits
          // absurd advice alongside a real error is how warnings get ignored.
          let nameRejected = false;
          if (/^[ALHK]:/i.test(name)) {
            errors.push(`${where} "${name}" is a raw address, not a Deck Event — raw addresses bypass profiles entirely and need no declaration.`);
            nameRejected = true;
          }
          if (DECK_EVENT_NAMES.includes(name)) {
            errors.push(`${where} "${name}" collides with a built-in Deck Event. Namespace yours instead, e.g. "myaircraft.${name}".`);
            nameRejected = true;
          }
          if (seen.has(name)) {
            errors.push(`${where} declares "${name}" more than once.`);
          }
          seen.add(name);
          if (entry.kind !== 'read' && entry.kind !== 'write') {
            errors.push(`${where} "${name}" needs "kind": "read" or "write".`);
          }
          if (!nameRejected && !name.includes('.')) {
            warnings.push(`Deck Event "${name}" isn't namespaced. Prefix it with your aircraft or pack (e.g. "fenix.${name}") so two authors can't claim the same name (FDWS v1.27 §2).`);
          }
          const suggest = entry.suggest;
          if (suggest !== undefined) {
            if (typeof suggest !== 'object' || suggest === null) {
              errors.push(`${where} "${name}" has a non-object "suggest".`);
            } else if (entry.kind === 'write') {
              if (suggest.valueFormat !== undefined && !WRITE_VALUE_FORMATS.includes(suggest.valueFormat)) {
                errors.push(`${where} "${name}" suggests unknown valueFormat "${suggest.valueFormat}". Expected one of: ${WRITE_VALUE_FORMATS.join(', ')}.`);
              }
              if (!suggest.event) {
                warnings.push(`Deck Event "${name}" has a "suggest" with no "event" — it will install as an empty row.`);
              }
            } else if (entry.kind === 'read') {
              if (!suggest.simvar) {
                warnings.push(`Deck Event "${name}" has a "suggest" with no "simvar" — it will install as an empty row.`);
              } else if (!suggest.unit) {
                warnings.push(`Deck Event "${name}" suggests "${suggest.simvar}" with no unit — PC Bridge will default to "number", which is wrong for a text variable (use "string") and for most dimensioned ones.`);
              }
            }
          }
        });
      }
    }

    if (!def.id || typeof def.id !== 'string') {
      errors.push('Missing widget "id".');
    } else if (!/^[a-z0-9]+(\.[a-z0-9-]+)+$/i.test(def.id)) {
      warnings.push(`Widget "id" ("${def.id}") should follow reverse-DNS style (e.g. "com.author.widgetname").`);
    }

    if (typeof def.revision !== 'number' || def.revision < 1) {
      warnings.push('Widget "revision" should be an integer >= 1.');
    }

    // FDWS v1.18: baseTheme/themeMode — same graceful-degradation posture as
    // "kind" above (a malformed value only warns, never errors), matching
    // SecurityValidator.validateFDWSDefinition()'s identical check on the
    // actual import/security gate.
    if (def.baseTheme !== undefined && !['dark', 'light'].includes(def.baseTheme)) {
      warnings.push(`Unknown "baseTheme": "${def.baseTheme}". Expected "dark" or "light"; will be treated as "dark".`);
    }
    if (def.themeMode !== undefined && !['auto', 'manual'].includes(def.themeMode)) {
      warnings.push(`Unknown "themeMode": "${def.themeMode}". Expected "auto" or "manual"; will be treated as "auto".`);
    }

    // FDWS v1.19 §1.5: authoring-time shape hint only — StudioMenuBar's import
    // flow is what actually unpacks "popovers" into the local library and
    // strips it off the loaded def, so this never round-trips into the
    // editor itself. Non-blocking, same posture as the kind/baseTheme checks
    // above.
    if (def.popovers !== undefined) {
      if (!Array.isArray(def.popovers)) {
        warnings.push('"popovers" should be an array of embedded popover-kind widget definitions.');
      } else {
        def.popovers.forEach((p, idx) => {
          if (!p || typeof p !== 'object' || !p.id) {
            warnings.push(`Embedded popover [${idx}] is missing an "id".`);
          }
        });
      }
    }

    // 2. Meta Information
    if (!def.meta || typeof def.meta !== 'object') {
      errors.push('Missing "meta" object.');
    } else {
      if (!def.meta.name || typeof def.meta.name !== 'string') {
        errors.push('Missing "meta.name" (widget display title).');
      } else if (def.meta.name.length > 64) {
        warnings.push('"meta.name" exceeds standard 64-character limit.');
      }

      if (!def.meta.category || typeof def.meta.category !== 'string') {
        warnings.push('Missing "meta.category" (e.g. Avionics, Controls, Gauges, Alerts).');
      }
    }

    // 3. Layout and Internal Sub-Grid
    if (!def.layout || typeof def.layout !== 'object') {
      errors.push('Missing "layout" object.');
    } else {
      const { defaultW, defaultH, minW, minH, maxW, maxH, grid } = def.layout;
      if (typeof defaultW !== 'number' || defaultW < 1 || defaultW > 44) {
        errors.push('"layout.defaultW" must be an integer between 1 and 44.');
      }
      if (typeof defaultH !== 'number' || defaultH < 1 || defaultH > 44) {
        errors.push('"layout.defaultH" must be an integer between 1 and 44.');
      }
      if (minW !== undefined && (typeof minW !== 'number' || minW < 1)) {
        warnings.push('"layout.minW" should be >= 1.');
      }
      if (minH !== undefined && (typeof minH !== 'number' || minH < 1)) {
        warnings.push('"layout.minH" should be >= 1.');
      }
      if (maxW !== undefined && (typeof maxW !== 'number' || maxW > 44)) {
        warnings.push('"layout.maxW" should be <= 44.');
      }
      if (maxH !== undefined && (typeof maxH !== 'number' || maxH > 44)) {
        warnings.push('"layout.maxH" should be <= 44.');
      }

      if (!grid || typeof grid !== 'object') {
        errors.push('Missing "layout.grid" (internal sub-grid specification).');
      } else {
        if (typeof grid.columns !== 'number' || grid.columns < 1 || grid.columns > 64) {
          errors.push('"layout.grid.columns" must be an integer between 1 and 64.');
        }
        if (typeof grid.rows !== 'number' || grid.rows < 1 || grid.rows > 64) {
          errors.push('"layout.grid.rows" must be an integer between 1 and 64.');
        }
      }
    }

    // 4. Layer Groups (v1.1)
    const validGroupIds = new Set();
    if (def.layerGroups) {
      if (!Array.isArray(def.layerGroups)) {
        errors.push('"layerGroups" must be an array.');
      } else {
        if (def.layerGroups.length > 16) {
          errors.push('"layerGroups" exceeds maximum limit of 16 groups (§9.3).');
        }
        def.layerGroups.forEach((lg, idx) => {
          if (!lg || typeof lg !== 'object') {
            errors.push(`Layer group at index ${idx} is invalid.`);
            return;
          }
          if (!lg.id || typeof lg.id !== 'string') {
            errors.push(`Layer group at index ${idx} missing required "id".`);
          } else {
            if (validGroupIds.has(lg.id)) {
              errors.push(`Duplicate layer group id: "${lg.id}".`);
            }
            validGroupIds.add(lg.id);
          }
          if (typeof lg.z !== 'number' || lg.z < -1000 || lg.z > 1000) {
            errors.push(`Layer group "${lg.id || idx}" has "z" out of allowed range [-1000, 1000].`);
          }
        });
      }
    }

    // 5. Local State Declarations
    const stateVarNames = new Set();
    if (def.state) {
      if (!Array.isArray(def.state)) {
        errors.push('"state" must be an array of state variable declarations.');
      } else {
        def.state.forEach((st, idx) => {
          if (!st || typeof st !== 'object') {
            errors.push(`State entry at index ${idx} is invalid.`);
            return;
          }
          if (!st.name || typeof st.name !== 'string') {
            errors.push(`State entry at index ${idx} missing "name".`);
          } else {
            stateVarNames.add(st.name);
          }
          if (!['string', 'number', 'boolean', 'list', 'array'].includes(st.type)) {
            warnings.push(`State variable "${st.name || idx}" type "${st.type}" should be "string", "number", "boolean", or "array".`);
          } else if (st.type === 'list') {
            warnings.push(`State variable "${st.name || idx}" uses type:"list", which FDWS's Appendix A schema does not define (the actual enum is "string"/"number"/"boolean"/"array" — FDWS v1.2 §3.2). Widget Studio no longer generates "list"; rename to "array" for spec conformance.`);
          }
          if (st.persist !== undefined && st.persist !== false && st.persist !== true && st.persist !== 'session') {
            warnings.push(`State variable "${st.name || idx}" has an invalid persist value ${JSON.stringify(st.persist)} — must be false, true, or "session" (FDWS v1.22).`);
          }
          if (st.type === 'array' && st.persist && st.persist !== false && st.syncFrom) {
            warnings.push(`State variable "${st.name || idx}" declares type:"array" with both persist:${JSON.stringify(st.persist)} and syncFrom — persist is disallowed for a live-synced array (FDWS v1.2 §3.2); a local-only array with no syncFrom may persist, durably or session-only (FDWS v1.21/v1.22).`);
          }
          // FDWS v1.7: pollFrequencyHz is a coarse rate hint, meaningful only
          // alongside syncFrom (a state var with no live sync has nothing to poll).
          if (st.pollFrequencyHz !== undefined) {
            if (typeof st.pollFrequencyHz !== 'number' || st.pollFrequencyHz <= 0) {
              warnings.push(`State variable "${st.name || idx}" has a non-numeric or non-positive pollFrequencyHz (${JSON.stringify(st.pollFrequencyHz)}).`);
            }
            if (!st.syncFrom) {
              warnings.push(`State variable "${st.name || idx}" declares pollFrequencyHz but no syncFrom — there's nothing being polled, so this has no effect.`);
            }
          }
          // FDWS v1.26: pollGroup is likewise only meaningful alongside syncFrom.
          if (st.pollGroup !== undefined) {
            if (typeof st.pollGroup !== 'string' || !st.pollGroup.trim()) {
              warnings.push(`State variable "${st.name || idx}" has a non-string or empty pollGroup (${JSON.stringify(st.pollGroup)}).`);
            }
            if (!st.syncFrom) {
              warnings.push(`State variable "${st.name || idx}" declares pollGroup but no syncFrom — there's nothing being polled, so this has no effect.`);
            }
          }
        });
      }
    }

    // 6. Assets Table & Limits (§9)
    const validAssetIds = new Set();
    const assetMimeById = new Map();
    let totalAssetBytes = 0;
    if (def.assets) {
      if (!Array.isArray(def.assets)) {
        errors.push('"assets" must be an array.');
      } else {
        def.assets.forEach((asset, idx) => {
          if (!asset || typeof asset !== 'object') {
            errors.push(`Asset at index ${idx} is invalid.`);
            return;
          }
          if (!asset.id || typeof asset.id !== 'string') {
            errors.push(`Asset at index ${idx} missing "id".`);
          } else {
            validAssetIds.add(asset.id);
            assetMimeById.set(asset.id, asset.mimeType);
          }
          if (!this.ALLOWED_MIME_TYPES.includes(asset.mimeType)) {
            warnings.push(`Asset "${asset.id || idx}" has unusual MIME type: "${asset.mimeType}". Allowed: ${this.ALLOWED_MIME_TYPES.join(', ')}.`);
          }
          if (asset.encoding !== 'base64') {
            errors.push(`Asset "${asset.id || idx}" encoding must be "base64".`);
          }
          if (asset.data && typeof asset.data === 'string') {
            const bytes = Math.round((asset.data.length * 3) / 4);
            totalAssetBytes += bytes;
            if (bytes > 2097152) {
              errors.push(`Asset "${asset.id}" exceeds 2MB limit (${(bytes / 1048576).toFixed(2)} MB) (§9.3).`);
            }
          }
        });
        if (totalAssetBytes > 20971520) {
          errors.push(`Total package asset size exceeds 20MB limit (${(totalAssetBytes / 1048576).toFixed(2)} MB) (§9.3).`);
        }
      }
    }

    // 7. Component Tree Validation
    const detectedReadSimVars = new Set();
    const detectedWriteEvents = new Set();
    const componentIds = new Set();
    const catalogReadNames = new Set(DECK_EVENTS.filter((e) => e.kind === 'read').map((e) => e.name));
    const catalogWriteNames = new Set(DECK_EVENTS.filter((e) => e.kind === 'write').map((e) => e.name));

    // 0.2-D: three explicit rules for a binding value (readSimVar/writeEvent/
    // ackEvent/pushEvent), replacing the old bare `.trim()` with no checks at
    // all (writeEvent/ackEvent/pushEvent) or a too-strict character class
    // that flagged every space-containing raw SimVar as "unusual"
    // (readSimVar's old /^[a-zA-Z0-9_:]+$/).
    //   1. Block on malformed — fails the identifier/address shape entirely
    //      (e.g. "1K:XPNDR_IDENT_ON" — a leading digit is invalid whether
    //      read as a bare name or a prefix escape hatch).
    //   2. Warn on well-formed but unrecognised (e.g. "XPNDR_IDNET_ON") — a
    //      likely typo, not a hard error.
    //   3. Never block a bare name just for being unrecognised —
    //      registerDiscoveredVars() (profileManager.js) exists precisely so
    //      a well-formed custom name works before any catalog entry exists
    //      for it. A raw prefixed address is never checked against the
    //      catalog at all — it's an escape hatch by design (FDWS v1.2 §1.5).
    const validateBindingValue = (compId, kind, rawValue, fieldLabel) => {
      const clean = rawValue.trim();
      const isPrefixed = /^(A|L|H|K):/i.test(clean);
      // No parens even for a prefixed simvar — same reasoning as
      // SecurityValidator.sanitizeWithReport(): they're forum/RPN paste
      // debris (e.g. a stray "(A:X, Bool)" wrapper), never part of a real
      // raw address.
      const shapeOk = isPrefixed
        ? (kind === 'simvar' ? /^[A-Za-z0-9_:.\-\s]+$/ : /^[A-Za-z0-9_:.\-]+$/).test(clean)
        : /^[A-Za-z_][A-Za-z0-9_.]*$/.test(clean);
      if (!shapeOk) {
        errors.push(`Component "${compId}" ${fieldLabel} "${clean}" is malformed — not a valid raw address (A:/L:/H:/K:...) or bare Deck Event name.`);
        return;
      }
      if (!isPrefixed) {
        const catalogNames = kind === 'simvar' ? catalogReadNames : catalogWriteNames;
        if (!catalogNames.has(clean)) {
          warnings.push(`Component "${compId}" ${fieldLabel} "${clean}" is not a recognised Deck Event — check spelling if this wasn't intentional (custom/discovered names are fine).`);
        }
      }
    };

    // Post-implementation review §2: binding.stateVar and
    // interactions[].action.fromStateRef were already cross-checked against
    // declared state[] vars, but binding.stateRef/sublabelStateRef,
    // style.rules[].when and visibleWhen use the identical grammar and were
    // silently unchecked — a widget whose conditional formatting can never
    // fire (undeclared state ref) validated as fully compliant. One helper,
    // reused at every site below (and to close a related gap: the existing
    // interaction-condition check only looked at the outer leaf, never
    // recursing into allOf/anyOf sub-conditions).
    const checkStateRefs = (compId, expr, siteLabel) => {
      collectConditionStateRefs(expr).forEach((ref) => {
        const parsed = parseStateRef(ref);
        if (!parsed) {
          warnings.push(`Component "${compId}" ${siteLabel} "${ref}" is not a valid path (expected e.g. "name" or "name[0].field").`);
        } else if (!stateVarNames.has(parsed.name)) {
          warnings.push(`Component "${compId}" ${siteLabel} references undeclared state variable "${parsed.name}".`);
        }
      });
    };

    const maxCols = def.layout?.grid?.columns || 64;
    const maxRows = def.layout?.grid?.rows || 64;

    if (!Array.isArray(def.components)) {
      errors.push('"components" must be an array of component definitions.');
    } else {
      // FDWS v1.2 §3.3: the 64-component hard cap is removed — components are governed
      // only by the payload-size limits (§9.3), not a count-based rejection.

      def.components.forEach((comp, idx) => {
        if (!comp || typeof comp !== 'object') {
          errors.push(`Component at index ${idx} is invalid.`);
          return;
        }

        // ID check
        if (!comp.id || typeof comp.id !== 'string') {
          errors.push(`Component at index ${idx} missing required "id".`);
        } else {
          if (componentIds.has(comp.id)) {
            errors.push(`Duplicate component ID: "${comp.id}". Each component ID must be unique within the widget.`);
          }
          componentIds.add(comp.id);
        }

        // Type check
        if (!comp.type || typeof comp.type !== 'string') {
          errors.push(`Component "${comp.id || idx}" missing "type".`);
        } else if (!this.CORE_COMPONENT_TYPES.includes(comp.type) && !comp.type.startsWith('vendor.')) {
          warnings.push(`Component "${comp.id}" uses non-standard type "${comp.type}". Will render as safe fallback placeholder.`);
        }

        // Layout / Coordinate check
        if (!comp.layout || typeof comp.layout !== 'object') {
          errors.push(`Component "${comp.id || idx}" missing "layout" coordinates.`);
        } else {
          const { col, row, w, h } = comp.layout;
          if (typeof col !== 'number' || col < 1) errors.push(`Component "${comp.id}" invalid col: ${col}. Must be >= 1.`);
          if (typeof row !== 'number' || row < 1) errors.push(`Component "${comp.id}" invalid row: ${row}. Must be >= 1.`);
          if (typeof w !== 'number' || w < 1) errors.push(`Component "${comp.id}" invalid w: ${w}. Must be >= 1.`);
          if (typeof h !== 'number' || h < 1) errors.push(`Component "${comp.id}" invalid h: ${h}. Must be >= 1.`);

          if (col && w && (col + w - 1 > maxCols)) {
            warnings.push(`Component "${comp.id}" extends beyond grid columns (col ${col} + w ${w} > ${maxCols}).`);
          }
          if (row && h && (row + h - 1 > maxRows)) {
            warnings.push(`Component "${comp.id}" extends beyond grid rows (row ${row} + h ${h} > ${maxRows}).`);
          }
        }

        // Layer checks (§11 Rule 6)
        if (comp.layer) {
          if (comp.layer.group && !validGroupIds.has(comp.layer.group)) {
            warnings.push(`Component "${comp.id}" references undeclared layer group: "${comp.layer.group}". Will fall back to flat layer.z.`);
          }
          if (typeof comp.layer.z === 'number' && (comp.layer.z < -1000 || comp.layer.z > 1000)) {
            warnings.push(`Component "${comp.id}" layer.z (${comp.layer.z}) is outside normal range [-1000, 1000].`);
          }
          if (comp.layer.pointerEvents && !['auto', 'none'].includes(comp.layer.pointerEvents)) {
            errors.push(`Component "${comp.id}" layer.pointerEvents must be "auto" or "none".`);
          }

          // Rule 6 Security constraint: interactions[] + pointerEvents: "none" is disallowed
          const hasInteractions = Array.isArray(comp.interactions) && comp.interactions.length > 0;
          if (hasInteractions && comp.layer.pointerEvents === 'none') {
            errors.push(`Security Rule (§11.6): Component "${comp.id}" declares interactions but has layer.pointerEvents: "none". Interactive components must receive pointer events.`);
          }
        }

        // Bindings check
        if (comp.binding) {
          if (comp.binding.readSimVar) {
            validateBindingValue(comp.id, 'simvar', comp.binding.readSimVar, 'readSimVar');
            detectedReadSimVars.add(comp.binding.readSimVar.trim());
          }
          if (comp.binding.writeEvent) {
            validateBindingValue(comp.id, 'event', comp.binding.writeEvent, 'writeEvent');
            detectedWriteEvents.add(comp.binding.writeEvent.trim());
            // Wave 0a (V20): InputComponent/SelectorComponent/SliderComponent
            // dispatch binding.writeEvent themselves (grep dispatchSimEvent
            // shared/widgets/components/*.js) — every other component type
            // (core.button among them) relies entirely on an interaction row
            // whose core.dispatchEvent action either leaves "event" blank
            // (falls back to this field, InteractionDispatcher.js:101) or
            // repeats it explicitly. Without one, the Inspector's "Write Deck
            // Event" field looks like a working connection and does nothing.
            if (!SELF_DISPATCHING_WRITE_EVENT_TYPES.includes(comp.type)) {
              if (!isWriteEventConsumed(comp)) {
                // Wave 0b: core.rocker never reads binding.writeEvent at all —
                // it dispatches per-zone via props.zones[].writeEvent instead
                // (RockerComponent.js) — so an interaction row here would
                // silence this warning without fixing anything real. Say so,
                // and don't offer the "Wire this up" auto-fix for this type
                // (StudioMenuBar.js's WIRE_UP_TABLE excludes core.rocker).
                const message = comp.type === 'core.rocker'
                  ? `Component "${comp.id}" sets binding.writeEvent ("${comp.binding.writeEvent}") but core.rocker never reads this field — each zone dispatches its OWN "Write Deck Event" (per-zone, in the zones list), independent of this one. This field currently does nothing; set it per-zone instead, or clear it.`
                  : `Component "${comp.id}" sets binding.writeEvent ("${comp.binding.writeEvent}") but this component type doesn't send it automatically, and no interaction dispatches it (add e.g. tap → "Dispatch Sim Event" with Event left blank to use this binding) — nothing on this component currently sends this value to the simulator.`;
                warnings.push(message);
                blockingIssues.push({ code: 'UNWIRED_WRITE_EVENT', componentId: comp.id, message });
              }
            }
          }
          if (comp.binding.ackEvent) {
            validateBindingValue(comp.id, 'event', comp.binding.ackEvent, 'ackEvent');
            detectedWriteEvents.add(comp.binding.ackEvent.trim());
          }
          if (comp.binding.pushEvent) {
            validateBindingValue(comp.id, 'event', comp.binding.pushEvent, 'pushEvent');
            detectedWriteEvents.add(comp.binding.pushEvent.trim());
          }
          // FDWS v1.3: a "$context.<key>.value" binding resolves against the popover's
          // injected host context at runtime, not this widget's own state[] — not an
          // undeclared-var warning candidate.
          if (comp.binding.stateVar && !comp.binding.stateVar.startsWith('$context.') && !stateVarNames.has(comp.binding.stateVar)) {
            warnings.push(`Component "${comp.id}" binds to undeclared state variable "${comp.binding.stateVar}".`);
          }
          // Post-implementation review §2: same nested-path grammar as
          // fromStateRef, previously unchecked.
          if (comp.binding.stateRef) checkStateRefs(comp.id, { state: comp.binding.stateRef }, 'binding.stateRef');
          if (comp.binding.sublabelStateRef) checkStateRefs(comp.id, { state: comp.binding.sublabelStateRef }, 'binding.sublabelStateRef');
          // FDWS v1.7
          if (comp.binding.pollFrequencyHz !== undefined && (typeof comp.binding.pollFrequencyHz !== 'number' || comp.binding.pollFrequencyHz <= 0)) {
            warnings.push(`Component "${comp.id}" has a non-numeric or non-positive binding.pollFrequencyHz (${JSON.stringify(comp.binding.pollFrequencyHz)}).`);
          }
          // FDWS v1.26
          if (comp.binding.pollGroup !== undefined && (typeof comp.binding.pollGroup !== 'string' || !comp.binding.pollGroup.trim())) {
            warnings.push(`Component "${comp.id}" has a non-string or empty binding.pollGroup (${JSON.stringify(comp.binding.pollGroup)}).`);
          }
        }

        // FDWS v1.5/v1.6: core.gauge.props.compose cross-checks — same
        // "declared but undeclared" pattern as binding.stateVar above, since
        // compose.stateVar/relativeToStateVar are also state[] references,
        // just reached through props instead of binding.
        if (comp.type === 'core.gauge' && comp.props?.compose) {
          const compose = comp.props.compose;
          if (!compose.stateVar) {
            errors.push(`Component "${comp.id}" declares props.compose without a required "stateVar".`);
          } else if (!stateVarNames.has(compose.stateVar)) {
            warnings.push(`Component "${comp.id}" props.compose.stateVar references undeclared state variable "${compose.stateVar}".`);
          }
          if (compose.relativeToStateVar && !stateVarNames.has(compose.relativeToStateVar)) {
            warnings.push(`Component "${comp.id}" props.compose.relativeToStateVar references undeclared state variable "${compose.relativeToStateVar}".`);
          }
          if (compose.transform && !['rotate', 'translate', 'arc-fill'].includes(compose.transform)) {
            warnings.push(`Component "${comp.id}" props.compose.transform "${compose.transform}" should be "rotate", "translate", or "arc-fill".`);
          }
        }

        // FDWS v1.20: core.gauge.props.transform: "arc" cross-checks —
        // authoring-time shape hints only, GaugeComponent.renderArc()/update()
        // already degrade gracefully (Number(...) || default) on any of these
        // being missing or malformed, so nothing here is a hard error.
        if (comp.type === 'core.gauge' && comp.props?.transform === 'arc') {
          const arc = comp.props.arc || {};
          if (Number(arc.startAngle) === Number(arc.endAngle)) {
            warnings.push(`Component "${comp.id}" has an Arc with Start Angle equal to End Angle — the sweep has zero width and will render as a single point.`);
          }
          if (Array.isArray(arc.bands)) {
            arc.bands.forEach((band, idx) => {
              const from = Number(band?.from);
              const to = Number(band?.to);
              if (Number.isNaN(from) || Number.isNaN(to) || to <= from) {
                warnings.push(`Component "${comp.id}" Arc zone band #${idx + 1} has "to" (${band?.to}) not greater than "from" (${band?.from}) — it won't render.`);
              }
              if (from < 0 || from > 1 || to < 0 || to > 1) {
                warnings.push(`Component "${comp.id}" Arc zone band #${idx + 1} should use 0–1 ratios of the Value Range, not raw values or angles (got from=${band?.from}, to=${band?.to}).`);
              }
            });
          }
        }

        // Interactions check
        if (comp.interactions && Array.isArray(comp.interactions)) {
          comp.interactions.forEach((inter, interIdx) => {
            if (!inter.trigger) {
              warnings.push(`Component "${comp.id}" interaction #${interIdx + 1} missing trigger.`);
            }
            if (inter.action) {
              if (inter.action.event) {
                validateBindingValue(comp.id, 'event', inter.action.event, `interaction #${interIdx + 1} action.event`);
                detectedWriteEvents.add(inter.action.event.trim());
              }
              if (!this.CORE_ACTION_TYPES.includes(inter.action.type)) {
                warnings.push(`Component "${comp.id}" interaction #${interIdx + 1} uses non-standard action type: "${inter.action.type}".`);
              }

              // FDWS v1.3 Widget Popovers: authoring-time shape hints (warning-only,
              // consistent with this validator's non-blocking whitelist checks).
              if (inter.action.type === 'core.openWidgetPopover' && !inter.action.popoverWidgetId) {
                warnings.push(`Component "${comp.id}" interaction #${interIdx + 1}: core.openWidgetPopover is missing "popoverWidgetId".`);
              }
              if (inter.action.type === 'core.commitToHost' && !inter.action.contextKey) {
                warnings.push(`Component "${comp.id}" interaction #${interIdx + 1}: core.commitToHost is missing "contextKey".`);
              }
              if (inter.action.type === 'core.commitToHost' && inter.action.field && !stateVarNames.has(inter.action.field)) {
                warnings.push(`Component "${comp.id}" interaction #${interIdx + 1}: core.commitToHost.field references undeclared state variable "${inter.action.field}".`);
              }
              // fromStateRef (core.setLocalState / core.dispatchEvent): reads via the
              // same "name[index].field" grammar popovers use — cross-check both that
              // it parses and that its base name is a declared state var, same pattern
              // as the commitToHost.field check above.
              if ((inter.action.type === 'core.setLocalState' || inter.action.type === 'core.dispatchEvent') && inter.action.fromStateRef) {
                const parsed = parseStateRef(inter.action.fromStateRef);
                if (!parsed) {
                  warnings.push(`Component "${comp.id}" interaction #${interIdx + 1}: ${inter.action.type}.fromStateRef "${inter.action.fromStateRef}" is not a valid path (expected e.g. "name" or "name[0].field").`);
                } else if (!stateVarNames.has(parsed.name)) {
                  warnings.push(`Component "${comp.id}" interaction #${interIdx + 1}: ${inter.action.type}.fromStateRef references undeclared state variable "${parsed.name}".`);
                }
              }

            }

            // FDWS v1.23: an interaction's optional `condition` — same shape as
            // visibleWhen/style.rules' `when` — gates whether the action (and
            // feedback) runs at all. Post-implementation review §2: the old
            // check here only looked at the outer leaf, so a compound
            // allOf/anyOf condition's nested state refs went unchecked —
            // checkStateRefs recurses, so this is a strict superset (still
            // catches the flat case, now also the nested one).
            if (inter.condition) {
              if (typeof inter.condition.state !== 'string' && !Array.isArray(inter.condition.allOf) && !Array.isArray(inter.condition.anyOf)) {
                warnings.push(`Component "${comp.id}" interaction #${interIdx + 1}: condition is missing "state" (or an allOf/anyOf list).`);
              } else {
                checkStateRefs(comp.id, inter.condition, `interaction #${interIdx + 1} condition`);
              }
            }
          });
        }

        // FDWS v1.14: props.presetSlot/emptyLabel and variant:"preset" were
        // removed from core.button entirely — superseded by
        // binding.stateRef/sublabelStateRef (the same nested-path mechanism
        // core.label already had, now generalized to buttons). None of these
        // do anything anymore; flag them so an old widget doesn't look
        // silently correct while its button never shows the text an author
        // expects.
        if (comp.type === 'core.button') {
          if (comp.props?.presetSlot !== undefined) {
            warnings.push(`Component "${comp.id}": props.presetSlot was removed in FDWS v1.14 and no longer has any effect — use binding.stateRef (Bind to Local State Path) instead, e.g. "presets[${comp.props.presetSlot}].freq".`);
          }
          if (comp.props?.emptyLabel !== undefined) {
            warnings.push(`Component "${comp.id}": props.emptyLabel was removed in FDWS v1.14 and no longer has any effect — set the Primary Label field instead; it's now used as the fallback whenever binding.stateRef resolves empty.`);
          }
          if (comp.props?.variant === 'preset') {
            warnings.push(`Component "${comp.id}": variant:"preset" was removed in FDWS v1.14 — pick a different Button Variant; it no longer changes any preset-related behavior (that's now driven entirely by binding.stateRef/sublabelStateRef, independent of variant).`);
          }
        }

        // Post-implementation review §2: style.rules[].when and visibleWhen
        // use the same condition grammar as interactions[].condition (which
        // was already cross-checked) but were silently unchecked — a rule/
        // visibility gate on an undeclared state var can never fire, and the
        // widget still validated as fully compliant.
        if (Array.isArray(comp.style?.rules)) {
          comp.style.rules.forEach((rule, i) => checkStateRefs(comp.id, rule?.when, `style.rules[${i}].when`));
        }
        if (comp.visibleWhen) {
          checkStateRefs(comp.id, comp.visibleWhen, 'visibleWhen');
        }

        // Asset Reference check
        if (comp.props?.assetId && !validAssetIds.has(comp.props.assetId)) {
          warnings.push(`Component "${comp.id}" references asset "${comp.props.assetId}" which is not present in package assets table.`);
        }
        if (comp.style?.background?.image?.assetId && !validAssetIds.has(comp.style.background.image.assetId)) {
          warnings.push(`Component "${comp.id}" background references missing asset "${comp.style.background.image.assetId}".`);
        }
        if (comp.style?.background?.type === 'color' && GRADIENT_VALUE_RE.test((comp.style.background.color || '').trim())) {
          warnings.push(`Component "${comp.id}" has a CSS gradient in Background Color, but Background Type is still "Solid Color" — it renders correctly in dark mode but won't adapt to light mode. Switch Background Type to "CSS Gradient" instead.`);
        }

        // FDWS v1.25 style.states cross-check: only one state name (if any)
        // is ever actually read for a given component type/variant — see
        // PropertyRegistry.js's STATE_STYLE_SUPPORT (BaseComponent.js's
        // applyStyles()/applyOptionalStateStyle() only ever look up
        // this.activeStateName, which for these component types is always
        // set to that one name). An author-typed key that doesn't match
        // (a typo, a name copied from a different component type, or a
        // component type with no state-style support at all, e.g.
        // core.label/core.display) sits in the file with no effect — flag it
        // here rather than let it look silently correct in Studio.
        if (comp.style?.states && typeof comp.style.states === 'object') {
          const supportedEntry = getStateStyleConfig(comp.type, comp.props);
          const supportedName = supportedEntry?.name;
          Object.keys(comp.style.states).forEach((stateName) => {
            if (stateName !== supportedName) {
              warnings.push(supportedName
                ? `Component "${comp.id}" declares style.states.${stateName}, but this component type/variant only ever reads style.states.${supportedName} — the ${stateName} entry has no effect.`
                : `Component "${comp.id}" declares style.states.${stateName}, but this component type has no interaction-state style support at all — it has no effect.`);
            }
          });
        }

        // FDWS v1.20 §2: renderMode:"inline" only has an effect on an svg+xml
        // asset — ImageComponent.js already degrades gracefully (falls back
        // to the normal <img> render) for any other MIME type, but that's
        // silent at runtime, so flag it here where the author can see it.
        if (comp.type === 'core.image' && comp.props?.renderMode === 'inline' && comp.props?.assetId) {
          const mime = assetMimeById.get(comp.props.assetId);
          if (mime && mime !== 'image/svg+xml') {
            warnings.push(`Component "${comp.id}" has Render Mode "Inline SVG" but its asset is "${mime}", not an SVG — it will render as a normal opaque image, and Text Color won't tint anything.`);
          }
        }
      });
    }

    // 8. Capabilities Cross-Check (§11 Rule 5)
    const declaredReadSimVars = new Set(def.capabilities?.readSimVars || []);
    const declaredWriteEvents = new Set(def.capabilities?.writeEvents || []);

    detectedReadSimVars.forEach((sv) => {
      if (!declaredReadSimVars.has(sv)) {
        warnings.push(`Binding declares readSimVar "${sv}" but it is not listed in capabilities.readSimVars.`);
      }
    });

    detectedWriteEvents.forEach((ev) => {
      if (!declaredWriteEvents.has(ev)) {
        warnings.push(`Interaction/binding fires event "${ev}" but it is not listed in capabilities.writeEvents.`);
      }
    });

    // 9. Manual theme-override "lost boundary" check (FDWS v1.18). A real
    // reported case: a widget root and an inset panel authored with two
    // clearly different dark backgrounds (a visible boundary between "bezel"
    // and "panel") got their style.themeOverride.background seeded near-
    // identically for the other theme — the two surfaces read as one merged
    // block there, even though nothing else about the widget changed. This
    // only fires in themeMode:"manual" (auto-derivation already keeps equal
    // raw colors equal and different raw colors different, per
    // ThemeColor.js's "surface" curve/themeAdjustComponentColors() unify-fix)
    // and only flags pairs whose BASE colors were meaningfully different —
    // two elements sharing the exact same base color are an intentional
    // "seamless surface" (see ThemeColor.js's own doc comment) and correctly
    // keep sharing the same override, so that pattern never warns here.
    if (def.themeMode === 'manual') {
      const surfaces = [];
      const collectSurface = (label, style) => {
        if (style?.background?.type === 'color' && typeof style.background.color === 'string') {
          const overrideColor = style.themeOverride?.background?.type === 'color' ? style.themeOverride.background.color : null;
          if (overrideColor) surfaces.push({ label, base: style.background.color, override: overrideColor });
        }
      };
      collectSurface('widget root', def.style);
      (def.components || []).forEach((comp) => collectSurface(`Component "${comp.id}"`, comp.style));

      const hexDistance = (a, b) => {
        const parse = (hex) => {
          const h = hex.replace('#', '');
          const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
          if (full.length !== 6) return null;
          return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
        };
        const pa = parse(a);
        const pb = parse(b);
        if (!pa || !pb || pa.some(Number.isNaN) || pb.some(Number.isNaN)) return null;
        return pa.reduce((sum, v, i) => sum + Math.abs(v - pb[i]), 0);
      };

      for (let i = 0; i < surfaces.length; i++) {
        for (let j = i + 1; j < surfaces.length; j++) {
          const a = surfaces[i];
          const b = surfaces[j];
          if (a.base.toLowerCase() === b.base.toLowerCase()) continue; // intentional shared surface
          const baseDist = hexDistance(a.base, b.base);
          const overrideDist = hexDistance(a.override, b.override);
          if (baseDist === null || overrideDist === null) continue;
          if (baseDist >= 24 && overrideDist <= 10) {
            warnings.push(`${a.label} and ${b.label} have distinct backgrounds in the base theme (${a.base} vs ${b.base}) but nearly identical manual theme overrides (${a.override} vs ${b.override}) — they may visually merge into one surface when the override theme renders.`);
          }
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      blockingIssues,
      capabilitiesSummary: {
        readSimVars: Array.from(detectedReadSimVars),
        writeEvents: Array.from(detectedWriteEvents)
      }
    };
  }

  /**
   * Automatically synchronizes capabilities table in widget definition
   * @param {object} def
   */
  static syncCapabilities(def) {
    if (!def) return;
    const readSimVars = new Set();
    const writeEvents = new Set();

    (def.components || []).forEach((c) => {
      if (c.binding?.readSimVar) readSimVars.add(c.binding.readSimVar.trim());
      if (c.binding?.writeEvent) writeEvents.add(c.binding.writeEvent.trim());
      if (c.binding?.ackEvent) writeEvents.add(c.binding.ackEvent.trim());
      if (c.binding?.pushEvent) writeEvents.add(c.binding.pushEvent.trim());
      if (Array.isArray(c.interactions)) {
        c.interactions.forEach((i) => {
          if (i.action?.event) writeEvents.add(i.action.event.trim());
        });
      }
    });

    if (!def.capabilities) def.capabilities = {};
    def.capabilities.readSimVars = Array.from(readSimVars);
    def.capabilities.writeEvents = Array.from(writeEvents);
  }

  /**
   * Groups a validate() result's flat error/warning strings by the component
   * ID each references (every per-component message is authored in the
   * consistent `Component "<id>" ...` shape above), so the canvas and layer
   * tree can badge individual components instead of only surfacing issues in
   * a separate report modal with no link back to what's actually wrong.
   * @param {{errors: string[], warnings: string[]}} result
   * @returns {Map<string, {errors: string[], warnings: string[]}>}
   */
  static mapIssuesByComponent(result) {
    const map = new Map();
    const record = (list, bucket) => {
      list.forEach((msg) => {
        const match = msg.match(/Component "([^"]+)"/);
        if (!match) return;
        const id = match[1];
        if (!map.has(id)) map.set(id, { errors: [], warnings: [] });
        map.get(id)[bucket].push(msg);
      });
    };
    record(result.errors || [], 'errors');
    record(result.warnings || [], 'warnings');
    return map;
  }
}
