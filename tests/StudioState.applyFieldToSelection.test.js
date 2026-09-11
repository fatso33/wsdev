// widget-studio/tests/StudioState.applyFieldToSelection.test.js
// Ticket 11: the multi-select unified Style tab commits one field at a time
// (the same nested-path splice StudioInspector.commitField() uses for a
// single component), fanned out across every selected component with a
// single combined undo step — this is the StudioState-side half of that,
// mirroring the existing applyStyleToSelection()'s "one call = one undo
// entry" precedent rather than one updateComponent() per component.
import { describe, it, expect } from 'vitest';
import { StudioState } from '../js/StudioState.js';

describe('applyFieldToSelection', () => {
  it('applies a single nested style leaf to every selected component, preserving sibling keys', () => {
    const state = new StudioState();
    state.widgetDef.components = [
      { id: 'a', type: 'core.button', style: { typography: { size: 12, color: '#111111' } } },
      { id: 'b', type: 'core.rotary', style: { typography: { size: 10 } } },
    ];
    state.multiSelectedIds = new Set(['a', 'b']);

    state.applyFieldToSelection('style.typography.color', '#ff0000');

    expect(state.getComponent('a').style.typography.color).toBe('#ff0000');
    expect(state.getComponent('a').style.typography.size).toBe(12); // sibling preserved
    expect(state.getComponent('b').style.typography.color).toBe('#ff0000');
    expect(state.getComponent('b').style.typography.size).toBe(10); // sibling preserved
  });

  it('is a no-op below 2 selected components', () => {
    const state = new StudioState();
    state.widgetDef.components = [{ id: 'a', type: 'core.button', style: {} }];
    state.multiSelectedIds = new Set(['a']);

    state.applyFieldToSelection('style.typography.color', '#ff0000');

    expect(state.getComponent('a').style.typography).toBeUndefined();
  });

  it('produces a single combined undo step regardless of selection size', () => {
    const state = new StudioState();
    state.widgetDef.components = [
      { id: 'a', type: 'core.button', style: {} },
      { id: 'b', type: 'core.button', style: {} },
      { id: 'c', type: 'core.button', style: {} },
    ];
    state.multiSelectedIds = new Set(['a', 'b', 'c']);
    const before = state.undoStack.length;

    state.applyFieldToSelection('style.border.width', 3);

    expect(state.undoStack.length).toBe(before + 1);
    expect(state.getComponent('c').style.border.width).toBe(3);
  });

  it('can target a state-retargeted path (style.states.<name>.*)', () => {
    const state = new StudioState();
    state.widgetDef.components = [
      { id: 'a', type: 'core.button', style: {} },
      { id: 'b', type: 'core.button', style: { states: { pressed: { border: { width: 1 } } } } },
    ];
    state.multiSelectedIds = new Set(['a', 'b']);

    state.applyFieldToSelection('style.states.pressed.typography.color', '#00ff00');

    expect(state.getComponent('a').style.states.pressed.typography.color).toBe('#00ff00');
    expect(state.getComponent('b').style.states.pressed.typography.color).toBe('#00ff00');
    expect(state.getComponent('b').style.states.pressed.border.width).toBe(1); // sibling preserved
  });
});
