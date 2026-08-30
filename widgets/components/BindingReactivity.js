/**
 * BindingReactivity.js
 * Widget Studio 2.0, Phase 0 (adjustment pass — see the Phase 2 planning discussion
 * for why this was pulled forward): the "which components need to re-render when a
 * local state variable changes" matching logic — previously hand-duplicated three
 * times (CompositeWidget.js's real setLocalState(), MockWidgetHost.js's mock
 * setLocalState(), StudioCanvas.js's _notifyDependents()) the same way the interaction
 * action switch was before InteractionDispatcher.js consolidated it.
 *
 * Pulled forward specifically because the planned concentric dual-rotary knob (Phase 2)
 * needs a SECOND, independent reactive binding per component (inner knob / outer knob) —
 * extending three hand-copied blocks a fourth way was exactly the drift risk Phase 0
 * exists to close. Adding that case now only needs to happen here, once.
 *
 * Lives under shared/widgets/components/ so it's synced into both apps the same way
 * InteractionDispatcher.js is — see scripts/sync-shared.mjs.
 *
 * @typedef {object} ReactivityHost
 * @property {(name: string) => any} getLocalState - needed by readStateRef() internally.
 * @property {() => object} getAllStateObject
 * @property {(componentId: string) => {update: (val: any, allState: object) => void, applyVisibility?: (allState: object) => void, currentValue?: any}|undefined} getRenderer
 */

import { parseStateRef, readStateRef } from '../utils/StateRefPath.js';

/**
 * Call after writing `changedName = value` into local state. Walks every component in
 * `components`, decides whether/how it needs to re-render, and calls its renderer.
 *
 * Mirrors CompositeWidget.js's original setLocalState() reactive loop exactly:
 * - `comp.binding.stateVar` matching the changed var → re-render with the fresh value.
 * - `comp.binding.stateRef`/`sublabelStateRef` whose PATH'S BASE VAR matches → re-resolve
 *   just that nested/indexed sub-value via readStateRef() (FDWS v1.11/v1.14).
 * - `comp.props.compose.stateVar`/`relativeToStateVar` matching → re-render with the
 *   renderer's own last primary value unchanged (FDWS v1.5/v1.6 gauge compose).
 * - anything else → just re-evaluate visibility (visibleWhen may reference this var).
 *
 * @param {ReactivityHost} host
 * @param {object[]} components - definition.components (or def.components) array
 * @param {string} changedName - the local-state variable name that was just written
 * @param {any} value - the fresh value written for `changedName`
 */
export function notifyBindingDependents(host, components, changedName, value) {
  const allState = host.getAllStateObject();

  (components || []).forEach((comp) => {
    const renderer = host.getRenderer(comp.id);
    if (!renderer) return;

    const stateRefBase = comp.binding?.stateRef ? parseStateRef(comp.binding.stateRef)?.name : null;
    const sublabelRefBase = comp.binding?.sublabelStateRef ? parseStateRef(comp.binding.sublabelStateRef)?.name : null;

    if (comp.binding?.stateVar === changedName) {
      renderer.update(value, allState);
    } else if (stateRefBase === changedName || sublabelRefBase === changedName) {
      renderer.update(readStateRef(host, comp.binding.stateRef ?? comp.binding.sublabelStateRef), allState);
    } else if (
      comp.props?.compose?.stateVar === changedName ||
      comp.props?.compose?.relativeToStateVar === changedName
    ) {
      renderer.update(renderer.currentValue, allState);
    } else if (
      // FDWS v1.15: core.indicator's binding.testStateVar (lamp test) — the
      // indicator's own bound value hasn't changed, but it still needs to
      // re-render with its LAST value so the testStateVar OR can re-evaluate.
      comp.binding?.testStateVar === changedName ||
      // FDWS v1.15: a component's own style.rules may reference ANY state
      // var in its conditions, not just the ones already covered above —
      // re-render (cheaply: update() itself no-ops the extra work unless
      // style.rules is actually present) so a rule watching this var reacts.
      (Array.isArray(comp.style?.rules) && comp.style.rules.length > 0)
    ) {
      renderer.update(renderer.currentValue, allState);
    } else {
      renderer.applyVisibility?.(allState);
    }
  });
}
