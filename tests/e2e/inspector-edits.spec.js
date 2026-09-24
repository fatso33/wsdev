import { expect, openStudio, readCalls, recordCalls, test } from './fixtures/inspectorHarness.js';

async function addComponent(page, component) {
  await page.evaluate((value) => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push(value);
    state.undoStack = [];
  }, component);
}

test('nested, array, and root commits preserve shape and one-step undo', async ({ page }) => {
  await openStudio(page);
  await addComponent(page, {
    id: 'edit-pin', type: 'core.button', props: {},
    style: { typography: { color: '#112233', size: 14 }, rules: [{ style: { opacity: 0.4 } }, { style: { opacity: 0.8 } }] },
    label: 'Before',
  });
  await recordCalls(page, '__studioApp.state', ['updateComponent']);
  const result = await page.evaluate(() => {
    const state = window.__studioApp.state;
    const inspector = window.__studioApp.inspector;
    const comp = state.getComponent('edit-pin');
    const oldStyle = comp.style;
    const oldTypography = comp.style.typography;
    const oldRules = comp.style.rules;
    inspector.commitField(comp, 'style.typography.color', '#abcdef');
    const nested = {
      color: comp.style.typography.color, size: comp.style.typography.size,
      newStyle: comp.style !== oldStyle, newTypography: comp.style.typography !== oldTypography,
      sameRules: comp.style.rules === oldRules, undoCount: state.undoStack.length,
    };
    state.undo();
    const undone = state.getComponent('edit-pin').style.typography.color;
    state.undoStack = [];
    inspector.commitField(state.getComponent('edit-pin'), 'style.rules.1.style.opacity', 0.25);
    const rules = state.getComponent('edit-pin').style.rules;
    const array = { isArray: Array.isArray(rules), length: rules.length, first: rules[0].style.opacity, second: rules[1].style.opacity };
    state.undoStack = [];
    inspector.commitField(state.getComponent('edit-pin'), 'label', 'After');
    return { nested, undone, array, root: state.getComponent('edit-pin').label };
  });
  expect(result).toEqual({
    nested: { color: '#abcdef', size: 14, newStyle: true, newTypography: true, sameRules: true, undoCount: 1 },
    undone: '#112233',
    array: { isArray: true, length: 2, first: 0.4, second: 0.25 },
    root: 'After',
  });
  expect((await readCalls(page, '__studioApp.state')).filter((call) => call.method === 'updateComponent')).toHaveLength(3);
});

test('missing reads, props replacement, and JSON parse errors keep the component intact', async ({ page }) => {
  await openStudio(page);
  await addComponent(page, { id: 'json-pin', type: 'core.button', props: { keep: 7, itemTemplate: { old: true } }, style: {} });
  await recordCalls(page, '__studioApp.state', ['updateComponent']);
  const warnings = [];
  page.on('console', (message) => { if (message.type() === 'warning') warnings.push(message.text()); });
  const result = await page.evaluate(() => {
    const inspector = window.__studioApp.inspector;
    const comp = window.__studioApp.state.getComponent('json-pin');
    const missing = inspector.getFieldValue(comp, 'props.absent.deep');
    const existing = inspector.getFieldValue(comp, 'props.keep');
    inspector.updateCompProp(comp, 'keep', 8);
    const error = document.createElement('span');
    error.classList.add('hidden');
    inspector.updateCompJsonProp(comp, 'itemTemplate', '{oops', error);
    const invalid = { text: error.textContent, visible: !error.classList.contains('hidden'), value: comp.props.itemTemplate };
    inspector.updateCompJsonProp(comp, 'itemTemplate', '{"next":true}', error);
    const valid = { hidden: error.classList.contains('hidden'), value: comp.props.itemTemplate, keep: comp.props.keep };
    inspector.updateCompJsonProp(comp, 'itemTemplate', '{bad');
    return { missingIsUndefined: missing === undefined, existing, invalid, valid };
  });
  expect(result.missingIsUndefined).toBe(true);
  expect(result.existing).toBe(7);
  expect(result.invalid).toEqual({ text: expect.stringMatching(/^Invalid JSON — edit not applied: /), visible: true, value: { old: true } });
  expect(result.valid).toEqual({ hidden: true, value: { next: true }, keep: 8 });
  expect((await readCalls(page, '__studioApp.state')).filter((call) => call.method === 'updateComponent')).toHaveLength(2);
  expect(warnings).toEqual([expect.stringContaining('[StudioInspector] Invalid JSON for prop "itemTemplate"; change ignored.')]);
});

test('Rotary context and Feel edits each make one undoable update and announce adjustments', async ({ page }) => {
  await openStudio(page);
  await addComponent(page, { id: 'rotary-pin', type: 'core.rotary', props: { degreesPerUnit: 2, min: 0, max: 360 }, style: {} });
  await recordCalls(page, '__studioApp.state', ['updateComponent']);
  const result = await page.evaluate(() => {
    const state = window.__studioApp.state;
    const inspector = window.__studioApp.inspector;
    inspector.commitField(state.getComponent('rotary-pin'), 'props.writeMode', 'pulse');
    const context = { ...state.getComponent('rotary-pin').props, undoCount: state.undoStack.length };
    state.undo();
    const undone = state.getComponent('rotary-pin').props;
    state.undoStack = [];
    inspector.commitField(state.getComponent('rotary-pin'), 'props.degreesPerUnit', 0.001);
    const feel = { ...state.getComponent('rotary-pin').props, undoCount: state.undoStack.length };
    return { context, undone, feel };
  });
  expect(result.context.writeMode).toBe('pulse');
  expect(result.context.degreesPerUnit).toBeGreaterThan(2);
  expect(result.context.undoCount).toBe(1);
  expect(result.undone.degreesPerUnit).toBe(2);
  expect(result.undone.writeMode).toBeUndefined();
  expect(result.feel.degreesPerUnit).toBeGreaterThan(0.001);
  expect(result.feel.undoCount).toBe(1);
  expect((await readCalls(page, '__studioApp.state')).filter((call) => call.method === 'updateComponent')).toHaveLength(2);
  await expect(page.locator('.studio-toast.visible')).toContainText(/floor/i);
});

test('multi-select delegates once and distinguishes one, several context, and several Feel notes', async ({ page }) => {
  await openStudio(page);
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    for (const [id, degreesPerUnit] of [['r1', 1], ['r2', 20], ['r3', 20]]) {
      state.widgetDef.components.push({ id, type: 'core.rotary', props: { degreesPerUnit }, style: {} });
    }
    state.multiSelectedIds = new Set(['r1', 'r2', 'r3']);
    state.undoStack = [];
  });
  await recordCalls(page, '__studioApp.state', ['applyFieldToSelection', 'updateComponent']);
  const one = await page.evaluate(() => {
    const state = window.__studioApp.state;
    window.__studioApp.inspector.commitField({ __multiSelect: true }, 'props.writeMode', 'pulse');
    return { feels: ['r1', 'r2', 'r3'].map((id) => state.getComponent(id).props.degreesPerUnit), undoCount: state.undoStack.length };
  });
  expect(one.undoCount).toBe(1);
  expect(one.feels[0]).toBeGreaterThan(1);
  await expect(page.locator('.studio-toast.visible')).toContainText(/Feel/i);
  await expect(page.locator('.studio-toast.visible')).not.toContainText('Rotaries');
  const several = await page.evaluate(() => {
    const state = window.__studioApp.state;
    for (const id of ['r1', 'r2', 'r3']) state.getComponent(id).props.degreesPerUnit = 1;
    window.__studioApp.inspector.commitField({ __multiSelect: true }, 'props.gesture', 'scrub');
    return state.undoStack.length;
  });
  expect(several).toBe(2);
  await expect(page.locator('.studio-toast.visible')).toContainText('Feel was adjusted on 3 Rotaries');
  await page.evaluate(() => window.__studioApp.inspector.commitField({ __multiSelect: true }, 'props.degreesPerUnit', 0.001));
  await expect(page.locator('.studio-toast.visible')).toContainText('Feel was raised to the floor on 3 Rotaries');
  const calls = await readCalls(page, '__studioApp.state');
  expect(calls.filter((call) => call.method === 'applyFieldToSelection')).toHaveLength(3);
  expect(calls.filter((call) => call.method === 'updateComponent')).toHaveLength(0);
});
