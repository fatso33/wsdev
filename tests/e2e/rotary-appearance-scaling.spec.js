import { test, expect } from '@playwright/test';

/**
 * "Everything scales correctly with the layout space rather than assuming a size",
 * measured in the real renderer (Device View runs the real RotaryComponent) with every
 * appearance group switched on: the Face stays round, tracks the shorter side of its
 * layout box, keeps every proportion at any size, and nothing is drawn outside its box.
 */

const EVERYTHING = {
  min: 0, max: 100,
  fillStyle: 'conic', faceColor: '#e2e8f0', faceColor2: '#475569', innerShadow: 5,
  knurlStyle: 'teeth', knurlCount: 36,
  indicatorShape: 'triangle', indicatorGlow: 3,
  capDiameter: 26, capContent: 'label', capLabel: 'HDG',
  scaleMajorDivisions: 5, scaleMinorDivisions: 4, scaleLabels: true,
  dropShadow: 6
};

async function placeRotaries(page, layouts) {
  await page.goto('/');
  await page.evaluate(({ props, layouts: boxes }) => {
    const state = window.__studioApp.state;
    state.widgetDef.components.length = 0;
    boxes.forEach((layout, i) => {
      state.widgetDef.components.push({
        id: `rot-${i}`, type: 'core.rotary', label: `Rotary ${i}`, layout,
        binding: { readSimVar: 'apHdgBugValue', writeEvent: 'apHdgSet' },
        props, style: {}
      });
    });
    state.setViewportMode('device');
  }, { props: EVERYTHING, layouts });
  await expect(page.locator('.fd-rotary-face')).toHaveCount(layouts.length);
}

/** The Face wrapper's box, the SVG's box, and where each drawn group sits inside the SVG, for one Rotary. */
const measure = (locator) => locator.evaluate((face) => {
  const svg = face.querySelector('svg').getBoundingClientRect();
  const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x - svg.x, y: r.y - svg.y, w: r.width, h: r.height }; };
  const groups = {};
  face.querySelectorAll('[data-face-group]').forEach((el) => { groups[el.dataset.faceGroup] = box(el); });
  const parts = [...face.querySelectorAll('[data-face-group] *, [data-face-group]')].map(box);
  const host = face.parentElement.getBoundingClientRect();
  return { host: { w: host.width, h: host.height }, face: { w: face.getBoundingClientRect().width, h: face.getBoundingClientRect().height }, svg: { w: svg.width, h: svg.height }, groups, parts };
});

test('the Face is square and as large as the shorter side of its layout box, with every group on', async ({ page }) => {
  await placeRotaries(page, [{ col: 1, row: 1, w: 8, h: 4 }]);
  const m = await measure(page.locator('.fd-rotary-face').first());
  expect(m.face.w).toBeCloseTo(m.face.h, 0);
  expect(m.svg.w).toBeCloseTo(m.svg.h, 0);
  expect(m.face.w).toBeCloseTo(Math.min(m.host.w, m.host.h), 0);
  expect(m.host.w).toBeGreaterThan(m.host.h * 1.5);
});

test('nothing is drawn outside the Face\'s own box, shadow, scale labels and all', async ({ page }) => {
  await placeRotaries(page, [{ col: 1, row: 1, w: 6, h: 6 }]);
  const m = await measure(page.locator('.fd-rotary-face').first());
  const tolerance = m.svg.w * 0.012;
  for (const part of m.parts) {
    expect(part.x).toBeGreaterThanOrEqual(-tolerance);
    expect(part.y).toBeGreaterThanOrEqual(-tolerance);
    expect(part.x + part.w).toBeLessThanOrEqual(m.svg.w + tolerance);
    expect(part.y + part.h).toBeLessThanOrEqual(m.svg.h + tolerance);
  }
});

test('every group keeps the same proportions at a small and at a large size', async ({ page }) => {
  await placeRotaries(page, [{ col: 1, row: 1, w: 3, h: 3 }, { col: 5, row: 1, w: 7, h: 7 }]);
  const [small, large] = await Promise.all([0, 1].map((i) => measure(page.locator('.fd-rotary-face').nth(i))));
  expect(large.svg.w).toBeGreaterThan(small.svg.w * 1.8);
  for (const group of Object.keys(small.groups)) {
    const relative = (m) => ({
      x: m.groups[group].x / m.svg.w, y: m.groups[group].y / m.svg.w,
      w: m.groups[group].w / m.svg.w, h: m.groups[group].h / m.svg.w
    });
    const [a, b] = [relative(small), relative(large)];
    // A text box carries a couple of pixels of fixed slack, which is a larger share of a
    // small Face; the scale is the only group that draws text.
    const tolerance = group === 'scale' ? 0.05 : 0.02;
    for (const key of ['x', 'y', 'w', 'h']) expect(Math.abs(a[key] - b[key]), `${group}.${key}`).toBeLessThan(tolerance);
  }
});
