import { test, expect, openStudio, seedStateVars } from './fixtures/inspectorHarness.js';
import { StudioValidator } from '../../js/StudioValidator.js';

/**
 * An Author builds a Pulse Rotary through the Bindings panel alone, moving from
 * Guided to Build to Full the way the tiers are meant to be used, and never
 * editing exported JSON. What each tier offers:
 *
 * - Guided: Write Mode, and Increment and Decrement through their Guided pickers.
 * - Build: a declared Local State Var.
 * - Full: Acceleration and both fast step events, Poll Rate, Dead Band,
 *   Transition, and a raw Read address with its Unit.
 *
 * The exported definition must then pass `StudioValidator.validate` with no
 * errors and render in Device view.
 */

const CUSTOM_OPTION_VALUE = '__custom__';
const ROTARY_ID = 'journey-rot';

async function switchTier(page, tier) {
  await page.locator(`[data-mode="${tier}"]`).click();
  await page.getByTestId('inspector-tab-data').click();
}

const bindingOf = (page) => page.evaluate((id) => window.__studioApp.state.widgetDef.components.find((c) => c.id === id)?.binding || {}, ROTARY_ID);
const propsOf = (page) => page.evaluate((id) => window.__studioApp.state.widgetDef.components.find((c) => c.id === id)?.props || {}, ROTARY_ID);

test('a Pulse Rotary authored through the Bindings panel across Guided, Build and Full validates and renders', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await openStudio(page);
  await seedStateVars(page, [{ name: 'journeyFlag', type: 'boolean', default: false }]);
  await page.evaluate((id) => {
    const { state } = window.__studioApp;
    state.addComponent({ id, type: 'core.rotary', label: 'Journey Rotary', layout: { col: 1, row: 1, w: 4, h: 4 }, binding: {}, props: { min: 0, max: 360 }, style: {} });
    state.selectComponent(id);
  }, ROTARY_ID);

  // Guided: Write Mode Pulse, then Increment and Decrement from their Guided pickers.
  await switchTier(page, 'guided');
  await page.locator('#rf-props-writeMode').selectOption('pulse');
  await page.locator('#c-connect-increment-category').selectOption('ap');
  await page.locator('#c-connect-increment-variable').selectOption('apHdgBugInc');
  await page.locator('#c-connect-decrement-category').selectOption('ap');
  await page.locator('#c-connect-decrement-variable').selectOption('apHdgBugDec');
  expect(await bindingOf(page)).toMatchObject({ incrementEvent: 'apHdgBugInc', decrementEvent: 'apHdgBugDec' });

  // Build: the declared Local State Var.
  await switchTier(page, 'build');
  await expect(page.locator('#c-bind-state')).toBeVisible();
  await page.locator('#c-bind-state').selectOption('journeyFlag');
  expect((await bindingOf(page)).stateVar).toBe('journeyFlag');

  // Full: Acceleration and both fast step events.
  await switchTier(page, 'full');
  await page.locator('#rf-props-acceleration').check();
  await page.locator('#c-bind-fastincrement').selectOption('apHdgSet');
  await page.locator('#c-bind-fastdecrement').selectOption('com1Swap');

  // Full: Poll Rate, Dead Band and Transition.
  await page.locator('#c-bind-pollrate').selectOption('100');
  await page.locator('#c-bind-deadband').fill('0.5');
  await page.locator('#c-bind-deadband').dispatchEvent('change');
  await page.locator('#c-bind-transition-ms').fill('250');
  await page.locator('#c-bind-transition-ms').dispatchEvent('change');

  // Full: a raw Read address, which enables Unit.
  await expect(page.locator('#c-bind-unit')).toBeDisabled();
  await page.locator('#c-bind-read').selectOption(CUSTOM_OPTION_VALUE);
  await page.locator('#c-bind-read-custom-input').fill('A:AUTOPILOT HEADING LOCK DIR');
  await page.locator('#c-bind-read-custom-input').dispatchEvent('change');
  await expect(page.locator('#c-bind-unit')).toBeEnabled();
  await page.locator('#c-bind-unit').fill('degrees');
  await page.locator('#c-bind-unit').dispatchEvent('change');

  expect(await propsOf(page)).toMatchObject({ writeMode: 'pulse', acceleration: true });
  expect(await bindingOf(page)).toEqual({
    incrementEvent: 'apHdgBugInc',
    decrementEvent: 'apHdgBugDec',
    stateVar: 'journeyFlag',
    fastIncrementEvent: 'apHdgSet',
    fastDecrementEvent: 'com1Swap',
    pollFrequencyHz: 100,
    deadband: 0.5,
    transition: { durationMs: 250, easing: 'linear' },
    readSimVar: 'A:AUTOPILOT HEADING LOCK DIR',
    unit: 'degrees'
  });

  const widgetDef = await page.evaluate(() => window.__studioApp.state.widgetDef);
  const result = StudioValidator.validate(widgetDef);
  expect(result.errors, result.errors.join(' | ')).toEqual([]);
  expect((result.blockingIssues || []).map((b) => b.code)).not.toContain('UNWIRED_WRITE_EVENT');

  await page.evaluate(() => window.__studioApp.state.setViewportMode('device'));
  await expect(page.locator('.fd-rotary-face')).toBeVisible();
  expect(pageErrors).toEqual([]);
});
