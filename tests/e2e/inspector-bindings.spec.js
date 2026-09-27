import {
  test,
  expect,
  openStudio,
  INJECTION_PAYLOAD as P,
  INJECTION_PAYLOAD_2 as P2,
  countInjectedInInspector,
  collectRenderErrors,
  installWriteRecorder,
  runSeeding,
  snapshotWidgetDef,
  readWriteCheck,
} from './fixtures/inspectorHarness.js';

async function seed(page, type = 'core.button', binding = {}, props = {}, { blankState = false } = {}) {
  await openStudio(page);
  if (blankState) {
    await page.evaluate(() => window.__studioApp.state.setWidgetDef({}, false, 'blank'));
  }
  await page.evaluate(({ type, binding, props }) => {
    const { state } = window.__studioApp;
    state.addComponent({ id: 'binding-pin', type, label: 'Binding pin', binding, props, style: {} });
    window.__bindingCalls = [];
    const original = state.updateComponent;
    state.updateComponent = function (...args) {
      window.__bindingCalls.push(structuredClone(args));
      return original.apply(this, args);
    };
  }, { type, binding, props });
  await page.getByTestId('inspector-tab-data').click();
}

async function snapshot(page) {
  return page.evaluate(() => ({
    binding: window.__studioApp.state.widgetDef.components.find((c) => c.id === 'binding-pin').binding,
    calls: window.__bindingCalls,
  }));
}

test('Custom reveals without a commit; a default hides and clears the draft', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'full'; window.__studioApp.inspector.render(); });
  await page.locator('#c-bind-read').selectOption('__custom__');
  await expect(page.locator('#c-bind-read-custom-block')).not.toHaveClass(/hidden/);
  expect((await snapshot(page)).calls).toHaveLength(0);
  await page.locator('#c-bind-read-custom-input').fill('(L:PIN_VALUE)');
  await expect(page.locator('#c-bind-read-custom-diff')).toContainText('Removed');
  await page.locator('#c-bind-read').selectOption('');
  await expect(page.locator('#c-bind-read-custom-block')).toHaveClass(/hidden/);
  await expect(page.locator('#c-bind-read-custom-input')).toHaveValue('');
  expect((await snapshot(page)).calls).toHaveLength(1);
  await page.locator('#c-bind-read').selectOption('__custom__');
  await page.locator('#c-bind-read-custom-input').fill('(L:PIN_VALUE)');
  await page.locator('#c-bind-read-custom-input').dispatchEvent('change');
  expect((await snapshot(page)).binding.readSimVar).toBe('L:PIN_VALUE');
});

test('Simple category selection waits for a value; Full switch persists', async ({ page }) => {
  await seed(page);
  const category = page.locator('#c-connect-read-category');
  const value = page.locator('#c-connect-read-variable');
  await expect(value).toBeDisabled();
  const first = await category.locator('option[value]:not([value=""])').first().getAttribute('value');
  await category.selectOption(first);
  expect((await snapshot(page)).calls).toHaveLength(0);
  const chosen = await value.locator('option[value]:not([value=""])').first().getAttribute('value');
  await value.selectOption(chosen);
  expect((await snapshot(page)).binding.readSimVar).toBe(chosen);
  expect((await snapshot(page)).calls).toHaveLength(1);
  await page.locator('#c-connect-read-full').click();
  expect(await page.evaluate(() => [window.__studioApp.inspector.uiTier, localStorage.getItem('fdws_studio_uiMode')])).toEqual(['full', 'full']);
});

test('Pulse and fast fields use inline gates, and the write Pulse note appears', async ({ page }) => {
  await seed(page, 'core.rotary');
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'full'; window.__studioApp.inspector.render(); });
  await expect(page.locator('#c-bind-increment-field')).toHaveAttribute('style', /display:none/);
  await expect(page.locator('#c-bind-fastincrement-field')).toHaveAttribute('style', /display:none/);
  await expect(page.locator('#c-bind-write-pulse-note')).toHaveCount(0);
  await page.locator('#rf-props-writeMode').selectOption('pulse');
  await expect(page.locator('#c-bind-increment-field')).not.toHaveAttribute('style', /display:none/);
  await expect(page.locator('#c-bind-write-pulse-note')).toBeVisible();
  await page.locator('#rf-props-acceleration').check();
  await expect(page.locator('#c-bind-fastincrement-field')).not.toHaveAttribute('style', /display:none/);
});

test('resolved unit reports profile or no mapping and ignores a detached node', async ({ page }) => {
  await seed(page, 'core.display', { readSimVar: 'apHdgBugValue' });
  await page.evaluate(() => {
    const inspector = window.__studioApp.inspector;
    inspector.uiTier = 'full';
    window.__bindingResolvers = [];
    inspector.simBridge = { connected: true, resolveDeckEvent: () => new Promise((resolve) => { window.__bindingResolvers.push(resolve); }) };
    inspector.render();
  });
  const oldNode = page.locator('#c-bind-resolved-info');
  await expect(oldNode).toHaveText('Resolving…');
  await page.evaluate(() => {
    window.__oldResolved = document.querySelector('#c-bind-resolved-info');
    window.__studioApp.inspector.render();
    window.__bindingResolvers[0]({ unit: 'degrees', profileName: 'Test Profile' });
  });
  expect(await page.evaluate(() => window.__oldResolved.textContent)).toBe('Resolving…');
  await page.evaluate(() => window.__bindingResolvers[1](null));
  await expect(page.locator('#c-bind-resolved-info')).toContainText('has no mapping in the active profile');
  await page.evaluate(() => window.__studioApp.inspector.render());
  await page.evaluate(() => window.__bindingResolvers[2]({ unit: 'knots', profileName: 'Active' }));
  await expect(page.locator('#c-bind-resolved-info')).toHaveText('Unit: knots — from profile "Active"');
});

test('transition and advanced state survive renders; binding fields keep their shapes', async ({ page }) => {
  await seed(page, 'core.button', { stateVar: '$context.old.value' });
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'full'; window.__studioApp.inspector.render(); });
  await expect(page.locator('#c-bind-state-custom-block')).not.toHaveClass(/hidden/);
  await page.locator('#c-bind-state-custom-input').fill('  $context.new.value  ');
  await page.locator('#c-bind-state-custom-input').dispatchEvent('change');
  expect((await snapshot(page)).binding.stateVar).toBe('$context.new.value');
  await page.locator('#c-bind-advanced-toggle').click();
  for (const [id, value, key] of [
    ['#c-bind-stateref', '  presets[0].label  ', 'stateRef'],
    ['#c-bind-sublabelstateref', '  presets[0].freq  ', 'sublabelStateRef'],
    ['#c-bind-pollgroup', '  group  ', 'pollGroup'],
    ['#c-bind-eventcategory', '  CUSTOM  ', 'eventCategory'],
  ]) {
    await page.locator(id).fill(value);
    await page.locator(id).dispatchEvent('change');
    expect((await snapshot(page)).binding[key]).toBe(value.trim());
  }
  await page.locator('#c-bind-pollrate').selectOption('100');
  await page.locator('#c-bind-deadband').fill('0.25');
  await page.locator('#c-bind-deadband').dispatchEvent('change');
  await page.locator('#c-bind-transition-ms').fill('250');
  await page.locator('#c-bind-transition-ms').dispatchEvent('change');
  expect((await snapshot(page)).binding).toMatchObject({ pollFrequencyHz: 100, deadband: 0.25, transition: { durationMs: 250, easing: 'linear' } });
  await page.locator('#c-bind-transition-ms').fill('');
  await page.locator('#c-bind-transition-ms').dispatchEvent('change');
  expect((await snapshot(page)).binding.transition).toBeUndefined();
  await page.evaluate(() => window.__studioApp.inspector.render());
  await expect(page.locator('#c-bind-advanced-fields')).not.toHaveClass(/hidden/);
});

test('tester paste reports four states and writes raw units or strips K:', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'full'; window.__studioApp.inspector.render(); });
  await page.locator('#c-bind-read').selectOption('__custom__');
  await page.locator('#c-bind-write').selectOption('__custom__');
  const paste = async (kind, parsed) => {
    await page.evaluate((value) => { window.__studioApp.state.testerParsed = value; }, parsed);
    if (await page.locator(`#c-bind-${kind}-custom-block`).evaluate((el) => el.classList.contains('hidden'))) {
      await page.locator(`#c-bind-${kind}`).selectOption('__custom__');
    }
    await page.locator(`#c-bind-${kind}-paste`).click();
    return page.locator('.studio-toast').textContent();
  };
  expect(await paste('read', null)).toBe('Nothing parsed yet — use the SimVar Tester in the bottom bar first.');
  expect(await paste('read', { kind: 'complex' })).toBe('That one is test-only — conditionals and multi-token RPN can’t be stored in a binding.');
  expect(await paste('read', { kind: 'write', event: 'K:TEST' })).toBe('That’s a write event — paste it into the Write Deck Event field instead.');
  expect(await paste('write', { kind: 'read', name: 'L:TEST' })).toBe('That’s a read expression — paste it into the Read Deck Event field instead.');
  expect(await paste('read', { kind: 'read', name: 'L:TEST', unit: 'string' })).toBe('Pasted L:TEST (unit string).');
  expect((await snapshot(page)).binding).toMatchObject({ readSimVar: 'L:TEST', unit: 'string' });
  expect(await paste('read', { kind: 'read', name: 'apHdgBugValue', unit: 'degrees' })).toBe('Pasted apHdgBugValue.');
  expect((await snapshot(page)).binding.unit).toBe('string');
  expect(await paste('write', { kind: 'write', event: 'K:TEST', value: 2 })).toBe('Pasted TEST. It also sends the value 2 — a binding has no value field, so set that on this component’s interaction action.');
  expect((await snapshot(page)).binding.writeEvent).toBe('TEST');
});

test('Bound Local State Var picker is hidden in Guided and visible in Build and Full, listing declared vars', async ({ page }) => {
  await seed(page, 'core.button', {}, {}, { blankState: true });
  await page.evaluate(() => window.__studioApp.state.addStateVar({ name: 'switchOn', type: 'boolean', defaultValue: false }));
  await page.locator('[data-mode="guided"]').click();
  await page.getByTestId('inspector-tab-data').click();
  await expect(page.locator('#c-bind-state')).toBeHidden();
  await page.locator('[data-mode="build"]').click();
  await page.getByTestId('inspector-tab-data').click();
  await expect(page.locator('#c-bind-state')).toBeVisible();
  expect(await page.locator('#c-bind-state option').allTextContents()).toEqual(['None', 'switchOn (boolean)', 'Custom…']);
  await page.locator('[data-mode="full"]').click();
  await page.getByTestId('inspector-tab-data').click();
  await expect(page.locator('#c-bind-state')).toBeVisible();
});

test('Bound Local State Var picker binds a declared variable, clears it, and reveals Custom without a write', async ({ page }) => {
  await seed(page, 'core.button', {}, {}, { blankState: true });
  await page.evaluate(() => window.__studioApp.state.addStateVar({ name: 'switchOn', type: 'boolean', defaultValue: false }));
  await page.locator('[data-mode="build"]').click();
  await page.getByTestId('inspector-tab-data').click();
  await page.locator('#c-bind-state').selectOption('switchOn');
  expect((await snapshot(page)).binding.stateVar).toBe('switchOn');
  await page.locator('#c-bind-state').selectOption('');
  expect((await snapshot(page)).binding.stateVar).toBeUndefined();
  const callsBeforeCustom = (await snapshot(page)).calls.length;
  await page.locator('#c-bind-state').selectOption('__custom__');
  await expect(page.locator('#c-bind-state-custom-block')).not.toHaveClass(/hidden/);
  expect((await snapshot(page)).calls).toHaveLength(callsBeforeCustom);
  await page.locator('#c-bind-state-custom-input').fill('$context.x.value');
  await page.locator('#c-bind-state-custom-input').dispatchEvent('change');
  expect((await snapshot(page)).binding.stateVar).toBe('$context.x.value');
});

test('a stored state var naming no declared variable selects Custom with no write on render; a widget with no declared vars offers only None and Custom', async ({ page }) => {
  await seed(page, 'core.button', { stateVar: 'renamedVar' }, {}, { blankState: true });
  await page.locator('[data-mode="build"]').click();
  await page.getByTestId('inspector-tab-data').click();
  expect((await snapshot(page)).calls).toHaveLength(0);
  await expect(page.locator('#c-bind-state')).toHaveValue('__custom__');
  await expect(page.locator('#c-bind-state-custom-input')).toHaveValue('renamedVar');
  expect(await page.locator('#c-bind-state option').allTextContents()).toEqual(['None', 'Custom…']);
});

test('a pollFrequencyHz outside 1/100 still shows Fast (characterization)', async ({ page }) => {
  await seed(page, 'core.button', { pollFrequencyHz: 20 });
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'full'; window.__studioApp.inspector.render(); });
  await expect(page.locator('#c-bind-pollrate')).toHaveValue('100');
});

test('raw unit, indicator Test State Var and Find-it use their existing owners', async ({ page }) => {
  await seed(page, 'core.indicator', { readSimVar: 'L:PIN' });
  await page.evaluate(() => {
    const { state, inspector } = window.__studioApp;
    state.addStateVar({ name: 'LampTest', type: 'boolean', defaultValue: false });
    inspector.uiTier = 'full';
    inspector.simVarTester = { open() { window.__findItCalls = (window.__findItCalls || 0) + 1; } };
    inspector.render();
  });
  await page.locator('#c-bind-unit').fill('string');
  await page.locator('#c-bind-unit').dispatchEvent('change');
  await page.locator('#c-bind-teststatevar').selectOption('LampTest');
  expect((await snapshot(page)).binding).toMatchObject({ unit: 'string', testStateVar: 'LampTest' });
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'guided'; window.__studioApp.inspector.render(); });
  await page.locator('#c-connect-read-findit').click();
  expect(await page.evaluate(() => window.__findItCalls)).toBe(1);
});

const SWEEP_WIDGET_ID = 'com.flightdeck.bindings-sweep';
const NO_CUSTOM_EVENTS = '(no custom Deck Events in use yet — try importing a Community Pack in the Library tab)';
const SAVED_WRITE_OPTIONS = [['', '— select or type below —'], [P2, `${P2} (used by ${P})`]];
const WRITE_KINDS = ['write', 'increment', 'decrement', 'fastincrement', 'fastdecrement', 'ack', 'push'];

// Loads a blank widget with the given state vars and component under the write recorder, snapshots it,
// then forces the render under test: the given tier, Advanced open, on the Data tab.
async function openBindingsCase(page, { stateVars = [], component, savedWidgets = [], tier = 'full' }) {
  const renderErrors = collectRenderErrors(page);
  await openStudio(page);
  await installWriteRecorder(page);
  await runSeeding(page, ({ widgetId, vars, comp, saved }) => {
    localStorage.setItem('fdws_saved_widgets', JSON.stringify(saved));
    const { state } = window.__studioApp;
    state.setWidgetDef({ id: widgetId, state: vars }, false, 'sweep');
    state.addComponent(comp);
  }, { widgetId: SWEEP_WIDGET_ID, vars: stateVars, comp: component, saved: savedWidgets });
  await snapshotWidgetDef(page);
  await page.evaluate((uiTier) => {
    const { inspector } = window.__studioApp;
    inspector.uiTier = uiTier;
    inspector._bindingAdvancedOpen = true;
    inspector.render();
  }, tier);
  await page.getByTestId('inspector-tab-data').click();
  return renderErrors;
}

function optionsOf(page, selector) {
  return page.locator(selector).locator('option').evaluateAll((options) => options.map((o) => [o.value, o.textContent]));
}

function dataBadge(page) {
  return page.locator('#studio-right-sidebar .inspector-tab-section-header')
    .filter({ has: page.locator('.group-title', { hasText: /^DATA & CONTENT$/ }) })
    .locator('.group-badge');
}

const BINDINGS_SWEEP_CASES = [
  {
    id: 'B1',
    title: 'Pulse rotary event fields with acceleration and Advanced open',
    savedWidgets: [{ id: P, kind: 'widget', components: [{ id: 'saved-button', type: 'core.button', binding: { writeEvent: P2 } }] }],
    component: {
      id: 'sweep-pin',
      type: 'core.rotary',
      label: 'Sweep pin',
      props: { writeMode: 'pulse', acceleration: true },
      style: {},
      binding: {
        readSimVar: P,
        writeEvent: P,
        incrementEvent: P,
        decrementEvent: P,
        fastIncrementEvent: P,
        fastDecrementEvent: P,
        ackEvent: P,
        pushEvent: P,
        unit: P,
        pollGroup: P,
        eventCategory: P,
        stateRef: P,
        deadband: P,
        transition: { durationMs: P },
      },
    },
    visible: ['read', ...WRITE_KINDS].map((kind) => `#c-bind-${kind}-custom-block`),
    selects: {
      '#c-bind-read-custom-select': { options: [['', NO_CUSTOM_EVENTS]] },
      ...Object.fromEntries(WRITE_KINDS.map((kind) => [`#c-bind-${kind}-custom-select`, { options: SAVED_WRITE_OPTIONS }])),
    },
    textValues: {
      ...Object.fromEntries(['read', ...WRITE_KINDS].map((kind) => [`#c-bind-${kind}-custom-input`, P])),
      '#c-bind-unit': P,
      '#c-bind-pollgroup': P,
      '#c-bind-eventcategory': P,
      '#c-bind-stateref': P,
    },
    numberAttributes: { '#c-bind-deadband': P, '#c-bind-transition-ms': P },
    dataBadge: `↔ ${P}`,
  },
  {
    id: 'B2',
    title: 'an undeclared state var shows Custom beside a declared payload var',
    stateVars: [{ name: P, type: P, defaultValue: false }],
    component: { id: 'sweep-pin', type: 'core.button', label: 'Sweep pin', props: {}, style: {}, binding: { stateVar: P2, sublabelStateRef: P } },
    visible: ['#c-bind-state-custom-block'],
    selects: { '#c-bind-state': { options: [['', 'None'], [P, `${P} (${P})`], ['__custom__', 'Custom…']], value: '__custom__' } },
    textValues: { '#c-bind-state-custom-input': P2, '#c-bind-sublabelstateref': P },
    numberAttributes: {},
    dataBadge: `state: ${P2}`,
  },
  {
    id: 'B3',
    title: 'the indicator Test State Var selects a declared payload var',
    stateVars: [{ name: P, type: P, defaultValue: false }],
    component: { id: 'sweep-pin', type: 'core.indicator', label: 'Sweep pin', props: {}, style: {}, binding: { testStateVar: P } },
    visible: [],
    selects: {
      '#c-bind-teststatevar': { options: [['', 'None'], [P, `${P} (${P})`]], value: P },
      '#c-bind-state': { options: [['', 'None'], [P, `${P} (${P})`], ['__custom__', 'Custom…']], value: '' },
    },
    textValues: {},
    numberAttributes: {},
  },
];

for (const c of BINDINGS_SWEEP_CASES) {
  test(`sweep ${c.id}: ${c.title} render exactly, inject nothing and write nothing`, async ({ page }) => {
    const renderErrors = await openBindingsCase(page, c);
    const controls = [...c.visible, ...Object.keys(c.selects), ...Object.keys(c.textValues), ...Object.keys(c.numberAttributes)];
    for (const selector of controls) await expect(page.locator(selector), selector).toHaveCount(1);
    for (const selector of c.visible) await expect(page.locator(selector), selector).toBeVisible();
    expect(await countInjectedInInspector(page)).toBe(0);
    for (const [selector, { options, value }] of Object.entries(c.selects)) {
      expect(await optionsOf(page, selector), selector).toEqual(options);
      if (value !== undefined) await expect(page.locator(selector), selector).toHaveValue(value);
    }
    for (const [selector, value] of Object.entries(c.textValues)) await expect(page.locator(selector), selector).toHaveValue(value);
    for (const [selector, value] of Object.entries(c.numberAttributes)) await expect(page.locator(selector), selector).toHaveAttribute('value', value);
    if (c.dataBadge) await expect(dataBadge(page)).toHaveText(c.dataBadge);
    expect(await readWriteCheck(page)).toEqual({ widgetDefChanged: false, writes: [] });
    expect(renderErrors).toEqual([]);
  });
}

test('state var names with quotes round-trip through both pickers and stay separate', async ({ page }) => {
  const renderErrors = await openBindingsCase(page, {
    stateVars: ['say "hi"', 'a"', 'a&quot;'].map((name) => ({ name, type: 'boolean', defaultValue: false })),
    component: { id: 'sweep-pin', type: 'core.indicator', label: 'Sweep pin', props: {}, style: {}, binding: { stateVar: 'say "hi"', testStateVar: 'say "hi"' } },
  });
  const declared = ['', 'say "hi"', 'a"', 'a&quot;'];
  const pickers = [['#c-bind-state', 'stateVar', [...declared, '__custom__']], ['#c-bind-teststatevar', 'testStateVar', declared]];
  for (const [selector, , values] of pickers) {
    await expect(page.locator(selector)).toHaveValue('say "hi"');
    expect((await optionsOf(page, selector)).map(([value]) => value), selector).toEqual(values);
  }
  expect(await readWriteCheck(page)).toEqual({ widgetDefChanged: false, writes: [] });
  const stored = (key) => page.evaluate((field) => window.__studioApp.state.getComponent('sweep-pin').binding[field], key);
  for (const [selector, key] of pickers) {
    for (const name of ['a"', 'a&quot;']) {
      await page.locator(selector).selectOption(name);
      expect(await stored(key), `${selector} ${name}`).toBe(name);
      await expect(page.locator(selector)).toHaveValue(name);
    }
  }
  expect(renderErrors).toEqual([]);
});

test('a declared state var renders preselected in Build with the Custom block hidden and no write', async ({ page }) => {
  const renderErrors = await openBindingsCase(page, {
    tier: 'build',
    stateVars: [{ name: 'switchOn', type: 'boolean', defaultValue: false }],
    component: { id: 'sweep-pin', type: 'core.button', label: 'Sweep pin', props: {}, style: {}, binding: { stateVar: 'switchOn' } },
  });
  await expect(page.locator('#c-bind-state')).toBeVisible();
  await expect(page.locator('#c-bind-state')).toHaveValue('switchOn');
  await expect(page.locator('#c-bind-state-custom-block')).toHaveClass(/hidden/);
  expect(await readWriteCheck(page)).toEqual({ widgetDefChanged: false, writes: [] });
  expect(renderErrors).toEqual([]);
});
