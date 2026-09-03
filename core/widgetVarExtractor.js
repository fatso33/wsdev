/**
 * widgetVarExtractor.js
 * Scans an FDWS widget definition for the logical Deck Event identifiers it
 * references. Originally pc-bridge-only (used server-side to auto-register
 * placeholder profile mappings the moment a new custom widget is installed —
 * see pc-bridge/widgetVarRegistry.js), this logic has no Node/pc-bridge
 * dependency and now lives here so PWA and Widget Studio can run the exact
 * same scan client-side, to build the "custom Deck Events already in use by
 * some other installed widget" list for the binding editor's custom-mode
 * dropdown (see flight-deck-pwa/js/ui/PropertyInspector.js and
 * widget-studio/js/StudioInspector.js).
 *
 * Only bare, unprefixed identifiers (e.g. "panelBrightnessLevel",
 * "xpndrModeSet") go through this scan. FDWS v1.2 §1.5 raw-namespaced
 * identifiers (`A:`, `L:`, `H:`, `K:` prefixes) are already real
 * SimConnect/L-var names — they bypass the Deck Event indirection entirely
 * and aren't part of this scan. (Still current under FDWS v1.4 — neither
 * v1.3, Widget Popovers only, nor v1.4, which formalizes `revision` and
 * clarifies that bare names are host-defined rather than raw `A:` SimVars,
 * touches this namespace.)
 */

const PREFIXED_RE = /^(A|L|H|K):/i;

export function isBareIdentifier(name) {
  return typeof name === 'string' && name.length > 0 && !PREFIXED_RE.test(name);
}

/**
 * Recursively walks a components[] tree (including core.list itemTemplate
 * subtrees and core.container children) collecting logical readSimVar names
 * (reads) and writeEvent/pushEvent/ackEvent/zone-writeEvent names (writes).
 */
function walkComponents(components, reads, writes) {
  if (!Array.isArray(components)) return;

  for (const comp of components) {
    const binding = comp.binding;
    if (binding) {
      if (isBareIdentifier(binding.readSimVar)) reads.add(binding.readSimVar);
      if (isBareIdentifier(binding.writeEvent)) writes.add(binding.writeEvent);
      if (isBareIdentifier(binding.pushEvent)) writes.add(binding.pushEvent);
      if (isBareIdentifier(binding.ackEvent)) writes.add(binding.ackEvent);
    }

    // core.rocker: each zone carries its own writeEvent instead of binding.writeEvent
    const zones = comp.props?.zones;
    if (Array.isArray(zones)) {
      for (const zone of zones) {
        if (isBareIdentifier(zone?.writeEvent)) writes.add(zone.writeEvent);
      }
    }

    // Nested trees: core.container children, core.list itemTemplate
    if (Array.isArray(comp.components)) walkComponents(comp.components, reads, writes);
    if (Array.isArray(comp.itemTemplate?.components)) walkComponents(comp.itemTemplate.components, reads, writes);
  }
}

/**
 * Extracts every logical (bare, unprefixed) Deck Event name a widget
 * definition references — from component bindings, state[].syncFrom, and
 * its own declared capabilities[] manifest (union of all three; a widget
 * need not declare `capabilities` for this to work).
 * @param {object} widgetDef - A parsed FDWS widget definition (kind: "widget" or "popover")
 * @returns {{ reads: string[], writes: string[] }}
 */
export function extractWidgetVariables(widgetDef) {
  const reads = new Set();
  const writes = new Set();

  if (!widgetDef || typeof widgetDef !== 'object') {
    return { reads: [], writes: [] };
  }

  walkComponents(widgetDef.components, reads, writes);

  for (const st of widgetDef.state || []) {
    if (st && st.syncFrom && st.type !== 'array' && isBareIdentifier(st.syncFrom)) {
      reads.add(st.syncFrom);
    }
  }

  for (const name of widgetDef.capabilities?.readSimVars || []) {
    if (isBareIdentifier(name)) reads.add(name);
  }
  for (const name of widgetDef.capabilities?.writeEvents || []) {
    if (isBareIdentifier(name)) writes.add(name);
  }

  // FDWS v1.27 (1.0-A): widget-declared Deck Events are a fourth source, and
  // the only one that also carries a SUGGESTED binding. That suggestion is what
  // lets an installed widget arrive already mapped instead of leaving a row of
  // empty placeholders for the user to fill in.
  const suggestions = {};
  for (const entry of widgetDef.deckEvents || []) {
    if (!entry || !isBareIdentifier(entry.name)) continue;
    (entry.kind === 'write' ? writes : reads).add(entry.name);
    if (entry.suggest) {
      suggestions[entry.name] = { ...entry.suggest, kind: entry.kind, label: entry.label, category: entry.category };
    }
  }

  // `suggestions` is additive: the two long-standing callers (pc-bridge's
  // auto-registration and both apps' picker UIs) destructure { reads, writes }
  // and keep working untouched.
  return { reads: [...reads], writes: [...writes], suggestions };
}

/**
 * Scans a whole set of widget definitions and returns the deduplicated
 * "custom" Deck Events they collectively reference — i.e. everything not
 * already in `defaultNames` (typically DECK_EVENT_NAMES from
 * shared/deckEvents.js). Each entry also lists which widget id(s)
 * introduced it, for a "used by" hint in a picker UI.
 * @param {object[]} widgetDefs
 * @param {Set<string>|string[]} defaultNames
 * @returns {{ name: string, kind: 'read'|'write', widgetIds: string[] }[]}
 */
export function extractCustomDeckEvents(widgetDefs, defaultNames) {
  const defaults = defaultNames instanceof Set ? defaultNames : new Set(defaultNames);
  const byName = new Map(); // name -> { name, kind, widgetIds: Set }

  for (const widgetDef of widgetDefs || []) {
    const { reads, writes } = extractWidgetVariables(widgetDef);
    const widgetId = widgetDef?.id || null;

    for (const name of reads) {
      if (defaults.has(name)) continue;
      addCustomEntry(byName, name, 'read', widgetId);
    }
    for (const name of writes) {
      if (defaults.has(name)) continue;
      addCustomEntry(byName, name, 'write', widgetId);
    }
  }

  return [...byName.values()].map((e) => ({ ...e, widgetIds: [...e.widgetIds] }));
}

function addCustomEntry(byName, name, kind, widgetId) {
  let entry = byName.get(name);
  if (!entry) {
    entry = { name, kind, widgetIds: new Set() };
    byName.set(name, entry);
  }
  if (widgetId) entry.widgetIds.add(widgetId);
}
