/**
 * A Rotary's fast step events are write capabilities only while the Rotary actually sends
 * them: Pulse write mode with Acceleration on. validate() and syncCapabilities() must
 * agree on that, or a Widget with stale fast events left on it either declares events it
 * never sends or is warned about ones it never declared.
 */
import { describe, it, expect } from 'vitest';
import { StudioValidator } from '../js/StudioValidator.js';

const BINDING = {
  readSimVar: 'apHdgBugValue',
  incrementEvent: 'HDG_INC',
  decrementEvent: 'HDG_DEC',
  fastIncrementEvent: 'FAST_INC',
  fastDecrementEvent: 'FAST_DEC'
};

function widgetWith(props, capabilities) {
  return {
    fdws: '1.30',
    schemaVersion: '1.30.0',
    id: 'com.test.rotaryfast',
    meta: { name: 'Rotary Fast', category: 'Avionics' },
    layout: { defaultW: 4, defaultH: 4, grid: { columns: 4, rows: 4 } },
    components: [{ id: 'rot', type: 'core.rotary', binding: { ...BINDING }, props: { min: 0, max: 360, ...props }, layout: { col: 1, row: 1, w: 4, h: 4 } }],
    ...(capabilities ? { capabilities } : {})
  };
}

describe('fast step events as write capabilities', () => {
  it('validate() and syncCapabilities() both include them for a Pulse Rotary with Acceleration on', () => {
    const props = { writeMode: 'pulse', acceleration: true };
    expect(StudioValidator.validate(widgetWith(props)).capabilitiesSummary.writeEvents).toEqual(expect.arrayContaining(['FAST_INC', 'FAST_DEC']));
    const def = widgetWith(props);
    StudioValidator.syncCapabilities(def);
    expect(def.capabilities.writeEvents).toEqual(expect.arrayContaining(['FAST_INC', 'FAST_DEC']));
  });

  for (const [label, props] of [
    ['a Pulse Rotary with Acceleration off', { writeMode: 'pulse' }],
    ['an Absolute Rotary with Acceleration on', { acceleration: true }]
  ]) {
    it(`validate() and syncCapabilities() both leave them out for ${label}`, () => {
      const summary = StudioValidator.validate(widgetWith(props)).capabilitiesSummary.writeEvents;
      expect(summary).not.toContain('FAST_INC');
      expect(summary).not.toContain('FAST_DEC');
      const def = widgetWith(props);
      StudioValidator.syncCapabilities(def);
      expect(def.capabilities.writeEvents).not.toContain('FAST_INC');
      expect(def.capabilities.writeEvents).not.toContain('FAST_DEC');
    });
  }

  it('raises no capabilities warning about a fast event the Widget never sends', () => {
    const declaresOnlyOrdinary = { writeEvents: ['HDG_INC', 'HDG_DEC'] };
    const unsent = StudioValidator.validate(widgetWith({ writeMode: 'pulse' }, declaresOnlyOrdinary));
    expect(unsent.warnings.filter((w) => /FAST_(INC|DEC)/.test(w) && /referenced|declared|capabilit/i.test(w))).toEqual([]);
    // Control: the same declaration is short of the fast events once they are sent, so
    // the cross-check the assertion above relies on really does look at them.
    const sent = StudioValidator.validate(widgetWith({ writeMode: 'pulse', acceleration: true }, declaresOnlyOrdinary));
    expect(sent.warnings.filter((w) => /FAST_(INC|DEC)/.test(w) && /referenced|declared|capabilit/i.test(w)).length).toBeGreaterThan(0);
  });
});
