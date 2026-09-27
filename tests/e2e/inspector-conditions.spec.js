import {
  expect,
  openStudio,
  test,
  INJECTION_PAYLOAD as P,
  countInjectedInInspector,
  collectRenderErrors,
  installWriteRecorder,
  runSeeding,
  snapshotWidgetDef,
  readWriteCheck,
} from './fixtures/inspectorHarness.js';

async function open(page) {
  await page.addInitScript(() => localStorage.setItem('fdws_studio_uiMode', 'full'));
  await openStudio(page);
}

async function editor(page, { expr = null, state = [], binding = {}, deferred = false } = {}) {
  await page.evaluate(({ expr, state, binding, deferred }) => {
    const inspector = window.__studioApp.inspector;
    document.querySelector('#condition-pin-mount')?.remove();
    const comp = { id: 'condition-pin', type: 'core.button', binding };
    const def = { state };
    const mount = document.createElement('div');
    mount.id = 'condition-pin-mount';
    document.body.appendChild(mount);
    window.__conditionPin = { comp, def, mount, expr, commits: [] };
    const render = () => {
      const pin = window.__conditionPin;
      const next = inspector.renderConditionListEditor(comp, def, pin.expr, 'pin', (value, history = true) => {
        pin.expr = value;
        pin.commits.push({ value, history });
        render();
      }, { deferred });
      mount.innerHTML = next.html;
      next.wire(mount);
    };
    render();
  }, { expr, state, binding, deferred });
}

async function change(page, selector, value) {
  await page.evaluate(({ selector, value }) => {
    const el = document.querySelector(`#condition-pin-mount ${selector}`);
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { selector, value });
}

async function pin(page) {
  return page.evaluate(() => ({
    expr: window.__conditionPin.expr,
    commits: window.__conditionPin.commits,
  }));
}

test('visual editor recursively rebuilds groups and preserves condition shapes', async ({ page }) => {
  await open(page);
  await editor(page, { state: [{ name: 'speed' }] });
  await expect(page.locator('#pin-combinator')).toBeDisabled();
  await page.locator('#pin-add-condition').click();
  expect((await pin(page)).expr).toEqual({ allOf: [{ state: 'speed', equals: '' }] });
  await expect(page.locator('#pin-combinator')).toBeEnabled();
  await change(page, '#pin-combinator', 'anyOf');
  expect((await pin(page)).expr).toEqual({ anyOf: [{ state: 'speed', equals: '' }] });
  await page.locator('#pin-add-group').click();
  expect((await pin(page)).expr).toEqual({ anyOf: [{ state: 'speed', equals: '' }, { allOf: [{ state: 'speed', equals: '' }] }] });
  await change(page, '.pin-group-combinator', 'anyOf');
  expect((await pin(page)).expr.anyOf[1]).toEqual({ anyOf: [{ state: 'speed', equals: '' }] });
  await page.locator('.pin-remove-leaf').click();
  expect((await pin(page)).expr).toEqual({ anyOf: [{ state: 'speed', equals: '' }] });
  await page.locator('.pin-remove').click();
  expect((await pin(page)).expr).toBeUndefined();
  await editor(page);
  await page.locator('#pin-add-condition').last().click();
  expect((await pin(page)).expr).toEqual({ allOf: [{ state: '', equals: '' }] });
});

test('operators coerce numbers and retain raw equality strings; Custom reveals before commit', async ({ page }) => {
  await open(page);
  await editor(page, { expr: { state: 'speed', equals: '' }, state: [{ name: 'speed' }] });
  await change(page, '.pin-state', '__custom__');
  await expect(page.locator('.pin-state-custom')).toBeVisible();
  expect((await pin(page)).commits).toHaveLength(0);
  await change(page, '.pin-state-custom', 'presets[0].label');
  expect((await pin(page)).expr).toEqual({ allOf: [{ state: 'presets[0].label', equals: '' }] });
  for (const [op, raw, expected] of [
    ['between', '7,bad', [7, 0]], ['gt', 'bad', 0], ['gte', '4', 4],
    ['lt', '-2', -2], ['lte', 'bad', 0], ['equals', '04', '04'], ['notEquals', 'false', 'false'],
  ]) {
    await change(page, '.pin-op', op);
    await change(page, '.pin-val', raw);
    expect((await pin(page)).expr.allOf[0][op]).toEqual(expected);
  }
});

test('own value is offered only for read binding and immediate/deferred commits keep history contract', async ({ page }) => {
  await open(page);
  await editor(page, { expr: { state: '', equals: '' } });
  await expect(page.locator('.pin-state option', { hasText: "Use This Component's Own Value" })).toHaveCount(0);
  await editor(page, { expr: { state: '', equals: '' }, binding: { readSimVar: 'A:TEST VALUE' } });
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    window.__conditionPin.historyCalls = [];
    for (const name of ['saveHistory', 'ensureSyncFromVar']) {
      const original = state[name];
      state[name] = function (...args) {
        window.__conditionPin.historyCalls.push({ name, args });
        return original.apply(this, args);
      };
    }
    state.undoStack = [];
  });
  await change(page, '.pin-state', '__own_value__');
  expect(await page.evaluate(() => window.__conditionPin.historyCalls)).toEqual([
    { name: 'saveHistory', args: ["Use This Component's Own Value"] },
    { name: 'ensureSyncFromVar', args: ['A:TEST VALUE'] },
  ]);
  expect((await pin(page)).commits.at(-1).history).toBe(false);
  expect(await page.evaluate(() => window.__studioApp.state.undoStack.length)).toBe(1);
  await editor(page, { expr: { state: '', equals: '' }, binding: { readSimVar: 'A:OTHER VALUE' }, deferred: true });
  await page.evaluate(() => { window.__conditionPin.historyCalls = []; });
  await change(page, '.pin-state', '__own_value__');
  expect(await page.evaluate(() => window.__conditionPin.historyCalls)).toEqual([]);
  expect((await pin(page)).commits.at(-1).history).toBe(false);
});

test('complex JSON fallback reports invalid input and Clear returns to visual editor', async ({ page }) => {
  await open(page);
  await editor(page, { expr: { allOf: [{ anyOf: [{ allOf: [{ state: 'x', equals: 1 }] }] }] } });
  await expect(page.locator('#pin-raw-json')).toBeVisible();
  await change(page, '#pin-raw-json', '{bad');
  await expect(page.locator('#pin-raw-error')).toContainText('Invalid JSON — edit not applied:');
  expect((await pin(page)).commits).toHaveLength(0);
  await page.locator('#pin-clear').click();
  expect((await pin(page)).commits).toEqual([{ history: true }]);
  await expect(page.locator('#pin-add-condition')).toBeVisible();
});

test('visibility summary, popover Done/Cancel and guard writes use the existing state path', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    const comp = { id: 'condition-component', type: 'core.button', props: {}, layout: {}, visibleWhen: { state: 'mode', equals: 'on' } };
    state.widgetDef.components.push(comp);
    state.widgetDef.assets = [{ id: 'cover' }];
    state.undoStack = [];
    state.selectComponent(comp.id);
    const inspector = window.__studioApp.inspector;
    inspector._pinRenderCount = 0;
    const original = inspector.render;
    inspector.render = function (...args) { this._pinRenderCount++; return original.apply(this, args); };
  });
  await page.getByTestId('inspector-tab-events').click();
  await expect(page.locator('#vw-edit-condition')).toBeVisible();
  const expectedSummary = await page.evaluate(async () => {
    const { summarizeCondition } = await import('/js/InspectorLogic.js');
    return summarizeCondition(window.__studioApp.state.getComponent('condition-component').visibleWhen);
  });
  await expect(page.locator('#vw-edit-condition').locator('..').locator('div').first()).toHaveText(expectedSummary);
  await page.locator('#vw-edit-condition').click();
  await expect(page.locator('.studio-modal-box .modal-title')).toHaveText('Edit Conditional Visibility');
  await page.locator('[data-modal-cancel]').click();
  const cancelCount = await page.evaluate(() => window.__studioApp.inspector._pinRenderCount);
  await page.locator('#vw-edit-condition').click();
  await page.locator('[data-modal-submit]').click();
  expect(await page.evaluate(() => window.__studioApp.inspector._pinRenderCount)).toBe(cancelCount + 1);
  await page.locator('#guard-enabled').check();
  await expect(page.locator('#guard-closed-asset')).toBeVisible();
  await page.locator('#guard-closed-asset').selectOption('cover');
  await page.locator('#guard-open-asset').selectOption('');
  await page.locator('#guard-autoclose').fill('0');
  await page.locator('#guard-autoclose').dispatchEvent('change');
  expect(await page.evaluate(() => window.__studioApp.state.getComponent('condition-component').layout.guard)).toEqual({ enabled: true, closedAsset: 'cover', openAsset: undefined, autoCloseAfterMs: undefined });
});

test('visibleWhen own value creates one undo step for the state var and condition', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push({ id: 'own-visible', type: 'core.button', props: {}, layout: {}, binding: { readSimVar: 'A:OWN VALUE' } });
    state.undoStack = [];
    state.selectComponent('own-visible');
  });
  await page.getByTestId('inspector-tab-events').click();
  await page.locator('#vw-edit-condition').click();
  await page.locator('#vw-add-condition').click();
  const before = await page.evaluate(() => window.__studioApp.state.getComponent('own-visible').visibleWhen);
  await page.evaluate(() => { window.__studioApp.state.undoStack = []; });
  await page.locator('.studio-modal-box .vw-state').selectOption('__own_value__');
  const changed = await page.evaluate(() => {
    const state = window.__studioApp.state;
    return { vars: state.widgetDef.state.filter((item) => item.syncFrom === 'A:OWN VALUE'), condition: state.getComponent('own-visible').visibleWhen, labels: state.undoStack.map((item) => item.label) };
  });
  expect(changed.vars).toHaveLength(1);
  expect(changed.condition).toEqual({ allOf: [{ state: changed.vars[0].name, equals: '' }] });
  expect(changed.labels).toEqual(["Use This Component's Own Value"]);
  await page.evaluate(() => window.__studioApp.state.undo());
  expect(await page.evaluate(() => ({ vars: window.__studioApp.state.widgetDef.state.filter((item) => item.syncFrom === 'A:OWN VALUE'), condition: window.__studioApp.state.getComponent('own-visible').visibleWhen }))).toEqual({ vars: [], condition: before });
  await page.locator('[data-modal-cancel]').click();
});

const SWEEP_WIDGET_ID = 'com.flightdeck.conditions-sweep';
const SWEEP_COMPONENT_ID = 'conditions-sweep-pin';

// Loads a blank widget with an asset id P under the write recorder, snapshots it, then renders
// renderVisibilityAndGuard directly for an orphan component (visibleWhen comparison value and
// every layout.guard field = P) into a mount appended straight into #studio-right-sidebar.
// The component is never added to widgetDef or selected: selecting it would render every
// Inspector tab, including the Style tab's still-raw (slice 4) asset select, which would also
// pick up this same poisoned asset. Rendering this one section directly, the way the app's own
// #vw-edit-condition button does through the host delegate (ConditionsSection.js:118-124,
// StudioInspector.js:284-285), keeps the check scoped to this slice's own fix.
async function openConditionsCase(page) {
  const renderErrors = collectRenderErrors(page);
  await openStudio(page);
  await installWriteRecorder(page);
  await runSeeding(page, ({ widgetId, assetId }) => {
    window.__studioApp.state.setWidgetDef({ id: widgetId, assets: [{ id: assetId }] }, false, 'sweep');
  }, { widgetId: SWEEP_WIDGET_ID, assetId: P });
  await snapshotWidgetDef(page);
  await page.evaluate(({ componentId, comparisonValue, guardValue }) => {
    const comp = {
      id: componentId,
      type: 'core.button',
      props: {},
      style: {},
      layout: { guard: { enabled: true, closedAsset: guardValue, openAsset: guardValue, autoCloseAfterMs: guardValue } },
      visibleWhen: { state: 'undeclaredVar', equals: comparisonValue },
    };
    const mount = document.createElement('div');
    mount.id = 'conditions-sweep-mount';
    document.getElementById('studio-right-sidebar').appendChild(mount);
    window.__studioApp.inspector.renderVisibilityAndGuard(comp, window.__studioApp.state.widgetDef, mount);
  }, { componentId: SWEEP_COMPONENT_ID, comparisonValue: P, guardValue: P });
  return renderErrors;
}

test('sweep K1: condition value and guard fields render exactly, inject nothing and write nothing', async ({ page }) => {
  const renderErrors = await openConditionsCase(page);
  for (const selector of ['#vw-edit-condition', '#guard-closed-asset', '#guard-open-asset', '#guard-autoclose']) {
    await expect(page.locator(selector), selector).toHaveCount(1);
  }
  expect(await countInjectedInInspector(page)).toBe(0);
  const closedOptionValues = await page.locator('#guard-closed-asset option').evaluateAll((els) => els.map((o) => o.value));
  expect(closedOptionValues).toContain(P);
  const openOptionValues = await page.locator('#guard-open-asset option').evaluateAll((els) => els.map((o) => o.value));
  expect(openOptionValues).toContain(P);
  await expect(page.locator('#guard-autoclose')).toHaveAttribute('value', P);

  await page.locator('#vw-edit-condition').click();
  await expect(page.locator('.studio-modal-box')).toBeVisible();
  await expect(page.locator('.vw-val')).toHaveCount(1);
  expect(await countInjectedInInspector(page)).toBe(0);
  await expect(page.locator('.vw-val')).toHaveValue(P);
  await page.locator('[data-modal-cancel]').click();
  await expect(page.locator('.studio-modal-box')).toHaveCount(0);

  expect(await readWriteCheck(page)).toEqual({ widgetDefChanged: false, writes: [] });
  expect(renderErrors).toEqual([]);
});
