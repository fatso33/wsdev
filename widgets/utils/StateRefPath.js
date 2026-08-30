/**
 * StateRefPath.js
 * FDWS v1.3 §Widget Popovers: minimal path grammar for addressing a widget's own local
 * state from a host-authored `stateRef` string, e.g. "presets[0].freq".
 * Not a general JSONPath library — supports exactly: name | name[idx] | name.field | name[idx].field
 */

const STATE_REF_RE = /^([A-Za-z_$][\w$]*)(?:\[(\d+)\])?(?:\.([A-Za-z_$][\w$]*))?$/;

/**
 * @param {string} path
 * @returns {{name: string, index: number|null, field: string|null}|null}
 */
export function parseStateRef(path) {
  if (typeof path !== 'string') return null;
  const match = STATE_REF_RE.exec(path.trim());
  if (!match) return null;
  const [, name, index, field] = match;
  return { name, index: index !== undefined ? Number(index) : null, field: field || null };
}

/**
 * Reads a value from a widget's local state via a stateRef path.
 * @param {{getLocalState: (name: string) => any}} widget
 * @param {string} path
 * @returns {any}
 */
export function readStateRef(widget, path) {
  const parsed = parseStateRef(path);
  if (!parsed) return undefined;
  const root = widget.getLocalState(parsed.name);
  if (parsed.index === null) {
    if (parsed.field === null) return root;
    return root && typeof root === 'object' ? root[parsed.field] : undefined;
  }
  const item = Array.isArray(root) ? root[parsed.index] : undefined;
  if (parsed.field === null) return item;
  return item && typeof item === 'object' ? item[parsed.field] : undefined;
}

/**
 * Writes a value into a widget's local state via a stateRef path, shallow-copying
 * containers on write (same pattern already hand-written in CompositeWidget's
 * core.applyPresetToField/core.editPreset) so reactivity/persist semantics on
 * setLocalState still fire correctly.
 * @param {{getLocalState: (name: string) => any, setLocalState: (name: string, value: any, persist?: boolean) => void}} widget
 * @param {string} path
 * @param {any} value
 */
export function writeStateRef(widget, path, value) {
  const parsed = parseStateRef(path);
  if (!parsed) return;
  const root = widget.getLocalState(parsed.name);

  if (parsed.index === null) {
    if (parsed.field === null) {
      widget.setLocalState(parsed.name, value, true);
      return;
    }
    const updated = root && typeof root === 'object' ? { ...root, [parsed.field]: value } : { [parsed.field]: value };
    widget.setLocalState(parsed.name, updated, true);
    return;
  }

  const arr = Array.isArray(root) ? [...root] : [];
  if (parsed.field === null) {
    arr[parsed.index] = value;
  } else {
    const existing = arr[parsed.index];
    arr[parsed.index] = existing && typeof existing === 'object' ? { ...existing, [parsed.field]: value } : { [parsed.field]: value };
  }
  widget.setLocalState(parsed.name, arr, true);
}
