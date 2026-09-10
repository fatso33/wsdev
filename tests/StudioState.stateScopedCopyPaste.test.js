// widget-studio/tests/StudioState.stateScopedCopyPaste.test.js
import { describe, it, expect } from 'vitest';
import { StudioState } from '../js/StudioState.js';

describe('state-scoped Copy/Paste Style', () => {
  it('copies and pastes only the active state\'s style, leaving base style untouched', () => {
    const state = new StudioState();
    state.widgetDef.components = [
      { id: 'btnA', type: 'core.button', style: { typography: { color: '#111111' }, states: { pressed: { typography: { color: '#ff0000' } } } } },
      { id: 'btnB', type: 'core.button', style: { typography: { color: '#222222' }, states: { pressed: { typography: { color: '#0000ff' } } } } },
    ];

    state.copyComponentStyle('btnA', 'pressed');
    state.pasteStyleToComponent('btnB', 'pressed');

    const btnB = state.getComponent('btnB');
    expect(btnB.style.states.pressed.typography.color).toBe('#ff0000');
    expect(btnB.style.typography.color).toBe('#222222');
  });

  it('pasteStyleToSelection() is a no-op when clipboard holds a state-scoped style (Bug 2 guard)', () => {
    const state = new StudioState();
    state.widgetDef.components = [
      { id: 'btnA', type: 'core.button', style: { typography: { color: '#111111' }, states: { pressed: { typography: { color: '#ff0000' } } } } },
      { id: 'btnB', type: 'core.button', style: { typography: { color: '#222222' }, background: { fillColor: '#dddddd' } } },
      { id: 'btnC', type: 'core.button', style: { typography: { color: '#333333' } } },
    ];

    // Multi-select btnB and btnC
    state.multiSelectedIds = new Set(['btnB', 'btnC']);

    // Copy state-scoped style from btnA
    state.copyComponentStyle('btnA', 'pressed');

    // Attempt bulk paste — should be no-op
    state.pasteStyleToSelection();

    // btnB and btnC should be completely unchanged
    const btnB = state.getComponent('btnB');
    const btnC = state.getComponent('btnC');
    expect(btnB.style.typography.color).toBe('#222222');
    expect(btnB.style.background.fillColor).toBe('#dddddd');
    expect(btnC.style.typography.color).toBe('#333333');
  });

  it('pasteStyleToSelection() works correctly when clipboard holds a full-style copy', () => {
    const state = new StudioState();
    state.widgetDef.components = [
      { id: 'btnA', type: 'core.button', style: { typography: { color: '#111111' }, background: { fillColor: '#aaaaaa' } } },
      { id: 'btnB', type: 'core.button', style: { typography: { color: '#222222' } } },
      { id: 'btnC', type: 'core.button', style: { typography: { color: '#333333' } } },
    ];

    // Multi-select btnB and btnC
    state.multiSelectedIds = new Set(['btnB', 'btnC']);

    // Copy full style from btnA (no stateKey, so copiedStateKey stays null)
    state.copyComponentStyle('btnA');

    // Bulk paste should apply to all selected components
    state.pasteStyleToSelection();

    // btnB and btnC should now have btnA's full style
    const btnB = state.getComponent('btnB');
    const btnC = state.getComponent('btnC');
    expect(btnB.style.typography.color).toBe('#111111');
    expect(btnB.style.background.fillColor).toBe('#aaaaaa');
    expect(btnC.style.typography.color).toBe('#111111');
    expect(btnC.style.background.fillColor).toBe('#aaaaaa');
  });
});
