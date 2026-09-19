import { test, expect } from '@playwright/test';

/**
 * An Author can configure Acceleration's thresholds and coarse step in the Property
 * Inspector, hidden unless Acceleration is enabled, and can bind the aircraft's fast
 * step events.
 *
 * Driven through the real Inspector DOM, measuring visibility via offsetParent rather
 * than `.hidden` (the tier attribute sits on a wrapper, not the field). A showWhen-false
 * registry field is skipped from the DOM entirely, so it reads 'missing'; the
 * hand-built Bindings fields stay in the DOM and are hidden inline, so they read 'hidden'.
 */

const DETAIL = ['props.accelerationCoarseStep', 'props.accelerationEnterRate', 'props.accelerationExitRate'];
const CUSTOM_OPTION_VALUE = '__custom__';

const domId = (path) => `#rf-${path.replace(/\./g, '-')}`;

async function usable(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return 'missing';
    if (el.offsetParent === null) return 'hidden';
    return el.tagName.toLowerCase();
  }, selector);
}

async function seedRotary(page, { tier = 'full' } = {}) {
  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push({
      id: 'seed-rot',
      type: 'core.rotary',
      label: 'Seed Rotary',
      layout: { col: 1, row: 1, w: 4, h: 4 },
      binding: { readSimVar: 'apHdgBugValue' },
      props: { min: 0, max: 360 },
      style: {}
    });
    state.selectComponent('seed-rot');
  });
  await page.locator(`[data-mode="${tier}"]`).click();
  await page.getByTestId('inspector-tab-data').click();
}

const propOf = (page, key) => page.evaluate((k) => window.__studioApp.state.widgetDef.components.find((c) => c.id === 'seed-rot')?.props?.[k], key);
const bindingOf = (page) => page.evaluate(() => window.__studioApp.state.widgetDef.components.find((c) => c.id === 'seed-rot')?.binding || {});

test('Acceleration is off by default and shows none of its detail fields', async ({ page }) => {
  await seedRotary(page);
  expect(await usable(page, domId('props.acceleration'))).toBe('input');
  await expect(page.locator(domId('props.acceleration'))).not.toBeChecked();
  for (const path of DETAIL) expect(await usable(page, domId(path)), path).toBe('missing');
});

test('enabling Acceleration reveals the coarse step and both thresholds live', async ({ page }) => {
  await seedRotary(page);
  await page.locator(domId('props.acceleration')).check();
  for (const path of DETAIL) expect(await usable(page, domId(path)), path).toBe('input');
  expect(await propOf(page, 'acceleration')).toBe(true);

  await page.locator(domId('props.acceleration')).uncheck();
  for (const path of DETAIL) expect(await usable(page, domId(path)), path).toBe('missing');
});

test('the Enable checkbox and the coarse step are reachable on the Build tier; the thresholds are not', async ({ page }) => {
  await seedRotary(page, { tier: 'build' });
  expect(await usable(page, domId('props.acceleration'))).toBe('input');
  await page.locator(domId('props.acceleration')).check();
  expect(await usable(page, domId('props.accelerationCoarseStep'))).toBe('input');
  expect(await usable(page, domId('props.accelerationEnterRate'))).toBe('hidden');
  expect(await usable(page, domId('props.accelerationExitRate'))).toBe('hidden');
});

test('the coarse step advertises its minimum of 1, and the Enter Rate advertises none', async ({ page }) => {
  await seedRotary(page);
  await page.locator(domId('props.acceleration')).check();
  const minOf = (path) => page.evaluate((sel) => document.querySelector(sel)?.getAttribute('min') ?? null, domId(path));
  expect(await minOf('props.accelerationCoarseStep')).toBe('1');
  expect(await minOf('props.accelerationEnterRate')).toBeNull();
});

test('an Author can set the coarse step and both thresholds, and they commit to the widget definition', async ({ page }) => {
  await seedRotary(page);
  await page.locator(domId('props.acceleration')).check();

  await page.locator(domId('props.accelerationCoarseStep')).fill('8');
  await page.locator(domId('props.accelerationCoarseStep')).dispatchEvent('change');
  await page.locator(domId('props.accelerationEnterRate')).fill('30');
  await page.locator(domId('props.accelerationEnterRate')).dispatchEvent('change');
  await page.locator(domId('props.accelerationExitRate')).fill('12');
  await page.locator(domId('props.accelerationExitRate')).dispatchEvent('change');

  expect(await propOf(page, 'accelerationCoarseStep')).toBe(8);
  expect(await propOf(page, 'accelerationEnterRate')).toBe(30);
  expect(await propOf(page, 'accelerationExitRate')).toBe(12);
});

test('the fast step events appear only for a Pulse Rotary with Acceleration on', async ({ page }) => {
  await seedRotary(page);
  const fields = ['#c-bind-fastincrement', '#c-bind-fastdecrement'];

  for (const sel of fields) expect(await usable(page, sel), `${sel} absolute, accel off`).toBe('hidden');

  await page.locator(domId('props.acceleration')).check();
  for (const sel of fields) expect(await usable(page, sel), `${sel} absolute, accel on`).toBe('hidden');

  await page.locator('#rf-props-writeMode').selectOption('pulse');
  for (const sel of fields) expect(await usable(page, sel), `${sel} pulse, accel on`).toBe('select');

  await page.locator(domId('props.acceleration')).uncheck();
  for (const sel of fields) expect(await usable(page, sel), `${sel} pulse, accel off`).toBe('hidden');
});

test('an Author can bind the fast step events, and switching Acceleration off keeps them', async ({ page }) => {
  await seedRotary(page);
  await page.locator('#rf-props-writeMode').selectOption('pulse');
  await page.locator(domId('props.acceleration')).check();

  await page.locator('#c-bind-fastincrement').selectOption('apHdgSet');
  await page.locator('#c-bind-fastdecrement').selectOption('com1Swap');
  let binding = await bindingOf(page);
  expect(binding.fastIncrementEvent).toBe('apHdgSet');
  expect(binding.fastDecrementEvent).toBe('com1Swap');

  await page.locator(domId('props.acceleration')).uncheck();
  binding = await bindingOf(page);
  expect(binding.fastIncrementEvent).toBe('apHdgSet');
  expect(binding.fastDecrementEvent).toBe('com1Swap');

  await page.locator(domId('props.acceleration')).check();
  await expect(page.locator('#c-bind-fastincrement')).toHaveValue('apHdgSet');
  await expect(page.locator('#c-bind-fastdecrement')).toHaveValue('com1Swap');
});

test('a fast step event can be a raw address, with the sanitize diff surfacing stripped characters', async ({ page }) => {
  await seedRotary(page);
  await page.locator('#rf-props-writeMode').selectOption('pulse');
  await page.locator(domId('props.acceleration')).check();

  await page.locator('#c-bind-fastincrement').selectOption(CUSTOM_OPTION_VALUE);
  await expect(page.locator('#c-bind-fastincrement-custom-block')).toBeVisible();
  const input = page.locator('#c-bind-fastincrement-custom-input');
  await input.fill('(H:MY_FAST_INC)');
  await expect(page.locator('#c-bind-fastincrement-custom-diff')).toContainText('Removed');
  await input.dispatchEvent('change');

  expect((await bindingOf(page)).fastIncrementEvent).toBe('H:MY_FAST_INC');
});
