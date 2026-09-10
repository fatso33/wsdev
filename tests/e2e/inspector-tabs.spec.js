import { test, expect } from '@playwright/test';

test('selecting a component shows exclusive General/Style/Data/Events tabs', async ({ page }) => {
  await page.goto('/');
  // window.__studioApp is the existing debug/test global this project already
  // uses for scripted repros against real state (see project memory on the
  // Border Glow / core.button fixes) — adjust if it's been renamed.
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push({ id: 'seed-btn', type: 'core.button', style: {}, props: { label: 'Seed' } });
    state.selectComponent('seed-btn');
  });

  await expect(page.getByTestId('inspector-tab-general')).toBeVisible();
  await expect(page.getByTestId('inspector-tab-style')).toBeVisible();
  await expect(page.getByTestId('inspector-tab-data')).toBeVisible();
  await expect(page.getByTestId('inspector-tab-events')).toBeVisible();

  await page.getByTestId('inspector-tab-style').click();
  await expect(page.getByTestId('inspector-panel-style')).toBeVisible();
  await expect(page.getByTestId('inspector-panel-general')).toBeHidden();
});

test('widget-root selection shows an empty Data tab', async ({ page }) => {
  await page.goto('/');
  // A fresh Studio session with nothing added/selected is already in the
  // widget-root context — no setup needed beyond navigating to the app.
  await page.getByTestId('inspector-tab-data').click();
  await expect(page.getByTestId('inspector-panel-data')).toContainText('No properties available');
});
