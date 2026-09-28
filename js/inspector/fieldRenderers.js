/**
 * @module fieldRenderers
 * Creates the Inspector's per-instance registry dispatch table. The factory
 * has no DOM or host-state access; each renderer resolves its host method when
 * invoked, preserving instance-level overrides and call-through spies.
 */

/**
 * Create the control-to-renderer map used by registry field rendering. All
 * callbacks accept a component, its registry field and a DOM mount. Aliased
 * controls deliberately share a host method while retaining their registry
 * names. Row-list controls use the field's rowSpec through renderRowListField;
 * condition builders remain bespoke. Binding-only controls go to
 * renderBindingField, the Bindings panel's own renderers, and so does a
 * `binding.*` row of `text`, `number` or `select`; every other row of those
 * controls keeps its generic renderer. The host is read only when
 * a callback runs, so a missing method then raises the normal JavaScript call
 * error rather than failing construction.
 * @param {object} host Inspector instance with render*Field methods.
 * @returns {Record<string, (comp: object, field: object, mount: HTMLElement) => void>} Fresh dispatch table.
 */
export function createFieldRenderers(host) {
  const isBindingRow = (field) => field.path.startsWith('binding.');
  return {
    text: (comp, field, mount) => (isBindingRow(field) ? host.renderBindingField(comp, field, mount) : host.renderPlainField(comp, field, mount, 'text')),
    iconPicker: (comp, field, mount) => host.renderPlainField(comp, field, mount, 'text'),
    number: (comp, field, mount) => (isBindingRow(field) ? host.renderBindingField(comp, field, mount) : host.renderPlainField(comp, field, mount, 'number')),
    checkbox: (comp, field, mount) => host.renderCheckboxField(comp, field, mount),
    select: (comp, field, mount) => (isBindingRow(field) ? host.renderBindingField(comp, field, mount) : host.renderSelectField(comp, field, mount)),
    color: (comp, field, mount) => host.renderColorField(comp, field, mount),
    rowListEditor: (comp, field, mount) => host.renderRowListField(comp, field, mount),
    detentEditor: (comp, field, mount) => host.renderRowListField(comp, field, mount),
    arcBandsEditor: (comp, field, mount) => host.renderRowListField(comp, field, mount),
    stateVarPicker: (comp, field, mount) => host.renderStateVarField(comp, field, mount),
    assetPicker: (comp, field, mount) => host.renderAssetField(comp, field, mount),
    rangeEditor: (comp, field, mount) => host.renderRangeField(comp, field, mount),
    pivotEditor: (comp, field, mount) => host.renderPivotField(comp, field, mount),
    stateRefPicker: (comp, field, mount) => host.renderBindingField(comp, field, mount)
  };
}
