import { test, expect, openStudio } from './fixtures/inspectorHarness.js';

async function seed(page, type = 'core.button', binding = {}, props = {}) {
  await openStudio(page);
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
