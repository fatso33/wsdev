import {
  expect,
  openStudio,
  seedAssets,
  seedComponents,
  seedStateVars,
  test,
} from './fixtures/inspectorHarness.js';

test('number enhancement wraps once, mirrors lookup steps, clamps chevrons, and preserves wheel modifiers', async ({
  page,
}) => {
  await openStudio(page);
  const result = await page.evaluate(() => {
    const host = window.__studioApp.inspector;
    const root = document.createElement('div');
    root.innerHTML = `
      <input id="fractional" type="number" data-step-key="props.sensitivity" value="1.25" min="0" max="1.3">
      <input id="c-bind-deadband" type="number" value="0.05">
      <input id="default" type="number" value="2">
      <input id="disabled" type="number" value="3" disabled>
      <input id="wheel" type="number" data-step-key="props.sensitivity" value="1">
    `;
    document.body.append(root);
    host.enhanceNumberInputs(root);
    host.enhanceNumberInputs(root);
    const changes = [];
    root.addEventListener('change', (event) => changes.push(event.target.id));

    const fractional = root.querySelector('#fractional');
    fractional.closest('.prop-number-wrap').querySelector('.prop-number-chevron-up').click();
    root
      .querySelector('#disabled')
      .closest('.prop-number-wrap')
      .querySelector('.prop-number-chevron-up')
      .click();

    const wheel = root.querySelector('#wheel');
    const unfocused = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -100 });
    wheel.dispatchEvent(unfocused);
    wheel.focus();
    const shifted = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 0,
      deltaX: -1,
      shiftKey: true,
    });
    wheel.dispatchEvent(shifted);
    const alt = new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      deltaY: 100,
      altKey: true,
    });
    wheel.dispatchEvent(alt);

    return {
      wrappers: root.querySelectorAll('.prop-number-wrap').length,
      chevrons: root.querySelectorAll('.prop-number-chevrons').length,
      steps: ['fractional', 'c-bind-deadband', 'default'].map(
        (id) => root.querySelector(`#${id}`).step,
      ),
      fractionalValue: fractional.value,
      disabledValue: root.querySelector('#disabled').value,
      wheelValue: wheel.value,
      wheelPrevented: [unfocused.defaultPrevented, shifted.defaultPrevented, alt.defaultPrevented],
      changes,
    };
  });

  expect(result.wrappers).toBe(5);
  expect(result.chevrons).toBe(5);
  expect(result.steps).toEqual(['0.1', '0.01', '1']);
  expect(result.fractionalValue).toBe('1.3');
  expect(result.disabledValue).toBe('3');
  expect(Number(result.wheelValue)).toBeCloseTo(1.99, 5);
  expect(result.wheelPrevented).toEqual([false, true, true]);
  expect(result.changes).toEqual(['fractional', 'wheel', 'wheel']);
});

test('color pairs live-commit complete values, allow configured gradients, dedupe, and skip blanks', async ({
  page,
}) => {
  await openStudio(page);
  const [id] = await seedComponents(page, [
    {
      id: 'color-pin',
      type: 'core.button',
      style: { typography: { color: '#111111' } },
      props: { label: 'Color' },
    },
  ]);
  const result = await page.evaluate((componentId) => {
    const host = window.__studioApp.inspector;
    const state = window.__studioApp.state;
    const comp = state.getComponent(componentId);
    const root = document.createElement('div');
    root.innerHTML = '<button id="pick"></button><input id="color" type="text">';
    document.body.append(root);
    const committed = [];
    host.wireColorPair(
      root,
      'pick',
      'color',
      (value) => {
        committed.push(value);
        host.commitField(comp, 'style.typography.color', value);
      },
      { allowGradient: true, skipEmpty: true },
    );
    const input = root.querySelector('#color');
    const type = (value) => {
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    type('#abc');
    input.dispatchEvent(new Event('change', { bubbles: true }));
    type('#12');
    type('#AABBCC');
    type('#11223344');
    type('   ');
    type('linear-gradient(90deg, #fff, #000)');
    input.value = '#123456';
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { committed, value: state.getComponent(componentId).style.typography.color };
  }, id);

  expect(result.committed).toEqual([
    '#abc',
    '#AABBCC',
    '#11223344',
    'linear-gradient(90deg, #fff, #000)',
    '#123456',
  ]);
  expect(result.value).toBe('#123456');
});

test('number fields map blank to undefined and invalid numeric input to zero; numeric selects retain number types', async ({
  page,
}) => {
  await openStudio(page);
  const [padId, buttonId] = await seedComponents(page, [
    { id: 'field-pad', type: 'core.pad', style: {}, props: { sensitivity: 1 } },
    {
      id: 'field-button',
      type: 'core.button',
      style: { typography: { weight: 400 } },
      props: { label: 'Weight' },
    },
  ]);
  const result = await page.evaluate(
    async ([padKey, buttonKey]) => {
      const { COMMON_FIELDS, TYPE_FIELDS } = await import('/widgets/PropertyRegistry.js');
      const host = window.__studioApp.inspector;
      const state = window.__studioApp.state;
      const pad = state.getComponent(padKey);
      const sensitivity = TYPE_FIELDS['core.pad'].find(
        (field) => field.path === 'props.sensitivity',
      );
      const numberMount = document.createElement('div');
      host.FIELD_RENDERERS[sensitivity.control](pad, sensitivity, numberMount);
      document.body.append(numberMount);
      const numberInput = numberMount.querySelector('input');
      numberInput.value = '';
      numberInput.dispatchEvent(new Event('change', { bubbles: true }));
      const blankValue = state.getComponent(padKey).props.sensitivity;
      Object.defineProperty(numberInput, 'value', {
        configurable: true,
        get: () => 'not-a-number',
      });
      numberInput.dispatchEvent(new Event('change', { bubbles: true }));
      const invalidValue = state.getComponent(padKey).props.sensitivity;

      const button = state.getComponent(buttonKey);
      const weight = COMMON_FIELDS.find((field) => field.path === 'style.typography.weight');
      const selectMount = document.createElement('div');
      host.FIELD_RENDERERS[weight.control](button, weight, selectMount);
      document.body.append(selectMount);
      const select = selectMount.querySelector('select');
      select.value = '700';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        blankValue,
        invalidValue,
        weight: state.getComponent(buttonKey).style.typography.weight,
        weightType: typeof state.getComponent(buttonKey).style.typography.weight,
      };
    },
    [padId, buttonId],
  );

  expect(result.blankValue).toBeUndefined();
  expect(result.invalidValue).toBe(0);
  expect(result.weight).toBe(700);
  expect(result.weightType).toBe('number');
});

test('row lists add, edit numeric fields, remove, and reveal custom deck events', async ({
  page,
}) => {
  await openStudio(page);
  const [selectorId, rockerId] = await seedComponents(page, [
    {
      id: 'field-selector',
      type: 'core.selector',
      style: {},
      props: { mode: 'rotary', positions: [{ value: 'OFF', label: 'Off', angle: 0 }] },
    },
    {
      id: 'field-rocker',
      type: 'core.rocker',
      style: {},
      props: { zones: [{ id: 'left', label: 'Left', writeEvent: '', repeatRate: 100 }] },
    },
  ]);
  const result = await page.evaluate(
    async ([selectorKey, rockerKey]) => {
      const { TYPE_FIELDS } = await import('/widgets/PropertyRegistry.js');
      const host = window.__studioApp.inspector;
      const state = window.__studioApp.state;
      const render = (id, type, path) => {
        const comp = state.getComponent(id);
        const field = TYPE_FIELDS[type].find((item) => item.path === path);
        const mount = document.createElement('div');
        host.FIELD_RENDERERS[field.control](comp, field, mount);
        document.body.append(mount);
        return mount;
      };

      let positions = render(selectorKey, 'core.selector', 'props.positions');
      positions.querySelector('.row-add').click();
      const afterAdd = state.getComponent(selectorKey).props.positions;
      positions = render(selectorKey, 'core.selector', 'props.positions');
      const angle = positions.querySelector(
        '.row-list-item[data-idx="1"] .row-field[data-field="angle"]',
      );
      angle.value = '42.5';
      angle.dispatchEvent(new Event('change', { bubbles: true }));
      const afterNumericEdit = state.getComponent(selectorKey).props.positions[1].angle;
      positions = render(selectorKey, 'core.selector', 'props.positions');
      positions.querySelector('.row-list-item[data-idx="0"] .row-remove').click();
      const afterRemove = state.getComponent(selectorKey).props.positions;

      let zones = render(rockerKey, 'core.rocker', 'props.zones');
      const eventSelect = zones.querySelector('.row-field[data-field="writeEvent"]');
      eventSelect.value = [...eventSelect.options].find(
        (option) => option.textContent === 'Custom…',
      ).value;
      eventSelect.dispatchEvent(new Event('change', { bubbles: true }));
      const custom = zones.querySelector('.row-field-custom[data-field="writeEvent"]');
      const revealed = !custom.classList.contains('hidden');
      custom.value = 'CUSTOM_ROCKER_EVENT';
      custom.dispatchEvent(new Event('change', { bubbles: true }));
      const customEvent = state.getComponent(rockerKey).props.zones[0].writeEvent;
      zones = render(rockerKey, 'core.rocker', 'props.zones');
      const repeatRate = zones.querySelector('.row-field[data-field="repeatRate"]');
      repeatRate.value = '175';
      repeatRate.dispatchEvent(new Event('change', { bubbles: true }));
      const numericColumnType = typeof state.getComponent(rockerKey).props.zones[0].repeatRate;
      return {
        afterAdd,
        afterNumericEdit,
        afterRemove,
        revealed,
        customEvent,
        numericColumnType,
        repeatRate: state.getComponent(rockerKey).props.zones[0].repeatRate,
      };
    },
    [selectorId, rockerId],
  );

  expect(result.afterAdd).toHaveLength(2);
  expect(result.afterAdd[1]).toEqual({ value: '', label: '', angle: 0 });
  expect(result.afterNumericEdit).toBe(42.5);
  expect(result.afterRemove).toEqual([{ value: '', label: '', angle: 42.5 }]);
  expect(result.revealed).toBe(true);
  expect(result.customEvent).toBe('CUSTOM_ROCKER_EVENT');
  expect(result.numericColumnType).toBe('number');
  expect(result.repeatRate).toBe(175);
});

test('range and pivot editors keep their defaults; empty state-var and asset selects commit undefined', async ({
  page,
}) => {
  await openStudio(page);
  const [gaugeId, imageId] = await seedComponents(page, [
    {
      id: 'field-gauge',
      type: 'core.gauge',
      style: {},
      props: { transform: 'rotate', compose: {} },
    },
    { id: 'field-image', type: 'core.image', style: {}, props: {} },
  ]);
  await seedStateVars(page, [{ name: 'pinState', type: 'number', default: 1 }]);
  await seedAssets(page, [{ id: 'pinAsset', mimeType: 'image/svg+xml' }]);
  const result = await page.evaluate(
    async ([gaugeKey, imageKey]) => {
      const { TYPE_FIELDS } = await import('/widgets/PropertyRegistry.js');
      const host = window.__studioApp.inspector;
      const state = window.__studioApp.state;
      const render = (id, type, path) => {
        const comp = state.getComponent(id);
        const field = TYPE_FIELDS[type].find((item) => item.path === path);
        const mount = document.createElement('div');
        host.FIELD_RENDERERS[field.control](comp, field, mount);
        document.body.append(mount);
        return mount;
      };

      const range = render(gaugeKey, 'core.gauge', 'props.valueRange');
      const rangeDefaults = [...range.querySelectorAll('input')].map((input) => input.value);
      range.querySelector('.range-lo').value = '10';
      range.querySelector('.range-hi').value = '90';
      range.querySelector('.range-lo').dispatchEvent(new Event('change', { bubbles: true }));

      const pivot = render(gaugeKey, 'core.gauge', 'props.pivot');
      const pivotDefaults = ['x', 'y'].map(
        (axis) => pivot.querySelector(`#rf-props-pivot-${axis}`).value,
      );
      pivot.querySelector('#rf-props-pivot-x').value = '25%';
      pivot
        .querySelector('#rf-props-pivot-x')
        .dispatchEvent(new Event('change', { bubbles: true }));

      const stateVar = render(gaugeKey, 'core.gauge', 'props.compose.stateVar');
      const stateOptions = [...stateVar.querySelectorAll('option')].map((option) => option.value);
      stateVar.querySelector('select').value = '';
      stateVar.querySelector('select').dispatchEvent(new Event('change', { bubbles: true }));
      const asset = render(imageKey, 'core.image', 'props.assetId');
      const assetOptions = [...asset.querySelectorAll('option')].map((option) => option.value);
      asset.querySelector('select').value = '';
      asset.querySelector('select').dispatchEvent(new Event('change', { bubbles: true }));

      return {
        rangeDefaults,
        range: state.getComponent(gaugeKey).props.valueRange,
        pivotDefaults,
        pivot: state.getComponent(gaugeKey).props.pivot,
        stateOptions,
        stateVar: state.getComponent(gaugeKey).props.compose.stateVar,
        assetOptions,
        assetId: state.getComponent(imageKey).props.assetId,
      };
    },
    [gaugeId, imageId],
  );

  expect(result.rangeDefaults).toEqual(['0', '1']);
  expect(result.range).toEqual([10, 90]);
  expect(result.pivotDefaults).toEqual(['50%', '50%']);
  expect(result.pivot).toEqual({ x: '25%', y: '50%' });
  expect(result.stateOptions).toContain('pinState');
  expect(result.stateVar).toBeUndefined();
  expect(result.assetOptions).toContain('pinAsset');
  expect(result.assetId).toBeUndefined();
});
