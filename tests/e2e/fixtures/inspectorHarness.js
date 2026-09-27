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

/**
 * Markup-injection payload for the Inspector escaping sweep. Parsed as markup, it closes a
 * `textarea`, an `option` and a `select`, and plants an `<img id="injected">`. It carries both
 * quote kinds, and its literal `&amp;` shows as `&` if the value is decoded twice.
 * @type {string}
 */
export const INJECTION_PAYLOAD = `x"'&amp;</textarea></option></select><img id="injected">`;

/**
 * A second payload, `INJECTION_PAYLOAD` followed by `2`, for cases that need two different strings.
 * @type {string}
 */
export const INJECTION_PAYLOAD_2 = `${INJECTION_PAYLOAD}2`;

/**
 * Counts `#injected` elements inside the Inspector's containers: `#studio-right-sidebar` and every
 * open `.studio-modal-overlay`, meaning one without the `hidden` class (the menu bar and status bar
 * keep hidden overlays of their own). Other panels render the same authored values, so an
 * `#injected` anywhere else in the document is not counted.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<number>} Distinct `#injected` elements found.
 * @throws {Error} When `#studio-right-sidebar` is missing, so a missing Inspector never counts 0.
 */
export async function countInjectedInInspector(page) {
  return page.evaluate(() => {
    const sidebar = document.getElementById('studio-right-sidebar');
    if (!sidebar) throw new Error('[inspectorHarness] #studio-right-sidebar is missing');
    const found = new Set();
    for (const root of [sidebar, ...document.querySelectorAll('.studio-modal-overlay:not(.hidden)')]) {
      for (const el of root.querySelectorAll('#injected')) found.add(el);
    }
    return found.size;
  });
}

/**
 * Collects the errors `StudioState.notify` would otherwise swallow into a log line: every
 * `pageerror`, and every console error whose text contains `[StudioState] Listener error`. Call it
 * before seeding, so a throw during the seeding render is collected too.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {string[]} A list that keeps growing while the page runs; empty while nothing has thrown.
 */
export function collectRenderErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.stack || error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error' && message.text().includes('[StudioState] Listener error')) {
      errors.push(`console: ${message.text()}`);
    }
  });
  return errors;
}

/**
 * The `StudioState` methods `installWriteRecorder` records. They only name the writer when a
 * write is caught; the `widgetDef` snapshot in `readWriteCheck` does not depend on this list
 * being complete.
 * @type {string[]}
 */
export const STATE_WRITE_METHODS = [
  'updateComponent',
  'updateWidgetMeta',
  'updateWidgetLayout',
  'updateWidgetStyle',
  'updateWidgetThemeConfig',
  'setDeckEvents',
  'updateWidgetRawField',
  'setWidgetDef',
  'addStateVar',
  'ensureSyncFromVar',
  'applyFieldToSelection',
  'applyStyleToSelection',
  'saveHistory',
];

/**
 * Installs call-through recorders on `window.__studioApp.state` for every `STATE_WRITE_METHODS`
 * entry, and a depth counter around its `notify`. Install once per page, after `openStudio` and
 * before any seeding, so a one-shot write during the seeding render is caught.
 *
 * Every recorded call is logged except one made inside `runSeeding` while no notification is in
 * progress. That skips the test's own seeding calls and the `saveHistory` each makes before it
 * notifies. A call a listener makes during a notification, such as a render, is always logged.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 * @throws {Error} In-page, when a listed method is missing from the state.
 */
export async function installWriteRecorder(page) {
  await page.evaluate((names) => {
    window.__inspectorHarness ??= { calls: {} };
    const harness = window.__inspectorHarness;
    const state = window.__studioApp.state;
    harness.writes = [];
    harness.seeding = false;
    harness.notifyDepth = 0;
    harness.runSeeding = (seed, seedArg) => {
      harness.seeding = true;
      try {
        const result = seed(seedArg);
        if (typeof result?.then === 'function') throw new Error('[inspectorHarness] a seeding function must be synchronous');
        return result;
      } finally {
        harness.seeding = false;
      }
    };
    const originalNotify = state.notify;
    state.notify = function notifyWithDepth(...args) {
      harness.notifyDepth += 1;
      try {
        return originalNotify.apply(this, args);
      } finally {
        harness.notifyDepth -= 1;
      }
    };
    for (const name of names) {
      const original = state[name];
      if (typeof original !== 'function') throw new Error(`[inspectorHarness] state.${name} is not a function`);
      state[name] = function recordedWrite(...args) {
        if (!harness.seeding || harness.notifyDepth > 0) {
          harness.writes.push({ method: name, caller: new Error().stack.split('\n')[2]?.trim() ?? '' });
        }
        return original.apply(this, args);
      };
    }
  }, STATE_WRITE_METHODS);
}

/**
 * Runs seeding code in the page with the write recorder's seeding flag set, and clears the flag
 * as soon as it returns. `seed` is serialized like a `page.evaluate` callback, so it cannot close
 * over test-side variables; pass them through `arg`. It must be synchronous: a write queued with
 * `queueMicrotask` runs after the flag is cleared and is logged.
 *
 * @param {import('@playwright/test').Page} page
 * @param {(arg: any) => unknown} seed - In-page seeding function.
 * @param {unknown} [arg] - JSON-serializable argument for `seed`.
 * @returns {Promise<unknown>} What `seed` returned.
 * @throws {Error} In-page, when `installWriteRecorder` has not run or `seed` returns a Promise.
 */
export async function runSeeding(page, seed, arg = null) {
  return page.evaluate(`(() => {
    const harness = window.__inspectorHarness;
    if (!harness?.runSeeding) throw new Error('[inspectorHarness] installWriteRecorder must run before runSeeding');
    return harness.runSeeding(${seed}, ${JSON.stringify(arg)});
  })()`);
}

/**
 * Waits one task, so every queued microtask has run, then stores `JSON.stringify` of the current
 * `widgetDef` for `readWriteCheck`. Take it after the last seeding write and before the render
 * under test.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<void>}
 */
export async function snapshotWidgetDef(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.__inspectorHarness ??= { calls: {} };
    window.__inspectorHarness.widgetDefSnapshot = JSON.stringify(window.__studioApp.state.widgetDef);
  });
}

/**
 * Reports whether anything wrote the widget definition. `widgetDefChanged` compares the current
 * `widgetDef` with the `snapshotWidgetDef` snapshot and is the authority. `writes` lists the calls
 * `installWriteRecorder` logged, each with its method and calling frame. A render that writes
 * nothing gives `{ widgetDefChanged: false, writes: [] }`.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ widgetDefChanged: boolean, writes: Array<{ method: string, caller: string }> }>}
 * @throws {Error} In-page, when no snapshot was taken or the recorder is not installed.
 */
export async function readWriteCheck(page) {
  return page.evaluate(() => {
    const harness = window.__inspectorHarness;
    if (harness?.widgetDefSnapshot === undefined) throw new Error('[inspectorHarness] snapshotWidgetDef must run before readWriteCheck');
    if (!harness.writes) throw new Error('[inspectorHarness] installWriteRecorder must run before readWriteCheck');
    return {
      widgetDefChanged: JSON.stringify(window.__studioApp.state.widgetDef) !== harness.widgetDefSnapshot,
      writes: [...harness.writes],
    };
  });
}
