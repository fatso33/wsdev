import { test, expect } from '@playwright/test';

// Ticket 11: the multi-select Inspector now reuses the SAME General/Style/
// Data/Events tab shell as single-select, instead of a separate bespoke
// bulk-edit view.

test('multi-selecting 2+ components shows the unified tab shell with General/Data/Events disabled', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push(
      { id: 'ms-btn-1', type: 'core.button', style: {}, props: { label: 'One' } },
      { id: 'ms-btn-2', type: 'core.button', style: {}, props: { label: 'Two' } },
    );
    state.selectComponent('ms-btn-1');
    state.selectComponent('ms-btn-2', true);
  });

  // Same 4-tab shell as single-select is present...
  await expect(page.getByTestId('inspector-tab-general')).toBeVisible();
  await expect(page.getByTestId('inspector-tab-style')).toBeVisible();
  await expect(page.getByTestId('inspector-tab-data')).toBeVisible();
  await expect(page.getByTestId('inspector-tab-events')).toBeVisible();

  // ...but General/Data/Events are disabled, and Style is active by default.
  await expect(page.getByTestId('inspector-tab-general')).toBeDisabled();
  await expect(page.getByTestId('inspector-tab-data')).toBeDisabled();
  await expect(page.getByTestId('inspector-tab-events')).toBeDisabled();
  await expect(page.getByTestId('inspector-tab-style')).toBeEnabled();
  await expect(page.getByTestId('inspector-panel-style')).toBeVisible();
  await expect(page.getByTestId('inspector-panel-general')).toBeHidden();
});

test('multi-selecting two components with the same alt-state name shows a State sub-tab', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push(
      { id: 'ms-btn-a', type: 'core.button', style: {}, props: { label: 'A' } },
      { id: 'ms-btn-b', type: 'core.button', style: {}, props: { label: 'B' } },
    );
    state.selectComponent('ms-btn-a');
    state.selectComponent('ms-btn-b', true);
  });

  await expect(page.getByTestId('style-state-tab-pressed')).toBeVisible();
});

test('multi-selecting a mixed-type selection with no shared alt-state hides the State sub-tab', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push(
      { id: 'ms-mix-btn', type: 'core.button', style: {}, props: { label: 'Mix' } },
      { id: 'ms-mix-div', type: 'core.divider', style: {} },
    );
    state.selectComponent('ms-mix-btn');
    state.selectComponent('ms-mix-div', true);
  });

  await expect(page.getByTestId('inspector-panel-style')).not.toContainText('Pressed');
  await expect(page.locator('[data-testid^="style-state-tab-"]')).toHaveCount(0);
});

test('editing a common style field on a multi-selection applies to every selected component', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push(
      { id: 'ms-edit-1', type: 'core.button', style: {}, props: { label: 'One' } },
      { id: 'ms-edit-2', type: 'core.button', style: {}, props: { label: 'Two' } },
    );
    state.selectComponent('ms-edit-1');
    state.selectComponent('ms-edit-2', true);
  });

  // style.border.width is a Guided-tier field (guided:true in the registry),
  // so it's visible without first switching the UI mode to Build/Full.
  const widthField = page.locator('[data-testid="style-field-border.width"] input');
  await widthField.fill('5');
  await widthField.dispatchEvent('change');

  const result = await page.evaluate(() => {
    const state = window.__studioApp.state;
    return [
      state.getComponent('ms-edit-1').style.border?.width,
      state.getComponent('ms-edit-2').style.border?.width,
    ];
  });
  expect(result).toEqual([5, 5]);
});

// Ticket 04 + Ticket 11: a state-scoped copy (from a single component's
// Pressed sub-tab) pastes onto every component in a multi-selection's own
// Pressed sub-tab, applied consistently to all of them.
test('pasting a state-scoped copy onto a multi-selection applies it to every selected component', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push(
      { id: 'ms-paste-src', type: 'core.button', style: { states: { pressed: { border: { color: '#ff00ff' } } } }, props: { label: 'Src' } },
      { id: 'ms-paste-1', type: 'core.button', style: {}, props: { label: 'One' } },
      { id: 'ms-paste-2', type: 'core.button', style: {}, props: { label: 'Two' } },
    );
    state.selectComponent('ms-paste-src');
  });

  await page.getByTestId('inspector-tab-style').click();
  await page.getByTestId('style-state-tab-pressed').click();
  await page.getByRole('button', { name: 'Copy Style' }).click();

  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.selectComponent('ms-paste-1');
    state.selectComponent('ms-paste-2', true);
  });

  await page.getByTestId('style-state-tab-pressed').click();
  await page.getByRole('button', { name: /Paste .* Style onto All/ }).click();

  const result = await page.evaluate(() => {
    const state = window.__studioApp.state;
    return [
      state.getComponent('ms-paste-1').style.states?.pressed?.border?.color,
      state.getComponent('ms-paste-2').style.states?.pressed?.border?.color,
    ];
  });
  expect(result).toEqual(['#ff00ff', '#ff00ff']);
});
