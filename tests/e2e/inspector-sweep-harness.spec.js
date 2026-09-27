import {
  test,
  expect,
  openStudio,
  countInjectedInInspector,
  collectRenderErrors,
  installWriteRecorder,
  runSeeding,
  snapshotWidgetDef,
  readWriteCheck,
} from './fixtures/inspectorHarness.js';

async function plantInjected(page, parentSelector) {
  await page.evaluate((selector) => {
    const img = document.createElement('img');
    img.id = 'injected';
    document.querySelector(selector).appendChild(img);
  }, parentSelector);
}

test('an #injected planted outside the Inspector containers is not counted', async ({ page }) => {
  await openStudio(page);
  await plantInjected(page, 'body');
  await plantInjected(page, '#studio-left-sidebar');
  await plantInjected(page, '.studio-modal-overlay.hidden');
  expect(await page.locator('#injected').count()).toBe(3);
  expect(await countInjectedInInspector(page)).toBe(0);
});

test('an #injected planted inside #studio-right-sidebar is counted', async ({ page }) => {
  await openStudio(page);
  await plantInjected(page, '#studio-right-sidebar');
  expect(await countInjectedInInspector(page)).toBe(1);
});

test('an #injected planted inside an openModal overlay is counted until the overlay closes', async ({ page }) => {
  await openStudio(page);
  await page.evaluate(async () => {
    const { openModal } = await import('/js/StudioModal.js');
    window.__plantedModal = openModal({ title: 'Planted', bodyHtml: '<img id="injected">' });
  });
  const openOverlay = page.locator('.studio-modal-overlay:not(.hidden)');
  await expect(openOverlay).toHaveCount(1);
  expect(await countInjectedInInspector(page)).toBe(1);
  await openOverlay.locator('[data-modal-cancel]').click();
  await expect(openOverlay).toHaveCount(0);
  expect(await countInjectedInInspector(page)).toBe(0);
});

test('the injection count fails when #studio-right-sidebar is missing', async ({ page }) => {
  await openStudio(page);
  await page.evaluate(() => document.getElementById('studio-right-sidebar').remove());
  await expect(countInjectedInInspector(page)).rejects.toThrow('#studio-right-sidebar is missing');
});

test('the render-error collector catches a throwing state listener and a page error', async ({ page }) => {
  const errors = collectRenderErrors(page);
  await openStudio(page);
  expect(errors).toEqual([]);
  await page.evaluate(() => {
    const { state } = window.__studioApp;
    const unsubscribe = state.subscribe(() => {
      unsubscribe();
      throw new Error('planted listener failure');
    });
    state.notify('GENERAL');
  });
  expect(errors).toEqual([expect.stringContaining('[StudioState] Listener error')]);
  await page.evaluate(() => new Promise((resolve) => {
    setTimeout(() => { throw new Error('planted page error'); }, 0);
    setTimeout(resolve, 0);
  }));
  await expect.poll(() => errors.length).toBe(2);
  expect(errors[1]).toContain('planted page error');
});

test('the widgetDef snapshot check fails on a write made after the snapshot', async ({ page }) => {
  await openStudio(page);
  await installWriteRecorder(page);
  await snapshotWidgetDef(page);
  expect(await readWriteCheck(page)).toEqual({ widgetDefChanged: false, writes: [] });
  await page.evaluate(() => { window.__studioApp.state.widgetDef.plantedField = 'planted'; });
  expect(await readWriteCheck(page)).toEqual({ widgetDefChanged: true, writes: [] });
});

test('the write recorder names a recorded writer called outside seeding', async ({ page }) => {
  await openStudio(page);
  await installWriteRecorder(page);
  await snapshotWidgetDef(page);
  await page.evaluate(() => window.__studioApp.state.updateWidgetMeta({ name: 'Planted name' }));
  const check = await readWriteCheck(page);
  expect(check.widgetDefChanged).toBe(true);
  expect(check.writes.map((write) => write.method)).toContain('updateWidgetMeta');
});

test('seeding skips its own calls but logs a listener write during its notify and a queued microtask write', async ({ page }) => {
  await openStudio(page);
  await installWriteRecorder(page);
  await runSeeding(page, () => {
    const { state } = window.__studioApp;
    const unsubscribe = state.subscribe(() => {
      unsubscribe();
      state.saveHistory('planted listener write');
    });
    state.setWidgetDef({ id: 'com.flightdeck.harness' }, true, 'seed');
    state.addStateVar({ name: 'seeded', type: 'boolean', defaultValue: false });
    queueMicrotask(() => state.updateWidgetMeta({ name: 'planted microtask write' }));
  });
  await snapshotWidgetDef(page);
  const check = await readWriteCheck(page);
  expect(check.writes.map((write) => write.method)).toEqual(['saveHistory', 'updateWidgetMeta', 'saveHistory']);
  expect(check.widgetDefChanged).toBe(false);
});
