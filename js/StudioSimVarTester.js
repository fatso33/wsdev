/**
 * StudioSimVarTester.js
 * Release 0.4-B: the SimVar/event tester and fire-and-watch, moved out of the
 * component Property Inspector into a bottom-bar drawer alongside Sim Bench.
 *
 * Why it moved: neither tool is about the *selected component*. A tester tests
 * an address; fire-and-watch verifies an event. Living in the inspector made
 * them re-render per selection, took permanent space in an already dense
 * sidebar, and — worse — forced an ordering that doesn't match the work: you
 * had to select a component before you were allowed to find out whether an
 * address even reads. Now you experiment here, then Paste the result into
 * whichever binding field wants it (see StudioInspector's paste buttons).
 *
 * Deliberately NOT moved: the resolved-unit line (#c-bind-resolved-info). That
 * is a property annotation about the selected binding, not a tester, and it is
 * the only place in Studio that shows what a Deck Event resolves to.
 *
 * Uses the same drawer shell/CSS as StudioSimBench (.studio-sim-bench-drawer)
 * so the two read as siblings; they close each other.
 */

import { parsePastedBinding } from './StudioBindingParse.js';

export class StudioSimVarTester {
  /**
   * @param {HTMLElement} container
   * @param {import('./StudioState.js').StudioState} state
   * @param {import('../core/SimBridge.js').SimBridge} simBridge
   */
  constructor(container, state, simBridge) {
    this.container = container;
    this.state = state;
    this.simBridge = simBridge;
    this.isOpen = false;
    this.initDOM();
    this.attach();
  }

  initDOM() {
    this.container.className = 'studio-sim-bench-drawer closed';
    this.container.innerHTML = `
      <div class="sim-bench-header">
        <div class="sim-bench-title-wrap">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00d8f6" stroke-width="2"><circle cx="11" cy="11" r="7"></circle><path d="M21 21l-4.35-4.35"></path></svg>
          <span class="sim-bench-title">SIMVAR / EVENT TESTER</span>
          <span class="sim-bench-sub">Live · isolated from widget polling</span>
        </div>
        <button type="button" class="btn-mini-close" id="svt-close">✕</button>
      </div>

      <div class="svt-body">
        <div class="svt-section">
          <label class="svt-label">Paste &amp; Test</label>
          <div class="svt-row">
            <input type="text" id="svt-input" class="prop-input"
                   placeholder="(A:TRANSPONDER IDENT:1, Bool)  ·  (A:TITLE, string)  ·  1 (&gt;K:XPNDR_IDENT_ON)" />
            <button type="button" class="bar-btn" id="svt-parse">Parse</button>
            <button type="button" class="bar-btn" id="svt-test" disabled>Test</button>
          </div>
          <div class="svt-result" id="svt-result"></div>
        </div>

        <div class="svt-section">
          <label class="svt-label">Fire &amp; Watch
            <span class="prop-hint" title="Fires an event through the REAL dispatch path (the same one a widget's tap uses), reading a SimVar you name before and after to confirm something actually moved. A correct event can legitimately do nothing in the wrong aircraft state — that is reported as 'nothing moved', never as failure.">ⓘ</span>
          </label>
          <div class="svt-row">
            <input type="text" id="svt-fw-event" class="prop-input" placeholder="Event to fire, e.g. XPNDR_IDENT_ON" />
            <input type="number" id="svt-fw-value" class="prop-input svt-narrow" placeholder="value" value="1" />
          </div>
          <div class="svt-row">
            <input type="text" id="svt-fw-simvar" class="prop-input" placeholder="SimVar to observe, e.g. A:TRANSPONDER IDENT:1" />
            <input type="text" id="svt-fw-unit" class="prop-input svt-narrow" placeholder="unit" />
            <button type="button" class="bar-btn" id="svt-fw-go">Fire &amp; Watch</button>
          </div>
          <div class="svt-result" id="svt-fw-result"></div>
        </div>
      </div>
    `;
  }

  attach() {
    this.container.querySelector('#svt-close')?.addEventListener('click', () => this.close());
    this.container.querySelector('#svt-parse')?.addEventListener('click', () => this.handleParse());
    this.container.querySelector('#svt-test')?.addEventListener('click', () => this.handleTest());
    this.container.querySelector('#svt-fw-go')?.addEventListener('click', () => this.handleFireAndWatch());
  }

  toggle() {
    this.isOpen = !this.isOpen;
    this.container.classList.toggle('closed', !this.isOpen);
    this.container.classList.toggle('open', this.isOpen);
  }

  close() {
    this.isOpen = false;
    this.container.classList.add('closed');
    this.container.classList.remove('open');
  }

  handleParse() {
    const resultEl = this.container.querySelector('#svt-result');
    const testBtn = this.container.querySelector('#svt-test');
    const parsed = parsePastedBinding(this.container.querySelector('#svt-input').value);

    if (parsed.kind === 'empty') {
      this.state.setTesterParsed(null);
      resultEl.textContent = '';
      testBtn.disabled = true;
      return;
    }

    this.state.setTesterParsed(parsed);
    testBtn.disabled = false;

    if (parsed.kind === 'read') {
      resultEl.textContent = parsed.unit
        ? `Read binding: ${parsed.name} (unit ${parsed.unit}). Test it, then Paste into a Read field.`
        : `Read binding: ${parsed.name} — no unit given; a field pasted from this still needs one.`;
      // Pre-fill Fire & Watch's observe field: reading this address is almost
      // always how you'd verify a write you're about to test.
      const fwSimVar = this.container.querySelector('#svt-fw-simvar');
      if (fwSimVar && !fwSimVar.value.trim()) {
        fwSimVar.value = parsed.name;
        this.container.querySelector('#svt-fw-unit').value = parsed.unit || '';
      }
    } else if (parsed.kind === 'hevent') {
      resultEl.textContent = `H:Event: ${parsed.event}. Test and Save use the same path here, so a green Test result is trustworthy.`;
      this.container.querySelector('#svt-fw-event').value = parsed.event;
    } else if (parsed.kind === 'lvarset') {
      // Same transport as an H:Event (calculator code via the shim), so the
      // prefix is kept — it is what routes the dispatch — and the trustworthy
      // Test/Save wording applies here too.
      resultEl.textContent = `Sets local variable ${parsed.event}${parsed.value !== null ? ` to ${parsed.value}` : ''}. Test and Save use the same path here, so a green Test result is trustworthy.`;
      this.container.querySelector('#svt-fw-event').value = parsed.event;
      if (parsed.value !== null) this.container.querySelector('#svt-fw-value').value = parsed.value;
    } else if (parsed.kind === 'write') {
      resultEl.textContent = `Write event: ${parsed.event}${parsed.value !== null ? ` (value ${parsed.value})` : ''}. ⚠ Test runs via calculator code; a saved binding dispatches differently — use Fire & Watch below to verify that path.`;
      this.container.querySelector('#svt-fw-event').value = parsed.event.replace(/^K:/i, '');
      if (parsed.value !== null) this.container.querySelector('#svt-fw-value').value = parsed.value;
    } else {
      resultEl.textContent = 'Test-only — conditionals and multi-token sequences can’t be stored in a binding.';
    }
  }

  async handleTest() {
    const resultEl = this.container.querySelector('#svt-result');
    const parsed = this.state.testerParsed;
    if (!parsed) return;
    if (!this.simBridge?.connected) {
      resultEl.textContent = 'Not connected to PC Bridge — set the server address from the status pill in the top bar.';
      return;
    }
    if (parsed.kind !== 'read') {
      resultEl.textContent = 'Only read shapes can be probed here. Use Fire & Watch below for an event.';
      return;
    }
    resultEl.textContent = 'Testing…';
    try {
      const value = await this.simBridge.probeReadSimVar(parsed.name, parsed.unit || '');
      resultEl.textContent = `✅ Live value: ${value}`;
    } catch (err) {
      resultEl.textContent = `❌ ${err.message}`;
    }
  }

  async handleFireAndWatch() {
    const resultEl = this.container.querySelector('#svt-fw-result');
    const btn = this.container.querySelector('#svt-fw-go');
    if (!this.simBridge?.connected) {
      resultEl.textContent = 'Not connected to PC Bridge.';
      return;
    }
    const event = this.container.querySelector('#svt-fw-event').value.trim();
    const observeSimVar = this.container.querySelector('#svt-fw-simvar').value.trim();
    if (!event) { resultEl.textContent = 'Enter an event to fire.'; return; }
    if (!observeSimVar) { resultEl.textContent = 'Enter a SimVar to observe — that is what makes this a verification rather than a hopeful click.'; return; }
    const observeUnit = this.container.querySelector('#svt-fw-unit').value.trim();
    const fireValue = Number(this.container.querySelector('#svt-fw-value').value) || 0;

    btn.disabled = true;
    try {
      resultEl.textContent = 'Reading before value…';
      const before = await this.simBridge.probeReadSimVar(observeSimVar, observeUnit);

      resultEl.textContent = 'Firing…';
      // The REAL dispatch path — server.js's dispatchSimEvent ->
      // transmitClientEvent — not the calculator-code path the read Test above
      // uses. That distinction is the entire point: this is what verifies the
      // write that the paste box has to label as unverified.
      this.simBridge.sendEvent(event, fireValue);
      await new Promise((r) => setTimeout(r, 600));

      const after = await this.simBridge.probeReadSimVar(observeSimVar, observeUnit);
      resultEl.textContent = String(before) === String(after)
        // Never "this doesn't work": a correct event legitimately does nothing
        // with the transponder off, on the ground, or with the bus unpowered.
        ? `⚠ Fired — nothing moved (${observeSimVar} stayed ${after}). Check the aircraft state, or whether this is the right SimVar to watch.`
        : `✅ Fired — ${observeSimVar} went ${before} → ${after}.`;
    } catch (err) {
      resultEl.textContent = `❌ ${err.message}`;
    } finally {
      btn.disabled = false;
    }
  }
}
