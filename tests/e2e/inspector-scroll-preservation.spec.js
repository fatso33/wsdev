import { test, expect } from '@playwright/test';

// Ticket 14: render() already preserves FOCUS across its innerHTML='' rebuild
// (see StudioInspector.js's render() header comment) but had no equivalent
// for scroll position — the freshly-rebuilt `.inspector-panel` always started
// at scrollTop 0. These tests exercise the real render() path end to end
// (real DOM, real getBoundingClientRect()), per this ticket's confirmed seam,
// rather than re-testing the pure anchoring math itself (see
// InspectorLogic.test.js's `computeScrollAnchorDelta` suite for that).
//
// Two tests below (content-height-change + fallback) trigger the state edit
// via `state.updateComponent()` directly instead of a literal mouse
// interaction on the field whose value changes. That's a deliberate choice,
// not a shortcut around real behavior: the field that stays FOCUSED
// throughout (and is what render()'s capture/restore code actually cares
// about) is interacted with for real (clicked into focus first); the
// `updateComponent` call stands in for "any other trigger that ends up
// calling render() while this field remains focused" — the exact category
// this fix targets — the same way existing multi-select/paste-style e2e
// specs in this file's siblings already drive state changes via
// `window.__studioApp.state` rather than only ever raw mouse/keyboard
// events.

// Both tests below drive focus/value-commit via direct DOM calls
// (el.focus()/dispatchEvent) instead of Locator.click()/.fill()/mouse.wheel()
// — Playwright's own actionability checks on those APIs scroll the target
// into view as a side effect, which would clobber the very scrollTop this
// test deliberately sets to simulate "already scrolled down" before the
// edit. The commit itself still goes through the real 'change'/'wheel'
// listeners StudioInspector.js actually wires up (renderPlainField's
// 'change' handler; the wheel-to-step handler gated on
// `document.activeElement === input`), so this exercises the real render()
// path end to end, same as every other test in this file.

test('typing into a text field while scrolled does not jump the panel back to the top', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push({
      id: 'scroll-typing-btn', type: 'core.button', props: { label: 'Seed' },
      style: { background: { type: 'gradient' } },
    });
    state.selectComponent('scroll-typing-btn');
  });

  await page.locator('[data-mode="full"]').click();
  await page.getByTestId('inspector-tab-style').click();

  const GRADIENT_SELECTOR = '[data-testid="style-field-background.gradient"] input';
  await page.waitForSelector(GRADIENT_SELECTOR);
  await page.evaluate((sel) => document.querySelector(sel).focus(), GRADIENT_SELECTOR);
  await expect(page.locator(GRADIENT_SELECTOR)).toBeFocused();

  const panel = page.locator('.inspector-panel.active');
  await panel.evaluate((el) => { el.scrollTop = 80; });
  const scrollBefore = await panel.evaluate((el) => el.scrollTop);
  expect(scrollBefore).toBeGreaterThan(0);

  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    el.value = 'linear-gradient(90deg, #000, #fff)';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, GRADIENT_SELECTOR);

  const scrollAfter = await panel.evaluate((el) => el.scrollTop);
  expect(scrollAfter).toBe(scrollBefore);
});

test('mousewheel-stepping a numeric field while scrolled does not jump the panel back to the top', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push({ id: 'scroll-wheel-btn', type: 'core.button', style: {}, props: { label: 'Seed' } });
    state.selectComponent('scroll-wheel-btn');
  });

  await page.locator('[data-mode="full"]').click();
  await page.getByTestId('inspector-tab-style').click();

  const OFFSET_X_SELECTOR = '[data-testid="style-field-offset.x"] input';
  await page.waitForSelector(OFFSET_X_SELECTOR);
  await page.evaluate((sel) => document.querySelector(sel).focus(), OFFSET_X_SELECTOR);
  await expect(page.locator(OFFSET_X_SELECTOR)).toBeFocused();

  const panel = page.locator('.inspector-panel.active');
  await panel.evaluate((el) => { el.scrollTop = 60; });
  const scrollBefore = await panel.evaluate((el) => el.scrollTop);
  expect(scrollBefore).toBeGreaterThan(0);

  const before = Number(await page.locator(OFFSET_X_SELECTOR).inputValue());
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }));
  }, OFFSET_X_SELECTOR);
  const after = Number(await page.locator(OFFSET_X_SELECTOR).inputValue());
  expect(after).toBe(before + 1); // sanity: the step-and-render actually happened

  const scrollAfter = await panel.evaluate((el) => el.scrollTop);
  expect(scrollAfter).toBe(scrollBefore);
});

test('scroll position (on-screen) survives a rebuild that changes content height above the focused field', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push({
      id: 'scroll-height-gauge', type: 'core.gauge', style: {},
      props: {
        transform: 'rotate', // arc.* fields (many) start hidden
        pivot: { x: 50, y: 50 },
        compose: { transform: 'translate', axis: 'y', stateVar: '', valueRange: [0, 1], outputRange: [0, 1], clamp: true },
      },
    });
    state.selectComponent('scroll-height-gauge');
  });

  await page.locator('[data-mode="full"]').click();
  await page.getByTestId('inspector-tab-data').click();

  // props.compose.axis sits below the main Gauge fields (including the
  // arc.* group, hidden while transform !== 'arc') — a real field the user
  // could be mid-edit on while something ABOVE it changes shape.
  const axisField = page.locator('#rf-props-compose-axis');
  await expect(axisField).toBeVisible();
  await axisField.click();
  await expect(axisField).toBeFocused();

  const panel = page.locator('.inspector-panel.active');
  await panel.evaluate((el) => { el.scrollTop = 50; });
  const rectBefore = await axisField.evaluate((el) => el.getBoundingClientRect().top);

  // Switching to 'arc' reveals ~8 previously-absent arc.* fields ABOVE the
  // compose section, substantially growing content height above axisField.
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    const comp = state.getComponent('scroll-height-gauge');
    state.updateComponent('scroll-height-gauge', { props: { ...comp.props, transform: 'arc' } });
  });

  const stillFocusedId = await page.evaluate(() => document.activeElement.id);
  expect(stillFocusedId).toBe('rf-props-compose-axis');

  const scrollAfter = await panel.evaluate((el) => el.scrollTop);
  const rectAfter = await page.locator('#rf-props-compose-axis').evaluate((el) => el.getBoundingClientRect().top);

  // The raw scrollTop value is NOT expected to match (content grew above the
  // field) — what must hold is the field's own on-screen position.
  expect(scrollAfter).not.toBe(50);
  expect(rectAfter).toBe(rectBefore);
});

test('falls back to restoring the raw scrollTop when the previously-focused field disappears from the rebuild', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push({
      id: 'scroll-fallback-gauge', type: 'core.gauge', style: {},
      props: { transform: 'arc', arc: { radius: 40 } },
    });
    state.selectComponent('scroll-fallback-gauge');
  });

  await page.locator('[data-mode="full"]').click();
  await page.getByTestId('inspector-tab-data').click();

  const radiusField = page.locator('#rf-props-arc-radius');
  await expect(radiusField).toBeVisible();
  await radiusField.click();
  await expect(radiusField).toBeFocused();

  const panel = page.locator('.inspector-panel.active');
  await panel.evaluate((el) => { el.scrollTop = 150; });
  const scrollBefore = await panel.evaluate((el) => el.scrollTop);

  // Switching transform away from 'arc' removes arc.radius entirely (its
  // showWhen goes false and it was never authored non-default) — nothing
  // left to anchor to after the rebuild.
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    const comp = state.getComponent('scroll-fallback-gauge');
    state.updateComponent('scroll-fallback-gauge', { props: { ...comp.props, transform: 'rotate' } });
  });

  await expect(page.locator('#rf-props-arc-radius')).toHaveCount(0);
  const scrollAfter = await panel.evaluate((el) => el.scrollTop);
  expect(scrollAfter).toBe(scrollBefore);
});

test('editing a common field on a multi-selection while scrolled does not jump the panel back to the top', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push(
      { id: 'scroll-ms-1', type: 'core.button', style: {}, props: { label: 'One' } },
      { id: 'scroll-ms-2', type: 'core.button', style: {}, props: { label: 'Two' } },
    );
    state.selectComponent('scroll-ms-1');
    state.selectComponent('scroll-ms-2', true);
  });

  const WIDTH_SELECTOR = '[data-testid="style-field-border.width"] input';
  await page.waitForSelector(WIDTH_SELECTOR);
  await page.evaluate((sel) => document.querySelector(sel).focus(), WIDTH_SELECTOR);
  await expect(page.locator(WIDTH_SELECTOR)).toBeFocused();

  const panel = page.locator('.inspector-panel.active');
  await panel.evaluate((el) => { el.scrollTop = 40; });
  const scrollBefore = await panel.evaluate((el) => el.scrollTop);
  expect(scrollBefore).toBeGreaterThan(0);

  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    el.value = '5';
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, WIDTH_SELECTOR);

  const result = await page.evaluate(() => {
    const state = window.__studioApp.state;
    return [
      state.getComponent('scroll-ms-1').style.border?.width,
      state.getComponent('scroll-ms-2').style.border?.width,
    ];
  });
  expect(result).toEqual([5, 5]); // sanity: the bulk edit actually committed

  const scrollAfter = await panel.evaluate((el) => el.scrollTop);
  expect(scrollAfter).toBe(scrollBefore);
});

// Rule-chip drag-and-drop reordering is a documented exception, not a gap in
// this fix: the chip buttons carry no `id` (only `data-rule-chip`), so they
// never satisfy render()'s pre-existing `focusId` check either — same as
// focus itself was never restored to them before this ticket. Per this
// ticket's own scope ("if...no focused element at all, leave today's
// behavior"), this is intentionally the no-op case; the assertion here is
// just that reordering while scrolled still works correctly, not that its
// scroll position is anchored.
test('drag-to-reorder a Rule action still reorders correctly while the panel is scrolled', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push({
      id: 'scroll-drag-btn', type: 'core.button', props: { label: 'Seed' },
      style: {
        typography: { color: '#111111' },
        rules: [
          { when: { state: 'fuel', operator: 'lt', value: 10 }, style: { typography: { color: '#ff0000' } } },
          { when: { state: 'fuel', operator: 'gt', value: 90 }, style: { typography: { color: '#00ff00' } } },
        ],
      },
    });
    state.selectComponent('scroll-drag-btn');
  });

  await page.getByTestId('inspector-tab-style').click();
  const chip0 = page.locator('[data-rule-chip="0"]');
  const chip1 = page.locator('[data-rule-chip="1"]');

  const panel = page.locator('.inspector-panel.active');
  await panel.evaluate((el) => { el.scrollTop = 30; });

  await chip0.dragTo(chip1);

  const rules = await page.evaluate(() => {
    const state = window.__studioApp.state;
    return state.getComponent('scroll-drag-btn').style.rules.map((r) => r.when.operator);
  });
  expect(rules).toEqual(['gt', 'lt']);
});
