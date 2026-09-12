import { test, expect } from '@playwright/test';

// Ticket 11: the multi-select Inspector now reuses the SAME General/Style/
// Data/Events tab shell as single-select, instead of a separate bespoke
// bulk-edit view.

test('multi-selecting 2+ components shows the unified tab shell with General/Data/Events disabled', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push(
      { id: 'ms-btn-1', type: 'core.button', style: {}, props: { label: 'One' } },
      { id: 'ms-btn-2', type: 'core.button', style: {}, props: { label: 'Two' } },
    );
    state.selectComponent('ms-btn-1');
    state.selectComponent('ms-btn-2', true);
  });

  // Same 4-tab shell as single-select is present...
  await expect(page.getByTestId('inspector-tab-general')).toBeVisible();
  await expect(page.getByTestId('inspector-tab-style')).toBeVisible();
  await expect(page.getByTestId('inspector-tab-data')).toBeVisible();
  await expect(page.getByTestId('inspector-tab-events')).toBeVisible();

  // ...but General/Data/Events are disabled, and Style is active by default.
  await expect(page.getByTestId('inspector-tab-general')).toBeDisabled();
  await expect(page.getByTestId('inspector-tab-data')).toBeDisabled();
  await expect(page.getByTestId('inspector-tab-events')).toBeDisabled();
  await expect(page.getByTestId('inspector-tab-style')).toBeEnabled();
  await expect(page.getByTestId('inspector-panel-style')).toBeVisible();
  await expect(page.getByTestId('inspector-panel-general')).toBeHidden();
});

test('multi-selecting two components with the same alt-state name shows a State sub-tab', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push(
      { id: 'ms-btn-a', type: 'core.button', style: {}, props: { label: 'A' } },
      { id: 'ms-btn-b', type: 'core.button', style: {}, props: { label: 'B' } },
    );
    state.selectComponent('ms-btn-a');
    state.selectComponent('ms-btn-b', true);
  });

  await expect(page.getByTestId('style-state-tab-pressed')).toBeVisible();
});

test('multi-selecting a mixed-type selection with no shared alt-state hides the State sub-tab', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push(
      { id: 'ms-mix-btn', type: 'core.button', style: {}, props: { label: 'Mix' } },
      { id: 'ms-mix-div', type: 'core.divider', style: {} },
    );
    state.selectComponent('ms-mix-btn');
    state.selectComponent('ms-mix-div', true);
  });

  await expect(page.getByTestId('inspector-panel-style')).not.toContainText('Pressed');
  await expect(page.locator('[data-testid^="style-state-tab-"]')).toHaveCount(0);
});

test('editing a common style field on a multi-selection applies to every selected component', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push(
      { id: 'ms-edit-1', type: 'core.button', style: {}, props: { label: 'One' } },
      { id: 'ms-edit-2', type: 'core.button', style: {}, props: { label: 'Two' } },
    );
    state.selectComponent('ms-edit-1');
    state.selectComponent('ms-edit-2', true);
  });

  // style.border.width is a Guided-tier field (guided:true in the registry),
  // so it's visible without first switching the UI mode to Build/Full.
  const widthField = page.locator('[data-testid="style-field-border.width"] input');
  await widthField.fill('5');
  await widthField.dispatchEvent('change');

  const result = await page.evaluate(() => {
    const state = window.__studioApp.state;
    return [
      state.getComponent('ms-edit-1').style.border?.width,
      state.getComponent('ms-edit-2').style.border?.width,
    ];
  });
  expect(result).toEqual([5, 5]);
});

// Ticket 04 + Ticket 11: a state-scoped copy (from a single component's
// Pressed sub-tab) pastes onto every component in a multi-selection's own
// Pressed sub-tab, applied consistently to all of them.
test('pasting a state-scoped copy onto a multi-selection applies it to every selected component', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push(
      { id: 'ms-paste-src', type: 'core.button', style: { states: { pressed: { border: { color: '#ff00ff' } } } }, props: { label: 'Src' } },
      { id: 'ms-paste-1', type: 'core.button', style: {}, props: { label: 'One' } },
      { id: 'ms-paste-2', type: 'core.button', style: {}, props: { label: 'Two' } },
    );
    state.selectComponent('ms-paste-src');
  });

  await page.getByTestId('inspector-tab-style').click();
  await page.getByTestId('style-state-tab-pressed').click();
  await page.getByRole('button', { name: 'Copy Style' }).click();

  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.selectComponent('ms-paste-1');
    state.selectComponent('ms-paste-2', true);
  });

  await page.getByTestId('style-state-tab-pressed').click();
  await page.getByRole('button', { name: /Paste .* Style onto All/ }).click();

  const result = await page.evaluate(() => {
    const state = window.__studioApp.state;
    return [
      state.getComponent('ms-paste-1').style.states?.pressed?.border?.color,
      state.getComponent('ms-paste-2').style.states?.pressed?.border?.color,
    ];
  });
  expect(result).toEqual(['#ff00ff', '#ff00ff']);
});

// Review fix (ticket 11, finding #1): the Style tab button used to keep its
// click listener wired even while it's the multi-select shell's forced-active
// tab, so a click on it (a no-op visually, since it's already active) still
// wrote 'style' into the persistent this.activeInspectorTab. Deselecting back
// to single-select then unexpectedly reopened the Inspector on Style instead
// of whatever tab the prior single selection actually had active.
test('deselecting a multi-selection back to single-select preserves the previously-active tab', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push(
      { id: 'ms-tab-1', type: 'core.button', style: {}, props: { label: 'One' } },
      { id: 'ms-tab-2', type: 'core.button', style: {}, props: { label: 'Two' } },
    );
    state.selectComponent('ms-tab-1');
  });

  // Single-select ms-tab-1 and switch its active tab to Events.
  await page.getByTestId('inspector-tab-events').click();
  await expect(page.getByTestId('inspector-panel-events')).toBeVisible();

  // Multi-select ms-tab-1 + ms-tab-2 — Style is forced active.
  await page.evaluate(() => {
    window.__studioApp.state.selectComponent('ms-tab-2', true);
  });
  await expect(page.getByTestId('inspector-panel-style')).toBeVisible();

  // Clicking the (already-active, forced) Style tab button must stay a no-op.
  await page.getByTestId('inspector-tab-style').click();

  // Deselect back to a single selection of ms-tab-1.
  await page.evaluate(() => {
    window.__studioApp.state.selectComponent('ms-tab-1');
  });

  await expect(page.getByTestId('inspector-panel-events')).toBeVisible();
  await expect(page.getByTestId('inspector-panel-style')).toBeHidden();
});

// Ticket 13 correction pass: copying a Rule tab's style (single-select), then
// multi-selecting components on the Normal sub-tab, must disable "Paste
// Style" the same way a state-scoped copy already does — otherwise the
// button stays clickable, pasteStyleToSelection() silently no-ops (guarded
// against bulk-replacing each component's WHOLE base style with just one
// rule's fragment), and a false "Pasted style onto N components" toast fires.
test('pasting a rule-scoped copy onto a multi-selection\'s Normal tab is disabled, not a silently-no-op success toast', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push(
      {
        id: 'ms-rule-src', type: 'core.button', props: { label: 'Src' },
        style: {
          typography: { color: '#111111' },
          rules: [{ when: { state: 'fuel', operator: 'lt', value: 10 }, style: { typography: { color: '#ff0000' } } }],
        },
      },
      { id: 'ms-rule-1', type: 'core.button', style: { typography: { color: '#222222' } }, props: { label: 'One' } },
      { id: 'ms-rule-2', type: 'core.button', style: { typography: { color: '#333333' } }, props: { label: 'Two' } },
    );
    state.selectComponent('ms-rule-src');
  });

  await page.getByTestId('inspector-tab-style').click();
  await page.locator('[data-rule-chip="0"]').click();
  await page.locator('#c-style-copy').click();

  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.selectComponent('ms-rule-1');
    state.selectComponent('ms-rule-2', true);
  });

  // Normal sub-tab is the multi-select Style tab's default.
  await expect(page.locator('#ms-style-paste')).toBeDisabled();

  // Bypass the (correctly) disabled button to confirm the underlying state
  // method is also a genuine no-op, not just UI-gated.
  const result = await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.pasteStyleToSelection();
    return [
      state.getComponent('ms-rule-1').style.typography.color,
      state.getComponent('ms-rule-2').style.typography.color,
    ];
  });
  expect(result).toEqual(['#222222', '#333333']);
});

// Review fix (ticket 11, finding #2): the Base-tab hand-coded color fields
// (Text/Stroke/Glow/Border/Border Glow/Background Color) and the rest of the
// Background section skipped buildFieldWrap() entirely and never got a
// `style-field-*` testid, so applyMultiSelectFieldAvailability()'s selector
// could never reach them to disable them.
test('hand-coded Base-tab color/background fields carry style-field testids and merge to the common value', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push(
      { id: 'ms-color-1', type: 'core.button', style: { typography: { color: '#111111' }, border: { color: '#222222' }, background: { type: 'color', color: '#333333' } }, props: { label: 'One' } },
      { id: 'ms-color-2', type: 'core.button', style: { typography: { color: '#111111' }, border: { color: '#444444' }, background: { type: 'color', color: '#333333' } }, props: { label: 'Two' } },
    );
    state.selectComponent('ms-color-1');
    state.selectComponent('ms-color-2', true);
  });

  // All six hand-coded fields are discoverable by the same testid convention
  // the generic field engine already uses on the state/rule tab.
  await expect(page.getByTestId('style-field-typography.color')).toBeVisible();
  await expect(page.getByTestId('style-field-typography.stroke.color')).toBeVisible();
  await expect(page.getByTestId('style-field-typography.glow.color')).toBeVisible();
  await expect(page.getByTestId('style-field-border.color')).toBeVisible();
  await expect(page.getByTestId('style-field-border.glow.color')).toBeVisible();
  await expect(page.getByTestId('style-field-background.color')).toBeVisible();
  await expect(page.getByTestId('style-field-background.type')).toBeVisible();

  // typography.color agrees across both selected components -> shows the
  // common value. border.color disagrees -> falls back to the field's
  // default rather than either component's real value ("common-value-or-
  // blank" merge behavior, same as the generic engine's proxy merge).
  await expect(page.locator('#c-typo-color')).toHaveValue('#111111');
  await expect(page.locator('#c-border-color')).toHaveValue('#273344');

  // Extending applyMultiSelectFieldAvailability() with a restricted
  // availability (as a future appliesTo-restricted style field would produce)
  // now reaches these hand-coded fields too, since they carry the same
  // [data-testid^="style-field-"] markup the method already selects on.
  const disabledCount = await page.evaluate(() => {
    const inspector = window.__studioApp.inspector;
    const mount = document.querySelector('[data-testid="inspector-panel-style"]');
    inspector.applyMultiSelectFieldAvailability(mount, { enabledFieldPaths: [] });
    return mount.querySelectorAll('#c-typo-color:disabled, #c-border-color:disabled, #c-bg-color:disabled').length;
  });
  expect(disabledCount).toBe(3);
});
