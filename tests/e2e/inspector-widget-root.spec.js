import { expect, openStudio, readCalls, recordCalls, test } from './fixtures/inspectorHarness.js';

async function openStudioFull(page) {
  await page.addInitScript(() => localStorage.setItem('fdws_studio_uiMode', 'full'));
  await openStudio(page);
}

async function loadWidget(page, definition) {
  await page.evaluate((next) => window.__studioApp.state.setWidgetDef(next, false), definition);
}

async function openGroup(page, title) {
  await page.locator('.inspector-group-header').filter({ hasText: title }).click();
}

async function changeField(page, selector, value) {
  await page.evaluate(({ selector, value }) => {
    const field = document.querySelector(selector);
    field.value = value;
    field.dispatchEvent(new Event('change', { bubbles: true }));
  }, { selector, value });
}

test('metadata writes use the state API, preserve top-level identity, and grid fields keep defaults', async ({ page }) => {
  await openStudioFull(page);
  await loadWidget(page, {
    fdws: '1.27', id: 'com.example.original', revision: 3,
    meta: { name: 'Widget Root Pin', shortName: 'WRP', category: 'Avionics' },
    components: [],
  });
  await recordCalls(page, '__studioApp.state', ['updateWidgetMeta', 'updateWidgetLayout']);

  await changeField(page, '#w-meta-name', 'Changed Root Pin');
  await changeField(page, '#w-meta-short', 'CRP');
  await changeField(page, '#w-meta-category', 'Controls');
  await changeField(page, '#w-id', 'com.example.changed');
  await changeField(page, '#w-revision', '0');
  await changeField(page, '#w-author', 'Pin Author');
  await changeField(page, '#w-desc', 'Widget-root description.');

  const metadata = await page.evaluate(() => {
    const { id, revision, meta } = window.__studioApp.state.widgetDef;
    return { id, revision, meta };
  });
  expect(metadata).toMatchObject({
    id: 'com.example.changed', revision: 1,
    meta: {
      name: 'Changed Root Pin', shortName: 'CRP', category: 'Controls',
      author: 'Pin Author', description: 'Widget-root description.',
    },
  });
  const metadataCalls = (await readCalls(page, '__studioApp.state'))
    .filter(({ method }) => method === 'updateWidgetMeta')
    .map(({ args }) => args[0]);
  expect(metadataCalls).toEqual([
    { name: 'Changed Root Pin' }, { shortName: 'CRP' }, { category: 'Controls' },
    { id: 'com.example.changed' }, { revision: 1 }, { author: 'Pin Author' },
    { description: 'Widget-root description.' },
  ]);

  await openGroup(page, 'GRID & DIMENSIONS');
  await expect(page.locator('#w-grid-cols')).toHaveValue('12');
  await expect(page.locator('#w-grid-rows')).toHaveValue('6');
  await expect(page.locator('#w-def-w')).toHaveValue('8');
  await expect(page.locator('#w-def-h')).toHaveValue('4');
  await expect(page.locator('#w-min-w')).toHaveValue('4');
  await expect(page.locator('#w-min-h')).toHaveValue('2');
  await expect(page.locator('#w-max-w')).toHaveValue('44');
  await expect(page.locator('#w-max-h')).toHaveValue('44');
  await changeField(page, '#w-def-w', '0');
  expect((await readCalls(page, '__studioApp.state')).filter(({ method }) => method === 'updateWidgetLayout').at(-1).args[0])
    .toEqual({ defaultW: 8 });
});

test('canvas fields redirect theme overrides, disable structural edits, seed background types, and recognize gradients', async ({ page }) => {
  await openStudioFull(page);
  await loadWidget(page, {
    fdws: '1.27', meta: { name: 'Canvas Pin' }, baseTheme: 'dark', themeMode: 'manual',
    assets: [{ id: 'first-asset' }], components: [],
    style: {
      border: { width: 2, color: '#111111', radius: 5 },
      background: { type: 'color', color: '#222222' },
      themeOverride: { border: { color: '#dddddd' }, background: { type: 'color', color: '#eeeeee' } },
    },
  });
  await page.evaluate(() => window.__studioApp.state.setPreviewTheme('light'));
  await page.getByTestId('inspector-tab-style').click();
  await openGroup(page, 'CANVAS APPEARANCE & BORDER');

  await expect(page.locator('.theme-override-banner')).toContainText('Editing LIGHT theme override');
  await expect(page.locator('#w-border-w')).toBeDisabled();
  await expect(page.locator('#w-border-rad')).toBeDisabled();
  await expect(page.locator('#w-border-clr-txt')).toHaveValue('#dddddd');
  await expect(page.locator('#w-bg-val')).toHaveValue('#eeeeee');

  await page.locator('#w-border-clr-txt').fill('#aabbcc');
  await expect.poll(() => page.evaluate(() => window.__studioApp.state.widgetDef.style.themeOverride.border.color))
    .toBe('#aabbcc');
  await page.locator('#w-bg-type').selectOption('gradient');
  await expect.poll(() => page.evaluate(() => window.__studioApp.state.widgetDef.style.themeOverride.background))
    .toEqual({ type: 'gradient', gradient: 'linear-gradient(180deg, #141a24 0%, #0b0f17 100%)' });
  await page.locator('#w-bg-type').selectOption('image');
  await expect.poll(() => page.evaluate(() => window.__studioApp.state.widgetDef.style.themeOverride.background))
    .toEqual({ type: 'image', image: { assetId: 'first-asset' } });
  await page.locator('#w-bg-type').selectOption('color');
  await page.locator('#w-bg-val').fill('linear-gradient(90deg, #000 0%, #fff 100%)');

  await expect(page.locator('.studio-toast')).toHaveText(
    'That looks like a CSS gradient, not a color — switched Background Type to "CSS Gradient" so it stays theme-aware.',
  );
  const style = await page.evaluate(() => window.__studioApp.state.widgetDef.style);
  expect(style.border).toEqual({ width: 2, color: '#111111', radius: 5 });
  expect(style.background).toEqual({ type: 'color', color: '#222222' });
  expect(style.themeOverride.background).toEqual({ type: 'gradient', gradient: 'linear-gradient(90deg, #000 0%, #fff 100%)' });
});

test('theme base and mode choices keep their exact notifications', async ({ page }) => {
  await openStudioFull(page);
  await loadWidget(page, { fdws: '1.27', baseTheme: 'dark', themeMode: 'auto', components: [] });
  await page.getByTestId('inspector-tab-style').click();
  await openGroup(page, 'THEME');

  await page.locator('#w-theme-base').selectOption('light');
  expect(await page.evaluate(() => window.__studioApp.state.widgetDef.baseTheme)).toBe('light');
  await page.locator('#w-theme-mode').selectOption('manual');
  await expect(page.locator('.studio-toast')).toHaveText(
    "Manual mode on — every component's dark-theme colors were seeded from the current auto-derived values.",
  );
  expect(await page.evaluate(() => window.__studioApp.state.widgetDef.themeMode)).toBe('manual');
  await page.locator('#w-theme-mode').selectOption('auto');
  await expect(page.locator('.studio-toast')).toHaveText('Dark theme is auto-derived again.');
});

test('declared Deck Events validate, preserve read/write suggestion shapes, list, and delete', async ({ page }) => {
  await openStudioFull(page);
  await loadWidget(page, {
    fdws: '1.27', components: [],
    deckEvents: [{ name: 'existing.event', kind: 'read', label: 'Existing', suggest: { simvar: 'L:EXISTING', unit: 'Number' } }],
  });
  await page.getByTestId('inspector-tab-events').click();
  await openGroup(page, 'DECK EVENTS (v1.27)');
  await expect(page.locator('#de-list')).toContainText('existing.event');
  await expect(page.locator('#de-list')).toContainText('→ L:EXISTING / Number');

  await page.locator('#de-add').click();
  const modalError = page.locator('[data-modal-error]');
  await page.locator('[data-modal-submit]').click();
  await expect(modalError).toHaveText('A name is required.');
  await page.locator('#de-name').fill('L:RAW_ADDRESS');
  await page.locator('[data-modal-submit]').click();
  await expect(modalError).toHaveText('That is a raw address, not a Deck Event — raw addresses bypass profiles and need no declaration.');
  await page.locator('#de-name').fill('com1ActFreq');
  await page.locator('[data-modal-submit]').click();
  await expect(modalError).toHaveText('"com1ActFreq" is a built-in Deck Event. Namespace yours instead, e.g. "myaircraft.com1ActFreq".');
  await page.locator('#de-name').fill('existing.event');
  await page.locator('[data-modal-submit]').click();
  await expect(modalError).toHaveText('"existing.event" is already declared by this widget.');

  await page.locator('#de-name').fill('myaircraft.temperature');
  await page.locator('#de-kind').selectOption('read');
  await page.locator('#de-label').fill('Cabin Temperature');
  await page.locator('#de-category').fill('environment');
  await page.locator('#de-sug-a').fill('L:CABIN_TEMP');
  await page.locator('#de-sug-b').fill('Celsius');
  await page.locator('[data-modal-submit]').click();
  await expect(page.locator('.studio-toast')).toHaveText('Declared "myaircraft.temperature".');
  await expect(page.locator('#de-list')).toContainText('→ L:CABIN_TEMP / Celsius');

  await page.locator('#de-add').click();
  await page.locator('#de-name').fill('myaircraft.setMode');
  await page.locator('#de-kind').selectOption('write');
  await page.locator('#de-sug-a').fill('SET_MODE');
  await page.locator('#de-sug-b').fill('FIXED_1');
  await page.locator('[data-modal-submit]').click();
  await expect(page.locator('.studio-toast')).toHaveText('Declared "myaircraft.setMode".');
  await expect(page.locator('#de-list')).toContainText('⇄ SET_MODE / FIXED_1');
  expect(await page.evaluate(() => window.__studioApp.state.widgetDef.deckEvents.slice(1))).toEqual([
    {
      name: 'myaircraft.temperature', kind: 'read', label: 'Cabin Temperature', category: 'environment',
      suggest: { simvar: 'L:CABIN_TEMP', unit: 'Celsius' },
    },
    {
      name: 'myaircraft.setMode', kind: 'write', label: 'myaircraft.setMode', category: 'custom',
      suggest: { event: 'SET_MODE', valueFormat: 'FIXED_1' },
    },
  ]);

  await page.locator('#de-list [data-de-del="0"]').click();
  expect(await page.evaluate(() => window.__studioApp.state.widgetDef.deckEvents.map(({ name }) => name)))
    .toEqual(['myaircraft.temperature', 'myaircraft.setMode']);
});

test('capability sync recalculates the matrix, notifies the app, and shows its toast', async ({ page }) => {
  await openStudioFull(page);
  await loadWidget(page, {
    fdws: '1.27', components: [{ id: 'capability-source', type: 'core.button', binding: { readSimVar: 'L:OAT', writeEvent: 'CUSTOM_TOGGLE' } }],
  });
  await page.evaluate(() => {
    window.__studioApp.state.widgetDef.capabilities = { readSimVars: ['STALE'], writeEvents: [] };
    window.__studioApp.inspector.render();
  });
  await recordCalls(page, '__studioApp.state', ['notify']);
  await page.getByTestId('inspector-tab-events').click();
  await openGroup(page, 'CAPABILITIES MATRIX (§11)');
  await expect(page.locator('.caps-summary-box')).toContainText('STALE');
  await page.locator('#btn-sync-caps').click();

  expect(await page.evaluate(() => window.__studioApp.state.widgetDef.capabilities)).toEqual({
    readSimVars: ['L:OAT'], writeEvents: ['CUSTOM_TOGGLE'],
  });
  expect((await readCalls(page, '__studioApp.state')).filter(({ method, args }) => method === 'notify' && args[0] === 'WIDGET_META_UPDATED'))
    .toHaveLength(1);
  await expect(page.locator('.studio-toast')).toHaveText('Capabilities synchronized with components.');
});

test('unrecognised top-level definition data remains visible and uses the raw-field writer', async ({ page }) => {
  await openStudio(page);
  await loadWidget(page, { fdws: '1.27', components: [], customFutureFlag: 'preserved' });
  await recordCalls(page, '__studioApp.state', ['updateWidgetRawField']);

  await expect(page.locator('.unrec-props-header')).toBeVisible();
  await expect(page.locator('.unrec-props-path')).toContainText('customFutureFlag');
  await page.locator('#wroot-unrec-0-toggle').click();
  await page.locator('#wroot-unrec-0-input').fill('updated');
  await page.locator('#wroot-unrec-0-save').click();

  expect(await page.evaluate(() => window.__studioApp.state.widgetDef.customFutureFlag)).toBe('updated');
  expect((await readCalls(page, '__studioApp.state')).filter(({ method }) => method === 'updateWidgetRawField').at(-1).args[0])
    .toBe('customFutureFlag');
  expect((await readCalls(page, '__studioApp.state')).filter(({ method }) => method === 'updateWidgetRawField').at(-1).args[1])
    .toBe('updated');
});

test('Full JSON appears only at Full and validates before the whole-definition state write', async ({ page }) => {
  await openStudio(page);
  await expect(page.locator('#btn-full-json')).toHaveCount(0);
  await page.locator('.mode-toggle-btn[data-mode="full"]').click();
  await expect(page.locator('#btn-full-json')).toBeVisible();
  await recordCalls(page, '__studioApp.state', ['setWidgetDef']);
  await page.locator('#btn-full-json').click();

  const json = page.locator('#full-json-textarea');
  const error = page.locator('[data-modal-error]');
  await json.fill('{');
  await page.locator('[data-modal-submit]').click();
  await expect(error).toContainText('Invalid JSON:');
  await json.fill('[]');
  await page.locator('[data-modal-submit]').click();
  await expect(error).toHaveText('Must be a JSON object (a widget definition), not an array or a bare value.');

  const applied = { fdws: '1.27', id: 'com.example.applied', meta: { name: 'Full JSON Applied' }, components: [] };
  await json.fill(JSON.stringify(applied, null, 2));
  await page.locator('[data-modal-submit]').click();
  expect((await readCalls(page, '__studioApp.state')).filter(({ method }) => method === 'setWidgetDef').at(-1).args)
    .toEqual([applied, true, 'Apply Full JSON']);
  expect(await page.evaluate(() => window.__studioApp.state.widgetDef.meta.name)).toBe('Full JSON Applied');
  await expect(page.locator('.studio-toast')).toHaveText('Applied — Undo (Ctrl+Z) to revert if something looks wrong.');
});
