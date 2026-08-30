/**
 * WidgetPopoverModal.js (Widget Studio)
 * FDWS v1.3: renders a `kind: "popover"` saved widget inside a modal overlay for
 * live-preview/testing in the Device View, mirroring flight-deck-pwa's runtime
 * behavior but using MockWidgetHost instead of a real CompositeWidget (Studio has
 * no CompositeWidget/WidgetRegistry of its own).
 *
 * Same security model as the runtime: the popover's nested mock host only ever sees
 * a resolved read-only $context snapshot built from the HOST's own stateRef paths —
 * it never sees the raw path, only symbolic contextKeys via core.commitToHost.
 */

import { ComponentRegistry } from './ComponentRegistry.js';
import { createMockHost } from './MockWidgetHost.js';
import { readStateRef, writeStateRef } from '../utils/StateRefPath.js';

/**
 * @param {object} opts
 * @param {object} opts.hostWidget - the mock host of the widget that opened this popover
 * @param {string} opts.popoverWidgetId
 * @param {object} opts.contextDecl - the host action's `context` map
 * @param {(id: string) => object|null} opts.findPopoverDef
 * @param {(event: string, val: any) => void} opts.dispatchSimEvent
 */
export function openWidgetPopover({ hostWidget, popoverWidgetId, contextDecl, findPopoverDef, dispatchSimEvent }) {
  const popoverDef = findPopoverDef(popoverWidgetId);
  if (!popoverDef) {
    console.warn(`[WidgetPopoverModal] Unknown/unsaved popover widget id: ${popoverWidgetId}`);
    return;
  }
  if (popoverDef.kind !== 'popover') {
    console.warn(`[WidgetPopoverModal] Widget "${popoverWidgetId}" is not kind:"popover" — refusing to open as a modal.`);
    return;
  }

  const contextSnapshot = {};
  Object.entries(contextDecl || {}).forEach(([key, entry]) => {
    if (!entry || typeof entry !== 'object') return;
    const stateRef = entry.value?.stateRef;
    contextSnapshot[key] = {
      value: stateRef ? readStateRef(hostWidget, stateRef) : entry.value,
      writable: Boolean(entry.writable),
      applyOn: entry.applyOn || 'immediate',
      stateRef
    };
  });

  document.getElementById('fd-widget-popover-modal')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'fd-widget-popover-modal';
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(4, 7, 13, 0.85);
    backdrop-filter: blur(6px);
    z-index: 999998;
    display: flex; align-items: center; justify-content: center;
    font-family: 'Chakra Petch', sans-serif;
  `;

  // Theme-aware via CSS custom properties (studio.css redefines these per
  // [data-theme]) rather than literal hex — this chrome belongs to the modal
  // itself, not the popover definition, so it stayed hardcoded dark in light
  // mode previously (same fix as flight-deck-pwa's WidgetPopoverModal.js).
  const card = document.createElement('div');
  card.style.cssText = `
    background: var(--card-bg, #0d131f);
    border: 1px solid var(--accent-cyan, #22d3ee);
    box-shadow: 0 0 25px var(--accent-cyan-glow, rgba(34, 211, 238, 0.25)), 0 20px 40px rgba(0,0,0,0.8);
    border-radius: 12px;
    min-width: 320px;
    max-width: 92vw;
    max-height: 88vh;
    padding: 16px;
    overflow: auto;
    display: grid;
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKeyDown);
  };
  function onKeyDown(e) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKeyDown);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  const popoverHost = createMockHost(popoverDef, {
    dispatchSimEvent,
    popoverContext: contextSnapshot,
    onCommitToHost: (contextKey, value) => {
      const entry = contextSnapshot[contextKey];
      if (!entry || !entry.writable) {
        console.warn(`[WidgetPopoverModal] Rejected commitToHost for undeclared/non-writable contextKey "${contextKey}"`);
        return;
      }
      writeStateRef(hostWidget, entry.stateRef, value);
    },
    onClosePopover: close,
    findPopoverDef,
    openWidgetPopover: (nestedOpts) => openWidgetPopover({ ...nestedOpts, findPopoverDef, dispatchSimEvent })
  });

  const gridCols = popoverDef.layout?.grid?.columns || 12;
  const gridRows = popoverDef.layout?.grid?.rows || 6;
  // minmax(0,1fr), not bare 1fr — matches CompositeWidget.js's real popover
  // rendering path exactly (the PWA's WidgetPopoverModal.js just constructs a
  // real CompositeWidget for the popover instance and inherits this fix from
  // there; Studio has no CompositeWidget of its own, so this duplicate needs
  // the same fix applied directly).
  card.style.gridTemplateColumns = `repeat(${gridCols}, minmax(0, 1fr))`;
  card.style.gridTemplateRows = `repeat(${gridRows}, minmax(0, 1fr))`;
  card.style.gap = '4px';

  const layerGroupsMap = new Map();
  (popoverDef.layerGroups || []).forEach((lg) => layerGroupsMap.set(lg.id, lg.z || 0));

  const components = (popoverDef.components || []).map((comp, idx) => {
    const groupZ = comp.layer?.group ? (layerGroupsMap.get(comp.layer.group) ?? 0) : 0;
    const compZ = comp.layer?.z ?? 0;
    return { comp, effectiveZ: groupZ + compZ, idx };
  });
  components.sort((a, b) => (a.effectiveZ !== b.effectiveZ ? a.effectiveZ - b.effectiveZ : a.idx - b.idx));

  components.forEach(({ comp, effectiveZ }) => {
    const RendererClass = ComponentRegistry.getRenderer(comp.type);
    const renderer = new RendererClass(comp, popoverHost);
    popoverHost.renderers.set(comp.id, renderer);
    const el = renderer.render();
    el.style.zIndex = `${effectiveZ}`;
    card.appendChild(el);

    // FDWS v1.11 §1.2: see StudioDeviceView.js's identical resolution for the
    // full rationale — binding.stateRef addresses a nested/indexed path.
    let stateVal = comp.binding?.stateVar ? popoverHost.getLocalState(comp.binding.stateVar) : undefined;
    if (stateVal === undefined && comp.binding?.stateRef) {
      stateVal = readStateRef(popoverHost, comp.binding.stateRef);
    }
    renderer.update(stateVal, popoverHost.getAllStateObject());
  });
}
