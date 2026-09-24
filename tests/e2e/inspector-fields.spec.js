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

// Registry field group pins drive `renderRegistryFields` and its helpers through the real
// Inspector instance, with synthetic registry rows so each rule is isolated.

test('registry fields skip null and bespoke controls and hide unauthored showWhen fields', async ({
  page,
}) => {
  await openStudio(page);
  const [id] = await seedComponents(page, [
    { id: 'group-skip', type: 'core.button', style: {}, props: { label: 'Skip', mode: 'y' } },
  ]);
  const result = await page.evaluate((componentId) => {
    const host = window.__studioApp.inspector;
    const comp = window.__studioApp.state.getComponent(componentId);
    const mount = document.createElement('div');
    document.body.append(mount);
    host.renderRegistryFields(comp, mount, [
      { path: 'props.nullControl', control: null, default: undefined },
      { path: 'props.bespokeControl', control: 'bespoke', default: undefined },
      { path: 'props.label', control: 'text', tier: 'simple', guided: true, default: undefined },
      {
        path: 'props.hiddenByGate',
        control: 'text',
        tier: 'simple',
        guided: true,
        default: undefined,
        showWhen: { path: 'props.mode', equals: 'x' },
      },
      {
        path: 'props.gateDefault',
        control: 'text',
        tier: 'simple',
        guided: true,
        default: 'own',
        showWhen: { path: 'props.mode', equals: 'x' },
      },
    ]);
    return {
      children: mount.children.length,
      labels: [...mount.querySelectorAll('label')].map((l) => l.textContent),
    };
  }, id);

  expect(result.children).toBe(1);
  expect(result.labels).toEqual(['Label']);
});

test('registry field wraps set tier attributes; any authored non-default value drops them', async ({
  page,
}) => {
  await openStudio(page);
  const [id] = await seedComponents(page, [
    {
      id: 'group-tier',
      type: 'core.button',
      style: {},
      props: { authoredAdvanced: 'x', authoredSimple: 'y', atDefault: 'same' },
    },
  ]);
  const result = await page.evaluate((componentId) => {
    const host = window.__studioApp.inspector;
    const comp = window.__studioApp.state.getComponent(componentId);
    const field = (name, extra) => ({
      path: `props.${name}`,
      control: 'text',
      default: undefined,
      ...extra,
    });
    const mount = document.createElement('div');
    document.body.append(mount);
    host.renderRegistryFields(comp, mount, [
      field('plainAdvanced', { tier: 'advanced' }),
      field('plainSimple', { tier: 'simple' }),
      field('plainGuided', { tier: 'simple', guided: true }),
      field('authoredAdvanced', { tier: 'advanced' }),
      field('authoredSimple', { tier: 'simple' }),
      field('atDefault', { tier: 'advanced', default: 'same' }),
    ]);
    return [...mount.children].map((wrap) => wrap.getAttribute('data-tier'));
  }, id);

  // advanced, simple (not guided), guided, authored advanced, authored simple, set to own default
  expect(result).toEqual(['advanced', 'build', null, null, null, 'advanced']);
});

test('showWhen-suppressed authored fields render dimmed with the exact reason and a Clear that commits undefined', async ({
  page,
}) => {
  await openStudio(page);
  const [id] = await seedComponents(page, [
    {
      id: 'group-suppressed',
      type: 'core.button',
      style: {},
      props: { mode: 'y', other: 'z', keep: 'stale', keepDefault: 'own', anyOf: 'q' },
    },
  ]);
  const result = await page.evaluate((componentId) => {
    const host = window.__studioApp.inspector;
    const state = window.__studioApp.state;
    const comp = state.getComponent(componentId);
    const field = (name, showWhen, extra) => ({
      path: `props.${name}`,
      control: 'text',
      tier: 'advanced',
      default: undefined,
      showWhen,
      ...extra,
    });
    const mount = document.createElement('div');
    document.body.append(mount);
    host.renderRegistryFields(comp, mount, [
      field('keep', { path: 'props.mode', equals: 'x' }),
      field('keepDefault', { path: 'props.mode', equals: 'x' }, { default: 'own' }),
      field('anyOf', { path: 'props.mode', equalsAny: ['a', 'b'] }),
      field('other', { path: 'props.mode', notEquals: 'y' }),
    ]);
    const wraps = [...mount.children];
    const info = {
      count: wraps.length,
      notes: wraps.map((wrap) => wrap.querySelector('.prop-showwhen-note span')?.textContent ?? null),
      dataTier: wraps.map((wrap) => wrap.getAttribute('data-tier')),
      dimmed: wraps.map((wrap) => wrap.children[1]?.style.opacity ?? null),
    };
    wraps[0].querySelector('.prop-showwhen-clear').click();
    info.afterClear = state.getComponent(componentId).props.keep;
    return info;
  }, id);

  // keepDefault holds its own default, so it is not authored and stays hidden.
  expect(result.count).toBe(3);
  expect(result.notes).toEqual([
    'Mode ≠ x — still set to "stale"',
    'Mode is not one of: a, b — still set to "q"',
    'Mode = y — still set to "z"',
  ]);
  expect(result.dataTier).toEqual([null, null, null]);
  expect(result.dimmed).toEqual(['0.55', '0.55', '0.55']);
  expect(result.afterClear).toBeUndefined();
});

test('showWhen evaluation falls back from the raw value to inheritedValue, then the sibling default', async ({
  page,
}) => {
  await openStudio(page);
  const [id] = await seedComponents(page, [
    { id: 'group-when', type: 'core.button', style: {}, props: { raw: 'set' } },
  ]);
  const result = await page.evaluate((componentId) => {
    const host = window.__studioApp.inspector;
    const comp = window.__studioApp.state.getComponent(componentId);
    const siblings = [
      { path: 'props.withDefault', default: 'd' },
      { path: 'props.withInherited', default: 'd', inheritedValue: 'inh' },
      { path: 'props.noDefault' },
    ];
    const when = (showWhen, list) => host.evaluateShowWhen(comp, showWhen, list);
    return {
      rawWins: when({ path: 'props.raw', equals: 'set' }, siblings),
      defaultFallback: when({ path: 'props.withDefault', equals: 'd' }, siblings),
      inheritedBeatsDefault: [
        when({ path: 'props.withInherited', equals: 'inh' }, siblings),
        when({ path: 'props.withInherited', equals: 'd' }, siblings),
      ],
      noSiblingsMeansUndefined: [
        when({ path: 'props.withDefault', equals: 'd' }),
        when({ path: 'props.withDefault', notEquals: 'd' }),
      ],
      noDefaultKey: when({ path: 'props.noDefault', equals: undefined }, siblings),
      equalsAny: [
        when({ path: 'props.raw', equalsAny: ['a', 'set'] }),
        when({ path: 'props.raw', equalsAny: ['a'] }),
      ],
      noOperator: when({ path: 'props.raw' }, siblings),
      reasons: [
        host.formatShowWhenReason({ path: 'props.iconWidth', equals: 'x' }),
        host.formatShowWhenReason({ path: 'props.hasLed', notEquals: 'y' }),
        host.formatShowWhenReason({ path: 'props.mode', equalsAny: ['a', 'b'] }),
        host.formatShowWhenReason({ path: 'props.assetId' }),
      ],
      effective: [
        host.resolveEffectiveValue(comp, { path: 'props.raw', default: 'd', inheritedValue: 'inh' }),
        host.resolveEffectiveValue(comp, { path: 'props.unset', default: 'd', inheritedValue: 'inh' }),
        host.resolveEffectiveValue(comp, { path: 'props.unset', default: 'd' }),
        host.resolveEffectiveValue(comp, { path: 'props.unset' }),
      ],
    };
  }, id);

  expect(result.rawWins).toBe(true);
  expect(result.defaultFallback).toBe(true);
  expect(result.inheritedBeatsDefault).toEqual([true, false]);
  expect(result.noSiblingsMeansUndefined).toEqual([false, true]);
  expect(result.noDefaultKey).toBe(true);
  expect(result.equalsAny).toEqual([true, false]);
  expect(result.noOperator).toBe(true);
  expect(result.reasons).toEqual([
    'Icon Width ≠ x',
    'Has LED = y',
    'Mode is not one of: a, b',
    'a condition on Asset ID',
  ]);
  expect(result.effective).toEqual([
    { value: 'set', dimmed: false },
    { value: 'inh', dimmed: true },
    { value: 'd', dimmed: false },
    { dimmed: false },
  ]);
});

test('style test ids come from originalPath; overrides show an indicator unless a group covers the path', async ({
  page,
}) => {
  await openStudio(page);
  const [id] = await seedComponents(page, [
    {
      id: 'group-override',
      type: 'core.button',
      style: {
        typography: { color: '#111111' },
        states: { pressed: { typography: { color: '#ff0000' } } },
      },
      props: { label: 'Override' },
    },
  ]);
  const result = await page.evaluate((componentId) => {
    const host = window.__studioApp.inspector;
    const state = window.__studioApp.state;
    const comp = state.getComponent(componentId);
    const mountFor = (fields, target, covered) => {
      const mount = document.createElement('div');
      document.body.append(mount);
      host.renderRegistryFields(comp, mount, fields, target, covered);
      return mount;
    };
    const retargeted = {
      path: 'style.states.pressed.typography.color',
      originalPath: 'style.typography.color',
      control: 'color',
      tier: 'simple',
      guided: true,
      default: undefined,
    };
    const baseField = {
      path: 'style.typography.color',
      control: 'color',
      tier: 'simple',
      guided: true,
      default: undefined,
    };
    const describe = (mount) => {
      const wrap = mount.firstElementChild;
      return {
        testid: wrap.getAttribute('data-testid'),
        overridden: wrap.classList.contains('is-overridden'),
        clearIcons: wrap.querySelectorAll('[data-testid="clear-override"]').length,
      };
    };
    const stateTarget = { kind: 'state', name: 'pressed' };
    const info = {
      stateTarget: describe(mountFor([retargeted], stateTarget)),
      covered: describe(mountFor([retargeted], stateTarget, new Set([retargeted.path]))),
      base: describe(mountFor([baseField], { kind: 'base' })),
      noTarget: describe(mountFor([baseField])),
      unset: describe(
        mountFor(
          [
            {
              ...retargeted,
              path: 'style.states.pressed.typography.weight',
              originalPath: 'style.typography.weight',
            },
          ],
          stateTarget,
        ),
      ),
      nonStyle: mountFor([
        { path: 'props.label', control: 'text', tier: 'simple', guided: true, default: undefined },
      ]).firstElementChild.getAttribute('data-testid'),
    };
    const icon = mountFor([retargeted], stateTarget).querySelector('[data-testid="clear-override"]');
    const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
    icon.dispatchEvent(clickEvent);
    info.clearPrevented = clickEvent.defaultPrevented;
    info.afterClear = state.getComponent(componentId).style.states?.pressed?.typography?.color;
    return info;
  }, id);

  expect(result.stateTarget).toEqual({
    testid: 'style-field-typography.color',
    overridden: true,
    clearIcons: 1,
  });
  expect(result.covered).toEqual({
    testid: 'style-field-typography.color',
    overridden: false,
    clearIcons: 0,
  });
  expect(result.base).toEqual({
    testid: 'style-field-typography.color',
    overridden: false,
    clearIcons: 0,
  });
  expect(result.noTarget.overridden).toBe(false);
  expect(result.unset).toEqual({
    testid: 'style-field-typography.weight',
    overridden: false,
    clearIcons: 0,
  });
  expect(result.nonStyle).toBeNull();
  expect(result.clearPrevented).toBe(true);
  expect(result.afterClear).toBeUndefined();
});

test('compound rows render alike in either member order and fall back to single fields under two survivors', async ({
  page,
}) => {
  await openStudio(page);
  const [id] = await seedComponents(page, [
    {
      id: 'group-compound',
      type: 'core.button',
      style: {},
      props: { label: 'Compound', mode: 'y' },
    },
  ]);
  const result = await page.evaluate((componentId) => {
    const host = window.__studioApp.inspector;
    const comp = window.__studioApp.state.getComponent(componentId);
    const mountFor = (fields, target) => {
      const mount = document.createElement('div');
      document.body.append(mount);
      host.renderRegistryFields(comp, mount, fields, target);
      return mount;
    };
    const num = (path, extra) => ({
      path,
      control: 'number',
      tier: 'simple',
      guided: true,
      default: undefined,
      tooltip: `${path} tip`,
      ...extra,
    });
    const summary = (mount) =>
      [...mount.children].map((child) => ({
        testid: child.getAttribute('data-testid'),
        items: [...child.querySelectorAll('.prop-field-compound-item')].map((item) => ({
          label: item.querySelector('label').textContent,
          title: item.querySelector('label').title,
          labelClass: item.querySelector('label').className,
        })),
      }));
    const offsetX = num('style.offset.x');
    const offsetY = num('style.offset.y');
    const hidden = mountFor([
      num('props.min'),
      num('props.max', { showWhen: { path: 'props.mode', equals: 'x' } }),
    ]);
    const plain = document.createElement('div');
    plain.className = 'prop-field';
    plain.innerHTML = '<label>Original</label><input>';
    const titled = document.createElement('div');
    titled.className = 'prop-field';
    titled.innerHTML = '<label title="keep">Original</label><input>';
    const row = host.assembleCompoundRow('compound-row-custom', [
      { wrap: plain, label: 'A:', tooltip: 'tip' },
      { wrap: titled, label: 'B:', tooltip: 'ignored' },
    ]);
    return {
      forward: summary(mountFor([offsetX, offsetY])),
      reversed: summary(mountFor([offsetY, offsetX])),
      interleaved: summary(mountFor([offsetY, num('props.other'), offsetX])),
      retargeted: summary(
        mountFor(
          [
            { ...offsetX, path: 'style.states.pressed.offset.x', originalPath: 'style.offset.x' },
            { ...offsetY, path: 'style.states.pressed.offset.y', originalPath: 'style.offset.y' },
          ],
          { kind: 'state', name: 'pressed' },
        ),
      ),
      partial: summary(mountFor([offsetX])),
      twice: summary(mountFor([offsetX, offsetY, offsetX])),
      hidden: {
        children: hidden.children.length,
        compound: hidden.querySelectorAll('.prop-field-compound').length,
      },
      assembled: {
        testid: row.getAttribute('data-testid'),
        className: row.className,
        detached: row.parentElement === null,
        labels: [...row.querySelectorAll('label')].map((l) => [l.textContent, l.title, l.className]),
        itemClasses: [...row.children].map((c) => c.className),
      },
    };
  }, id);

  const expectedRow = {
    testid: 'compound-row-offset',
    items: [
      { label: 'X:', title: 'style.offset.x tip', labelClass: 'prop-compound-label' },
      { label: 'Y:', title: 'style.offset.y tip', labelClass: 'prop-compound-label' },
    ],
  };
  // Members are fetched by group.paths order, so member order in `fields` does not matter.
  expect(result.forward).toEqual([expectedRow]);
  expect(result.reversed).toEqual([expectedRow]);
  expect(result.interleaved).toEqual([expectedRow, { testid: null, items: [] }]);
  expect(result.retargeted).toEqual([expectedRow]);
  // A group whose members are not all present is not a compound row; the lone field renders singly.
  expect(result.partial).toEqual([{ testid: 'style-field-offset.x', items: [] }]);
  expect(result.twice).toEqual([expectedRow]);
  expect(result.hidden).toEqual({ children: 1, compound: 0 });
  expect(result.assembled).toEqual({
    testid: 'compound-row-custom',
    className: 'prop-field-compound',
    detached: true,
    labels: [
      ['A:', 'tip', 'prop-compound-label'],
      ['B:', 'keep', 'prop-compound-label'],
    ],
    itemClasses: ['prop-field prop-field-compound-item', 'prop-field prop-field-compound-item'],
  });
});

test('field groups render one subtitle per group in first-seen order, and gates only see their own group', async ({
  page,
}) => {
  await openStudio(page);
  const [id] = await seedComponents(page, [
    { id: 'group-order', type: 'core.button', style: {}, props: { label: 'Groups' } },
  ]);
  const result = await page.evaluate((componentId) => {
    const host = window.__studioApp.inspector;
    const comp = window.__studioApp.state.getComponent(componentId);
    const field = (path, group, extra) => ({
      path,
      group,
      control: 'text',
      tier: 'simple',
      guided: true,
      default: undefined,
      ...extra,
    });
    const body = document.createElement('div');
    document.body.append(body);
    host.renderRegistryFieldGroups(comp, body, [
      field('props.a', 'One', { default: 'x' }),
      field('props.b', 'Two', { showWhen: { path: 'props.a', equals: 'x' } }),
      field('props.c', 'One'),
      field('props.d', 'One', { showWhen: { path: 'props.a', equals: 'x' } }),
    ]);
    const kids = [...body.children];
    return {
      tags: kids.map((k) => `${k.tagName}.${k.className}`),
      subtitles: kids
        .filter((k) => k.className === 'prop-section-subtitle')
        .map((k) => [k.textContent, k.style.marginTop]),
      mounts: kids
        .filter((k) => k.className !== 'prop-section-subtitle')
        .map((k) => [...k.querySelectorAll('label')].map((l) => l.textContent)),
    };
  }, id);

  expect(result.tags).toEqual([
    'DIV.prop-section-subtitle',
    'DIV.',
    'DIV.prop-section-subtitle',
    'DIV.',
  ]);
  expect(result.subtitles).toEqual([
    ['One', ''],
    ['Two', '10px'],
  ]);
  // props.a's default 'x' satisfies gates within group One. Group Two lists only its own
  // fields, so its gate on props.a cannot find that default and props.b stays hidden.
  expect(result.mounts).toEqual([['A', 'C', 'D'], []]);
});
