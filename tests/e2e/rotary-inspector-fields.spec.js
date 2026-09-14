import { test, expect } from '@playwright/test';

/**
 * "Every property shipped here has a working Property Inspector control, with sensible
 * tier placement" (Rotary rebuild, ticket 02).
 *
 * Measured, not eyeballed, and measured via offsetParent rather than `.hidden` — the
 * tier attribute sits on a wrapper, not the field, so a `.hidden` check would miss it
 * (CLAUDE.md's Inspector-visibility gotcha).
 */

const SIMPLE = ['props.min', 'props.max', 'props.degreesPerUnit'];
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
