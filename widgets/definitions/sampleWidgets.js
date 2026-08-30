/**
 * sampleWidgets.js
 * Reference standard implementations conforming to FDWS v1.1 Specification (§5.4 and §5.5)
 */

export const SAMPLE_FDWS_WIDGETS = [
  // 1. NAV 1 Radio Decomposed Widget (§5.4)
  {
    fdws: '1.16',
    schemaVersion: '1.16.0',
    id: 'com.example.nav1radio',
    revision: 3,
    kind: 'widget',
    meta: {
      name: 'NAV 1 Radio (FDWS)',
      shortName: 'NAV1',
      author: 'Flight Deck Core',
      description: 'Dual active/standby NAV radio with 4-slot presets built with declarative FDWS v1.1 components.',
      category: 'Avionics',
      tags: ['radio', 'navLightState', 'com220'],
      license: 'CC-BY-4.0'
    },
    layout: {
      defaultW: 20,
      defaultH: 8,
      minW: 12,
      minH: 6,
      maxW: 44,
      maxH: 44,
      resizable: true,
      grid: { columns: 12, rows: 6 }
    },
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
        layout: { col: 1, row: 1, w: 12, h: 1 },
        props: { text: 'NAV 1 RADIO', align: 'left' },
        style: { typography: { size: 11, weight: 700, color: 'var(--accent-cyan, #00e5ff)' } }
      },
      {
        id: 'disp_act',
        type: 'core.display',
        layout: { col: 1, row: 2, w: 5, h: 3 },
        binding: { readSimVar: 'nav1ActFreq', stateVar: 'actFreq' },
        props: { format: 'FREQ_NAV', prefix: 'ACT' },
        style: {
          border: { width: 1, color: 'var(--btn-border, #2d3748)', radius: 4 },
          typography: { size: 14, weight: 700, color: '#22c55e' },
          background: { type: 'color', color: '#090d14' }
        }
      },
      {
        id: 'btn_swap',
        type: 'core.button',
        layout: { col: 6, row: 2, w: 2, h: 3 },
        props: { variant: 'swap', icon: 'swap' },
        interactions: [
          { trigger: 'tap', action: { type: 'core.swapLocalState', fields: ['actFreq', 'stbyFreq'] } },
          { trigger: 'tap', action: { type: 'core.dispatchEvent', event: 'nav1Swap', value: 0 } }
        ]
      },
      {
        id: 'input_stby',
        type: 'core.input',
        layout: { col: 8, row: 2, w: 5, h: 3 },
        binding: { readSimVar: 'nav1StbyFreq', writeEvent: 'nav1StbySet', stateVar: 'stbyFreq' },
        props: { format: 'FREQ_NAV', min: 108.00, max: 117.975, placeholder: '113.70' },
        style: {
          border: { width: 1, color: 'var(--btn-border, #2d3748)', radius: 4 },
          typography: { size: 14, weight: 700, color: 'var(--text-main, #e2e8f0)' },
          background: { type: 'color', color: '#131b26' }
        }
      },
      {
        id: 'btn_preset1',
        type: 'core.button',
        layout: { col: 1, row: 5, w: 3, h: 2 },
        props: { variant: 'momentary', label: 'ILS', sublabel: '110.30' },
        binding: { stateRef: 'presets[0].label', sublabelStateRef: 'presets[0].freq' },
        // FDWS v1.16: core.applyPresetToField removed — chained setLocalState +
        // dispatchEvent with fromStateRef is the modern equivalent (see CHANGELOG.md).
        interactions: [
          { trigger: 'tap', action: { type: 'core.setLocalState', field: 'stbyFreq', fromStateRef: 'presets[0].freq' } },
          { trigger: 'tap', action: { type: 'core.dispatchEvent', event: 'nav1StbySet', fromStateRef: 'presets[0].freq' } }
        ]
      },
      {
        id: 'btn_preset2',
        type: 'core.button',
        layout: { col: 4, row: 5, w: 3, h: 2 },
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
        layout: { col: 7, row: 5, w: 3, h: 2 },
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
        layout: { col: 10, row: 5, w: 3, h: 2 },
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

  // 2. Layered Photo-Real Toggle Switch Widget (§5.5)
  {
    fdws: '1.1',
    schemaVersion: '1.1.0',
    id: 'com.example.layeredswitch',
    revision: 2,
    kind: 'widget',
    meta: {
      name: 'Layered Switch (FDWS v1.1)',
      shortName: 'TAXI LT',
      author: 'Flight Deck Core',
      description: 'Photo-real cockpit switch featuring stacked visual layer groups, background textures, and hit-target pass-through.',
      category: 'Controls',
      tags: ['switch', 'lights', 'layered']
    },
    layout: {
      defaultW: 16,
      defaultH: 8,
      minW: 8,
      minH: 4,
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
        layout: { col: 1, row: 1, w: 12, h: 6 },
        layer: { group: 'background', z: 0, pointerEvents: 'none', clipToBounds: true },
        props: { text: '' },
        style: {
          background: { type: 'gradient', gradient: 'radial-gradient(ellipse at center, #1b2330 0%, #0d121a 100%)' },
          border: { width: 1, color: '#334155', radius: 6 }
        }
      },
      {
        id: 'lbl_switch_title',
        type: 'core.label',
        layout: { col: 1, row: 1, w: 12, h: 2 },
        layer: { group: 'artwork', z: 10, pointerEvents: 'none' },
        props: { text: 'TAXI LIGHTS', align: 'center' },
        style: { typography: { size: 12, weight: 700, color: 'var(--text-dim, #94a3b8)' } }
      },
      {
        id: 'ind_status',
        type: 'core.indicator',
        layout: { col: 5, row: 3, w: 4, h: 1 },
        layer: { group: 'artwork', z: 20, pointerEvents: 'none' },
        binding: { stateVar: 'switchOn' },
        props: { shape: 'dot', severity: 'status', label: 'ON' }
      },
      {
        id: 'hit_target',
        type: 'core.button',
        layout: { col: 2, row: 3, w: 10, h: 3 },
        layer: { group: 'hitlayer', z: 50, pointerEvents: 'auto' },
        props: { variant: 'toggle', label: 'TOGGLE SWITCH' },
        binding: { stateVar: 'switchOn' },
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

  // 3. COM Radios Panel Widget (Dual COM 1/COM 2, Active Swap, Standby Entry, 4 Custom Presets)
  {
    fdws: '1.16',
    schemaVersion: '1.16.0',
    id: 'com.flightdeck.comradios',
    revision: 3,
    kind: 'widget',
    meta: {
      name: 'COM Radios',
      shortName: 'COM1/2',
      author: 'Flight Deck Avionics',
      description: 'Dual COM 1 and COM 2 active/standby frequency radio panelFloodState with active swap controls, standby direct frequency entry, and 4 customizable quick-frequency presets.',
      category: 'Avionics',
      tags: ['radio', 'com', 'com1', 'com2', 'avionics', 'presets', 'frequency'],
      license: 'CC-BY-4.0'
    },
    layout: {
      defaultW: 20,
      defaultH: 12,
      minW: 12,
      minH: 8,
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
  }
];
