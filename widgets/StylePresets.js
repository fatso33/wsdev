/**
 * StylePresets.js
 * A small curated catalog of named style bundles — each `style` object is
 * identical in shape to what a component's own style fields (typography/
 * border/background) already accept, so applying one is just writing that
 * object onto a component/widget, no schema change. Canonical copy lives
 * here; synced into flight-deck-pwa/widget-studio via scripts/sync-shared.mjs.
 */
export const STYLE_PRESETS = [
  {
    id: 'cockpit-glass',
    name: 'Cockpit Glass',
    swatch: { bg: '#0b0f17', fg: '#00d8f6', border: '#273344' },
    style: {
      typography: { font: 'Chakra Petch', size: 13, weight: 700, color: '#00d8f6' },
      border: { width: 1, radius: 6, color: '#273344' },
      background: { type: 'color', color: '#0b0f17' }
    }
  },
  {
    id: 'amber-lcd',
    name: 'Amber LCD',
    swatch: { bg: '#1a1200', fg: '#ffb020', border: '#3a2a00' },
    style: {
      typography: { font: 'monospace', size: 13, weight: 700, color: '#ffb020' },
      border: { width: 1, radius: 2, color: '#3a2a00' },
      background: { type: 'color', color: '#1a1200' }
    }
  },
  {
    id: 'warning-red',
    name: 'Warning',
    swatch: { bg: '#2a0a0a', fg: '#ffffff', border: '#ef4444' },
    style: {
      typography: { font: 'Chakra Petch', size: 13, weight: 700, color: '#ffffff' },
      border: { width: 2, radius: 4, color: '#ef4444' },
      background: { type: 'color', color: '#2a0a0a' }
    }
  },
  {
    id: 'caution-amber',
    name: 'Caution',
    swatch: { bg: '#241a05', fg: '#f59e0b', border: '#f59e0b' },
    style: {
      typography: { font: 'Chakra Petch', size: 13, weight: 700, color: '#f59e0b' },
      border: { width: 2, radius: 4, color: '#f59e0b' },
      background: { type: 'color', color: '#241a05' }
    }
  },
  {
    id: 'annunciator-green',
    name: 'Annunciator',
    swatch: { bg: '#04170a', fg: '#22c55e', border: '#22c55e' },
    style: {
      typography: { font: 'Chakra Petch', size: 13, weight: 700, color: '#22c55e' },
      border: { width: 1, radius: 4, color: '#22c55e' },
      background: { type: 'color', color: '#04170a' }
    }
  },
  {
    id: 'clean-panel',
    name: 'Clean Panel',
    swatch: { bg: '#131b26', fg: '#f8fafc', border: '#273344' },
    style: {
      typography: { font: 'sans-serif', size: 13, weight: 600, color: '#f8fafc' },
      border: { width: 1, radius: 8, color: '#273344' },
      background: { type: 'color', color: '#131b26' }
    }
  }
];
