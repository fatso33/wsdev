import { test, expect } from '@playwright/test';
import { StudioValidator } from '../../js/StudioValidator.js';

/**
 * Ticket 18: "An Author can set a Pulse Rotary's Increment and Decrement Deck
 * Events from the Widget Studio Inspector, without hand-editing exported JSON."
 *
 * PropertyRegistry.js declares binding.incrementEvent/decrementEvent (see
 * shared/rotaryRegistry.test.js) with a Write Mode gate, and the Bindings panel
 * renders them through the field engine like any other row. A registry entry
 * alone proves nothing about what an Author can actually do, so this file
 * drives the real Inspector DOM (per this repo's routing/CLAUDE.md
 * convention), measuring visibility via offsetParent rather than `.hidden`
 * (the tier attribute sits on a wrapper, not the field). While Write Mode is
 * Absolute an unset field is not rendered at all ('missing'); one that holds a
 * value stays visible, dimmed under a note and Clear ('select').
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

// `tier` defaults to 'full' for tests exercising the data-tier="advanced"
// dropdown (the escape-hatch shape Write Deck Event also has), but the
// DEFAULT tier is Guided — and PropertyRegistry.js declares both fields
// `tier: 'simple', guided: true`, i.e. reachable WITHOUT leaving Guided. Fix
// pass (code review): the first version of this panel only added the
// data-tier="advanced" half of Write Deck Event's two-piece shape, so an
// Author in the default tier still couldn't reach these fields at all —
// exactly the "hand-edit the JSON" failure ticket 18 exists to close, just
// moved one layer deeper. Passing tier: null skips the Full-mode click
// entirely, to prove the Guided-tier picker on its own.
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
  if (tier) await page.locator(`[data-mode="${tier}"]`).click();
  await page.getByTestId('inspector-tab-data').click();
}

async function getBinding(page) {
  return page.evaluate(() => window.__studioApp.state.widgetDef.components.find((c) => c.id === 'seed-rot')?.binding || {});
}

test('Increment/Decrement Deck Event fields are not rendered while Write Mode is Absolute (the default)', async ({ page }) => {
  await seedRotary(page);
  await expect(page.locator('#rf-props-writeMode')).toHaveValue('absolute');
  expect(await isUsable(page, '#c-bind-increment')).toBe('missing');
  expect(await isUsable(page, '#c-bind-decrement')).toBe('missing');
});

test('switching Write Mode to Pulse reveals both fields live, without a reselect', async ({ page }) => {
  await seedRotary(page);
  expect(await isUsable(page, '#c-bind-increment')).toBe('missing');

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

// Fix pass (code review, finding 2): the prior version of this file only
// exercised the free-text/CUSTOM_OPTION_VALUE half of the custom-event
// picker, never picking an EXISTING saved custom event from the dropdown
// (buildCustomOptions()'s "used by another saved widget" list) — a
// different code path (customSelect's 'change' listener) than the free-text
// input's.
test('the custom/saved-event picker can also select an existing saved custom event from the dropdown', async ({ page }) => {
  await seedRotary(page);
  await page.evaluate(() => {
    // A different widget in this Studio's saved-widget library already uses
    // a custom write event — see extractCustomDeckEvents()'s "used by
    // another saved widget" provenance, which buildCustomOptions() surfaces.
    localStorage.setItem('fdws_saved_widgets', JSON.stringify([{
      id: 'com.test.other', kind: 'widget', fdws: '1.30', schemaVersion: '1.30.0',
      meta: { name: 'Other Widget', category: 'Avionics' },
      layout: { defaultW: 4, defaultH: 4, grid: { columns: 4, rows: 4 } },
      components: [{ id: 'c1', type: 'core.button', layout: { col: 1, row: 1, w: 2, h: 2 }, binding: { writeEvent: 'myBoostEvent' } }]
    }]));
    window.__studioApp.state.selectComponent('seed-rot'); // re-select to force a re-render picking up the new saved-widgets scan
  });
  await page.locator('#rf-props-writeMode').selectOption('pulse');

  await page.locator('#c-bind-increment').selectOption(CUSTOM_OPTION_VALUE);
  const customSelect = page.locator('#c-bind-increment-custom-select');
  await expect(customSelect).toBeVisible();
  await expect(customSelect.locator('option', { hasText: 'myBoostEvent' })).toHaveCount(1);

  await customSelect.selectOption('myBoostEvent');
  const binding = await getBinding(page);
  expect(binding.incrementEvent).toBe('myBoostEvent');
});

test('setting Write Mode back to Absolute shows both fields dimmed but does not discard already-set values', async ({ page }) => {
  await seedRotary(page);
  await page.locator('#rf-props-writeMode').selectOption('pulse');
  await page.locator('#c-bind-increment').selectOption('apHdgSet');
  await page.locator('#c-bind-decrement').selectOption('com1Swap');

  await page.locator('#rf-props-writeMode').selectOption('absolute');

  expect(await isUsable(page, '#c-bind-increment')).toBe('select');
  expect(await isUsable(page, '#c-bind-decrement')).toBe('select');

  const binding = await getBinding(page);
  expect(binding.incrementEvent).toBe('apHdgSet');
  expect(binding.decrementEvent).toBe('com1Swap');

  // Flip back to Pulse: the previously-set values are still there to compare,
  // not silently reset to blank.
  await page.locator('#rf-props-writeMode').selectOption('pulse');
  await expect(page.locator('#c-bind-increment')).toHaveValue('apHdgSet');
  await expect(page.locator('#c-bind-decrement')).toHaveValue('com1Swap');
});

// Fix pass (code review, finding 1 — the blocking bug): reachable in the
// DEFAULT tier, not just Full. Mirrors Write Deck Event's own Simple/Guided
// picker (buildConnectSimPicker) rather than the data-tier="advanced"
// dropdown other tests here exercise.
test('the Simple/Guided-tier Connect to Simulator picker reaches Increment/Decrement without switching to Full tier', async ({ page }) => {
  await seedRotary(page, { tier: null }); // stays on the default (Guided) tier

  await expect(page.locator('#rf-props-writeMode')).toBeVisible();
  expect(await isUsable(page, '#c-connect-increment-category')).toBe('missing'); // still Absolute mode
  expect(await isUsable(page, '#c-bind-increment')).toBe('missing'); // the Full-only dropdown, not rendered either

  await page.locator('#rf-props-writeMode').selectOption('pulse');

  const incrementCategory = page.locator('#c-connect-increment-category');
  const decrementCategory = page.locator('#c-connect-decrement-category');
  await expect(incrementCategory).toBeVisible();
  await expect(decrementCategory).toBeVisible();

  await incrementCategory.selectOption('ap');
  await page.locator('#c-connect-increment-variable').selectOption('apHdgBugInc');
  await decrementCategory.selectOption('ap');
  await page.locator('#c-connect-decrement-variable').selectOption('apHdgBugDec');

  const binding = await getBinding(page);
  expect(binding.incrementEvent).toBe('apHdgBugInc');
  expect(binding.decrementEvent).toBe('apHdgBugDec');

  // Switching Write Mode back to Absolute dims this picker (it holds a value, so it stays
  // visible), same value-preservation guarantee as the Full-tier dropdown.
  await page.locator('#rf-props-writeMode').selectOption('absolute');
  expect(await isUsable(page, '#c-connect-increment-category')).toBe('select');
  const bindingAfter = await getBinding(page);
  expect(bindingAfter.incrementEvent).toBe('apHdgBugInc');
  expect(bindingAfter.decrementEvent).toBe('apHdgBugDec');
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

// Fix pass (code review, finding 3): the ticket's own acceptance criterion
// says "validates AND renders" — the prior version of this test only
// checked validate(). Device View runs the real RotaryComponent against
// MockWidgetHost (see rotary-device-preview.spec.js), so switching to it and
// finding the real knob face proves the Pulse-authored definition doesn't
// just pass validation on paper, it actually renders through the runtime.
test('a Pulse Rotary authored entirely through the UI exports a definition that validates AND renders', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await seedRotary(page);
  await page.locator('#rf-props-writeMode').selectOption('pulse');
  await page.locator('#c-bind-increment').selectOption('apHdgSet');
  await page.locator('#c-bind-decrement').selectOption('com1Swap');

  const widgetDef = await page.evaluate(() => window.__studioApp.state.widgetDef);
  const result = StudioValidator.validate(widgetDef);
  expect(result.errors, result.errors.join(' | ')).toEqual([]);
  expect((result.blockingIssues || []).map((b) => b.code)).not.toContain('UNWIRED_WRITE_EVENT');

  await page.evaluate(() => window.__studioApp.state.setViewportMode('device'));
  await expect(page.locator('.fd-rotary-face')).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('an Increment set on a Pulse Rotary and then switched to Absolute is dimmed under a Write Mode note; Clear removes only that key and the field goes', async ({ page }) => {
  await seedRotary(page);
  await page.locator('#rf-props-writeMode').selectOption('pulse');
  await page.locator('#c-bind-increment').selectOption('apHdgSet');
  await page.locator('#c-bind-decrement').selectOption('com1Swap');
  await page.locator('#rf-props-writeMode').selectOption('absolute');

  const field = page.locator('.prop-field', { has: page.locator('#c-bind-increment') }).first();
  await expect(field.locator('.prop-showwhen-note')).toContainText('Write Mode');
  await expect(field.locator('.prop-showwhen-note')).toContainText('still set to "apHdgSet"');
  expect(await getBinding(page)).toMatchObject({ incrementEvent: 'apHdgSet', decrementEvent: 'com1Swap' });

  await field.locator('.prop-showwhen-clear').click();
  const binding = await getBinding(page);
  expect(binding.incrementEvent).toBeUndefined();
  expect(binding.decrementEvent).toBe('com1Swap');
  expect(await isUsable(page, '#c-bind-increment')).toBe('missing');
  expect(await isUsable(page, '#c-bind-decrement')).toBe('select');
});

test('in Guided the dimmed Increment is its Guided picker, with the note and Clear', async ({ page }) => {
  await seedRotary(page, { tier: null });
  await page.locator('#rf-props-writeMode').selectOption('pulse');
  await page.locator('#c-connect-increment-category').selectOption('ap');
  await page.locator('#c-connect-increment-variable').selectOption('apHdgBugInc');
  await page.locator('#rf-props-writeMode').selectOption('absolute');

  const field = page.locator('.prop-field', { has: page.locator('#c-connect-increment-category') }).first();
  await expect(page.locator('#c-connect-increment-category')).toBeVisible();
  await expect(page.locator('#c-connect-increment-variable')).toHaveValue('apHdgBugInc');
  await expect(field.locator('.prop-showwhen-note')).toContainText('Write Mode');
  expect(await isUsable(page, '#c-bind-increment')).toBe('hidden');

  await field.locator('.prop-showwhen-clear').click();
  expect((await getBinding(page)).incrementEvent).toBeUndefined();
  expect(await isUsable(page, '#c-connect-increment-category')).toBe('missing');
});
