/**
 * @module FieldFactory
 * Inspector controls for numeric input, colors and registry fields. Render functions capture the
 * component and field supplied for that render, then use live Inspector delegates for state reads
 * and writes. Number enhancement installs wheel and chevron listeners on the host-owned DOM subtree;
 * color pairs keep closure-local deduplication state and reuse the existing color-picker popover.
 * The host methods used are step and field lookup, label/id formatting, value resolution, showWhen
 * evaluation, field/control delegates, and commitField; state reads use host.state.widgetDef.state/assets.
 * StudioInspector remains the owner of component state and DOM replacement during render. DOM,
 * collaborator and commit-callback errors propagate through their existing call or event path.
 */

import { getDeckEventsByKind, DECK_EVENT_NAMES } from '../../../core/deckEvents.js';
import { openColorPickerPopover } from '../../ColorPickerPopover.js';
import { describePulseFeel } from '../../RotaryDefaults.js';
import { VALUE_FORMATS as REGISTRY_VALUE_FORMATS } from '../../../widgets/PropertyRegistry.js';
import {
  MIN_DEGREES_PER_UNIT,
  resolveFeelFloor,
  resolveGesture,
} from '../../../widgets/components/rotaryEngine.js';
import { CUSTOM_OPTION_VALUE, GRADIENT_VALUE_RE, escapeHtmlAttr } from '../inspectorMarkup.js';

/** Registry paths and DOM ids with authored fractional steps. */
const NUMBER_STEP_LOOKUP = {
  'props.sensitivity': 0.1,
  'c-bind-deadband': 0.01,
};
/** Default step for integer-like numeric controls. */
const NUMBER_STEP_DEFAULT = 1;

/**
 * Adds one reserved chevron wrapper to each unenhanced number input. The existing change path receives rounded, bounded steps; wheel scrolling is cancelled only while the input is focused.
 * @param {object} host Inspector facade providing getNumberStep, decimalPlaces and roundToDecimals.
 * @param {ParentNode} root Number-input subtree to enhance.
 * @returns {void} Adds DOM wrappers and event listeners.
 */
export function enhanceNumberInputs(host, root) {
  const inputs = root.querySelectorAll('input[type="number"]:not([data-num-enhanced])');
  for (const input of inputs) {
    input.dataset.numEnhanced = '1';

    const wrap = document.createElement('div');
    wrap.className = 'prop-number-wrap';
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    input.classList.add('has-number-chevrons');

    const chevrons = document.createElement('div');
    chevrons.className = 'prop-number-chevrons';
    chevrons.innerHTML = `
        <button type="button" class="prop-number-chevron prop-number-chevron-up" tabindex="-1" aria-label="Increase">▲</button>
        <button type="button" class="prop-number-chevron prop-number-chevron-down" tabindex="-1" aria-label="Decrease">▼</button>
      `;
    wrap.appendChild(chevrons);

    const step = host.getNumberStep(input);
    // Also reflect the lookup's step onto the native `step` attribute so
    // keyboard ArrowUp/ArrowDown stepping (native browser behavior, not
    // wired through applyDelta) matches the same per-field granularity as
    // wheel/chevron stepping instead of defaulting to the browser's step=1.
    input.step = String(step);

    // Native typing and stepped values use the same change listener, so each
    // field keeps one commit path.
    const applyDelta = (multiplier) => {
      if (input.disabled) return;
      const cur = Number(input.value) || 0;
      const delta = step * multiplier;
      const decimals = host.decimalPlaces(step) + (Math.abs(multiplier) < 1 ? 1 : 0);
      let next = host.roundToDecimals(cur + delta, decimals);
      if (input.min !== '' && !Number.isNaN(Number(input.min)))
        next = Math.max(Number(input.min), next);
      if (input.max !== '' && !Number.isNaN(Number(input.max)))
        next = Math.min(Number(input.max), next);
      input.value = String(next);
      input.dispatchEvent(new Event('change', { bubbles: true }));
    };

    chevrons.querySelector('.prop-number-chevron-up').addEventListener('click', (e) => {
      e.preventDefault();
      applyDelta(1);
    });
    chevrons.querySelector('.prop-number-chevron-down').addEventListener('click', (e) => {
      e.preventDefault();
      applyDelta(-1);
    });

    // Shift multiplies the step by ten and Alt by one tenth; together they cancel out.
    // Attached to the WRAP (not just the input) so it also fires while the
    // pointer is over the hover-revealed chevron gutter, which visually
    // sits on top of the input's own reserved padding but is a DOM sibling,
    // not a descendant, of the input.
    // Focus gating keeps hover from intercepting ordinary Inspector scrolling.
    // Hover reveals the chevrons through CSS; only wheel stepping requires focus.
    wrap.addEventListener(
      'wheel',
      (e) => {
        if (document.activeElement !== input) return;
        e.preventDefault();
        // Browsers swap a wheel event's axis when Shift is held (native
        // "scroll horizontally" convention) — deltaY reads 0 and the amount
        // moves to deltaX instead. Fall back to deltaX so Shift+wheel still
        // reads as the same vertical-scroll gesture, just with the x10
        // multiplier, rather than a no-op.
        const rawDelta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
        if (rawDelta === 0) return;
        let multiplier = 1;
        if (e.shiftKey) multiplier *= 10;
        if (e.altKey) multiplier *= 0.1;
        const dir = rawDelta < 0 ? 1 : -1;
        applyDelta(dir * multiplier);
      },
      { passive: false },
    );
  }
}

/**
 * Looks up a field step by registry path, then DOM id, with one as the ordinary numeric default.
 * @param {object} host Unused by this pure lookup; retained to keep the facade delegate signature uniform.
 * @param {HTMLInputElement} input Input whose data key or id selects a step.
 * @returns {number} Configured step size.
 */
export function getNumberStep(host, input) {
  const pathKey = input.dataset.stepKey;
  if (pathKey && Object.prototype.hasOwnProperty.call(NUMBER_STEP_LOOKUP, pathKey))
    return NUMBER_STEP_LOOKUP[pathKey];
  if (input.id && Object.prototype.hasOwnProperty.call(NUMBER_STEP_LOOKUP, input.id))
    return NUMBER_STEP_LOOKUP[input.id];
  return NUMBER_STEP_DEFAULT;
}

/**
 * Counts decimal places in a step literal.
 * @param {object} host Unused by this pure calculation; retained to keep the facade delegate signature uniform.
 * @param {number} step Step size, such as 0.1 or 1.
 * @returns {number} Decimal digits, or zero for an integer.
 */
export function decimalPlaces(host, step) {
  const str = String(step);
  const dot = str.indexOf('.');
  return dot === -1 ? 0 : str.length - dot - 1;
}

/**
 * Rounds away floating-point arithmetic noise at the requested precision.
 * @param {object} host Unused by this pure calculation; retained to keep the facade delegate signature uniform.
 * @param {number} value Value to round.
 * @param {number} decimals Decimal places to retain.
 * @returns {number} Rounded value.
 */
export function roundToDecimals(host, value, decimals) {
  const factor = 10 ** Math.max(0, decimals);
  return Math.round(value * factor) / factor;
}

/**
 * Renders two numeric endpoints and commits them together when either changes; a caller override supports nested component paths.
 * @param {object} host Inspector facade providing updateCompProp for the default top-level write.
 * @param {HTMLElement | null} mount Destination; null is a no-op.
 * @param {object} comp Component being edited.
 * @param {string} propKey Top-level property key for the default write.
 * @param {number[]} currentRange Current endpoints or fallback source.
 * @param {string} title Visible label.
 * @param {string} [hint] Optional explanatory hint.
 * @param {((range: number[]) => void) | undefined} [commitOverride] Optional write callback.
 * @returns {void} Renders the pair and registers change listeners when mount exists.
 */
export function renderRangeEditor(
  host,
  mount,
  comp,
  propKey,
  currentRange,
  title,
  hint,
  commitOverride,
) {
  if (!mount) return;
  const [lo, hi] = Array.isArray(currentRange) ? currentRange : [0, 1];
  mount.innerHTML = `
      <div class="prop-field">
        <label>${title}${hint ? `<span class="prop-hint" title="${hint}"> ⓘ</span>` : ''}</label>
        <div class="prop-row-2">
          <input type="number" step="any" class="prop-input range-lo" value="${lo}" />
          <input type="number" step="any" class="prop-input range-hi" value="${hi}" />
        </div>
      </div>
    `;
  const commit = commitOverride || ((v) => host.updateCompProp(comp, propKey, v));
  const apply = () => {
    const nextLo = Number(mount.querySelector('.range-lo').value) || 0;
    const nextHi = Number(mount.querySelector('.range-hi').value) || 0;
    commit([nextLo, nextHi]);
  };
  mount.querySelector('.range-lo')?.addEventListener('change', apply);
  mount.querySelector('.range-hi')?.addEventListener('change', apply);
}

/**
 * Renders editable rows for structured array properties. Each edit copies the current list and row before committing.
 * @param {object} host Inspector facade providing fieldDomId and updateCompProp.
 * @param {HTMLElement | null} mount Destination; null is a no-op.
 * @param {object} comp Component being edited.
 * @param {string} propKey Field path used for the field id and default write.
 * @param {Array<object>} rows Current rows; non-arrays render empty.
 * @param {{title: string, hint?: string, fields: Array<object>, commitOverride?: (rows: Array<object>) => void}} spec Column definitions and optional writer.
 * @returns {void} Renders the editor and registers edit, add and remove listeners.
 */
export function renderRowListEditor(host, mount, comp, propKey, rows, spec) {
  if (!mount) return;
  const list = Array.isArray(rows) ? rows : [];

  const fieldInput = (field, row) => {
    const val = row[field.key] !== undefined ? row[field.key] : field.default;
    if (field.type === 'checkbox') {
      return `<input type="checkbox" class="row-field" data-field="${field.key}" ${val ? 'checked' : ''} title="${field.label}" />`;
    }
    if (field.type === 'deckEvent') {
      const opts = getDeckEventsByKind('write')
        .map(
          (e) =>
            `<option value="${e.name}" ${val === e.name ? 'selected' : ''}>${e.label}</option>`,
        )
        .join('');
      return `
          <select class="row-field prop-select" data-field="${field.key}" title="${field.label}">
            <option value="">— none —</option>
            ${opts}
            <option value="${CUSTOM_OPTION_VALUE}" ${val && !DECK_EVENT_NAMES.includes(val) ? 'selected' : ''}>Custom…</option>
          </select>
          <input type="text" class="row-field row-field-custom ${val && !DECK_EVENT_NAMES.includes(val) ? '' : 'hidden'}" data-field="${field.key}" value="${val && !DECK_EVENT_NAMES.includes(val) ? val : ''}" placeholder="Custom event name" />
        `;
    }
    return `<input type="${field.type}" step="any" class="row-field" data-field="${field.key}" value="${val !== undefined ? val : ''}" placeholder="${field.label}" />`;
  };

  mount.innerHTML = `
      <div class="prop-field" id="${host.fieldDomId(propKey)}">
        <label>${spec.title}${spec.hint ? `<span class="prop-hint" title="${spec.hint}"> ⓘ</span>` : ''}</label>
        <div class="row-list-editor">
          ${
            list
              .map(
                (row, idx) => `
            <div class="row-list-item" data-idx="${idx}">
              ${spec.fields.map((f) => fieldInput(f, row)).join('')}
              <button type="button" class="btn-mini-close row-remove" title="Remove">✕</button>
            </div>
          `,
              )
              .join('') || '<div class="caps-empty">None yet.</div>'
          }
        </div>
        <button type="button" class="bar-btn row-add">+ Add ${spec.title.replace(/s$/, '')}</button>
      </div>
    `;

  // Most callers' array lives directly at props[propKey], so the default
  // commit just replaces that whole prop. A caller whose array is nested
  // deeper (e.g. props.arc.bands) passes commitOverride instead, so
  // committing the edited list doesn't clobber the rest of that parent
  // object.
  const commit =
    spec.commitOverride || ((nextList) => host.updateCompProp(comp, propKey, nextList));

  for (const rowEl of mount.querySelectorAll('.row-list-item')) {
    const idx = Number(rowEl.dataset.idx);

    for (const sel of rowEl.querySelectorAll('select.row-field')) {
      sel.addEventListener('change', () => {
        const key = sel.dataset.field;
        const isCustom = sel.value === CUSTOM_OPTION_VALUE;
        const customInput = rowEl.querySelector(`.row-field-custom[data-field="${key}"]`);
        customInput?.classList.toggle('hidden', !isCustom);
        const next = [...list];
        next[idx] = { ...next[idx], [key]: isCustom ? customInput?.value || '' : sel.value };
        commit(next);
      });
    }
    for (const inp of rowEl.querySelectorAll('.row-field-custom')) {
      inp.addEventListener('change', () => {
        const key = inp.dataset.field;
        const next = [...list];
        next[idx] = { ...next[idx], [key]: inp.value };
        commit(next);
      });
    }
    for (const inp of rowEl.querySelectorAll('input.row-field:not(.row-field-custom)')) {
      inp.addEventListener('change', () => {
        const key = inp.dataset.field;
        const raw =
          inp.type === 'checkbox'
            ? inp.checked
            : inp.type === 'number'
              ? Number(inp.value)
              : inp.value;
        const next = [...list];
        next[idx] = { ...next[idx], [key]: raw };
        commit(next);
      });
    }
    rowEl.querySelector('.row-remove')?.addEventListener('click', () => {
      commit(list.filter((_, i) => i !== idx));
    });
  }

  mount.querySelector('.row-add')?.addEventListener('click', () => {
    const newRow = {};
    for (const field of spec.fields) newRow[field.key] = field.default;
    commit([...list, newRow]);
  });
}

/**
 * Extracts a six-digit hexadecimal color for swatch styling; other CSS values keep their text representation.
 * @param {object} host Unused by this pure conversion; retained to keep the facade delegate signature uniform.
 * @param {*} value Authored color value.
 * @returns {string | null} First six-digit hex color, or null when absent.
 */
export function toHexColor(host, value) {
  if (typeof value !== 'string') return null;
  const match = value.match(/#[0-9a-fA-F]{6}/);
  return match ? match[0] : null;
}

/**
 * Connects swatch and text controls. Live input accepts complete hex and optionally gradients;
 * change commits the entered value. Repeated commits are deduped and skipEmpty preserves values
 * during bulk editing.
 * @param {object} host Inspector facade providing toHexColor; StudioModal owns the color-picker lifecycle.
 * @param {ParentNode} root Container holding the controls.
 * @param {string} pickId Swatch or legacy color-input id.
 * @param {string} txtId Text-input id.
 * @param {(value: string) => void} applyFn Owner of committed values.
 * @param {{allowGradient?: boolean, skipEmpty?: boolean}} [options] Gradient and blank-value policies.
 * @returns {void} Registers text, change and optional color-popover listeners.
 */
export function wireColorPair(
  host,
  root,
  pickId,
  txtId,
  applyFn,
  { allowGradient = false, skipEmpty = false } = {},
) {
  const pick = root.querySelector(`#${pickId}`);
  const txt = root.querySelector(`#${txtId}`);
  let lastCommitted;
  const commit = (rawVal) => {
    const val = rawVal.trim();
    if (skipEmpty && !val) return;
    if (val === lastCommitted) return;
    lastCommitted = val;
    if (txt) txt.value = val;
    const hex = host.toHexColor(val);
    if (pick) {
      pick.style.background = hex || val || 'transparent';
      pick.dataset.color = hex || val || '';
    }
    applyFn(val);
  };
  if (pick && pick.tagName === 'BUTTON') {
    pick.addEventListener('click', async () => {
      const seed = txt?.value || pick.dataset.color || '';
      const result = await openColorPickerPopover({ anchor: pick, initialColor: seed });
      if (result !== null && result !== undefined) commit(result);
    });
  } else {
    // Legacy path, kept only in case a native <input type="color"> ever
    // reappears at some call site — every current one now uses a button.
    pick?.addEventListener('input', (e) => commit(e.target.value));
    pick?.addEventListener('change', (e) => commit(e.target.value));
  }
  txt?.addEventListener('change', (e) => commit(e.target.value));
  txt?.addEventListener('input', (e) => {
    const v = e.target.value.trim();
    if (
      /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(v) ||
      (allowGradient && GRADIENT_VALUE_RE.test(v))
    )
      commit(v);
  });
}

/**
 * Converts the last segment of a dotted path to a display label and restores common acronyms.
 * @param {object} host Unused by this pure conversion; retained to keep the facade delegate signature uniform.
 * @param {string} path Dotted field path.
 * @returns {string} Human-readable label.
 */
export function humanizeFieldLabel(host, path) {
  const key = path.split('.').pop();
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const titled = spaced.charAt(0).toUpperCase() + spaced.slice(1);
  return titled
    .replace(/\bLed\b/, 'LED')
    .replace(/\bId\b/, 'ID')
    .replace(/\bUrl\b/, 'URL');
}

/**
 * Builds the stable DOM id used by registry-driven controls.
 * @param {object} host Unused by this pure conversion; retained to keep the facade delegate signature uniform.
 * @param {string} path Dotted field path.
 * @returns {string} Id with the rf- prefix and hyphens in place of dots.
 */
export function fieldDomId(host, path) {
  return `rf-${path.replace(/\./g, '-')}`;
}

/**
 * Resolves the displayed minimum Feel and unit only when Rotary context imposes a floor above the general minimum.
 * @param {object} host Inspector facade providing live getFieldValue reads.
 * @param {object} comp Component being rendered.
 * @param {object} field Registry field descriptor.
 * @returns {{min: number, tooltipNote: string} | null} Floor hint or null when no higher floor applies.
 */
export function resolveFeelFloorHint(host, comp, field) {
  if (comp.type !== 'core.rotary' || field.path !== 'props.degreesPerUnit') return null;
  const gesture = host.getFieldValue(comp, 'props.gesture');
  const floor = resolveFeelFloor(gesture, host.getFieldValue(comp, 'props.writeMode'));
  if (floor <= MIN_DEGREES_PER_UNIT) return null;
  const unit = resolveGesture(gesture) === 'scrub' ? 'pixels of drag' : 'degrees of arc';
  return { min: floor, tooltipNote: `Current Feel floor: ${floor} ${unit} per step.` };
}

/**
 * Describes the step-per-revolution meaning of Feel in Pulse Arc and Scrub modes.
 * @param {object} host Inspector facade providing live getFieldValue reads.
 * @param {object} comp Component being rendered.
 * @param {object} field Registry field descriptor.
 * @param {*} feel Effective Feel value.
 * @returns {object | null} Pulse-specific label and note, or null for ordinary Feel semantics.
 */
export function resolvePulseFeelDescription(host, comp, field, feel) {
  if (comp.type !== 'core.rotary' || field.path !== 'props.degreesPerUnit') return null;
  return describePulseFeel(
    host.getFieldValue(comp, 'props.gesture'),
    host.getFieldValue(comp, 'props.writeMode'),
    feel,
  );
}

/**
 * Renders a text or number field and commits on change. Empty numbers clear the value; invalid numeric text becomes zero.
 * @param {object} host Inspector facade providing field labels, effective values, Rotary hints and commitField.
 * @param {object} comp Component being rendered.
 * @param {object} field Registry field descriptor.
 * @param {HTMLElement} mount Destination element.
 * @param {"text" | "number"} inputType Native input type.
 * @returns {void} Replaces mount contents and registers the commit listener.
 */
export function renderPlainField(host, comp, field, mount, inputType) {
  const label = host.humanizeFieldLabel(field.path);
  const id = host.fieldDomId(field.path);
  const { value } = host.resolveEffectiveValue(comp, field);
  const floorHint = inputType === 'number' ? host.resolveFeelFloorHint(comp, field) : null;
  const tooltip = floorHint
    ? `${field.tooltip || ''} ${floorHint.tooltipNote}`.trim()
    : field.tooltip || '';
  // A registry `min` is advertised the same way, so the browser's own constraint and
  // the chevron/wheel stepping both respect it; the engine owns what a lower value does.
  const registryMin = inputType === 'number' && Number.isFinite(field.min) ? field.min : null;
  const minAttr = floorHint
    ? ` min="${floorHint.min}"`
    : registryMin !== null
      ? ` min="${registryMin}"`
      : '';
  const pulseFeel = host.resolvePulseFeelDescription(comp, field, value);
  // data-step-key selects an editor-only step without adding UI behavior to
  // the PropertyRegistry field schema.
  const stepAttr = inputType === 'number' ? ` data-step-key="${escapeHtmlAttr(field.path)}"` : '';
  mount.innerHTML = `
      <label title="${escapeHtmlAttr(tooltip)}">${escapeHtmlAttr(pulseFeel ? pulseFeel.label : label)}</label>
      <input type="${inputType}" id="${id}" class="prop-input" value="${escapeHtmlAttr(value ?? '')}" placeholder="${escapeHtmlAttr(field.placeholder || '')}"${stepAttr}${minAttr} />
      ${pulseFeel ? `<div class="prop-hint-block" id="${id}-meaning" style="font-size:11px;opacity:0.75;margin-top:2px;">${escapeHtmlAttr(pulseFeel.note)}</div>` : ''}
    `;
  mount.querySelector(`#${id}`)?.addEventListener('change', (e) => {
    const raw = e.target.value;
    const v = inputType === 'number' ? (raw === '' ? undefined : Number(raw) || 0) : raw;
    host.commitField(comp, field.path, v);
  });
}

/**
 * Renders a boolean field and commits its checked state on change.
 * @param {object} host Inspector facade providing field labels, effective values and commitField.
 * @param {object} comp Component being rendered.
 * @param {object} field Registry field descriptor.
 * @param {HTMLElement} mount Destination element.
 * @returns {void} Replaces mount contents and registers the change listener.
 */
export function renderCheckboxField(host, comp, field, mount) {
  const label = host.humanizeFieldLabel(field.path);
  const id = host.fieldDomId(field.path);
  const { value } = host.resolveEffectiveValue(comp, field);
  mount.innerHTML = `
      <label title="${escapeHtmlAttr(field.tooltip || '')}" style="display:flex;align-items:center;gap:6px;">
        <input type="checkbox" id="${id}" ${value ? 'checked' : ''} /> ${escapeHtmlAttr(label)}
      </label>
    `;
  mount
    .querySelector(`#${id}`)
    ?.addEventListener('change', (e) => host.commitField(comp, field.path, e.target.checked));
}

/**
 * Renders a registry select and commits the original option value, retaining numeric option types.
 * @param {object} host Inspector facade providing field labels, effective values and commitField.
 * @param {object} comp Component being rendered.
 * @param {object} field Registry field descriptor.
 * @param {HTMLElement} mount Destination element.
 * @returns {void} Replaces mount contents and registers the change listener.
 */
export function renderSelectField(host, comp, field, mount) {
  const label = host.humanizeFieldLabel(field.path);
  const id = host.fieldDomId(field.path);
  const { value } = host.resolveEffectiveValue(comp, field);
  const rawOptions =
    field.optionsRef === 'VALUE_FORMATS' ? REGISTRY_VALUE_FORMATS : field.options || [];
  const optionHtml = rawOptions
    .map((opt) => {
      const optVal = opt && typeof opt === 'object' ? opt.value : opt;
      const optLabel = opt && typeof opt === 'object' ? opt.label : String(opt);
      const icon = field.optionIcons?.[optVal];
      const selected = value === optVal ? 'selected' : '';
      return `<option value="${escapeHtmlAttr(optVal)}" ${selected}>${icon ? `${icon} ` : ''}${escapeHtmlAttr(optLabel)}</option>`;
    })
    .join('');
  mount.innerHTML = `
      <label title="${escapeHtmlAttr(field.tooltip || '')}">${escapeHtmlAttr(label)}</label>
      <select id="${id}" class="prop-select">${optionHtml}</select>
    `;
  mount.querySelector(`#${id}`)?.addEventListener('change', (e) => {
    // Options are always rendered from string/number literals above (never
    // user text), so a numeric-typed option (e.g. style.typography.weight's
    // [400,500,600,700]) needs coercing back from the <select>'s own
    // always-string e.target.value.
    const original = rawOptions.find(
      (opt) => String(opt && typeof opt === 'object' ? opt.value : opt) === e.target.value,
    );
    const coerced = original && typeof original === 'object' ? original.value : original;
    host.commitField(comp, field.path, coerced);
  });
}

/**
 * Renders a color swatch and editable text field using the host color-pair handler and component commit path.
 * @param {object} host Inspector facade providing field labels, effective values, color helpers and commitField.
 * @param {object} comp Component being rendered.
 * @param {object} field Registry field descriptor.
 * @param {HTMLElement} mount Destination element.
 * @returns {void} Replaces mount contents and wires color editing.
 */
export function renderColorField(host, comp, field, mount) {
  const label = host.humanizeFieldLabel(field.path);
  const id = host.fieldDomId(field.path);
  const { value } = host.resolveEffectiveValue(comp, field);
  mount.innerHTML = `
      <label title="${escapeHtmlAttr(field.tooltip || '')}">${escapeHtmlAttr(label)}</label>
      <div class="color-picker-wrap">
        <button type="button" class="color-swatch" id="${id}-pick" data-color="${escapeHtmlAttr(host.toHexColor(value) || '#000000')}" style="background:${host.toHexColor(value) || '#000000'}" aria-label="Pick color"></button>
        <input type="text" id="${id}" class="prop-input" value="${escapeHtmlAttr(value || '')}" placeholder="" />
      </div>
    `;
  host.wireColorPair(mount, `${id}-pick`, id, (v) => host.commitField(comp, field.path, v));
}

/**
 * Renders a row-list field with only columns whose showWhen conditions match the live component.
 * @param {object} host Inspector facade providing field reads, showWhen evaluation, row rendering and commitField.
 * @param {object} comp Component being rendered.
 * @param {object} field Registry descriptor with a row specification.
 * @param {HTMLElement} mount Destination element.
 * @returns {void} Renders rows and commits edits at the field path.
 */
export function renderRowListField(host, comp, field, mount) {
  const rows = host.getFieldValue(comp, field.path) || [];
  const visibleFields = (field.rowSpec?.fields || []).filter(
    (f) => !f.showWhen || host.evaluateShowWhen(comp, f.showWhen),
  );
  host.renderRowListEditor(mount, comp, field.path, rows, {
    title: host.humanizeFieldLabel(field.path),
    hint: field.tooltip,
    fields: visibleFields,
    commitOverride: (nextList) => host.commitField(comp, field.path, nextList),
  });
}

/**
 * Renders a select from the widget’s current state-variable declarations; a blank choice commits undefined.
 * @param {object} host Inspector facade providing field labels and reads, live widget state and commitField.
 * @param {object} comp Component being rendered.
 * @param {object} field Registry field descriptor.
 * @param {HTMLElement} mount Destination element.
 * @returns {void} Replaces mount contents and registers the change listener.
 */
export function renderStateVarField(host, comp, field, mount) {
  const label = host.humanizeFieldLabel(field.path);
  const id = host.fieldDomId(field.path);
  const value = host.getFieldValue(comp, field.path) ?? field.default;
  const stateVars = host.state.widgetDef.state || [];
  mount.innerHTML = `
      <label title="${escapeHtmlAttr(field.tooltip || '')}">${escapeHtmlAttr(label)}</label>
      <select id="${id}" class="prop-select">
        <option value="" ${!value ? 'selected' : ''}>— none —</option>
        ${stateVars.map((s) => `<option value="${escapeHtmlAttr(s.name)}" ${value === s.name ? 'selected' : ''}>${escapeHtmlAttr(s.name)} (${escapeHtmlAttr(s.type)})</option>`).join('')}
      </select>
    `;
  mount
    .querySelector(`#${id}`)
    ?.addEventListener('change', (e) =>
      host.commitField(comp, field.path, e.target.value || undefined),
    );
}

/**
 * Renders a select from the widget’s current assets; a blank choice commits undefined.
 * @param {object} host Inspector facade providing effective values, live widget assets and commitField.
 * @param {object} comp Component being rendered.
 * @param {object} field Registry field descriptor.
 * @param {HTMLElement} mount Destination element.
 * @returns {void} Replaces mount contents and registers the change listener.
 */
export function renderAssetField(host, comp, field, mount) {
  const label = host.humanizeFieldLabel(field.path);
  const id = host.fieldDomId(field.path);
  const { value } = host.resolveEffectiveValue(comp, field);
  const assets = host.state.widgetDef.assets || [];
  mount.innerHTML = `
      <label title="${escapeHtmlAttr(field.tooltip || '')}">${escapeHtmlAttr(label)}</label>
      <select id="${id}" class="prop-select">
        <option value="" ${!value ? 'selected' : ''}>None</option>
        ${assets.map((a) => `<option value="${escapeHtmlAttr(a.id)}" ${value === a.id ? 'selected' : ''}>${escapeHtmlAttr(a.id)} (${escapeHtmlAttr(a.mimeType)})</option>`).join('')}
      </select>
    `;
  mount
    .querySelector(`#${id}`)
    ?.addEventListener('change', (e) =>
      host.commitField(comp, field.path, e.target.value || undefined),
    );
}

/**
 * Renders a range field defaulting to [0, 1], committing both endpoints through the Inspector transaction path.
 * @param {object} host Inspector facade providing field reads, range rendering, label formatting and commitField.
 * @param {object} comp Component being rendered.
 * @param {object} field Registry field descriptor.
 * @param {HTMLElement} mount Destination element.
 * @returns {void} Renders the editor and commits changes at the registry path.
 */
export function renderRangeField(host, comp, field, mount) {
  const currentRange = host.getFieldValue(comp, field.path) || [0, 1];
  host.renderRangeEditor(
    mount,
    comp,
    field.path,
    currentRange,
    host.humanizeFieldLabel(field.path),
    field.tooltip,
    (next) => host.commitField(comp, field.path, next),
  );
}

/**
 * Renders the X/Y transform origin as separate CSS coordinate strings, defaulting both to 50% for a centered pivot.
 * @param {object} host Inspector facade providing field reads, label and id formatting, and commitField.
 * @param {object} comp Component being rendered.
 * @param {object} field Registry field descriptor.
 * @param {HTMLElement} mount Destination element.
 * @returns {void} Replaces mount contents and commits both coordinates when either changes.
 */
export function renderPivotField(host, comp, field, mount) {
  const label = host.humanizeFieldLabel(field.path);
  const id = host.fieldDomId(field.path);
  const pivot = host.getFieldValue(comp, field.path) || {};
  const x = pivot.x ?? '50%';
  const y = pivot.y ?? '50%';
  mount.innerHTML = `
      <label title="${escapeHtmlAttr(field.tooltip || '')}">${escapeHtmlAttr(label)}</label>
      <div class="prop-row-2">
        <input type="text" id="${id}-x" class="prop-input" value="${escapeHtmlAttr(x)}" placeholder="X e.g. 50%" />
        <input type="text" id="${id}-y" class="prop-input" value="${escapeHtmlAttr(y)}" placeholder="Y e.g. 50%" />
      </div>
    `;
  const apply = () => {
    const nx = mount.querySelector(`#${id}-x`)?.value.trim() || '50%';
    const ny = mount.querySelector(`#${id}-y`)?.value.trim() || '50%';
    host.commitField(comp, field.path, { x: nx, y: ny });
  };
  mount.querySelector(`#${id}-x`)?.addEventListener('change', apply);
  mount.querySelector(`#${id}-y`)?.addEventListener('change', apply);
}
