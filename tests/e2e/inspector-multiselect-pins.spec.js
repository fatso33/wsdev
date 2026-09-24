import { expect, openStudio, seedComponents, selectComponents, test } from './fixtures/inspectorHarness.js';

test('the multi-select proxy merges common nested values and keeps its synthetic identity', async ({ page }) => {
  await openStudio(page);
  await seedComponents(page, [
    {
      id: 'proxy-a',
      type: 'core.button',
      style: {
        typography: { color: '#123456', align: { h: 'left', v: 'top' } },
        border: { width: 2 },
        states: { pressed: { border: { color: '#ff0000' } } },
      },
      props: { label: 'A' },
    },
    {
      id: 'proxy-b',
      type: 'core.button',
      style: {
        typography: { color: '#123456', align: { h: 'right', v: 'top' } },
        border: { width: 4 },
        states: { pressed: { border: { color: '#ff0000' } } },
      },
      props: { label: 'B' },
    },
  ]);
  await selectComponents(page, ['proxy-a', 'proxy-b']);

  const proxy = await page.evaluate(() => {
    const inspector = window.__studioApp.inspector;
    const comps = ['proxy-a', 'proxy-b'].map((id) => inspector.state.getComponent(id));
    return inspector.buildMultiSelectStyleProxy(comps);
  });

  expect(proxy.id).toBe('__multiselect__');
  expect(proxy.label).toBe('2 components');
  expect(proxy.__multiSelect).toBe(true);
  expect(proxy.type).toBe('core.button');
  expect(proxy.style).toEqual({
    typography: { color: '#123456', align: { v: 'top' } },
    border: {},
    states: { pressed: { border: { color: '#ff0000' } } },
  });
});

test('the multi-select header shows the exact count and selected component IDs', async ({ page }) => {
  await openStudio(page);
  await seedComponents(page, [
    { id: 'header-a', type: 'core.button', style: {}, props: { label: 'A' } },
    { id: 'header-b', type: 'core.button', style: {}, props: { label: 'B' } },
  ]);
  await selectComponents(page, ['header-a', 'header-b']);

  await expect(page.locator('.inspector-header .inspector-badge')).toHaveText('2 SELECTED');
  await expect(page.locator('.inspector-header .inspector-title')).toHaveText('Multiple Components');
  await expect(page.locator('.inspector-header .inspector-sub')).toHaveText('header-a, header-b');
});

test('a different multi-selection starts on Normal after State was selected', async ({ page }) => {
  await openStudio(page);
  await seedComponents(page, [
    { id: 'reset-a', type: 'core.button', style: {}, props: { label: 'A' } },
    { id: 'reset-b', type: 'core.button', style: {}, props: { label: 'B' } },
    { id: 'reset-c', type: 'core.button', style: {}, props: { label: 'C' } },
  ]);
  await selectComponents(page, ['reset-a', 'reset-b']);

  await page.locator('#ms-styletab-state').click();
  await expect(page.locator('#ms-styletab-state')).toHaveClass(/active/);
  await selectComponents(page, ['reset-b', 'reset-c']);

  await expect(page.locator('#ms-styletab-normal')).toHaveClass(/active/);
  await expect(page.locator('#ms-styletab-state')).not.toHaveClass(/active/);
});

test('the State sub-tab appears only when every selected component shares its state name', async ({ page }) => {
  await openStudio(page);
  await seedComponents(page, [
    { id: 'state-a', type: 'core.button', style: {}, props: { label: 'A' } },
    { id: 'state-b', type: 'core.button', style: {}, props: { label: 'B' } },
    { id: 'state-divider', type: 'core.divider', style: {}, props: {} },
  ]);
  await selectComponents(page, ['state-a', 'state-b']);
  await expect(page.getByTestId('style-state-tab-pressed')).toBeVisible();

  await selectComponents(page, ['state-a', 'state-divider']);
  await expect(page.locator('[data-testid^="style-state-tab-"]')).toHaveCount(0);
});

test('paste labels and disabled states follow empty, base, state-scoped and rule-scoped clipboards', async ({ page }) => {
  await openStudio(page);
  await seedComponents(page, [
    {
      id: 'clipboard-source',
      type: 'core.button',
      style: {
        typography: { color: '#abcdef' },
        states: { pressed: { border: { color: '#123456' } } },
        rules: [{ when: { state: 'fuel', lt: 10 }, style: { typography: { color: '#ff0000' } } }],
      },
      props: { label: 'Source' },
    },
    { id: 'clipboard-a', type: 'core.button', style: {}, props: { label: 'A' } },
    { id: 'clipboard-b', type: 'core.button', style: {}, props: { label: 'B' } },
  ]);
  await selectComponents(page, ['clipboard-a', 'clipboard-b']);

  const paste = page.locator('#ms-style-paste');
  await expect(paste).toHaveText("Paste Style — copy a style from a single component's panel first");
  await expect(paste).toBeDisabled();

  await page.evaluate(() => window.__studioApp.state.copyComponentStyle('clipboard-source'));
  await expect(paste).toHaveText("Paste Copied Style onto All 2 (replaces each one's full style)");
  await expect(paste).toBeEnabled();

  await page.evaluate(() => window.__studioApp.state.copyComponentStyle('clipboard-source', 'pressed'));
  await expect(paste).toHaveText('Paste Style — state-scoped copy needs a matching State sub-tab active above');
  await expect(paste).toBeDisabled();
  await page.locator('#ms-styletab-state').click();
  await expect(paste).toHaveText('Paste Pressed Style onto All 2');
  await expect(paste).toBeEnabled();

  await page.locator('#ms-styletab-normal').click();
  await page.evaluate(() => window.__studioApp.state.copyComponentStyle('clipboard-source', undefined, 0));
  await expect(paste).toHaveText('Paste Style — rule-scoped copy has no matching Rule sub-tab here; copy the full style instead');
  await expect(paste).toBeDisabled();
});

test('a style preset applies to every selected component and reports the selection count', async ({ page }) => {
  await openStudio(page);
  await seedComponents(page, [
    { id: 'preset-a', type: 'core.button', style: {}, props: { label: 'A' } },
    { id: 'preset-b', type: 'core.button', style: {}, props: { label: 'B' } },
  ]);
  await selectComponents(page, ['preset-a', 'preset-b']);

  await page.locator('.style-preset-swatch[data-preset="cockpit-glass"]').click();

  const styles = await page.evaluate(() => ['preset-a', 'preset-b'].map((id) => {
    const style = window.__studioApp.state.getComponent(id).style;
    return { typography: style.typography, border: style.border, background: style.background };
  }));
  expect(styles[0]).toEqual(styles[1]);
  expect(styles[0]).toEqual({
    typography: { font: 'Chakra Petch', size: 13, weight: 700, color: '#00d8f6' },
    border: { width: 1, radius: 6, color: '#273344' },
    background: { type: 'color', color: '#0b0f17' },
  });
  await expect(page.locator('.studio-toast')).toHaveText('Applied "Cockpit Glass" style to 2 components — still fully editable below.');
});

test('unsupported style-field wraps remain visible while their controls are disabled', async ({ page }) => {
  await openStudio(page);
  await seedComponents(page, [
    { id: 'availability-a', type: 'core.button', style: {}, props: { label: 'A' } },
    { id: 'availability-b', type: 'core.button', style: {}, props: { label: 'B' } },
  ]);
  await selectComponents(page, ['availability-a', 'availability-b']);

  const width = page.getByTestId('style-field-border.width');
  const color = page.getByTestId('style-field-typography.color');
  await expect(width).toBeVisible();
  await expect(color).toBeVisible();

  const disabled = await page.evaluate(() => {
    const inspector = window.__studioApp.inspector;
    const mount = document.querySelector('[data-testid="inspector-panel-style"]');
    inspector.applyMultiSelectFieldAvailability(mount, { enabledFieldPaths: ['style.typography.color'] });
    return {
      widthWraps: mount.querySelectorAll('[data-testid="style-field-border.width"]').length,
      widthDisabled: mount.querySelector('[data-testid="style-field-border.width"] input')?.disabled,
      colorDisabled: mount.querySelector('[data-testid="style-field-typography.color"] input')?.disabled,
      widthMarked: mount.querySelector('[data-testid="style-field-border.width"]')?.classList.contains('prop-field-multiselect-disabled'),
    };
  });

  expect(disabled).toEqual({ widthWraps: 1, widthDisabled: true, colorDisabled: false, widthMarked: true });
});
