import {
  expect,
  openStudio,
  test,
  INJECTION_PAYLOAD as P,
  INJECTION_PAYLOAD_2 as P2,
  countInjectedInInspector,
  collectRenderErrors,
  installWriteRecorder,
  runSeeding,
  snapshotWidgetDef,
  readWriteCheck,
} from './fixtures/inspectorHarness.js';

async function selectTypeOnDataTab(page, type, id) {
  await page.evaluate(({ type, id }) => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push({ id, type, props: {}, style: {} });
    state.selectComponent(id);
  }, { type, id });
  await page.getByTestId('inspector-tab-data').click();
}

async function openFull(page) {
  await page.addInitScript(() => localStorage.setItem('fdws_studio_uiMode', 'full'));
  await openStudio(page);
}

async function seedSelected(page, component) {
  await page.evaluate((value) => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push(value);
    state.selectComponent(value.id);
  }, component);
}

async function change(page, selector, value) {
  await page.evaluate(({ selector, value }) => {
    const el = document.querySelector(selector);
    el.value = value;
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { selector, value });
}

test('label and divider explain their current Style tab fields', async ({ page }) => {
  await openStudio(page);
  await selectTypeOnDataTab(page, 'core.label', 'label-notice');
  await expect(page.getByTestId('inspector-panel-data')).toContainText("Alignment is set in the Style tab's Appearance section, shared by every component type.");
  await selectTypeOnDataTab(page, 'core.divider', 'divider-notice');
  await expect(page.getByTestId('inspector-panel-data')).toContainText("Thickness, color and dash style are set in the Style tab's Appearance section, under Border. This line reuses those fields.");
});

test('component header, four tab placements, section order and deselect', async ({ page }) => {
  await openFull(page);
  await page.evaluate(() => { window.__studioApp.state.widgetDef.layerGroups = [{ id: 'front', z: 7 }]; });
  await seedSelected(page, { id: 'comp-shell', type: 'core.button', label: 'Switch', props: { label: 'ON' }, layer: { group: 'front', z: 2 }, layout: { col: 1, row: 2, w: 3, h: 4 }, style: {}, interactions: [{ trigger: 'tap', actions: [] }] });
  await expect(page.locator('.inspector-header')).toContainText('Switch');
  await expect(page.locator('.inspector-header')).toContainText('Effective Z: 9');
  await expect(page.locator('.inspector-badge.comp-type')).toHaveText('button');
  const structure = await page.evaluate(() => Object.fromEntries(['general', 'style', 'data', 'events'].map((tab) => {
    const panel = document.querySelector(`[data-testid="inspector-panel-${tab}"]`);
    return [tab, {
      groups: [...panel.querySelectorAll('.inspector-tab-section-header, .inspector-group-header')].map((el) => el.textContent.trim()),
      subtitles: [...panel.querySelectorAll('.prop-section-subtitle')].map((el) => el.textContent.trim()),
      size: !!panel.querySelector('[data-testid="compound-row-size"][data-tier="build"]'),
    }];
  })));
  expect(structure.general.groups.join(' ')).toContain('LAYOUT & LAYERING');
  expect(structure.general.size).toBe(true);
  expect(structure.style.groups.join(' ')).toContain('APPEARANCE');
  expect(structure.data.groups.join(' ')).toContain('DATA & CONTENT');
  expect(structure.data.subtitles).toContain('SimVars & Bindings');
  expect(structure.events.groups.join(' ')).toContain('BEHAVIOR');
  expect(structure.events.subtitles).toContain('Visibility & Guard');
  await page.locator('#btn-deselect-comp').click();
  expect(await page.evaluate(() => window.__studioApp.state.selectedComponentId)).toBeNull();
});

test('layout pairing and structural writes retain their values and coercions', async ({ page }) => {
  await openFull(page);
  await page.evaluate(() => { window.__studioApp.state.widgetDef.layerGroups = [{ id: 'front', z: 4 }]; });
  await seedSelected(page, { id: 'comp-layout', type: 'core.label', label: 'Called', props: { text: 'Shows' }, layer: {}, layout: { col: 1, row: 1, w: 2, h: 2 }, style: {} });
  await expect(page.locator('#c-content-field')).toHaveValue('Shows');
  await expect(page.locator('#c-label')).toHaveValue('Called');
  await change(page, '#c-content-field', 'Runtime');
  await change(page, '#c-label', 'Author');
  await change(page, '#c-id', '  ');
  expect(await page.evaluate(() => window.__studioApp.state.getComponent('comp-layout').id)).toBe('comp-layout');
  await change(page, '#c-layer-group', 'front');
  await change(page, '#c-layer-z', '3');
  await change(page, '#c-pointer-events', 'none');
  await change(page, '#c-clip', 'true');
  await change(page, '#c-layout-col', '5');
  await change(page, '#c-layout-row', '3');
  await change(page, '#c-layout-w', '4');
  await change(page, '#c-layout-h', '2');
  expect(await page.evaluate(() => {
    const c = window.__studioApp.state.getComponent('comp-layout');
    return { label: c.label, text: c.props.text, layer: c.layer, layout: c.layout };
  })).toMatchObject({ label: 'Author', text: 'Runtime', layer: { group: 'front', z: 3, pointerEvents: 'none', clipToBounds: true }, layout: { col: 5, row: 3, w: 4, h: 2 } });
  await change(page, '#c-layer-group', '');
  expect(await page.evaluate(() => window.__studioApp.state.getComponent('comp-layout').layer.group)).toBeNull();
  await change(page, '#c-type', 'core.button');
  expect(await page.evaluate(() => window.__studioApp.state.getComponent('comp-layout').type)).toBe('core.button');
});

test('type-specific fields, gauge compose, list example and default branch', async ({ page }) => {
  await openFull(page);
  await seedSelected(page, { id: 'type-gauge', type: 'core.gauge', props: {}, style: {} });
  await page.getByTestId('inspector-tab-data').click();
  await page.locator('#p-gauge-compose-toggle').check();
  expect(await page.evaluate(() => window.__studioApp.state.getComponent('type-gauge').props.compose)).toEqual({ transform: 'translate', axis: 'y', stateVar: 'actFreq', valueRange: [0, 1], outputRange: [0, 1], clamp: true });
  await page.locator('#p-gauge-compose-toggle').uncheck();
  expect(await page.evaluate(() => 'compose' in window.__studioApp.state.getComponent('type-gauge').props)).toBe(false);
  await seedSelected(page, { id: 'type-list', type: 'core.list', props: {}, style: {} });
  await expect(page.locator('#p-list-itemtemplate')).toHaveValue('{"components":[]}');
  await page.locator('#p-list-template-example').click();
  expect(await page.evaluate(() => window.__studioApp.state.getComponent('type-list').props.itemTemplate.components[0].props.textBinding)).toBe('item.label');
  await seedSelected(page, { id: 'type-unknown', type: 'custom.test', props: {}, style: {} });
  await expect(page.getByTestId('inspector-panel-data')).toContainText('Standard properties active for custom.test');
});

test('unrecognised root values expose scalar edit and keep objects read only', async ({ page }) => {
  await openFull(page);
  await seedSelected(page, { id: 'type-extra', type: 'core.label', props: { text: 'A' }, style: {}, futureCount: 2, futureShape: { x: 1 } });
  await expect(page.getByTestId('inspector-panel-general')).toContainText('UNRECOGNISED PROPERTIES');
  await expect(page.getByTestId('inspector-panel-general')).toContainText('futureShape');
  await page.locator('#type-extra-other-unrec-0-toggle').click();
  await expect(page.locator('#type-extra-other-unrec-0-panel')).toBeVisible();
  await page.locator('#type-extra-other-unrec-0-cancel').click();
  await expect(page.locator('#type-extra-other-unrec-0-panel')).toBeHidden();
  await page.locator('#type-extra-other-unrec-0-toggle').click();
  await change(page, '#type-extra-other-unrec-0-input', '5');
  await page.locator('#type-extra-other-unrec-0-save').click();
  expect(await page.evaluate(() => window.__studioApp.state.getComponent('type-extra').futureCount)).toBe(5);
  await page.locator('#type-extra-other-unrec-0-toggle').click();
  await change(page, '#type-extra-other-unrec-0-input', 'not-a-number');
  await page.locator('#type-extra-other-unrec-0-save').click();
  expect(await page.evaluate(() => window.__studioApp.state.getComponent('type-extra').futureCount)).toBe(0);
});

test('changing selected component resets appearance target fields', async ({ page }) => {
  await openFull(page);
  await seedSelected(page, { id: 'target-a', type: 'core.label', props: {}, style: {} });
  await page.evaluate(() => {
    const host = window.__studioApp.inspector;
    host._styleTab = 'state';
    host._styleTabRuleIndex = 3;
    window.__studioApp.state.widgetDef.components.push({ id: 'target-b', type: 'core.label', props: {}, style: {} });
    window.__studioApp.state.selectComponent('target-b');
  });
  expect(await page.evaluate(() => {
    const host = window.__studioApp.inspector;
    return { id: host._styleTabCompId, tab: host._styleTab, rule: host._styleTabRuleIndex };
  })).toEqual({ id: 'target-b', tab: 'normal', rule: null });
});

// Loads the default widget, seeds under the write recorder, snapshots it, then forces the
// render under test at the Full tier. Component-level seeding (addComponent/setWidgetDef)
// runs under runSeeding's own flag; a multi-selection case also seeds its selectComponent
// calls inside seedFn so they stay excluded too.
async function openComponentCase(page, seedArg, seedFn) {
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
  return renderErrors;
}

function optionsOf(page, selector) {
  return page.locator(selector).locator('option').evaluateAll((options) => options.map((o) => [o.value, o.textContent]));
}

// Reads the unrecognised-property row identified by `rid` via getElementById, never a CSS
// selector: `rid` embeds the authored comp.id verbatim (the DOM's actual id, once the
// browser decodes the escaped HTML), which is not safe to splice into a selector string.
async function unrecRowState(page, rid) {
  return page.evaluate((id) => {
    const $ = (suffix) => document.getElementById(`${id}-${suffix}`);
    const nodes = ['display', 'toggle', 'panel', 'input', 'save', 'cancel'].map($);
    return {
      exists: nodes.every(Boolean),
      displayText: nodes[0]?.textContent ?? null,
      panelHidden: nodes[2]?.classList.contains('hidden') ?? null,
      inputValue: nodes[3]?.value ?? null,
    };
  }, rid);
}

async function clickUnrecControl(page, rid, suffix) {
  await page.evaluate(({ id, suffix }) => document.getElementById(`${id}-${suffix}`).click(), { id: rid, suffix });
}

test('sweep C1: known type with an authored id, layer group and unknown scalar render exactly, inject nothing and write nothing', async ({ page }) => {
  const renderErrors = await openComponentCase(page, {
    groupId: P,
    gridVal: P,
    comp: {
      id: P,
      type: 'core.label',
      label: P,
      layer: { group: P, z: P },
      layout: { col: P, row: P, w: P, h: P },
      props: { text: 'shown', xUnknown: P },
      style: {},
    },
  }, (arg) => {
    const { state } = window.__studioApp;
    state.setWidgetDef({ layerGroups: [{ id: arg.groupId, z: 5 }], layout: { grid: { columns: arg.gridVal, rows: arg.gridVal } } }, false, 'sweep');
    state.addComponent(arg.comp);
  });

  for (const selector of ['#c-label', '#c-id', '#c-layer-z', '#c-layout-col', '#c-layout-row', '#c-layout-w', '#c-layout-h']) {
    await expect(page.locator(selector), selector).toHaveCount(1);
  }
  await expect(page.locator('#c-layer-group')).toHaveCount(1);
  expect(await countInjectedInInspector(page)).toBe(0);

  await expect(page.locator('#c-label')).toHaveValue(P);
  await expect(page.locator('#c-id')).toHaveValue(P);
  for (const selector of ['#c-layer-z', '#c-layout-col', '#c-layout-row', '#c-layout-w', '#c-layout-h']) {
    await expect(page.locator(selector), selector).toHaveAttribute('value', P);
  }
  await expect(page.locator('#c-layout-col')).toHaveAttribute('max', P);
  await expect(page.locator('#c-layout-row')).toHaveAttribute('max', P);
  await expect(page.locator('#c-layout-w')).toHaveAttribute('max', P);
  await expect(page.locator('#c-layout-h')).toHaveAttribute('max', P);
  expect(await optionsOf(page, '#c-layer-group')).toEqual([['', 'None (Ungrouped)'], [P, `${P} (Z: 5)`]]);
  await expect(page.locator('#c-layer-group')).toHaveValue(P);

  const rid = `${P}-data-unrec-0`;
  const row = await unrecRowState(page, rid);
  expect(row.exists).toBe(true);
  expect(row.displayText).toBe(JSON.stringify(P));

  expect(await readWriteCheck(page)).toEqual({ widgetDefChanged: false, writes: [] });
  expect(renderErrors).toEqual([]);

  // AC-5: the unknown-property block still works with this authored comp.id.
  await page.getByTestId('inspector-tab-data').click();
  await clickUnrecControl(page, rid, 'toggle');
  expect((await unrecRowState(page, rid)).panelHidden).toBe(false);
  await clickUnrecControl(page, rid, 'cancel');
  const afterCancel = await unrecRowState(page, rid);
  expect(afterCancel.panelHidden).toBe(true);
  expect(afterCancel.inputValue).toBe(P);

  await clickUnrecControl(page, rid, 'toggle');
  await page.evaluate(({ id, value }) => { document.getElementById(`${id}-input`).value = value; }, { id: rid, value: P2 });
  await snapshotWidgetDef(page);
  await clickUnrecControl(page, rid, 'save');
  expect(await page.evaluate((id) => window.__studioApp.state.getComponent(id).props.xUnknown, P)).toBe(P2);
  const writeResult = await readWriteCheck(page);
  expect(writeResult.widgetDefChanged).toBe(true);
  expect(writeResult.writes.map((w) => w.method)).toEqual(['updateComponent', 'saveHistory']);
});

test('sweep C2: core.list item template JSON round-trips a nested label without injection', async ({ page }) => {
  const itemTemplate = { components: [{ id: 'row', type: 'core.label', label: P, props: {}, layout: { col: 1, row: 1, w: 12, h: 1 }, style: {} }] };
  const renderErrors = await openComponentCase(page, {
    comp: { id: 'sweep-pin', type: 'core.list', props: { itemTemplate }, style: {} },
  }, (arg) => {
    window.__studioApp.state.addComponent(arg.comp);
  });
  await page.getByTestId('inspector-tab-data').click();
  await expect(page.locator('#p-list-itemtemplate')).toHaveCount(1);
  expect(await countInjectedInInspector(page)).toBe(0);
  await expect(page.locator('#p-list-itemtemplate')).toHaveValue(JSON.stringify(itemTemplate, null, 0));
  expect(await readWriteCheck(page)).toEqual({ widgetDefChanged: false, writes: [] });
  expect(renderErrors).toEqual([]);
});

test('sweep C3: an unknown component type shows literally through the default branch', async ({ page }) => {
  const renderErrors = await openComponentCase(page, {
    comp: { id: 'sweep-pin', type: P, props: {}, style: {} },
  }, (arg) => {
    window.__studioApp.state.addComponent(arg.comp);
  });
  await expect(page.locator('.inspector-badge.comp-type')).toHaveCount(1);
  await expect(page.locator('.inspector-badge.comp-type')).toHaveText(P);
  await page.getByTestId('inspector-tab-data').click();
  const propsMount = page.getByTestId('inspector-panel-data').locator('.caps-empty');
  await expect(propsMount).toHaveCount(1);
  await expect(propsMount).toHaveText(`Standard properties active for ${P}`);
  expect(await countInjectedInInspector(page)).toBe(0);
  expect(await readWriteCheck(page)).toEqual({ widgetDefChanged: false, writes: [] });
  expect(renderErrors).toEqual([]);
});

test('sweep C4a: gauge value and output range endpoints render exactly', async ({ page }) => {
  const renderErrors = await openComponentCase(page, {
    comp: { id: 'sweep-pin', type: 'core.gauge', props: { valueRange: [P, P], outputRange: [P, P] }, style: {} },
  }, (arg) => {
    window.__studioApp.state.addComponent(arg.comp);
  });
  await page.getByTestId('inspector-tab-data').click();
  await expect(page.locator('.range-lo')).toHaveCount(2);
  await expect(page.locator('.range-hi')).toHaveCount(2);
  for (const selector of ['.range-lo', '.range-hi']) {
    const values = await page.locator(selector).evaluateAll((els) => els.map((el) => el.getAttribute('value')));
    expect(values, selector).toEqual([P, P]);
  }
  expect(await countInjectedInInspector(page)).toBe(0);
  expect(await readWriteCheck(page)).toEqual({ widgetDefChanged: false, writes: [] });
  expect(renderErrors).toEqual([]);
});

test('sweep C4b: selector Rotary positions render exactly', async ({ page }) => {
  const renderErrors = await openComponentCase(page, {
    comp: { id: 'sweep-pin', type: 'core.selector', props: { positions: [{ value: P, label: P, angle: P }] }, style: {} },
  }, (arg) => {
    window.__studioApp.state.addComponent(arg.comp);
  });
  await page.getByTestId('inspector-tab-data').click();
  const mount = page.locator('#rf-props-positions');
  await expect(mount).toHaveCount(1);
  await expect(mount.locator('input.row-field[data-field="value"]')).toHaveCount(1);
  await expect(mount.locator('input.row-field[data-field="value"]')).toHaveValue(P);
  await expect(mount.locator('input.row-field[data-field="label"]')).toHaveCount(1);
  await expect(mount.locator('input.row-field[data-field="label"]')).toHaveValue(P);
  await expect(mount.locator('input.row-field[data-field="angle"]')).toHaveCount(1);
  await expect(mount.locator('input.row-field[data-field="angle"]')).toHaveAttribute('value', P);
  expect(await countInjectedInInspector(page)).toBe(0);
  expect(await readWriteCheck(page)).toEqual({ widgetDefChanged: false, writes: [] });
  expect(renderErrors).toEqual([]);
});

test('sweep C4c: rocker zones render exactly, including a custom write event', async ({ page }) => {
  const renderErrors = await openComponentCase(page, {
    comp: { id: 'sweep-pin', type: 'core.rocker', props: { zones: [{ id: P, label: P, writeEvent: P, repeatRate: P }] }, style: {} },
  }, (arg) => {
    window.__studioApp.state.addComponent(arg.comp);
  });
  await page.getByTestId('inspector-tab-data').click();
  const mount = page.locator('#rf-props-zones');
  await expect(mount).toHaveCount(1);
  await expect(mount.locator('input.row-field[data-field="id"]')).toHaveCount(1);
  await expect(mount.locator('input.row-field[data-field="id"]')).toHaveValue(P);
  await expect(mount.locator('input.row-field[data-field="label"]')).toHaveCount(1);
  await expect(mount.locator('input.row-field[data-field="label"]')).toHaveValue(P);
  await expect(mount.locator('select.row-field[data-field="writeEvent"]')).toHaveCount(1);
  await expect(mount.locator('select.row-field[data-field="writeEvent"]')).toHaveValue('__custom__');
  await expect(mount.locator('.row-field-custom[data-field="writeEvent"]')).toHaveCount(1);
  await expect(mount.locator('.row-field-custom[data-field="writeEvent"]')).toBeVisible();
  await expect(mount.locator('.row-field-custom[data-field="writeEvent"]')).toHaveValue(P);
  await expect(mount.locator('input.row-field[data-field="repeatRate"]')).toHaveCount(1);
  await expect(mount.locator('input.row-field[data-field="repeatRate"]')).toHaveAttribute('value', P);
  expect(await countInjectedInInspector(page)).toBe(0);
  expect(await readWriteCheck(page)).toEqual({ widgetDefChanged: false, writes: [] });
  expect(renderErrors).toEqual([]);
});

test('sweep C5: a multi-selection header lists both authored ids literally', async ({ page }) => {
  const renderErrors = await openComponentCase(page, {
    compA: { id: P, type: 'core.button', props: {}, style: {} },
    compB: { id: P2, type: 'core.button', props: {}, style: {} },
  }, (arg) => {
    const { state } = window.__studioApp;
    const idA = state.addComponent(arg.compA).id;
    const idB = state.addComponent(arg.compB).id;
    state.selectComponent(idA);
    state.selectComponent(idB, true);
  });
  await expect(page.locator('.inspector-sub')).toHaveCount(1);
  await expect(page.locator('.inspector-sub')).toHaveText(`${P}, ${P2}`);
  expect(await countInjectedInInspector(page)).toBe(0);
  expect(await readWriteCheck(page)).toEqual({ widgetDefChanged: false, writes: [] });
  expect(renderErrors).toEqual([]);
});
