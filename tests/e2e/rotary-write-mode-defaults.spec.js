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

test('a Feel the Author set at or above the floor survives the switch, with no notice', async ({ page }) => {
  const feel = resolveFeelFloor('arc', 'pulse') + 2;
  await dropPaletteRotary(page, { degreesPerUnit: feel });
  await setWriteMode(page, 'pulse');

  expect((await rotary(page)).props.degreesPerUnit).toBe(feel);
  await expect(page.locator(FEEL)).toHaveValue(String(feel));
  await expect(page.locator('.studio-toast.visible')).toHaveCount(0);
});

test('a Feel the Author set below the floor is raised to it on the switch, and the toast says so', async ({ page }) => {
  const floor = resolveFeelFloor('arc', 'pulse');
  await dropPaletteRotary(page, { degreesPerUnit: 2 });
  await setWriteMode(page, 'pulse');

  expect((await rotary(page)).props.degreesPerUnit).toBe(floor);
  await expect(page.locator(FEEL)).toHaveValue(String(floor));
  await expect(page.locator('.studio-toast.visible')).toContainText(/floor/i);
  await expect(page.locator('.studio-toast.visible')).toContainText(String(floor));
});

test('raising a Feel to the floor is one undo step', async ({ page }) => {
  await dropPaletteRotary(page, { degreesPerUnit: 2 });
  await setWriteMode(page, 'pulse');
  await page.evaluate(() => window.__studioApp.state.undo());

  const r = await rotary(page);
  expect(r.props.writeMode).toBeUndefined();
  expect(r.props.degreesPerUnit).toBe(2);
});

test('changing the Gesture keeps Feel at or above the new floor', async ({ page }) => {
  const arcFloor = resolveFeelFloor('arc', 'pulse');
  const scrubFloor = resolveFeelFloor('scrub', 'pulse');
  const scrubDefault = resolveFeelDefault('scrub', 'pulse');
  await dropPaletteRotary(page);
  await setWriteMode(page, 'pulse');
  expect((await rotary(page)).props.degreesPerUnit).toBe(PULSE_FEEL);

  // Untouched at the Arc default: moves to the Scrub default.
  await page.locator('#rf-props-gesture').selectOption('scrub');
  expect((await rotary(page)).props.degreesPerUnit).toBe(scrubDefault);

  // Still the default, so it follows the Gesture back to Arc.
  await page.locator('#rf-props-gesture').selectOption('arc');
  expect((await rotary(page)).props.degreesPerUnit).toBe(PULSE_FEEL);

  // Adjusted to the Arc floor, which is below the Scrub floor: raised on the switch.
  await page.locator(FEEL).fill(String(arcFloor));
  await page.locator(FEEL).press('Tab');
  expect((await rotary(page)).props.degreesPerUnit).toBe(arcFloor);
  await page.locator('#rf-props-gesture').selectOption('scrub');
  expect((await rotary(page)).props.degreesPerUnit).toBe(scrubFloor);
  await expect(page.locator('.studio-toast.visible')).toContainText(/floor/i);
});

test('changing a Pulse Rotary from Tap to Arc moves an untouched Feel to the default and raises an adjusted one', async ({ page }) => {
  await dropPaletteRotary(page);
  await setWriteMode(page, 'pulse');
  await page.locator('#rf-props-gesture').selectOption('tap');
  expect((await rotary(page)).props.degreesPerUnit).toBe(1);

  await page.locator('#rf-props-gesture').selectOption('arc');
  expect((await rotary(page)).props.degreesPerUnit).toBe(PULSE_FEEL);

  await page.locator('#rf-props-gesture').selectOption('tap');
  await page.locator(FEEL).fill('2');
  await page.locator(FEEL).press('Tab');
  await page.locator('#rf-props-gesture').selectOption('arc');
  expect((await rotary(page)).props.degreesPerUnit).toBe(resolveFeelFloor('arc', 'pulse'));
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

test('a stored Feel below the floor is described at the floor it will run at, and is not rewritten', async ({ page }) => {
  await dropPaletteRotary(page, { writeMode: 'pulse', degreesPerUnit: 2 });
  const floor = resolveFeelFloor('arc', 'pulse');
  await expect(page.locator('#rf-props-degreesPerUnit-meaning')).toContainText(`${360 / floor} steps per revolution`);
  await expect(page.locator('#rf-props-degreesPerUnit-meaning')).toContainText(/floor/i);
  await expect(page.locator(FEEL)).toHaveValue('2');
  expect((await rotary(page)).props.degreesPerUnit).toBe(2);
});

test('a Feel typed below the floor is committed as the floor, which needs no floor note', async ({ page }) => {
  await dropPaletteRotary(page);
  await setWriteMode(page, 'pulse');
  await page.locator(FEEL).fill('2');
  await page.locator(FEEL).press('Tab');
  const floor = resolveFeelFloor('arc', 'pulse');
  await expect(page.locator(FEEL)).toHaveValue(String(floor));
  await expect(page.locator('#rf-props-degreesPerUnit-meaning')).toContainText(`${360 / floor} steps per revolution`);
  await expect(page.locator('#rf-props-degreesPerUnit-meaning')).not.toContainText(/floor/i);
  expect((await rotary(page)).props.degreesPerUnit).toBe(floor);
});

test('a multi-selection commit applies the Feel rule to each Rotary and tells the Author once', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    const rotary = (id, degreesPerUnit) => ({
      id, type: 'core.rotary', label: id, layout: { col: 1, row: 1, w: 4, h: 4 },
      binding: { readSimVar: 'apHdgBugValue' }, props: { degreesPerUnit }, style: {}
    });
    state.widgetDef.components.push(rotary('m1', 1), rotary('m2', 2), rotary('m3', 20));
    state.multiSelectedIds = new Set(['m1', 'm2', 'm3']);
    window.__studioApp.inspector.commitField({ __multiSelect: true }, 'props.writeMode', 'pulse');
  });

  const feel = (id) => page.evaluate((cid) => window.__studioApp.state.getComponent(cid).props.degreesPerUnit, id);
  expect(await feel('m1')).toBe(PULSE_FEEL);
  expect(await feel('m2')).toBe(resolveFeelFloor('arc', 'pulse'));
  expect(await feel('m3')).toBe(20);
  await expect(page.locator('.studio-toast.visible')).toContainText('2 Rotaries');
});

test('a Feel committed across a multi-selection is raised to the floor of each Rotary, and the toast says so once', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    const rotary = (id, props) => ({
      id, type: 'core.rotary', label: id, layout: { col: 1, row: 1, w: 4, h: 4 },
      binding: { readSimVar: 'apHdgBugValue' }, props, style: {}
    });
    state.widgetDef.components.push(
      rotary('f1', { writeMode: 'pulse', degreesPerUnit: 12 }),
      rotary('f2', { writeMode: 'pulse', gesture: 'scrub', degreesPerUnit: 12 }),
      rotary('f3', { degreesPerUnit: 12 })
    );
    state.multiSelectedIds = new Set(['f1', 'f2', 'f3']);
    window.__studioApp.inspector.commitField({ __multiSelect: true }, 'props.degreesPerUnit', 5);
  });

  const feel = (id) => page.evaluate((cid) => window.__studioApp.state.getComponent(cid).props.degreesPerUnit, id);
  expect(await feel('f1')).toBe(resolveFeelFloor('arc', 'pulse'));
  expect(await feel('f2')).toBe(resolveFeelFloor('scrub', 'pulse'));
  expect(await feel('f3')).toBe(5);
  await expect(page.locator('.studio-toast.visible')).toContainText('2 Rotaries');
  await expect(page.locator('.studio-toast.visible')).toContainText(/floor/i);
});
