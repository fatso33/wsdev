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
  resolveWriteModeSwitch,
  describePulseFeel
} from '../js/RotaryDefaults.js';
import { resolveFeelFloor, resolveFeelDefault } from '../widgets/components/rotaryEngine.js';
import { PALETTE_ITEMS } from '../js/StudioLayersPanel.js';
import { STUDIO_TEMPLATES } from '../js/StudioTemplates.js';
import { StudioValidator } from '../js/StudioValidator.js';

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
    const result = resolveWriteModeSwitch({ degreesPerUnit: 1 }, 'pulse');
    expect(result.propsPatch).toEqual({ degreesPerUnit: resolveFeelDefault('arc', 'pulse') });
    expect(result.message).toMatch(/Feel/);
    expect(result.message).toContain('1');
    expect(result.message).toContain(String(resolveFeelDefault('arc', 'pulse')));
  });

  it('leaves a Feel the Author set to anything else exactly alone', () => {
    for (const authored of [0.5, 3, 7, 12, 20, -1]) {
      const result = resolveWriteModeSwitch({ degreesPerUnit: authored }, 'pulse');
      expect(result.propsPatch, String(authored)).toEqual({});
      expect(result.message, String(authored)).toBeNull();
    }
  });

  it('leaves an unset Feel unset: nothing is stored, so nothing is overwritten', () => {
    expect(resolveWriteModeSwitch({}, 'pulse').propsPatch).toEqual({});
    expect(resolveWriteModeSwitch(undefined, 'pulse').propsPatch).toEqual({});
  });

  it('returns a Pulse-default Feel to the Absolute default when switching back, and leaves other values', () => {
    const pulseDefault = resolveFeelDefault('arc', 'pulse');
    expect(resolveWriteModeSwitch({ writeMode: 'pulse', degreesPerUnit: pulseDefault }, 'absolute').propsPatch).toEqual({ degreesPerUnit: 1 });
    expect(resolveWriteModeSwitch({ writeMode: 'pulse', degreesPerUnit: 8 }, 'absolute').propsPatch).toEqual({});
  });

  it('does nothing for Tap, where Feel is the step size in both modes', () => {
    expect(resolveWriteModeSwitch({ gesture: 'tap', degreesPerUnit: 1 }, 'pulse').propsPatch).toEqual({});
  });

  it('follows the Gesture: a Scrub Rotary gets the Scrub Pulse default, above the Scrub floor', () => {
    const { propsPatch } = resolveWriteModeSwitch({ gesture: 'scrub', degreesPerUnit: 1 }, 'pulse');
    expect(propsPatch.degreesPerUnit).toBeGreaterThan(resolveFeelFloor('scrub', 'pulse'));
  });

  it('does nothing when the mode does not change', () => {
    expect(resolveWriteModeSwitch({ writeMode: 'pulse', degreesPerUnit: 1 }, 'pulse').propsPatch).toEqual({});
    expect(resolveWriteModeSwitch({ degreesPerUnit: 1 }, 'absolute').propsPatch).toEqual({});
  });

  it('never touches anything but Feel: the returned patch has no write event key', () => {
    const { propsPatch } = resolveWriteModeSwitch({ degreesPerUnit: 1 }, 'pulse');
    expect(Object.keys(propsPatch)).toEqual(['degreesPerUnit']);
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
