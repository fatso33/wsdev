import { test, expect } from '@playwright/test';

// 10: Compound input grouping — a curated (not automatic-heuristic) list of
// related numeric field groups render as one compact multi-column row with
// short inline prefix labels, instead of each field stacking as its own
// full-width row. See CURATED_COMPOUND_GROUPS in StudioInspector.js for the
// reviewed list and the rationale for its third ("minmax") entry, which
// stands in for the ticket's own "RGBA channels"/"margin-padding" examples
// — neither exists as a real field anywhere in PropertyRegistry.js today.
//
// Note: the ticket's own seed test snippet targeted
// `style-field-style.offset.x` — same stale-testid mismatch already found
// and corrected in ticket 09's own spec file (inspector-numeric-input.spec.js):
// buildFieldWrap() strips the leading `style.` prefix, so the real testid is
// `style-field-offset.x`. Using the correct one here.

test.describe('compound input grouping', () => {
  test('offset X/Y fields render as a single compound row, not two stacked rows', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const state = window.__studioApp.state;
      state.widgetDef.components.push({ id: 'seed-btn', type: 'core.button', style: {}, props: { label: 'Seed' } });
      state.selectComponent('seed-btn');
    });

    // style.offset.x/y are 'advanced'-tier fields — switch to Full so they render.
    await page.locator('[data-mode="full"]').click();
    await page.getByTestId('inspector-tab-style').click();

    const row = page.getByTestId('compound-row-offset');
    await expect(row).toBeVisible();
    await expect(row.getByTestId('style-field-offset.x')).toBeVisible();
    await expect(row.getByTestId('style-field-offset.y')).toBeVisible();

    // Actually side-by-side, not stacked: same top position, different left.
    const xBox = await row.getByTestId('style-field-offset.x').boundingBox();
    const yBox = await row.getByTestId('style-field-offset.y').boundingBox();
    expect(xBox).not.toBeNull();
    expect(yBox).not.toBeNull();
    expect(Math.abs(xBox.y - yBox.y)).toBeLessThan(2);
    expect(xBox.x).not.toBe(yBox.x);
  });

  test('offset compound row inputs use inline short prefix labels, not the full descriptive label', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const state = window.__studioApp.state;
      state.widgetDef.components.push({ id: 'seed-btn', type: 'core.button', style: {}, props: { label: 'Seed' } });
      state.selectComponent('seed-btn');
    });

    await page.locator('[data-mode="full"]').click();
    await page.getByTestId('inspector-tab-style').click();

    const xLabel = page.getByTestId('style-field-offset.x').locator('label');
    const yLabel = page.getByTestId('style-field-offset.y').locator('label');
    await expect(xLabel).toHaveText('X:');
    await expect(yLabel).toHaveText('Y:');
  });

  test('offset compound row inputs keep the numeric wheel/chevron behavior from ticket 09 unchanged', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const state = window.__studioApp.state;
      state.widgetDef.components.push({ id: 'seed-btn', type: 'core.button', style: {}, props: { label: 'Seed' } });
      state.selectComponent('seed-btn');
    });

    await page.locator('[data-mode="full"]').click();
    await page.getByTestId('inspector-tab-style').click();

    const xInput = page.getByTestId('style-field-offset.x').locator('input');
    await xInput.click();
    const before = Number(await xInput.inputValue());
    await page.mouse.wheel(0, -100); // one notch up = +1 (standard step)
    const after = Number(await xInput.inputValue());
    expect(after).toBe(before + 1);

    // Chevron gutter still present on a compound-row member.
    const chevrons = page.getByTestId('style-field-offset.x').locator('.prop-number-chevrons');
    await expect(chevrons).toHaveCount(1);
  });

  test('min/max fields (core.slider) render as a single compound row with Min:/Max: labels', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const state = window.__studioApp.state;
      state.widgetDef.components.push({ id: 'seed-slider', type: 'core.slider', style: {}, props: {} });
      state.selectComponent('seed-slider');
    });

    await page.getByTestId('inspector-tab-data').click();
    const row = page.getByTestId('compound-row-minmax');
    await expect(row).toBeVisible();

    const labels = await row.locator('label').allTextContents();
    expect(labels).toEqual(['Min:', 'Max:']);
  });

  test('Grid Position & Size Width/Height renders as a single compound row with W:/H: labels', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const state = window.__studioApp.state;
      state.widgetDef.components.push({ id: 'seed-btn', type: 'core.button', style: {}, props: { label: 'Seed' } });
      state.selectComponent('seed-btn');
    });

    await page.locator('[data-mode="build"]').click(); // Grid Position & Size is a Build+ field
    await page.getByTestId('inspector-tab-general').click();

    const row = page.getByTestId('compound-row-size');
    await expect(row).toBeVisible();
    const labels = await row.locator('label').allTextContents();
    expect(labels).toEqual(['W:', 'H:']);

    // Still wired to the real layout.w/h commit path.
    const wInput = row.locator('#c-layout-w');
    await wInput.fill('4');
    await wInput.blur();
    const committed = await page.evaluate(() => window.__studioApp.state.getComponent('seed-btn').layout?.w);
    expect(committed).toBe(4);
  });

  test('a field not in any curated group (border width) still renders as its own standalone row', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const state = window.__studioApp.state;
      state.widgetDef.components.push({ id: 'seed-btn', type: 'core.button', style: {}, props: { label: 'Seed' } });
      state.selectComponent('seed-btn');
    });

    await page.getByTestId('inspector-tab-style').click();
    const borderWidthField = page.getByTestId('style-field-border.width');
    await expect(borderWidthField).toBeVisible();
    // Not nested inside any compound row.
    await expect(page.locator('.prop-field-compound').locator('[data-testid="style-field-border.width"]')).toHaveCount(0);
    // Keeps its own full descriptive label (unchanged from ticket 01), not a short prefix.
    await expect(borderWidthField.locator('label')).toHaveText('Width');
  });
});
