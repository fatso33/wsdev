/**
 * StudioTemplates.js
 * Pre-built reference widget templates. Most declare their own real minimum
 * FDWS version (whatever their actual fields require) and should stay
 * hardcoded — that's an accurate conformance claim, not staleness. The one
 * exception is the "Blank Starter Widget" below: it's a launchpad an author
 * builds anything on top of, so stamping it with a fixed version was
 * actively wrong — a widget built from it using, say, a v1.20 core.gauge arc
 * still exported declaring "fdws": "1.1" forever, since nothing else in the
 * authoring flow ever bumps it. Reported 2026-08-29. Stamped with
 * FDWS_VERSIONS' own latest entry instead, so a freshly created widget
 * always starts truthfully declaring whatever this build of Studio actually
 * supports.
 */

import { FDWS_VERSIONS } from '../widgets/PropertyRegistry.js';

const LATEST_FDWS_VERSION = FDWS_VERSIONS[FDWS_VERSIONS.length - 1];

export const STUDIO_TEMPLATES = [
  // 1. NAV 1 Radio Decomposed (§5.4)
  {
    fdws: '1.16',
    schemaVersion: '1.16.0',
    id: 'com.flightdeck.nav1radio',
    revision: 2,
    kind: 'widget',
    meta: {
      name: 'NAV 1 Radio',
      shortName: 'NAV1',
      author: 'Flight Deck Core',
      description: 'Dual active/standby NAV radio with 4-slot frequency presets conforming to FDWS §5.4 specification.',
      category: 'Avionics',
      tags: ['radio', 'nav', 'frequency', 'com220'],
      createdWith: 'Flight Deck Widget Studio v1.5',
      license: 'CC-BY-4.0'
    },
    layout: {
      defaultW: 10,
      defaultH: 4,
      minW: 6,
      minH: 3,
      maxW: 44,
      maxH: 44,
      resizable: true,
      grid: { columns: 12, rows: 6 }
    },
    layerGroups: [
      { id: 'background', z: 0, locked: true },
      { id: 'readouts', z: 100 },
      { id: 'controls', z: 200 }
    ],
    state: [
      { name: 'actFreq', type: 'string', default: '108.00', syncFrom: 'nav1ActFreq' },
      { name: 'stbyFreq', type: 'string', default: '113.70', persist: true },
      {
        name: 'presets',
        type: 'array',
        default: [
          { label: 'ILS', freq: '110.30' },
          { label: 'VOR', freq: '113.70' },
          { label: 'LOC', freq: '109.90' },
          { label: 'DME', freq: '115.10' }
        ]
      }
    ],
    components: [
      {
        id: 'lbl_title',
        type: 'core.label',
        label: 'Header Label',
        layout: { col: 1, row: 1, w: 12, h: 1 },
        layer: { group: 'readouts', z: 0, pointerEvents: 'none' },
        props: { text: 'NAV 1 RADIO', align: 'left' },
        style: {
          typography: { font: 'Chakra Petch', size: 11, weight: 700, color: 'var(--accent-cyan, #00d8f6)' }
        }
      },
      {
        id: 'disp_act',
        type: 'core.display',
        label: 'Active Frequency Display',
        layout: { col: 1, row: 2, w: 5, h: 3 },
        layer: { group: 'readouts', z: 10, pointerEvents: 'auto' },
        binding: { readSimVar: 'nav1ActFreq', stateVar: 'actFreq' },
        props: { format: 'FREQ_NAV', prefix: 'ACT', suffix: 'MHz' },
        style: {
          border: { width: 1, color: '#1e293b', radius: 4 },
          typography: { font: 'Chakra Petch', size: 14, weight: 700, color: '#22c55e' },
          background: { type: 'color', color: '#090d14' }
        }
      },
      {
        id: 'btn_swap',
        type: 'core.button',
        label: 'Swap Active / Standby',
        layout: { col: 6, row: 2, w: 2, h: 3 },
        layer: { group: 'controls', z: 20, pointerEvents: 'auto' },
        props: { variant: 'swap', icon: 'swap' },
        interactions: [
          { trigger: 'tap', action: { type: 'core.swapLocalState', fields: ['actFreq', 'stbyFreq'] } },
          { trigger: 'tap', action: { type: 'core.dispatchEvent', event: 'nav1Swap', value: 0 } }
        ]
      },
      {
        id: 'input_stby',
        type: 'core.input',
        label: 'Standby Frequency Input',
        layout: { col: 8, row: 2, w: 5, h: 3 },
        layer: { group: 'controls', z: 10, pointerEvents: 'auto' },
        binding: { readSimVar: 'nav1StbyFreq', writeEvent: 'nav1StbySet', stateVar: 'stbyFreq' },
        props: { format: 'FREQ_NAV', min: 108.00, max: 117.975, placeholder: '113.70' },
        style: {
          border: { width: 1, color: '#1e293b', radius: 4 },
          typography: { font: 'Chakra Petch', size: 14, weight: 700, color: 'var(--text-white, #f8fafc)' },
          background: { type: 'color', color: '#111724' }
        }
      },
      {
        id: 'btn_preset1',
        type: 'core.button',
        label: 'Preset 1 ILS',
        layout: { col: 1, row: 5, w: 3, h: 2 },
        layer: { group: 'controls', z: 10, pointerEvents: 'auto' },
        props: { variant: 'momentary', label: 'ILS', sublabel: '110.30' },
        binding: { stateRef: 'presets[0].label', sublabelStateRef: 'presets[0].freq' },
        interactions: [
          { trigger: 'tap', action: { type: 'core.setLocalState', field: 'stbyFreq', fromStateRef: 'presets[0].freq' } },
          { trigger: 'tap', action: { type: 'core.dispatchEvent', event: 'nav1StbySet', fromStateRef: 'presets[0].freq' } }
        ]
      },
      {
        id: 'btn_preset2',
        type: 'core.button',
        label: 'Preset 2 VOR',
        layout: { col: 4, row: 5, w: 3, h: 2 },
        layer: { group: 'controls', z: 10, pointerEvents: 'auto' },
        props: { variant: 'momentary', label: 'VOR', sublabel: '113.70' },
        binding: { stateRef: 'presets[1].label', sublabelStateRef: 'presets[1].freq' },
        interactions: [
          { trigger: 'tap', action: { type: 'core.setLocalState', field: 'stbyFreq', fromStateRef: 'presets[1].freq' } },
          { trigger: 'tap', action: { type: 'core.dispatchEvent', event: 'nav1StbySet', fromStateRef: 'presets[1].freq' } }
        ]
      },
      {
        id: 'btn_preset3',
        type: 'core.button',
        label: 'Preset 3 LOC',
        layout: { col: 7, row: 5, w: 3, h: 2 },
        layer: { group: 'controls', z: 10, pointerEvents: 'auto' },
        props: { variant: 'momentary', label: 'LOC', sublabel: '109.90' },
        binding: { stateRef: 'presets[2].label', sublabelStateRef: 'presets[2].freq' },
        interactions: [
          { trigger: 'tap', action: { type: 'core.setLocalState', field: 'stbyFreq', fromStateRef: 'presets[2].freq' } },
          { trigger: 'tap', action: { type: 'core.dispatchEvent', event: 'nav1StbySet', fromStateRef: 'presets[2].freq' } }
        ]
      },
      {
        id: 'btn_preset4',
        type: 'core.button',
        label: 'Preset 4 DME',
        layout: { col: 10, row: 5, w: 3, h: 2 },
        layer: { group: 'controls', z: 10, pointerEvents: 'auto' },
        props: { variant: 'momentary', label: 'DME', sublabel: '115.10' },
        binding: { stateRef: 'presets[3].label', sublabelStateRef: 'presets[3].freq' },
        interactions: [
          { trigger: 'tap', action: { type: 'core.setLocalState', field: 'stbyFreq', fromStateRef: 'presets[3].freq' } },
          { trigger: 'tap', action: { type: 'core.dispatchEvent', event: 'nav1StbySet', fromStateRef: 'presets[3].freq' } }
        ]
      }
    ],
    capabilities: {
      readSimVars: ['nav1ActFreq', 'nav1StbyFreq'],
      writeEvents: ['nav1Swap', 'nav1StbySet']
    }
  },

  // 2. Layered Photo-Real Cockpit Switch (§5.5)
  {
    fdws: '1.1',
    schemaVersion: '1.1.0',
    id: 'com.flightdeck.layeredswitch',
    revision: 1,
    kind: 'widget',
    meta: {
      name: 'Layered Taxi Light Switch',
      shortName: 'TAXI LT',
      author: 'Flight Deck Core',
      description: 'Photo-real cockpit switch featuring stacked visual layer groups, background textures, and hit-target pass-through (§5.5).',
      category: 'Controls',
      tags: ['switch', 'lights', 'layered', 'hardware'],
      createdWith: 'Flight Deck Widget Studio v1.5',
      license: 'CC-BY-4.0'
    },
    layout: {
      defaultW: 8,
      defaultH: 4,
      minW: 4,
      minH: 2,
      maxW: 44,
      maxH: 44,
      resizable: true,
      grid: { columns: 12, rows: 6 }
    },
    layerGroups: [
      { id: 'background', z: 0, locked: true },
      { id: 'artwork', z: 100 },
      { id: 'hitlayer', z: 200 }
    ],
    state: [
      { name: 'switchOn', type: 'boolean', default: false, syncFrom: 'taxiLightState' }
    ],
    components: [
      {
        id: 'bg_panel',
        type: 'core.label',
        label: 'Panel Bezel Art',
        layout: { col: 1, row: 1, w: 12, h: 6 },
        layer: { group: 'background', z: 0, pointerEvents: 'none', clipToBounds: true },
        props: { text: '' },
        style: {
          background: { type: 'gradient', gradient: 'radial-gradient(ellipse at center, #1e2638 0%, #0d121c 100%)' },
          border: { width: 1, color: '#334155', radius: 8 }
        }
      },
      {
        id: 'lbl_switch_title',
        type: 'core.label',
        label: 'Switch Label',
        layout: { col: 1, row: 1, w: 12, h: 2 },
        layer: { group: 'artwork', z: 10, pointerEvents: 'none' },
        props: { text: 'TAXI LIGHTS', align: 'center' },
        style: {
          typography: { font: 'Chakra Petch', size: 12, weight: 700, color: 'var(--text-label, #94a3b8)' }
        }
      },
      {
        id: 'ind_status',
        type: 'core.indicator',
        label: 'Active Annunciator LED',
        layout: { col: 5, row: 3, w: 4, h: 1 },
        layer: { group: 'artwork', z: 20, pointerEvents: 'none' },
        binding: { stateVar: 'switchOn', readSimVar: 'taxiLightState' },
        props: { shape: 'dot', severity: 'status', label: 'ON' }
      },
      {
        id: 'hit_target',
        type: 'core.button',
        label: 'Switch Toggle Actuator',
        layout: { col: 2, row: 4, w: 10, h: 2 },
        layer: { group: 'hitlayer', z: 50, pointerEvents: 'auto' },
        props: { variant: 'toggle', label: 'TOGGLE TAXI LIGHTS' },
        binding: { stateVar: 'switchOn', writeEvent: 'taxiLightsToggle' },
        interactions: [
          { trigger: 'tap', action: { type: 'core.toggleLocalState', field: 'switchOn' } },
          { trigger: 'tap', action: { type: 'core.dispatchEvent', event: 'taxiLightsToggle', value: 0 } }
        ]
      }
    ],
    capabilities: {
      readSimVars: ['taxiLightState'],
      writeEvents: ['taxiLightsToggle']
    }
  },

  // 3. Autopilot Flight Director & Mode Panel
  {
    fdws: '1.1',
    schemaVersion: '1.1.0',
    id: 'com.flightdeck.autopilotpanel',
    revision: 1,
    kind: 'widget',
    meta: {
      name: 'Autopilot Mode Controller',
      shortName: 'AP CTRL',
      author: 'Flight Deck Core',
      description: 'Comprehensive autopilot flight director, lateral HDG/NAV and vertical ALT/VS mode selection panel.',
      category: 'Avionics',
      tags: ['autopilot', 'fd', 'hdg', 'alt', 'vs'],
      createdWith: 'Flight Deck Widget Studio v1.5',
      license: 'CC-BY-4.0'
    },
    layout: {
      defaultW: 12,
      defaultH: 4,
      minW: 8,
      minH: 3,
      maxW: 44,
      maxH: 44,
      resizable: true,
      grid: { columns: 12, rows: 6 }
    },
    layerGroups: [
      { id: 'modes', z: 100 }
    ],
    state: [
      { name: 'ap_master', type: 'boolean', default: false, syncFrom: 'apMasterState' },
      { name: 'ap_fd', type: 'boolean', default: true, syncFrom: 'apFdState' },
      { name: 'ap_hdg_mode', type: 'boolean', default: false, syncFrom: 'apHdgModeState' },
      { name: 'ap_alt_mode', type: 'boolean', default: true, syncFrom: 'apAltModeState' }
    ],
    components: [
      {
        id: 'lbl_ap_title',
        type: 'core.label',
        label: 'AP Title',
        layout: { col: 1, row: 1, w: 12, h: 1 },
        props: { text: 'AUTOPILOT FLIGHT DIRECTOR', align: 'center' },
        style: {
          typography: { font: 'Chakra Petch', size: 11, weight: 700, color: 'var(--accent-cyan, #00d8f6)' }
        }
      },
      {
        id: 'btn_ap_master',
        type: 'core.button',
        label: 'AP Master Switch',
        layout: { col: 1, row: 2, w: 3, h: 3 },
        binding: { readSimVar: 'apMasterState', writeEvent: 'apMaster', stateVar: 'ap_master' },
        props: { variant: 'toggle', label: 'AP', sublabel: 'MASTER' },
        interactions: [
          { trigger: 'tap', action: { type: 'core.toggleLocalState', field: 'ap_master' } },
          { trigger: 'tap', action: { type: 'core.dispatchEvent', event: 'apMaster', value: 0 } }
        ]
      },
      {
        id: 'btn_ap_fd',
        type: 'core.button',
        label: 'Flight Director Switch',
        layout: { col: 4, row: 2, w: 3, h: 3 },
        binding: { readSimVar: 'apFdState', writeEvent: 'apFdToggle', stateVar: 'ap_fd' },
        props: { variant: 'toggle', label: 'FD', sublabel: 'DIRECTOR' },
        interactions: [
          { trigger: 'tap', action: { type: 'core.toggleLocalState', field: 'ap_fd' } },
          { trigger: 'tap', action: { type: 'core.dispatchEvent', event: 'apFdToggle', value: 0 } }
        ]
      },
      {
        id: 'btn_ap_hdg',
        type: 'core.button',
        label: 'Heading Hold Mode',
        layout: { col: 7, row: 2, w: 3, h: 3 },
        binding: { readSimVar: 'apHdgModeState', writeEvent: 'apHdgHoldToggle', stateVar: 'ap_hdg_mode' },
        props: { variant: 'toggle', label: 'HDG', sublabel: 'HOLD' },
        interactions: [
          { trigger: 'tap', action: { type: 'core.toggleLocalState', field: 'ap_hdg_mode' } },
          { trigger: 'tap', action: { type: 'core.dispatchEvent', event: 'apHdgHoldToggle', value: 0 } }
        ]
      },
      {
        id: 'btn_ap_alt',
        type: 'core.button',
        label: 'Altitude Hold Mode',
        layout: { col: 10, row: 2, w: 3, h: 3 },
        binding: { readSimVar: 'apAltModeState', writeEvent: 'apAltHoldToggle', stateVar: 'ap_alt_mode' },
        props: { variant: 'toggle', label: 'ALT', sublabel: 'HOLD' },
        interactions: [
          { trigger: 'tap', action: { type: 'core.toggleLocalState', field: 'ap_alt_mode' } },
          { trigger: 'tap', action: { type: 'core.dispatchEvent', event: 'apAltHoldToggle', value: 0 } }
        ]
      },
      {
        id: 'btn_ap_disengage',
        type: 'core.button',
        label: 'Quick Disengage Bar',
        layout: { col: 1, row: 5, w: 12, h: 2 },
        binding: { writeEvent: 'autopilotDisengageToggle' },
        props: { variant: 'momentary', label: 'DISENGAGE AP / AT' },
        style: {
          border: { width: 1, color: '#dc2626', radius: 4 },
          typography: { font: 'Chakra Petch', size: 12, weight: 700, color: '#ef4444' }
        },
        interactions: [
          { trigger: 'tap', action: { type: 'core.setLocalState', field: 'ap_master', value: false } },
          { trigger: 'tap', action: { type: 'core.dispatchEvent', event: 'autopilotDisengageToggle', value: 0 } }
        ]
      }
    ],
    capabilities: {
      readSimVars: ['apMasterState', 'apFdState', 'apHdgModeState', 'apAltModeState'],
      writeEvents: ['apMaster', 'apFdToggle', 'apHdgHoldToggle', 'apAltHoldToggle', 'autopilotDisengageToggle']
    }
  },

  // 4. Annunciator Master Warning & Caution Tile
  {
    fdws: '1.1',
    schemaVersion: '1.1.0',
    id: 'com.flightdeck.annunciatortile',
    revision: 1,
    kind: 'widget',
    meta: {
      name: 'Master Caution & Warning',
      shortName: 'WARN/CAUT',
      author: 'Flight Deck Core',
      description: 'Avionics annunciator alert tile with acknowledge interaction and pitot/ice indicators.',
      category: 'Alerts',
      tags: ['alert', 'warning', 'caution', 'annunciator'],
      createdWith: 'Flight Deck Widget Studio v1.5',
      license: 'CC-BY-4.0'
    },
    layout: {
      defaultW: 8,
      defaultH: 4,
      minW: 4,
      minH: 2,
      maxW: 44,
      maxH: 44,
      resizable: true,
      grid: { columns: 8, rows: 4 }
    },
    state: [
      { name: 'warnActive', type: 'boolean', default: true, syncFrom: 'master_warning' },
      { name: 'cautActive', type: 'boolean', default: false, syncFrom: 'master_caution' }
    ],
    components: [
      {
        id: 'ind_master_warn',
        type: 'core.indicator',
        label: 'Master Warning Light',
        layout: { col: 1, row: 1, w: 4, h: 3 },
        binding: { readSimVar: 'master_warning', ackEvent: 'MASTER_WARNING_ACK', stateVar: 'warnActive' },
        props: { shape: 'tile', severity: 'warning', label: 'MASTER WARN' },
        interactions: [
          { trigger: 'tap', action: { type: 'core.ackIndicator', event: 'MASTER_WARNING_ACK' } }
        ]
      },
      {
        id: 'ind_master_caut',
        type: 'core.indicator',
        label: 'Master Caution Light',
        layout: { col: 5, row: 1, w: 4, h: 3 },
        binding: { readSimVar: 'master_caution', ackEvent: 'MASTER_CAUTION_ACK', stateVar: 'cautActive' },
        props: { shape: 'tile', severity: 'caution', label: 'MASTER CAUT' },
        interactions: [
          { trigger: 'tap', action: { type: 'core.ackIndicator', event: 'MASTER_CAUTION_ACK' } }
        ]
      },
      {
        id: 'ind_pitot',
        type: 'core.indicator',
        label: 'Pitot Heat Status',
        layout: { col: 1, row: 4, w: 4, h: 1 },
        binding: { readSimVar: 'pitot_heat' },
        props: { shape: 'dot', severity: 'status', label: 'PITOT HT' }
      },
      {
        id: 'ind_ice',
        type: 'core.indicator',
        label: 'Anti-Ice Status',
        layout: { col: 5, row: 4, w: 4, h: 1 },
        binding: { readSimVar: 'anti_ice' },
        props: { shape: 'dot', severity: 'status', label: 'ANTI ICE' }
      }
    ],
    capabilities: {
      readSimVars: ['master_warning', 'master_caution', 'pitot_heat', 'anti_ice'],
      writeEvents: ['MASTER_WARNING_ACK', 'MASTER_CAUTION_ACK']
    }
  },

  // 5. Dual Heading & Altitude Target Controller (Rotary + Steppers)
  {
    fdws: '1.1',
    schemaVersion: '1.1.0',
    id: 'com.flightdeck.hdgaltcontroller',
    revision: 1,
    kind: 'widget',
    meta: {
      name: 'Heading & Altitude Target Controller',
      shortName: 'HDG/ALT',
      author: 'Flight Deck Core',
      description: 'Dial controller featuring dual coarse/fine heading rotaries and altitude steppers.',
      category: 'Avionics',
      tags: ['heading', 'altitude', 'rotary', 'stepper'],
      createdWith: 'Flight Deck Widget Studio v1.5',
      license: 'CC-BY-4.0'
    },
    layout: {
      defaultW: 10,
      defaultH: 5,
      minW: 6,
      minH: 3,
      maxW: 44,
      maxH: 44,
      resizable: true,
      grid: { columns: 10, rows: 6 }
    },
    state: [
      { name: 'headingVal', type: 'number', default: 360, syncFrom: 'apHdgBugValue' },
      { name: 'altitudeVal', type: 'number', default: 10000, syncFrom: 'apAltBugValue' }
    ],
    components: [
      {
        id: 'lbl_hdg',
        type: 'core.label',
        label: 'Heading Label',
        layout: { col: 1, row: 1, w: 5, h: 1 },
        props: { text: 'HDG BUG (DEG)', align: 'center' },
        style: { typography: { size: 10, weight: 700, color: 'var(--accent-cyan, #00d8f6)' } }
      },
      {
        id: 'disp_hdg',
        type: 'core.display',
        label: 'HDG Readout',
        layout: { col: 1, row: 2, w: 5, h: 2 },
        binding: { readSimVar: 'apHdgBugValue', stateVar: 'headingVal' },
        props: { format: 'DEGREE_3', suffix: '°' },
        style: { typography: { size: 18, weight: 700, color: '#38bdf8' } }
      },
      {
        id: 'rot_hdg',
        type: 'core.rotary',
        label: 'HDG Rotary Dial',
        layout: { col: 1, row: 4, w: 5, h: 3 },
        binding: { readSimVar: 'apHdgBugValue', writeEvent: 'apHdgSet' },
        props: { coarseStep: 10, fineStep: 1, circular: true }
      },
      {
        id: 'lbl_alt',
        type: 'core.label',
        label: 'Altitude Label',
        layout: { col: 6, row: 1, w: 5, h: 1 },
        props: { text: 'ALT TARGET (FT)', align: 'center' },
        style: { typography: { size: 10, weight: 700, color: '#4ade80' } }
      },
      {
        id: 'disp_alt',
        type: 'core.display',
        label: 'ALT Readout',
        layout: { col: 6, row: 2, w: 5, h: 2 },
        binding: { readSimVar: 'apAltBugValue', stateVar: 'altitudeVal' },
        props: { format: 'ALTITUDE', suffix: 'FT' },
        style: { typography: { size: 18, weight: 700, color: '#4ade80' } }
      },
      {
        id: 'step_alt',
        type: 'core.stepper',
        label: 'ALT Stepper +/-',
        layout: { col: 6, row: 4, w: 5, h: 3 },
        binding: { readSimVar: 'apAltBugValue', writeEvent: 'apAltSet' },
        props: { step: 100, min: 0, max: 50000 }
      }
    ],
    capabilities: {
      readSimVars: ['apHdgBugValue', 'apAltBugValue'],
      writeEvents: ['apHdgSet', 'apAltSet']
    }
  },

  // 6. Blank Starter Widget
  {
    fdws: LATEST_FDWS_VERSION,
    schemaVersion: `${LATEST_FDWS_VERSION}.0`,
    id: 'com.flightdeck.customwidget',
    revision: 1,
    kind: 'widget',
    meta: {
      name: 'New Custom Widget',
      shortName: 'CUSTOM',
      author: 'Widget Author',
      description: 'A clean slate widget ready for custom component placement and simulator bindings.',
      category: 'Controls',
      tags: ['custom'],
      createdWith: 'Flight Deck Widget Studio v1.5',
      license: 'MIT'
    },
    layout: {
      defaultW: 8,
      defaultH: 4,
      minW: 4,
      minH: 2,
      maxW: 44,
      maxH: 44,
      resizable: true,
      grid: { columns: 12, rows: 6 }
    },
    layerGroups: [
      { id: 'background', z: 0, locked: true },
      { id: 'content', z: 100 }
    ],
    state: [],
    components: [
      {
        id: 'lbl_starter',
        type: 'core.label',
        label: 'Title Label',
        layout: { col: 1, row: 1, w: 12, h: 2 },
        layer: { group: 'content', z: 10, pointerEvents: 'none' },
        props: { text: 'CUSTOM WIDGET', align: 'center' },
        style: {
          typography: { font: 'Chakra Petch', size: 14, weight: 700, color: 'var(--accent-cyan, #00d8f6)' }
        }
      },
      {
        id: 'btn_sample',
        type: 'core.button',
        label: 'Action Button',
        layout: { col: 4, row: 3, w: 6, h: 3 },
        layer: { group: 'content', z: 20, pointerEvents: 'auto' },
        props: { variant: 'momentary', label: 'ACTIVATE' },
        interactions: [
          { trigger: 'tap', action: { type: 'core.dispatchEvent', event: 'CUSTOM_EVENT', value: 1 } }
        ]
      }
    ],
    capabilities: {
      readSimVars: [],
      writeEvents: ['CUSTOM_EVENT']
    }
  },

  // 6. COM Radios Panel Widget (Dual COM 1/COM 2, Active Swap, Standby Entry, 4 Custom Presets)
  {
    fdws: '1.16',
    schemaVersion: '1.16.0',
    id: 'com.flightdeck.comradios',
    revision: 2,
    kind: 'widget',
    meta: {
      name: 'COM Radios',
      shortName: 'COM1/2',
      author: 'Flight Deck Avionics',
      description: 'Dual COM 1 and COM 2 active/standby frequency radio panel with active swap controls, standby direct frequency entry, and 4 customizable quick-frequency presets.',
      category: 'Avionics',
      tags: ['radio', 'com', 'com1', 'com2', 'avionics', 'presets', 'frequency'],
      createdWith: 'Flight Deck Widget Studio v1.5',
      license: 'CC-BY-4.0'
    },
    layout: {
      defaultW: 10,
      defaultH: 6,
      minW: 6,
      minH: 4,
      maxW: 44,
      maxH: 44,
      resizable: true,
      grid: {
        columns: 24,
        rows: 14
      }
    },
    layerGroups: [
      { id: 'background', z: 0, locked: true },
      { id: 'panels', z: 10 },
      { id: 'controls', z: 50 }
    ],
    state: [
      { name: 'com1ActFreq', type: 'string', default: '122.800', syncFrom: 'com1ActFreq' },
      { name: 'com1StbyFreq', type: 'string', default: '121.500', syncFrom: 'com1StbyFreq' },
      { name: 'com2ActFreq', type: 'string', default: '118.700', syncFrom: 'com2ActFreq' },
      { name: 'com2StbyFreq', type: 'string', default: '119.100', syncFrom: 'com2StbyFreq' },
      { name: 'presets', type: 'array', default: ['---', '---', '---', '---'] }
    ],
    components: [
      {
        id: 'bg_bezel',
        type: 'core.label',
        label: 'Background Bezel',
        layout: { col: 1, row: 1, w: 24, h: 14 },
        layer: { group: 'background', z: 0, pointerEvents: 'none' },
        props: { text: '' },
        style: {
          background: { type: 'color', color: '#0c1017' },
          border: { width: 1, color: '#1e293b', radius: 10 }
        }
      },
      {
        id: 'lbl_com1_tag',
        type: 'core.label',
        label: 'COM 1 Tag',
        layout: { col: 2, row: 1, w: 5, h: 1 },
        layer: { group: 'panels', z: 10, pointerEvents: 'none' },
        props: { text: 'COM 1', align: 'left' },
        style: {
          typography: { font: 'Chakra Petch', size: 11, weight: 700, color: '#94a3b8' }
        }
      },
      {
        id: 'lbl_title',
        type: 'core.label',
        label: 'Header Title',
        layout: { col: 7, row: 1, w: 10, h: 1 },
        layer: { group: 'panels', z: 10, pointerEvents: 'none' },
        props: { text: 'COM RADIOS', align: 'center' },
        style: {
          typography: { font: 'Chakra Petch', size: 12, weight: 800, color: '#cbd5e1' }
        }
      },
      {
        id: 'box_com1',
        type: 'core.label',
        label: 'COM 1 Panel Enclosure',
        layout: { col: 2, row: 2, w: 22, h: 4 },
        layer: { group: 'panels', z: 10, pointerEvents: 'none' },
        props: { text: '' },
        style: {
          background: { type: 'color', color: '#080c14' },
          border: { width: 1, color: '#1e293b', radius: 8 }
        }
      },
      {
        id: 'lbl_com1_act',
        type: 'core.label',
        label: 'COM 1 Active Label',
        layout: { col: 3, row: 2, w: 8, h: 1 },
        layer: { group: 'controls', z: 20, pointerEvents: 'none' },
        props: { text: 'ACTIVE', align: 'center' },
        style: {
          typography: { font: 'Chakra Petch', size: 10, weight: 700, color: '#64748b' }
        }
      },
      {
        id: 'disp_com1_act',
        type: 'core.display',
        label: 'COM 1 Active Display',
        layout: { col: 3, row: 3, w: 8, h: 2 },
        layer: { group: 'controls', z: 50, pointerEvents: 'auto' },
        binding: { readSimVar: 'com1ActFreq', stateVar: 'com1ActFreq' },
        props: { format: 'FREQ_COM', prefix: '' },
        style: {
          background: { type: 'none' },
          border: { width: 0, color: 'transparent' },
          typography: { font: 'Chakra Petch', size: 19, weight: 800, color: '#22c55e' }
        }
      },
      {
        id: 'btn_com1_swap',
        type: 'core.button',
        label: 'COM 1 Swap Button',
        layout: { col: 11, row: 3, w: 3, h: 2 },
        layer: { group: 'controls', z: 50, pointerEvents: 'auto' },
        props: { variant: 'swap', icon: 'swap' },
        style: {
          background: { type: 'color', color: '#111827' },
          border: { width: 1, color: '#1f293d', radius: 6 }
        },
        interactions: [
          { trigger: 'tap', action: { type: 'core.swapLocalState', fields: ['com1ActFreq', 'com1StbyFreq'] } },
          { trigger: 'tap', action: { type: 'core.dispatchEvent', event: 'com1Swap', value: 0 } }
        ]
      },
      {
        id: 'lbl_com1_stby',
        type: 'core.label',
        label: 'COM 1 Standby Label',
        layout: { col: 14, row: 2, w: 9, h: 1 },
        layer: { group: 'controls', z: 20, pointerEvents: 'none' },
        props: { text: 'STBY', align: 'center' },
        style: {
          typography: { font: 'Chakra Petch', size: 10, weight: 700, color: '#64748b' }
        }
      },
      {
        id: 'input_com1_stby',
        type: 'core.input',
        label: 'COM 1 Standby Input',
        layout: { col: 14, row: 3, w: 9, h: 2 },
        layer: { group: 'controls', z: 50, pointerEvents: 'auto' },
        binding: { readSimVar: 'com1StbyFreq', writeEvent: 'com1StbySet', stateVar: 'com1StbyFreq' },
        props: { format: 'FREQ_COM', min: 118.0, max: 136.975, placeholder: '121.500', defaultValue: '121.500' },
        style: {
          background: { type: 'color', color: '#06090f' },
          border: { width: 1, color: '#1e293b', radius: 6 },
          typography: { font: 'Chakra Petch', size: 18, weight: 700, color: '#f8fafc' }
        }
      },
      {
        id: 'lbl_com2_tag',
        type: 'core.label',
        label: 'COM 2 Tag',
        layout: { col: 2, row: 6, w: 5, h: 1 },
        layer: { group: 'panels', z: 10, pointerEvents: 'none' },
        props: { text: 'COM 2', align: 'left' },
        style: {
          typography: { font: 'Chakra Petch', size: 11, weight: 700, color: '#94a3b8' }
        }
      },
      {
        id: 'box_com2',
        type: 'core.label',
        label: 'COM 2 Panel Enclosure',
        layout: { col: 2, row: 7, w: 22, h: 4 },
        layer: { group: 'panels', z: 10, pointerEvents: 'none' },
        props: { text: '' },
        style: {
          background: { type: 'color', color: '#080c14' },
          border: { width: 1, color: '#1e293b', radius: 8 }
        }
      },
      {
        id: 'lbl_com2_act',
        type: 'core.label',
        label: 'COM 2 Active Label',
        layout: { col: 3, row: 7, w: 8, h: 1 },
        layer: { group: 'controls', z: 20, pointerEvents: 'none' },
        props: { text: 'ACTIVE', align: 'center' },
        style: {
          typography: { font: 'Chakra Petch', size: 10, weight: 700, color: '#64748b' }
        }
      },
      {
        id: 'disp_com2_act',
        type: 'core.display',
        label: 'COM 2 Active Display',
        layout: { col: 3, row: 8, w: 8, h: 2 },
        layer: { group: 'controls', z: 50, pointerEvents: 'auto' },
        binding: { readSimVar: 'com2ActFreq', stateVar: 'com2ActFreq' },
        props: { format: 'FREQ_COM', prefix: '' },
        style: {
          background: { type: 'none' },
          border: { width: 0, color: 'transparent' },
          typography: { font: 'Chakra Petch', size: 19, weight: 800, color: '#22c55e' }
        }
      },
      {
        id: 'btn_com2_swap',
        type: 'core.button',
        label: 'COM 2 Swap Button',
        layout: { col: 11, row: 8, w: 3, h: 2 },
        layer: { group: 'controls', z: 50, pointerEvents: 'auto' },
        props: { variant: 'swap', icon: 'swap' },
        style: {
          background: { type: 'color', color: '#111827' },
          border: { width: 1, color: '#1f293d', radius: 6 }
        },
        interactions: [
          { trigger: 'tap', action: { type: 'core.swapLocalState', fields: ['com2ActFreq', 'com2StbyFreq'] } },
          { trigger: 'tap', action: { type: 'core.dispatchEvent', event: 'com2Swap', value: 0 } }
        ]
      },
      {
        id: 'lbl_com2_stby',
        type: 'core.label',
        label: 'COM 2 Standby Label',
        layout: { col: 14, row: 7, w: 9, h: 1 },
        layer: { group: 'controls', z: 20, pointerEvents: 'none' },
        props: { text: 'STBY', align: 'center' },
        style: {
          typography: { font: 'Chakra Petch', size: 10, weight: 700, color: '#64748b' }
        }
      },
      {
        id: 'input_com2_stby',
        type: 'core.input',
        label: 'COM 2 Standby Input',
        layout: { col: 14, row: 8, w: 9, h: 2 },
        layer: { group: 'controls', z: 50, pointerEvents: 'auto' },
        binding: { readSimVar: 'com2StbyFreq', writeEvent: 'com2StbySet', stateVar: 'com2StbyFreq' },
        props: { format: 'FREQ_COM', min: 118.0, max: 136.975, placeholder: '119.100', defaultValue: '119.100' },
        style: {
          background: { type: 'color', color: '#06090f' },
          border: { width: 1, color: '#1e293b', radius: 6 },
          typography: { font: 'Chakra Petch', size: 18, weight: 700, color: '#f8fafc' }
        }
      },
      {
        id: 'div_presets',
        type: 'core.label',
        label: 'Divider Line',
        layout: { col: 2, row: 11, w: 22, h: 1 },
        layer: { group: 'panels', z: 10, pointerEvents: 'none' },
        props: { text: '' },
        style: {
          border: { width: 1, color: '#1e293b' }
        }
      },
      {
        id: 'btn_preset_1',
        type: 'core.button',
        label: 'Preset 1 Button',
        layout: { col: 2, row: 12, w: 5, h: 2 },
        layer: { group: 'controls', z: 50, pointerEvents: 'auto' },
        props: { variant: 'momentary', label: '---' },
        binding: { stateRef: 'presets[0]' },
        style: {
          background: { type: 'color', color: '#090d14' },
          border: { width: 1, color: '#1e293b', radius: 6 },
          typography: { font: 'Chakra Petch', size: 14, weight: 700, color: '#f8fafc' }
        },
        interactions: [
          { trigger: 'tap', action: { type: 'core.setLocalState', field: 'com1StbyFreq', fromStateRef: 'presets[0]' } },
          { trigger: 'tap', action: { type: 'core.dispatchEvent', event: 'com1StbySet', fromStateRef: 'presets[0]' } }
        ]
      },
      {
        id: 'btn_preset_2',
        type: 'core.button',
        label: 'Preset 2 Button',
        layout: { col: 8, row: 12, w: 5, h: 2 },
        layer: { group: 'controls', z: 50, pointerEvents: 'auto' },
        props: { variant: 'momentary', label: '---' },
        binding: { stateRef: 'presets[1]' },
        style: {
          background: { type: 'color', color: '#090d14' },
          border: { width: 1, color: '#1e293b', radius: 6 },
          typography: { font: 'Chakra Petch', size: 14, weight: 700, color: '#f8fafc' }
        },
        interactions: [
          { trigger: 'tap', action: { type: 'core.setLocalState', field: 'com1StbyFreq', fromStateRef: 'presets[1]' } },
          { trigger: 'tap', action: { type: 'core.dispatchEvent', event: 'com1StbySet', fromStateRef: 'presets[1]' } }
        ]
      },
      {
        id: 'btn_preset_3',
        type: 'core.button',
        label: 'Preset 3 Button',
        layout: { col: 14, row: 12, w: 5, h: 2 },
        layer: { group: 'controls', z: 50, pointerEvents: 'auto' },
        props: { variant: 'momentary', label: '---' },
        binding: { stateRef: 'presets[2]' },
        style: {
          background: { type: 'color', color: '#090d14' },
          border: { width: 1, color: '#1e293b', radius: 6 },
          typography: { font: 'Chakra Petch', size: 14, weight: 700, color: '#f8fafc' }
        },
        interactions: [
          { trigger: 'tap', action: { type: 'core.setLocalState', field: 'com1StbyFreq', fromStateRef: 'presets[2]' } },
          { trigger: 'tap', action: { type: 'core.dispatchEvent', event: 'com1StbySet', fromStateRef: 'presets[2]' } }
        ]
      },
      {
        id: 'btn_preset_4',
        type: 'core.button',
        label: 'Preset 4 Button',
        layout: { col: 20, row: 12, w: 4, h: 2 },
        layer: { group: 'controls', z: 50, pointerEvents: 'auto' },
        props: { variant: 'momentary', label: '---' },
        binding: { stateRef: 'presets[3]' },
        style: {
          background: { type: 'color', color: '#090d14' },
          border: { width: 1, color: '#1e293b', radius: 6 },
          typography: { font: 'Chakra Petch', size: 14, weight: 700, color: '#f8fafc' }
        },
        interactions: [
          { trigger: 'tap', action: { type: 'core.setLocalState', field: 'com1StbyFreq', fromStateRef: 'presets[3]' } },
          { trigger: 'tap', action: { type: 'core.dispatchEvent', event: 'com1StbySet', fromStateRef: 'presets[3]' } }
        ]
      }
    ],
    capabilities: {
      readSimVars: ['com1ActFreq', 'com1StbyFreq', 'com2ActFreq', 'com2StbyFreq'],
      writeEvents: ['com1Swap', 'com1StbySet', 'com2Swap', 'com2StbySet']
    }
  },

  // 9. Concentric Dual Knob (Coarse/Fine Tuning Pattern)
  //
  // Widget Studio 2.0, Phase 2: the classic avionics dual-concentric knob
  // (real hardware on nearly every COM/NAV radio and many autopilot panels —
  // a big OUTER ring for coarse digits, a small INNER knob for fine digits,
  // both stacked on one physical shaft) does NOT have a dedicated FDWS
  // component. It doesn't need one: this is two ordinary core.rotary
  // components, each with its own independent binding, positioned so the
  // smaller one's layout box sits centered inside the larger one's and z-
  // layered above it. Standard DOM hit-testing does the rest for free — a
  // tap/drag inside the inner knob's box hits the inner knob (it's on top);
  // a tap/drag anywhere else inside the outer ring's box falls through to
  // the outer knob, since nothing else covers that area. No special
  // hit-zone math, no new runtime.
  //
  // TOUCH SIZING — read this before resizing either knob: a literal
  // hardware-scale reproduction (a thin inner ring a few px wide) is a real
  // usability trap on a phone — well under the ~44px minimum comfortable
  // touch target. Both knobs below are sized in GRID CELLS, not pixels, so
  // the actual on-screen size depends on the page's grid density — as a
  // rule of thumb, never let the INNER knob's grid footprint resolve
  // smaller than roughly 56-64px on the smallest device you're designing
  // for. If a page's grid is dense enough that a realistic proportion (inner
  // knob visibly smaller than outer) would violate that, either widen this
  // widget's own minW/minH so authors can't shrink it past the safe point,
  // or drop the concentric idea for that page and use two knobs side by
  // side instead — still fully authorable with these same two components,
  // just not visually stacked.
  {
    fdws: '1.15',
    schemaVersion: '1.15.0',
    id: 'com.flightdeck.concentricdualknob',
    revision: 1,
    kind: 'widget',
    meta: {
      name: 'Concentric Dual Knob (Coarse/Fine Tuning)',
      shortName: 'DUAL KNOB',
      author: 'Flight Deck Core',
      description: 'Two layered core.rotary components demonstrating the classic hardware-style concentric tuning knob (large outer ring for whole MHz, small inner knob for fractional kHz) with touch-safe minimum sizing — a pattern, not a new component type.',
      category: 'Controls',
      tags: ['knob', 'rotary', 'concentric', 'tuning', 'pattern'],
      createdWith: 'Flight Deck Widget Studio v1.5',
      license: 'CC-BY-4.0'
    },
    layout: {
      defaultW: 10,
      defaultH: 10,
      // Floor set to keep the inner knob's grid footprint (below: 4x4,
      // roughly a third of the outer's 10x10) from resolving under the
      // ~56-64px safe minimum discussed above — see this template's header
      // comment before lowering these.
      minW: 8,
      minH: 8,
      maxW: 44,
      maxH: 44,
      resizable: true,
      grid: { columns: 10, rows: 10 }
    },
    layerGroups: [
      { id: 'readout', z: 0 },
      { id: 'outer', z: 100 },
      { id: 'inner', z: 200 }
    ],
    state: [
      { name: 'freqWhole', type: 'number', default: 118, syncFrom: 'com1ActFreqWhole' },
      { name: 'freqFrac', type: 'number', default: 0, syncFrom: 'com1ActFreqFrac' }
    ],
    components: [
      {
        id: 'disp_freq',
        type: 'core.display',
        label: 'Resulting Frequency',
        layout: { col: 1, row: 1, w: 10, h: 2 },
        layer: { group: 'readout', z: 0, pointerEvents: 'none' },
        binding: { readSimVar: 'com1ActFreq' },
        props: { format: 'FREQ_COM', suffix: 'MHz' },
        style: {
          typography: { font: 'Chakra Petch', size: 16, weight: 700, color: '#22c55e' },
          align: { h: 'center' }
        }
      },
      {
        // Outer ring: large footprint (10x10 cells here — the whole
        // widget), coarse whole-MHz digits. Sized generously since it's the
        // primary, most-used gesture.
        id: 'rot_outer',
        type: 'core.rotary',
        label: 'Outer Knob (Whole MHz)',
        layout: { col: 1, row: 3, w: 10, h: 8 },
        layer: { group: 'outer', z: 10, pointerEvents: 'auto' },
        binding: { readSimVar: 'com1ActFreqWhole', writeEvent: 'com1WholeMhzSet', stateVar: 'freqWhole' },
        props: { coarseStep: 1, circular: true },
        style: {
          border: { width: 2, color: '#334155', radius: 999 },
          background: { type: 'color', color: '#161e2c' }
        }
      },
      {
        // Inner knob: centered inside the outer ring's box (col/row chosen
        // so the two share a center point — see the header comment's math).
        // 4x4 cells at this template's default 10x10 grid keeps it well
        // above the touch-safe floor; don't shrink this below minW/minH
        // without re-checking that floor still holds.
        id: 'rot_inner',
        type: 'core.rotary',
        label: 'Inner Knob (Fractional kHz)',
        layout: { col: 4, row: 5, w: 4, h: 4 },
        layer: { group: 'inner', z: 20, pointerEvents: 'auto' },
        binding: { readSimVar: 'com1ActFreqFrac', writeEvent: 'com1FracKhzSet', stateVar: 'freqFrac' },
        props: { coarseStep: 0.025, fineStep: 0.005, circular: true },
        style: {
          border: { width: 2, color: '#f59e0b', radius: 999 },
          background: { type: 'color', color: '#20293b' }
        }
      }
    ],
    capabilities: {
      readSimVars: ['com1ActFreq', 'com1ActFreqWhole', 'com1ActFreqFrac'],
      writeEvents: ['com1WholeMhzSet', 'com1FracKhzSet']
    }
  }
];
