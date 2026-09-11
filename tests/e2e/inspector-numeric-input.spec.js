import { test, expect } from '@playwright/test';

// 09: Numeric input redesign — native spinner removed, mousewheel stepping
// (Shift x10 / Alt x0.1), hover-reveal chevrons in a permanently-reserved
// gutter (never shifts the value), typing unchanged, and a per-field step
// lookup table living entirely in StudioInspector.js.
//
// Uses the real, confirmed registry path `style.offset.x` (a `control:'number'`
// field, Style tab) for the standard-step cases, and `props.sensitivity`
// (core.pad, Data tab) as the fractional-step (<1) lookup example.
//
// Note: the ticket's seed test targeted `getByTestId('style-field-style.offset.x')`
// — the real testid convention (confirmed against inspector-override-indicator.spec.js,
// which already exercises `style-field-typography.color`) strips the leading
// `style.` prefix, so the real testid is `style-field-offset.x`. Using the
// correct one here.

test.describe('numeric field redesign', () => {
  test('no numeric field shows the native browser spinner', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const state = window.__studioApp.state;
      state.widgetDef.components.push({ id: 'seed-btn', type: 'core.button', style: {}, props: { label: 'Seed' } });
      state.selectComponent('seed-btn');
    });

    // c-layer-z lives in the always-visible LAYOUT & LAYERING group on the
    // General tab (default tab) — no accordion expand/tab click needed.
    const layerZField = page.locator('#c-layer-z');
    await expect(layerZField).toHaveCSS('appearance', 'none');
  });

  test('mousewheel over a numeric field adjusts its value by the standard step, with Shift/Alt multipliers', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const state = window.__studioApp.state;
      state.widgetDef.components.push({ id: 'seed-btn', type: 'core.button', style: {}, props: { label: 'Seed' } });
      state.selectComponent('seed-btn');
    });

    // style.offset.x is an 'advanced'-tier field — switch to Full so it renders.
    await page.locator('[data-mode="full"]').click();
    await page.getByTestId('inspector-tab-style').click();
    const offsetXField = page.getByTestId('style-field-offset.x').locator('input');

    const before = Number(await offsetXField.inputValue());
    await offsetXField.hover();
    await page.mouse.wheel(0, -100); // scroll up = increment by standard step (1)
    let after = Number(await offsetXField.inputValue());
    expect(after).toBe(before + 1);

    // Each wheel step commits a value, which re-renders the whole Inspector
    // panel (fresh DOM, see StudioInspector.js's renderInner() header comment)
    // — re-hover before every subsequent wheel so the OS-level pointer
    // position is re-hit-tested against the freshly rendered element rather
    // than possibly landing on stale/shifted layout from the previous frame.
    await offsetXField.hover();
    await page.keyboard.down('Shift');
    await page.mouse.wheel(0, -100); // Shift = x10
    await page.keyboard.up('Shift');
    after = Number(await offsetXField.inputValue());
    expect(after).toBe(before + 1 + 10);

    await offsetXField.hover();
    await page.keyboard.down('Alt');
    await page.mouse.wheel(0, 100); // scroll down = decrement; Alt = x0.1
    await page.keyboard.up('Alt');
    after = Number(await offsetXField.inputValue());
    expect(after).toBeCloseTo(before + 1 + 10 - 0.1, 5);
  });

  test('hovering a numeric field reveals chevrons without shifting the value/input position', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const state = window.__studioApp.state;
      state.widgetDef.components.push({ id: 'seed-btn', type: 'core.button', style: {}, props: { label: 'Seed' } });
      state.selectComponent('seed-btn');
    });

    await page.locator('[data-mode="full"]').click();
    await page.getByTestId('inspector-tab-style').click();
    const wrap = page.getByTestId('style-field-offset.x');
    const input = wrap.locator('input');

    const chevrons = wrap.locator('.prop-number-chevrons');
    await input.scrollIntoViewIfNeeded(); // stabilize scroll position before either measurement
    await expect(chevrons).toHaveCSS('opacity', '0');

    const rectBefore = await input.evaluate((el) => JSON.stringify(el.getBoundingClientRect()));
    const paddingBefore = await input.evaluate((el) => getComputedStyle(el).paddingRight);

    await input.hover();
    await expect(chevrons).toHaveCSS('opacity', '1');

    const rectAfter = await input.evaluate((el) => JSON.stringify(el.getBoundingClientRect()));
    const paddingAfter = await input.evaluate((el) => getComputedStyle(el).paddingRight);

    expect(rectAfter).toBe(rectBefore);
    expect(paddingAfter).toBe(paddingBefore);
  });

  test('typing directly into a numeric field still commits the value', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const state = window.__studioApp.state;
      state.widgetDef.components.push({ id: 'seed-btn', type: 'core.button', style: {}, props: { label: 'Seed' } });
      state.selectComponent('seed-btn');
    });

    await page.locator('[data-mode="full"]').click();
    await page.getByTestId('inspector-tab-style').click();
    const offsetXField = page.getByTestId('style-field-offset.x').locator('input');

    await offsetXField.fill('42');
    await offsetXField.blur();

    const committed = await page.evaluate(() => {
      const state = window.__studioApp.state;
      return state.getComponent('seed-btn').style?.offset?.x;
    });
    expect(committed).toBe(42);
  });

  test('a fractional-range field (core.pad sensitivity) uses a step smaller than 1', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => {
      const state = window.__studioApp.state;
      state.widgetDef.components.push({ id: 'seed-pad', type: 'core.pad', style: {}, props: { sensitivity: 1 } });
      state.selectComponent('seed-pad');
    });

    await page.locator('[data-mode="full"]').click();
    await page.getByTestId('inspector-tab-data').click();
    const sensitivityField = page.locator('#rf-props-sensitivity');
    await expect(sensitivityField).toBeVisible();

    const before = Number(await sensitivityField.inputValue());
    await sensitivityField.hover();
    await page.mouse.wheel(0, -100); // one notch up
    const after = Number(await sensitivityField.inputValue());
    expect(after).toBeCloseTo(before + 0.1, 5);
  });
});
