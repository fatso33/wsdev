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
});
