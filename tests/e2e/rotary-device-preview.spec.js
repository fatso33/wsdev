import { test, expect } from '@playwright/test';

/**
 * Ticket 02's first acceptance criterion, end to end inside Studio: an Author places a
 * Rotary, binds it, turns it in the live preview, and sees the knob rotate.
 *
 * Device View runs the REAL RotaryComponent against MockWidgetHost — a host with no
 * poll-period and no fast-tier support at all — so this doubles as the proof that the
 * Component degrades onto an authoring host instead of requiring the PWA's runtime.
 */

test('an Author can turn a placed Rotary in the live preview and see it rotate', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    // Studio opens on a sample widget whose components would otherwise sit on top of
    // the seeded knob and swallow the gesture.
    state.widgetDef.components.length = 0;
    state.widgetDef.components.push({
      id: 'seed-rot',
      type: 'core.rotary',
      label: 'Seed Rotary',
      layout: { col: 1, row: 1, w: 6, h: 6 },
      binding: { readSimVar: 'apHdgBugValue', writeEvent: 'apHdgSet' },
      // Heading-shaped, matching the bound var: a 0-100 knob bound to a heading
      // would sit pinned at its maximum on Studio's default telemetry and have
      // nowhere clockwise to go.
      props: { min: 0, max: 360, degreesPerUnit: 1, startAngle: 0, sweepDegrees: 360 },
      style: {}
    });
    state.selectComponent('seed-rot');
    // Deterministic starting point: Studio's default heading telemetry sits at the
    // top of this knob's range, where a clockwise turn has nowhere to go.
    state.updateSimTelemetry('apHdgBugValue', 90);
    state.setViewportMode('device');
  });

  const face = page.locator('.fd-rotary-face');
  await expect(face).toBeVisible();

  const angleNow = () => page.locator('[data-face-group="indicator"]').first()
    .getAttribute('transform')
    .then((t) => Number(t.match(/rotate\((-?[\d.]+)/)[1]));

  const before = await angleNow();

  const box = await face.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const r = Math.min(box.width, box.height) * 0.4;

  // Grab at 12 o'clock and sweep a quarter turn clockwise.
  await page.mouse.move(cx, cy - r);
  await page.mouse.down();
  for (let deg = 10; deg <= 90; deg += 10) {
    const rad = ((deg - 90) * Math.PI) / 180;
    await page.mouse.move(cx + r * Math.cos(rad), cy + r * Math.sin(rad));
  }
  await page.mouse.up();

  const after = await angleNow();
  expect(after).toBeGreaterThan(before + 10);
  expect(pageErrors).toEqual([]);
});
