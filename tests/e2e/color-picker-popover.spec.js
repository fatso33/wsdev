import { test, expect } from '@playwright/test';

async function selectSeedButton(page) {
  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push({
      id: 'seed-btn',
      type: 'core.button',
      style: { typography: { color: '#111111' } },
      props: { label: 'Seed' },
    });
    state.selectComponent('seed-btn');
  });
  await page.getByTestId('inspector-tab-style').click();
}

test('clicking a color swatch opens an anchored popover positioned near the field, not a full-screen modal', async ({ page }) => {
  await selectSeedButton(page);

  const swatch = page.locator('#c-typo-color-pick');
  await expect(swatch).toBeVisible();
  const swatchBox = await swatch.boundingBox();

  await swatch.click();

  const popover = page.locator('.studio-popover');
  await expect(popover).toBeVisible();
  // Not a full-screen overlay dialog.
  await expect(page.locator('.studio-modal-overlay:visible')).toHaveCount(0);

  const popBox = await popover.boundingBox();
  // Positioned near the anchor (directly below, or flipped above if there's
  // no room below) rather than centered on the screen like a full modal.
  expect(Math.abs(popBox.x - swatchBox.x)).toBeLessThan(250);
  expect(Math.abs(popBox.y - swatchBox.y)).toBeLessThan(400);
});

test('the popover offers a visual color area, hex entry, and explicit Apply/Cancel actions', async ({ page }) => {
  await selectSeedButton(page);
  await page.locator('#c-typo-color-pick').click();

  const popover = page.locator('.studio-popover');
  await expect(popover.locator('.cp-sv-area')).toBeVisible();
  await expect(popover.locator('.cp-hue-slider')).toBeVisible();
  await expect(popover.locator('.cp-hex-input')).toBeVisible();
  await expect(popover.getByRole('button', { name: 'Apply' })).toBeVisible();
  await expect(popover.getByRole('button', { name: 'Cancel' })).toBeVisible();
});

test('Cancel leaves the field value unchanged; Apply commits the picked color', async ({ page }) => {
  await selectSeedButton(page);
  const textField = page.locator('#c-typo-color');
  await expect(textField).toHaveValue('#111111');

  // Cancel path.
  await page.locator('#c-typo-color-pick').click();
  await page.locator('.studio-popover .cp-hex-input').fill('#ff00ff');
  await page.locator('.studio-popover').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.studio-popover')).toHaveCount(0);
  await expect(textField).toHaveValue('#111111');

  // Apply path.
  await page.locator('#c-typo-color-pick').click();
  await page.locator('.studio-popover .cp-hex-input').fill('#ff00ff');
  await page.locator('.studio-popover').getByRole('button', { name: 'Apply' }).click();
  await expect(page.locator('.studio-popover')).toHaveCount(0);
  await expect(textField).toHaveValue('#ff00ff');

  await page.evaluate(() => window.__studioApp.state.selectComponent('seed-btn'));
  const comp = await page.evaluate(() => window.__studioApp.state.widgetDef.components.find((c) => c.id === 'seed-btn'));
  expect(comp.style.typography.color).toBe('#ff00ff');
});

test('the field text input stays directly editable by typing a hex value, without opening the popover', async ({ page }) => {
  await selectSeedButton(page);
  const textField = page.locator('#c-typo-color');

  await textField.fill('#00ff00');
  await textField.dispatchEvent('change');
  await expect(page.locator('.studio-popover')).toHaveCount(0);

  const comp = await page.evaluate(() => window.__studioApp.state.widgetDef.components.find((c) => c.id === 'seed-btn'));
  expect(comp.style.typography.color).toBe('#00ff00');
});
