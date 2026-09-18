/**
 * Ticket 17: widget-studio/js/StudioValidator.js's two write-event binding
 * call sites (validate()'s Bindings check, and syncCapabilities()) both now
 * loop over PropertyRegistry.js's WRITE_EVENT_BINDING_FIELDS instead of
 * hand-listing writeEvent/ackEvent/pushEvent/incrementEvent/decrementEvent.
 *
 * The actual acceptance criterion (per the ticket): a test that only asserts
 * today's five names would pass just as well against the hardcoded lists this
 * ticket deletes, and would prove nothing. So this adds a SYNTHETIC sixth
 * eventPicker binding field via a mocked registry and asserts BOTH call sites
 * pick it up automatically, with no further edit to StudioValidator.js.
 *
 * Unlike shared/'s own copy of this test, '../widgets/PropertyRegistry.js'
 * resolves for real from widget-studio/js/ (siblings under widget-studio/,
 * both real synced files) — so importOriginal() works here directly.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../widgets/PropertyRegistry.js', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    WRITE_EVENT_BINDING_FIELDS: [...actual.WRITE_EVENT_BINDING_FIELDS, 'syntheticSixthEvent']
  };
});

const { StudioValidator } = await import('../js/StudioValidator.js');

function widgetWithSyntheticField() {
  return {
    fdws: '1.30',
    schemaVersion: '1.30.0',
    id: 'com.test.syntheticwriteevent',
    meta: { name: 'Synthetic Write-Event Field Test', category: 'Avionics' },
    layout: { defaultW: 4, defaultH: 4, grid: { columns: 4, rows: 4 } },
    components: [
      {
        id: 'c1',
        type: 'core.button',
        binding: { syntheticSixthEvent: 'CUSTOM_SYNTHETIC_EVENT' },
        layout: { col: 1, row: 1, w: 4, h: 4 }
      }
    ]
  };
}

describe('a synthetic sixth write-event binding field is picked up automatically (ticket 17)', () => {
  it('validate() includes it in capabilitiesSummary.writeEvents, with no edit to StudioValidator.js', () => {
    const result = StudioValidator.validate(widgetWithSyntheticField());
    expect(result.capabilitiesSummary.writeEvents).toContain('CUSTOM_SYNTHETIC_EVENT');
  });

  it('syncCapabilities() adds it to def.capabilities.writeEvents', () => {
    const def = widgetWithSyntheticField();
    StudioValidator.syncCapabilities(def);
    expect(def.capabilities.writeEvents).toContain('CUSTOM_SYNTHETIC_EVENT');
  });
});
