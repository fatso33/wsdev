import { test, expect } from '@playwright/test';

/**
 * The Rotary's six appearance groups in the Property Inspector: every control works and
 * commits, headline properties sit on the Build tier and detail on Full, a property that
 * does not apply is hidden, and one that has been set never disappears.
 *
 * Visibility is measured through offsetParent, never the `hidden` attribute: the tier
 * attribute sits on a wrapper, not on the field (CLAUDE.md's Inspector-visibility gotcha).
 */

const GROUPS = ['Face', 'Knurling', 'Indicator', 'Cap', 'Scale', 'Depth'];
const domId = (path) => `#rf-${path.replace(/\./g, '-')}`;

async function seedRotary(page, mode, props = {}) {
  await page.goto('/');
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
  await page.locator(`[data-mode="${mode}"]`).click();
  await page.getByTestId('inspector-tab-data').click();
}

/** 'missing' (not in the DOM), 'hidden' (in the DOM but not laid out), or the element's tag. */
const usable = (page, path) => page.evaluate((sel) => {
  const el = document.querySelector(sel);
  if (!el) return 'missing';
  return el.offsetParent === null ? 'hidden' : el.tagName.toLowerCase();
}, domId(path));

const storedProp = (page, key) => page.evaluate(
  (k) => window.__studioApp.state.widgetDef.components.find((c) => c.id === 'seed-rot').props[k],
  key
);

/** Group headings currently laid out in the Data tab. */
const visibleHeadings = (page) => page.evaluate(
  () => [...document.querySelectorAll('.prop-section-subtitle')].filter((el) => el.offsetParent !== null).map((el) => el.textContent.trim())
);

test('each of the six groups has a heading, and the Full tier shows all of them', async ({ page }) => {
  await seedRotary(page, 'full');
  const headings = await visibleHeadings(page);
  for (const group of GROUPS) expect(headings, group).toContain(group);
});

test('the Build tier still reaches every group, through one headline property each', async ({ page }) => {
  await seedRotary(page, 'build');
  const headings = await visibleHeadings(page);
  for (const group of GROUPS) expect(headings, group).toContain(group);
  for (const path of ['props.fillStyle', 'props.faceColor', 'props.knurlStyle', 'props.indicatorShape', 'props.indicatorColor', 'props.capDiameter', 'props.scaleMajorDivisions', 'props.dropShadow']) {
    expect(await usable(page, path), path).toMatch(/^(input|select)$/);
  }
});

test('the Build tier hides the detail of each group', async ({ page }) => {
  await seedRotary(page, 'build');
  for (const path of ['props.rimColor', 'props.rimWidth', 'props.innerShadow', 'props.indicatorWidth', 'props.indicatorLength', 'props.indicatorGlow']) {
    expect(await usable(page, path), path).toBe('hidden');
  }
});

test('the Guided tier shows no appearance heading floating over nothing', async ({ page }) => {
  await seedRotary(page, 'guided');
  const headings = await visibleHeadings(page);
  for (const group of GROUPS) expect(headings, group).not.toContain(group);
});

test('a fresh Rotary shows none of the properties that only refine a feature it is not using', async ({ page }) => {
  await seedRotary(page, 'full');
  for (const path of [
    'props.faceColor2', 'props.knurlCount', 'props.knurlDepth', 'props.capColor', 'props.capContent', 'props.capLabel', 'props.capIcon',
    'props.scaleMinorDivisions', 'props.scaleTickLength', 'props.scaleLabels', 'props.scaleSpan', 'props.scaleColor'
  ]) {
    expect(await usable(page, path), path).toBe('missing');
  }
});

test('choosing a blended fill reveals the second colour, and going back to Solid hides it again', async ({ page }) => {
  await seedRotary(page, 'full');
  await page.locator(domId('props.fillStyle')).selectOption('conic');
  expect(await storedProp(page, 'fillStyle')).toBe('conic');
  expect(await usable(page, 'props.faceColor2')).toBe('input');
  await page.locator(domId('props.fillStyle')).selectOption('solid');
  expect(await usable(page, 'props.faceColor2')).toBe('missing');
});

test('choosing a knurl style reveals its count and depth', async ({ page }) => {
  await seedRotary(page, 'full');
  await page.locator(domId('props.knurlStyle')).selectOption('teeth');
  expect(await usable(page, 'props.knurlCount')).toBe('input');
  expect(await usable(page, 'props.knurlDepth')).toBe('input');
});

test('a pointer length is offered for a line and hidden for a dot', async ({ page }) => {
  await seedRotary(page, 'full');
  expect(await usable(page, 'props.indicatorLength')).toBe('input');
  await page.locator(domId('props.indicatorShape')).selectOption('dot');
  expect(await usable(page, 'props.indicatorLength')).toBe('missing');
});

test('giving the Cap a diameter reveals its colour and content, and choosing a label or icon reveals the matching field', async ({ page }) => {
  await seedRotary(page, 'full');
  await page.locator(domId('props.capDiameter')).fill('24');
  await page.locator(domId('props.capDiameter')).press('Tab');
  expect(await usable(page, 'props.capColor')).toBe('input');
  expect(await usable(page, 'props.capContent')).toBe('select');
  expect(await usable(page, 'props.capLabel')).toBe('missing');

  await page.locator(domId('props.capContent')).selectOption('label');
  expect(await usable(page, 'props.capLabel')).toBe('input');
  expect(await usable(page, 'props.capIcon')).toBe('missing');

  await page.locator(domId('props.capContent')).selectOption('icon');
  expect(await usable(page, 'props.capIcon')).toBe('input');
  expect(await usable(page, 'props.capLabel')).toBe('missing');
});

test('giving the scale divisions reveals every scale detail', async ({ page }) => {
  await seedRotary(page, 'full');
  await page.locator(domId('props.scaleMajorDivisions')).fill('5');
  await page.locator(domId('props.scaleMajorDivisions')).press('Tab');
  for (const path of ['props.scaleMinorDivisions', 'props.scaleTickLength', 'props.scaleLabels', 'props.scaleSpan', 'props.scaleColor']) {
    expect(await usable(page, path), path).toMatch(/^(input|select)$/);
  }
});

test('a property that has been set stays visible after it stops applying, at every tier, with a way to clear it', async ({ page }) => {
  await seedRotary(page, 'build', { knurlStyle: 'none', knurlCount: 40, capDiameter: 0, capLabel: 'HDG', capContent: 'none' });
  // Both are set to a real value and neither applies to the configuration they sit in.
  expect(await usable(page, 'props.knurlCount')).toBe('input');
  expect(await usable(page, 'props.capLabel')).toBe('input');
  await expect(page.locator('.prop-showwhen-note', { hasText: 'still set to "40"' })).toBeVisible();

  await page.locator('.prop-showwhen-note', { hasText: 'still set to "40"' }).getByRole('button', { name: 'Clear' }).click();
  expect(await storedProp(page, 'knurlCount')).toBeUndefined();
  expect(await usable(page, 'props.knurlCount')).toBe('missing');
});

test('every appearance control commits what the Author enters', async ({ page }) => {
  await seedRotary(page, 'full', { fillStyle: 'linear', knurlStyle: 'grooves', capDiameter: 20, capContent: 'label', scaleMajorDivisions: 4 });
  const setNumber = async (key, value) => {
    await page.locator(domId(`props.${key}`)).fill(String(value));
    await page.locator(domId(`props.${key}`)).press('Tab');
    expect(await storedProp(page, key), key).toBe(value);
  };
  for (const [key, value] of Object.entries({
    innerShadow: 4, rimWidth: 8, knurlCount: 30, knurlDepth: 6, indicatorWidth: 3, indicatorLength: 20, indicatorGlow: 5,
    capDiameter: 26, scaleMajorDivisions: 8, scaleMinorDivisions: 4, scaleTickLength: 9, scaleSpan: 300, dropShadow: 7
  })) await setNumber(key, value);

  for (const [key, value] of Object.entries({ fillStyle: 'radial', knurlStyle: 'dots', indicatorShape: 'triangle', capContent: 'icon' })) {
    await page.locator(domId(`props.${key}`)).selectOption(value);
    expect(await storedProp(page, key), key).toBe(value);
  }

  await page.locator(domId('props.scaleLabels')).check();
  expect(await storedProp(page, 'scaleLabels')).toBe(true);

  await page.locator(domId('props.capIcon')).fill('★');
  await page.locator(domId('props.capIcon')).press('Tab');
  expect(await storedProp(page, 'capIcon')).toBe('★');

  await page.locator(domId('props.faceColor2')).fill('#334455');
  await page.locator(domId('props.faceColor2')).press('Tab');
  expect(await storedProp(page, 'faceColor2')).toBe('#334455');
});

test('editing an appearance property repaints the canvas knob', async ({ page }) => {
  await seedRotary(page, 'full');
  await page.locator(domId('props.knurlStyle')).selectOption('grooves');
  await expect(page.locator('[data-comp-id="seed-rot"] [data-face-group="knurling"]')).toHaveCount(1);
  await page.locator(domId('props.capDiameter')).fill('30');
  await page.locator(domId('props.capDiameter')).press('Tab');
  await expect(page.locator('[data-comp-id="seed-rot"] [data-face-group="cap"]')).toHaveCount(1);
});

test('the Dragging state is offered for styling on a Rotary', async ({ page }) => {
  await seedRotary(page, 'full');
  await page.getByTestId('inspector-tab-style').click();
  await expect(page.getByText('Dragging', { exact: false }).first()).toBeVisible();
});

test('no control type the appearance groups need is missing its renderer', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await seedRotary(page, 'full', {
    fillStyle: 'conic', knurlStyle: 'teeth', capDiameter: 20, capContent: 'icon', scaleMajorDivisions: 3
  });
  expect(errors.filter((e) => /No FIELD_RENDERERS entry/.test(e))).toEqual([]);
  expect(await usable(page, 'props.capIcon')).toBe('input');
});
