import {
  expect,
  openStudio,
  test,
  INJECTION_PAYLOAD as P,
  INJECTION_PAYLOAD_2 as P2,
  collectRenderErrors,
} from './fixtures/inspectorHarness.js';

// Escaping tests for the left sidebar (Layers, State, Assets and Library tabs) and the widget-switch
// confirm. Each case seeds through the state API or `localStorage` and counts `#injected` across the
// whole document, with every opened modal still open and again after it closes.

/**
 * Opens Studio with the render-error collector armed. Saved widgets and Deck Event packs are written
 * to `localStorage` before the page loads, since Studio reads them once at start. `def` is loaded the
 * way a file load does, and `tab` is the left tab shown afterwards.
 */
async function openLayersCase(page, def, { tab = null, saved = null, packs = null } = {}) {
  const renderErrors = collectRenderErrors(page);
  await page.addInitScript(({ savedWidgets, deckPacks }) => {
    if (savedWidgets) localStorage.setItem('fdws_saved_widgets', JSON.stringify(savedWidgets));
    if (deckPacks) localStorage.setItem('fdws_deck_event_packs', JSON.stringify(deckPacks));
  }, { savedWidgets: saved, deckPacks: packs });
  await openStudio(page);
  await page.evaluate(({ nextDef, leftTab }) => {
    const { state } = window.__studioApp;
    if (nextDef) state.setWidgetDef(nextDef, false, 'seed');
    if (leftTab) state.setLeftTab(leftTab);
  }, { nextDef: def, leftTab: tab });
  return renderErrors;
}

/** `#injected` elements anywhere in the document, open modals included. */
async function injectedCount(page) {
  return page.locator('#injected').count();
}

/** Opens a confirm from `opener`, checks its exact text and the document, then cancels it. */
async function checkConfirm(page, opener, expectedText) {
  await opener.click();
  await expect(page.locator('.studio-modal-box')).toHaveCount(1);
  const text = page.locator('.studio-modal-box .modal-confirm-text');
  await expect(text).toHaveCount(1);
  expect(await injectedCount(page)).toBe(0);
  await expect(text).toHaveText(expectedText);
  await page.locator('[data-modal-cancel]').click();
  await expect(page.locator('.studio-modal-box')).toHaveCount(0);
  expect(await injectedCount(page)).toBe(0);
}

const BOX = { col: 1, row: 1, w: 3, h: 2 };

test('L1: layer group, component row, validation tooltip, Edit Group, Delete Group and the filter show authored values as text', async ({ page }) => {
  const renderErrors = await openLayersCase(page, {
    id: 'com.example.layers',
    layerGroups: [{ id: P, z: P }],
    components: [
      { id: P, type: P, label: P, layout: BOX, layer: { group: P, z: P } },
      // A component id containing `"` never maps to its own validation issue, since the issue's
      // component id ends at the first quote, so the tooltip case uses a plain id.
      { id: 'bound1', type: 'core.indicator', label: 'Bound', layout: { ...BOX, col: 4 }, layer: { group: P }, binding: { readSimVar: P } },
    ],
  });

  const groups = page.locator('.layer-group-card');
  await expect(groups).toHaveCount(1);
  const rows = page.locator('.tree-component-row');
  await expect(rows).toHaveCount(2);
  const boundRow = rows.filter({ has: page.locator('.comp-type-badge', { hasText: /^indicator$/ }) });
  const authoredRow = rows.filter({ hasNot: page.locator('.comp-type-badge', { hasText: /^indicator$/ }) });
  await expect(boundRow).toHaveCount(1);
  await expect(authoredRow).toHaveCount(1);
  await expect(boundRow.locator('.tree-validation-badge')).toHaveCount(1);
  await expect(page.locator('#tree-search-input')).toHaveCount(1);
  expect(await injectedCount(page)).toBe(0);

  await expect(groups.locator('.group-name')).toHaveText(P);
  await expect(groups.locator('.group-z-tag')).toHaveText(`Z: ${P}`);
  await expect(authoredRow.locator('.comp-type-badge')).toHaveText(P);
  await expect(authoredRow.locator('.comp-name')).toHaveText(P);
  await expect(authoredRow.locator('.comp-name')).toHaveAttribute('title', P);
  // The effective Z adds the component's `layer.z` to its group's `z`; strings concatenate.
  await expect(authoredRow.locator('.z-badge')).toHaveText(`Z:${P}${P}`);
  const tooltip = await boundRow.locator('.tree-validation-badge').getAttribute('title');
  expect(tooltip).toContain('Component "bound1" ');
  expect(tooltip).toContain(P);

  await page.locator('.btn-group-edit').click();
  await expect(page.locator('.studio-modal-box')).toHaveCount(1);
  await expect(page.locator('.studio-modal-box .modal-title')).toHaveCount(1);
  await expect(page.locator('#lg-z')).toHaveCount(1);
  expect(await injectedCount(page)).toBe(0);
  await expect(page.locator('.studio-modal-box .modal-title')).toHaveText(`Edit Layer Group "${P}"`);
  await expect(page.locator('#lg-z')).toHaveAttribute('value', P);
  await page.locator('[data-modal-cancel]').click();
  await expect(page.locator('.studio-modal-box')).toHaveCount(0);
  expect(await injectedCount(page)).toBe(0);

  await checkConfirm(page, page.locator('.btn-group-del'), `Delete layer group "${P}"? Components in this group will become ungrouped.`);

  await page.locator('#tree-search-input').fill(P);
  await page.evaluate(() => window.__studioApp.state.setLeftTab('layers'));
  await expect(page.locator('#tree-search-input')).toHaveCount(1);
  expect(await injectedCount(page)).toBe(0);
  await expect(page.locator('#tree-search-input')).toHaveAttribute('value', P);

  expect(renderErrors).toEqual([]);
});

test('L2: state variable card, live value, Edit and Delete show authored values as text', async ({ page }) => {
  const renderErrors = await openLayersCase(page, {
    id: 'com.example.state',
    kind: 'popover',
    state: [{ name: P, type: P, default: P, syncFrom: P, pollGroup: P, seedFromContext: P, deadband: P, pollFrequencyHz: 1 }],
  }, { tab: 'state' });
  await page.evaluate((payload) => window.__studioApp.state.setLiveStateValue(payload, payload), P);

  const card = page.locator('.state-var-card');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.state-var-name')).toHaveCount(1);
  await expect(card.locator('.state-var-current strong')).toHaveCount(1);
  await expect(card.locator('.state-var-tag.sync')).toHaveCount(1);
  expect(await injectedCount(page)).toBe(0);

  await expect(card.locator('.state-var-name')).toHaveText(P);
  await expect(card.locator('.state-var-type')).toHaveText(P);
  await expect(card.locator('.state-var-prop').first().locator('strong')).toHaveText(P);
  await expect(card.locator('.state-var-current strong')).toHaveText(P);
  await expect(card.locator('.state-var-tag.sync')).toHaveText(`Sync: ${P}`);

  await card.locator('.btn-st-edit').click();
  await expect(page.locator('.studio-modal-box')).toHaveCount(1);
  const fields = ['#sv-name', '#sv-default', '#sv-syncfrom-custom', '#sv-pollgroup', '#sv-seedfromcontext', '#sv-deadband'];
  for (const id of fields) await expect(page.locator(id)).toHaveCount(1);
  await expect(page.locator('.studio-modal-box .modal-title')).toHaveCount(1);
  expect(await injectedCount(page)).toBe(0);
  await expect(page.locator('.studio-modal-box .modal-title')).toHaveText(`Edit State Variable "${P}"`);
  for (const id of fields) await expect(page.locator(id)).toHaveAttribute('value', P);
  await page.locator('[data-modal-cancel]').click();
  await expect(page.locator('.studio-modal-box')).toHaveCount(0);
  expect(await injectedCount(page)).toBe(0);

  await checkConfirm(page, card.locator('.btn-st-del'), `Delete state variable "${P}"?`);

  expect(renderErrors).toEqual([]);
});

// Characterization: the array item builder already escaped `&` and `"`, which is enough inside an
// attribute. It must keep showing each value once-escaped, never escaped twice, and never as markup.
test('L2: array item builder fields read back authored values exactly', async ({ page }) => {
  const renderErrors = await openLayersCase(page, {
    id: 'com.example.array',
    state: [{ name: 'items', type: 'array', default: [P, { [P]: P }] }],
  }, { tab: 'state' });

  const card = page.locator('.state-var-card');
  await expect(card).toHaveCount(1);
  expect(await injectedCount(page)).toBe(0);
  await card.locator('.btn-st-edit').click();
  await expect(page.locator('.studio-modal-box')).toHaveCount(1);
  await expect(page.locator('.array-item-value')).toHaveCount(1);
  await expect(page.locator('.array-field-key')).toHaveCount(1);
  await expect(page.locator('.array-field-val')).toHaveCount(1);
  expect(await injectedCount(page)).toBe(0);
  await expect(page.locator('.array-item-value')).toHaveAttribute('value', P);
  await expect(page.locator('.array-field-key')).toHaveAttribute('value', P);
  await expect(page.locator('.array-field-val')).toHaveAttribute('value', P);
  await page.locator('[data-modal-cancel]').click();
  await expect(page.locator('.studio-modal-box')).toHaveCount(0);
  expect(await injectedCount(page)).toBe(0);

  expect(renderErrors).toEqual([]);
});

test('L3: asset card shows the id and MIME type as text and attribute values, and its Delete confirm', async ({ page }) => {
  const renderErrors = await openLayersCase(page, {
    id: 'com.example.assets',
    assets: [
      { id: P, mimeType: P, encoding: 'base64', data: 'AA==' },
      // `P` has a second `/`, so its size line never shows the markup; this MIME type's whole tail does.
      { id: 'a2', mimeType: 'image/<img id=injected>', encoding: 'base64', data: 'AA==' },
    ],
  }, { tab: 'assets' });

  const cards = page.locator('.asset-card');
  await expect(cards).toHaveCount(2);
  const card = cards.nth(0);
  await expect(card.locator('.asset-thumb-wrap')).toHaveCount(1);
  await expect(card.locator('.asset-id')).toHaveCount(1);
  await expect(card.locator('.asset-size')).toHaveCount(1);
  expect(await injectedCount(page)).toBe(0);

  await expect(card.locator('.asset-thumb-img')).toHaveCount(1);
  await expect(card.locator('.asset-thumb-img')).toHaveAttribute('src', `data:${P};base64,AA==`);
  await expect(card.locator('.asset-thumb-img')).toHaveAttribute('alt', P);
  await expect(card.locator('.asset-id')).toHaveText(P);
  await expect(card.locator('.asset-id')).toHaveAttribute('title', P);
  // The size line shows the segment after the MIME type's first `/`, upper-cased.
  const sizeKb = Math.round((4 * 3) / 4 / 1024);
  await expect(card.locator('.asset-size')).toHaveText(`${sizeKb} KB • ${P.split('/')[1].toUpperCase()}`);
  await expect(card.locator('.asset-size > *')).toHaveCount(0);
  const markupSize = cards.nth(1).locator('.asset-size');
  await expect(markupSize).toHaveCount(1);
  await expect(markupSize.locator('> *')).toHaveCount(0);
  await expect(markupSize).toHaveText(`${sizeKb} KB • <IMG ID=INJECTED>`);

  await checkConfirm(page, card.locator('.btn-del-asset'), `Delete asset "${P}"?`);

  expect(renderErrors).toEqual([]);
});

test('L4: imported pack cards and the Remove confirm show authored values as text', async ({ page }) => {
  const renderErrors = await openLayersCase(page, null, {
    tab: 'templates',
    packs: [
      { id: 'pack-a', name: P, description: P, author: 'Plain Author', events: [{ name: 'CUSTOM_A', kind: 'read' }] },
      { id: 'pack-b', name: 'Plain B', description: '', author: P, events: [{ name: 'CUSTOM_B', kind: 'write' }] },
    ],
  });

  const cards = page.locator('.template-card.user-saved');
  await expect(cards).toHaveCount(2);
  await expect(cards.locator('.template-title')).toHaveCount(2);
  await expect(cards.locator('.template-desc')).toHaveCount(2);
  expect(await injectedCount(page)).toBe(0);

  await expect(cards.nth(0).locator('.template-title')).toHaveText(P);
  await expect(cards.nth(0).locator('.template-desc')).toHaveText(P);
  await expect(cards.nth(1).locator('.template-title')).toHaveText('Plain B');
  await expect(cards.nth(1).locator('.template-desc')).toHaveText(`by ${P}`);

  await checkConfirm(
    page,
    cards.nth(0).locator('.btn-del-saved'),
    `Remove pack "${P}"? Widgets already using its suggested names are unaffected — this only removes it from the picker's suggestions.`,
  );

  expect(renderErrors).toEqual([]);
});

test('L4: a failed pack import shows the file name and the error as text', async ({ page }) => {
  const renderErrors = await openLayersCase(page, null, { tab: 'templates' });

  const input = page.locator('#pack-import-input');
  await expect(input).toHaveCount(1);
  await input.setInputFiles({
    name: `${P}.json`,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ name: 'Broken', events: [{ name: P, kind: 'bogus' }] })),
  });
  // The browser may rewrite characters of the file name, so the modal is compared with what it read.
  const fileName = await input.evaluate((el) => el.files[0].name);
  expect(fileName).toContain(`x"'&amp;`);

  await expect(page.locator('.studio-modal-box .modal-title')).toHaveText('Import Failed');
  await expect(page.locator('.studio-modal-box .modal-confirm-text')).toHaveCount(1);
  await expect(page.locator('.studio-modal-box .modal-body .modal-error')).toHaveCount(1);
  expect(await injectedCount(page)).toBe(0);
  await expect(page.locator('.studio-modal-box .modal-confirm-text')).toHaveText(`Could not import "${fileName}":`);
  await expect(page.locator('.studio-modal-box .modal-body .modal-error')).toHaveText(`Event "${P}" has invalid "kind" (must be "read" or "write").`);
  await page.locator('[data-modal-cancel]').click();
  await expect(page.locator('.studio-modal-box')).toHaveCount(0);
  expect(await injectedCount(page)).toBe(0);

  expect(renderErrors).toEqual([]);
});

test('L4: Export My Custom Names lists a custom event name as text', async ({ page }) => {
  const renderErrors = await openLayersCase(page, null, {
    tab: 'templates',
    saved: [{
      id: 'saved-exporter',
      kind: 'widget',
      meta: { name: 'Exporter' },
      components: [{
        id: 'btn1',
        type: 'core.button',
        layout: BOX,
        interactions: [{ trigger: 'tap', action: { type: 'core.dispatchEvent', event: P } }],
      }],
    }],
  });

  await expect(page.locator('#btn-export-pack')).toHaveCount(1);
  await page.locator('#btn-export-pack').click();
  await expect(page.locator('.studio-modal-box')).toHaveCount(1);
  await expect(page.locator('.studio-modal-box .modal-confirm-text')).toHaveCount(1);
  await expect(page.locator('#pk-name')).toHaveCount(1);
  expect(await injectedCount(page)).toBe(0);
  await expect(page.locator('.studio-modal-box .modal-confirm-text')).toHaveText(`Packaging 1 custom name(s) found across your saved widgets: ${P}`);
  await page.locator('[data-modal-cancel]').click();
  await expect(page.locator('.studio-modal-box')).toHaveCount(0);
  expect(await injectedCount(page)).toBe(0);

  expect(renderErrors).toEqual([]);
});

test('L5: saved widget card, Delete confirm and the widget-switch confirm show authored values as text', async ({ page }) => {
  const renderErrors = await openLayersCase(page, null, {
    tab: 'templates',
    saved: [{ id: 'saved-l5', kind: 'widget', meta: { name: P, description: P, category: P }, revision: P, components: [] }],
  });

  const card = page.locator('.template-card.user-saved');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.template-title')).toHaveCount(1);
  await expect(card.locator('.template-desc')).toHaveCount(1);
  await expect(card.locator('.tmpl-badge')).toHaveCount(2);
  expect(await injectedCount(page)).toBe(0);

  await expect(card.locator('.template-title')).toHaveText(P);
  await expect(card.locator('.template-desc')).toHaveText(P);
  await expect(card.locator('.tmpl-badge').nth(0)).toHaveText(P);
  await expect(card.locator('.tmpl-badge').nth(1)).toHaveText(`Rev ${P}`);

  await checkConfirm(page, card.locator('.btn-del-saved'), `Delete "${P}" from saved library?`);

  // A dirty current widget makes Open ask first; the confirm names both widgets.
  await page.evaluate((name) => window.__studioApp.state.updateWidgetMeta({ name }), P2);
  expect(await page.evaluate(() => window.__studioApp.state.isDirty)).toBe(true);
  await checkConfirm(page, card.locator('.btn-load-template'), `Open "${P}"? Unsaved changes to "${P2}" will be replaced.`);

  expect(renderErrors).toEqual([]);
});
