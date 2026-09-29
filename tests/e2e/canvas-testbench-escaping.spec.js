import {
  expect,
  openStudio,
  test,
  INJECTION_PAYLOAD as P,
  collectRenderErrors,
} from './fixtures/inspectorHarness.js';

// Escaping tests for the Design canvas and the Test Bench drawer. Each case seeds through the
// state API and counts `#injected` across the whole document, not only inside the Inspector.

const QUOTED_ID = 'quote"id';

/**
 * Opens Studio with the render-error collector armed, then loads `def` the way a file load does.
 * `leftTab` is set before the load, so a case can keep the Layers tree from drawing the values it
 * seeds (D1 seeds a component `type` that the tree would show).
 */
async function openCanvasCase(page, def, { leftTab = null } = {}) {
  const renderErrors = collectRenderErrors(page);
  await openStudio(page);
  await page.evaluate(({ nextDef, tab }) => {
    const { state } = window.__studioApp;
    if (tab) state.setLeftTab(tab);
    state.setWidgetDef(nextDef, false, 'seed');
  }, { nextDef: def, tab: leftTab });
  return renderErrors;
}

/** Grid cell size in screen pixels, from the same rect the drag maths uses. */
async function cellSize(page) {
  return page.evaluate(() => {
    const { gridElement } = window.__studioApp.canvasView;
    const def = window.__studioApp.state.widgetDef;
    const rect = gridElement.getBoundingClientRect();
    return {
      w: rect.width / (def.layout?.grid?.columns || 12),
      h: rect.height / (def.layout?.grid?.rows || 6),
    };
  });
}

test('D1: image assetId, ref libraryId, unknown type and tape colors render as text and attribute values', async ({ page }) => {
  const renderErrors = await openCanvasCase(page, {
    id: 'com.example.canvas',
    components: [
      { id: 'img1', type: 'core.image', props: { assetId: P }, layout: { col: 1, row: 1, w: 3, h: 2 } },
      { id: 'ref1', type: 'core.ref', props: { libraryId: P }, layout: { col: 4, row: 1, w: 3, h: 2 } },
      { id: 'unk1', type: P, layout: { col: 7, row: 1, w: 3, h: 2 } },
      { id: 'tape1', type: 'core.tape', props: { tickColor: P, indexLineColor: P }, layout: { col: 10, row: 1, w: 3, h: 2 } },
    ],
  }, { leftTab: 'palette' });

  const nodes = page.locator('.studio-component-node');
  await expect(nodes).toHaveCount(4);
  const visual = (id) => page.locator(`.studio-component-node[data-comp-id="${id}"] .comp-visual-render`);
  await expect(visual('img1').locator('span')).toHaveCount(1);
  await expect(visual('ref1').locator('span')).toHaveCount(1);
  await expect(visual('unk1').locator('span')).toHaveCount(1);
  // Seven tick divs and one index-line div sit under the tape's wrapper div.
  await expect(visual('tape1').locator('div > div')).toHaveCount(8);
  expect(await page.locator('#injected').count()).toBe(0);

  await expect(visual('img1').locator('span')).toHaveText(`[Image: ${P}]`);
  await expect(visual('ref1').locator('span')).toHaveText(`[ref: ${P}]`);
  await expect(visual('unk1').locator('span')).toHaveText(`[${P}]`);
  const styles = await visual('tape1').locator('div > div').evaluateAll((els) => els.map((el) => el.getAttribute('style')));
  expect(styles).toHaveLength(8);
  for (const style of styles.slice(0, 7)) expect(style).toContain(`background:${P};`);
  expect(styles[7]).toContain(`background:${P};`);

  expect(renderErrors).toEqual([]);
});

test('resize: a component whose id contains a double quote resizes without an error', async ({ page }) => {
  const renderErrors = await openCanvasCase(page, {
    id: 'com.example.resize',
    components: [{ id: QUOTED_ID, type: 'core.pad', layout: { col: 2, row: 2, w: 2, h: 2 } }],
  });
  await page.evaluate((id) => window.__studioApp.state.selectComponent(id), QUOTED_ID);

  const target = page.locator('.studio-component-node');
  await expect(target).toHaveCount(1);
  const handle = target.locator('.resize-handle.handle-e');
  await expect(handle).toHaveCount(1);
  const before = await target.evaluate((el) => el.style.gridColumnEnd);
  expect(before).toBe('span 2');

  const cell = await cellSize(page);
  const box = await handle.boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + cell.w * 2 + 2, startY, { steps: 6 });
  await page.mouse.up();

  expect(renderErrors).toEqual([]);
  await expect(page.locator('.studio-component-node').first()).toHaveCSS('grid-column-end', 'span 4');
  expect(await page.evaluate(() => window.__studioApp.state.widgetDef.components[0].layout.w)).toBe(4);
});

test('move: a component whose id contains a double quote moves without an error', async ({ page }) => {
  const renderErrors = await openCanvasCase(page, {
    id: 'com.example.move',
    components: [{ id: QUOTED_ID, type: 'core.pad', layout: { col: 2, row: 2, w: 2, h: 2 } }],
  });

  const target = page.locator('.studio-component-node');
  await expect(target).toHaveCount(1);
  expect(await target.evaluate((el) => el.style.gridColumnStart)).toBe('2');

  const cell = await cellSize(page);
  const box = await target.boundingBox();
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + cell.w * 2 + 2, startY, { steps: 6 });
  await page.mouse.up();

  expect(renderErrors).toEqual([]);
  await expect(page.locator('.studio-component-node').first()).toHaveCSS('grid-column-start', '4');
  expect(await page.evaluate(() => window.__studioApp.state.widgetDef.components[0].layout.col)).toBe(4);
});

test('T1: a bound readSimVar and its telemetry value render as text in the Test Bench, closed and open', async ({ page }) => {
  const renderErrors = await openCanvasCase(page, {
    id: 'com.example.testbench',
    components: [{ id: 'ind1', type: 'core.indicator', binding: { readSimVar: P }, layout: { col: 1, row: 1, w: 3, h: 2 } }],
  });

  // The bound-variables section comes first; the global Deck Event controls follow it.
  const bound = page.locator('#studio-simbench-container .sim-bench-section').first().locator('.sim-ctrl-card');
  await expect(bound).toHaveCount(1);
  await expect(page.locator('#studio-simbench-container')).toHaveClass(/closed/);
  expect(await page.locator('#injected').count()).toBe(0);
  await expect(bound).toHaveAttribute('title', P);
  await expect(bound.locator('.sim-ctrl-label')).toHaveText(P);
  await expect(bound.locator('.sim-input-control')).toHaveAttribute('data-simvar', P);

  await page.locator('#btn-simbench').click();
  await expect(page.locator('#studio-simbench-container')).toHaveClass(/open/);
  await expect(bound).toHaveCount(1);
  expect(await page.locator('#injected').count()).toBe(0);
  await expect(bound).toHaveAttribute('title', P);
  await expect(bound.locator('.sim-ctrl-label')).toHaveText(P);
  await expect(bound.locator('.sim-input-control')).toHaveAttribute('data-simvar', P);

  await page.evaluate((payload) => window.__studioApp.state.updateSimTelemetry(payload, payload), P);
  await expect(bound).toHaveCount(1);
  expect(await page.locator('#injected').count()).toBe(0);
  await expect(bound.locator('.sim-ctrl-val')).toHaveText(P);
  await expect(bound.locator('.sim-input-control')).toHaveAttribute('value', P);
  await expect(bound.locator('.sim-input-control')).toHaveAttribute('data-simvar', P);

  expect(renderErrors).toEqual([]);
});
