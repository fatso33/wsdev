import { test, expect } from '@playwright/test';

/**
 * An Author can configure Acceleration's thresholds and coarse step in the Property
 * Inspector, hidden unless Acceleration is enabled, and can bind the aircraft's fast
 * step events.
 *
 * Driven through the real Inspector DOM, measuring visibility via offsetParent rather
 * than `.hidden` (the tier attribute sits on a wrapper, not the field). A showWhen-false
 * registry field is skipped from the DOM entirely, so it reads 'missing' (the fast step
 * events included); a field a UI tier hides reads 'hidden'. A fast event that is already
 * set while its gate fails is rendered dimmed, under a note and a Clear button.
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

async function seedRotary(page, { tier = 'full', binding = {}, props = {} } = {}) {
  await page.goto('/');
  await page.evaluate(({ binding, props }) => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push({
      id: 'seed-rot',
      type: 'core.rotary',
      label: 'Seed Rotary',
      layout: { col: 1, row: 1, w: 4, h: 4 },
      binding: { readSimVar: 'apHdgBugValue', ...binding },
      props: { min: 0, max: 360, ...props },
      style: {}
    });
    state.selectComponent('seed-rot');
  }, { binding, props });
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

  for (const sel of fields) expect(await usable(page, sel), `${sel} absolute, accel off`).toBe('missing');

  await page.locator(domId('props.acceleration')).check();
  for (const sel of fields) expect(await usable(page, sel), `${sel} absolute, accel on`).toBe('missing');

  await page.locator('#rf-props-writeMode').selectOption('pulse');
  for (const sel of fields) expect(await usable(page, sel), `${sel} pulse, accel on`).toBe('select');

  await page.locator(domId('props.acceleration')).uncheck();
  for (const sel of fields) expect(await usable(page, sel), `${sel} pulse, accel off`).toBe('missing');
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

test('with Acceleration on and Write Mode Absolute the fast step events are not shown, and no Advanced toggle exists', async ({ page }) => {
  await seedRotary(page, { props: { acceleration: true } });
  expect(await usable(page, '#c-bind-advanced-toggle')).toBe('missing');
  for (const sel of ['#c-bind-fastincrement', '#c-bind-fastdecrement']) expect(await usable(page, sel), sel).toBe('missing');
  for (const sel of ['#c-bind-fastincrement-custom-block', '#c-bind-fastincrement-connect']) expect(await usable(page, sel), sel).toBe('missing');
});

test('the fast step events are Full-only while unset, and a set one shows in Guided', async ({ page }) => {
  await seedRotary(page, { tier: 'build', props: { writeMode: 'pulse', acceleration: true } });
  for (const sel of ['#c-bind-fastincrement', '#c-bind-fastdecrement']) expect(await usable(page, sel), `${sel} unset, Build`).toBe('hidden');

  await seedRotary(page, { tier: 'guided', binding: { fastIncrementEvent: 'apHdgSet' }, props: { writeMode: 'pulse', acceleration: true } });
  expect(await usable(page, '#c-bind-fastincrement')).toBe('select');
  await expect(page.locator('#c-bind-fastincrement')).toHaveValue('apHdgSet');
  expect(await usable(page, '#c-bind-fastdecrement')).toBe('hidden');
});

test('a set fast step event whose gate fails is dimmed under a note and Clear; Clear removes only that key and the other is kept', async ({ page }) => {
  await seedRotary(page, {
    binding: { fastIncrementEvent: 'apHdgSet', fastDecrementEvent: 'com1Swap' },
    props: { writeMode: 'absolute', acceleration: true },
  });
  const wrap = (sel) => page.locator('.prop-field', { has: page.locator(sel) }).first();
  for (const [sel, value] of [['#c-bind-fastincrement', 'apHdgSet'], ['#c-bind-fastdecrement', 'com1Swap']]) {
    expect(await usable(page, sel), sel).toBe('select');
    await expect(page.locator(sel), sel).toHaveValue(value);
    await expect(wrap(sel).locator('.prop-showwhen-note'), sel).toContainText(`Write Mode ≠ pulse — still set to "${value}"`);
  }
  await wrap('#c-bind-fastincrement').locator('.prop-showwhen-clear').click();
  const binding = await bindingOf(page);
  expect(binding.fastIncrementEvent).toBeUndefined();
  expect(binding.fastDecrementEvent).toBe('com1Swap');
  expect(await usable(page, '#c-bind-fastincrement')).toBe('missing');
  expect(await usable(page, '#c-bind-fastdecrement')).toBe('select');

  await page.locator('#rf-props-writeMode').selectOption('pulse');
  await expect(page.locator('#c-bind-fastdecrement')).toHaveValue('com1Swap');
  await expect(wrap('#c-bind-fastdecrement').locator('.prop-showwhen-note')).toHaveCount(0);
  expect(await usable(page, '#c-bind-fastincrement')).toBe('select');
});

test('the fast step event note names Acceleration when that is what fails', async ({ page }) => {
  await seedRotary(page, { binding: { fastIncrementEvent: 'apHdgSet' }, props: { writeMode: 'pulse' } });
  await expect(page.locator('.prop-field', { has: page.locator('#c-bind-fastincrement') }).first().locator('.prop-showwhen-note'))
    .toContainText('Acceleration ≠ true — still set to "apHdgSet"');
});
