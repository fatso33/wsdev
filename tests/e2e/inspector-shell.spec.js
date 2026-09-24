import {
  clearCalls,
  constructFreshInspector,
  expect,
  openStudio,
  readCalls,
  recordCalls,
  seedComponents,
  selectComponents,
  test,
} from './fixtures/inspectorHarness.js';

// Facade-level pins for StudioInspector's constructor, state subscription,
// render branches and focus restoration. Scroll anchoring across a re-render
// is pinned by inspector-scroll-preservation.spec.js and is not repeated here.

const SUBSCRIBED_CHANGE_TYPES = [
  'SELECTION_CHANGED', 'LAYER_GROUP_SELECTED', 'COMPONENT_UPDATED', 'COMPONENT_ADDED',
  'COMPONENT_DELETED', 'WIDGET_DEF_LOADED', 'WIDGET_META_UPDATED', 'WIDGET_LAYOUT_UPDATED',
  'WIDGET_STYLE_UPDATED', 'LAYER_GROUPS_UPDATED', 'STATE_VARS_UPDATED', 'ASSETS_UPDATED',
  'HISTORY_CHANGE', 'STYLE_CLIPBOARD_UPDATED', 'PREVIEW_THEME_CHANGED',
];

const IGNORED_CHANGE_TYPES = ['TESTER_PARSED', 'LIVE_STATE_VALUE_CHANGED', 'EDITOR_VISIBILITY_CHANGED'];

// Widget-root accordion titles the constructor's initial render registers.
const WIDGET_ROOT_GROUPS = [
  'METADATA & SPECIFICATION', 'GRID & DIMENSIONS', 'CANVAS APPEARANCE & BORDER',
  'THEME', 'DECK EVENTS (v1.27)', 'CAPABILITIES MATRIX (§11)',
];

// Evaluated in-page against the app's mounted Inspector: the structure every
// render branch shares (mode toggle first, then the post-render passes).
function readRenderedShell() {
  const root = window.__studioApp.inspector.container;
  const numberInputs = [...root.querySelectorAll('input[type="number"]')];
  const tierHidden = [...root.querySelectorAll('[data-tier="build"], [data-tier="advanced"]')]
    .filter((el) => !el.closest('.inspector-group.tier-override'));
  return {
    firstChildClass: root.firstElementChild?.className,
    badge: root.querySelector('.inspector-header .inspector-badge')?.textContent.trim(),
    badgeClass: root.querySelector('.inspector-header .inspector-badge')?.className,
    title: root.querySelector('.inspector-header .inspector-title')?.textContent.trim(),
    sub: root.querySelector('.inspector-header .inspector-sub')?.textContent.trim(),
    numberInputCount: numberInputs.length,
    allNumbersEnhanced: numberInputs.every((input) => input.dataset.numEnhanced === '1'
      && input.parentElement.classList.contains('prop-number-wrap')
      && input.parentElement.querySelector('.prop-number-chevrons') !== null),
    tierHiddenCount: tierHidden.length,
    allTierHiddenCarryHidden: tierHidden.every((el) => el.classList.contains('hidden')),
    moreBadgeCount: root.querySelectorAll('.group-tier-more').length,
  };
}

test('the harness keeps the page off the bridge port and the wider network', async ({ page, bridgeIsolation }) => {
  await openStudio(page);

  // StudioApp.init connects at once and SimBridge retries after a close, so
  // two routed sockets prove the reconnect path is intercepted too.
  await expect.poll(() => bridgeIsolation.webSockets.length, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  for (const url of bridgeIsolation.webSockets) expect(new URL(url).port).toBe('8080');

  const studioOrigin = new URL(page.url()).origin;
  expect(bridgeIsolation.served.length).toBeGreaterThan(0);
  for (const url of bridgeIsolation.served) expect(new URL(url).origin).toBe(studioOrigin);
  expect(bridgeIsolation.aborted.some((url) => new URL(url).hostname === 'fonts.googleapis.com')).toBe(true);

  const status = await page.evaluate(async () => ({
    connected: window.__studioApp.simBridge.connected,
    label: document.querySelector('.studio-bridge-status-label')?.textContent,
    serviceWorkers: navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 0,
  }));
  expect(status).toEqual({ connected: false, label: 'Offline', serviceWorkers: 0 });
});

test('fresh construction creates exactly the twelve own fields, in constructor order', async ({ page }) => {
  await openStudio(page);
  await constructFreshInspector(page);

  const fields = await page.evaluate(() => {
    const inspector = window.__inspectorHarness.fresh;
    return {
      keys: Object.keys(inspector),
      containerDetached: inspector.container instanceof HTMLDivElement && !inspector.container.isConnected,
      stateIsAppState: inspector.state === window.__studioApp.state,
      simBridgeIsFake: inspector.simBridge === window.__inspectorHarness.fakeSimBridge,
      expandedGroups: inspector.expandedGroups instanceof Set ? [...inspector.expandedGroups] : null,
      knownGroupTitles: inspector.knownGroupTitles instanceof Set ? [...inspector.knownGroupTitles] : null,
      bindingAdvancedOpen: inspector._bindingAdvancedOpen,
      uiTier: inspector.uiTier,
      tierOverrideGroups: inspector.tierOverrideGroups instanceof Set ? [...inspector.tierOverrideGroups] : null,
      jsonViewOpenTitles: inspector.jsonViewOpenTitles instanceof Set ? [...inspector.jsonViewOpenTitles] : null,
      activeInspectorTab: inspector.activeInspectorTab,
      sectionJsonTitles: Object.keys(inspector._sectionJsonData),
      fieldRendererKeys: Object.keys(inspector.FIELD_RENDERERS),
      rootClasses: [...inspector.container.classList],
      firstChildClass: inspector.container.firstElementChild?.className,
      lateFieldsPresent: ['_multiStyleTabKey', '_multiStyleTab', '_styleTabCompId', '_styleTab',
        '_styleTabRuleIndex', '_conditionalStyleJsonOpen', 'simVarTester'].filter((key) => key in inspector),
    };
  });

  expect(fields).toEqual({
    keys: [
      'FIELD_RENDERERS', 'container', 'state', 'simBridge', 'expandedGroups', 'knownGroupTitles',
      '_bindingAdvancedOpen', 'uiTier', 'tierOverrideGroups', 'jsonViewOpenTitles',
      'activeInspectorTab', '_sectionJsonData',
    ],
    containerDetached: true,
    stateIsAppState: true,
    simBridgeIsFake: true,
    // Only the default-open group is seeded as expanded on first sight.
    expandedGroups: ['METADATA & SPECIFICATION'],
    knownGroupTitles: WIDGET_ROOT_GROUPS,
    bindingAdvancedOpen: false,
    uiTier: 'guided',
    tierOverrideGroups: [],
    jsonViewOpenTitles: [],
    activeInspectorTab: 'general',
    sectionJsonTitles: WIDGET_ROOT_GROUPS,
    fieldRendererKeys: [
      'text', 'iconPicker', 'number', 'checkbox', 'select', 'color', 'rowListEditor',
      'detentEditor', 'arcBandsEditor', 'stateVarPicker', 'assetPicker', 'rangeEditor', 'pivotEditor',
    ],
    rootClasses: ['studio-inspector-root'],
    firstChildClass: 'inspector-mode-toggle',
    lateFieldsPresent: [],
  });

  await constructFreshInspector(page, { simBridge: 'none' });
  expect(await page.evaluate(() => window.__inspectorHarness.fresh.simBridge)).toBeNull();
});

test('later fields appear only at their creation points', async ({ page }) => {
  await openStudio(page);
  await seedComponents(page, [
    { id: 'late-btn-1', type: 'core.button', style: {}, props: { label: 'One' } },
    { id: 'late-btn-2', type: 'core.button', style: {}, props: { label: 'Two' } },
  ]);
  await selectComponents(page, []);
  await constructFreshInspector(page);
  const presentLateFields = () => page.evaluate(() => ['_multiStyleTabKey', '_multiStyleTab', '_styleTabCompId',
    '_styleTab', '_styleTabRuleIndex'].filter((key) => Object.hasOwn(window.__inspectorHarness.fresh, key)));

  expect(await presentLateFields()).toEqual([]);

  await selectComponents(page, ['late-btn-1']);
  expect(await presentLateFields()).toEqual(['_styleTabCompId', '_styleTab', '_styleTabRuleIndex']);

  await selectComponents(page, ['late-btn-1', 'late-btn-2']);
  expect(await presentLateFields()).toEqual([
    '_multiStyleTabKey', '_multiStyleTab', '_styleTabCompId', '_styleTab', '_styleTabRuleIndex',
  ]);

  // StudioApp assigns the tester after constructing the app's Inspector.
  expect(await page.evaluate(() => Object.hasOwn(window.__studioApp.inspector, 'simVarTester')
    && window.__studioApp.inspector.simVarTester === window.__studioApp.simVarTester)).toBe(true);
});

test('uiTier migrates the stored mode without rewriting it', async ({ page }) => {
  await openStudio(page);
  const cases = [
    ['advanced', 'full'],
    ['simple', 'build'],
    ['guided', 'guided'],
    ['build', 'build'],
    ['full', 'full'],
    ['expert', 'guided'],
    [null, 'guided'],
  ];

  for (const [stored, expected] of cases) {
    await page.evaluate((value) => {
      if (value === null) localStorage.removeItem('fdws_studio_uiMode');
      else localStorage.setItem('fdws_studio_uiMode', value);
    }, stored);
    await constructFreshInspector(page);
    const result = await page.evaluate(() => {
      const inspector = window.__inspectorHarness.fresh;
      return {
        uiTier: inspector.uiTier,
        activeMode: inspector.container.querySelector('.mode-toggle-btn.active')?.dataset.mode,
        stored: localStorage.getItem('fdws_studio_uiMode'),
      };
    });
    expect(result, `stored ${stored}`).toEqual({ uiTier: expected, activeMode: expected, stored });
  }
});

test('each subscribed change type renders exactly once and other types do not render', async ({ page }) => {
  await openStudio(page);
  await constructFreshInspector(page);
  await recordCalls(page, '__inspectorHarness.fresh', ['render']);

  const renderCount = async (changeType) => {
    await clearCalls(page, '__inspectorHarness.fresh');
    await page.evaluate((type) => window.__studioApp.state.notify(type), changeType);
    return (await readCalls(page, '__inspectorHarness.fresh')).length;
  };

  for (const changeType of SUBSCRIBED_CHANGE_TYPES) {
    expect(await renderCount(changeType), changeType).toBe(1);
  }
  for (const changeType of IGNORED_CHANGE_TYPES) {
    expect(await renderCount(changeType), changeType).toBe(0);
  }
});

test('render branches: widget root, one component, and a multi-selection', async ({ page }) => {
  await openStudio(page);

  const root = await page.evaluate(readRenderedShell);
  expect(root).toMatchObject({
    firstChildClass: 'inspector-mode-toggle',
    badge: 'WIDGET',
    allNumbersEnhanced: true,
    allTierHiddenCarryHidden: true,
  });
  expect(root.numberInputCount).toBeGreaterThan(0);
  expect(root.tierHiddenCount).toBeGreaterThan(0);
  expect(root.moreBadgeCount).toBeGreaterThan(0);

  await seedComponents(page, [
    { id: 'shell-btn', type: 'core.button', style: {}, props: { label: 'Shell' },
      layer: { z: 3, group: null, pointerEvents: 'auto', clipToBounds: false } },
    { id: 'shell-btn-2', type: 'core.button', style: {}, props: { label: 'Second' } },
  ]);
  await selectComponents(page, ['shell-btn']);
  const single = await page.evaluate(readRenderedShell);
  expect(single).toMatchObject({
    firstChildClass: 'inspector-mode-toggle',
    badge: 'button',
    badgeClass: 'inspector-badge comp-type',
    sub: 'ID: shell-btn • Effective Z: 3',
    allNumbersEnhanced: true,
    allTierHiddenCarryHidden: true,
  });
  expect(single.numberInputCount).toBeGreaterThan(0);
  expect(single.tierHiddenCount).toBeGreaterThan(0);

  await selectComponents(page, ['shell-btn', 'shell-btn-2']);
  const multi = await page.evaluate(readRenderedShell);
  expect(multi).toMatchObject({
    firstChildClass: 'inspector-mode-toggle',
    badge: '2 SELECTED',
    title: 'Multiple Components',
    sub: 'shell-btn, shell-btn-2',
    allNumbersEnhanced: true,
    allTierHiddenCarryHidden: true,
  });
  expect(multi.numberInputCount).toBeGreaterThan(0);
  expect(multi.tierHiddenCount).toBeGreaterThan(0);
});

test('focus and selection range survive a re-render while typing in the widget name', async ({ page }) => {
  await openStudio(page);
  await page.evaluate(() => window.__studioApp.state.updateWidgetMeta({ name: 'Harness Widget' }));

  const nameInput = page.locator('#w-meta-name');
  await nameInput.click();
  await page.evaluate(() => {
    const input = document.getElementById('w-meta-name');
    input.setSelectionRange(2, 7);
    input.dataset.harnessOriginal = '1';
  });

  await page.evaluate(() => window.__studioApp.state.notify('WIDGET_META_UPDATED'));

  const after = await page.evaluate(() => {
    const active = document.activeElement;
    return {
      id: active?.id,
      rebuilt: active?.dataset.harnessOriginal === undefined,
      value: active?.value,
      range: [active?.selectionStart, active?.selectionEnd],
    };
  });
  expect(after).toEqual({ id: 'w-meta-name', rebuilt: true, value: 'Harness Widget', range: [2, 7] });
});
