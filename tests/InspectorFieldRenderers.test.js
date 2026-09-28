import { expect, test } from 'vitest';
import { createFieldRenderers } from '../js/inspector/fieldRenderers.js';

const DISPATCH = [
  ['text', 'renderPlainField', 'text'],
  ['iconPicker', 'renderPlainField', 'text'],
  ['number', 'renderPlainField', 'number'],
  ['checkbox', 'renderCheckboxField'],
  ['select', 'renderSelectField'],
  ['color', 'renderColorField'],
  ['rowListEditor', 'renderRowListField'],
  ['detentEditor', 'renderRowListField'],
  ['arcBandsEditor', 'renderRowListField'],
  ['stateVarPicker', 'renderStateVarField'],
  ['assetPicker', 'renderAssetField'],
  ['rangeEditor', 'renderRangeField'],
  ['pivotEditor', 'renderPivotField'],
  ['stateRefPicker', 'renderBindingField'],
  ['transitionEditor', 'renderBindingField'],
];

test('factory creation touches no host property', () => {
  const host = new Proxy({}, { get() { throw new Error('host accessed'); } });
  expect(Object.keys(createFieldRenderers(host))).toEqual(DISPATCH.map(([control]) => control));
});

test('each control dispatches to its current host method with unchanged arguments', () => {
  const calls = [];
  const host = Object.fromEntries([...new Set(DISPATCH.map(([, method]) => method))]
    .map((method) => [method, (...args) => calls.push([method, ...args])]));
  const renderers = createFieldRenderers(host);
  const comp = { id: 'pin' };
  const field = { path: 'props.label' };
  const mount = {};
  for (const [control, method, inputType] of DISPATCH) {
    renderers[control](comp, field, mount);
    expect(calls.at(-1)).toEqual(inputType ? [method, comp, field, mount, inputType] : [method, comp, field, mount]);
  }
  host.renderPlainField = (...args) => calls.push(['replacement', ...args]);
  renderers.text(comp, field, mount);
  expect(calls.at(-1)).toEqual(['replacement', comp, field, mount, 'text']);
});

test('a binding row of text, number, select or stateVarPicker dispatches to renderBindingField; other controls ignore the path', () => {
  const calls = [];
  const host = Object.fromEntries([...new Set([...DISPATCH.map(([, method]) => method), 'renderBindingField'])]
    .map((method) => [method, (...args) => calls.push([method, ...args])]));
  const renderers = createFieldRenderers(host);
  const comp = { id: 'pin' };
  const mount = {};
  for (const control of ['text', 'number', 'select', 'stateVarPicker']) {
    const field = { path: 'binding.pollGroup', control };
    renderers[control](comp, field, mount);
    expect(calls.at(-1)).toEqual(['renderBindingField', comp, field, mount]);
  }
  const iconField = { path: 'binding.icon', control: 'iconPicker' };
  renderers.iconPicker(comp, iconField, mount);
  expect(calls.at(-1)).toEqual(['renderPlainField', comp, iconField, mount, 'text']);
  const checkboxField = { path: 'binding.flag', control: 'checkbox' };
  renderers.checkbox(comp, checkboxField, mount);
  expect(calls.at(-1)).toEqual(['renderCheckboxField', comp, checkboxField, mount]);
});
