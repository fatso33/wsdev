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
 *
 * Two views over the same traversal (walkBindingSites):
 *   - extractWidgetVariables() — the bare logical NAMES a widget references,
 *     for auto-registering profile rows and building picker lists.
 *   - extractBindingRows() / applyBindingRow() — the same sites as editable
 *     rows, for the PWA's per-component bindings list (Release 1.1-C), which
 *     needs to write a corrected name back to the exact place it came from.
 * Sharing one walker is deliberate: when these were about to become two
 * traversals, the second one immediately revealed that the first had been
 * missing `interactions[].action.event` — i.e. every button — since it was
 * written.
 */

const PREFIXED_RE = /^(A|L|H|K):/i;

export function isBareIdentifier(name) {
  return typeof name === 'string' && name.length > 0 && !PREFIXED_RE.test(name);
}

/**
 * Normalizes an interaction's action(s) to an array. FDWS widgets in the wild
 * use both shapes: `interactions[].action` (a single object — what every
 * shipped widget actually writes) and `interactions[].actions` (an array).
 * Reading only one of them silently skips the other.
 */
function actionsOf(interaction) {
  if (!interaction) return [];
  if (interaction.action) return [interaction.action];
  return Array.isArray(interaction.actions) ? interaction.actions : [];
}

/**
 * The single traversal every extractor here shares. Visits each component in
 * a components[] tree (including core.container children and core.list
 * itemTemplate subtrees) and reports every sim-facing binding site it carries,
 * via `visit(site)`.
 *
 * A "site" is one place a logical name lives, with enough information to write
 * a new one back — see extractBindingRows() for the row shape.
 *
 * ⚠ Local-state bindings (`stateVar`, `stateRef`) are deliberately NOT sites.
 * They address the widget's own state, never the sim, and listing them would
 * bury the handful of real sim bindings among dozens of irrelevant rows —
 * com12combo alone has 47 of them against 6 real ones.
 */
function walkBindingSites(components, visit, path = []) {
  if (!Array.isArray(components)) return;

  components.forEach((comp, i) => {
    const compPath = [...path, i];
    const at = (extra) => visit({
      compPath,
      componentId: comp.id || null,
      componentType: comp.type || null,
      componentLabel: comp.label || comp.props?.label || comp.id || comp.type || 'component',
      ...extra
    });

    const binding = comp.binding;
    if (binding) {
      if (binding.readSimVar) at({ kind: 'read', source: 'binding', field: 'readSimVar', name: binding.readSimVar });
      if (binding.writeEvent) at({ kind: 'write', source: 'binding', field: 'writeEvent', name: binding.writeEvent });
      if (binding.pushEvent) at({ kind: 'write', source: 'binding', field: 'pushEvent', name: binding.pushEvent });
      if (binding.ackEvent) at({ kind: 'write', source: 'binding', field: 'ackEvent', name: binding.ackEvent });
    }

    // core.rocker: each zone carries its own writeEvent instead of binding.writeEvent
    const zones = comp.props?.zones;
    if (Array.isArray(zones)) {
      zones.forEach((zone, zi) => {
        if (zone?.writeEvent) at({ kind: 'write', source: 'zone', field: 'writeEvent', index: zi, name: zone.writeEvent });
      });
    }

    // core.dispatchEvent actions. This is where a BUTTON's write lives — a
    // button's own `binding` is usually empty, so an extractor that reads only
    // `binding.*` misses every button in the library. That was a real gap: a
    // widget whose only sim write is a button tap (com1Swap, xpndrIdent, and
    // the custom THROTTLE1_SET) registered no placeholder profile row on
    // install, so the name resolved to nothing until someone added the row by
    // hand — the silent-failure mode this workstream exists to remove.
    (comp.interactions || []).forEach((interaction, ii) => {
      actionsOf(interaction).forEach((action, ai) => {
        if (action?.type === 'core.dispatchEvent' && action.event) {
          at({
            kind: 'write',
            source: 'interaction',
            field: 'event',
            index: ii,
            actionIndex: ai,
            trigger: interaction.trigger || interaction.on || null,
            value: action.value,
            name: action.event
          });
        }
      });
    });

    // Nested trees: core.container children, core.list itemTemplate
    if (Array.isArray(comp.components)) walkBindingSites(comp.components, visit, [...compPath, 'components']);
    if (Array.isArray(comp.itemTemplate?.components)) walkBindingSites(comp.itemTemplate.components, visit, [...compPath, 'itemTemplate']);
  });
}

/**
 * Collects the bare logical names out of a components[] tree. Thin wrapper
 * over walkBindingSites() so name collection and the per-row listing in
 * extractBindingRows() can never disagree about what counts as a binding.
 */
function walkComponents(components, reads, writes) {
  walkBindingSites(components, (site) => {
    if (!isBareIdentifier(site.name)) return;
    (site.kind === 'read' ? reads : writes).add(site.name);
  });
}

/**
 * Lists every sim-facing binding in a widget definition as an editable row —
 * one per binding site, not per component, since a single component can carry
 * both a read and a write.
 *
 * Unlike extractWidgetVariables(), this keeps PREFIXED names too (`A:`, `L:`,
 * `K:`, `H:`): a raw address is exactly the kind of binding someone needs to
 * inspect and fix, even though it bypasses the Deck Event layer and so has no
 * profile row to register.
 *
 * @param {object} widgetDef
 * @returns {Array<{compPath: Array, componentId: string|null, componentType: string|null,
 *   componentLabel: string, kind: 'read'|'write', source: 'binding'|'zone'|'interaction',
 *   field: string, index?: number, actionIndex?: number, trigger?: string|null,
 *   value?: number, name: string, isRaw: boolean}>}
 */
export function extractBindingRows(widgetDef) {
  if (!widgetDef || typeof widgetDef !== 'object') return [];
  const rows = [];
  walkBindingSites(widgetDef.components, (site) => {
    rows.push({ ...site, isRaw: !isBareIdentifier(site.name) });
  });
  return rows;
}

/**
 * Writes a new logical name back to the exact site a row came from, mutating
 * `widgetDef` in place. Lives beside the traversal on purpose: a caller that
 * reconstructed this path itself would silently target the wrong component the
 * first time the shape of a nested tree changed.
 * @returns {boolean} whether the write landed
 */
export function applyBindingRow(widgetDef, row, newName) {
  if (!widgetDef || !row || !Array.isArray(row.compPath)) return false;

  let list = widgetDef.components;
  let comp = null;
  for (const step of row.compPath) {
    if (typeof step === 'number') {
      if (!Array.isArray(list)) return false;
      comp = list[step];
      if (!comp) return false;
    } else if (step === 'components') {
      list = comp.components;
    } else if (step === 'itemTemplate') {
      list = comp.itemTemplate?.components;
    }
  }
  if (!comp) return false;

  const value = newName || '';
  if (row.source === 'binding') {
    comp.binding = comp.binding || {};
    comp.binding[row.field] = value;
    return true;
  }
  if (row.source === 'zone') {
    const zone = comp.props?.zones?.[row.index];
    if (!zone) return false;
    zone.writeEvent = value;
    return true;
  }
  if (row.source === 'interaction') {
    const interaction = comp.interactions?.[row.index];
    const action = actionsOf(interaction)[row.actionIndex];
    if (!action) return false;
    action.event = value;
    return true;
  }
  return false;
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
