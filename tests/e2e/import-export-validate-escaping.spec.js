import {
  expect,
  openStudio,
  test,
  INJECTION_PAYLOAD as P,
  collectRenderErrors,
} from './fixtures/inspectorHarness.js';

// Escaping tests for the Import, Export and Save modals and the Validate report. Each case seeds
// through the state API, `localStorage` or a file import, and counts `#injected` across the whole
// document, with every opened modal still open and again after it closes.

const BOX = { col: 1, row: 1, w: 3, h: 2 };

/** `#injected` elements anywhere in the document, open modals and hidden overlays included. */
async function injectedCount(page) {
  return page.locator('#injected').count();
}

/**
 * Opens Studio with the render-error collector armed. Saved widgets are written to `localStorage`
 * before the page loads, since Studio reads them once at start. `def`, when given, is loaded through
 * `state.setWidgetDef` without a history entry.
 */
async function openMenuCase(page, def, { saved = null } = {}) {
  const renderErrors = collectRenderErrors(page);
  await page.addInitScript((savedWidgets) => {
    if (savedWidgets) localStorage.setItem('fdws_saved_widgets', JSON.stringify(savedWidgets));
  }, saved);
  await openStudio(page);
  if (def) {
    await page.evaluate((nextDef) => window.__studioApp.state.setWidgetDef(nextDef, false, 'seed'), def);
  }
  return renderErrors;
}

/** Drives Import through the menu bar's file input and returns the file name the browser reports. */
async function importFile(page, file) {
  const input = page.locator('#menu-import-input');
  await expect(input).toHaveCount(1);
  await input.setInputFiles(file);
  // The browser may rewrite characters of the file name, so a modal is compared with what it read.
  return input.evaluate((el) => el.files[0].name);
}

test('M1: the import recovery modal shows the file name and each validation error as text', async ({ page }) => {
  const renderErrors = await openMenuCase(page, null);

  const def = {
    fdws: '1.27',
    id: 'com.example.recovery',
    components: [{ id: 'ind1', type: 'core.indicator', layout: BOX, binding: { readSimVar: P } }],
  };
  const fileName = await importFile(page, {
    name: `${P}.json`,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(def)),
  });
  expect(fileName).toContain(`x"'&amp;`);

  await expect(page.locator('.studio-modal-box .modal-title')).toHaveText('Import Has Validation Errors');
  // The list shows the first eight errors, one item each, so the expected items come from the validator.
  const expectedErrors = await page.evaluate(async (nextDef) => {
    const { StudioValidator } = await import('/js/StudioValidator.js');
    return StudioValidator.validate(nextDef).errors.slice(0, 8);
  }, def);
  expect(expectedErrors.length).toBeGreaterThan(0);
  expect(expectedErrors.some((message) => message.includes(P))).toBe(true);
  const items = page.locator('.studio-modal-box .val-list.errors li');
  await expect(items).toHaveCount(expectedErrors.length);
  await expect(page.locator('.studio-modal-box .modal-confirm-text')).toHaveCount(2);
  expect(await injectedCount(page)).toBe(0);

  await expect(page.locator('.studio-modal-box .modal-confirm-text').first())
    .toHaveText(`"${fileName}" has ${expectedErrors.length} FDWS validation error(s):`);
  expect(await items.allTextContents()).toEqual(expectedErrors);

  await page.locator('[data-modal-cancel]').click();
  await expect(page.locator('.studio-modal-box')).toHaveCount(0);
  expect(await injectedCount(page)).toBe(0);

  expect(renderErrors).toEqual([]);
});

test('M2: the import parse-failure modal shows the file name as text', async ({ page }) => {
  const renderErrors = await openMenuCase(page, null);

  const fileName = await importFile(page, {
    name: P,
    mimeType: 'application/json',
    buffer: Buffer.from(P),
  });
  expect(fileName).toContain(`x"'&amp;`);

  await expect(page.locator('.studio-modal-box .modal-title')).toHaveText('Import Failed');
  await expect(page.locator('.studio-modal-box .modal-confirm-text')).toHaveCount(1);
  expect(await injectedCount(page)).toBe(0);

  await expect(page.locator('.studio-modal-box .modal-body .modal-error')).toHaveCount(1);
  await expect(page.locator('.studio-modal-box .modal-confirm-text')).toHaveText(`Could not parse "${fileName}" as JSON:`);
  // The parser quotes the first ten characters of the file's content in its message.
  expect(await page.locator('.studio-modal-box .modal-body .modal-error').textContent()).toContain(`x"'&amp;</`);
  await page.locator('[data-modal-cancel]').click();
  await expect(page.locator('.studio-modal-box')).toHaveCount(0);
  expect(await injectedCount(page)).toBe(0);

  expect(renderErrors).toEqual([]);
});

test('M3: the export popover warning lists a missing popover id as text', async ({ page }) => {
  const renderErrors = await openMenuCase(page, {
    id: 'com.example.export',
    components: [{
      id: 'btn1',
      type: 'core.button',
      layout: BOX,
      interactions: [{ trigger: 'tap', action: { type: 'core.openWidgetPopover', popoverWidgetId: P } }],
    }],
  });

  await expect(page.locator('#btn-export-dropdown')).toHaveCount(1);
  await page.locator('#btn-export-dropdown').click();
  await expect(page.locator('#btn-export-json')).toBeVisible();
  await page.locator('#btn-export-json').click();

  await expect(page.locator('.studio-modal-box .modal-title')).toHaveText('This Widget Opens Popovers');
  const items = page.locator('.studio-modal-box .val-list.errors li');
  await expect(items).toHaveCount(1);
  expect(await injectedCount(page)).toBe(0);

  await expect(items).toHaveText(`${P} — NOT FOUND. Save it first, or this widget will fail to open it anywhere it's installed.`);
  await page.locator('[data-modal-cancel]').click();
  await expect(page.locator('.studio-modal-box')).toHaveCount(0);
  expect(await injectedCount(page)).toBe(0);

  expect(renderErrors).toEqual([]);
});

test('M4: the Validate report shows the errors, the SimVar summary and the item id as text', async ({ page }) => {
  const def = {
    fdws: '1.27',
    id: 'com.example.validate',
    meta: { name: 'Validate Widget' },
    components: [{ id: 'ind1', type: 'core.indicator', layout: BOX, binding: { readSimVar: P } }],
  };
  const renderErrors = await openMenuCase(page, def);

  await expect(page.locator('#btn-validate')).toHaveCount(1);
  await page.locator('#btn-validate').click();

  // The report lists every error and warning, so the expected items come from the validator.
  const expected = await page.evaluate(async () => {
    const { StudioValidator } = await import('/js/StudioValidator.js');
    const result = StudioValidator.validate(window.__studioApp.state.widgetDef);
    return { errors: result.errors, warnings: result.warnings };
  });
  const readSimVarError = expected.errors.findIndex((message) => message.includes(P));
  expect(readSimVarError).toBeGreaterThanOrEqual(0);

  const overlay = page.locator('.studio-modal-overlay:not(.hidden)');
  await expect(overlay).toHaveCount(1);
  const errors = overlay.locator('.val-list.errors li');
  const warnings = overlay.locator('.val-list.warnings li');
  await expect(errors).toHaveCount(expected.errors.length);
  await expect(warnings).toHaveCount(expected.warnings.length);
  const summary = overlay.locator('.val-caps-summary > div');
  await expect(summary).toHaveCount(2);
  expect(await injectedCount(page)).toBe(0);

  expect(await errors.allTextContents()).toEqual(expected.errors);
  expect(await warnings.allTextContents()).toEqual(expected.warnings);
  const item = errors.nth(readSimVarError);
  await expect(item).toHaveClass('val-list-item');
  expect(await item.getAttribute('data-comp-id')).toBe('ind1');
  await expect(summary.first()).toHaveText(`Read SimVars: ${P}`);
  await expect(summary.nth(1)).toHaveText('Write Events: None');

  // Clicking an item reads its `data-comp-id` back, selects the component and closes the report.
  await item.click();
  await expect(page.locator('.studio-modal-overlay:not(.hidden)')).toHaveCount(0);
  expect(await page.evaluate(() => window.__studioApp.state.selectedComponentId)).toBe('ind1');
  // The overlay is only hidden, never emptied, so its markup is still in the document.
  expect(await injectedCount(page)).toBe(0);

  expect(renderErrors).toEqual([]);
});

test('Save: the ID-collision modal shows the saved widget name and revision as text', async ({ page }) => {
  const renderErrors = await openMenuCase(page, {
    id: 'com.example.collide',
    meta: { name: 'Current' },
    components: [],
  }, {
    saved: [{
      id: 'com.example.collide',
      kind: 'widget',
      revision: P,
      meta: { name: P },
      components: [],
      __editorInstanceId: 'another-editor',
    }],
  });

  await expect(page.locator('#btn-save-widget')).toHaveCount(1);
  await page.locator('#btn-save-widget').click();

  await expect(page.locator('.studio-modal-box .modal-title')).toHaveText('Save — ID Already In Use');
  await expect(page.locator('.studio-modal-box .modal-confirm-text')).toHaveCount(2);
  expect(await injectedCount(page)).toBe(0);

  const text = page.locator('.studio-modal-box .modal-confirm-text');
  await expect(text.nth(0)).toHaveText(`A saved widget titled "${P}" (Rev ${P}) already uses id "com.example.collide". The widget you're saving now is titled "Current" — this is a different widget, not a re-save of that one.`);
  await expect(text.nth(1)).toHaveText(`Overwriting will permanently replace "${P}" in your local library.`);
  await page.locator('[data-modal-cancel]').click();
  await expect(page.locator('.studio-modal-box')).toHaveCount(0);
  expect(await injectedCount(page)).toBe(0);

  expect(renderErrors).toEqual([]);
});
