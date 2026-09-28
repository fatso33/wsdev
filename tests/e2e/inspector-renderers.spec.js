import { expect, openStudio, readCalls, recordCalls, test } from './fixtures/inspectorHarness.js';

const CASES = [
  ['text', 'core.button', 'props.label', 'input[type="text"]'],
  ['iconPicker', 'core.button', 'props.icon', 'input[type="text"]'],
  ['number', 'core.gauge', 'props.arc.radius', 'input[type="number"]'],
  ['checkbox', 'core.button', 'props.hasLed', 'input[type="checkbox"]'],
  ['select', 'core.button', 'props.variant', 'select'],
  ['color', 'core.gauge', 'props.arc.color', '.color-picker-wrap'],
  ['rowListEditor', 'core.selector', 'props.positions', '.row-list-editor'],
  ['detentEditor', 'core.slider', 'props.detents', '.row-list-editor'],
  ['arcBandsEditor', 'core.gauge', 'props.arc.bands', '.row-list-editor'],
  ['stateVarPicker', 'core.gauge', 'props.compose.stateVar', 'select'],
  ['assetPicker', 'core.image', 'props.assetId', 'select'],
  ['rangeEditor', 'core.gauge', 'props.valueRange', 'input'],
  ['pivotEditor', 'core.gauge', 'props.pivot', 'input'],
];

test('all thirteen own renderers dispatch real registry fields through the Inspector, beside the binding renderers', async ({ page }) => {
  await openStudio(page);
  const results = await page.evaluate(async (cases) => {
    const { TYPE_FIELDS } = await import('/widgets/PropertyRegistry.js');
    const inspector = window.__studioApp.inspector;
    return cases.map(([control, type, path, selector]) => {
      const field = TYPE_FIELDS[type].find((entry) => entry.path === path);
      const comp = { id: `pin-${control}`, type, props: { transform: path === 'props.pivot' ? 'rotate' : 'arc', arc: {} }, style: {}, binding: {} };
      const mount = document.createElement('div');
      inspector.renderRegistryFields(comp, mount, [field]);
      return { control, own: Object.hasOwn(inspector, 'FIELD_RENDERERS'), keys: Object.keys(inspector.FIELD_RENDERERS),
        declaredControl: field?.control, rendered: Boolean(mount.querySelector(`.prop-field ${selector}`)) };
    });
  }, CASES);
  expect(results.map(({ control, own, declaredControl, rendered }) => ({ control, own, declaredControl, rendered })))
    .toEqual(CASES.map(([control]) => ({ control, own: true, declaredControl: control, rendered: true })));
  expect(results[0].keys).toEqual([...CASES.map(([control]) => control), 'stateRefPicker', 'transitionEditor', 'eventPicker', 'simVarPicker']);
});

test('renderer closures look up the host method at call time', async ({ page }) => {
  await openStudio(page);
  await recordCalls(page, '__studioApp.inspector', ['renderPlainField']);
  await page.evaluate(async () => {
    const { TYPE_FIELDS } = await import('/widgets/PropertyRegistry.js');
    const field = TYPE_FIELDS['core.button'].find((entry) => entry.path === 'props.label');
    window.__studioApp.inspector.renderRegistryFields(
      { id: 'pin-text', type: 'core.button', props: {}, style: {}, binding: {} },
      document.createElement('div'), [field],
    );
  });
  expect((await readCalls(page, '__studioApp.inspector')).map(({ method, args }) => [method, args[1].path, args[3]]))
    .toEqual([['renderPlainField', 'props.label', 'text']]);
});

test('an unregistered control still throws the exact development error', async ({ page }) => {
  await openStudio(page);
  const message = await page.evaluate(async () => {
    const { TYPE_FIELDS } = await import('/widgets/PropertyRegistry.js');
    const field = { ...TYPE_FIELDS['core.button'].find((entry) => entry.path === 'props.label'), control: 'unregisteredPin' };
    try {
      window.__studioApp.inspector.renderRegistryFields(
        { id: 'pin-unknown', type: 'core.button', props: {}, style: {}, binding: {} },
        document.createElement('div'), [field],
      );
    } catch (error) { return error.message; }
    return null;
  });
  expect(message).toBe('[StudioInspector] No FIELD_RENDERERS entry for control "unregisteredPin" (path "props.label") — register one before declaring a field with this control.');
});
