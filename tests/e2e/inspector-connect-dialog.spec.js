import { test, expect, openStudio } from './fixtures/inspectorHarness.js';

async function openDialog(page, { type = 'core.button', kind = 'read', binding = {}, interactions = [], bindingField } = {}) {
  await openStudio(page);
  await page.evaluate(({ type, kind, binding, interactions, bindingField }) => {
    const { state, inspector } = window.__studioApp;
    const comp = state.addComponent({ id: 'connect-pin', type, label: 'Connect pin', binding, interactions, props: {}, style: {} });
    window.__connectPin = { comp, calls: [] };
    const original = state.updateComponent;
    state.updateComponent = function (...args) {
      window.__connectPin.calls.push(structuredClone(args));
      return original.apply(this, args);
    };
    inspector.openConnectDialog(comp, state.widgetDef, kind, bindingField);
  }, { type, kind, binding, interactions, bindingField });
  await expect(page.locator('.studio-modal-overlay:not(.hidden)')).toBeVisible();
}

async function updates(page) {
  return page.evaluate(() => window.__connectPin.calls);
}

test('initial tab, catalogue search and picking a catalogue row discard a raw unit', async ({ page }) => {
  await openDialog(page, { binding: { readSimVar: 'apHdgBugValue', unit: 'degrees' } });
  await expect(page.locator('#cn-tab-catalogue')).toHaveClass(/active/);
  await page.locator('#cn-search').fill('no-such-deck-event');
  await expect(page.locator('#cn-catalogue-rows .cn-pick')).toHaveCount(0);
  await page.locator('#cn-search').fill('');
  const name = await page.locator('#cn-catalogue-rows .cn-pick').first().getAttribute('data-name');
  await page.locator('#cn-catalogue-rows .cn-pick').first().click();
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect.poll(() => updates(page)).toHaveLength(1);
  expect((await updates(page))[0][1].binding).toEqual({ readSimVar: name, unit: undefined });

  for (const raw of ['A:TITLE', 'L:LOCAL', 'H:EVENT', 'K:EVENT']) {
    await page.evaluate((value) => {
      const { comp } = window.__connectPin;
      window.__studioApp.inspector.openConnectDialog({ ...comp, binding: { readSimVar: value } }, window.__studioApp.state.widgetDef, 'read');
    }, raw);
    await expect(page.locator('#cn-tab-raw')).toHaveClass(/active/);
    await page.locator('[data-modal-cancel]').click();
  }
});

test('raw address shows sanitization and commits read unit in one update', async ({ page }) => {
  await openDialog(page, { binding: { readSimVar: 'L:OLD' } });
  await page.locator('#cn-raw-input').fill('(L:NEW_VALUE)');
  await expect(page.locator('#cn-raw-diff')).toContainText('Removed');
  await page.locator('#cn-raw-unit').fill('string');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect.poll(() => updates(page)).toHaveLength(1);
  expect((await updates(page))[0][1].binding).toEqual({ readSimVar: 'L:NEW_VALUE', unit: 'string' });
});

test('write pairing distinguishes auto-wire, unchecked, already wired, self-dispatching and unsupported types', async ({ page }) => {
  await openDialog(page, { kind: 'write' });
  await page.locator('#cn-catalogue-rows .cn-pick').first().click();
  await expect(page.locator('#cn-pair-checkbox')).toBeChecked();
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect.poll(() => updates(page)).toHaveLength(1);
  expect((await updates(page))[0][1].interactions).toEqual([{ trigger: 'tap', action: { type: 'core.dispatchEvent' } }]);

  await page.evaluate(() => {
    const { comp } = window.__connectPin;
    window.__studioApp.inspector.openConnectDialog({ ...comp, interactions: [] }, window.__studioApp.state.widgetDef, 'write');
  });
  await page.locator('#cn-catalogue-rows .cn-pick').first().click();
  await page.locator('#cn-pair-checkbox').uncheck();
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect.poll(() => updates(page)).toHaveLength(2);
  expect((await updates(page))[1][1]).not.toHaveProperty('interactions');

  for (const [type, interactions, text] of [
    ['core.rotary', [], 'sends this value automatically'],
    ['core.rocker', [], 'no single-trigger auto-wire'],
    ['core.button', [{ trigger: 'tap', action: { type: 'core.dispatchEvent' } }], 'Already wired']
  ]) {
    await page.evaluate(({ type, interactions }) => {
      const comp = { ...window.__connectPin.comp, type, interactions };
      window.__studioApp.inspector.openConnectDialog(comp, window.__studioApp.state.widgetDef, 'write');
    }, { type, interactions });
    await page.locator('#cn-catalogue-rows .cn-pick').first().click();
    await expect(page.locator('#cn-pairing')).toContainText(text);
    await expect(page.locator('#cn-pair-checkbox')).toHaveCount(0);
    await page.locator('[data-modal-cancel]').click();
  }
});

test('read Test tab covers offline, raw probe, resolved Deck Event, unmapped and error results', async ({ page }) => {
  await openDialog(page, { binding: { readSimVar: 'L:TEST', unit: 'string' } });
  await page.evaluate(() => {
    const log = [];
    window.__connectProbe = log;
    const bridge = {
      connected: false,
      async resolveDeckEvent(name) { log.push(['resolve', name]); return { simVar: 'A:TITLE', unit: 'string' }; },
      async probeReadSimVar(...args) { log.push(['probe', ...args]); return 'LIVE'; }
    };
    window.__studioApp.inspector.simBridge = bridge;
    window.__connectBridge = bridge;
  });
  await page.locator('#cn-tab-test').click();
  await page.locator('#cn-test-probe').click();
  await expect(page.locator('.modal-body .svt-result')).toContainText('Not connected to PC Bridge');
  await page.evaluate(() => { window.__connectBridge.connected = true; });
  await page.locator('#cn-test-probe').click();
  await expect(page.locator('.modal-body .svt-result')).toContainText('Live value: LIVE');
  expect(await page.evaluate(() => window.__connectProbe)).toEqual([['probe', 'L:TEST', 'string']]);

  await page.locator('[data-modal-cancel]').click();
  await page.evaluate(() => {
    const comp = { ...window.__connectPin.comp, binding: { readSimVar: 'apHdgBugValue' } };
    window.__studioApp.inspector.openConnectDialog(comp, window.__studioApp.state.widgetDef, 'read');
  });
  const name = 'apHdgBugValue';
  await page.locator('#cn-tab-test').click();
  await page.locator('#cn-test-probe').click();
  await expect(page.locator('.modal-body .svt-result')).toContainText('(A:TITLE, unit string)');
  expect((await page.evaluate(() => window.__connectProbe)).slice(-2)).toEqual([['resolve', name], ['probe', 'A:TITLE', 'string']]);
  await page.evaluate(() => { window.__connectBridge.resolveDeckEvent = async () => null; });
  await page.locator('#cn-test-probe').click();
  await expect(page.locator('.modal-body .svt-result')).toContainText('has no mapping');
  await page.evaluate(() => { window.__connectBridge.resolveDeckEvent = async () => { throw new Error('probe failed'); }; });
  await page.locator('#cn-test-probe').click();
  await expect(page.locator('.modal-body .svt-result')).toContainText('probe failed');
});

test('busy probe disables Test until async completion; Fire & Watch receives selected event', async ({ page }) => {
  await openDialog(page, { binding: { readSimVar: 'A:TITLE' } });
  await page.evaluate(() => {
    window.__studioApp.inspector.simBridge = {
      connected: true,
      probeReadSimVar: () => new Promise((resolve) => { window.__finishProbe = resolve; })
    };
  });
  await page.locator('#cn-tab-test').click();
  await page.locator('#cn-test-probe').click();
  await expect(page.locator('#cn-test-probe')).toBeDisabled();
  await page.evaluate(() => window.__finishProbe(42));
  await expect(page.locator('#cn-test-probe')).toBeEnabled();
  await page.locator('[data-modal-cancel]').click();

  await page.evaluate(() => {
    const comp = { ...window.__connectPin.comp, binding: { writeEvent: 'H:WATCH' } };
    window.__studioApp.inspector.simVarTester = { prefillFireAndWatch: (name) => { window.__watched = name; } };
    window.__studioApp.inspector.openConnectDialog(comp, window.__studioApp.state.widgetDef, 'write');
  });
  await page.locator('#cn-tab-test').click();
  await page.locator('#cn-test-firewatch').click();
  expect(await page.evaluate(() => window.__watched)).toBe('H:WATCH');
  await page.locator('[data-modal-cancel]').click();
});

test('Find it cancels before opening tester; custom write field commits to incrementEvent', async ({ page }) => {
  await openDialog(page, { kind: 'write', type: 'core.rotary', bindingField: 'incrementEvent' });
  await page.evaluate(() => {
    window.__studioApp.inspector.simVarTester = { open: () => { window.__finditSawModal = !!document.querySelector('.studio-modal-overlay:not(.hidden)'); } };
  });
  await page.locator('#cn-search').fill('no-such-event');
  await page.locator('#cn-findit').click();
  await expect(page.locator('.studio-modal-overlay:not(.hidden)')).toHaveCount(0);
  expect(await page.evaluate(() => window.__finditSawModal)).toBe(false);

  await page.evaluate(() => {
    const { comp } = window.__connectPin;
    window.__studioApp.inspector.openConnectDialog(comp, window.__studioApp.state.widgetDef, 'write', 'incrementEvent');
  });
  await page.locator('#cn-tab-raw').click();
  await page.locator('#cn-raw-input').fill('H:ROTARY_INCREMENT');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect.poll(() => updates(page)).toHaveLength(1);
  expect((await updates(page))[0][1].binding).toEqual({ incrementEvent: 'H:ROTARY_INCREMENT' });
});
