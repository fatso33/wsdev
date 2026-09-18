import { test, expect } from '@playwright/test';
import { StudioValidator } from '../../js/StudioValidator.js';

/**
 * Ticket 18: "An Author can set a Pulse Rotary's Increment and Decrement Deck
 * Events from the Widget Studio Inspector, without hand-editing exported JSON."
 *
 * PropertyRegistry.js already declares binding.incrementEvent/decrementEvent
 * (see shared/rotaryRegistry.test.js) but the Bindings panel is hand-built and
 * never calls getFieldsForType() for Bindings rows, so the registry entry alone
 * proved nothing about what an Author can actually do — this file drives the
 * real Inspector DOM instead (per this repo's routing/CLAUDE.md convention),
 * measuring visibility via offsetParent rather than `.hidden` (the tier
 * attribute sits on a wrapper, not the field).
 */

const CUSTOM_OPTION_VALUE = '__custom__';

/** Visible in the "can the Author actually see and use it" sense. */
async function isUsable(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return 'missing';
    if (el.offsetParent === null) return 'hidden';
    return el.tagName.toLowerCase();
  }, selector);
}

async function seedRotary(page) {
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
  // Both new fields carry data-tier="advanced", matching the existing Write
  // Deck Event field's own tier gating — Full tier is where they're reachable.
  await page.locator('[data-mode="full"]').click();
  await page.getByTestId('inspector-tab-data').click();
}

async function getBinding(page) {
  return page.evaluate(() => window.__studioApp.state.widgetDef.components.find((c) => c.id === 'seed-rot')?.binding || {});
}

test('Increment/Decrement Deck Event fields are hidden while Write Mode is Absolute (the default)', async ({ page }) => {
  await seedRotary(page);
  await expect(page.locator('#rf-props-writeMode')).toHaveValue('absolute');
  expect(await isUsable(page, '#c-bind-increment')).toBe('hidden');
  expect(await isUsable(page, '#c-bind-decrement')).toBe('hidden');
});

test('switching Write Mode to Pulse reveals both fields live, without a reselect', async ({ page }) => {
  await seedRotary(page);
  expect(await isUsable(page, '#c-bind-increment')).toBe('hidden');

  await page.locator('#rf-props-writeMode').selectOption('pulse');

  expect(await isUsable(page, '#c-bind-increment')).toBe('select');
  expect(await isUsable(page, '#c-bind-decrement')).toBe('select');
});

test('an Author can set both events from the default Deck Event dropdown, and the values commit to the widget definition', async ({ page }) => {
  await seedRotary(page);
  await page.locator('#rf-props-writeMode').selectOption('pulse');

  await page.locator('#c-bind-increment').selectOption('apHdgSet');
  await page.locator('#c-bind-decrement').selectOption('com1Swap');

  const binding = await getBinding(page);
  expect(binding.incrementEvent).toBe('apHdgSet');
  expect(binding.decrementEvent).toBe('com1Swap');
});

test('the custom/saved-event picker and free-text raw address are usable, with the sanitize diff surfacing stripped characters', async ({ page }) => {
  await seedRotary(page);
  await page.locator('#rf-props-writeMode').selectOption('pulse');

  await page.locator('#c-bind-increment').selectOption(CUSTOM_OPTION_VALUE);
  await expect(page.locator('#c-bind-increment-custom-block')).toBeVisible();

  const customInput = page.locator('#c-bind-increment-custom-input');
  await customInput.fill('(H:GTN750_DirectToPush)');
  // sanitize diff is driven by the 'input' listener, before commit.
  await expect(page.locator('#c-bind-increment-custom-diff')).toBeVisible();
  await expect(page.locator('#c-bind-increment-custom-diff')).toContainText('Removed');

  await customInput.dispatchEvent('change');
  const binding = await getBinding(page);
  expect(binding.incrementEvent).toBe('H:GTN750_DirectToPush');
});

test('setting Write Mode back to Absolute hides both fields but does not discard already-set values', async ({ page }) => {
  await seedRotary(page);
  await page.locator('#rf-props-writeMode').selectOption('pulse');
  await page.locator('#c-bind-increment').selectOption('apHdgSet');
  await page.locator('#c-bind-decrement').selectOption('com1Swap');

  await page.locator('#rf-props-writeMode').selectOption('absolute');

  expect(await isUsable(page, '#c-bind-increment')).toBe('hidden');
  expect(await isUsable(page, '#c-bind-decrement')).toBe('hidden');

  const binding = await getBinding(page);
  expect(binding.incrementEvent).toBe('apHdgSet');
  expect(binding.decrementEvent).toBe('com1Swap');

  // Flip back to Pulse: the previously-set values are still there to compare,
  // not silently reset to blank.
  await page.locator('#rf-props-writeMode').selectOption('pulse');
  await expect(page.locator('#c-bind-increment')).toHaveValue('apHdgSet');
  await expect(page.locator('#c-bind-decrement')).toHaveValue('com1Swap');
});

test('the Connect… picker (Raw Address tab) commits to incrementEvent/decrementEvent, not writeEvent', async ({ page }) => {
  await seedRotary(page);
  await page.locator('#rf-props-writeMode').selectOption('pulse');

  await page.locator('#c-bind-increment-connect').click();
  await page.getByRole('button', { name: 'Raw Address' }).click();
  await page.locator('#cn-raw-input').fill('H:MY_INCREMENT_EVENT');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();

  const binding = await getBinding(page);
  expect(binding.incrementEvent).toBe('H:MY_INCREMENT_EVENT');
  expect(binding.writeEvent).toBeUndefined();
});

test('a Pulse Rotary authored entirely through the UI exports a definition that validates cleanly', async ({ page }) => {
  await seedRotary(page);
  await page.locator('#rf-props-writeMode').selectOption('pulse');
  await page.locator('#c-bind-increment').selectOption('apHdgSet');
  await page.locator('#c-bind-decrement').selectOption('com1Swap');

  const widgetDef = await page.evaluate(() => window.__studioApp.state.widgetDef);
  const result = StudioValidator.validate(widgetDef);
  expect(result.errors, result.errors.join(' | ')).toEqual([]);
  expect((result.blockingIssues || []).map((b) => b.code)).not.toContain('UNWIRED_WRITE_EVENT');
});
