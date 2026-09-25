import { expect, openStudio, test } from './fixtures/inspectorHarness.js';

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
