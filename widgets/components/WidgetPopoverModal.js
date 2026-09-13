/**
 * WidgetPopoverModal.js
 * FDWS v1.3: mounts a `kind: "popover"` widget definition inside a modal overlay,
 * opened from a host widget's `core.openWidgetPopover` interaction.
 *
 * Rotary Component rebuild, ticket 00 (prefactor): this is now the single canonical
 * overlay primitive, synced wholesale into both apps by scripts/sync-shared.mjs (it
 * lives under shared/widgets/components/, which is already synced as a whole
 * directory — see scripts/sync-targets.mjs — so no sync-machinery change was needed
 * to add it here).
 *
 * Previously flight-deck-pwa and widget-studio each hand-maintained a genuinely
 * independent copy of this file (documented as deliberate in both apps' own READMEs
 * and the root README, on the reasoning that a popover has to mount through each
 * app's own widget-hosting machinery — a real CompositeWidget for the PWA, a
 * MockWidgetHost for Studio's live-preview — which "isn't something shared/'s plain
 * component-renderer classes can express"). That reasoning held only because this
 * module used to *construct* that host itself (`new CompositeWidget(...)` in the
 * PWA's copy, `createMockHost(...)` in Studio's). Making the popover's rendering
 * host an INJECTED dependency (`createPopoverInstance`, below) rather than something
 * this module builds removes the reason the two copies had to diverge — the DOM
 * chrome (overlay/card, escape/backdrop dismissal, single-instance tracking) and the
 * $context/commitToHost security model were already identical between them. This
 * also incidentally breaks the circular import the PWA's old copy used to have with
 * CompositeWidget.js (see its now-removed doc comment) — this module no longer
 * references either app's host class/factory at all.
 *
 * Security model: the popover instance only ever sees a resolved, read-only
 * `$context` snapshot (value/writable/applyOn) built from the HOST's own
 * self-authored `stateRef` paths. The popover itself never specifies or sees a
 * raw path — it can only reference a symbolic `contextKey` via `core.commitToHost`,
 * and the write is rejected unless that key was declared `writable: true` by the host.
 */

import { readStateRef, writeStateRef } from '../utils/StateRefPath.js';

let activePopover = null;

/**
 * @typedef {object} PopoverHostInstance
 * @property {(container: HTMLElement) => void} mount - renders the popover's content into `container`.
 * @property {() => void} [destroy] - tears down the popover's content (renderers, timers, listeners).
 *   Optional; called (if present) as part of closing the popover, before the overlay chrome itself
 *   is removed from the document.
 */

/**
 * @param {object} opts
 * @param {object} opts.hostWidget - the widget instance whose interaction opened this popover; its
 *   own stateRef-resolvable state is what `contextDecl`'s stateRef paths read from and write back to.
 * @param {string} opts.popoverWidgetId
 * @param {object} opts.contextDecl - the host action's `context` map
 * @param {(id: string) => object|null} opts.findPopoverDef - resolves a `kind:"popover"` widget
 *   definition by id. flight-deck-pwa passes `WidgetRegistry.getDefinition`; Widget Studio passes a
 *   lookup over its own saved `kind:"popover"` widgets (`StudioState.getSavedWidgetsByKind`).
 * @param {(args: {popoverDef: object, contextSnapshot: object, onCommitToHost: (contextKey: string, value: any) => void, onClosePopover: () => void}) => PopoverHostInstance} opts.createPopoverInstance
 *   - injected factory that builds the actual rendering host for the resolved popover definition and
 *   returns a `{mount, destroy}` handle. flight-deck-pwa's factory constructs a real `CompositeWidget`
 *   (which already satisfies this shape natively — see its own `mount()`/`destroy()`); Widget Studio's
 *   factory constructs a `MockWidgetHost`-backed renderer set (`MockWidgetHost.js`'s
 *   `createPopoverHost()`). This is the one piece this module used to build itself internally — now
 *   supplied by the caller, which is what lets a single implementation serve both apps' different
 *   widget-hosting machinery.
 */
export function openWidgetPopover({ hostWidget, popoverWidgetId, contextDecl, findPopoverDef, createPopoverInstance }) {
  const popoverDef = findPopoverDef(popoverWidgetId);
  if (!popoverDef) {
    console.warn(`[WidgetPopoverModal] Unknown popover widget id: ${popoverWidgetId}`);
    return;
  }
  if (popoverDef.kind !== 'popover') {
    console.warn(`[WidgetPopoverModal] Widget "${popoverWidgetId}" is not kind:"popover" — refusing to open as a modal.`);
    return;
  }

  // Resolve host-declared context entries to live values. The raw stateRef path is
  // kept only in this closure (contextSnapshot) — never handed to the popover instance.
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

  closeWidgetPopover();

  const overlay = document.createElement('div');
  overlay.id = 'fd-widget-popover-modal';
  overlay.style.cssText = `
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(4, 7, 13, 0.85);
    backdrop-filter: blur(6px);
    z-index: 999998;
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Chakra Petch', sans-serif;
  `;

  // Theme-aware via CSS custom properties (each app's own main/studio.css redefines
  // these per [data-theme]) rather than literal hex — this chrome belongs to the
  // modal itself, not the popover definition, so it has no style.* of its own to
  // derive from.
  const card = document.createElement('div');
  card.style.cssText = `
    background: var(--card-bg, #0d131f);
    border: 1px solid var(--accent-cyan, #22d3ee);
    box-shadow: 0 0 25px color-mix(in srgb, var(--accent-cyan, #22d3ee) 25%, transparent), 0 20px 40px rgba(0,0,0,0.8);
    border-radius: 12px;
    min-width: 320px;
    max-width: 92vw;
    max-height: 88vh;
    padding: 16px;
    overflow: auto;
  `;

  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // Declared before `instance` is assigned (rather than assigning `onClosePopover` onto
  // the instance after the fact) since the instance itself is what needs to be created
  // with this callback already in hand — `let` avoids a TDZ error if a factory were ever
  // to invoke onClosePopover synchronously during construction (none do today).
  let instance;
  const close = () => {
    try { instance?.destroy?.(); } catch (_) { /* already torn down */ }
    overlay.remove();
    activePopover = null;
    document.removeEventListener('keydown', onKeyDown);
  };

  instance = createPopoverInstance({
    popoverDef,
    contextSnapshot,
    onCommitToHost: (contextKey, value) => {
      const entry = contextSnapshot[contextKey];
      if (!entry || !entry.writable) {
        console.warn(`[WidgetPopoverModal] Rejected commitToHost for undeclared/non-writable contextKey "${contextKey}"`);
        return;
      }
      writeStateRef(hostWidget, entry.stateRef, value);
    },
    onClosePopover: () => close()
  });

  function onKeyDown(e) {
    if (e.key === 'Escape') close();
  }
  document.addEventListener('keydown', onKeyDown);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  instance.mount(card);
  activePopover = { overlay, instance };
}

export function closeWidgetPopover() {
  document.getElementById('fd-widget-popover-modal')?.remove();
  if (activePopover) {
    try { activePopover.instance.destroy?.(); } catch (_) { /* already torn down */ }
    activePopover = null;
  }
}
