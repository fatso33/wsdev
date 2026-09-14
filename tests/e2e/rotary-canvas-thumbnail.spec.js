import { test, expect } from '@playwright/test';

/**
 * The canvas thumbnail for core.rotary (Rotary rebuild, ticket 02).
 *
 * The canvas draws its own static mock of each component rather than running the real
 * renderer, so rebuilding the Component does NOT update this — it's a separate visual
 * definition that has to be brought along by hand, which is exactly why it gets its
 * own test.
 */

/** Drops a core.rotary onto the canvas via the same debug global the other specs use. */
async function seedRotary(page, props) {
  await page.evaluate((p) => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push({
      id: 'seed-rot',
      type: 'core.rotary',
      label: 'Seed Rotary',
      layout: { col: 1, row: 1, w: 4, h: 4 },
      binding: { readSimVar: 'apHdgBugValue', writeEvent: 'apHdgSet' },
      props: p,
      style: {}
    });
    state.selectComponent('seed-rot');
  }, props);
}

const thumb = (page) => page.locator('[data-comp-id="seed-rot"]');

test('the thumbnail draws a knob with a rim and a direction indicator', async ({ page }) => {
  await page.goto('/');
  await seedRotary(page, { min: 0, max: 100, startAngle: -135, sweepDegrees: 270 });

  await expect(thumb(page).locator('[data-face-group="rim"]')).toHaveCount(1);
  await expect(thumb(page).locator('[data-face-group="indicator"]')).toHaveCount(1);
});

test('the thumbnail reflects the authored knob appearance', async ({ page }) => {
  await page.goto('/');
  await seedRotary(page, { min: 0, max: 100, rimColor: '#ff8800', indicatorColor: '#00e5ff' });

  await expect(thumb(page).locator('[data-face-group="rim"]')).toHaveAttribute('stroke', '#ff8800');
  await expect(thumb(page).locator('[data-face-group="indicator"]')).toHaveAttribute('stroke', '#00e5ff');
});

test('the thumbnail points the indicator where the authored range says it should rest', async ({ page }) => {
  await page.goto('/');
  // A knob whose start angle is straight up must not draw its indicator at -135.
  await seedRotary(page, { min: 0, max: 100, startAngle: 0, sweepDegrees: 270 });
  await expect(thumb(page).locator('[data-face-group="indicator"]')).toHaveAttribute('transform', /rotate\(0 /);
});

test('a template Rotary carrying only the deleted props still draws, degrading to defaults', async ({ page }) => {
  await page.goto('/');
  // Exactly what StudioTemplates' rot_hdg still declares — the ticket 02 regression
  // guard: unrecognised fields degrade rather than crash. (Reworking those templates
  // into good examples is ticket 15.)
  await seedRotary(page, { coarseStep: 10, fineStep: 1, circular: true });

  await expect(thumb(page).locator('[data-face-group="rim"]')).toHaveCount(1);
  await expect(thumb(page).locator('[data-face-group="indicator"]')).toHaveCount(1);
});
