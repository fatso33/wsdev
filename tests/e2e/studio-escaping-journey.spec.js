import {
  expect,
  openStudio,
  test,
  INJECTION_PAYLOAD as P,
  collectRenderErrors,
  countInjectedInInspector,
} from './fixtures/inspectorHarness.js';

// The Studio escaping feature's user journey. An Author imports a widget file whose authored names
// and ids are the injection payload, then walks every surface that shows them outside the Inspector.
// Each step counts `#injected` across the whole document through the widened harness helper.

const BOX = { col: 1, row: 1, w: 3, h: 2 };

/** Opens a left-sidebar tab the way the Author does, by its tab button. */
async function openLeftTab(page, tab) {
  const button = page.locator(`#studio-left-sidebar .tab-btn[data-tab="${tab}"]`);
  await expect(button).toHaveCount(1);
  await button.click();
  await expect(button).toHaveClass(/active/);
}

test('journey: an imported widget with authored markup shows it as text on every Studio surface', async ({ page }) => {
  const renderErrors = collectRenderErrors(page);
  await openStudio(page);

  const journeyDef = {
    fdws: '1.27',
    id: 'com.example.escaping-journey',
    meta: { name: 'Journey Widget', description: P },
    layerGroups: [{ id: P, z: 1 }],
    state: [{ name: P, type: 'string', default: P }],
    assets: [{ id: P, mimeType: 'image/png', encoding: 'base64', data: 'AA==' }],
    components: [
      { id: 'authored', type: P, label: P, layout: BOX, layer: { group: P } },
      // A component id containing `"` never maps to its own validation issue (ISS-018), so the
      // readSimVar sits on a component with a plain id.
      { id: 'bound1', type: 'core.indicator', label: 'Bound', layout: { ...BOX, col: 4 }, layer: { group: P }, binding: { readSimVar: P } },
      {
        id: 'opener',
        type: 'core.button',
        label: 'Open',
        layout: { ...BOX, col: 7 },
        layer: { group: P },
        interactions: [{ trigger: 'tap', action: { type: 'core.openWidgetPopover', popoverWidgetId: P } }],
      },
    ],
  };

  // Import: the recovery modal lists the validation errors, which quote the payload.
  const importInput = page.locator('#menu-import-input');
  await expect(importInput).toHaveCount(1);
  await importInput.setInputFiles({
    name: `${P}.json`,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(journeyDef)),
  });
  // The browser may rewrite characters of the file name, so the modal is compared with what it read.
  const fileName = await importInput.evaluate((el) => el.files[0].name);
  expect(fileName).toContain(`x"'&amp;`);

  await expect(page.locator('.studio-modal-box .modal-title')).toHaveText('Import Has Validation Errors');
  const expectedImportErrors = await page.evaluate(async (def) => {
    const { StudioValidator } = await import('/js/StudioValidator.js');
    return StudioValidator.validate(def).errors;
  }, journeyDef);
  expect(expectedImportErrors.slice(0, 8).some((message) => message.includes(P))).toBe(true);
  const importItems = page.locator('.studio-modal-box .val-list.errors li');
  await expect(importItems).toHaveCount(Math.min(expectedImportErrors.length, 8));
  await expect(page.locator('.studio-modal-box .modal-confirm-text')).toHaveCount(2);
  expect(await countInjectedInInspector(page)).toBe(0);
  await expect(page.locator('.studio-modal-box .modal-confirm-text').first())
    .toHaveText(`"${fileName}" has ${expectedImportErrors.length} FDWS validation error(s):`);
  expect(await importItems.allTextContents()).toEqual(expectedImportErrors.slice(0, 8));

  await page.locator('[data-modal-submit]').click();
  await expect(page.locator('.studio-modal-box')).toHaveCount(0);
  await expect(page.locator('.studio-toast')).toHaveText('Imported "Journey Widget" successfully!');
  expect(await countInjectedInInspector(page)).toBe(0);

  // Components tab and the Design canvas.
  await openLeftTab(page, 'layers');
  const group = page.locator('.layer-group-card');
  await expect(group).toHaveCount(1);
  const rows = page.locator('.tree-component-row');
  await expect(rows).toHaveCount(3);
  const authoredRow = rows.filter({ has: page.locator('.comp-type-badge', { hasText: P }) });
  await expect(authoredRow).toHaveCount(1);
  const boundBadge = rows.filter({ has: page.locator('.comp-type-badge', { hasText: /^indicator$/ }) }).locator('.tree-validation-badge');
  await expect(boundBadge).toHaveCount(1);
  const unknownVisual = page.locator('.studio-component-node[data-comp-id="authored"] .comp-visual-render span');
  await expect(unknownVisual).toHaveCount(1);
  expect(await countInjectedInInspector(page)).toBe(0);
  await expect(group.locator('.group-name')).toHaveText(P);
  await expect(authoredRow.locator('.comp-type-badge')).toHaveText(P);
  await expect(authoredRow.locator('.comp-name')).toHaveText(P);
  expect(await boundBadge.getAttribute('title')).toContain(P);
  await expect(unknownVisual).toHaveText(`[${P}]`);

  // State tab.
  await openLeftTab(page, 'state');
  const stateCard = page.locator('.state-var-card');
  await expect(stateCard).toHaveCount(1);
  await expect(stateCard.locator('.state-var-name')).toHaveCount(1);
  expect(await countInjectedInInspector(page)).toBe(0);
  await expect(stateCard.locator('.state-var-name')).toHaveText(P);
  await expect(stateCard.locator('.state-var-prop').first().locator('strong')).toHaveText(P);

  // Assets tab.
  await openLeftTab(page, 'assets');
  const assetCard = page.locator('.asset-card');
  await expect(assetCard).toHaveCount(1);
  await expect(assetCard.locator('.asset-id')).toHaveCount(1);
  await expect(assetCard.locator('.asset-thumb-img')).toHaveCount(1);
  expect(await countInjectedInInspector(page)).toBe(0);
  await expect(assetCard.locator('.asset-id')).toHaveText(P);
  await expect(assetCard.locator('.asset-thumb-img')).toHaveAttribute('alt', P);

  // Library tab, after saving the widget so it has a card there.
  await expect(page.locator('#btn-save-widget')).toHaveCount(1);
  await page.locator('#btn-save-widget').click();
  await expect(page.locator('.studio-toast').last()).toContainText('to local library!');
  await openLeftTab(page, 'templates');
  const savedCard = page.locator('.template-card.user-saved');
  await expect(savedCard).toHaveCount(1);
  await expect(savedCard.locator('.template-desc')).toHaveCount(1);
  expect(await countInjectedInInspector(page)).toBe(0);
  await expect(savedCard.locator('.template-title')).toHaveText('Journey Widget');
  await expect(savedCard.locator('.template-desc')).toHaveText(P);

  // Test Bench.
  await page.locator('#btn-simbench').click();
  await expect(page.locator('#studio-simbench-container')).toHaveClass(/open/);
  const benchCard = page.locator('#studio-simbench-container .sim-bench-section').first().locator('.sim-ctrl-card');
  await expect(benchCard).toHaveCount(1);
  expect(await countInjectedInInspector(page)).toBe(0);
  await expect(benchCard).toHaveAttribute('title', P);
  await expect(benchCard.locator('.sim-ctrl-label')).toHaveText(P);
  await expect(benchCard.locator('.sim-input-control')).toHaveAttribute('data-simvar', P);

  // Validate.
  await page.locator('#btn-validate').click();
  const expectedReport = await page.evaluate(async () => {
    const { StudioValidator } = await import('/js/StudioValidator.js');
    const result = StudioValidator.validate(window.__studioApp.state.widgetDef);
    return { errors: result.errors, warnings: result.warnings };
  });
  expect(expectedReport.errors.some((message) => message.includes(P))).toBe(true);
  const report = page.locator('.studio-modal-overlay:not(.hidden)');
  await expect(report).toHaveCount(1);
  await expect(report.locator('.val-list.errors li')).toHaveCount(expectedReport.errors.length);
  await expect(report.locator('.val-list.warnings li')).toHaveCount(expectedReport.warnings.length);
  await expect(report.locator('.val-caps-summary > div')).toHaveCount(2);
  expect(await countInjectedInInspector(page)).toBe(0);
  expect(await report.locator('.val-list.errors li').allTextContents()).toEqual(expectedReport.errors);
  expect(await report.locator('.val-list.warnings li').allTextContents()).toEqual(expectedReport.warnings);
  await expect(report.locator('.val-caps-summary > div').first()).toHaveText(`Read SimVars: ${P}`);
  await report.locator('#btn-close-val-modal').click();
  await expect(page.locator('.studio-modal-overlay:not(.hidden)')).toHaveCount(0);
  // The report's overlay is only hidden, so its markup is still counted.
  expect(await countInjectedInInspector(page)).toBe(0);

  // Export: the popover id is not in the library, so the export warns and lists it. The hidden
  // Validate overlay keeps its own modal box, so the export modal is found as the open overlay.
  await page.locator('#btn-export-dropdown').click();
  await expect(page.locator('#btn-export-json')).toBeVisible();
  await page.locator('#btn-export-json').click();
  const exportModal = page.locator('.studio-modal-overlay:not(.hidden) .studio-modal-box');
  await expect(exportModal.locator('.modal-title')).toHaveText('This Widget Opens Popovers');
  const missing = exportModal.locator('.val-list.errors li');
  await expect(missing).toHaveCount(1);
  expect(await countInjectedInInspector(page)).toBe(0);
  await expect(missing).toHaveText(`${P} — NOT FOUND. Save it first, or this widget will fail to open it anywhere it's installed.`);
  await exportModal.locator('[data-modal-cancel]').click();
  await expect(exportModal).toHaveCount(0);
  expect(await countInjectedInInspector(page)).toBe(0);

  expect(renderErrors).toEqual([]);
});
