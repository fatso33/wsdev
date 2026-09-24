/**
 * @module FieldGroups
 * Registry-driven field grouping for the Property Inspector: headings per registry group, curated
 * compound rows, one `.prop-field` wrapper per field, showWhen gating and effective values. Every
 * function takes the live Inspector `host` first and reads it at call time; this module holds no
 * state and registers no listeners of its own beyond the Clear and override-clear buttons it builds.
 * Host members used: `getFieldValue`, `commitField`, `humanizeFieldLabel`, `FIELD_RENDERERS`, and the
 * facade delegates for this module's own functions, so an instance-level override still takes effect.
 * Rendering replaces the mount's contents; exceptions from a control renderer, and the error for a
 * control with no registered renderer, propagate to the caller.
 */

import { escapeHtmlAttr } from '../inspectorMarkup.js';

/**
 * Field groups that render as one compact multi-column row with short inline prefix labels. The list
 * is curated on purpose: an "any two adjacent numeric fields" heuristic would glue together fields
 * that are numeric and adjacent but unrelated (for example `props.majorEvery` next to
 * `props.minorTickLength`). Paths are always base storage paths, matched through `originalPath` when a
 * field has been retargeted to a state or rule. `minmax` is the paired-bounds shape shared by
 * `core.input`, `core.slider` and `core.stepper`.
 */
const CURATED_COMPOUND_GROUPS = [
  { id: 'offset', prefixLabels: ['X:', 'Y:'], paths: ['style.offset.x', 'style.offset.y'] },
  { id: 'minmax', prefixLabels: ['Min:', 'Max:'], paths: ['props.min', 'props.max'] },
];

/**
 * Evaluates the registry's `{path, equals | equalsAny | notEquals}` showWhen grammar against a component.
 * An unset referenced value falls back to `inheritedValue` (the live Base value of a retargeted state,
 * rule or theme field), then to the referenced sibling's registered `default`. Without that fallback an
 * `equals` gate on a field whose true default matches would never pass until the field was touched once.
 * Per-column showWhen inside row lists deliberately omits `siblingFields`.
 * @param {object} host Inspector facade providing getFieldValue.
 * @param {object} comp Component whose stored values are read.
 * @param {{path: string, equals?: *, notEquals?: *, equalsAny?: Array<*>}} showWhen Gate to evaluate.
 * @param {Array<object>} [siblingFields] Registry rows of the same render, searched for the referenced path.
 * @returns {boolean} True when the gate passes; a gate with no operator always passes.
 */
export function evaluateShowWhen(host, comp, showWhen, siblingFields) {
  let val = host.getFieldValue(comp, showWhen.path);
  if (val === undefined && siblingFields) {
    const referenced = siblingFields.find((f) => f.path === showWhen.path);
    if (referenced && referenced.inheritedValue !== undefined) val = referenced.inheritedValue;
    else if (referenced && 'default' in referenced) val = referenced.default;
  }
  if ('equals' in showWhen) return val === showWhen.equals;
  if ('notEquals' in showWhen) return val !== showWhen.notEquals;
  if ('equalsAny' in showWhen) return showWhen.equalsAny.includes(val);
  return true;
}

/**
 * Renders a type's registry fields under one heading per `group`, in the order the groups first appear.
 * Intended for types whose fields are numerous enough to need sections; a heading whose fields are all
 * hidden at the current tier is hidden with them by the Shell's subtitle pass. Each group renders on
 * its own, so a field's showWhen may only name a sibling in the same group: that is where its default
 * is looked up when the referenced value is unset.
 * @param {object} host Inspector facade providing renderRegistryFields.
 * @param {object} comp Component being rendered.
 * @param {HTMLElement} body Element that receives a subtitle and a mount per group.
 * @param {Array<object>} fields Registry rows, each carrying `group`.
 * @returns {void} Appends DOM; the second and later subtitles get a 10px top margin.
 */
export function renderRegistryFieldGroups(host, comp, body, fields) {
  const groups = [];
  for (const field of fields) {
    let group = groups.find((g) => g.name === field.group);
    if (!group) {
      group = { name: field.group, fields: [] };
      groups.push(group);
    }
    group.fields.push(field);
  }
  for (const [index, group] of groups.entries()) {
    const subtitle = document.createElement('div');
    subtitle.className = 'prop-section-subtitle';
    if (index > 0) subtitle.style.marginTop = '10px';
    subtitle.textContent = group.name;
    body.appendChild(subtitle);
    const mount = document.createElement('div');
    body.appendChild(mount);
    host.renderRegistryFields(comp, mount, group.fields);
  }
}

/**
 * Walks `fields` and dispatches each to `host.FIELD_RENDERERS[control]`. An unregistered control string
 * throws, loudly and at development time, so a registry typo cannot silently render nothing.
 * Callers pass either a raw type field array or a retargeted slice of the common style rows from the
 * Appearance section. The full merged common set is never passed: Bindings, Visibility and Conditional
 * Formatting have dedicated panels, and rendering them here would duplicate those.
 *
 * Compound groups are matched and consumed by `originalPath || path`, because a state or rule target
 * rewrites `path` while the curated group paths are base paths. A group renders the first time any one
 * of its members is reached, so the row does not depend on which member the registry declares first.
 * @param {object} host Inspector facade providing renderCompoundGroup and buildFieldWrap.
 * @param {object} comp Component being rendered.
 * @param {HTMLElement} mount Element whose contents are replaced.
 * @param {Array<object>} fields Registry rows to render, in order.
 * @param {{kind: string}} [target] Appearance target; `state` and `rule` enable override indicators.
 * @param {Set<string>} [groupCoveredPaths] Paths already indicated by a group-level override marker.
 * @returns {void} Replaces the mount's children.
 * @throws {Error} When a field's control has no FIELD_RENDERERS entry.
 */
export function renderRegistryFields(host, comp, mount, fields, target, groupCoveredPaths) {
  mount.innerHTML = '';
  const fieldKey = (f) => f.originalPath || f.path;
  const renderedGroupIds = new Set();
  const consumedKeys = new Set();
  for (const field of fields) {
    const key = fieldKey(field);
    if (consumedKeys.has(key)) continue;
    const group = CURATED_COMPOUND_GROUPS.find(
      (g) =>
        !renderedGroupIds.has(g.id) &&
        g.paths.includes(key) &&
        g.paths.every((p) => fields.some((f) => fieldKey(f) === p)),
    );
    if (group) {
      renderedGroupIds.add(group.id);
      for (const p of group.paths) consumedKeys.add(p);
      host.renderCompoundGroup(comp, mount, group, fields, target, groupCoveredPaths, fieldKey);
      continue;
    }
    const wrap = host.buildFieldWrap(comp, field, fields, target, groupCoveredPaths);
    if (wrap) mount.appendChild(wrap);
  }
}

/**
 * Builds every member of a curated group through `buildFieldWrap`, so override, suppression, tier and
 * test-id behavior is identical to a standalone field, then lays the survivors out as one compound row.
 * With fewer than two survivors (for example a member that is an unauthored showWhen-hidden field) the
 * survivors are appended singly: one field is not a compound row.
 * @param {object} host Inspector facade providing buildFieldWrap and assembleCompoundRow.
 * @param {object} comp Component being rendered.
 * @param {HTMLElement} mount Element that receives the row or the single fields.
 * @param {{id: string, prefixLabels: string[], paths: string[]}} group Curated group definition.
 * @param {Array<object>} fields Registry rows of the current render.
 * @param {{kind: string}} [target] Appearance target passed through to each wrap.
 * @param {Set<string>} [groupCoveredPaths] Paths already indicated by a group-level override marker.
 * @param {(field: object) => string} fieldKey Base-path resolver, so a retargeted field is found by its original path.
 * @returns {void} Appends DOM to `mount`.
 */
export function renderCompoundGroup(host, comp, mount, group, fields, target, groupCoveredPaths, fieldKey) {
  const memberFields = group.paths.map((p) => fields.find((f) => fieldKey(f) === p));
  const built = memberFields
    .map((field, i) => ({
      wrap: host.buildFieldWrap(comp, field, fields, target, groupCoveredPaths),
      label: group.prefixLabels[i],
      tooltip: field?.tooltip,
    }))
    .filter((entry) => entry.wrap);
  if (built.length < 2) {
    for (const entry of built) mount.appendChild(entry.wrap);
    return;
  }
  mount.appendChild(host.assembleCompoundRow(`compound-row-${group.id}`, built));
}

/**
 * Owns the `.prop-field-compound` DOM shape: every compound row, registry-driven or hand-built (the
 * Grid Position & Size Width/Height row), is assembled here so a visual change to the shape has one
 * home. Each item's `wrap` is an existing `.prop-field`-style element with its own `<label>`; that
 * label's text is replaced by the short inline prefix, and `.prop-field-compound-item` selects the
 * label-beside-input layout. The field's tooltip becomes the label title only when the label has none.
 * No current compound member carries a showWhen; the stylesheet hides a `.prop-showwhen-note` inside a
 * compound item rather than mis-render it, so a future member that needs a visible note should not use
 * this layout as-is.
 * @param {object} host Unused by this DOM assembly; retained to keep the facade delegate signature uniform.
 * @param {string} testId Full data-testid value, for example `compound-row-size`.
 * @param {Array<{wrap: HTMLElement, label: string, tooltip?: string}>} items Members in display order.
 * @returns {HTMLElement} The assembled row, not yet inserted anywhere.
 */
export function assembleCompoundRow(host, testId, items) {
  const outer = document.createElement('div');
  outer.className = 'prop-field-compound';
  outer.setAttribute('data-testid', testId);
  for (const { wrap, label, tooltip } of items) {
    wrap.classList.add('prop-field-compound-item');
    const labelEl = wrap.querySelector('label');
    if (labelEl) {
      labelEl.textContent = label;
      labelEl.classList.add('prop-compound-label');
      if (!labelEl.title && tooltip) labelEl.title = tooltip;
    }
    outer.appendChild(wrap);
  }
  return outer;
}

/**
 * Builds one field's `.prop-field` wrap (override indicator, suppressed showWhen note, tier attribute,
 * test id, clear icon and the control render itself) and returns it instead of appending it, so a
 * compound group can gather several before insertion.
 *
 * A field holding a non-default value surfaces at every tier and regardless of showWhen: `isAuthored`
 * is true when the stored value exists and differs from the registered default, and an authored field
 * carries no `data-tier`. A showWhen-false field that is not authored is skipped; an authored one is
 * rendered dimmed beneath a note giving the reason and a Clear button that commits `undefined`.
 * On a state or rule target, a stored value marks the wrap `is-overridden` and adds a clear icon,
 * unless `groupCoveredPaths` says a group-level indicator already covers the path. State and rule
 * paths keep the Base test id by using `originalPath`.
 * @param {object} host Inspector facade providing getFieldValue, evaluateShowWhen, formatShowWhenReason,
 *   commitField and FIELD_RENDERERS.
 * @param {object} comp Component being rendered.
 * @param {object} field Registry row.
 * @param {Array<object>} fields Registry rows of the current render, for sibling default lookup.
 * @param {{kind: string}} [target] Appearance target.
 * @param {Set<string>} [groupCoveredPaths] Paths already indicated by a group-level override marker.
 * @returns {HTMLElement|null} The wrap, or null for `control: null`, `control: 'bespoke'` (hand-rendered
 *   elsewhere on purpose) and an unauthored showWhen-hidden field.
 * @throws {Error} When the field's control has no FIELD_RENDERERS entry.
 */
export function buildFieldWrap(host, comp, field, fields, target, groupCoveredPaths) {
  if (field.control === null) return null;
  if (field.control === 'bespoke') return null;
  const raw = host.getFieldValue(comp, field.path);
  const isAuthored = raw !== undefined && raw !== field.default;
  const isOverridable = target && (target.kind === 'state' || target.kind === 'rule');
  const isCoveredByGroup = groupCoveredPaths?.has(field.path);
  const isOverridden = isOverridable && raw !== undefined && !isCoveredByGroup;

  let suppressed = false;
  if (field.showWhen && !host.evaluateShowWhen(comp, field.showWhen, fields)) {
    if (!isAuthored) return null;
    suppressed = true;
  }
  const renderer = host.FIELD_RENDERERS[field.control];
  if (!renderer) {
    throw new Error(`[StudioInspector] No FIELD_RENDERERS entry for control "${field.control}" (path "${field.path}") — register one before declaring a field with this control.`);
  }
  const wrap = document.createElement('div');
  wrap.className = 'prop-field';
  const testidPath = field.originalPath || field.path;
  if (testidPath.startsWith('style.')) {
    const testidSuffix = testidPath.substring(6); // 'style.'.length === 6
    wrap.setAttribute('data-testid', `style-field-${testidSuffix}`);
  }
  if (isOverridden) {
    wrap.classList.add('is-overridden');
  }
  // 'advanced' fields stay Full-only. A 'simple' field outside the curated Guided allowlist
  // (field.guided) is hidden only in Guided. A curated Guided field gets no data-tier, so it is always
  // visible. Authored and suppressed-but-authored fields get none either.
  if (!suppressed && !isAuthored) {
    if (field.tier === 'advanced') wrap.setAttribute('data-tier', 'advanced');
    else if (field.tier === 'simple' && !field.guided) wrap.setAttribute('data-tier', 'build');
  }
  if (suppressed) {
    const note = document.createElement('div');
    note.className = 'prop-showwhen-note';
    note.innerHTML = `
        <span>${escapeHtmlAttr(host.formatShowWhenReason(field.showWhen))} — still set to "${escapeHtmlAttr(String(raw))}"</span>
        <button type="button" class="prop-showwhen-clear">Clear</button>
      `;
    note.querySelector('.prop-showwhen-clear')?.addEventListener('click', () => host.commitField(comp, field.path, undefined));
    wrap.appendChild(note);
    const fieldMount = document.createElement('div');
    fieldMount.style.opacity = '0.55';
    wrap.appendChild(fieldMount);
    renderer(comp, field, fieldMount);
  } else {
    renderer(comp, field, wrap);
  }
  // The clear icon is added after the renderer populates the wrap, which would otherwise overwrite it.
  if (isOverridden) {
    const clearIcon = document.createElement('button');
    clearIcon.type = 'button';
    clearIcon.className = 'override-clear-icon';
    clearIcon.setAttribute('data-testid', 'clear-override');
    clearIcon.innerHTML = '✕';
    clearIcon.title = 'Clear this override';
    clearIcon.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      host.commitField(comp, field.path, undefined);
    });
    wrap.appendChild(clearIcon);
  }
  return wrap;
}

/**
 * Words the reason a showWhen-gated field is currently hidden, as "<referenced label> <op> <value>".
 * @param {object} host Inspector facade providing humanizeFieldLabel.
 * @param {{path: string, equals?: *, notEquals?: *, equalsAny?: Array<*>}} showWhen The failing gate.
 * @returns {string} For example `Format ≠ LATLON_DMS`; a gate with no operator reads `a condition on <label>`.
 */
export function formatShowWhenReason(host, showWhen) {
  const label = host.humanizeFieldLabel(showWhen.path);
  if ('equals' in showWhen) return `${label} ≠ ${showWhen.equals}`;
  if ('notEquals' in showWhen) return `${label} = ${showWhen.notEquals}`;
  if ('equalsAny' in showWhen) return `${label} is not one of: ${showWhen.equalsAny.join(', ')}`;
  return `a condition on ${label}`;
}

/**
 * Resolves the value a field displays: the stored value, else `inheritedValue` (a retargeted state,
 * rule or theme field's live Base value, dimmed so it reads as "Base's value, not yours yet"), else the
 * registered default. It never writes: commits carry only what the user changed, so a fallback is never
 * silently backfilled.
 * @param {object} host Inspector facade providing getFieldValue.
 * @param {object} comp Component whose stored value is read.
 * @param {{path: string, default?: *, inheritedValue?: *}} field Registry row.
 * @returns {{value: *, dimmed: boolean}} The displayed value, and whether it is inherited rather than stored.
 */
export function resolveEffectiveValue(host, comp, field) {
  const raw = host.getFieldValue(comp, field.path);
  if (raw !== undefined) return { value: raw, dimmed: false };
  if (field.inheritedValue !== undefined) return { value: field.inheritedValue, dimmed: true };
  return { value: field.default, dimmed: false };
}
