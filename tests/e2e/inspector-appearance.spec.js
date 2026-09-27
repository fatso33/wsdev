import {
  clearCalls,
  expect,
  openStudio,
  readCalls,
  recordCalls,
  seedAssets,
  seedStateVars,
  test,
  INJECTION_PAYLOAD as P,
  countInjectedInInspector,
  collectRenderErrors,
  installWriteRecorder,
  runSeeding,
  snapshotWidgetDef,
  readWriteCheck,
} from './fixtures/inspectorHarness.js';

// Every case runs at the Full tier so tier-hidden Appearance fields are visible and clickable.
async function openFull(page) {
  await page.addInitScript(() => localStorage.setItem('fdws_studio_uiMode', 'full'));
  await openStudio(page);
}

// Pushes a component without a notification, clears Undo, selects it and opens the Style tab.
async function selectOnStyleTab(page, component) {
  await page.evaluate((value) => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push(value);
    state.undoStack = [];
    state.selectComponent(value.id);
  }, component);
  await page.getByTestId('inspector-tab-style').click();
}

async function componentStyle(page, id) {
  return page.evaluate((compId) => {
    const style = window.__studioApp.state.getComponent(compId).style;
    return style === undefined ? '<undefined>' : JSON.parse(JSON.stringify(style, (_key, value) => (value === undefined ? '<undefined>' : value)));
  }, id);
}

async function updateCalls(page) {
  return (await readCalls(page, '__studioApp.state')).filter((call) => call.method === 'updateComponent');
}

async function styleTarget(page) {
  return page.evaluate(() => {
    const inspector = window.__studioApp.inspector;
    return { styleTab: inspector._styleTab, ruleIndex: inspector._styleTabRuleIndex };
  });
}

async function changeInput(page, selector, value) {
  await page.evaluate(({ sel, next }) => {
    const input = window.__studioApp.inspector.container.querySelector(sel);
    input.value = next;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, { sel: selector, next: value });
}

const RULES = [
  { when: { state: 'mode', equals: 1 }, style: { opacity: 0.1 } },
  { when: { state: 'mode', equals: 2 }, style: { opacity: 0.2 } },
  { when: { state: 'mode', equals: 3 }, style: { opacity: 0.3 } },
];

test('target strip: Normal/state tabs, rule chips and + Rule', async ({ page }) => {
  await openFull(page);
  await page.evaluate(() => { window.__studioApp.state.widgetDef.state = []; });
  await selectOnStyleTab(page, { id: 'strip', type: 'core.button', label: 'Strip', props: { variant: 'toggle' }, style: { rules: [RULES[0]] } });
  const summary = await page.evaluate(async (when) => (await import('/js/InspectorLogic.js')).summarizeCondition(when), RULES[0].when);

  await expect(page.locator('#c-styletab-normal')).toHaveClass(/active/);
  await expect(page.getByTestId('style-state-tab-active')).toHaveText('Active');
  const chip = page.locator('[data-rule-chip="0"]');
  await expect(chip).toHaveText(`1. ${summary}`);
  await expect(chip).toHaveAttribute('title', `Rule 1 of 1 — ${summary} (first matching rule wins)`);
  expect(await chip.evaluate((el) => el.draggable)).toBe(true);

  await page.getByTestId('style-state-tab-active').click();
  expect(await styleTarget(page)).toEqual({ styleTab: 'state', ruleIndex: null });
  await expect(page.getByTestId('style-state-tab-active')).toHaveClass(/active/);
  await expect(page.locator('.prop-hint-block', { hasText: 'Overrides merged over the base style while this component is active.' })).toBeVisible();

  await recordCalls(page, '__studioApp.state', ['updateComponent']);
  await page.locator('#c-styletab-addrule').click();
  expect(await styleTarget(page)).toEqual({ styleTab: 'state', ruleIndex: 1 });
  expect((await componentStyle(page, 'strip')).rules[1]).toEqual({ when: { state: '', equals: '' }, style: { typography: { color: '#f87171' } } });
  await expect(page.locator('[data-rule-chip="1"]')).toHaveClass(/active/);

  await seedStateVars(page, [{ name: 'gear', type: 'number', default: 0 }]);
  await page.locator('#c-styletab-addrule').click();
  expect(await styleTarget(page)).toEqual({ styleTab: 'state', ruleIndex: 2 });
  expect((await componentStyle(page, 'strip')).rules[2]).toEqual({ when: { state: 'gear', equals: '' }, style: { typography: { color: '#f87171' } } });
  const adds = await updateCalls(page);
  expect(adds).toHaveLength(2);
  expect(adds[1].args.length).toBe(2);

  await page.locator('#c-styletab-normal').click();
  expect(await styleTarget(page)).toEqual({ styleTab: 'normal', ruleIndex: null });
  await expect(page.locator('#c-styletab-normal')).toHaveClass(/active/);
  await expect(page.locator('[data-rule-chip="2"]')).not.toHaveClass(/active/);

  // A component without state-style support gets no state tab.
  await selectOnStyleTab(page, { id: 'plain', type: 'core.label', props: { text: 'x' }, style: {} });
  await expect(page.locator('#c-styletab-state')).toHaveCount(0);
});

test('rules reorder by Move Up/Down and drag-and-drop, with the active index following', async ({ page }) => {
  await openFull(page);
  await selectOnStyleTab(page, { id: 'order', type: 'core.label', props: { text: 'x' }, style: { rules: RULES } });
  await recordCalls(page, '__studioApp.state', ['updateComponent']);
  const equalsOrder = async () => (await componentStyle(page, 'order')).rules.map((rule) => rule.when.equals);

  await page.locator('[data-rule-chip="0"]').click();
  await expect(page.locator('#c-rule-move-up')).toBeDisabled();
  await expect(page.locator('#c-rule-move-down')).toBeEnabled();
  await page.locator('#c-rule-move-down').click();
  expect(await equalsOrder()).toEqual([2, 1, 3]);
  expect((await styleTarget(page)).ruleIndex).toBe(1);
  await expect(page.locator('[data-rule-chip="1"]')).toHaveClass(/active/);

  await page.locator('#c-rule-move-up').click();
  expect(await equalsOrder()).toEqual([1, 2, 3]);
  expect((await styleTarget(page)).ruleIndex).toBe(0);

  await page.locator('[data-rule-chip="2"]').click();
  await expect(page.locator('#c-rule-move-down')).toBeDisabled();
  await expect(page.locator('#c-rule-move-up')).toBeEnabled();

  const drag = await page.evaluate(() => {
    const chip = (i) => window.__studioApp.inspector.container.querySelector(`[data-rule-chip="${i}"]`);
    const dt = new DataTransfer();
    // A constructed DataTransfer ignores effect assignments, so plain own properties record them.
    Object.defineProperty(dt, 'effectAllowed', { value: 'uninitialized', writable: true });
    Object.defineProperty(dt, 'dropEffect', { value: 'none', writable: true });
    const fire = (el, type) => {
      const event = new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true });
      el.dispatchEvent(event);
      return event;
    };
    fire(chip(0), 'dragstart');
    const started = { data: dt.getData('text/plain'), effectAllowed: dt.effectAllowed };
    const over = fire(chip(2), 'dragover');
    const during = { opacity: chip(2).style.opacity, prevented: over.defaultPrevented, dropEffect: dt.dropEffect };
    fire(chip(2), 'dragleave');
    const afterLeave = chip(2).style.opacity;
    chip(1).style.opacity = '0.7';
    fire(chip(0), 'dragend');
    const afterEnd = chip(1).style.opacity;
    const sameIndex = fire(chip(0), 'drop').defaultPrevented;
    const target = chip(2);
    fire(target, 'dragover');
    const dropped = fire(target, 'drop');
    return { started, during, afterLeave, afterEnd, sameIndex, prevented: dropped.defaultPrevented, targetOpacity: target.style.opacity, detached: !target.isConnected };
  });
  expect(drag).toEqual({
    started: { data: '0', effectAllowed: 'move' },
    during: { opacity: '0.7', prevented: true, dropEffect: 'move' },
    afterLeave: '',
    afterEnd: '',
    sameIndex: true,
    prevented: true,
    targetOpacity: '',
    detached: true,
  });
  expect(await equalsOrder()).toEqual([2, 3, 1]);
  expect((await styleTarget(page)).ruleIndex).toBe(2);
  await expect(page.locator('[data-rule-chip="2"]')).toHaveClass(/active/);

  const reorders = await updateCalls(page);
  expect(reorders).toHaveLength(3);
  for (const call of reorders) {
    expect(call.args[0]).toBe('order');
    expect(call.args.slice(2)).toEqual([true, 'Reorder Rule']);
  }
  const labels = await page.evaluate(() => window.__studioApp.state.undoStack.map((entry) => entry.label));
  expect(labels).toEqual(['Reorder Rule', 'Reorder Rule', 'Reorder Rule']);
});

test('remove confirms, clears the index and stores rules: undefined for the last rule', async ({ page }) => {
  await openFull(page);
  await selectOnStyleTab(page, { id: 'remove', type: 'core.label', props: { text: 'x' }, style: { rules: RULES.slice(0, 2) } });
  await recordCalls(page, '__studioApp.state', ['updateComponent']);

  await page.locator('[data-rule-chip="1"]').click();
  await page.locator('#c-rule-remove').click();
  const modal = page.locator('.studio-modal-box');
  await expect(modal.locator('.modal-title')).toHaveText('Remove Rule');
  await expect(modal.locator('.modal-confirm-text')).toHaveText('Remove this rule (mode = 2)?');
  await modal.locator('[data-modal-cancel]').click();
  expect((await componentStyle(page, 'remove')).rules).toHaveLength(2);
  expect((await styleTarget(page)).ruleIndex).toBe(1);
  expect(await updateCalls(page)).toHaveLength(0);

  await page.locator('#c-rule-remove').click();
  await expect(modal.locator('[data-modal-submit]')).toHaveText('Delete');
  await modal.locator('[data-modal-submit]').click();
  await expect(page.locator('[data-rule-chip="1"]')).toHaveCount(0);
  expect((await componentStyle(page, 'remove')).rules.map((rule) => rule.when.equals)).toEqual([1]);
  expect((await styleTarget(page)).ruleIndex).toBeNull();

  await page.locator('[data-rule-chip="0"]').click();
  await page.locator('#c-rule-remove').click();
  await modal.locator('[data-modal-submit]').click();
  await expect(page.locator('[data-rule-chip]')).toHaveCount(0);
  const stored = await page.evaluate(() => {
    const style = window.__studioApp.state.getComponent('remove').style;
    return { hasKey: Object.hasOwn(style, 'rules'), value: style.rules === undefined };
  });
  expect(stored).toEqual({ hasKey: true, value: true });
  expect((await styleTarget(page)).ruleIndex).toBeNull();
  expect((await updateCalls(page)).map((call) => call.args.length)).toEqual([2, 2]);
});

test('rule JSON editor keeps its toggle per rule index and reports invalid JSON', async ({ page }) => {
  await openFull(page);
  await selectOnStyleTab(page, { id: 'json', type: 'core.label', props: { text: 'x' }, style: { rules: RULES.slice(0, 2) } });

  await page.locator('[data-rule-chip="0"]').click();
  await expect(page.locator('#c-rule-json-toggle')).toHaveText('Advanced JSON');
  await expect(page.locator('#c-rule-json')).toBeHidden();
  await page.locator('#c-rule-json-toggle').click();
  await expect(page.locator('#c-rule-json-toggle')).toHaveText('Hide JSON');
  await expect(page.locator('#c-rule-json')).toHaveValue('{"opacity":0.1}');
  expect(await page.evaluate(() => window.__studioApp.inspector._conditionalStyleJsonOpen)).toEqual({ 0: true });

  await page.locator('[data-rule-chip="1"]').click();
  await expect(page.locator('#c-rule-json-toggle')).toHaveText('Advanced JSON');
  await page.locator('[data-rule-chip="0"]').click();
  await expect(page.locator('#c-rule-json-toggle')).toHaveText('Hide JSON');

  await recordCalls(page, '__studioApp.state', ['updateComponent']);
  await changeInput(page, '#c-rule-json', '{oops');
  await expect(page.locator('#c-rule-json-error')).toBeVisible();
  await expect(page.locator('#c-rule-json-error')).toHaveText(/^Invalid JSON — edit not applied: /);
  expect(await updateCalls(page)).toHaveLength(0);

  await changeInput(page, '#c-rule-json', '{"opacity":0.9}');
  expect((await componentStyle(page, 'json')).rules).toEqual([{ when: RULES[0].when, style: { opacity: 0.9 } }, RULES[1]]);
  await expect(page.locator('#c-rule-json-error')).toBeHidden();
  expect(await updateCalls(page)).toHaveLength(1);
});

test('rule Edit opens the shared condition popover and commits the edited condition', async ({ page }) => {
  await openFull(page);
  await selectOnStyleTab(page, { id: 'cond', type: 'core.label', props: { text: 'x' }, style: { rules: RULES.slice(0, 2) } });
  await page.locator('[data-rule-chip="1"]').click();
  await expect(page.locator('#rule-edit-condition')).toHaveText('Edit');

  await recordCalls(page, '__studioApp.inspector', ['openConditionEditorPopover', 'render']);
  await page.evaluate(() => {
    const inspector = window.__studioApp.inspector;
    const original = inspector.renderConditionListEditor;
    inspector.renderConditionListEditor = function capture(...args) {
      window.__inspectorHarness.conditionArgs = args;
      return original.apply(this, args);
    };
  });
  await page.locator('#rule-edit-condition').click();
  const modal = page.locator('.studio-modal-box');
  await expect(modal.locator('.modal-title')).toHaveText('Edit Rule Condition');
  const opened = await page.evaluate(() => {
    const [comp, def, expr, idPrefix] = window.__inspectorHarness.conditionArgs;
    const state = window.__studioApp.state;
    return { comp: comp === state.getComponent('cond'), def: def === state.widgetDef, expr, idPrefix };
  });
  expect(opened).toEqual({ comp: true, def: true, expr: RULES[1].when, idPrefix: 'rulecond' });
  const popoverCalls = (await readCalls(page, '__studioApp.inspector')).filter((call) => call.method === 'openConditionEditorPopover');
  expect(popoverCalls.map((call) => call.args)).toEqual([['Edit Rule Condition', '[function]']]);

  await recordCalls(page, '__studioApp.state', ['updateComponent']);
  await page.evaluate(() => window.__inspectorHarness.conditionArgs[4]({ state: 'mode', equals: 7 }, false));
  expect((await componentStyle(page, 'cond')).rules).toEqual([RULES[0], { when: { state: 'mode', equals: 7 }, style: RULES[1].style }]);
  expect((await updateCalls(page)).map((call) => call.args.slice(2))).toEqual([[false]]);

  await clearCalls(page, '__studioApp.inspector');
  await modal.locator('[data-modal-submit]').click();
  await expect(modal).toHaveCount(0);
  expect((await readCalls(page, '__studioApp.inspector')).filter((call) => call.method === 'render').length).toBeGreaterThanOrEqual(1);
  await expect(page.locator('[data-rule-chip="1"]')).toHaveText('2. mode = 7');
});

test('orphaned style.states keys offer Migrate only into an empty target, and Delete', async ({ page }) => {
  await openFull(page);
  await selectOnStyleTab(page, { id: 'orphan', type: 'core.button', props: {}, style: { states: { active: { opacity: 0.5 } } } });
  const migrate = page.locator('[data-orphan-migrate="active"]');
  await expect(page.getByText('⚠ style.states.active has no effect — this component only reads style.states.pressed.')).toBeVisible();
  await expect(migrate).toHaveText('Migrate to pressed');
  await migrate.click();
  expect((await componentStyle(page, 'orphan')).states).toEqual({ pressed: { opacity: 0.5 } });
  await expect(migrate).toHaveCount(0);

  await selectOnStyleTab(page, { id: 'occupied', type: 'core.button', props: {}, style: { states: { active: { opacity: 0.5 }, pressed: { opacity: 0.9 } } } });
  await expect(page.locator('[data-orphan-migrate]')).toHaveCount(0);
  await expect(page.locator('.prop-hint', { hasText: 'Migrate unavailable' })).toHaveAttribute('title', 'style.states.pressed already has its own data — migrating would overwrite it.');
  await page.locator('[data-orphan-delete="active"]').click();
  const occupied = await page.evaluate(() => Object.keys(window.__studioApp.state.getComponent('occupied').style.states));
  expect(occupied).toEqual(['pressed']);

  await selectOnStyleTab(page, { id: 'nostates', type: 'core.label', props: { text: 'x' }, style: { states: { foo: {} } } });
  await expect(page.getByText('⚠ style.states.foo has no effect — this component type has no interaction-state style support at all.')).toBeVisible();
  await expect(page.locator('[data-orphan-migrate]')).toHaveCount(0);
  await page.locator('[data-orphan-delete="foo"]').click();
  expect((await componentStyle(page, 'nostates')).states).toEqual({});
});

test('theme chip: disabled titles for Auto and non-Normal targets, and the preview toggle', async ({ page }) => {
  await openFull(page);
  await page.evaluate(() => {
    const def = window.__studioApp.state.widgetDef;
    def.baseTheme = 'dark';
    def.themeMode = 'auto';
  });
  await selectOnStyleTab(page, { id: 'theme', type: 'core.button', props: {}, style: { rules: [RULES[0]] } });
  const chip = page.locator('#c-styletab-theme');
  await expect(chip).toHaveText('Light Override');
  await expect(chip).toBeDisabled();
  await expect(chip).toHaveAttribute('title', "This widget's Theme Mode is Auto — the light theme is fully auto-derived. Switch Theme Mode to Manual (widget-root Theme settings) to author a separate override here.");
  expect(await page.evaluate(() => window.__studioApp.inspector.getThemeEditContext())).toEqual({ baseTheme: 'dark', themeMode: 'auto', isOverrideEdit: false });

  await page.evaluate(() => {
    window.__studioApp.state.widgetDef.themeMode = 'manual';
    window.__studioApp.inspector.render();
  });
  await expect(chip).toBeEnabled();
  await expect(chip).toHaveAttribute('title', "Edit this component's light theme override — Text/Stroke/Glow/Border/Border Glow/Background Color only.");
  await recordCalls(page, '__studioApp.state', ['setPreviewTheme']);
  await chip.click();
  await expect(chip).toHaveClass(/active/);
  await expect(page.locator('.theme-override-banner')).toHaveText('Editing LIGHT theme override — Text/Stroke/Glow/Border/Border Glow/Background Color apply only to this theme; other properties stay shared with the base dark style.');
  expect(await page.evaluate(() => window.__studioApp.inspector.getThemeEditContext())).toEqual({ baseTheme: 'dark', themeMode: 'manual', isOverrideEdit: true });
  await chip.click();
  await expect(chip).not.toHaveClass(/active/);
  expect((await readCalls(page, '__studioApp.state')).map((call) => call.args)).toEqual([['light'], ['dark']]);

  await page.getByTestId('style-state-tab-pressed').click();
  await expect(chip).toBeDisabled();
  await expect(chip).toHaveAttribute('title', 'Theme overrides apply to the Base style only — states and rules are already conditional.');
  await page.locator('[data-rule-chip="0"]').click();
  await expect(chip).toBeDisabled();
  await expect(chip).toHaveAttribute('title', 'Theme overrides apply to the Base style only — states and rules are already conditional.');
});

test('copy and paste are scoped to the active state or rule, with matching toasts', async ({ page }) => {
  await openFull(page);
  await selectOnStyleTab(page, {
    id: 'copy', label: 'Copier', type: 'core.button', props: {},
    style: { opacity: 0.6, states: { pressed: { opacity: 0.2 } }, rules: [RULES[0]] },
  });
  const toast = page.locator('.studio-toast');
  await expect(page.locator('#c-style-paste')).toBeDisabled();
  await recordCalls(page, '__studioApp.state', ['copyComponentStyle', 'pasteStyleToComponent']);

  await page.locator('#c-style-copy').click();
  await expect(toast).toHaveText('Copied style from "Copier".');
  await expect(page.locator('#c-style-paste')).toBeEnabled();
  await page.locator('#c-style-paste').click();
  await expect(toast).toHaveText('Pasted style onto "Copier".');

  await page.getByTestId('style-state-tab-pressed').click();
  await page.locator('#c-style-copy').click();
  await expect(toast).toHaveText('Copied (Pressed) style from "Copier".');
  await page.locator('#c-style-paste').click();
  await expect(toast).toHaveText('Pasted (Pressed) style onto "Copier".');

  await page.locator('[data-rule-chip="0"]').click();
  await page.locator('#c-style-copy').click();
  await expect(toast).toHaveText('Copied (Rule 1) style from "Copier".');
  await page.locator('#c-style-paste').click();
  await expect(toast).toHaveText('Pasted (Rule 1) style onto "Copier".');

  expect((await readCalls(page, '__studioApp.state')).map((call) => [call.method, ...call.args])).toEqual([
    ['copyComponentStyle', 'copy', undefined, undefined],
    ['pasteStyleToComponent', 'copy', undefined, undefined],
    ['copyComponentStyle', 'copy', 'pressed', undefined],
    ['pasteStyleToComponent', 'copy', 'pressed', undefined],
    ['copyComponentStyle', 'copy', undefined, 0],
    ['pasteStyleToComponent', 'copy', undefined, 0],
  ]);
});

test('a style preset merges over the existing style and announces itself', async ({ page }) => {
  await openFull(page);
  await selectOnStyleTab(page, { id: 'preset', type: 'core.button', props: {}, style: { opacity: 0.4, typography: { size: 30 } } });
  const preset = await page.evaluate(async () => (await import('/js/StudioStylePresets.js')).STYLE_PRESETS[0]);
  await recordCalls(page, '__studioApp.state', ['updateComponent']);
  await page.locator(`.style-preset-swatch[data-preset="${preset.id}"]`).click();
  expect(await componentStyle(page, 'preset')).toEqual({ opacity: 0.4, typography: { size: 30 }, ...preset.style });
  await expect(page.locator('.studio-toast')).toHaveText(`Applied "${preset.name}" style — still fully editable below.`);
  expect(await updateCalls(page)).toHaveLength(1);
});

test('a core.label props.align migrates once, in a microtask, to style.align.h', async ({ page }) => {
  await openFull(page);
  await recordCalls(page, '__studioApp.state', ['updateComponent']);
  const timing = await page.evaluate(async () => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push({ id: 'legacy', type: 'core.label', props: { text: 'x', align: 'right' }, style: { opacity: 0.5, align: { v: 'top' } } });
    state.selectComponent('legacy');
    const comp = state.getComponent('legacy');
    const duringRender = { align: comp.props.align, h: comp.style.align.h };
    await Promise.resolve();
    return { duringRender, after: { props: comp.props, style: comp.style } };
  });
  expect(timing).toEqual({
    duringRender: { align: 'right', h: undefined },
    after: { props: { text: 'x' }, style: { opacity: 0.5, align: { v: 'top', h: 'right' } } },
  });
  const calls = await updateCalls(page);
  expect(calls).toHaveLength(1);
  expect(calls[0].args).toEqual(['legacy', { props: { text: 'x' }, style: { opacity: 0.5, align: { v: 'top', h: 'right' } } }]);

  await page.evaluate(async () => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push({ id: 'kept', type: 'core.label', props: { text: 'x', align: 'left' }, style: { align: { h: 'center' } } });
    state.selectComponent('kept');
    await Promise.resolve();
  });
  expect(await updateCalls(page)).toHaveLength(1);
});

test('Appearance groups render in order with hand-coded Base color fields', async ({ page }) => {
  await openFull(page);
  await selectOnStyleTab(page, { id: 'groups', type: 'core.button', props: {}, style: {} });
  const subtitles = () => page.evaluate(() => [...window.__studioApp.inspector.container.querySelectorAll('#c-appearance-fields > .prop-section-subtitle')].map((el) => el.textContent));
  expect(await subtitles()).toEqual(['Typography', 'Layout', 'Border', 'Background']);
  for (const path of ['typography.color', 'typography.stroke.color', 'typography.glow.color', 'border.color', 'border.glow.color', 'background.color']) {
    await expect(page.getByTestId(`style-field-${path}`)).toHaveCount(1);
  }
  await expect(page.locator('#c-typo-color')).toHaveCount(1);
  await expect(page.locator('#rf-style-typography-color')).toHaveCount(0);

  const remap = await page.evaluate(() => {
    const inspector = window.__studioApp.inspector;
    const comp = window.__studioApp.state.getComponent('groups');
    comp.style = { typography: { size: 12 } };
    const field = { path: 'style.typography.size', showWhen: { path: 'style.typography.color', equals: 'x' } };
    const base = [field];
    return {
      state: inspector.remapAppearancePath('style.typography.size', { kind: 'state', name: 'pressed' }),
      rule: inspector.remapAppearancePath('style.typography.size', { kind: 'rule', index: 2 }),
      base: inspector.remapAppearancePath('style.typography.size', { kind: 'base' }),
      sameList: inspector.retargetAppearanceFields(comp, base, { kind: 'base' }) === base,
      retargeted: inspector.retargetAppearanceFields(comp, base, { kind: 'rule', index: 0 }),
    };
  });
  expect(remap).toEqual({
    state: 'style.states.pressed.typography.size',
    rule: 'style.rules.2.style.typography.size',
    base: 'style.typography.size',
    sameList: true,
    retargeted: [{
      path: 'style.rules.0.style.typography.size',
      originalPath: 'style.typography.size',
      showWhen: { path: 'style.rules.0.style.typography.color', equals: 'x' },
      inheritedValue: 12,
    }],
  });

  await page.getByTestId('style-state-tab-pressed').click();
  expect(await subtitles()).toEqual(['Typography', 'Layout', 'Border', 'Background']);
  await expect(page.locator('#c-typo-color')).toHaveCount(0);
  await expect(page.getByTestId('style-field-typography.color')).toHaveCount(1);
  await expect(page.getByTestId('style-field-background.type')).toHaveCount(1);
});

test('Manual theme with a non-base preview redirects only the six color writes', async ({ page }) => {
  await openFull(page);
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.baseTheme = 'dark';
    state.widgetDef.themeMode = 'manual';
  });
  const base = { typography: { color: '#101010', size: 10 }, border: { color: '#202020' }, background: { type: 'color', color: '#303030' } };
  await selectOnStyleTab(page, { id: 'manual', type: 'core.button', props: {}, style: base });
  await page.evaluate(() => window.__studioApp.state.setPreviewTheme('light'));
  await expect(page.locator('.theme-override-banner')).toBeVisible();

  await changeInput(page, '#c-typo-color', '#aa0001');
  await changeInput(page, '#c-typo-stroke-color', '#aa0002');
  await changeInput(page, '#c-typo-glow-color', '#aa0003');
  await changeInput(page, '#c-border-color', '#aa0004');
  await changeInput(page, '#c-border-glow-color', '#aa0005');
  await changeInput(page, '#c-bg-color', '#aa0006');
  await changeInput(page, '#rf-style-typography-size', '22');
  await changeInput(page, '#rf-style-border-width', '3');

  expect(await componentStyle(page, 'manual')).toEqual({
    typography: { color: '#101010', size: 22 },
    border: { color: '#202020', width: 3 },
    background: { type: 'color', color: '#303030' },
    themeOverride: {
      typography: { color: '#aa0001', stroke: { color: '#aa0002' }, glow: { color: '#aa0003' } },
      border: { color: '#aa0004', glow: { color: '#aa0005' } },
      background: { type: 'color', color: '#aa0006' },
    },
  });
});

test('Background type switches seed values and a pasted gradient switches the type', async ({ page }) => {
  await openFull(page);
  await seedAssets(page, [{ id: 'bezel', mimeType: 'image/png', data: 'data:image/png;base64,AA==' }]);
  await selectOnStyleTab(page, { id: 'bg', type: 'core.button', props: {}, style: { opacity: 0.8, background: { type: 'color', color: '#123456' } } });

  const background = async () => (await componentStyle(page, 'bg')).background;
  await page.locator('#c-bg-type').selectOption('gradient');
  expect(await background()).toEqual({ type: 'gradient', gradient: 'linear-gradient(180deg, #1a2332, #0b0f17)' });
  await expect(page.getByTestId('style-field-background.gradient')).toBeVisible();
  await page.locator('#c-bg-type').selectOption('image');
  expect(await background()).toEqual({ type: 'image', image: { assetId: 'bezel' } });
  await changeInput(page, '#c-bg-image-fit', 'tile');
  await changeInput(page, '#c-bg-image-position', '');
  expect(await background()).toEqual({ type: 'image', image: { assetId: 'bezel', fit: 'tile', position: '<undefined>' } });
  await page.locator('#c-bg-type').selectOption('none');
  expect(await background()).toEqual({ type: 'none' });
  await page.locator('#c-bg-type').selectOption('color');
  expect(await background()).toEqual({ type: 'color', color: '#131b26' });
  expect((await componentStyle(page, 'bg')).opacity).toBe(0.8);

  await recordCalls(page, '__studioApp.inspector', ['render']);
  await changeInput(page, '#c-bg-color', '  linear-gradient(90deg, #000000, #ffffff) ');
  expect(await background()).toEqual({ type: 'gradient', gradient: 'linear-gradient(90deg, #000000, #ffffff)' });
  await expect(page.locator('.studio-toast')).toHaveText('That looks like a CSS gradient, not a color — switched Background Type to "CSS Gradient" so it stays theme-aware.');
  await expect(page.locator('#c-bg-type')).toHaveValue('gradient');
  expect((await readCalls(page, '__studioApp.inspector')).filter((call) => call.method === 'render').length).toBeGreaterThanOrEqual(2);
});

function optionsOf(page, selector) {
  return page.locator(selector).locator('option').evaluateAll((options) => options.map((o) => [o.value, o.textContent]));
}

// Loads a blank widget and seeds under the write recorder, snapshots it, then forces the
// render under test at the Full tier on the Style tab. addComponent auto-selects, so the
// seeded component is already selected once seeding returns.
async function openAppearanceCase(page, seedArg, seedFn) {
  const renderErrors = collectRenderErrors(page);
  await openStudio(page);
  await installWriteRecorder(page);
  await runSeeding(page, seedFn, seedArg);
  await snapshotWidgetDef(page);
  await page.evaluate(() => {
    const { inspector } = window.__studioApp;
    inspector.uiTier = 'full';
    inspector.render();
  });
  await page.getByTestId('inspector-tab-style').click();
  return renderErrors;
}

test('sweep A1: typography, border and background colors, gradient and image position render exactly', async ({ page }) => {
  const renderErrors = await openAppearanceCase(page, {
    assetId: P,
    mimeType: P,
    comp: {
      id: 'sweep-pin',
      type: 'core.button',
      props: {},
      style: {
        typography: { color: P },
        border: { color: P },
        background: { type: 'color', color: P, gradient: P, image: { assetId: P, position: P } },
      },
    },
  }, (arg) => {
    const { state } = window.__studioApp;
    state.setWidgetDef({ assets: [{ id: arg.assetId, mimeType: arg.mimeType }] }, false, 'sweep');
    state.addComponent(arg.comp);
  });

  for (const selector of ['#c-typo-color', '#c-border-color', '#c-bg-color', '#c-bg-gradient', '#c-bg-image-position', '#c-bg-image-asset']) {
    await expect(page.locator(selector), selector).toHaveCount(1);
  }
  expect(await countInjectedInInspector(page)).toBe(0);

  await expect(page.locator('#c-typo-color')).toHaveValue(P);
  await expect(page.locator('#c-border-color')).toHaveValue(P);
  await expect(page.locator('#c-bg-color')).toHaveValue(P);
  await expect(page.locator('#c-bg-gradient')).toHaveValue(P);
  await expect(page.locator('#c-bg-image-position')).toHaveValue(P);
  expect(await optionsOf(page, '#c-bg-image-asset')).toContainEqual([P, `${P} (${P})`]);

  expect(await readWriteCheck(page)).toEqual({ widgetDefChanged: false, writes: [] });
  expect(renderErrors).toEqual([]);
});

test('sweep A2: rule-remove confirm shows the exact condition, injects nothing, Cancel writes nothing', async ({ page }) => {
  const renderErrors = await openAppearanceCase(page, {
    comp: { id: 'sweep-pin', type: 'core.button', props: {}, style: { rules: [{ when: { state: P, equals: P }, style: {} }] } },
  }, (arg) => {
    window.__studioApp.state.addComponent(arg.comp);
  });

  await page.locator('[data-rule-chip="0"]').click();
  await page.locator('#c-rule-remove').click();
  await expect(page.locator('.modal-confirm-text')).toBeVisible();
  expect(await countInjectedInInspector(page)).toBe(0);
  await expect(page.locator('.modal-confirm-text')).toContainText(P);

  await page.locator('[data-modal-cancel]').click();
  await expect(page.locator('.studio-modal-box')).toHaveCount(0);
  expect(await readWriteCheck(page)).toEqual({ widgetDefChanged: false, writes: [] });
  expect(await page.evaluate((id) => window.__studioApp.state.getComponent(id).style.rules.length, 'sweep-pin')).toBe(1);
  expect(renderErrors).toEqual([]);
});
