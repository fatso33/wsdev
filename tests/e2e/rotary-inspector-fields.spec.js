import { test, expect } from '@playwright/test';
import { resolveFeelFloor } from '../../widgets/components/rotaryEngine.js';

/**
 * "Every property shipped here has a working Property Inspector control, with sensible
 * tier placement" (Rotary rebuild, ticket 02).
 *
 * Measured, not eyeballed, and measured via offsetParent rather than `.hidden` — the
 * tier attribute sits on a wrapper, not the field, so a `.hidden` check would miss it
 * (CLAUDE.md's Inspector-visibility gotcha).
 */

const SIMPLE = ['props.gesture', 'props.min', 'props.max', 'props.degreesPerUnit'];
const ADVANCED = [
  'props.sweepDegrees', 'props.startAngle', 'props.faceColor',
  'props.rimColor', 'props.rimWidth', 'props.indicatorColor', 'props.indicatorWidth'
];
const DEAD = ['props.circular', 'props.coarseStep', 'props.fineStep', 'props.pushLabel'];

const domId = (path) => `#rf-${path.replace(/\./g, '-')}`;

/** Visible in the "can the Author actually see and use it" sense. */
async function isUsable(page, path) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return 'missing';
    if (el.offsetParent === null) return 'hidden';
    return el.tagName.toLowerCase();
  }, domId(path));
}

async function selectRotary(page, mode) {
  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push({
      id: 'seed-rot',
      type: 'core.rotary',
      label: 'Seed Rotary',
      layout: { col: 1, row: 1, w: 4, h: 4 },
      binding: { readSimVar: 'apHdgBugValue', writeEvent: 'apHdgSet' },
      props: {},
      style: {}
    });
    state.selectComponent('seed-rot');
  });
  await page.locator(`[data-mode="${mode}"]`).click();
  // Type-specific props live on the Data tab.
  await page.getByTestId('inspector-tab-data').click();
}

test('every Rotary property has a real, usable control on the Full tier', async ({ page }) => {
  await selectRotary(page, 'full');
  for (const path of [...SIMPLE, ...ADVANCED]) {
    expect(await isUsable(page, path), path).toMatch(/^(input|select)$/);
  }
});

test('the range and feel are reachable without leaving the Build tier', async ({ page }) => {
  await selectRotary(page, 'build');
  for (const path of SIMPLE) {
    expect(await isUsable(page, path), path).toMatch(/^(input|select)$/);
  }
});

test('cosmetic properties stay out of the way until the Author asks for them', async ({ page }) => {
  await selectRotary(page, 'build');
  for (const path of ADVANCED) {
    expect(await isUsable(page, path), path).toBe('hidden');
  }
});

test('the deleted Rotary\'s properties are gone from the Inspector entirely', async ({ page }) => {
  await selectRotary(page, 'full');
  for (const path of DEAD) {
    expect(await isUsable(page, path), path).toBe('missing');
  }
});

// Ticket 03: "An Author can select Arc, Scrub or Tap per Rotary in the Property
// Inspector" — exercised through the real control, not by writing state directly.
test('an Author can choose Arc, Scrub or Tap on the Gesture field, and it defaults to Arc', async ({ page }) => {
  await selectRotary(page, 'build');
  const gestureField = page.locator('#rf-props-gesture');
  await expect(gestureField).toHaveValue('arc');

  const gestureOf = () => page.evaluate(() => {
    const comp = window.__studioApp.state.widgetDef.components.find((c) => c.id === 'seed-rot');
    return comp?.props?.gesture;
  });

  await gestureField.selectOption('scrub');
  expect(await gestureOf()).toBe('scrub');

  await gestureField.selectOption('tap');
  expect(await gestureOf()).toBe('tap');
});

// Ticket 04: "An Author can author a list of named positions ... editable in the
// Property Inspector" — the Positions rowListEditor only makes sense once Range Mode
// is Detented, and Min/Max only make sense while it isn't. Both are showWhen-gated on
// props.rangeMode; this exercises that the real render() path actually flips them,
// not just that PropertyRegistry declares the gate (see rotaryRegistry.test.js for the
// declaration-only coverage).
//
// Unlike the tier-based ADVANCED fields above (rendered but CSS-hidden, so
// isUsable() reports 'hidden'), an unauthored showWhen-false field is skipped from
// the DOM entirely by StudioInspector's render() (see its "A showWhen-false field is
// normally skipped entirely" comment) — so isUsable() reports 'missing' here instead.
//
// Positions is a rowListEditor, whose root is a <div> (a list of rows), not an
// <input>/<select> — hence the separate 'div' branch below rather than reusing the
// input|select regex the plain fields above use.
test('the Positions editor appears only in Detented, and Min/Max only outside it', async ({ page }) => {
  await selectRotary(page, 'build');
  const rangeModeField = page.locator('#rf-props-rangeMode');
  await expect(rangeModeField).toHaveValue('bounded');

  expect(await isUsable(page, 'props.min')).toMatch(/^(input|select)$/);
  expect(await isUsable(page, 'props.max')).toMatch(/^(input|select)$/);
  expect(await isUsable(page, 'props.positions')).toBe('missing');

  await rangeModeField.selectOption('detented');
  expect(await isUsable(page, 'props.positions')).toBe('div');
  expect(await isUsable(page, 'props.min')).toBe('missing');
  expect(await isUsable(page, 'props.max')).toBe('missing');

  await rangeModeField.selectOption('continuous');
  expect(await isUsable(page, 'props.positions')).toBe('missing');
  expect(await isUsable(page, 'props.min')).toMatch(/^(input|select)$/);
  expect(await isUsable(page, 'props.max')).toMatch(/^(input|select)$/);
});

// The Feel floor: Pulse Arc and Pulse Scrub cannot be configured finer than the engine can
// dispatch. The Inspector surfaces the floor as the Feel field's minimum and explains it in
// the tooltip; it does not enforce it. Neither number is written into this file: both come
// from the same shared function the engine calls, so a re-measurement changes one place.
const FEEL = '#rf-props-degreesPerUnit';

/** The Feel field's `min` attribute, or null when it has none. */
async function feelMinimum(page) {
  return page.evaluate((sel) => document.querySelector(sel)?.getAttribute('min') ?? null, FEEL);
}

/** The tooltip on the Feel field's label. */
async function feelTooltip(page) {
  return page.evaluate((sel) => document.querySelector(sel)?.closest('.prop-field')?.querySelector('label')?.title ?? '', FEEL);
}

async function setWriteMode(page, mode) {
  await page.locator('#rf-props-writeMode').selectOption(mode);
}

async function setGesture(page, gesture) {
  await page.locator('#rf-props-gesture').selectOption(gesture);
}

test('Pulse shows the Arc floor as the Feel minimum, even when no Gesture was ever set', async ({ page }) => {
  await selectRotary(page, 'build');
  expect(await feelMinimum(page)).toBeNull();
  await setWriteMode(page, 'pulse');
  // The seeded Rotary stores no props.gesture at all, yet is an Arc Rotary.
  expect(await page.evaluate(() => window.__studioApp.state.widgetDef.components.find((c) => c.id === 'seed-rot').props.gesture)).toBeUndefined();
  expect(await isUsable(page, 'props.degreesPerUnit')).toBe('input');
  expect(await feelMinimum(page)).toBe(String(resolveFeelFloor('arc', 'pulse')));
});

test('the Feel minimum follows the Gesture without reopening the panel', async ({ page }) => {
  await selectRotary(page, 'build');
  await setWriteMode(page, 'pulse');
  await setGesture(page, 'scrub');
  expect(await feelMinimum(page)).toBe(String(resolveFeelFloor('scrub', 'pulse')));
  await setGesture(page, 'arc');
  expect(await feelMinimum(page)).toBe(String(resolveFeelFloor('arc', 'pulse')));
});

test('Pulse Tap has no Feel minimum: one tap is one step', async ({ page }) => {
  await selectRotary(page, 'build');
  await setWriteMode(page, 'pulse');
  await setGesture(page, 'tap');
  expect(await isUsable(page, 'props.degreesPerUnit')).toBe('input');
  expect(await feelMinimum(page)).toBeNull();
});

test('Absolute has no Feel minimum in any Gesture', async ({ page }) => {
  await selectRotary(page, 'build');
  for (const gesture of ['arc', 'scrub', 'tap']) {
    await setGesture(page, gesture);
    expect(await feelMinimum(page), gesture).toBeNull();
  }
});

test('the Feel tooltip explains the Pulse floor, in the units the current Gesture uses', async ({ page }) => {
  await selectRotary(page, 'build');
  expect(await feelTooltip(page)).toMatch(/floor/i);

  await setWriteMode(page, 'pulse');
  expect(await feelTooltip(page)).toContain(`${resolveFeelFloor('arc', 'pulse')} degrees of arc`);
  await setGesture(page, 'scrub');
  expect(await feelTooltip(page)).toContain(`${resolveFeelFloor('scrub', 'pulse')} pixels of drag`);
});

test('a Feel typed below the floor is stored as typed, not clamped', async ({ page }) => {
  // Deliberate: an authored value is never silently overwritten. The engine floors it at
  // runtime, so the guarantee holds for a hand-written .fdwidget too; the Inspector only
  // shows the minimum. Clamping here would look like a fix and quietly rewrite Authoring.
  await selectRotary(page, 'build');
  await setWriteMode(page, 'pulse');
  const below = resolveFeelFloor('arc', 'pulse') / 2;
  await page.locator(FEEL).fill(String(below));
  await page.locator(FEEL).press('Tab');
  const stored = await page.evaluate(() => window.__studioApp.state.widgetDef.components.find((c) => c.id === 'seed-rot').props.degreesPerUnit);
  expect(stored).toBe(below);
  await expect(page.locator(FEEL)).toHaveValue(String(below));
});
