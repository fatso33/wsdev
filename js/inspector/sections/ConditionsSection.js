/**
 * @module ConditionsSection
 * Builds visibility and guard controls. StudioInspector owns live state and
 * rendering; StudioModal owns modal cleanup. Editor listeners live only with
 * their mount DOM, and deferred callers choose when to persist expressions.
 */
import { openModal } from '../../StudioModal.js';
import { summarizeCondition } from '../../InspectorLogic.js';
import { CUSTOM_OPTION_VALUE, escapeHtmlAttr } from '../inspectorMarkup.js';

/** Sentinel for the binding-backed condition source; never stored as a path. */
const OWN_VALUE_OPTION = '__own_value__';
/**
 * Renders declared, custom, and available binding-backed state choices.
 * @param {object[]} stateVars Declared state variables with names.
 * @param {string} currentValue Stored state path.
 * @param {boolean} ownValueSelected Whether the binding-backed choice is active.
 * @param {string|undefined} ownValueSimVar Component read binding, if any.
 * @returns {string} Option markup with authored state paths escaped.
 */
function conditionStateOptionsHtml(stateVars, currentValue, ownValueSelected, ownValueSimVar) {
  const isCustom = !ownValueSelected && !!currentValue && !stateVars.some((s) => s.name === currentValue);
  return `
    <option value="">— state var —</option>
    ${ownValueSimVar ? `<option value="${OWN_VALUE_OPTION}" ${ownValueSelected ? 'selected' : ''} title="Declares (or reuses) a state variable that mirrors this component's own binding, so its live value can drive this condition.">Use This Component's Own Value</option>` : ''}
    ${stateVars.map((s) => `<option value="${escapeHtmlAttr(s.name)}" ${!ownValueSelected && currentValue === s.name ? 'selected' : ''}>${escapeHtmlAttr(s.name)}</option>`).join('')}
    <option value="${CUSTOM_OPTION_VALUE}" ${isCustom ? 'selected' : ''}>Custom / nested path…</option>
  `;
}

/**
 * Opens the condition popover and recursively rebuilds its editor after edits.
 * @param {object} host Live Inspector with render().
 * @param {string} title Modal title.
 * @param {(rerender: () => void) => {html: string, wire: (mountEl: HTMLElement) => void}} buildEditor Editor factory.
 * @returns {Promise<void>} Resolves on close; Done refreshes the host summary
 * while Cancel leaves immediate editor commits in place without a new render.
 */
export async function openConditionEditorPopover(host, title, buildEditor) {
  let mountEl;
  const render = () => {
    const editor = buildEditor(render);
    mountEl.innerHTML = editor.html;
    editor.wire(mountEl);
  };

  const result = await openModal({
    title,
    bodyHtml: '',
    onMount: (card) => {
      mountEl = card.querySelector('.modal-body');
      render();
    },
    submitLabel: 'Done',
    cancelLabel: 'Cancel',
    onSubmit: () => {
      // Just close the modal; changes are committed immediately via onCommit in the editor
      return { value: true };
    }
  });

  // Done refreshes the summary after the modal closes.
  if (result) {
    host.render();
  }
}

/**
 * Renders visibility summary and guard fields into a mount node.
 * @param {object} host Live Inspector with state and condition delegates.
 * @param {object} comp Selected component captured by listeners.
 * @param {object} def Widget definition supplying assets.
 * @param {HTMLElement} body Mount node.
 * @returns {void} Guard edits call StudioState.updateComponent; zero auto-close
 * and blank asset choices store undefined, while enable preserves other keys.
 */
export function renderVisibilityAndGuard(host, comp, def, body) {
  const assets = def.assets || [];
  const guard = comp.layout?.guard || {};
  const conditionSummary = summarizeCondition(comp.visibleWhen);

  body.innerHTML = `
    <div class="prop-section-subtitle">Conditional Visibility (visibleWhen) <span class="prop-hint" title="FDWS v1.13: each condition's state can be a declared state[] var, or — via the 'Custom / nested path…' option — a nested/indexed path like presets[0].label, addressing one specific array-slot field instead of a whole variable.">ⓘ</span></div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
      <div style="flex:1;padding:6px 8px;background:var(--studio-panel-bg);border:1px solid var(--studio-panel-border);border-radius:3px;font-size:12px;color:var(--studio-text-secondary);">${escapeHtmlAttr(conditionSummary)}</div>
      <button type="button" id="vw-edit-condition" class="bar-btn" title="Edit condition in popover">Edit</button>
    </div>

    <div class="prop-section-subtitle" style="margin-top:14px;">Guard Overlay (layout.guard §2.2)</div>
    <div class="prop-field">
      <label><input type="checkbox" id="guard-enabled" ${guard.enabled ? 'checked' : ''} /> Enable safety cover (tap to open, then tap control)</label>
    </div>
    ${guard.enabled ? `
      <div class="prop-row-2">
        <div class="prop-field">
          <label>Closed Asset</label>
          <select id="guard-closed-asset" class="prop-select">
            <option value="">— none —</option>
            ${assets.map((a) => `<option value="${a.id}" ${guard.closedAsset === a.id ? 'selected' : ''}>${a.id}</option>`).join('')}
          </select>
        </div>
        <div class="prop-field">
          <label>Open Asset</label>
          <select id="guard-open-asset" class="prop-select">
            <option value="">— none —</option>
            ${assets.map((a) => `<option value="${a.id}" ${guard.openAsset === a.id ? 'selected' : ''}>${a.id}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="prop-field">
        <label>Auto-Close After (ms, 0 = never)</label>
        <input type="number" id="guard-autoclose" class="prop-input" value="${guard.autoCloseAfterMs ?? 0}" min="0" />
      </div>
    ` : ''}
  `;

  // Wire up the edit button to open the popover
  body.querySelector('#vw-edit-condition')?.addEventListener('click', async () => {
    await host.openConditionEditorPopover('Edit Conditional Visibility', (rerender) =>
      host.renderConditionListEditor(comp, def, comp.visibleWhen || null, 'vw', (nextValue, recordHistory = true) => {
        host.state.updateComponent(comp.id, { visibleWhen: nextValue }, recordHistory);
        rerender();
      })
    );
  });

  // --- guard wiring ---
  body.querySelector('#guard-enabled')?.addEventListener('change', (e) => {
    host.state.updateComponent(comp.id, { layout: { ...(comp.layout || {}), guard: { ...guard, enabled: e.target.checked } } });
  });
  body.querySelector('#guard-closed-asset')?.addEventListener('change', (e) => {
    host.state.updateComponent(comp.id, { layout: { ...(comp.layout || {}), guard: { ...guard, closedAsset: e.target.value || undefined } } });
  });
  body.querySelector('#guard-open-asset')?.addEventListener('change', (e) => {
    host.state.updateComponent(comp.id, { layout: { ...(comp.layout || {}), guard: { ...guard, openAsset: e.target.value || undefined } } });
  });
  body.querySelector('#guard-autoclose')?.addEventListener('change', (e) => {
    const ms = Number.parseInt(e.target.value, 10) || 0;
    host.state.updateComponent(comp.id, { layout: { ...(comp.layout || {}), guard: { ...guard, autoCloseAfterMs: ms || undefined } } });
  });
}

/**
 * Builds a one-level condition editor, using JSON for deeper expressions.
 * @param {object} host Live Inspector; state owns syncFrom variables and history.
 * @param {object} comp Component whose read binding can supply its own value.
 * @param {object} def Widget definition supplying declared state variables.
 * @param {object|null} expr Stored condition expression.
 * @param {string} idPrefix Unique DOM id prefix.
 * @param {(next: object|undefined, recordHistory?: boolean) => void} onCommit Receives the ready expression.
 * @param {{deferred?: boolean}} [options] Caller handles syncFrom mutation on submission.
 * @returns {{html: string, wire: (mountEl: HTMLElement) => void}} Markup and listener installer.
 * Invalid JSON remains visible with an error and calls no commit. Immediate
 * own-value selection saves one history entry before syncFrom and calls
 * onCommit with recordHistory=false; deferred selection only supplies a draft.
 */
export function renderConditionListEditor(host, comp, def, expr, idPrefix, onCommit, options = {}) {
  const stateVars = def.state || [];

  // The visual editor supports a top-level combinator containing leaves or
  // one level of grouped leaves. Deeper expressions use the JSON fallback so
  // editing a visible row cannot discard structure the UI cannot represent.
  const combinator = expr?.anyOf ? 'anyOf' : 'allOf';
  // Empty state names remain valid draft leaves while no variable is declared.
  const conditions = expr ? (expr[combinator] || (typeof expr.state === 'string' ? [expr] : [])) : [];
  const isGroupCondition = (c) => !!c && typeof c === 'object' && (Array.isArray(c.allOf) || Array.isArray(c.anyOf));
  // Validate each member, not only the outer expression, before using rows.
  const isLeafCondition = (c) => !!c && typeof c === 'object' && typeof c.state === 'string' && !isGroupCondition(c);
  const isSimpleItem = (c) => isLeafCondition(c) || (isGroupCondition(c) && (c.allOf || c.anyOf).every(isLeafCondition));
  const isNestedOrComplex = !!expr && (!(expr.allOf || expr.anyOf || typeof expr.state === 'string') || !conditions.every(isSimpleItem));

  const OPS = ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'between'];
  // Show plain-language labels while storing the operator keys unchanged.
  const OP_LABELS = { equals: 'is', notEquals: 'is not', gt: 'is greater than', gte: 'is at least', lt: 'is less than', lte: 'is at most', between: 'is between' };

  // FDWS v1.13: a condition's `state` can address a nested/indexed path
  // (e.g. "presets[0].label"), not just a declared state[] var — same
  // grammar as binding.stateRef (v1.11). Any name not in the declared
  // list is treated as a custom/path value, same "Custom…" pattern used
  // elsewhere in this panel (bindings, event pickers).
  const stateIsCustomPath = (name) => !!name && !stateVars.some((s) => s.name === name);

  // Top-level and grouped leaves use the same fields and coercion.
  const leafFieldsHtml = (cond) => {
    const isCustom = stateIsCustomPath(cond.state);
    return `
      <div class="${idPrefix}-state-wrap" style="display:flex;flex-direction:column;gap:4px;flex:1;min-width:0;">
        <select class="row-field ${idPrefix}-state prop-select" data-field="state">
          ${conditionStateOptionsHtml(stateVars, cond.state, false, comp.binding?.readSimVar)}
        </select>
        <input type="text" class="row-field ${idPrefix}-state-custom prop-input ${isCustom ? '' : 'hidden'}" value="${isCustom ? escapeHtmlAttr(cond.state) : ''}" placeholder="e.g. presets[0].label" title="FDWS v1.13: 'name[index].field' path into an array/object state var — same grammar as a component's Bind to Local State Path." />
      </div>
      <select class="row-field ${idPrefix}-op prop-select" data-field="op">
        ${OPS.map((op) => `<option value="${op}" ${OPS.find((o) => cond[o] !== undefined) === op ? 'selected' : ''}>${OP_LABELS[op] || op}</option>`).join('')}
      </select>
      <input type="text" class="row-field ${idPrefix}-val" data-field="val" value="${(() => { const op = OPS.find((o) => cond[o] !== undefined); return op ? (op === 'between' ? (cond.between || []).join(',') : cond[op]) : ''; })()}" placeholder="${(OPS.find((o) => cond[o] !== undefined) === 'between') ? 'lo,hi' : 'value'}" />
    `;
  };

  // Nested leaf rows sit under .cond-group-rows, so the direct-child query
  // for top-level wiring excludes them.
  const conditionRowHtml = (cond, idx) => {
    if (isGroupCondition(cond)) {
      const groupCombinator = cond.anyOf ? 'anyOf' : 'allOf';
      const groupLeaves = cond[groupCombinator] || [];
      return `
    <div class="row-list-item cond-group" data-idx="${idx}" style="flex-direction:column;align-items:stretch;">
      <div class="cond-group-header">
        <select class="row-field ${idPrefix}-group-combinator prop-select">
          <option value="allOf" ${groupCombinator === 'allOf' ? 'selected' : ''}>Group: ALL of these are true</option>
          <option value="anyOf" ${groupCombinator === 'anyOf' ? 'selected' : ''}>Group: ANY of these are true</option>
        </select>
        <button type="button" class="btn-mini-close ${idPrefix}-remove" title="Remove Group">✕</button>
      </div>
      <div class="cond-group-rows">
        ${groupLeaves.map((leaf, leafIdx) => `
          <div class="row-list-item" data-leaf-idx="${leafIdx}">
            ${leafFieldsHtml(leaf)}
            <button type="button" class="btn-mini-close ${idPrefix}-remove-leaf" title="Remove">✕</button>
          </div>
        `).join('') || '<div class="caps-empty">Empty group — add a condition.</div>'}
      </div>
      <button type="button" class="bar-btn row-add ${idPrefix}-add-group-leaf">+ Add Condition to Group</button>
    </div>
  `;
    }
    return `
    <div class="row-list-item" data-idx="${idx}">
      ${leafFieldsHtml(cond)}
      <button type="button" class="btn-mini-close ${idPrefix}-remove" title="Remove">✕</button>
    </div>
  `;
  };

  const html = `
    ${isNestedOrComplex ? `
      <div class="caps-empty">This condition is too complex for the visual editor (hand-authored/nested). Edit it as JSON below, or clear it to start over with the visual editor.</div>
      <textarea id="${idPrefix}-raw-json" class="prop-input" rows="4">${escapeHtmlAttr(JSON.stringify(expr, null, 0))}</textarea>
      <div id="${idPrefix}-raw-error" class="prop-json-error hidden"></div>
      <button type="button" id="${idPrefix}-clear" class="bar-btn">Clear & Use Visual Editor</button>
    ` : `
      <div class="prop-field">
        <label>Match when…</label>
        <select id="${idPrefix}-combinator" class="prop-select" ${conditions.length === 0 ? 'disabled' : ''}>
          <option value="allOf" ${combinator === 'allOf' ? 'selected' : ''}>ALL of these are true</option>
          <option value="anyOf" ${combinator === 'anyOf' ? 'selected' : ''}>ANY of these are true</option>
        </select>
      </div>
      <div id="${idPrefix}-conditions">${conditions.map(conditionRowHtml).join('') || '<div class="caps-empty">No conditions set.</div>'}</div>
      <div class="prop-row-2" style="margin-top:6px;">
        <button type="button" id="${idPrefix}-add-condition" class="bar-btn row-add">+ Add Condition</button>
        <button type="button" id="${idPrefix}-add-group" class="bar-btn row-add" title="A nested ALL/ANY group — for e.g. 'X AND (Y OR Z)'">+ Add Group</button>
      </div>
    `}
  `;

  const wire = (mountEl) => {
    const commit = (nextConditions, nextCombinator, recordHistory = true) => {
      const value = nextConditions.length === 0 ? undefined : { [nextCombinator]: nextConditions };
      onCommit(value, recordHistory);
    };

    mountEl.querySelector(`#${idPrefix}-combinator`)?.addEventListener('change', (e) => commit(conditions, e.target.value));

    // Each row supplies its own writeValue; field behavior stays shared.
    const wireLeafFields = (rowEl, writeValue) => {
      const stateSelect = rowEl.querySelector(`.${idPrefix}-state`);
      const stateCustomInput = rowEl.querySelector(`.${idPrefix}-state-custom`);

      // The own-value choice overrides only the state path; operator and value
      // still flow through the common coercion path.
      const applyRowChange = (recordHistory = true, stateOverride = undefined) => {
        const state = stateOverride !== undefined ? stateOverride
          : stateSelect.value === CUSTOM_OPTION_VALUE ? stateCustomInput.value.trim() : stateSelect.value;
        const op = rowEl.querySelector(`.${idPrefix}-op`).value;
        const rawVal = rowEl.querySelector(`.${idPrefix}-val`).value;
        const cond = { state };
        if (op === 'between') {
          const [lo, hi] = rawVal.split(',').map((s) => Number(s.trim()));
          cond.between = [lo || 0, hi || 0];
        } else if (['gt', 'gte', 'lt', 'lte'].includes(op)) {
          cond[op] = Number(rawVal) || 0;
        } else {
          cond[op] = rawVal;
        }
        writeValue(cond, recordHistory);
      };
      stateSelect?.addEventListener('change', () => {
        if (stateSelect.value === OWN_VALUE_OPTION) {
          const simVar = comp.binding?.readSimVar;
          if (!simVar) return;
          const name = host.state.resolveSyncFromVarName(simVar);
          stateCustomInput?.classList.add('hidden');
          // Deferred callers apply syncFrom on Submit. Name resolution is
          // pure, so their draft row can still show the eventual path.
          if (!options.deferred) {
            host.state.saveHistory("Use This Component's Own Value");
            host.state.ensureSyncFromVar(simVar);
          }
          applyRowChange(false, name);
        } else if (stateSelect.value === CUSTOM_OPTION_VALUE) {
          // Just reveal the text field — don't commit yet. Committing here
          // with the still-empty custom input would trigger a synchronous
          // re-render (no debounce) that rebuilds this row from that empty
          // value, snapping the select back to "— state var —" and hiding
          // the field before the user can type anything into it — same
          // "reveal, don't write yet" pattern used for every other
          // Custom… dropdown in this panel.
          stateCustomInput?.classList.remove('hidden');
        } else {
          stateCustomInput?.classList.add('hidden');
          if (stateCustomInput) stateCustomInput.value = '';
          applyRowChange();
        }
      });
      stateCustomInput?.addEventListener('change', applyRowChange);
      rowEl.querySelector(`.${idPrefix}-op`)?.addEventListener('change', applyRowChange);
      rowEl.querySelector(`.${idPrefix}-val`)?.addEventListener('change', applyRowChange);
    };

    for (const rowEl of mountEl.querySelectorAll(`#${idPrefix}-conditions > .row-list-item`)) {
      const idx = Number(rowEl.dataset.idx);

      if (rowEl.classList.contains('cond-group')) {
        rowEl.querySelector(`.${idPrefix}-group-combinator`)?.addEventListener('change', (e) => {
          const item = conditions[idx];
          const groupLeaves = item[item.anyOf ? 'anyOf' : 'allOf'] || [];
          const next = [...conditions];
          next[idx] = { [e.target.value]: groupLeaves };
          commit(next, combinator);
        });
        rowEl.querySelector(`.${idPrefix}-remove`)?.addEventListener('click', () => {
          commit(conditions.filter((_, i) => i !== idx), combinator);
        });
        for (const leafEl of rowEl.querySelectorAll('.cond-group-rows > .row-list-item')) {
          const leafIdx = Number(leafEl.dataset.leafIdx);
          wireLeafFields(leafEl, (nextLeaf, recordHistory) => {
            const item = conditions[idx];
            const gc = item.anyOf ? 'anyOf' : 'allOf';
            const nextLeaves = [...(item[gc] || [])];
            nextLeaves[leafIdx] = nextLeaf;
            const next = [...conditions];
            next[idx] = { [gc]: nextLeaves };
            commit(next, combinator, recordHistory);
          });
          leafEl.querySelector(`.${idPrefix}-remove-leaf`)?.addEventListener('click', () => {
            const item = conditions[idx];
            const gc = item.anyOf ? 'anyOf' : 'allOf';
            const nextLeaves = (item[gc] || []).filter((_, i) => i !== leafIdx);
            const next = [...conditions];
            // No empty groups — removing a group's last leaf removes the
            // whole group rather than leaving a stray {allOf: []}.
            if (nextLeaves.length === 0) {
              next.splice(idx, 1);
            } else {
              next[idx] = { [gc]: nextLeaves };
            }
            commit(next, combinator);
          });
        }
        rowEl.querySelector(`.${idPrefix}-add-group-leaf`)?.addEventListener('click', () => {
          const item = conditions[idx];
          const gc = item.anyOf ? 'anyOf' : 'allOf';
          const nextLeaves = [...(item[gc] || []), { state: stateVars[0]?.name || '', equals: '' }];
          const next = [...conditions];
          next[idx] = { [gc]: nextLeaves };
          commit(next, combinator);
        });
      } else {
        wireLeafFields(rowEl, (nextLeaf, recordHistory) => {
          const next = [...conditions];
          next[idx] = nextLeaf;
          commit(next, combinator, recordHistory);
        });
        rowEl.querySelector(`.${idPrefix}-remove`)?.addEventListener('click', () => {
          commit(conditions.filter((_, i) => i !== idx), combinator);
        });
      }
    }

    mountEl.querySelector(`#${idPrefix}-add-condition`)?.addEventListener('click', () => {
      commit([...conditions, { state: stateVars[0]?.name || '', equals: '' }], combinator);
    });

    mountEl.querySelector(`#${idPrefix}-add-group`)?.addEventListener('click', () => {
      commit([...conditions, { allOf: [{ state: stateVars[0]?.name || '', equals: '' }] }], combinator);
    });

    mountEl.querySelector(`#${idPrefix}-clear`)?.addEventListener('click', () => {
      onCommit(undefined);
    });

    mountEl.querySelector(`#${idPrefix}-raw-json`)?.addEventListener('change', (e) => {
      try {
        const parsed = JSON.parse(e.target.value);
        onCommit(parsed);
        mountEl.querySelector(`#${idPrefix}-raw-error`)?.classList.add('hidden');
      } catch (err) {
        const errEl = mountEl.querySelector(`#${idPrefix}-raw-error`);
        if (errEl) {
          errEl.textContent = `Invalid JSON — edit not applied: ${err.message}`;
          errEl.classList.remove('hidden');
        }
      }
    });
  };

  return { html, wire };
}
