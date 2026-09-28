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

test('the Pulse fields render only once Pulse is on, the fast fields once Pulse and Acceleration are on, and the write Pulse note appears', async ({ page }) => {
  await seed(page, 'core.rotary');
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'full'; window.__studioApp.inspector.render(); });
  await expect(page.locator('#c-bind-increment-field')).toHaveCount(0);
  await expect(page.locator('#c-bind-fastincrement')).toHaveCount(0);
  await expect(page.locator('#c-bind-write-pulse-note')).toHaveCount(0);
  await page.locator('#rf-props-writeMode').selectOption('pulse');
  await expect(page.locator('#c-bind-increment-field')).toBeVisible();
  await expect(page.locator('#c-bind-fastincrement')).toHaveCount(0);
  await expect(page.locator('#c-bind-write-pulse-note')).toBeVisible();
  await page.locator('#rf-props-acceleration').check();
  await expect(page.locator('#c-bind-fastincrement')).toBeVisible();
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

test('transition survives renders; binding fields keep their shapes',async ({ page }) => {
  await seed(page, 'core.button', { stateVar: '$context.old.value' });
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'full'; window.__studioApp.inspector.render(); });
  await expect(page.locator('#c-bind-state-custom-block')).not.toHaveClass(/hidden/);
  await page.locator('#c-bind-state-custom-input').fill('  $context.new.value  ');
  await page.locator('#c-bind-state-custom-input').dispatchEvent('change');
  expect((await snapshot(page)).binding.stateVar).toBe('$context.new.value');
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
});

function subtitle(page, text) {
  return page.locator('#studio-right-sidebar .prop-section-subtitle').filter({ hasText: new RegExp(`^${text}$`) });
}

test('the State Path rows render under the Local State heading in Full, write trimmed text in one update, and blank removes the key', async ({ page }) => {
  await seed(page, 'core.button', { stateRef: 'presets[0].label' });
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'full'; window.__studioApp.inspector.render(); });
  await expect(subtitle(page, 'Local State')).toBeVisible();
  const localState = subtitle(page, 'Local State').locator('xpath=following-sibling::div[1]');
  await expect(localState.locator('#c-bind-stateref')).toHaveValue('presets[0].label');
  await expect(localState.locator('#c-bind-sublabelstateref')).toHaveAttribute('placeholder', 'e.g. presets[0].freq');
  await expect(localState.locator('.prop-field', { has: page.locator('#c-bind-stateref') }).locator('label')).toHaveText('Bind to Local State Path ⓘ');
  const stateRefTooltip = await page.evaluate(async () => (await import('/widgets/PropertyRegistry.js'))
    .getFieldsForType('core.button').find((f) => f.path === 'binding.stateRef').tooltip);
  await expect(localState.locator('.prop-field', { has: page.locator('#c-bind-stateref') }).locator('label .prop-hint')).toHaveAttribute('title', stateRefTooltip);
  await page.locator('#c-bind-sublabelstateref').fill('  presets[1].freq  ');
  await page.locator('#c-bind-sublabelstateref').dispatchEvent('change');
  // A synthetic change leaves the input dirty, so the re-render that replaces the focused input
  // fires one more, identical, change; every update must still be the one merged binding.
  const { calls: firstCalls } = await snapshot(page);
  expect(firstCalls.length).toBeGreaterThan(0);
  for (const call of firstCalls) {
    expect(call).toEqual(['binding-pin', { binding: { stateRef: 'presets[0].label', sublabelStateRef: 'presets[1].freq' } }]);
  }
  await page.locator('#c-bind-stateref').fill('   ');
  await page.locator('#c-bind-stateref').dispatchEvent('change');
  const { binding } = await snapshot(page);
  expect(binding.stateRef).toBeUndefined();
  expect(binding.sublabelStateRef).toBe('presets[1].freq');
});

test('a supplied State Path row with no label shows its humanized path and no ⓘ', async ({ page }) => {
  await seed(page);
  await page.evaluate(async () => {
    const { getFieldsForType } = await import('/widgets/PropertyRegistry.js');
    const { inspector } = window.__studioApp;
    inspector.getFieldsForType = (t) => [...getFieldsForType(t), { path: 'binding.probeRef', control: 'stateRefPicker', tier: 'advanced', group: 'Local State' }];
    inspector.uiTier = 'full';
    inspector.render();
  });
  await expect(page.locator('#rf-binding-probeRef')).toBeVisible();
  const label = page.locator('.prop-field', { has: page.locator('#rf-binding-probeRef') }).locator('label');
  await expect(label).toHaveText('Probe Ref');
  await expect(label.locator('.prop-hint')).toHaveCount(0);
  await page.evaluate(() => Reflect.deleteProperty(window.__studioApp.inspector, 'getFieldsForType'));
});

test('a stored Sublabel State Path shows in Guided; unauthored State Path rows and their heading do not', async ({ page }) => {
  await seed(page, 'core.button', { sublabelStateRef: 'presets[0].freq' });
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'guided'; window.__studioApp.inspector.render(); });
  await expect(page.locator('#c-bind-sublabelstateref')).toBeVisible();
  await expect(page.locator('#c-bind-sublabelstateref')).toHaveValue('presets[0].freq');
  await expect(page.locator('#c-bind-stateref')).toBeHidden();
  await expect(subtitle(page, 'Local State')).toBeVisible();
  await page.locator('#c-bind-sublabelstateref').fill('');
  await page.locator('#c-bind-sublabelstateref').dispatchEvent('change');
  expect((await snapshot(page)).binding.sublabelStateRef).toBeUndefined();
  await expect(page.locator('#c-bind-sublabelstateref')).toBeHidden();
  await expect(subtitle(page, 'Local State')).toBeHidden();
});

test('the scalar rows render under Read from Simulator and Send to Simulator in Full with their row text, and write today\'s values', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'full'; window.__studioApp.inspector.render(); });
  const read = subtitle(page, 'Read from Simulator').locator('xpath=following-sibling::div[1]');
  const send = subtitle(page, 'Send to Simulator').locator('xpath=following-sibling::div[1]');
  await expect(subtitle(page, 'Read from Simulator')).toBeVisible();
  await expect(subtitle(page, 'Send to Simulator')).toBeVisible();
  const rows = await page.evaluate(async () => (await import('/widgets/PropertyRegistry.js'))
    .getFieldsForType('core.button').filter((f) => ['binding.pollFrequencyHz', 'binding.pollGroup', 'binding.deadband', 'binding.eventCategory'].includes(f.path))
    .map(({ path, label, tooltip, placeholder }) => ({ path, label, tooltip, placeholder })));
  const ids = { 'binding.pollFrequencyHz': '#c-bind-pollrate', 'binding.pollGroup': '#c-bind-pollgroup', 'binding.deadband': '#c-bind-deadband', 'binding.eventCategory': '#c-bind-eventcategory' };
  expect(rows).toHaveLength(4);
  for (const row of rows) {
    const heading = row.path === 'binding.eventCategory' ? send : read;
    const field = heading.locator('.prop-field', { has: page.locator(ids[row.path]) });
    await expect(page.locator(ids[row.path]), row.path).toBeVisible();
    await expect(field.locator('label'), row.path).toHaveText(`${row.label} ⓘ`);
    await expect(field.locator('label .prop-hint'), row.path).toHaveAttribute('title', row.tooltip);
  }
  await expect(page.locator('#c-bind-pollgroup')).toHaveAttribute('placeholder', rows.find((r) => r.path === 'binding.pollGroup').placeholder);
  expect(await optionsOf(page, '#c-bind-pollrate')).toEqual([['1', 'Normal (1Hz)'], ['100', 'Fast (~100Hz)']]);
  await expect(page.locator('#c-bind-pollrate')).toHaveValue('1');
  await expect(page.locator('#c-bind-deadband')).toHaveValue('0');
  await expect(page.locator('#c-bind-deadband')).toHaveAttribute('min', '0');
  await expect(page.locator('#c-bind-deadband')).toHaveAttribute('step', '0.01');
  await expect(page.locator('#c-bind-eventcategory')).toHaveValue('K_EVENT');
  expect((await snapshot(page)).calls).toHaveLength(0);

  await page.locator('#c-bind-pollrate').selectOption('100');
  expect((await snapshot(page)).binding.pollFrequencyHz).toBe(100);
  await page.locator('#c-bind-pollrate').selectOption('1');
  expect((await snapshot(page)).binding.pollFrequencyHz).toBe(1);
  await page.locator('#c-bind-deadband').fill('0.5');
  await page.locator('#c-bind-deadband').dispatchEvent('change');
  expect((await snapshot(page)).binding.deadband).toBe(0.5);
  await page.locator('#c-bind-deadband').fill('');
  await page.locator('#c-bind-deadband').dispatchEvent('change');
  expect((await snapshot(page)).binding.deadband).toBe(0);
  // The floor holds for stepping: ▼ at 0 stores 0, not -0.01.
  await page.locator('#c-bind-deadband').evaluate((input) => input.closest('.prop-number-wrap').querySelector('.prop-number-chevron-down').click());
  expect((await snapshot(page)).binding.deadband).toBe(0);
  for (const [id, key] of [['#c-bind-pollgroup', 'pollGroup'], ['#c-bind-eventcategory', 'eventCategory']]) {
    await page.locator(id).fill('  VALUE  ');
    await page.locator(id).dispatchEvent('change');
    expect((await snapshot(page)).binding[key], key).toBe('VALUE');
    await page.locator(id).fill('   ');
    await page.locator(id).dispatchEvent('change');
    expect((await snapshot(page)).binding[key], key).toBeUndefined();
  }
  await expect(page.locator('#c-bind-eventcategory')).toHaveValue('K_EVENT');
});

test('Poll Rate is hidden in Guided while unauthored, and Event Category is Full-only', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'guided'; window.__studioApp.inspector.render(); });
  for (const id of ['#c-bind-pollrate', '#c-bind-deadband', '#c-bind-pollgroup', '#c-bind-eventcategory']) await expect(page.locator(id), id).toBeHidden();
  // Read's Guided picker sits under this heading, so it shows while Poll Rate and the other rows stay hidden.
  await expect(subtitle(page, 'Read from Simulator')).toBeVisible();
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'build'; window.__studioApp.inspector.render(); });
  await expect(page.locator('#c-bind-pollrate')).toBeVisible();
  await expect(page.locator('#c-bind-eventcategory')).toBeHidden();
});

test('a stored Dead Band of 5 and a stored Poll Rate of 100 show in Guided', async ({ page }) => {
  await seed(page, 'core.button', { deadband: 5, pollFrequencyHz: 100 });
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'guided'; window.__studioApp.inspector.render(); });
  await expect(subtitle(page, 'Read from Simulator')).toBeVisible();
  await expect(page.locator('#c-bind-deadband')).toBeVisible();
  await expect(page.locator('#c-bind-deadband')).toHaveValue('5');
  await expect(page.locator('#c-bind-pollrate')).toBeVisible();
  await expect(page.locator('#c-bind-pollrate')).toHaveValue('100');
  await expect(page.locator('#c-bind-pollgroup')).toBeHidden();
  expect((await snapshot(page)).calls).toHaveLength(0);
});

test('the generic text renderer still writes props.sublabel untrimmed, and blank as an empty string (characterization)', async ({ page }) => {
  await seed(page);
  const sublabel = () => page.evaluate(() => window.__studioApp.state.widgetDef.components.find((c) => c.id === 'binding-pin').props.sublabel);
  for (const tier of ['build', 'full']) {
    await page.evaluate((t) => { window.__studioApp.inspector.uiTier = t; window.__studioApp.inspector.render(); }, tier);
    await expect(page.locator('#rf-props-sublabel'), tier).toBeVisible();
  }
  await page.locator('#rf-props-sublabel').fill('  Sub  ');
  await page.locator('#rf-props-sublabel').dispatchEvent('change');
  expect(await sublabel()).toBe('  Sub  ');
  await page.locator('#rf-props-sublabel').fill('');
  await page.locator('#rf-props-sublabel').dispatchEvent('change');
  expect(await sublabel()).toBe('');
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

test('State Var and Test State Var render under Local State from the registry with the row text, and Test State Var offers no Custom', async ({ page }) => {
  await seed(page, 'core.indicator', {}, {}, { blankState: true });
  await page.evaluate(() => {
    const { state, inspector } = window.__studioApp;
    state.addStateVar({ name: 'LampTest', type: 'boolean', defaultValue: false });
    inspector.uiTier = 'full';
    inspector.render();
  });
  const localState = subtitle(page, 'Local State').locator('xpath=following-sibling::div[1]');
  const ids = await localState.locator('#c-bind-state, #c-bind-stateref, #c-bind-teststatevar').evaluateAll((els) => els.map((el) => el.id));
  expect(ids).toEqual(['c-bind-state', 'c-bind-stateref', 'c-bind-teststatevar']);
  const rows = await page.evaluate(async () => (await import('/widgets/PropertyRegistry.js'))
    .getFieldsForType('core.indicator').filter((f) => ['binding.stateVar', 'binding.testStateVar'].includes(f.path))
    .map(({ path, label, tooltip }) => ({ path, label, tooltip })));
  expect(rows).toHaveLength(2);
  const idOf = { 'binding.stateVar': '#c-bind-state', 'binding.testStateVar': '#c-bind-teststatevar' };
  for (const row of rows) {
    const field = localState.locator('.prop-field', { has: page.locator(idOf[row.path]) });
    await expect(field.locator('label').first(), row.path).toHaveText(`${row.label} ⓘ`);
    await expect(field.locator('label .prop-hint').first(), row.path).toHaveAttribute('title', row.tooltip);
  }
  expect(await optionsOf(page, '#c-bind-state')).toEqual([['', 'None'], ['LampTest', 'LampTest (boolean)'], ['__custom__', 'Custom…']]);
  expect(await optionsOf(page, '#c-bind-teststatevar')).toEqual([['', 'None'], ['LampTest', 'LampTest (boolean)']]);
  await expect(page.locator('#c-bind-state-custom-block')).toHaveClass(/hidden/);
  expect((await snapshot(page)).calls).toHaveLength(0);
  await page.locator('#c-bind-teststatevar').selectOption('LampTest');
  expect((await snapshot(page)).binding.testStateVar).toBe('LampTest');
  await page.locator('#c-bind-teststatevar').selectOption('');
  expect((await snapshot(page)).binding.testStateVar).toBeUndefined();
});

test('a stored custom state var shows its block, selected and filled, at every UI tier', async ({ page }) => {
  await seed(page, 'core.button', { stateVar: '$context.x.value' });
  for (const tier of ['guided', 'build', 'full']) {
    await page.evaluate((t) => { window.__studioApp.inspector.uiTier = t; window.__studioApp.inspector.render(); }, tier);
    await expect(page.locator('#c-bind-state'), tier).toBeVisible();
    await expect(page.locator('#c-bind-state'), tier).toHaveValue('__custom__');
    await expect(page.locator('#c-bind-state-custom-block'), tier).toBeVisible();
    await expect(page.locator('#c-bind-state-custom-input'), tier).toHaveValue('$context.x.value');
  }
  expect((await snapshot(page)).calls).toHaveLength(0);
});

test('a stored Transition, State Var and Test State Var show in Guided; unauthored ones do not', async ({ page }) => {
  await seed(page, 'core.indicator', { transition: { durationMs: 250, easing: 'ease-out' }, stateVar: 'LampTest', testStateVar: 'LampTest' }, {}, { blankState: true });
  await page.evaluate(() => {
    const { state, inspector } = window.__studioApp;
    state.addStateVar({ name: 'LampTest', type: 'boolean', defaultValue: false });
    inspector.uiTier = 'guided';
    inspector.render();
  });
  for (const id of ['#c-bind-transition-ms', '#c-bind-transition-easing', '#c-bind-state', '#c-bind-teststatevar']) await expect(page.locator(id), id).toBeVisible();
  await expect(page.locator('#c-bind-transition-ms')).toHaveValue('250');
  await expect(page.locator('#c-bind-transition-easing')).toHaveValue('ease-out');
  await expect(page.locator('#c-bind-state')).toHaveValue('LampTest');
  await expect(page.locator('#c-bind-teststatevar')).toHaveValue('LampTest');
  await expect(subtitle(page, 'Local State')).toBeVisible();
  expect((await snapshot(page)).calls).toHaveLength(0);

  await seed(page, 'core.indicator', {}, {}, { blankState: true });
  await page.evaluate(() => {
    const { state, inspector } = window.__studioApp;
    state.addStateVar({ name: 'LampTest', type: 'boolean', defaultValue: false });
    inspector.uiTier = 'guided';
    inspector.render();
  });
  for (const id of ['#c-bind-transition-ms', '#c-bind-state', '#c-bind-teststatevar']) await expect(page.locator(id), id).toBeHidden();
  await expect(subtitle(page, 'Local State')).toBeHidden();
});

test('Transition renders from the registry with the row text and today\'s ids, and every write is one merged update', async ({ page }) => {
  await seed(page, 'core.button', { transition: { durationMs: 100, easing: 'ease-out' } });
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'full'; window.__studioApp.inspector.render(); });
  const read = subtitle(page, 'Read from Simulator').locator('xpath=following-sibling::div[1]');
  const row = await page.evaluate(async () => {
    const { tooltip, label } = (await import('/widgets/PropertyRegistry.js')).getFieldsForType('core.button').find((f) => f.path === 'binding.transition');
    return { tooltip, label };
  });
  const label = read.locator('label').filter({ hasText: /^Transition \(ms\)/ });
  await expect(label).toHaveText(`${row.label} ⓘ`);
  await expect(label.locator('.prop-hint')).toHaveAttribute('title', row.tooltip);
  await expect(page.locator('#c-bind-transition-ms')).toHaveAttribute('placeholder', 'none');
  await expect(page.locator('#c-bind-transition-ms')).toHaveValue('100');
  await expect(page.locator('#c-bind-transition-easing')).toHaveValue('ease-out');
  expect(await optionsOf(page, '#c-bind-transition-easing')).toEqual([['linear', 'Linear'], ['ease-out', 'Ease Out'], ['ease-in-out', 'Ease In-Out']]);
  expect((await snapshot(page)).calls).toHaveLength(0);

  await page.locator('#c-bind-transition-easing').selectOption('ease-in-out');
  expect((await snapshot(page)).calls.at(-1)).toEqual(['binding-pin', { binding: { transition: { durationMs: 100, easing: 'ease-in-out' } } }]);
  await page.locator('#c-bind-transition-ms').fill('250');
  await page.locator('#c-bind-transition-ms').dispatchEvent('change');
  expect((await snapshot(page)).calls.at(-1)).toEqual(['binding-pin', { binding: { transition: { durationMs: 250, easing: 'ease-in-out' } } }]);
  await page.locator('#c-bind-transition-ms').fill('0');
  await page.locator('#c-bind-transition-ms').dispatchEvent('change');
  expect((await snapshot(page)).binding.transition).toEqual({ durationMs: 0, easing: 'ease-in-out' });
  await page.locator('#c-bind-transition-ms').fill('');
  await page.locator('#c-bind-transition-ms').dispatchEvent('change');
  expect((await snapshot(page)).binding.transition).toBeUndefined();
  await expect(page.locator('#c-bind-transition-easing')).toHaveValue('linear');
});

test('the generic stateVarPicker still renders "— none —" for props.compose.stateVar, and blank writes undefined (characterization)', async ({ page }) => {
  await seed(page, 'core.gauge', {}, { compose: { stateVar: 'level' } }, { blankState: true });
  const result = await page.evaluate(async () => {
    const { TYPE_FIELDS } = await import('/widgets/PropertyRegistry.js');
    const { state, inspector } = window.__studioApp;
    state.addStateVar({ name: 'level', type: 'number', defaultValue: 0 });
    const comp = state.getComponent('binding-pin');
    const field = TYPE_FIELDS['core.gauge'].find((item) => item.path === 'props.compose.stateVar');
    const mount = document.createElement('div');
    inspector.FIELD_RENDERERS[field.control](comp, field, mount);
    document.body.append(mount);
    const select = mount.querySelector('select');
    const options = [...select.querySelectorAll('option')].map((o) => [o.value, o.textContent]);
    const shown = select.value;
    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    mount.remove();
    return { options, shown, stored: state.getComponent('binding-pin').props.compose.stateVar };
  });
  expect(result.options).toEqual([['', '— none —'], ['level', 'level (number)']]);
  expect(result.shown).toBe('level');
  expect(result.stored).toBeUndefined();
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

test('Acknowledge and Push render from the registry in Full with no Advanced toggle, under Send to Simulator with the row text', async ({ page }) => {
  await seed(page, 'core.indicator');
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'full'; window.__studioApp.inspector.render(); });
  await expect(page.locator('#c-bind-advanced-toggle')).toHaveCount(0);
  await expect(page.locator('#c-bind-advanced-fields')).toHaveCount(0);
  const send = subtitle(page, 'Send to Simulator').locator('xpath=following-sibling::div[1]');
  const rows = await page.evaluate(async () => (await import('/widgets/PropertyRegistry.js'))
    .getFieldsForType('core.indicator').filter((f) => ['binding.ackEvent', 'binding.pushEvent'].includes(f.path))
    .map(({ path, label, tooltip }) => ({ path, label, tooltip })));
  expect(rows).toHaveLength(2);
  const idOf = { 'binding.ackEvent': '#c-bind-ack', 'binding.pushEvent': '#c-bind-push' };
  for (const row of rows) {
    const field = send.locator('.prop-field', { has: page.locator(idOf[row.path]) }).first();
    await expect(page.locator(idOf[row.path]), row.path).toBeVisible();
    await expect(field.locator('label').first(), row.path).toHaveText(`${row.label} ⓘ`);
    await expect(field.locator('label .prop-hint').first(), row.path).toHaveAttribute('title', row.tooltip);
    const options = await optionsOf(page, idOf[row.path]);
    expect(options[0], row.path).toEqual(['', '— none —']);
    expect(options.at(-1), row.path).toEqual(['__custom__', 'Custom…']);
    expect(options.map(([value]) => value), row.path).toContain('apHdgSet');
    await expect(page.locator(`${idOf[row.path]}-connect`), row.path).toBeVisible();
    await expect(page.locator(`${idOf[row.path]}-custom-block`), row.path).toHaveClass(/hidden/);
  }
  expect((await snapshot(page)).calls).toHaveLength(0);
});

test('Acknowledge and Push are Full-only while unauthored; a stored value shows at every tier, a custom one with its block', async ({ page }) => {
  await seed(page, 'core.indicator');
  for (const tier of ['guided', 'build']) {
    await page.evaluate((t) => { window.__studioApp.inspector.uiTier = t; window.__studioApp.inspector.render(); }, tier);
    for (const id of ['#c-bind-ack', '#c-bind-push']) await expect(page.locator(id), `${tier} ${id}`).toBeHidden();
    // Write's Guided picker sits under this heading, so it shows while Acknowledge and Push do not.
    await expect(subtitle(page, 'Send to Simulator'), tier).toBeVisible();
  }
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'full'; window.__studioApp.inspector.render(); });
  for (const id of ['#c-bind-ack', '#c-bind-push']) await expect(page.locator(id), id).toBeVisible();

  await seed(page, 'core.indicator', { ackEvent: 'apHdgSet', pushEvent: 'H:MY_PUSH' });
  for (const tier of ['guided', 'build', 'full']) {
    await page.evaluate((t) => { window.__studioApp.inspector.uiTier = t; window.__studioApp.inspector.render(); }, tier);
    await expect(subtitle(page, 'Send to Simulator'), tier).toBeVisible();
    await expect(page.locator('#c-bind-ack'), tier).toBeVisible();
    await expect(page.locator('#c-bind-ack'), tier).toHaveValue('apHdgSet');
    await expect(page.locator('#c-bind-push'), tier).toHaveValue('__custom__');
    await expect(page.locator('#c-bind-push-custom-block'), tier).toBeVisible();
    await expect(page.locator('#c-bind-push-custom-input'), tier).toHaveValue('H:MY_PUSH');
    await expect(page.locator('#c-bind-ack-custom-block'), tier).toHaveClass(/hidden/);
  }
  expect((await snapshot(page)).calls).toHaveLength(0);
});

test('Push: Custom reveals without a write, free text is sanitized on change, a catalogue pick and None write one merged update each', async ({ page }) => {
  await seed(page, 'core.indicator', { readSimVar: 'apHdgBugValue' });
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'full'; window.__studioApp.inspector.render(); });
  await page.locator('#c-bind-push').selectOption('__custom__');
  await expect(page.locator('#c-bind-push-custom-block')).not.toHaveClass(/hidden/);
  expect((await snapshot(page)).calls).toHaveLength(0);
  await page.locator('#c-bind-push-custom-input').fill('(H:MY_PUSH)');
  await expect(page.locator('#c-bind-push-custom-diff')).toContainText('Removed');
  expect((await snapshot(page)).calls).toHaveLength(0);
  await page.locator('#c-bind-push-custom-input').dispatchEvent('change');
  expect((await snapshot(page)).calls.at(-1)).toEqual(['binding-pin', { binding: { readSimVar: 'apHdgBugValue', pushEvent: 'H:MY_PUSH' } }]);
  await page.locator('#c-bind-push').selectOption('apHdgSet');
  expect((await snapshot(page)).binding.pushEvent).toBe('apHdgSet');
  await expect(page.locator('#c-bind-push-custom-block')).toHaveClass(/hidden/);
  await page.locator('#c-bind-push').selectOption('__custom__');
  await page.locator('#c-bind-push-custom-input').fill('H:AGAIN');
  await page.locator('#c-bind-push-custom-input').dispatchEvent('change');
  expect((await snapshot(page)).binding.pushEvent).toBe('H:AGAIN');
  await page.locator('#c-bind-push').selectOption('');
  expect((await snapshot(page)).binding).toEqual({ readSimVar: 'apHdgBugValue' });
  await expect(page.locator('#c-bind-push-custom-input')).toHaveValue('');
});

test('Acknowledge takes an event another saved widget uses from its Custom block', async ({ page }) => {
  const renderErrors = await openBindingsCase(page, {
    savedWidgets: [{ id: 'saved.one', kind: 'widget', components: [{ id: 'saved-button', type: 'core.button', binding: { writeEvent: 'MY_SAVED_EVENT' } }] }],
    component: { id: 'sweep-pin', type: 'core.indicator', label: 'Sweep pin', props: {}, style: {}, binding: {} },
  });
  await page.locator('#c-bind-ack').selectOption('__custom__');
  expect(await optionsOf(page, '#c-bind-ack-custom-select')).toEqual([['', '— select or type below —'], ['MY_SAVED_EVENT', 'MY_SAVED_EVENT (used by saved.one)']]);
  await page.locator('#c-bind-ack-custom-select').selectOption('MY_SAVED_EVENT');
  expect(await page.evaluate(() => window.__studioApp.state.getComponent('sweep-pin').binding)).toEqual({ ackEvent: 'MY_SAVED_EVENT' });
  expect(renderErrors).toEqual([]);
});

test('Connect… on Acknowledge opens the dialog for ackEvent alone: no wire-up is offered and only that key is written', async ({ page }) => {
  await seed(page, 'core.indicator');
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'full'; window.__studioApp.inspector.render(); });
  await page.locator('#c-bind-ack-connect').click();
  await expect(page.locator('.studio-modal-overlay:not(.hidden)')).toBeVisible();
  const name = await page.locator('#cn-catalogue-rows .cn-pick').first().getAttribute('data-name');
  await page.locator('#cn-catalogue-rows .cn-pick').first().click();
  await expect(page.locator('#cn-pairing')).toBeEmpty();
  await expect(page.locator('#cn-pair-checkbox')).toHaveCount(0);
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).calls).toHaveLength(1);
  expect((await snapshot(page)).calls[0]).toEqual(['binding-pin', { binding: { ackEvent: name } }]);
});

test('Connect… on Acknowledge, Push and the fast events passes each row\'s own key to the dialog', async ({ page }) => {
  await seed(page, 'core.rotary', {}, { writeMode: 'pulse', acceleration: true });
  await page.evaluate(() => {
    const { inspector } = window.__studioApp;
    window.__connectArgs = [];
    inspector.openConnectDialog = (comp, def, kind, field) => { window.__connectArgs.push([comp.id, def === window.__studioApp.state.widgetDef, kind, field]); };
    inspector.uiTier = 'full';
    inspector.render();
  });
  for (const stem of ['ack', 'push', 'fastincrement', 'fastdecrement']) await page.locator(`#c-bind-${stem}-connect`).click();
  expect(await page.evaluate(() => window.__connectArgs)).toEqual([
    ['binding-pin', true, 'write', 'ackEvent'],
    ['binding-pin', true, 'write', 'pushEvent'],
    ['binding-pin', true, 'write', 'fastIncrementEvent'],
    ['binding-pin', true, 'write', 'fastDecrementEvent'],
  ]);
});

test('a supplied eventPicker row renders in Full with Custom… and Connect…, and writes its own path, with no module naming it', async ({ page }) => {
  await seed(page);
  await page.evaluate(async () => {
    const { getFieldsForType } = await import('/widgets/PropertyRegistry.js');
    const { inspector } = window.__studioApp;
    inspector.getFieldsForType = (t) => [...getFieldsForType(t), { path: 'binding.fooEvent', control: 'eventPicker', tier: 'advanced', group: 'Send to Simulator', label: 'Foo Event' }];
    window.__connectArgs = [];
    inspector.openConnectDialog = (comp, def, kind, field) => { window.__connectArgs.push([kind, field]); };
    inspector.uiTier = 'full';
    inspector.render();
  });
  const field = page.locator('.prop-field', { has: page.locator('#rf-binding-fooEvent') }).first();
  await expect(field.locator('label').first()).toHaveText('Foo Event');
  await expect(field.locator('label .prop-hint')).toHaveCount(0);
  const options = await optionsOf(page, '#rf-binding-fooEvent');
  expect(options[0]).toEqual(['', '— none —']);
  expect(options.at(-1)).toEqual(['__custom__', 'Custom…']);
  await page.locator('#rf-binding-fooEvent-connect').click();
  expect(await page.evaluate(() => window.__connectArgs)).toEqual([['write', 'fooEvent']]);
  await page.locator('#rf-binding-fooEvent').selectOption('__custom__');
  await expect(page.locator('#rf-binding-fooEvent-custom-block')).not.toHaveClass(/hidden/);
  expect((await snapshot(page)).calls).toHaveLength(0);
  await page.locator('#rf-binding-fooEvent-custom-input').fill('(H:FOO_EVENT)');
  await expect(page.locator('#rf-binding-fooEvent-custom-diff')).toContainText('Removed');
  await page.locator('#rf-binding-fooEvent-custom-input').dispatchEvent('change');
  expect((await snapshot(page)).binding.fooEvent).toBe('H:FOO_EVENT');
  await page.locator('#rf-binding-fooEvent').selectOption('apHdgSet');
  expect((await snapshot(page)).binding.fooEvent).toBe('apHdgSet');
  await page.evaluate(() => Reflect.deleteProperty(window.__studioApp.inspector, 'getFieldsForType'));
});

const GUIDED_ROWS = [
  { path: 'binding.writeEvent', stem: 'write', label: 'Connect to Simulator — Value to Send' },
  { path: 'binding.incrementEvent', stem: 'increment', label: 'Connect to Simulator — Increment Event (Pulse Clockwise)' },
  { path: 'binding.decrementEvent', stem: 'decrement', label: 'Connect to Simulator — Decrement Event (Pulse Counter-Clockwise)' },
];

test('Write, Increment and Decrement render from the registry: the Guided picker in Guided and Build, the Deck Event dropdown in Full, with the row text and today\'s ids', async ({ page }) => {
  await seed(page, 'core.rotary', {}, { writeMode: 'pulse' });
  const rows = await page.evaluate(async () => (await import('/widgets/PropertyRegistry.js'))
    .getFieldsForType('core.rotary').filter((f) => ['binding.writeEvent', 'binding.incrementEvent', 'binding.decrementEvent'].includes(f.path))
    .map(({ path, label, tooltip }) => ({ path, label, tooltip })));
  expect(rows).toHaveLength(3);
  for (const tier of ['guided', 'build']) {
    await page.evaluate((t) => { window.__studioApp.inspector.uiTier = t; window.__studioApp.inspector.render(); }, tier);
    for (const { stem, label } of GUIDED_ROWS) {
      const id = `${tier} ${stem}`;
      await expect(page.locator(`#c-connect-${stem}-category`), id).toBeVisible();
      await expect(page.locator(`#c-connect-${stem}-variable`), id).toBeDisabled();
      await expect(page.locator(`#c-bind-${stem}-simple-field label`), id).toHaveText(`${label} ⓘ`);
      await expect(page.locator(`#c-bind-${stem}-simple-field label .prop-hint`), id).toHaveAttribute('title', /^Pick a category, then the specific command/);
      await expect(page.locator(`#c-bind-${stem}-simple-hint`), id).toBeVisible();
      await expect(page.locator(`#c-connect-${stem}-findit`), id).toBeVisible();
      await expect(page.locator(`#c-connect-${stem}-full`), id).toBeVisible();
      await expect(page.locator(`#c-bind-${stem}`), id).toBeHidden();
    }
  }
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'full'; window.__studioApp.inspector.render(); });
  const send = subtitle(page, 'Send to Simulator').locator('xpath=following-sibling::div[1]');
  for (const { path, stem } of GUIDED_ROWS) {
    const row = rows.find((r) => r.path === path);
    const field = send.locator(`#c-bind-${stem}-field`);
    await expect(page.locator(`#c-bind-${stem}`), stem).toBeVisible();
    await expect(field.locator('label').first(), stem).toHaveText(`${row.label} ⓘ`);
    await expect(field.locator('label .prop-hint').first(), stem).toHaveAttribute('title', row.tooltip);
    await expect(page.locator(`#c-bind-${stem}-connect`), stem).toBeVisible();
    await expect(page.locator(`#c-bind-${stem}-custom-block`), stem).toHaveClass(/hidden/);
    await expect(page.locator(`#c-connect-${stem}-category`), stem).toBeHidden();
    await expect(page.locator(`#c-connect-${stem}-findit`), stem).toBeHidden();
    const options = await optionsOf(page, `#c-bind-${stem}`);
    expect(options[0], stem).toEqual(['', '— none —']);
    expect(options.at(-1), stem).toEqual(['__custom__', 'Custom…']);
  }
  expect((await snapshot(page)).calls).toHaveLength(0);
});

test('the Write Guided picker writes only when a value is chosen, in one merged update; Find it opens the Tester and switch to Full persists the tier', async ({ page }) => {
  await seed(page, 'core.button', { readSimVar: 'apHdgBugValue' });
  await page.evaluate(() => {
    const { inspector } = window.__studioApp;
    inspector.simVarTester = { open() { window.__findItCalls = (window.__findItCalls || 0) + 1; } };
    inspector.uiTier = 'guided';
    inspector.render();
  });
  const category = page.locator('#c-connect-write-category');
  const value = page.locator('#c-connect-write-variable');
  await expect(value).toBeDisabled();
  await category.selectOption('ap');
  await expect(value).toBeEnabled();
  expect((await snapshot(page)).calls).toHaveLength(0);
  const chosen = await value.locator('option[value]:not([value=""])').first().getAttribute('value');
  await value.selectOption(chosen);
  const { calls, binding } = await snapshot(page);
  expect(calls).toEqual([['binding-pin', { binding: { readSimVar: 'apHdgBugValue', writeEvent: chosen } }]]);
  expect(binding.writeEvent).toBe(chosen);
  await expect(page.locator('#c-connect-write-category')).toHaveValue('ap');
  await expect(page.locator('#c-connect-write-variable')).toHaveValue(chosen);
  await page.locator('#c-connect-write-findit').click();
  expect(await page.evaluate(() => window.__findItCalls)).toBe(1);
  await page.locator('#c-connect-write-full').click();
  expect(await page.evaluate(() => [window.__studioApp.inspector.uiTier, localStorage.getItem('fdws_studio_uiMode')])).toEqual(['full', 'full']);
  await expect(page.locator('#c-bind-write')).toHaveValue(chosen);
});

test('a stored catalogue Write event preselects its category and value in Guided; a stored custom one shows its block and value at every tier', async ({ page }) => {
  await seed(page, 'core.button', { writeEvent: 'apHdgSet' });
  const category = await page.evaluate(async () => (await import('/core/deckEvents.js')).DECK_EVENTS.find((e) => e.kind === 'write' && e.name === 'apHdgSet').category);
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'guided'; window.__studioApp.inspector.render(); });
  await expect(page.locator('#c-connect-write-category')).toHaveValue(category);
  await expect(page.locator('#c-connect-write-variable')).toHaveValue('apHdgSet');
  await expect(page.locator('#c-connect-write-variable')).toBeEnabled();
  expect((await snapshot(page)).calls).toHaveLength(0);

  await seed(page, 'core.button', { writeEvent: 'H:FOO_EVENT' });
  for (const tier of ['guided', 'build', 'full']) {
    await page.evaluate((t) => { window.__studioApp.inspector.uiTier = t; window.__studioApp.inspector.render(); }, tier);
    await expect(page.locator('#c-bind-write-custom-block'), tier).toBeVisible();
    await expect(page.locator('#c-bind-write-custom-input'), tier).toHaveValue('H:FOO_EVENT');
  }
  await expect(page.locator('#c-bind-write')).toHaveValue('__custom__');
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'guided'; window.__studioApp.inspector.render(); });
  await expect(page.locator('#c-connect-write-category')).toHaveValue('');
  expect((await snapshot(page)).calls).toHaveLength(0);
});

test('Write on a Pulse Rotary keeps its note at every tier and stays editable with no Write Mode gate; only Write carries Paste', async ({ page }) => {
  await seed(page, 'core.rotary', { writeEvent: 'apHdgSet' }, { writeMode: 'pulse' });
  for (const tier of ['guided', 'build', 'full']) {
    await page.evaluate((t) => { window.__studioApp.inspector.uiTier = t; window.__studioApp.inspector.render(); }, tier);
    await expect(page.locator('#c-bind-write-pulse-note'), tier).toBeVisible();
    await expect(page.locator('#c-bind-write-pulse-note'), tier).toContainText('Write Deck Event is not used in Pulse mode');
    await expect(page.locator('#c-bind-write-pulse-note'), tier).toContainText('The value here is kept');
  }
  const write = page.locator('.prop-field', { has: page.locator('#c-bind-write') }).first();
  await expect(write.locator('.prop-showwhen-note')).toHaveCount(0);
  await expect(page.locator('#c-bind-write')).toBeEnabled();
  await page.locator('#c-bind-write').selectOption('com1Swap');
  expect((await snapshot(page)).binding.writeEvent).toBe('com1Swap');
  await expect(page.locator('#c-bind-write-paste')).toHaveCount(1);
  await expect(page.locator('#c-bind-increment-paste')).toHaveCount(0);
  await expect(page.locator('#c-bind-decrement-paste')).toHaveCount(0);
  await page.locator('#c-bind-write').selectOption('');
  await expect(page.locator('#c-bind-write-pulse-note')).toBeVisible();
  await expect(page.locator('#c-bind-write-pulse-note')).not.toContainText('The value here is kept');
});

test('Connect… on Write, Increment and Decrement passes each row\'s own key to the dialog', async ({ page }) => {
  await seed(page, 'core.rotary', {}, { writeMode: 'pulse' });
  await page.evaluate(() => {
    const { inspector } = window.__studioApp;
    window.__connectArgs = [];
    inspector.openConnectDialog = (comp, def, kind, field) => { window.__connectArgs.push([comp.id, def === window.__studioApp.state.widgetDef, kind, field]); };
    inspector.uiTier = 'full';
    inspector.render();
  });
  for (const { stem } of GUIDED_ROWS) await page.locator(`#c-bind-${stem}-connect`).click();
  expect(await page.evaluate(() => window.__connectArgs)).toEqual([
    ['binding-pin', true, 'write', 'writeEvent'],
    ['binding-pin', true, 'write', 'incrementEvent'],
    ['binding-pin', true, 'write', 'decrementEvent'],
  ]);
});

test('the rows render under the three headings in the registry\'s order, each after its heading', async ({ page }) => {
  await seed(page, 'core.rotary', {}, { writeMode: 'pulse', acceleration: true });
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'full'; window.__studioApp.inspector.render(); });
  const ids = ['c-bind-read', 'c-bind-unit', 'c-bind-pollrate', 'c-bind-pollgroup', 'c-bind-deadband', 'c-bind-transition-ms',
    'c-bind-write', 'c-bind-increment', 'c-bind-decrement', 'c-bind-fastincrement', 'c-bind-fastdecrement', 'c-bind-ack', 'c-bind-push', 'c-bind-eventcategory',
    'c-bind-state', 'c-bind-stateref'];
  const sequence = await page.evaluate((idList) => [...document.querySelectorAll(['#studio-right-sidebar .prop-section-subtitle', ...idList.map((id) => `#${id}`)].join(', '))]
    .map((el) => (el.classList.contains('prop-section-subtitle') ? el.textContent : el.id)), ids);
  expect(sequence.slice(sequence.indexOf('Read from Simulator'), sequence.indexOf('c-bind-stateref') + 1)).toEqual([
    'Read from Simulator', 'c-bind-read', 'c-bind-unit', 'c-bind-pollrate', 'c-bind-pollgroup', 'c-bind-deadband', 'c-bind-transition-ms',
    'Send to Simulator', 'c-bind-write', 'c-bind-increment', 'c-bind-decrement', 'c-bind-fastincrement', 'c-bind-fastdecrement', 'c-bind-ack', 'c-bind-push', 'c-bind-eventcategory',
    'Local State', 'c-bind-state', 'c-bind-stateref',
  ]);
});

test('a new core.label in Guided shows Read from Simulator and Send to Simulator with their Guided pickers, and no Local State heading', async ({ page }) => {
  await seed(page, 'core.label');
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'guided'; window.__studioApp.inspector.render(); });
  await expect(subtitle(page, 'Read from Simulator')).toBeVisible();
  await expect(subtitle(page, 'Send to Simulator')).toBeVisible();
  await expect(page.locator('#c-connect-read-category')).toBeVisible();
  await expect(page.locator('#c-connect-write-category')).toBeVisible();
  await expect(subtitle(page, 'Local State')).toBeHidden();
  expect((await snapshot(page)).calls).toHaveLength(0);
});

test('Read renders from the registry: the Guided picker in Guided and Build, the Deck Event dropdown in Full, with the row text and today\'s ids', async ({ page }) => {
  await seed(page, 'core.display');
  const row = await page.evaluate(async () => {
    const { tooltip, label } = (await import('/widgets/PropertyRegistry.js')).getFieldsForType('core.display').find((f) => f.path === 'binding.readSimVar');
    return { tooltip, label };
  });
  for (const tier of ['guided', 'build']) {
    await page.evaluate((t) => { window.__studioApp.inspector.uiTier = t; window.__studioApp.inspector.render(); }, tier);
    await expect(page.locator('#c-connect-read-category'), tier).toBeVisible();
    await expect(page.locator('#c-connect-read-variable'), tier).toBeDisabled();
    await expect(page.locator('#c-bind-read-simple-field label'), tier).toHaveText('Connect to Simulator — Value to Show ⓘ');
    await expect(page.locator('#c-bind-read-simple-field label .prop-hint'), tier).toHaveAttribute('title', /^Pick a category, then the specific value this component should read/);
    await expect(page.locator('#c-bind-read-simple-hint'), tier).toBeVisible();
    await expect(page.locator('#c-connect-read-findit'), tier).toBeVisible();
    await expect(page.locator('#c-connect-read-full'), tier).toBeVisible();
    await expect(page.locator('#c-bind-read'), tier).toBeHidden();
  }
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'full'; window.__studioApp.inspector.render(); });
  const read = subtitle(page, 'Read from Simulator').locator('xpath=following-sibling::div[1]');
  const field = read.locator('#c-bind-read-field');
  await expect(page.locator('#c-bind-read')).toBeVisible();
  await expect(field.locator('label').first()).toHaveText(`${row.label} ⓘ`);
  await expect(field.locator('label .prop-hint').first()).toHaveAttribute('title', row.tooltip);
  await expect(page.locator('#c-bind-read-connect')).toBeVisible();
  await expect(page.locator('#c-bind-read-custom-block')).toHaveClass(/hidden/);
  await expect(page.locator('#c-connect-read-category')).toBeHidden();
  const options = await optionsOf(page, '#c-bind-read');
  expect(options[0]).toEqual(['', '— none —']);
  expect(options.at(-1)).toEqual(['__custom__', 'Custom…']);
  expect(options.map(([value]) => value)).toContain('apHdgBugValue');
  expect(options.map(([value]) => value)).not.toContain('apHdgSet');
  expect((await snapshot(page)).calls).toHaveLength(0);
});

test('a stored catalogue Read preselects its category and value in Guided; a stored raw one shows its block and value at every tier', async ({ page }) => {
  await seed(page, 'core.display', { readSimVar: 'apHdgBugValue' });
  const category = await page.evaluate(async () => (await import('/core/deckEvents.js')).DECK_EVENTS.find((e) => e.kind === 'read' && e.name === 'apHdgBugValue').category);
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'guided'; window.__studioApp.inspector.render(); });
  await expect(page.locator('#c-connect-read-category')).toHaveValue(category);
  await expect(page.locator('#c-connect-read-variable')).toHaveValue('apHdgBugValue');
  await expect(page.locator('#c-connect-read-variable')).toBeEnabled();
  expect((await snapshot(page)).calls).toHaveLength(0);

  await seed(page, 'core.display', { readSimVar: 'L:FOO' });
  for (const tier of ['guided', 'build', 'full']) {
    await page.evaluate((t) => { window.__studioApp.inspector.uiTier = t; window.__studioApp.inspector.render(); }, tier);
    await expect(page.locator('#c-bind-read-custom-block'), tier).toBeVisible();
    await expect(page.locator('#c-bind-read-custom-input'), tier).toHaveValue('L:FOO');
  }
  await expect(page.locator('#c-bind-read')).toHaveValue('__custom__');
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'guided'; window.__studioApp.inspector.render(); });
  await expect(page.locator('#c-connect-read-category')).toHaveValue('');
  expect((await snapshot(page)).calls).toHaveLength(0);
});

test('Read\'s Custom block takes a saved widget\'s read, sanitizes free text, and writes one merged update each', async ({ page }) => {
  const renderErrors = await openBindingsCase(page, {
    savedWidgets: [{ id: 'saved.one', kind: 'widget', components: [{ id: 'saved-display', type: 'core.display', binding: { readSimVar: 'MY_SAVED_READ' } }] }],
    component: { id: 'sweep-pin', type: 'core.display', label: 'Sweep pin', props: {}, style: {}, binding: {} },
  });
  await page.locator('#c-bind-read').selectOption('__custom__');
  expect(await optionsOf(page, '#c-bind-read-custom-select')).toEqual([['', '— select or type below —'], ['MY_SAVED_READ', 'MY_SAVED_READ (used by saved.one)']]);
  await expect(page.locator('#c-bind-read-custom-input')).toHaveAttribute('placeholder', 'e.g. myCustomVar, L:FBW_TAXI_LIGHT_INTENSITY');
  await page.locator('#c-bind-read-custom-select').selectOption('MY_SAVED_READ');
  expect(await page.evaluate(() => window.__studioApp.state.getComponent('sweep-pin').binding)).toEqual({ readSimVar: 'MY_SAVED_READ' });
  await page.locator('#c-bind-read-custom-input').fill('(L:OTHER_VAR)');
  await expect(page.locator('#c-bind-read-custom-diff')).toContainText('Removed');
  await page.locator('#c-bind-read-custom-input').dispatchEvent('change');
  expect(await page.evaluate(() => window.__studioApp.state.getComponent('sweep-pin').binding)).toEqual({ readSimVar: 'L:OTHER_VAR' });
  expect(renderErrors).toEqual([]);
});

test('Paste on Read writes readSimVar and unit together in one update; Paste stays on Read and Write only', async ({ page }) => {
  await seed(page);
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'full'; window.__studioApp.inspector.render(); });
  await page.locator('#c-bind-read').selectOption('__custom__');
  await page.evaluate(() => { window.__studioApp.state.testerParsed = { kind: 'read', name: 'L:TEST', unit: 'string' }; });
  await page.locator('#c-bind-read-paste').click();
  expect((await snapshot(page)).calls).toEqual([['binding-pin', { binding: { readSimVar: 'L:TEST', unit: 'string' } }]]);
  await expect(page.locator('#c-bind-read-custom-input')).toHaveValue('L:TEST');
  await expect(page.locator('#c-bind-read-paste')).toHaveCount(1);
  await expect(page.locator('#c-bind-ack-paste')).toHaveCount(0);
  await expect(page.locator('#c-bind-push-paste')).toHaveCount(0);
});

test('Connect… on Read passes the read kind and readSimVar; the real dialog writes readSimVar and unit in one update', async ({ page }) => {
  await seed(page, 'core.display');
  await page.evaluate(() => {
    const { inspector } = window.__studioApp;
    window.__connectArgs = [];
    const real = inspector.openConnectDialog.bind(inspector);
    inspector.openConnectDialog = (comp, def, kind, field) => {
      window.__connectArgs.push([comp.id, def === window.__studioApp.state.widgetDef, kind, field]);
      return real(comp, def, kind, field);
    };
    inspector.uiTier = 'full';
    inspector.render();
  });
  await page.locator('#c-bind-read-connect').click();
  expect(await page.evaluate(() => window.__connectArgs)).toEqual([['binding-pin', true, 'read', 'readSimVar']]);
  await expect(page.locator('.studio-modal-overlay:not(.hidden)')).toBeVisible();
  await page.locator('#cn-tab-raw').click();
  await page.locator('#cn-raw-input').fill('L:NEW_VALUE');
  await page.locator('#cn-raw-unit').fill('string');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect.poll(async () => (await snapshot(page)).calls).toHaveLength(1);
  expect((await snapshot(page)).calls[0]).toEqual(['binding-pin', { binding: { readSimVar: 'L:NEW_VALUE', unit: 'string' } }]);
});

test('Unit is disabled with the PC Bridge hint for a Deck Event read, and enabled for a raw address (Full)', async ({ page }) => {
  await seed(page, 'core.display', { readSimVar: 'apHdgBugValue' });
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'full'; window.__studioApp.inspector.render(); });
  const row = await page.evaluate(async () => {
    const { tooltip, placeholder } = (await import('/widgets/PropertyRegistry.js')).getFieldsForType('core.display').find((f) => f.path === 'binding.unit');
    return { tooltip, placeholder };
  });
  await expect(page.locator('#c-bind-unit')).toBeDisabled();
  await expect(page.locator('#c-bind-unit')).toHaveAttribute('placeholder', 'Unit is set by PC Bridge for this Deck Event');
  const field = page.locator('.prop-field', { has: page.locator('#c-bind-unit') }).first();
  await expect(field.locator('label').first()).toHaveText('SimConnect Unit ⓘ');
  await expect(field.locator('label .prop-hint').first()).toHaveAttribute('title', 'Unit is set by PC Bridge for this Deck Event.');
  await expect(field.locator('.prop-showwhen-note')).toHaveCount(0);

  await seed(page, 'core.display', { readSimVar: 'A:INDICATED ALTITUDE' });
  await page.evaluate(() => { window.__studioApp.inspector.uiTier = 'full'; window.__studioApp.inspector.render(); });
  await expect(page.locator('#c-bind-unit')).toBeEnabled();
  await expect(page.locator('#c-bind-unit')).toHaveAttribute('placeholder', row.placeholder);
  await expect(page.locator('.prop-field', { has: page.locator('#c-bind-unit') }).first().locator('label .prop-hint').first()).toHaveAttribute('title', row.tooltip);
  await page.locator('#c-bind-unit').fill('  feet  ');
  await page.locator('#c-bind-unit').dispatchEvent('change');
  expect((await snapshot(page)).binding).toEqual({ readSimVar: 'A:INDICATED ALTITUDE', unit: 'feet' });
  await page.locator('#c-bind-unit').fill('   ');
  await page.locator('#c-bind-unit').dispatchEvent('change');
  expect((await snapshot(page)).binding.unit).toBeUndefined();
});

test('a stored Unit under a Deck Event read shows disabled with its value at every tier, under a note naming Read and a Clear that removes only unit', async ({ page }) => {
  await seed(page, 'core.display', { readSimVar: 'apHdgBugValue', unit: 'knots' });
  for (const tier of ['guided', 'build', 'full']) {
    await page.evaluate((t) => { window.__studioApp.inspector.uiTier = t; window.__studioApp.inspector.render(); }, tier);
    await expect(page.locator('#c-bind-unit'), tier).toBeVisible();
    await expect(page.locator('#c-bind-unit'), tier).toBeDisabled();
    await expect(page.locator('#c-bind-unit'), tier).toHaveValue('knots');
  }
  const field = page.locator('.prop-field', { has: page.locator('#c-bind-unit') }).first();
  await expect(field.locator('.prop-showwhen-note span')).toHaveText('Read Deck Event is not a raw A:/L:/H:/K: address — still set to "knots"');
  expect((await snapshot(page)).calls).toHaveLength(0);
  await field.locator('.prop-showwhen-clear').click();
  const { binding, calls } = await snapshot(page);
  expect(calls).toHaveLength(1);
  expect(binding).toEqual({ readSimVar: 'apHdgBugValue' });
  await expect(page.locator('#c-bind-unit')).toBeDisabled();
  await expect(page.locator('.prop-field', { has: page.locator('#c-bind-unit') }).first().locator('.prop-showwhen-note')).toHaveCount(0);
});

test('the resolved-unit line follows Read\'s dropdown and custom block, shows in Full only, and needs a connected Bridge and a bare Deck Event', async ({ page }) => {
  await seed(page, 'core.display', { readSimVar: 'apHdgBugValue' });
  const connect = (connected) => page.evaluate((isConnected) => {
    const inspector = window.__studioApp.inspector;
    inspector.simBridge = { connected: isConnected, resolveDeckEvent: () => Promise.resolve({ unit: 'degrees', profileName: 'Test Profile' }) };
    inspector.uiTier = 'full';
    inspector.render();
  }, connected);
  await connect(true);
  await expect(page.locator('#c-bind-read-custom-block + #c-bind-resolved-info')).toHaveText('Unit: degrees — from profile "Test Profile"');
  await expect(page.locator('.prop-field', { has: page.locator('#c-bind-unit') }).first().locator('#c-bind-resolved-info')).toHaveCount(0);
  for (const tier of ['guided', 'build']) {
    await page.evaluate((t) => { window.__studioApp.inspector.uiTier = t; window.__studioApp.inspector.render(); }, tier);
    await expect(page.locator('#c-bind-resolved-info'), tier).toBeHidden();
  }
  await connect(false);
  await expect(page.locator('#c-bind-resolved-info')).toBeHidden();

  await seed(page, 'core.display', { readSimVar: 'A:INDICATED ALTITUDE' });
  await connect(true);
  await expect(page.locator('#c-bind-resolved-info')).toBeHidden();
});

const SWEEP_WIDGET_ID = 'com.flightdeck.bindings-sweep';
const NO_CUSTOM_EVENTS = '(no custom Deck Events in use yet — try importing a Community Pack in the Library tab)';
const SAVED_WRITE_OPTIONS = [['', '— select or type below —'], [P2, `${P2} (used by ${P})`]];
const WRITE_KINDS = ['write', 'increment', 'decrement', 'fastincrement', 'fastdecrement', 'ack', 'push'];

// Loads a blank widget with the given state vars and component under the write recorder, snapshots it,
// then forces the render under test: the given tier, on the Data tab.
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
    title: 'Pulse rotary event fields with acceleration',
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
