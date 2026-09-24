/**
 * @module inspectorHarness
 *
 * Playwright characterization harness for `StudioInspector`. Specs import
 * `test`/`expect` from here instead of `@playwright/test` so every page they
 * drive is isolated from a live PC Bridge and the wider network:
 *
 * - Every WebSocket the page opens is routed and closed without
 *   `connectToServer`, so `SimBridge.connect()` (which targets
 *   `<page host>:8080` by default) never reaches a real bridge.
 * - Every HTTP(S) request outside the Studio web server's own origin is
 *   aborted. That covers port 8080 and the external font/CDN requests
 *   `index.html` makes.
 * - Service workers are blocked for the context.
 *
 * Playwright gives each test a fresh browser context, so `localStorage`
 * (`fdws_studio_uiMode`, `fdws_saved_widgets`, `fdws_current_session`)
 * starts empty.
 *
 * The in-page helpers drive the real Studio through the existing
 * `window.__studioApp` global and the `StudioState` API. Test-side bookkeeping
 * lives on `window.__inspectorHarness`, which only exists in pages this
 * harness has touched. Nothing here replaces or stubs a `StudioInspector`
 * method: `recordCalls` installs call-through wrappers that forward the
 * original `this`, arguments and return value unchanged.
 *
 * Playwright does not collect this file (it is not a `*.spec.js`) and Vitest
 * excludes `tests/e2e/**`.
 */
import { test as base } from '@playwright/test';

export { expect } from '@playwright/test';

// Interception records keyed by page, filled by the `page` fixture override
// and handed out by the `bridgeIsolation` fixture.
const isolationByPage = new WeakMap();

/**
 * Isolated Playwright `test`. Adds a `bridgeIsolation` fixture and routes the
 * `page` fixture before the test body runs.
 *
 * `bridgeIsolation` records what the routes intercepted, as plain arrays that
 * grow while the page runs:
 * - `webSockets`: every WebSocket URL the page attempted. Each was closed
 *   without a server connection.
 * - `aborted`: every HTTP(S) URL aborted for being off-origin.
 * - `served`: every HTTP(S) URL allowed through to the Studio web server.
 *
 * @type {import('@playwright/test').TestType<
 *   import('@playwright/test').PlaywrightTestArgs &
 *   import('@playwright/test').PlaywrightTestOptions &
 *   { bridgeIsolation: { webSockets: string[], aborted: string[], served: string[] } },
 *   import('@playwright/test').PlaywrightWorkerArgs &
 *   import('@playwright/test').PlaywrightWorkerOptions
 * >}
 */
export const test = base.extend({
  serviceWorkers: 'block',
  bridgeIsolation: async ({ page }, use) => {
    await use(isolationByPage.get(page));
  },
  page: async ({ page, baseURL }, use) => {
    const studioOrigin = new URL(baseURL).origin;
    const record = { webSockets: [], aborted: [], served: [] };
    await page.routeWebSocket(/.*/, (ws) => {
      record.webSockets.push(ws.url());
      ws.close();
    });
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (new URL(url).origin === studioOrigin) {
        record.served.push(url);
        return route.continue();
      }
      record.aborted.push(url);
      return route.abort();
    });
    isolationByPage.set(page, record);
    await use(page);
  },
});

/**
 * Loads Studio at `/` and waits until `window.__studioApp.inspector` exists,
 * which `StudioApp.mountSubsystems` assigns after constructing the Inspector.
 *
 * @param {import('@playwright/test').Page} page - A page from the isolated `test`.
 * @returns {Promise<void>} Resolves once the app's Inspector is mounted.
 */
export async function openStudio(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.__studioApp?.inspector));
}

/**
 * Adds components through `StudioState.addComponent`, one call (and one
 * `COMPONENT_ADDED` notification) per component, with `recordHistory` left at
 * its default (`true`). `addComponent` assigns default `layout`/`layer`
 * when absent, de-duplicates the id and makes each new component the primary
 * selection.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Array<object>} components - JSON-serializable component definitions.
 * @returns {Promise<string[]>} The ids `addComponent` actually assigned, in order.
 */
export async function seedComponents(page, components) {
  return page.evaluate((comps) => comps.map((comp) => window.__studioApp.state.addComponent(comp).id), components);
}

/**
 * Declares state variables through `StudioState.addStateVar`, one
 * `STATE_VARS_UPDATED` notification and one history entry per variable.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Array<object>} stateVars - JSON-serializable `state[]` entries.
 * @returns {Promise<void>}
 */
export async function seedStateVars(page, stateVars) {
  await page.evaluate((vars) => {
    for (const stateVar of vars) window.__studioApp.state.addStateVar(stateVar);
  }, stateVars);
}

/**
 * Adds assets through `StudioState.addAsset`, one `ASSETS_UPDATED`
 * notification and one history entry per asset.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Array<object>} assets - JSON-serializable `assets[]` entries.
 * @returns {Promise<void>}
 */
export async function seedAssets(page, assets) {
  await page.evaluate((list) => {
    for (const asset of list) window.__studioApp.state.addAsset(asset);
  }, assets);
}

/**
 * Selects components the way the canvas does: a plain
 * `selectComponent(first)`, then an additive `selectComponent(id, true)` for
 * each remaining id. Two or more ids produce a multi-selection whose primary
 * component is the last id. An empty list calls `clearSelection()`.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string[]} ids - Component ids, in click order.
 * @returns {Promise<void>}
 */
export async function selectComponents(page, ids) {
  await page.evaluate((list) => {
    const state = window.__studioApp.state;
    if (list.length === 0) {
      state.clearSelection();
      return;
    }
    state.selectComponent(list[0]);
    for (const id of list.slice(1)) state.selectComponent(id, true);
  }, ids);
}

/**
 * Constructs a fresh `StudioInspector` in-page, on a new `<div>` that is not
 * attached to the document, against the app's real `StudioState`. The module
 * is loaded with `import('/js/StudioInspector.js')`, the same URL the app
 * imports, so it is the same class the app uses.
 *
 * The instance is stored as `window.__inspectorHarness.fresh` (replacing any
 * earlier one) for later `page.evaluate` calls. Like the app's own instance
 * it subscribes to the state and is never unsubscribed, because the
 * Inspector has no teardown API.
 *
 * Collaborators:
 * - `simBridge: 'fake'` (the default) passes a disconnected fake stored as
 *   `window.__inspectorHarness.fakeSimBridge`. It mirrors a disconnected
 *   `SimBridge`: `connected` is `false`, `resolveDeckEvent` resolves `null`
 *   and `probeReadSimVar` rejects with `Not connected to PC Bridge.`.
 *   `fakeSimBridgeOverrides` must be JSON-serializable, so it can set
 *   `connected` but not functions; a test that needs scripted results
 *   reassigns the fake's methods in-page after construction.
 * - `simBridge: 'none'` omits the third constructor argument.
 * - `simVarTester: true` assigns a fake tester with no-op `open` and
 *   `prefillFireAndWatch`, stored as `window.__inspectorHarness.fakeSimVarTester`,
 *   the way `StudioApp.mountSubsystems` assigns the real one after construction.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ simBridge?: 'fake' | 'none', simVarTester?: boolean, fakeSimBridgeOverrides?: { connected?: boolean } }} [options]
 * @returns {Promise<void>} Resolves after the constructor (and its initial render) returns.
 */
export async function constructFreshInspector(page, options = {}) {
  await page.evaluate(async ({ simBridge = 'fake', simVarTester = false, fakeSimBridgeOverrides = {} }) => {
    const { StudioInspector } = await import('/js/StudioInspector.js');
    window.__inspectorHarness ??= { calls: {} };
    const harness = window.__inspectorHarness;
    const container = document.createElement('div');
    let inspector;
    if (simBridge === 'none') {
      inspector = new StudioInspector(container, window.__studioApp.state);
    } else {
      harness.fakeSimBridge = {
        connected: false,
        resolveDeckEvent: () => Promise.resolve(null),
        probeReadSimVar: () => Promise.reject(new Error('Not connected to PC Bridge.')),
        ...fakeSimBridgeOverrides,
      };
      inspector = new StudioInspector(container, window.__studioApp.state, harness.fakeSimBridge);
    }
    if (simVarTester) {
      harness.fakeSimVarTester = { open() {}, prefillFireAndWatch() {} };
      inspector.simVarTester = harness.fakeSimVarTester;
    }
    harness.fresh = inspector;
  }, options);
}

/**
 * Installs call-through recorders on methods of an in-page object reached by a
 * dotted path from `window` (for example `'__studioApp.state'`,
 * `'__inspectorHarness.fresh'` or `'__inspectorHarness.fakeSimBridge'`).
 *
 * Each wrapper is an own property on the target that shadows the original
 * lookup, appends `{ method, args }` to `window.__inspectorHarness.calls[path]`,
 * then calls the original with the same `this` and arguments and returns its
 * result unchanged (including a returned Promise or a thrown error). Arguments
 * are recorded as JSON-safe snapshots: DOM nodes become `<tag#id>`, functions
 * become `[function]`, other values follow `JSON.stringify` (so a `Set` or
 * `Map` records as `{}`), and a value it throws on (a cycle, a BigInt) becomes
 * `[unserializable]`. The recorder never alters what the original receives.
 *
 * Calling this again for the same path keeps the earlier log and wraps the
 * current (possibly already wrapped) methods again, so install once per path.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} path - Dotted path from `window` to the target object.
 * @param {string[]} methodNames - Methods to record; each must exist on the target.
 * @returns {Promise<void>}
 * @throws {Error} In-page, when the path does not resolve or a method is missing.
 */
export async function recordCalls(page, path, methodNames) {
  await page.evaluate(({ targetPath, names }) => {
    window.__inspectorHarness ??= { calls: {} };
    const target = targetPath.split('.').reduce((obj, key) => obj?.[key], window);
    if (!target) throw new Error(`[inspectorHarness] ${targetPath} did not resolve`);
    const snapshot = (value) => {
      if (typeof Node !== 'undefined' && value instanceof Node) {
        return `<${value.nodeName.toLowerCase()}${value.id ? `#${value.id}` : ''}>`;
      }
      if (typeof value === 'function') return '[function]';
      try {
        return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
      } catch {
        return '[unserializable]';
      }
    };
    window.__inspectorHarness.calls[targetPath] ??= [];
    const log = window.__inspectorHarness.calls[targetPath];
    for (const name of names) {
      const original = target[name];
      if (typeof original !== 'function') throw new Error(`[inspectorHarness] ${targetPath}.${name} is not a function`);
      target[name] = function recordedCall(...args) {
        log.push({ method: name, args: args.map(snapshot) });
        return original.apply(this, args);
      };
    }
  }, { targetPath: path, names: methodNames });
}

/**
 * Returns the calls recorded so far for a path passed to `recordCalls`.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} path - The same dotted path given to `recordCalls`.
 * @returns {Promise<Array<{ method: string, args: unknown[] }>>} Calls in order; empty when none.
 */
export async function readCalls(page, path) {
  return page.evaluate((targetPath) => window.__inspectorHarness?.calls[targetPath] ?? [], path);
}

/**
 * Clears the recorded calls for a path without removing its recorders.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} path - The same dotted path given to `recordCalls`.
 * @returns {Promise<void>}
 */
export async function clearCalls(page, path) {
  await page.evaluate((targetPath) => {
    const log = window.__inspectorHarness?.calls[targetPath];
    if (log) log.length = 0;
  }, path);
}
