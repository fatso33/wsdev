/**
 * @module BindingsSection
 * Renders a component's simulator and local-state binding controls into a fresh Data tab mount, from
 * the registry's `binding.*` rows and through the Inspector's field engine, so a row the registry
 * declares appears without an edit here. This module holds no markup, state or listeners.
 * StudioInspector owns UI tier, Bridge/Tester collaborators and render lifecycle; the binding
 * renderers (`ui/BindingFields.js`) draw each row and write through StudioState, which owns binding
 * writes and history. Their local DOM listeners live with the discarded mount, and the only
 * asynchronous callback (Read's resolved-unit line) updates its own node while connected.
 */
import { getFieldsForType } from '../../../widgets/PropertyRegistry.js';

/**
 * Renders binding fields for the selected component in its existing Data mount, one heading per
 * registry group in the order the rows first name them. The type's rows come from
 * `host.getFieldsForType(type)` when the host has it (the drift check supplies its own rows this way),
 * else from Studio's registry. Only the `binding.*` rows render; the whole row list is the gates'
 * default lookup, so a gate may name a row in another group. Custom selection merely reveals inputs
 * until a value is chosen, and every write goes through the host's StudioState.
 * @param {object} host Live Inspector with state, tier, Bridge, Tester and the field engine.
 * @param {object} comp Selected component captured for binding updates.
 * @param {object} _def The widget definition; the renderers read it as `host.state.widgetDef`.
 * @param {HTMLElement} body Fresh mount receiving the headings and fields.
 * @returns {void} Appends to the mount and registers its listeners.
 * @throws {Error} When a registry row's control has no renderer, naming the control and path.
 */
export function renderComponentBindings(host, comp, _def, body) {
  const rows = host.getFieldsForType ? host.getFieldsForType(comp.type) : getFieldsForType(comp.type);
  host.renderRegistryFieldGroups(comp, body, rows.filter((row) => row.path.startsWith('binding.')), rows);
}
