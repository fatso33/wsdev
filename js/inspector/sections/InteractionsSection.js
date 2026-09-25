/**
 * @module InteractionsSection
 * Renders component interaction cards and edits their trigger, action, optional
 * feedback and condition. StudioInspector owns uiTier, widget state, history and
 * rendering. This module reads saved popovers, assets and component bindings;
 * it calls the host's condition editor, history/syncFrom helpers and state update.
 * StudioModal owns modal removal and keydown cleanup. Card and modal listeners
 * live with their DOM. Draft rows, conditions and own-value bindings live only
 * for one modal invocation. Registry and event picker imports are read-only;
 * this module has no module-level mutable state.
 */
import { getDeckEventsByKind, DECK_EVENT_NAMES } from '../../../core/deckEvents.js';
import { TRIGGERS as REGISTRY_TRIGGERS, ACTIONS as REGISTRY_ACTIONS } from '../../../widgets/PropertyRegistry.js';
import { openModal, confirmModal } from '../../StudioModal.js';
import { CUSTOM_OPTION_VALUE } from '../inspectorMarkup.js';

/**
 * Renders one component's interaction list into its existing Behavior mount.
 * @param {object} host Live Inspector; invokes its modal delegate and state update.
 * @param {object} comp Selected component, captured for card actions.
 * @param {HTMLElement} body Fresh Behavior child mount; owns card listeners until removed.
 * @returns {void} Appends no sibling content and retains the caller's section order.
 * A delete awaits confirmation before updating state; Cancel leaves it untouched.
 */
export function renderComponentInteractions(host, comp, body) {
      const interactions = comp.interactions || [];

      body.innerHTML = `
        <div class="interactions-list">
          ${interactions.length === 0 ? '<div class="caps-empty">No interaction triggers attached.</div>' : ''}
          ${interactions.map((inter, idx) => `
            <div class="interaction-card">
              <div class="inter-hdr">
                <span class="inter-tag">${inter.trigger || 'tap'}</span>
                <span class="inter-action-type">${inter.action?.type?.replace('core.', '') || ''}</span>
                <div class="inter-hdr-actions">
                  <button class="btn-edit-inter" data-idx="${idx}" title="Edit this interaction">✎</button>
                  <button class="btn-del-inter" data-idx="${idx}" title="Remove this interaction">✕</button>
                </div>
              </div>
              <div class="inter-desc">
                ${inter.action?.event ? `Event: <strong>${inter.action.event}</strong>` : ''}
                ${inter.action?.field ? `Field: <strong>${inter.action.field}</strong>` : ''}
                ${inter.action?.fields ? `Swap: <strong>${inter.action.fields.join(' ↔ ')}</strong>` : ''}
                ${inter.action?.popoverWidgetId ? `Popover: <strong>${inter.action.popoverWidgetId}</strong>` : ''}
                ${inter.action?.contextKey ? `Context Key: <strong>${inter.action.contextKey}</strong>` : ''}
                ${inter.action?.fromStateRef ? `From: <strong>${inter.action.fromStateRef}</strong>` : ''}
                ${inter.feedback?.haptic || inter.feedback?.sound ? `Feedback: <strong>${[inter.feedback.haptic ? `${inter.feedback.haptic} haptic` : '', inter.feedback.sound ? `sound: ${inter.feedback.sound}` : ''].filter(Boolean).join(', ')}</strong>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
        <button id="btn-add-interaction" class="panel-full-btn" style="margin-top:8px;">+ Add Interaction Trigger</button>
      `;

      for (const btn of body.querySelectorAll('.btn-edit-inter')) {
        btn.addEventListener('click', () => {
          const idx = Number.parseInt(btn.dataset.idx, 10);
          host.openAddInteractionModal(comp, idx);
        });
      }

      for (const btn of body.querySelectorAll('.btn-del-inter')) {
        btn.addEventListener('click', async () => {
          const idx = Number.parseInt(btn.dataset.idx, 10);
          const target = (comp.interactions || [])[idx];
          const ok = await confirmModal(`Remove the "${target?.trigger}" → ${target?.action?.type?.replace('core.', '') || ''} interaction?`, { title: 'Remove Interaction', danger: true });
          if (!ok) return;
          const next = [...(comp.interactions || [])];
          next.splice(idx, 1);
          host.state.updateComponent(comp.id, { interactions: next });
        });
      }

      body.querySelector('#btn-add-interaction')?.addEventListener('click', () => {
        host.openAddInteractionModal(comp);
      });
}

/**
 * Opens a deferred interaction editor and commits its result on Submit only.
 * @param {object} host Live Inspector with uiTier, state and condition-editor delegate;
 * its state supplies saved popovers, assets, history and syncFrom resolution.
 * @param {object} comp Component whose interactions are edited.
 * @param {number|null} editIdx Existing row index, or null to append.
 * @returns {Promise<void>} Resolves after Save or Cancel. Validation errors keep the
 * modal open; Cancel makes no state writes. Own-value conditions create or reuse a
 * syncFrom state variable and update the interaction in one labelled undo step.
 */
export async function openAddInteractionModal(host, comp, editIdx = null) {
    const existing = editIdx !== null ? (comp.interactions || [])[editIdx] : null;
    const existingAction = existing?.action || null;
    // Registry entries match the runtime dispatcher. Inactive triggers stay
    // selectable for authored widgets; the simple tiers show five common actions.
    const SIMPLE_ACTION_LABELS = {
      'core.dispatchEvent': 'Send a Value to the Simulator',
      'core.toggleLocalState': 'Toggle On / Off',
      'core.setLocalState': 'Set a Value',
      'core.swapLocalState': 'Swap Two Values',
      'core.openWidgetPopover': 'Open a Popup'
    };
    // Guided and Build use the short list; Full shows the complete catalogue.
    const isSimpleUi = host.uiTier !== 'full';
    const ACTION_TYPES = REGISTRY_ACTIONS
      .filter((a) => !a.internal)
      .filter((a) => !isSimpleUi || SIMPLE_ACTION_LABELS[a.type])
      .map((a) => ({
        type: a.type,
        label: isSimpleUi ? (SIMPLE_ACTION_LABELS[a.type] || a.label) : (a.deprecated ? `${a.label} (legacy)` : a.label)
      }));
    // A wildcard trigger works for every component; other triggers use type lists.
    const TRIGGER_TYPES = REGISTRY_TRIGGERS
      .filter((t) => !isSimpleUi ? true : t.live)
      .filter((t) => t.componentTypes.includes('*') || t.componentTypes.includes(comp.type));
    const initialActionType = (existingAction && ACTION_TYPES.some((a) => a.type === existingAction.type))
      ? existingAction.type
      : ACTION_TYPES[0].type;

    // Keep the complete expression; editing one clause must not drop siblings.
    let conditionExpr = existing?.condition || null;
    // The syncFrom variable is created only on Submit, never during a draft.
    let ownValueSimVar = null;

    let contextRows = (existingAction?.type === 'core.openWidgetPopover' && existingAction.context)
      ? Object.entries(existingAction.context).map(([key, v]) => ({
          key,
          stateRef: v.value?.stateRef || '',
          writable: !!v.writable,
          applyOn: v.applyOn
        }))
      : [];

    const eventPickerHtml = (id, current) => `
      <select id="${id}" class="prop-select">
        <option value="" ${!current ? 'selected' : ''}>— none —</option>
        ${getDeckEventsByKind('write').map((e) => `<option value="${e.name}" ${current === e.name ? 'selected' : ''}>${e.label}</option>`).join('')}
        <option value="${CUSTOM_OPTION_VALUE}" ${current && !DECK_EVENT_NAMES.includes(current) ? 'selected' : ''}>Custom…</option>
      </select>
      <input type="text" id="${id}-custom" class="prop-input ${current && !DECK_EVENT_NAMES.includes(current) ? '' : 'hidden'}" value="${current && !DECK_EVENT_NAMES.includes(current) ? current : ''}" placeholder="Custom event name" />
    `;

    // When editing, dynamicFieldsHtml prefills from the interaction's own
    // saved action — but only for the action type it was actually saved as;
    // switching the Action dropdown to something else during an edit falls
    // straight back to the same fresh defaults Add uses, since the old
    // action's fields don't mean anything for a different action type.
    const dynamicFieldsHtml = (actionType) => {
      const prior = existingAction?.type === actionType ? existingAction : null;
      if (actionType === 'core.dispatchEvent') {
        return `
          <div class="modal-form-row"><label>Event to Dispatch</label>${eventPickerHtml('im-event', prior?.event || comp.binding?.writeEvent || '')}</div>
          <div class="modal-form-row"><label>Value</label><input type="text" id="im-value" class="prop-input" value="${prior?.value !== undefined ? prior.value : 1}" placeholder="1" /></div>
          <div class="modal-form-row">
            <label>From State Ref (optional) <span class="prop-hint" title="Overrides Value above — reads via the same 'name[index].field' path grammar popovers use, e.g. presets[0].freq, instead of a static literal. Needed because a plain tap carries no value of its own to dispatch.">ⓘ</span></label>
            <input type="text" id="im-fromstateref" class="prop-input" value="${prior?.fromStateRef || ''}" placeholder="e.g. presets[0].freq — leave blank to use Value above" />
          </div>
        `;
      }
      if (actionType === 'core.toggleLocalState') {
        return `<div class="modal-form-row"><label>State Field to Toggle</label><input type="text" id="im-field" class="prop-input" value="${prior?.field || comp.binding?.stateVar || 'switchOn'}" /></div>`;
      }
      if (actionType === 'core.setLocalState') {
        return `
          <div class="modal-form-row"><label>State Field</label><input type="text" id="im-field" class="prop-input" value="${prior?.field || 'activeMode'}" /></div>
          <div class="modal-form-row"><label>Value (true / false / number / text)</label><input type="text" id="im-value" class="prop-input" value="${prior?.value !== undefined ? prior.value : 'true'}" /></div>
          <div class="modal-form-row">
            <label>From State Ref (optional) <span class="prop-hint" title="Overrides Value above — reads via the same 'name[index].field' path grammar popovers use, e.g. presets[0].freq, instead of a static literal. Needed because a plain tap carries no value of its own to set.">ⓘ</span></label>
            <input type="text" id="im-fromstateref" class="prop-input" value="${prior?.fromStateRef || ''}" placeholder="e.g. presets[0].freq — leave blank to use Value above" />
          </div>
        `;
      }
      if (actionType === 'core.swapLocalState') {
        return `
          <div class="modal-form-row"><label>First Field</label><input type="text" id="im-field1" class="prop-input" value="${prior?.fields?.[0] || 'actFreq'}" /></div>
          <div class="modal-form-row"><label>Second Field</label><input type="text" id="im-field2" class="prop-input" value="${prior?.fields?.[1] || 'stbyFreq'}" /></div>
        `;
      }
      if (actionType === 'core.openWidgetPopover') {
        const popovers = host.state.getSavedWidgetsByKind('popover');
        return `
          <div class="modal-form-row">
            <label>Popover Widget</label>
            ${popovers.length === 0
              ? '<div class="caps-empty">No saved popover widgets yet. Use "New Popover" in the bottom bar to design one first, then save it.</div>'
              : `<select id="im-popover-id" class="prop-select">${popovers.map((w) => `<option value="${w.id}" ${prior?.popoverWidgetId === w.id ? 'selected' : ''}>${w.meta?.name || w.id}</option>`).join('')}</select>`}
          </div>
          <div class="modal-form-row">
            <label>Context Map (data passed into the popover)</label>
            <div id="im-context-rows"></div>
            <button type="button" id="im-context-add" class="bar-btn row-add">+ Add Context Entry</button>
          </div>
        `;
      }
      if (actionType === 'core.commitToHost') {
        return `
          <div class="modal-form-row"><label>Context Key to Commit</label><input type="text" id="im-contextkey" class="prop-input" value="${prior?.contextKey || 'currentLabel'}" placeholder="Must match a key the host declared writable" /></div>
          <div class="modal-form-row">
            <label>Local State Field to Commit (optional) <span class="prop-hint" title="Leave blank to commit whatever value triggered this interaction (e.g. a core.input's own change event). Set this to commit a NAMED local state var instead — needed for a Save button, whose own tap carries no value: stage edits into local state first via core.setLocalState, then have Save read that field name here.">ⓘ</span></label>
            <input type="text" id="im-commit-field" class="prop-input" value="${prior?.field || ''}" placeholder="e.g. scratchLabel — leave blank to use the triggering event's own value" />
          </div>
        `;
      }
      if (actionType === 'core.ackIndicator') {
        return `
          <div class="modal-form-row">
            <label>Acknowledge Event (optional) <span class="prop-hint" title="Leave blank to use this component's own binding.ackEvent at runtime.">ⓘ</span></label>
            ${eventPickerHtml('im-event', prior?.event || comp.binding?.ackEvent || '')}
          </div>
        `;
      }
      return '<div class="caps-empty">This action takes no additional fields.</div>';
    };

    const result = await openModal({
      title: existing ? 'Edit Interaction Trigger' : 'Add Interaction Trigger',
      wide: true,
      bodyHtml: `
        <div class="modal-form-row">
          <label>Trigger</label>
          <select id="im-trigger" class="prop-select">${TRIGGER_TYPES.map((t) => `<option value="${t.id}" ${existing?.trigger === t.id ? 'selected' : ''}>${t.id}${t.live ? '' : ' (inactive — kept for old widgets)'}</option>`).join('')}</select>
        </div>
        <div class="modal-form-row">
          <label>Action</label>
          <select id="im-action-type" class="prop-select">${ACTION_TYPES.map((a) => `<option value="${a.type}" ${a.type === initialActionType ? 'selected' : ''}>${a.label}</option>`).join('')}</select>
        </div>
        <div id="im-dynamic-fields">${dynamicFieldsHtml(initialActionType)}</div>
        <div class="modal-form-row" style="margin-top:6px;border-top:1px solid var(--studio-panel-border);padding-top:10px;">
          <label style="display:flex;align-items:center;gap:6px;">
            <input type="checkbox" id="im-condition-on" ${existing?.condition ? 'checked' : ''} />
            Only Run If (optional) <span class="prop-hint" title="FDWS v1.23: the action (and feedback) above only fires when this is true — the interaction still runs its trigger normally otherwise, it just no-ops. Reuses the same condition grammar as Visible When. Example: skip a preset button's dispatch when its own presets[0].freq is still empty, instead of sending an empty/zeroed value.">ⓘ</span>
          </label>
          <div id="im-condition-row" class="${existing?.condition ? '' : 'hidden'}"></div>
        </div>
        <div class="modal-form-row" style="margin-top:6px;border-top:1px solid var(--studio-panel-border);padding-top:10px;">
          <label>Feedback (optional) <span class="prop-hint" title="FDWS v1.2 §4.1: fires alongside the action above, on every device that supports it. Independent of which action is chosen.">ⓘ</span></label>
          <div class="modal-form-row">
            <label style="font-weight:400;">Haptic</label>
            <select id="im-feedback-haptic" class="prop-select">
              <option value="" ${!existing?.feedback?.haptic ? 'selected' : ''}>None</option>
              <option value="light" ${existing?.feedback?.haptic === 'light' ? 'selected' : ''}>Light</option>
              <option value="medium" ${existing?.feedback?.haptic === 'medium' ? 'selected' : ''}>Medium</option>
              <option value="heavy" ${existing?.feedback?.haptic === 'heavy' ? 'selected' : ''}>Heavy</option>
            </select>
          </div>
          <div class="modal-form-row">
            <label style="font-weight:400;">Sound</label>
            <select id="im-feedback-sound" class="prop-select">
              <option value="" ${!existing?.feedback?.sound ? 'selected' : ''}>None</option>
              ${(host.state.widgetDef.assets || []).map((a) => `<option value="${a.id}" ${existing?.feedback?.sound === a.id ? 'selected' : ''}>${a.id}</option>`).join('')}
            </select>
            ${(host.state.widgetDef.assets || []).length === 0 ? '<div class="caps-empty">No assets uploaded yet — add one on the Assets tab for a switch-click sound.</div>' : ''}
          </div>
        </div>
      `,
      onMount: (card) => {
        const actionSel = card.querySelector('#im-action-type');
        const dynamicMount = card.querySelector('#im-dynamic-fields');

        const wireEventPicker = () => {
          const sel = card.querySelector('#im-event');
          const custom = card.querySelector('#im-event-custom');
          sel?.addEventListener('change', () => custom?.classList.toggle('hidden', sel.value !== CUSTOM_OPTION_VALUE));
        };

        const renderContextRows = () => {
          const mount = card.querySelector('#im-context-rows');
          if (!mount) return;
          mount.innerHTML = contextRows.length === 0 ? '<div class="caps-empty">None yet.</div>' : contextRows.map((row, idx) => `
            <div class="row-list-item" data-ctx-idx="${idx}">
              <input type="text" class="row-field ctx-key" value="${row.key}" placeholder="Context key" />
              <input type="text" class="row-field ctx-stateref" value="${row.stateRef}" placeholder="Host stateRef path" />
              <label style="display:flex;align-items:center;gap:4px;font-size:10px;"><input type="checkbox" class="ctx-writable" ${row.writable ? 'checked' : ''} /> Writable</label>
              <select class="row-field ctx-applyon prop-select ${row.writable ? '' : 'hidden'}">
                <option value="immediate" ${row.applyOn === 'immediate' ? 'selected' : ''}>Apply immediately</option>
                <option value="onHostTap" ${row.applyOn === 'onHostTap' ? 'selected' : ''}>Apply on host tap</option>
              </select>
              <button type="button" class="btn-mini-close ctx-remove">✕</button>
            </div>
          `).join('');

          for (const rowEl of mount.querySelectorAll('[data-ctx-idx]')) {
            const idx = Number(rowEl.dataset.ctxIdx);
            rowEl.querySelector('.ctx-key')?.addEventListener('change', (e) => { contextRows[idx].key = e.target.value; });
            rowEl.querySelector('.ctx-stateref')?.addEventListener('change', (e) => { contextRows[idx].stateRef = e.target.value; });
            rowEl.querySelector('.ctx-writable')?.addEventListener('change', (e) => {
              contextRows[idx].writable = e.target.checked;
              if (!contextRows[idx].applyOn) contextRows[idx].applyOn = 'onHostTap';
              renderContextRows();
            });
            rowEl.querySelector('.ctx-applyon')?.addEventListener('change', (e) => { contextRows[idx].applyOn = e.target.value; });
            rowEl.querySelector('.ctx-remove')?.addEventListener('click', () => { contextRows.splice(idx, 1); renderContextRows(); });
          }
        };

        const wireDynamicFields = () => {
          wireEventPicker();
          card.querySelector('#im-context-add')?.addEventListener('click', () => {
            contextRows.push({ key: '', stateRef: '', writable: false, applyOn: undefined });
            renderContextRows();
          });
          renderContextRows();
        };

        actionSel.addEventListener('change', () => {
          contextRows = [];
          dynamicMount.innerHTML = dynamicFieldsHtml(actionSel.value);
          wireDynamicFields();
        });

        wireDynamicFields();

        // The condition editor updates only the draft until Submit.
        const conditionToggle = card.querySelector('#im-condition-on');
        const conditionMount = card.querySelector('#im-condition-row');

        const renderConditionEditor = () => {
          const editor = host.renderConditionListEditor(comp, host.state.widgetDef, conditionExpr, 'imcond', (nextValue) => {
            conditionExpr = nextValue;
            renderConditionEditor();
          }, { deferred: true });
          conditionMount.innerHTML = editor.html;
          editor.wire(conditionMount);
        };
        renderConditionEditor();

        conditionToggle?.addEventListener('change', (e) => {
          conditionMount.classList.toggle('hidden', !e.target.checked);
        });
      },
      onSubmit: (card) => {
        const trigger = card.querySelector('#im-trigger').value;
        const actionType = card.querySelector('#im-action-type').value;
        const actionObj = { type: actionType };

        if (actionType === 'core.dispatchEvent') {
          const sel = card.querySelector('#im-event');
          const custom = card.querySelector('#im-event-custom');
          const ev = sel.value === CUSTOM_OPTION_VALUE ? custom.value.trim() : sel.value;
          if (!ev) return { error: 'Choose or type an event to dispatch.' };
          actionObj.event = ev;
          const fromStateRef = card.querySelector('#im-fromstateref')?.value.trim();
          if (fromStateRef) {
            actionObj.fromStateRef = fromStateRef;
          } else {
            const raw = card.querySelector('#im-value')?.value.trim() ?? '1';
            actionObj.value = raw === 'true' ? true : (raw === 'false' ? false : (raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw));
          }
        } else if (actionType === 'core.toggleLocalState') {
          const field = card.querySelector('#im-field').value.trim();
          if (!field) return { error: 'State field name is required.' };
          actionObj.field = field;
        } else if (actionType === 'core.setLocalState') {
          const field = card.querySelector('#im-field').value.trim();
          if (!field) return { error: 'State field name is required.' };
          actionObj.field = field;
          const fromStateRef = card.querySelector('#im-fromstateref')?.value.trim();
          if (fromStateRef) {
            actionObj.fromStateRef = fromStateRef;
          } else {
            const raw = card.querySelector('#im-value').value.trim();
            actionObj.value = raw === 'true' ? true : (raw === 'false' ? false : (raw !== '' && !Number.isNaN(Number(raw)) ? Number(raw) : raw));
          }
        } else if (actionType === 'core.swapLocalState') {
          const f1 = card.querySelector('#im-field1').value.trim();
          const f2 = card.querySelector('#im-field2').value.trim();
          if (!f1 || !f2) return { error: 'Both fields are required.' };
          actionObj.fields = [f1, f2];
        } else if (actionType === 'core.openWidgetPopover') {
          const sel = card.querySelector('#im-popover-id');
          if (!sel || !sel.value) return { error: 'Save a popover widget first, then pick it here.' };
          actionObj.popoverWidgetId = sel.value;
          const context = {};
          for (const row of contextRows) {
            if (!row.key) continue;
            context[row.key] = { value: { stateRef: row.stateRef }, writable: !!row.writable, ...(row.writable && row.applyOn ? { applyOn: row.applyOn } : {}) };
          }
          actionObj.context = context;
        } else if (actionType === 'core.commitToHost') {
          const contextKey = card.querySelector('#im-contextkey').value.trim();
          if (!contextKey) return { error: 'Context key is required.' };
          actionObj.contextKey = contextKey;
          const field = card.querySelector('#im-commit-field')?.value.trim();
          if (field) actionObj.field = field;
        } else if (actionType === 'core.ackIndicator') {
          const sel = card.querySelector('#im-event');
          const custom = card.querySelector('#im-event-custom');
          const ev = sel.value === CUSTOM_OPTION_VALUE ? custom.value.trim() : sel.value;
          if (ev) actionObj.event = ev;
        }
        // core.closePopover takes no payload.

        const feedback = {};
        const haptic = card.querySelector('#im-feedback-haptic')?.value;
        const sound = card.querySelector('#im-feedback-sound')?.value;
        if (haptic) feedback.haptic = haptic;
        if (sound) feedback.sound = sound;

        // An unchecked or empty condition is absent from the stored interaction.
        const conditionObj = card.querySelector('#im-condition-on')?.checked ? conditionExpr : null;

        // Inspect the final leaves so edits to multiple rows resolve own value
        // from the saved expression rather than from transient UI events.
        if (conditionObj) {
          const simVar = comp.binding?.readSimVar;
          const ownValueVarName = simVar ? host.state.resolveSyncFromVarName(simVar) : null;
          const leaves = conditionObj.allOf || conditionObj.anyOf || (conditionObj.state ? [conditionObj] : []);
          if (ownValueVarName && leaves.some((c) => c.state === ownValueVarName)) {
            ownValueSimVar = simVar;
          }
        }

        return {
          value: {
            trigger,
            action: actionObj,
            ...(conditionObj ? { condition: conditionObj } : {}),
            ...(Object.keys(feedback).length ? { feedback } : {})
          }
        };
      }
    });

    if (!result) return;
    const nextInteractions = [...(comp.interactions || [])];
    if (editIdx !== null) {
      nextInteractions[editIdx] = result;
    } else {
      nextInteractions.push(result);
    }
    // Create the syncFrom var and interaction after one history snapshot so
    // Cancel stays side-effect free and Undo reverts both changes together.
    if (ownValueSimVar) {
      host.state.saveHistory(editIdx !== null ? 'Edit Interaction' : 'Add Interaction');
      host.state.ensureSyncFromVar(ownValueSimVar);
      host.state.updateComponent(comp.id, { interactions: nextInteractions }, false);
    } else {
      host.state.updateComponent(comp.id, { interactions: nextInteractions });
    }
}
