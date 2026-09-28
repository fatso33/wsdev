/**
 * @module ConnectDialog
 * Owns one Connect modal invocation: local tab, selection, search, raw unit and
 * async probe state. StudioModal owns overlay/key listener cleanup; DOM listeners
 * live with the modal. The live Inspector supplies StudioState, Bridge and Tester
 * collaborators. This module has no persistent state or import-time side effects.
 */
import { isWriteEventConsumed, proposeWireUp, SELF_DISPATCHING_WRITE_EVENT_TYPES } from '../../StudioValidator.js';
import { SecurityValidator } from '../../../core/SecurityValidator.js';
import { getDeckEventsByKind, DECK_EVENT_NAMES } from '../../../core/deckEvents.js';
import { extractCustomDeckEvents } from '../../../core/widgetVarExtractor.js';
import { getPackSuggestedEvents } from '../../../core/deckEventPacks.js';
import { openModal } from '../../StudioModal.js';
import { escapeHtmlAttr, CATEGORY_LABELS } from '../inspectorMarkup.js';

/**
 * Opens a Connect dialog for a component binding and resolves after Cancel or
 * one state update. `kind` is read or write; `bindingField` can target any
 * other write event, or another read. Only `readSimVar` owns `binding.unit`:
 * its raw tab offers the unit, a raw read writes it and a catalogue read clears
 * it; another read field shows no unit and is written alone. Only `writeEvent`
 * gets pairing: its hints, its checkbox, and proposed interactions appended in
 * the same update. Any other field is written alone. Probe errors stay in the
 * dialog and busy state clears after completion; Bridge calls may reject.
 * @param {object} host Live Inspector with state, optional simBridge and simVarTester.
 * @param {object} comp Component captured at opening for binding and pairing.
 * @param {object} def Widget definition whose id excludes itself from saved-widget suggestions.
 * @param {'read'|'write'} kind Binding and sanitizer mode.
 * @param {string} [bindingField] Binding key; defaults by kind.
 * @returns {Promise<void>} Resolves after modal dismissal and any state update.
 */
export async function openConnectDialog(host, comp, def, kind, bindingField = (kind === 'write' ? 'writeEvent' : 'readSimVar')) {
    const isWrite = kind === 'write';
    // A proposed Dispatch Sim Event row has no event of its own and falls back to
    // binding.writeEvent, so pairing any other field would wire nothing to it.
    const pairsWriteEvent = isWrite && bindingField === 'writeEvent';
    // binding.unit is Read's; another read field writing it would overwrite or clear Read's unit.
    const ownsUnit = !isWrite && bindingField === 'readSimVar';
    const sanitizeKind = isWrite ? 'event' : 'simvar';
    const current = comp.binding?.[bindingField] || '';

    const savedWidgets = host.state.loadSavedWidgets().filter((w) => w.id !== def.id);
    const customDeckEvents = extractCustomDeckEvents(savedWidgets, DECK_EVENT_NAMES).map((e) => ({
      ...e,
      source: e.widgetIds.length ? `used by ${e.widgetIds.join(', ')}` : ''
    }));
    const packEvents = getPackSuggestedEvents()
      .filter((e) => !customDeckEvents.some((c) => c.name === e.name))
      .map((e) => ({ name: e.name, kind: e.kind, source: `from pack: ${e.fromPack}` }));
    // Browsable rows and raw-address suggestions share the existing saved-widget and pack data.
    const mergedCustom = [...customDeckEvents, ...packEvents].filter((e) => e.kind === kind);

    const catalogueItems = getDeckEventsByKind(kind);
    // Keep dialog state through local tab re-renders without reopening the modal.
    let activeTab = /^(A|L|H|K):/i.test(current) ? 'raw' : 'catalogue';
    let selectedName = current;
    let searchQuery = '';
    let rawUnit = ownsUnit ? (comp.binding?.unit || '') : '';
    let testResult = '';
    let testBusy = false;

    const proposedRows = pairsWriteEvent ? proposeWireUp(comp) : null;

    const catalogueRowsHtml = () => {
      const q = searchQuery.trim().toLowerCase();
      const matches = (e) => !q || e.label.toLowerCase().includes(q) || e.name.toLowerCase().includes(q);
      const rows = catalogueItems.filter(matches).map((e) => `
        <button type="button" class="row-list-item cn-pick" data-name="${escapeHtmlAttr(e.name)}" style="width:100%;text-align:left;cursor:pointer;${selectedName === e.name ? 'outline:1px solid var(--accent-cyan);' : ''}">
          <div style="flex:1;min-width:0;">
            <div>${escapeHtmlAttr(e.label)}</div>
            <div style="font-size:10px;color:var(--text-label);">${escapeHtmlAttr(e.name)} · ${escapeHtmlAttr(CATEGORY_LABELS[e.category] || e.category)}</div>
          </div>
        </button>
      `).join('');
      const customRows = mergedCustom.filter(matches).map((e) => `
        <button type="button" class="row-list-item cn-pick" data-name="${escapeHtmlAttr(e.name)}" style="width:100%;text-align:left;cursor:pointer;${selectedName === e.name ? 'outline:1px solid var(--accent-cyan);' : ''}">
          <div style="flex:1;min-width:0;">
            <div>${escapeHtmlAttr(e.name)}</div>
            <div style="font-size:10px;color:var(--text-label);">${escapeHtmlAttr(e.source || '')}</div>
          </div>
        </button>
      `).join('');
      return `
        ${rows || `<div class="caps-empty">No matches in this widget's Deck Events catalogue. <button type="button" class="btn-mini-inline" id="cn-findit">Find it by moving it →</button></div>`}
        ${customRows ? `<div class="prop-section-subtitle" style="margin-top:8px;">Previously Used</div>${customRows}` : ''}
      `;
    };

    const rawTabHtml = () => `
      <div class="prop-field">
        <label>${isWrite ? 'Raw SimConnect Event (H:/K:...)' : 'Raw SimVar (A:/L:...)'}</label>
        <input type="text" id="cn-raw-input" class="prop-input" value="${escapeHtmlAttr(activeTab === 'raw' ? selectedName : '')}" placeholder="${isWrite ? 'e.g. H:GTN750_DirectToPush' : 'e.g. L:FBW_TAXI_LIGHT_INTENSITY'}" list="cn-raw-suggestions" />
        <datalist id="cn-raw-suggestions">${mergedCustom.map((e) => `<option value="${escapeHtmlAttr(e.name)}"></option>`).join('')}</datalist>
        <div class="prop-sanitize-diff hidden" id="cn-raw-diff"></div>
      </div>
      ${ownsUnit ? `
        <div class="prop-field">
          <label>SimConnect Unit <span class="prop-hint" title="Only a raw address's unit is yours to set — a Deck Event's unit comes from the active PC Bridge profile, which is why this field only appears here, not on the Catalogue tab. Leave blank to use the host's default ('Number'). For a TEXT variable (TITLE, ATC MODEL, ATC ID) type 'string'.">ⓘ</span></label>
          <input type="text" id="cn-raw-unit" class="prop-input" value="${escapeHtmlAttr(rawUnit)}" placeholder="Number" />
        </div>
      ` : ''}
    `;

    const pairingHtml = () => {
      if (!pairsWriteEvent || !selectedName) return '';
      // Matches StudioValidator's own exemptions exactly (comp.type dictates
      // this, never the chosen event) — these types dispatch binding.writeEvent
      // themselves at runtime, so no interaction is needed or meaningful.
      if (SELF_DISPATCHING_WRITE_EVENT_TYPES.includes(comp.type)) {
        return `<div class="prop-hint-block" style="font-size:11px;opacity:0.7;margin-top:8px;">This component type sends this value automatically — no interaction needed.</div>`;
      }
      if (isWriteEventConsumed({ ...comp, binding: { ...comp.binding, writeEvent: selectedName } })) {
        return `<div class="prop-hint-block" style="font-size:11px;opacity:0.7;margin-top:8px;">Already wired — an existing interaction dispatches this event.</div>`;
      }
      if (!proposedRows) {
        return `<div class="prop-hint-block" style="font-size:11px;opacity:0.7;margin-top:8px;">This component type has no single-trigger auto-wire — add an interaction manually (Behavior panel) once connected, or it won't do anything yet.</div>`;
      }
      const rowsDesc = proposedRows.map((r) => `<code>${escapeHtmlAttr(r.trigger)}</code>`).join(' + ');
      return `
        <label class="prop-field" style="display:flex;align-items:center;gap:6px;font-size:11px;margin-top:8px;">
          <input type="checkbox" id="cn-pair-checkbox" checked />
          Also add: ${rowsDesc} → Dispatch Sim Event — without this, setting the event alone does nothing when tapped.
        </label>
      `;
    };

    const testTabHtml = () => {
      if (isWrite) {
        return `
          <div class="prop-hint-block" style="font-size:11px;opacity:0.7;">A write event can't be verified by reading it back — firing it and watching a SimVar change is the only real proof. That's Fire &amp; Watch, in the SimVar Tester drawer below; this hands off there with the event pre-filled.</div>
          <button type="button" class="bar-btn" id="cn-test-firewatch" style="margin-top:8px;" ${selectedName ? '' : 'disabled'}>Open in Fire &amp; Watch →</button>
        `;
      }
      if (!selectedName) {
        return `<div class="prop-hint-block" style="font-size:11px;opacity:0.7;">Pick or type a SimVar first, then come back here to test it live.</div>`;
      }
      return `
        <div class="prop-field">
          <label>${escapeHtmlAttr(selectedName)}</label>
          <button type="button" class="bar-btn" id="cn-test-probe" ${testBusy ? 'disabled' : ''}>${testBusy ? 'Testing…' : 'Test'}</button>
        </div>
        <div class="svt-result">${escapeHtmlAttr(testResult)}</div>
      `;
    };

    const bodyHtml = () => `
      <div style="display:flex;gap:8px;margin-bottom:8px;">
        <button type="button" class="mode-toggle-btn ${activeTab === 'catalogue' ? 'active' : ''}" id="cn-tab-catalogue" style="flex:1;">Catalogue</button>
        <button type="button" class="mode-toggle-btn ${activeTab === 'raw' ? 'active' : ''}" id="cn-tab-raw" style="flex:1;">Raw Address</button>
        <button type="button" class="mode-toggle-btn ${activeTab === 'test' ? 'active' : ''}" id="cn-tab-test" style="flex:1;">Test</button>
      </div>
      ${activeTab === 'catalogue' ? `
        <input type="text" id="cn-search" class="prop-input" placeholder="Search by name…" value="${escapeHtmlAttr(searchQuery)}" style="margin-bottom:8px;" />
        <div id="cn-catalogue-rows" style="display:flex;flex-direction:column;gap:4px;max-height:260px;overflow-y:auto;">${catalogueRowsHtml()}</div>
      ` : activeTab === 'raw' ? rawTabHtml() : testTabHtml()}
      <div id="cn-pairing">${activeTab === 'test' ? '' : pairingHtml()}</div>
    `;

    const result = await openModal({
      title: `Connect — ${isWrite ? 'Write to' : 'Read from'} Simulator`,
      bodyHtml: bodyHtml(),
      submitLabel: 'Connect',
      wide: true,
      onMount: (card) => {
        const pairingMount = () => card.querySelector('#cn-pairing');
        const refreshPairing = () => { pairingMount().innerHTML = pairingHtml(); };

        const wireCatalogueTab = () => {
          card.querySelector('#cn-search')?.addEventListener('input', (e) => {
            searchQuery = e.target.value;
            card.querySelector('#cn-catalogue-rows').innerHTML = catalogueRowsHtml();
            wireCatalogueRows();
          });
          wireCatalogueRows();
        };
        const wireCatalogueRows = () => {
          for (const btn of card.querySelectorAll('.cn-pick')) {
            btn.addEventListener('click', () => {
              selectedName = btn.dataset.name;
              rawUnit = ''; // FDWS v1.2 §1.5: a catalogue pick's unit comes from the PC Bridge profile — a stale raw unit left over from a prior raw-address value would now be silently inert.
              for (const b of card.querySelectorAll('.cn-pick')) {
                b.style.outline = b.dataset.name === selectedName ? '1px solid var(--accent-cyan)' : '';
              }
              refreshPairing();
            });
          }
          // Close the overlay before opening the tester drawer so the drawer is visible.
          card.querySelector('#cn-findit')?.addEventListener('click', () => {
            card.querySelector('[data-modal-cancel]')?.click();
            host.simVarTester?.open();
          });
        };
        const wireRawTab = () => {
          const input = card.querySelector('#cn-raw-input');
          const unitInput = card.querySelector('#cn-raw-unit');
          const diffEl = card.querySelector('#cn-raw-diff');
          const updateDiff = () => {
            if (!input || !diffEl) return;
            const { removed } = SecurityValidator.sanitizeWithReport(sanitizeKind, input.value);
            diffEl.classList.toggle('hidden', removed.length === 0);
            if (removed.length) diffEl.textContent = `Removed ${removed.map((c) => `"${c}"`).join(' ')} — only the cleaned text will be saved.`;
          };
          input?.addEventListener('input', () => {
            const { cleaned } = SecurityValidator.sanitizeWithReport(sanitizeKind, input.value);
            selectedName = cleaned;
            updateDiff();
            refreshPairing();
          });
          unitInput?.addEventListener('input', () => { rawUnit = unitInput.value.trim(); });
        };
        const rerenderTestTab = () => {
          card.querySelector('.modal-body').innerHTML = bodyHtml();
          wireTestTab();
        };
        const wireTestTab = () => {
          card.querySelector('#cn-test-firewatch')?.addEventListener('click', () => {
            host.simVarTester?.prefillFireAndWatch(selectedName);
          });
          card.querySelector('#cn-test-probe')?.addEventListener('click', async () => {
            if (!host.simBridge?.connected) {
              testResult = 'Not connected to PC Bridge — set the server address from the status pill in the top bar.';
              rerenderTestTab();
              return;
            }
            testBusy = true;
            testResult = '';
            rerenderTestTab();
            try {
              // Raw addresses probe directly; logical Deck Events resolve through the active profile.
              if (/^(A|L):/i.test(selectedName)) {
                const value = await host.simBridge.probeReadSimVar(selectedName, rawUnit);
                testResult = `✅ Live value: ${value}`;
              } else {
                const resolved = await host.simBridge.resolveDeckEvent(selectedName);
                if (!resolved) {
                  testResult = `"${selectedName}" has no mapping in the active profile.`;
                } else {
                  const value = await host.simBridge.probeReadSimVar(resolved.simVar, resolved.unit);
                  testResult = `✅ Live value: ${value} (${resolved.simVar}, unit ${resolved.unit})`;
                }
              }
            } catch (err) {
              testResult = `❌ ${err.message}`;
            } finally {
              testBusy = false;
              rerenderTestTab();
            }
          });
        };

        card.querySelector('#cn-tab-catalogue')?.addEventListener('click', () => {
          activeTab = 'catalogue';
          card.querySelector('.modal-body').innerHTML = bodyHtml();
          wireCatalogueTab();
        });
        card.querySelector('#cn-tab-raw')?.addEventListener('click', () => {
          activeTab = 'raw';
          card.querySelector('.modal-body').innerHTML = bodyHtml();
          wireRawTab();
        });
        card.querySelector('#cn-tab-test')?.addEventListener('click', () => {
          activeTab = 'test';
          card.querySelector('.modal-body').innerHTML = bodyHtml();
          wireTestTab();
        });

        if (activeTab === 'catalogue') wireCatalogueTab(); else wireRawTab();
      },
      onSubmit: (card) => {
        if (!selectedName) return { error: `Choose or type a ${isWrite ? 'write event' : 'SimVar'} first.` };
        const pairChecked = card.querySelector('#cn-pair-checkbox')?.checked ?? true;
        return { value: { name: selectedName, unit: activeTab === 'raw' ? rawUnit : undefined, pair: pairChecked } };
      }
    });

    if (!result) return;

    const updates = { [bindingField]: result.name };
    if (ownsUnit) updates.unit = result.unit || undefined;

    if (pairsWriteEvent && result.pair) {
      const withNewEvent = { ...comp, binding: { ...comp.binding, writeEvent: result.name } };
      if (!isWriteEventConsumed(withNewEvent)) {
        const rows = proposeWireUp(comp);
        if (rows) {
          host.state.updateComponent(comp.id, {
            binding: { ...(comp.binding || {}), ...updates },
            interactions: [...(comp.interactions || []), ...rows]
          });
          return;
        }
      }
    }
    host.state.updateComponent(comp.id, { binding: { ...(comp.binding || {}), ...updates } });
  }
