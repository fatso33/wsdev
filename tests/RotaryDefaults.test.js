/**
 * What a Rotary is created with, and what switching its Write Mode does to it.
 *
 * The Absolute palette values are asserted as literals on purpose: "Absolute is completely
 * unchanged" is only a claim about the old numbers if the test does not read them back from
 * the code that produces them.
 */
import { describe, it, expect } from 'vitest';
import {
  HEADING_KNOB_BINDING,
  resolveRotaryCreationDefaults,
  resolveFeelReconciliation,
  applyRotaryContextChange,
  describePulseFeel
} from '../js/RotaryDefaults.js';
import { resolveFeelFloor, resolveFeelDefault } from '../widgets/components/rotaryEngine.js';
import { PALETTE_ITEMS } from '../js/StudioLayersPanel.js';
import { STUDIO_TEMPLATES } from '../js/StudioTemplates.js';
import { StudioValidator } from '../js/StudioValidator.js';
import { StudioState } from '../js/StudioState.js';

describe('creation defaults', () => {
  it('an Absolute Rotary is created exactly as it always was: a 0-360 heading knob at Feel 1 with a write event', () => {
    expect(resolveRotaryCreationDefaults('absolute')).toEqual({
      props: { min: 0, max: 360, degreesPerUnit: 1 },
      binding: { readSimVar: 'apHdgBugValue', writeEvent: 'apHdgSet' }
    });
  });

  it('an unset or unrecognised write mode creates an Absolute Rotary', () => {
    expect(resolveRotaryCreationDefaults(undefined)).toEqual(resolveRotaryCreationDefaults('absolute'));
    expect(resolveRotaryCreationDefaults('nonsense')).toEqual(resolveRotaryCreationDefaults('absolute'));
  });

  it('a Pulse Rotary is created with a Pulse-shaped Feel, above the Feel floor', () => {
    const { props } = resolveRotaryCreationDefaults('pulse');
    expect(props.writeMode).toBe('pulse');
    expect(props.degreesPerUnit).not.toBe(1);
    expect(props.degreesPerUnit).toBeGreaterThan(resolveFeelFloor('arc', 'pulse'));
    expect(props.degreesPerUnit).toBe(resolveFeelDefault('arc', 'pulse'));
  });

  it('a Pulse Rotary is created without a write event it will never send, but keeps its read', () => {
    const { binding } = resolveRotaryCreationDefaults('pulse');
    expect(binding).not.toHaveProperty('writeEvent');
    expect(binding.readSimVar).toBe('apHdgBugValue');
  });

  it('hands out fresh objects, so a caller mutating one cannot change the next Rotary', () => {
    const a = resolveRotaryCreationDefaults('absolute');
    a.props.degreesPerUnit = 99;
    a.binding.writeEvent = 'x';
    expect(resolveRotaryCreationDefaults('absolute').props.degreesPerUnit).toBe(1);
    expect(resolveRotaryCreationDefaults('absolute').binding.writeEvent).toBe('apHdgSet');
  });
});

describe('the palette and the starter templates share one Absolute default', () => {
  it('the palette Rotary is the Absolute creation default', () => {
    const entry = PALETTE_ITEMS.find((p) => p.type === 'core.rotary');
    const created = resolveRotaryCreationDefaults('absolute');
    expect(entry.defaultProps).toEqual(created.props);
    expect(entry.defaultBinding).toEqual(created.binding);
  });

  it('the HDG/ALT template heading Rotary carries the same binding as the palette', () => {
    const rotary = STUDIO_TEMPLATES.flatMap((t) => t.components || []).find((c) => c.id === 'rot_hdg');
    expect(rotary.binding).toEqual(HEADING_KNOB_BINDING);
    expect(rotary.binding).toEqual(PALETTE_ITEMS.find((p) => p.type === 'core.rotary').defaultBinding);
  });
});

describe('switching an existing Rotary Write Mode', () => {
  it('moves an untouched Absolute Feel to the Pulse default, and says what changed', () => {
    const result = resolveFeelReconciliation({ degreesPerUnit: 1 }, { writeMode: 'pulse' });
    expect(result.propsPatch).toEqual({ degreesPerUnit: resolveFeelDefault('arc', 'pulse') });
    expect(result.message).toMatch(/Feel/);
    expect(result.message).toContain('1');
    expect(result.message).toContain(String(resolveFeelDefault('arc', 'pulse')));
  });

  it('leaves a Feel the Author set at or above the new floor exactly alone', () => {
    for (const authored of [7, 12, 20, -7, -20]) {
      const result = resolveFeelReconciliation({ degreesPerUnit: authored }, { writeMode: 'pulse' });
      expect(result.propsPatch, String(authored)).toEqual({});
      expect(result.message, String(authored)).toBeNull();
    }
  });

  it('leaves an unset Feel unset: nothing is stored, so nothing is overwritten', () => {
    expect(resolveFeelReconciliation({}, { writeMode: 'pulse' }).propsPatch).toEqual({});
    expect(resolveFeelReconciliation(undefined, { writeMode: 'pulse' }).propsPatch).toEqual({});
  });

  it('returns a Pulse-default Feel to the Absolute default when switching back, and leaves other values', () => {
    const pulseDefault = resolveFeelDefault('arc', 'pulse');
    expect(resolveFeelReconciliation({ writeMode: 'pulse', degreesPerUnit: pulseDefault }, { writeMode: 'absolute' }).propsPatch).toEqual({ degreesPerUnit: 1 });
    expect(resolveFeelReconciliation({ writeMode: 'pulse', degreesPerUnit: 8 }, { writeMode: 'absolute' }).propsPatch).toEqual({});
  });

  it('does nothing for Tap, where Feel is the step size in both modes', () => {
    expect(resolveFeelReconciliation({ gesture: 'tap', degreesPerUnit: 1 }, { writeMode: 'pulse' }).propsPatch).toEqual({});
  });

  it('follows the Gesture: a Scrub Rotary gets the Scrub Pulse default, above the Scrub floor', () => {
    const { propsPatch } = resolveFeelReconciliation({ gesture: 'scrub', degreesPerUnit: 1 }, { writeMode: 'pulse' });
    expect(propsPatch.degreesPerUnit).toBeGreaterThan(resolveFeelFloor('scrub', 'pulse'));
  });

  it('does nothing when the mode does not change', () => {
    expect(resolveFeelReconciliation({ writeMode: 'pulse', degreesPerUnit: 1 }, { writeMode: 'pulse' }).propsPatch).toEqual({});
    expect(resolveFeelReconciliation({ degreesPerUnit: 1 }, { writeMode: 'absolute' }).propsPatch).toEqual({});
  });

  it('never touches anything but Feel: the returned patch has no write event key', () => {
    const { propsPatch } = resolveFeelReconciliation({ degreesPerUnit: 1 }, { writeMode: 'pulse' });
    expect(Object.keys(propsPatch)).toEqual(['degreesPerUnit']);
  });
});

describe('switching into Pulse never leaves a Feel below the new floor', () => {
  const arcFloor = resolveFeelFloor('arc', 'pulse');
  const scrubFloor = resolveFeelFloor('scrub', 'pulse');

  it('raises an adjusted Feel below the Arc floor to the floor, and says so', () => {
    for (const authored of [0.5, 2, 5]) {
      const result = resolveFeelReconciliation({ degreesPerUnit: authored }, { writeMode: 'pulse' });
      expect(result.propsPatch, String(authored)).toEqual({ degreesPerUnit: arcFloor });
      expect(result.message, String(authored)).toMatch(/floor/i);
      expect(result.message, String(authored)).toContain(String(arcFloor));
    }
  });

  it('says it moved to the default, not the floor, when Feel was untouched', () => {
    const result = resolveFeelReconciliation({ degreesPerUnit: 1 }, { writeMode: 'pulse' });
    expect(result.propsPatch).toEqual({ degreesPerUnit: resolveFeelDefault('arc', 'pulse') });
    expect(result.message).toMatch(/default/i);
    expect(result.message).not.toMatch(/floor/i);
  });

  it('raises against the Scrub floor when the Rotary is a Scrub Rotary', () => {
    const result = resolveFeelReconciliation({ gesture: 'scrub', degreesPerUnit: 8 }, { writeMode: 'pulse' });
    expect(result.propsPatch).toEqual({ degreesPerUnit: scrubFloor });
  });

  it('applies the floor to a negative Feel by magnitude and keeps its sign', () => {
    expect(resolveFeelReconciliation({ degreesPerUnit: -2 }, { writeMode: 'pulse' }).propsPatch).toEqual({ degreesPerUnit: -arcFloor });
  });

  it('leaves a Feel exactly at the floor alone', () => {
    expect(resolveFeelReconciliation({ degreesPerUnit: arcFloor }, { writeMode: 'pulse' }).propsPatch).toEqual({});
  });

  it('never raises anything on the way to Absolute, whose floor is the divisor guard', () => {
    expect(resolveFeelReconciliation({ writeMode: 'pulse', degreesPerUnit: arcFloor }, { writeMode: 'absolute' }).propsPatch).toEqual({});
    expect(resolveFeelReconciliation({ writeMode: 'pulse', degreesPerUnit: 8 }, { writeMode: 'absolute' }).propsPatch).toEqual({});
  });
});

describe('changing the Gesture keeps Feel at or above the new floor', () => {
  const arcFloor = resolveFeelFloor('arc', 'pulse');
  const scrubFloor = resolveFeelFloor('scrub', 'pulse');
  const pulseTap = (degreesPerUnit) => ({ writeMode: 'pulse', gesture: 'tap', degreesPerUnit });

  it('moves an untouched Pulse Tap Feel to the Arc default', () => {
    expect(resolveFeelReconciliation(pulseTap(1), { gesture: 'arc' }).propsPatch).toEqual({ degreesPerUnit: resolveFeelDefault('arc', 'pulse') });
  });

  it('raises an adjusted Pulse Tap Feel below the Arc floor to the floor', () => {
    const result = resolveFeelReconciliation(pulseTap(2), { gesture: 'arc' });
    expect(result.propsPatch).toEqual({ degreesPerUnit: arcFloor });
    expect(result.message).toMatch(/floor/i);
  });

  it('raises a Pulse Arc Feel at the Arc floor to the Scrub floor', () => {
    const result = resolveFeelReconciliation({ writeMode: 'pulse', gesture: 'arc', degreesPerUnit: arcFloor }, { gesture: 'scrub' });
    expect(result.propsPatch).toEqual({ degreesPerUnit: scrubFloor });
  });

  it('treats an unset stored Gesture as Arc when leaving it', () => {
    const result = resolveFeelReconciliation({ writeMode: 'pulse', degreesPerUnit: arcFloor }, { gesture: 'scrub' });
    expect(result.propsPatch).toEqual({ degreesPerUnit: scrubFloor });
  });

  it('leaves a Feel above the new floor alone', () => {
    expect(resolveFeelReconciliation({ writeMode: 'pulse', gesture: 'arc', degreesPerUnit: 20 }, { gesture: 'scrub' }).propsPatch).toEqual({});
  });

  it('never moves Feel when the Gesture changes in Absolute, where the default and floor do not depend on it', () => {
    for (const authored of [1, 3, 45, -2]) {
      expect(resolveFeelReconciliation({ gesture: 'arc', degreesPerUnit: authored }, { gesture: 'scrub' }).propsPatch, String(authored)).toEqual({});
    }
  });

  it('does nothing when the Gesture is set to the one it already resolves to', () => {
    expect(resolveFeelReconciliation({ writeMode: 'pulse', degreesPerUnit: 1 }, { gesture: 'arc' }).propsPatch).toEqual({});
  });

  it('applyRotaryContextChange returns the new prop and the Feel adjustment together, as fresh props', () => {
    const before = { writeMode: 'pulse', gesture: 'tap', degreesPerUnit: 2, min: 0 };
    const { props, message } = applyRotaryContextChange(before, 'gesture', 'arc');
    expect(props).toEqual({ writeMode: 'pulse', gesture: 'arc', degreesPerUnit: arcFloor, min: 0 });
    expect(message).toMatch(/floor/i);
    expect(before.gesture).toBe('tap');
    expect(before.degreesPerUnit).toBe(2);
  });

  it('applyRotaryContextChange leaves an unset Feel unset', () => {
    expect(applyRotaryContextChange({}, 'writeMode', 'pulse').props).toEqual({ writeMode: 'pulse' });
  });
});

describe('a multi-selection goes through the same Feel rule', () => {
  const seed = () => {
    const state = new StudioState();
    state.widgetDef.components = [
      { id: 'a', type: 'core.rotary', props: { degreesPerUnit: 1 }, binding: {} },
      { id: 'b', type: 'core.rotary', props: { degreesPerUnit: 2 }, binding: {} },
      { id: 'c', type: 'core.rotary', props: { degreesPerUnit: 20 }, binding: {} },
      { id: 'd', type: 'core.button', props: {}, binding: {} }
    ];
    state.multiSelectedIds = new Set(['a', 'b', 'c', 'd']);
    return state;
  };

  it('moves an untouched Feel to the default, raises a too-fine one, and leaves the rest', () => {
    const state = seed();
    state.applyFieldToSelection('props.writeMode', 'pulse');
    expect(state.getComponent('a').props.degreesPerUnit).toBe(resolveFeelDefault('arc', 'pulse'));
    expect(state.getComponent('b').props.degreesPerUnit).toBe(resolveFeelFloor('arc', 'pulse'));
    expect(state.getComponent('c').props.degreesPerUnit).toBe(20);
    expect(state.getComponent('c').props.writeMode).toBe('pulse');
  });

  it('does not invent a Feel on a component that is not a Rotary', () => {
    const state = seed();
    state.applyFieldToSelection('props.writeMode', 'pulse');
    expect(state.getComponent('d').props).not.toHaveProperty('degreesPerUnit');
  });

  it('applies the same rule to a Gesture change', () => {
    const state = new StudioState();
    state.widgetDef.components = [
      { id: 'a', type: 'core.rotary', props: { writeMode: 'pulse', gesture: 'tap', degreesPerUnit: 1 }, binding: {} },
      { id: 'b', type: 'core.rotary', props: { writeMode: 'pulse', gesture: 'tap', degreesPerUnit: 2 }, binding: {} }
    ];
    state.multiSelectedIds = new Set(['a', 'b']);
    state.applyFieldToSelection('props.gesture', 'arc');
    expect(state.getComponent('a').props.degreesPerUnit).toBe(resolveFeelDefault('arc', 'pulse'));
    expect(state.getComponent('b').props.degreesPerUnit).toBe(resolveFeelFloor('arc', 'pulse'));
  });

  it('is one undo step', () => {
    const state = seed();
    state.applyFieldToSelection('props.writeMode', 'pulse');
    state.undo();
    expect(state.getComponent('a').props.degreesPerUnit).toBe(1);
    expect(state.getComponent('b').props.degreesPerUnit).toBe(2);
    expect(state.getComponent('a').props.writeMode).toBeUndefined();
  });

  it('reports what it changed so the caller can tell the Author', () => {
    const notes = seed().applyFieldToSelection('props.writeMode', 'pulse');
    expect(notes.map((n) => n.componentId).sort()).toEqual(['a', 'b']);
  });
});

describe('a Pulse Rotary stored writeEvent is not declared as a capability', () => {
  const widgetWith = (props) => ({
    fdws: '1.30',
    components: [{
      id: 'r1', type: 'core.rotary',
      binding: { readSimVar: 'apHdgBugValue', writeEvent: 'apHdgSet', incrementEvent: 'apHdgBugInc', decrementEvent: 'apHdgBugDec' },
      props
    }]
  });

  it('syncCapabilities leaves it out for Pulse, but keeps it on the component', () => {
    const def = widgetWith({ writeMode: 'pulse' });
    StudioValidator.syncCapabilities(def);
    expect(def.capabilities.writeEvents).not.toContain('apHdgSet');
    expect(def.capabilities.writeEvents).toEqual(expect.arrayContaining(['apHdgBugInc', 'apHdgBugDec']));
    expect(def.components[0].binding.writeEvent).toBe('apHdgSet');
  });

  it('syncCapabilities still declares it for Absolute', () => {
    const def = widgetWith({ writeMode: 'absolute' });
    StudioValidator.syncCapabilities(def);
    expect(def.capabilities.writeEvents).toContain('apHdgSet');
  });

  it('validate() does not report it in the capabilities summary for Pulse', () => {
    const summary = StudioValidator.validate(widgetWith({ writeMode: 'pulse' })).capabilitiesSummary;
    expect(summary.writeEvents).not.toContain('apHdgSet');
  });
});

describe('describePulseFeel', () => {
  it('says Arc Feel is degrees per step and reports steps per revolution', () => {
    const d = describePulseFeel('arc', 'pulse', 12);
    expect(d.label).toMatch(/degrees per step/i);
    expect(d.note).toContain('30 steps per revolution');
  });

  it('reports the Feel the engine will actually run when the authored one is below the floor', () => {
    const floor = resolveFeelFloor('arc', 'pulse');
    const d = describePulseFeel('arc', 'pulse', 1);
    expect(d.note).toContain(`${360 / floor} steps per revolution`);
    expect(d.note).toMatch(/floor/i);
  });

  it('describes Scrub in pixels per step', () => {
    const d = describePulseFeel('scrub', 'pulse', 12);
    expect(d.label).toMatch(/pixels per step/i);
    expect(d.note).toContain('12');
  });

  it('is null where Feel keeps its usual meaning: Absolute and Tap', () => {
    expect(describePulseFeel('arc', 'absolute', 12)).toBeNull();
    expect(describePulseFeel('tap', 'pulse', 1)).toBeNull();
  });

  it('treats an unset Gesture as Arc, and an unset Feel as the default', () => {
    expect(describePulseFeel(undefined, 'pulse', undefined).label).toMatch(/degrees per step/i);
  });
});
