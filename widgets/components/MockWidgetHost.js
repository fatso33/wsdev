/**
 * MockWidgetHost.js
 * Widget Studio's lightweight stand-in for the runtime CompositeWidget class, used by
 * the Device View live-preview/simulate surface (Studio has no CompositeWidget/
 * WidgetRegistry of its own — it drives component renderers directly).
 *
 * Factored out so the interaction switch (including FDWS v1.3 Widget Popover actions)
 * is defined once and shared between StudioDeviceView's top-level preview host and
 * WidgetPopoverModal's nested popover-instance host.
 */

import { ComponentRegistry } from './ComponentRegistry.js';
import { runInteraction } from './InteractionDispatcher.js';
import { notifyBindingDependents } from './BindingReactivity.js';

/**
 * @param {object} def - widget definition being previewed
 * @param {object} opts
 * @param {(event: string, val: any) => void} opts.dispatchSimEvent
 * @param {object} [opts.popoverContext] - FDWS v1.3: read-only $context snapshot, set on popover-instance hosts only
 * @param {(contextKey: string, value: any) => void} [opts.onCommitToHost] - FDWS v1.3: set on popover-instance hosts only
 * @param {() => void} [opts.onClosePopover] - FDWS v1.3: set on popover-instance hosts only
 * @param {(popoverWidgetId: string) => object|null} [opts.findPopoverDef] - FDWS v1.3: resolves a saved popover-kind widget by id, set on hosts that can open popovers
 * @param {(opts: {hostWidget: object, popoverWidgetId: string, contextDecl: object}) => void} [opts.openWidgetPopover] - FDWS v1.3: injected opener (avoids a circular import with WidgetPopoverModal.js)
 * @param {'dark'|'light'} [opts.theme] - Studio's live theme-preview toggle (StudioState.previewTheme); BaseComponent.applyStyles() reads this back via host.getPreviewTheme(). Defaults to 'dark' when omitted (e.g. a popover host that doesn't thread it through yet).
 * @param {(name: string, value: any) => void} [opts.onLocalStateChange] - fired on every setLocalState/swapLocalState so a caller (StudioDeviceView.js, for the State tab's live "Current:" readout) can mirror this host's local state elsewhere without needing to poll it.
 */
export function createMockHost(def, opts) {
  const { dispatchSimEvent, popoverContext, onCommitToHost, onClosePopover, openWidgetPopover, theme, onLocalStateChange } = opts;

  // FDWS v1.12 §1.1: a popover state var can request its initial value come
  // from the host's Context Map instead of `default` — see CompositeWidget.js's
  // identical resolution for the full rationale. popoverContext is already
  // available here (passed via opts), so no constructor-ordering fix like the
  // PWA needed is required in this mock.
  const host = {
    definition: def,
    localState: new Map((def.state || []).map((s) => [
      s.name,
      (s.seedFromContext && popoverContext?.[s.seedFromContext]) ? popoverContext[s.seedFromContext].value : s.default
    ])),
    renderers: new Map(),
    popoverContext: popoverContext || null,
    onCommitToHost: onCommitToHost || null,
    onClosePopover: onClosePopover || null,

    dispatchSimEvent(event, val) {
      dispatchSimEvent(event, val);
    },

    getPreviewTheme() {
      return theme || 'dark';
    },

    // FDWS v1.18: mirrors CompositeWidget.js's getThemeConfig() — read
    // straight off the definition Studio is currently editing, so flipping
    // the widget's Theme group (baseTheme/themeMode) in StudioInspector.js
    // takes effect the next time this preview re-renders.
    getThemeConfig() {
      return {
        baseTheme: def.baseTheme === 'light' ? 'light' : 'dark',
        themeMode: def.themeMode === 'manual' ? 'manual' : 'auto'
      };
    },

    // FDWS v1.3: a "$context.<key>.value" name resolves against the read-only
    // popoverContext snapshot instead of local state.
    getLocalState(name) {
      if (typeof name === 'string' && name.startsWith('$context.')) {
        const [, key, field] = name.split('.');
        const entry = this.popoverContext?.[key];
        if (!entry) return undefined;
        return field ? entry[field] : entry;
      }
      return this.localState.get(name);
    },

    setLocalState(name, val) {
      if (typeof name === 'string' && name.startsWith('$context.')) {
        console.warn(`[MockWidgetHost] Rejected direct write to "${name}" — use core.commitToHost instead.`);
        return;
      }
      this.localState.set(name, val);
      if (onLocalStateChange) onLocalStateChange(name, val);
      // Widget Studio 2.0, Phase 0 (adjustment pass): shared with
      // CompositeWidget.js's real setLocalState() via BindingReactivity.js —
      // this also fixes a real pre-existing divergence, where this mock never
      // had CompositeWidget.js's props.compose.stateVar/relativeToStateVar
      // branch, so a gauge's secondary compose transform never re-rendered
      // here on a state change even though it correctly did in the real app.
      notifyBindingDependents({
        getLocalState: (n) => this.getLocalState(n),
        getAllStateObject: () => this.getAllStateObject(),
        getRenderer: (id) => this.renderers.get(id)
      }, def.components, name, val);
    },

    swapLocalState(f1, f2) {
      const v1 = this.localState.get(f1);
      const v2 = this.localState.get(f2);
      this.setLocalState(f1, v2);
      this.setLocalState(f2, v1);
    },

    getAllStateObject() {
      const obj = {};
      this.localState.forEach((v, k) => { obj[k] = v; });
      return obj;
    },

    resolveAssetUrl(assetId) {
      const clean = (assetId || '').replace(/^asset:\/\//, '');
      const asset = (def.assets || []).find((a) => a.id === clean);
      return asset?.data ? `data:${asset.mimeType || 'image/png'};base64,${asset.data}` : null;
    },

    // FDWS v1.20 §2: mirrors CompositeWidget.js's resolveAssetSvgText() — see
    // its own doc comment for why this exists (inline-SVG tinting via
    // currentColor). MockWidgetHost has no CompositeWidget of its own, so this
    // duplicate needs the same addition applied directly.
    resolveAssetSvgText(assetId) {
      const clean = (assetId || '').replace(/^asset:\/\//, '');
      const asset = (def.assets || []).find((a) => a.id === clean);
      if (!asset?.data || asset.mimeType !== 'image/svg+xml') return null;
      try {
        return atob(asset.data);
      } catch (_) {
        return null;
      }
    },

    createComponentRenderer(childDef) {
      const RendererClass = ComponentRegistry.getRenderer(childDef.type);
      const renderer = new RendererClass(childDef, this);
      this.renderers.set(childDef.id, renderer);
      return renderer;
    },

    handleInteraction(compDef, trigger, eventData = {}) {
      // Widget Studio 2.0, Phase 0: the action switch is shared with
      // CompositeWidget.js's real dispatcher via InteractionDispatcher.js —
      // this adapter just wires it to this mock host's own state/renderer map
      // and (when present) its popover-instance plumbing.
      runInteraction({
        dispatchSimEvent: (event, val) => this.dispatchSimEvent(event, val),
        getLocalState: (name) => this.getLocalState(name),
        setLocalState: (name, val) => this.setLocalState(name, val),
        swapLocalState: (f1, f2) => this.swapLocalState(f1, f2),
        getAllStateObject: () => this.getAllStateObject(),
        getRenderer: (id) => this.renderers.get(id),
        // See CompositeWidget.js's flushPendingEdits() for what this closes —
        // same fix, same reasoning, applied to this mock host so Studio's Device
        // View simulator matches the real app's runtime behavior exactly.
        flushPendingEdits: () => {
          this.renderers.forEach((renderer) => { renderer.flushPendingEdit?.(); });
        },
        // FDWS v1.3 Widget Popovers
        openWidgetPopover: openWidgetPopover
          ? ({ hostWidget, popoverWidgetId, contextDecl }) => openWidgetPopover({ hostWidget, popoverWidgetId, contextDecl })
          : undefined,
        onCommitToHost: this.onCommitToHost ? (key, val) => this.onCommitToHost(key, val) : undefined,
        onClosePopover: this.onClosePopover ? () => this.onClosePopover() : undefined,
        onUnhandledActionType: (type) => console.log(`[Device View] Unhandled interaction: ${type}`)
      }, compDef, trigger, eventData);
    }
  };

  return host;
}
