import { test, expect } from '@playwright/test';
import { resolveFeelDefault, resolveFeelFloor } from '../../widgets/components/rotaryEngine.js';

/**
 * A Rotary dropped from the palette is Absolute-shaped (Feel 1, a heading write event).
 * Switching it to Pulse must give an Author a control shaped for Pulse without ever
 * rewriting a value they chose, and must show what it did.
 *
 * Every numeric expectation is derived from the engine's own resolveFeelDefault /
 * resolveFeelFloor, so re-tuning the default changes one place.
 */

const FEEL = '#rf-props-degreesPerUnit';
const PULSE_FEEL = resolveFeelDefault('arc', 'pulse');

/** Drops a Rotary exactly the way the palette does, selects it, and opens the Data tab. */
async function dropPaletteRotary(page, overrideProps = null) {
  await page.goto('/');
  await page.evaluate(async (props) => {
    const { PALETTE_ITEMS, createComponentFromPaletteItem } = await import('/js/StudioLayersPanel.js');
    const state = window.__studioApp.state;
    const template = PALETTE_ITEMS.find((p) => p.type === 'core.rotary');
    const created = createComponentFromPaletteItem(state, template);
    if (props) state.updateComponent(created.id, { props: { ...created.props, ...props } });
    state.selectComponent(created.id);
    window.__rotaryId = created.id;
  }, overrideProps);
  await page.locator('[data-mode="build"]').click();
  await page.getByTestId('inspector-tab-data').click();
}

const rotary = (page) => page.evaluate(() => {
  const state = window.__studioApp.state;
  const c = state.widgetDef.components.find((x) => x.id === window.__rotaryId);
  return { props: c.props, binding: c.binding, capabilities: state.widgetDef.capabilities };
});

const setWriteMode = (page, mode) => page.locator('#rf-props-writeMode').selectOption(mode);

test('a palette Rotary is Absolute-shaped, exactly as before', async ({ page }) => {
  await dropPaletteRotary(page);
  const r = await rotary(page);
  expect(r.props).toEqual({ min: 0, max: 360, degreesPerUnit: 1 });
  expect(r.binding).toEqual({ readSimVar: 'apHdgBugValue', writeEvent: 'apHdgSet' });
  await expect(page.locator(FEEL)).toHaveValue('1');
});

test('switching an untouched Rotary to Pulse gives it a Pulse-shaped Feel, and says so', async ({ page }) => {
  await dropPaletteRotary(page);
  await setWriteMode(page, 'pulse');

  expect((await rotary(page)).props.degreesPerUnit).toBe(PULSE_FEEL);
  expect(PULSE_FEEL).toBeGreaterThan(resolveFeelFloor('arc', 'pulse'));
  await expect(page.locator(FEEL)).toHaveValue(String(PULSE_FEEL));
  await expect(page.locator('.studio-toast.visible')).toContainText('Feel');
  await expect(page.locator('.studio-toast.visible')).toContainText(String(PULSE_FEEL));
});

test('the Author can undo the switch in one step', async ({ page }) => {
  await dropPaletteRotary(page);
  await setWriteMode(page, 'pulse');
  await page.evaluate(() => window.__studioApp.state.undo());

  const r = await rotary(page);
  expect(r.props.writeMode).toBeUndefined();
  expect(r.props.degreesPerUnit).toBe(1);
});

test('a Feel the Author set deliberately survives the switch, with no notice', async ({ page }) => {
  await dropPaletteRotary(page, { degreesPerUnit: 3 });
  await setWriteMode(page, 'pulse');

  expect((await rotary(page)).props.degreesPerUnit).toBe(3);
  await expect(page.locator(FEEL)).toHaveValue('3');
  await expect(page.locator('.studio-toast.visible')).toHaveCount(0);
});

test('a Feel typed by hand into an Absolute Rotary survives the round trip both ways', async ({ page }) => {
  await dropPaletteRotary(page);
  await page.locator(FEEL).fill('45');
  await page.locator(FEEL).press('Tab');
  await setWriteMode(page, 'pulse');
  expect((await rotary(page)).props.degreesPerUnit).toBe(45);
  await setWriteMode(page, 'absolute');
  expect((await rotary(page)).props.degreesPerUnit).toBe(45);
});

test('switching Pulse back to Absolute returns an untouched Pulse Feel to the Absolute default', async ({ page }) => {
  await dropPaletteRotary(page);
  await setWriteMode(page, 'pulse');
  await setWriteMode(page, 'absolute');
  expect((await rotary(page)).props.degreesPerUnit).toBe(1);
});

test('the stored write event survives the switch but is not declared as a capability in Pulse', async ({ page }) => {
  await dropPaletteRotary(page);
  await setWriteMode(page, 'pulse');

  const pulse = await rotary(page);
  expect(pulse.binding.writeEvent).toBe('apHdgSet');
  expect(pulse.capabilities.writeEvents).not.toContain('apHdgSet');

  await setWriteMode(page, 'absolute');
  const absolute = await rotary(page);
  expect(absolute.binding.writeEvent).toBe('apHdgSet');
  expect(absolute.capabilities.writeEvents).toContain('apHdgSet');
});

test('the Write Deck Event field says it is unused in Pulse, and only in Pulse', async ({ page }) => {
  await dropPaletteRotary(page);
  await page.locator('[data-mode="full"]').click();
  const note = page.locator('#c-bind-write-pulse-note');
  await expect(note).toHaveCount(0);

  await setWriteMode(page, 'pulse');
  await expect(note).toBeVisible();
  await expect(note).toContainText(/not used in Pulse/i);

  await setWriteMode(page, 'absolute');
  await expect(note).toHaveCount(0);
});

test('the Feel field reads as steps in Pulse, and as degrees per unit in Absolute', async ({ page }) => {
  await dropPaletteRotary(page);
  const label = page.locator(FEEL).locator('xpath=ancestor::*[contains(@class,"prop-field")][1]').locator('label');
  await expect(label).toHaveText('Degrees Per Unit');
  await expect(page.locator('#rf-props-degreesPerUnit-meaning')).toHaveCount(0);

  await setWriteMode(page, 'pulse');
  await expect(label).toHaveText(/degrees per step/i);
  const stepsPerRevolution = 360 / PULSE_FEEL;
  await expect(page.locator('#rf-props-degreesPerUnit-meaning')).toContainText(`${stepsPerRevolution} steps per revolution`);

  await page.locator('#rf-props-gesture').selectOption('scrub');
  await expect(label).toHaveText(/pixels per step/i);

  await page.locator('#rf-props-gesture').selectOption('tap');
  await expect(label).toHaveText('Degrees Per Unit');
  await expect(page.locator('#rf-props-degreesPerUnit-meaning')).toHaveCount(0);
});

test('a Feel authored below the floor is described at the floor it will run at', async ({ page }) => {
  await dropPaletteRotary(page, { degreesPerUnit: 2 });
  await setWriteMode(page, 'pulse');
  const floor = resolveFeelFloor('arc', 'pulse');
  await expect(page.locator('#rf-props-degreesPerUnit-meaning')).toContainText(`${360 / floor} steps per revolution`);
  await expect(page.locator('#rf-props-degreesPerUnit-meaning')).toContainText(/floor/i);
  expect((await rotary(page)).props.degreesPerUnit).toBe(2);
});
