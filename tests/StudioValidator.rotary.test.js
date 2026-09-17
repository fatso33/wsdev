/**
 * Studio's authoring-side view of the rebuilt Rotary (Rotary rebuild, ticket 02).
 *
 * Two things this pins:
 *  1. core.rotary is now SELF-DISPATCHING — it writes binding.writeEvent itself, so
 *     Studio must stop reporting "this write event is never used" and stop proposing
 *     an interaction row to wire it up by hand.
 *  2. The two starter templates that still reference the OLD Rotary keep validating
 *     clean (the regression guard; reworking them into good examples is ticket 15).
 */
import { describe, it, expect } from 'vitest';
import { StudioValidator, SELF_DISPATCHING_WRITE_EVENT_TYPES, isWriteEventConsumed, proposeWireUp } from '../js/StudioValidator.js';
import { STUDIO_TEMPLATES } from '../js/StudioTemplates.js';

const boundRotary = {
  id: 'rot',
  type: 'core.rotary',
  binding: { readSimVar: 'apHdgBugValue', writeEvent: 'apHdgSet' },
  props: { min: 0, max: 360 }
};

describe('core.rotary is self-dispatching', () => {
  it('is listed as a type that writes its own binding.writeEvent', () => {
    expect(SELF_DISPATCHING_WRITE_EVENT_TYPES).toContain('core.rotary');
  });

  it('raises no "nothing sends this value to the simulator" issue for a bound Rotary with no interactions', () => {
    // isWriteEventConsumed() itself deliberately only looks at interaction rows — the
    // self-dispatch exemption is applied by its callers — so this asserts through
    // validate(), which is where an Author would actually see the complaint.
    expect(isWriteEventConsumed(boundRotary)).toBe(false);
    const result = StudioValidator.validate({
      fdws: '1.30', schemaVersion: '1.30.0', id: 'com.test.rotary',
      meta: { name: 'Rotary', category: 'Avionics' },
      layout: { defaultW: 4, defaultH: 4, grid: { columns: 4, rows: 4 } },
      components: [{ ...boundRotary, layout: { col: 1, row: 1, w: 4, h: 4 } }]
    });
    expect(result.errors).toEqual([]);
    expect((result.blockingIssues || []).map((b) => b.code)).not.toContain('UNWIRED_WRITE_EVENT');
    expect(result.warnings.join(' ')).not.toMatch(/doesn't send it automatically/);
  });

  it('proposes no hand-wired interaction row for it', () => {
    // The old proposal wired up 'fineChange' (and 'push' for a pushEvent) — both
    // triggers no longer exist, and neither is needed now the Component writes directly.
    expect(proposeWireUp(boundRotary)).toBeNull();
  });
});

describe('starter templates referencing the old Rotary (regression guard)', () => {
  const withRotary = STUDIO_TEMPLATES.filter(
    (t) => (t.components || []).some((c) => c.type === 'core.rotary')
  );

  it('still finds both templates that contain a Rotary', () => {
    expect(withRotary.map((t) => t.id).sort()).toEqual([
      'com.flightdeck.concentricdualknob',
      'com.flightdeck.hdgaltcontroller'
    ]);
  });

  it('validates every template without errors', () => {
    for (const template of STUDIO_TEMPLATES) {
      const result = StudioValidator.validate(template);
      expect(result.errors, `${template.id}: ${result.errors.join(' | ')}`).toEqual([]);
    }
  });

  it('declares an FDWS version the validators accept', () => {
    for (const template of withRotary) {
      expect(StudioValidator.validate(template).errors.join(' ')).not.toMatch(/fdws/i);
    }
  });
});

describe('the Rotary palette entry', () => {
  it('drops a Rotary whose defaults are the rebuilt Component\'s own props', async () => {
    const { PALETTE_ITEMS } = await import('../js/StudioLayersPanel.js');
    const rotary = PALETTE_ITEMS.find((i) => i.type === 'core.rotary');
    expect(Object.keys(rotary.defaultProps).sort()).toEqual(['degreesPerUnit', 'max', 'min']);
    // The palette's old blurb told Authors the Rotary couldn't write on its own and
    // to pair it with an interaction or use core.stepper instead. It can now.
    expect(rotary.desc).not.toMatch(/does not dispatch write events/i);
  });

  it('drops one that Studio immediately considers wired up', async () => {
    const { PALETTE_ITEMS, createComponentFromPaletteItem } = await import('../js/StudioLayersPanel.js');
    const rotary = PALETTE_ITEMS.find((i) => i.type === 'core.rotary');
    const state = {
      widgetDef: { layout: { grid: { columns: 12, rows: 12 } }, components: [] },
      addComponent(c) { this.widgetDef.components.push(c); }
    };
    const comp = createComponentFromPaletteItem(state, rotary);
    expect(comp.type).toBe('core.rotary');
    expect(proposeWireUp(comp)).toBeNull();
  });
});

// Code-review fix-pass finding #2 (ticket 05): syncCapabilities() and validate()'s
// §11 Rule 5 write-event cross-check enumerated writeEvent/ackEvent/pushEvent but not
// Pulse write mode's incrementEvent/decrementEvent, so a Pulse Ring's real write
// surface never landed in capabilities.writeEvents.
describe('Pulse write mode\'s incrementEvent/decrementEvent are tracked as write capabilities (ticket 05)', () => {
  const pulseRotary = {
    id: 'rot',
    type: 'core.rotary',
    binding: { readSimVar: 'apHdgBugValue', incrementEvent: 'HDG_INC', decrementEvent: 'HDG_DEC' },
    props: { writeMode: 'pulse', min: 0, max: 360 },
    layout: { col: 1, row: 1, w: 4, h: 4 }
  };

  function widgetWith(comp, capabilities) {
    return {
      fdws: '1.30', schemaVersion: '1.30.0', id: 'com.test.rotarypulse',
      meta: { name: 'Rotary Pulse', category: 'Avionics' },
      layout: { defaultW: 4, defaultH: 4, grid: { columns: 4, rows: 4 } },
      components: [comp],
      ...(capabilities ? { capabilities } : {})
    };
  }

  it('validate() includes incrementEvent/decrementEvent in capabilitiesSummary.writeEvents', () => {
    const result = StudioValidator.validate(widgetWith(pulseRotary));
    expect(result.capabilitiesSummary.writeEvents).toEqual(expect.arrayContaining(['HDG_INC', 'HDG_DEC']));
  });

  it('validate() raises no "not referenced by any component" warning when capabilities.writeEvents already lists them', () => {
    const result = StudioValidator.validate(widgetWith(pulseRotary, { writeEvents: ['HDG_INC', 'HDG_DEC'] }));
    expect(result.warnings.join(' ')).not.toMatch(/is not referenced by any component/);
  });

  it('syncCapabilities() adds incrementEvent/decrementEvent to def.capabilities.writeEvents', () => {
    const def = widgetWith(pulseRotary);
    StudioValidator.syncCapabilities(def);
    expect(def.capabilities.writeEvents).toEqual(expect.arrayContaining(['HDG_INC', 'HDG_DEC']));
  });
});
