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

async function setup(page, { tier = 'full', type = 'core.button', interactions = [], binding = {} } = {}) {
  await page.addInitScript((mode) => localStorage.setItem('fdws_studio_uiMode', mode), tier);
  await openStudio(page);
  await page.evaluate(({ type, interactions, binding }) => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push({ id: 'interaction-pin', type, label: 'Pin', props: {}, binding, interactions });
    state.undoStack = [];
    state.selectComponent('interaction-pin');
  }, { type, interactions, binding });
}

async function open(page, editIdx = null) {
  await page.evaluate((index) => {
    const app = window.__studioApp;
    app.inspector.openAddInteractionModal(app.state.getComponent('interaction-pin'), index);
  }, editIdx);
  await expect(page.locator('.studio-modal-box')).toBeVisible();
}

async function action(page, type) {
  await page.locator('#im-action-type').selectOption(type);
}

async function submit(page) {
  await page.locator('[data-modal-submit]').click();
  await expect(page.locator('.studio-modal-box')).toHaveCount(0);
  return page.evaluate(() => window.__studioApp.state.getComponent('interaction-pin').interactions.at(-1));
}

async function interactions(page) {
  return page.evaluate(() => window.__studioApp.state.getComponent('interaction-pin').interactions);
}

test('list shows action details and feedback; delete confirms exact message', async ({ page }) => {
  const rows = [{ trigger: 'tap', action: { type: 'core.dispatchEvent', event: 'K:TEST' }, feedback: { haptic: 'medium', sound: 'click' } }];
  await setup(page, { interactions: rows });
  await page.getByTestId('inspector-tab-events').click();
  await expect(page.locator('.interaction-card')).toContainText('tap');
  await expect(page.locator('.interaction-card')).toContainText('Event: K:TEST');
  await expect(page.locator('.interaction-card')).toContainText('Feedback: medium haptic, sound: click');
  await page.locator('.btn-del-inter').click();
  await expect(page.locator('.modal-confirm-text')).toHaveText('Remove the "tap" → dispatchEvent interaction?');
  await page.locator('[data-modal-cancel]').click();
  expect(await interactions(page)).toEqual(rows);
  await page.locator('.btn-del-inter').click();
  await page.locator('[data-modal-submit]').click();
  await expect(page.locator('.interaction-card')).toHaveCount(0);
  expect(await interactions(page)).toEqual([]);
});

test('tier and component type filter triggers and actions; edit prefill belongs to saved type', async ({ page }) => {
  await setup(page, { tier: 'build', type: 'core.stepper', interactions: [{ trigger: 'increment', action: { type: 'core.setLocalState', field: 'saved', value: 7 } }] });
  await open(page, 0);
  expect(await page.locator('#im-trigger option').evaluateAll((els) => els.map((el) => el.value))).toEqual(['tap', 'longpress', 'guardOpen', 'guardClose', 'increment', 'decrement']);
  expect(await page.locator('#im-action-type option').evaluateAll((els) => els.map((el) => [el.value, el.textContent]))).toEqual([
    ['core.dispatchEvent', 'Send a Value to the Simulator'], ['core.setLocalState', 'Set a Value'],
    ['core.swapLocalState', 'Swap Two Values'], ['core.toggleLocalState', 'Toggle On / Off'],
    ['core.openWidgetPopover', 'Open a Popup'],
  ]);
  await expect(page.locator('#im-field')).toHaveValue('saved');
  await action(page, 'core.toggleLocalState');
  await expect(page.locator('#im-field')).toHaveValue('switchOn');
  await page.locator('[data-modal-cancel]').click();
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'full'; });
  await open(page);
  expect(await page.locator('#im-trigger option').evaluateAll((els) => els.map((el) => el.value))).toEqual(['tap', 'longpress', 'guardOpen', 'guardClose', 'increment', 'decrement', 'hold', 'doubleTap', 'release']);
  expect(await page.locator('#im-action-type option').evaluateAll((els) => els.map((el) => el.value))).toEqual([
    'core.dispatchEvent', 'core.setLocalState', 'core.swapLocalState', 'core.toggleLocalState',
    'core.ackIndicator', 'core.openWidgetPopover', 'core.commitToHost', 'core.closePopover',
  ]);
  await page.locator('[data-modal-cancel]').click();
  expect(await interactions(page)).toHaveLength(1);
});

test('action fields validate and coerce literal values, with state ref precedence', async ({ page }) => {
  await setup(page);
  const error = page.locator('[data-modal-error]');
  const cases = [
    ['core.dispatchEvent', '#im-event', 'Choose or type an event to dispatch.'],
    ['core.toggleLocalState', '#im-field', 'State field name is required.'],
    ['core.setLocalState', '#im-field', 'State field name is required.'],
    ['core.swapLocalState', '#im-field1', 'Both fields are required.'],
    ['core.openWidgetPopover', null, 'Save a popover widget first, then pick it here.'],
    ['core.commitToHost', '#im-contextkey', 'Context key is required.'],
  ];
  for (const [type, field, message] of cases) {
    await open(page);
    await action(page, type);
    if (field === '#im-event') await page.locator(field).selectOption('');
    else if (field) await page.locator(field).fill('');
    await page.locator('[data-modal-submit]').click();
    await expect(error).toHaveText(message);
    await page.locator('[data-modal-cancel]').click();
  }
  for (const [value, expected] of [['true', true], ['false', false], ['12.5', 12.5], ['hello', 'hello'], ['', '']]) {
    await open(page);
    await page.locator('#im-event').selectOption('__custom__');
    await page.locator('#im-event-custom').fill('K:TEST');
    await page.locator('#im-value').fill(value);
    expect((await submit(page)).action).toEqual({ type: 'core.dispatchEvent', event: 'K:TEST', value: expected });
  }
  await open(page);
  await page.locator('#im-event').selectOption('__custom__');
  await page.locator('#im-event-custom').fill('K:TEST');
  await page.locator('#im-value').fill('33');
  await page.locator('#im-fromstateref').fill('presets[0].freq');
  expect((await submit(page)).action).toEqual({ type: 'core.dispatchEvent', event: 'K:TEST', fromStateRef: 'presets[0].freq' });
  await open(page);
  await action(page, 'core.setLocalState');
  await page.locator('#im-fromstateref').fill('preset.value');
  expect((await submit(page)).action).toEqual({ type: 'core.setLocalState', field: 'activeMode', fromStateRef: 'preset.value' });
});

test('each remaining action stores its own payload and omits empty feedback', async ({ page }) => {
  await setup(page);
  await open(page);
  await action(page, 'core.toggleLocalState');
  expect((await submit(page)).action).toEqual({ type: 'core.toggleLocalState', field: 'switchOn' });
  await open(page);
  await action(page, 'core.swapLocalState');
  expect((await submit(page)).action).toEqual({ type: 'core.swapLocalState', fields: ['actFreq', 'stbyFreq'] });
  await open(page);
  await action(page, 'core.commitToHost');
  await page.locator('#im-commit-field').fill('scratch');
  expect((await submit(page)).action).toEqual({ type: 'core.commitToHost', contextKey: 'currentLabel', field: 'scratch' });
  await open(page);
  await action(page, 'core.ackIndicator');
  expect((await submit(page)).action).toEqual({ type: 'core.ackIndicator' });
  await open(page);
  await action(page, 'core.ackIndicator');
  await page.locator('#im-event').selectOption('__custom__');
  await page.locator('#im-event-custom').fill('K:ACK');
  expect((await submit(page)).action).toEqual({ type: 'core.ackIndicator', event: 'K:ACK' });
  await open(page);
  await action(page, 'core.closePopover');
  expect(await submit(page)).toEqual({ trigger: 'tap', action: { type: 'core.closePopover' } });
});

test('popover context rows retain writable applyOn and omit it for read-only rows', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    localStorage.setItem('fdws_saved_widgets', JSON.stringify([{ id: 'pin-popover', kind: 'popover', meta: { name: 'Pin Popover' } }]));
  });
  await open(page);
  await action(page, 'core.openWidgetPopover');
  await page.locator('#im-context-add').click();
  await page.locator('.ctx-key').fill('readOnly');
  await page.locator('.ctx-key').dispatchEvent('change');
  await page.locator('.ctx-stateref').fill('source.value');
  await page.locator('.ctx-stateref').dispatchEvent('change');
  await expect(page.locator('.ctx-applyon')).toBeHidden();
  await page.locator('#im-context-add').click();
  await page.locator('.ctx-key').last().fill('editable');
  await page.locator('.ctx-key').last().dispatchEvent('change');
  await page.locator('.ctx-stateref').last().fill('scratch');
  await page.locator('.ctx-stateref').last().dispatchEvent('change');
  await page.locator('.ctx-writable').last().check();
  await page.locator('.ctx-applyon').last().selectOption('immediate');
  expect((await submit(page)).action).toEqual({ type: 'core.openWidgetPopover', popoverWidgetId: 'pin-popover', context: {
    readOnly: { value: { stateRef: 'source.value' }, writable: false },
    editable: { value: { stateRef: 'scratch' }, writable: true, applyOn: 'immediate' },
  } });
  await open(page, 0);
  await expect(page.locator('.ctx-key')).toHaveCount(2);
  await page.locator('.ctx-remove').first().click();
  await expect(page.locator('.ctx-key')).toHaveCount(1);
  await page.locator('[data-modal-cancel]').click();
  expect((await interactions(page))[0].action.context.readOnly).toBeDefined();
});

test('condition editing is deferred, unchecked condition and cancel leave state untouched', async ({ page }) => {
  await setup(page);
  await open(page);
  await page.locator('#im-condition-on').check();
  await page.locator('#imcond-add-condition').last().click();
  expect(await interactions(page)).toEqual([]);
  await page.locator('#im-condition-on').uncheck();
  await page.locator('[data-modal-cancel]').click();
  expect(await interactions(page)).toEqual([]);
  await open(page);
  await page.locator('#im-condition-on').check();
  await page.locator('#imcond-add-condition').last().click();
  await page.locator('#im-condition-on').uncheck();
  await page.locator('#im-event').selectOption('__custom__');
  await page.locator('#im-event-custom').fill('K:TEST');
  expect(await submit(page)).toEqual({ trigger: 'tap', action: { type: 'core.dispatchEvent', event: 'K:TEST', value: 1 } });
});

test('own value commits state var and interaction in one labelled undo step for add and edit', async ({ page }) => {
  await setup(page, { binding: { readSimVar: 'A:TEST VALUE', writeEvent: 'K:TEST' } });
  for (const [index, label] of [[null, 'Add Interaction'], [0, 'Edit Interaction']]) {
    await page.evaluate(() => { window.__studioApp.state.undoStack = []; });
    const before = await page.evaluate(() => window.__studioApp.state.widgetDef.state.length);
    await open(page, index);
    await page.locator('#im-condition-on').check();
    await page.locator('#imcond-add-condition').last().click();
    await page.locator('.imcond-state').last().selectOption('__own_value__');
    expect(await page.evaluate(() => window.__studioApp.state.widgetDef.state.length)).toBe(before);
    await submit(page);
    expect(await page.evaluate(() => window.__studioApp.state.undoStack.map((entry) => entry.label))).toEqual([label]);
    expect(await page.evaluate(() => window.__studioApp.state.widgetDef.state.length)).toBe(index === null ? before + 1 : before);
    expect((await interactions(page))[0].condition).toBeDefined();
  }
});

const SWEEP_WIDGET_ID = 'com.flightdeck.interactions-sweep';
const SWEEP_POPOVER_ID = 'com.flightdeck.sweep-popover';
const SWEEP_COMPONENT_ID = 'interactions-sweep-pin';

// One interaction per non-internal action type, each with trigger P and every action
// string field it has set to P, plus feedback.haptic/sound = P. The last entry has only
// action.type = P, so the card's type badge is checked apart from any known action.
const SWEEP_INTERACTIONS = [
  { trigger: P, action: { type: 'core.dispatchEvent', event: P, value: P, fromStateRef: P }, feedback: { haptic: P, sound: P } },
  { trigger: P, action: { type: 'core.setLocalState', field: P, value: P, fromStateRef: P }, feedback: { haptic: P, sound: P } },
  { trigger: P, action: { type: 'core.swapLocalState', fields: [P, P] }, feedback: { haptic: P, sound: P } },
  { trigger: P, action: { type: 'core.toggleLocalState', field: P }, feedback: { haptic: P, sound: P } },
  { trigger: P, action: { type: 'core.openWidgetPopover', popoverWidgetId: P, context: { [P]: { value: { stateRef: P }, writable: false } } }, feedback: { haptic: P, sound: P } },
  { trigger: P, action: { type: 'core.commitToHost', contextKey: P, field: P }, feedback: { haptic: P, sound: P } },
  { trigger: P, action: { type: 'core.ackIndicator', event: P }, feedback: { haptic: P, sound: P } },
  { trigger: P, action: { type: 'core.closePopover' }, feedback: { haptic: P, sound: P } },
  { trigger: P, action: { type: P } },
];

// Loads a blank widget and adds the sweep component with SWEEP_INTERACTIONS under the write
// recorder, snapshots it, then forces the render under test at the Full tier on the Events tab.
// The widget has no assets because the card list and the delete confirm never read them.
async function openInteractionsCase(page) {
  const renderErrors = collectRenderErrors(page);
  await openStudio(page);
  await installWriteRecorder(page);
  await runSeeding(page, ({ widgetId, componentId, interactionsList }) => {
    const { state } = window.__studioApp;
    state.setWidgetDef({ id: widgetId }, false, 'sweep');
    state.addComponent({ id: componentId, type: 'core.button', label: 'Sweep pin', props: {}, style: {}, interactions: interactionsList });
  }, { widgetId: SWEEP_WIDGET_ID, componentId: SWEEP_COMPONENT_ID, interactionsList: SWEEP_INTERACTIONS });
  await snapshotWidgetDef(page);
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'full'; window.__studioApp.inspector.render(); });
  await page.getByTestId('inspector-tab-events').click();
  return renderErrors;
}

// Seeds an asset with id P (for the Feedback Sound picker) and a saved popover named P, then
// opens the edit modal for SWEEP_INTERACTIONS[idx] with the host call the ✎ button makes. The
// component object is not in widgetDef, so no selection renders the other Inspector tabs over
// the asset P; only the modal is under test.
async function openI2Case(page, idx) {
  const renderErrors = collectRenderErrors(page);
  await openStudio(page);
  await installWriteRecorder(page);
  await runSeeding(page, ({ widgetId, popoverId, popoverName, assetId }) => {
    localStorage.setItem('fdws_saved_widgets', JSON.stringify([{ id: popoverId, kind: 'popover', meta: { name: popoverName } }]));
    window.__studioApp.state.setWidgetDef({ id: widgetId, assets: [{ id: assetId }] }, false, 'sweep');
  }, { widgetId: SWEEP_WIDGET_ID, popoverId: SWEEP_POPOVER_ID, popoverName: P, assetId: P });
  await snapshotWidgetDef(page);
  await page.evaluate(({ componentId, interactionsList, editIdx }) => {
    window.__studioApp.inspector.uiTier = 'full';
    const comp = { id: componentId, type: 'core.button', props: {}, style: {}, interactions: interactionsList };
    window.__im2ModalPromise = window.__studioApp.inspector.openAddInteractionModal(comp, editIdx);
  }, { componentId: SWEEP_COMPONENT_ID, interactionsList: SWEEP_INTERACTIONS, editIdx: idx });
  await expect(page.locator('.studio-modal-box')).toBeVisible();
  return renderErrors;
}

test('sweep I1: one card per interaction renders every action field exactly and injects nothing', async ({ page }) => {
  const renderErrors = await openInteractionsCase(page);
  const cards = page.locator('.interaction-card');
  await expect(cards).toHaveCount(SWEEP_INTERACTIONS.length);
  expect(await countInjectedInInspector(page)).toBe(0);
  expect(await page.locator('.inter-tag').allTextContents()).toEqual(SWEEP_INTERACTIONS.map(() => P));
  expect(await page.locator('.inter-action-type').allTextContents()).toEqual([
    'dispatchEvent', 'setLocalState', 'swapLocalState', 'toggleLocalState',
    'openWidgetPopover', 'commitToHost', 'ackIndicator', 'closePopover', P,
  ]);
  const descTexts = [
    [`Event: ${P}`, `From: ${P}`, `Feedback: ${P} haptic, sound: ${P}`],
    [`Field: ${P}`, `From: ${P}`, `Feedback: ${P} haptic, sound: ${P}`],
    [`Swap: ${P} ↔ ${P}`, `Feedback: ${P} haptic, sound: ${P}`],
    [`Field: ${P}`, `Feedback: ${P} haptic, sound: ${P}`],
    [`Popover: ${P}`, `Feedback: ${P} haptic, sound: ${P}`],
    [`Context Key: ${P}`, `Feedback: ${P} haptic, sound: ${P}`],
    [`Event: ${P}`, `Feedback: ${P} haptic, sound: ${P}`],
    [],
    [],
  ];
  for (const [idx, texts] of descTexts.entries()) {
    for (const text of texts) await expect(cards.nth(idx).locator('.inter-desc'), `card ${idx}: ${text}`).toContainText(text);
  }
  expect(await readWriteCheck(page)).toEqual({ widgetDefChanged: false, writes: [] });
  expect(renderErrors).toEqual([]);
});

function optionList(page, selector) {
  return page.locator(`${selector} option`).evaluateAll((els) => els.map((o) => ({ value: o.value, text: o.textContent })));
}

const I2_CASES = [
  { id: 'dispatchEvent', idx: 0, controls: ['#im-event-custom', '#im-value', '#im-fromstateref'], visible: ['#im-event-custom'], textValues: { '#im-event-custom': P, '#im-value': P, '#im-fromstateref': P } },
  { id: 'setLocalState', idx: 1, controls: ['#im-field', '#im-value', '#im-fromstateref'], visible: [], textValues: { '#im-field': P, '#im-value': P, '#im-fromstateref': P } },
  { id: 'swapLocalState', idx: 2, controls: ['#im-field1', '#im-field2'], visible: [], textValues: { '#im-field1': P, '#im-field2': P } },
  { id: 'toggleLocalState', idx: 3, controls: ['#im-field'], visible: [], textValues: { '#im-field': P } },
  { id: 'openWidgetPopover', idx: 4, controls: ['#im-popover-id', '.ctx-key', '.ctx-stateref'], visible: [], textValues: { '.ctx-key': P, '.ctx-stateref': P }, checkPopoverOption: true },
  { id: 'commitToHost', idx: 5, controls: ['#im-contextkey', '#im-commit-field'], visible: [], textValues: { '#im-contextkey': P, '#im-commit-field': P } },
  { id: 'ackIndicator', idx: 6, controls: ['#im-event-custom'], visible: ['#im-event-custom'], textValues: { '#im-event-custom': P } },
];

for (const c of I2_CASES) {
  test(`sweep I2 ${c.id}: edit modal prefills exactly, injects nothing and writes nothing`, async ({ page }) => {
    const renderErrors = await openI2Case(page, c.idx);
    for (const selector of [...c.controls, '#im-feedback-sound']) await expect(page.locator(selector), selector).toHaveCount(1);
    for (const selector of c.visible) await expect(page.locator(selector), selector).toBeVisible();
    expect(await countInjectedInInspector(page)).toBe(0);
    expect(await optionList(page, '#im-feedback-sound')).toEqual([{ value: '', text: 'None' }, { value: P, text: P }]);
    if (c.checkPopoverOption) expect(await optionList(page, '#im-popover-id')).toEqual([{ value: SWEEP_POPOVER_ID, text: P }]);
    for (const [selector, value] of Object.entries(c.textValues)) await expect(page.locator(selector), selector).toHaveValue(value);
    await page.locator('[data-modal-cancel]').click();
    await expect(page.locator('.studio-modal-box')).toHaveCount(0);
    expect(await readWriteCheck(page)).toEqual({ widgetDefChanged: false, writes: [] });
    expect(renderErrors).toEqual([]);
  });
}

test('sweep I3: delete confirm shows the exact trigger and action type, injects nothing, Cancel writes nothing', async ({ page }) => {
  const renderErrors = await openInteractionsCase(page);
  await page.locator('.btn-del-inter').first().click();
  await expect(page.locator('.modal-confirm-text')).toBeVisible();
  expect(await countInjectedInInspector(page)).toBe(0);
  await expect(page.locator('.modal-confirm-text')).toContainText(P);
  await page.locator('[data-modal-cancel]').click();
  await expect(page.locator('.studio-modal-box')).toHaveCount(0);
  expect(await readWriteCheck(page)).toEqual({ widgetDefChanged: false, writes: [] });
  expect(await page.evaluate((id) => window.__studioApp.state.getComponent(id).interactions.length, SWEEP_COMPONENT_ID)).toBe(SWEEP_INTERACTIONS.length);
  expect(renderErrors).toEqual([]);
});
