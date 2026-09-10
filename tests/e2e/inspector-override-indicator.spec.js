import { test, expect } from '@playwright/test';

test('an overridden style field shows the accent-border indicator and can be cleared via hover-x', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push({
      id: 'seed-btn',
      type: 'core.button',
      style: { typography: { color: '#111111' }, states: { pressed: { typography: { color: '#ff0000' } } } },
      props: { label: 'Seed' },
    });
    state.selectComponent('seed-btn');
  });

  await page.getByTestId('inspector-tab-style').click();
  await page.getByTestId('style-state-tab-pressed').click();

  const colorField = page.getByTestId('style-field-typography.color');
  await expect(colorField).toHaveClass(/is-overridden/);

  await colorField.getByTestId('clear-override').click();
  await expect(colorField).not.toHaveClass(/is-overridden/);
});
