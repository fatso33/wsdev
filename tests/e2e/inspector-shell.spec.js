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
      'stateRefPicker',
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

// Slice 6 pins: the Shell responsibilities (tier toggle, tabs, accordions, "⋯ N more" badges,
// section JSON views, subtitle visibility and the summary badges) at the Inspector's public seam.

// Serialized into the page with Function#toString, so it must not close over anything.
// Returns the accordion group whose title is `title` in the app Inspector's container.
function findGroup(title) {
  const root = window.__studioApp.inspector.container;
  return [...root.querySelectorAll('.inspector-group')]
    .find((group) => group.querySelector('.group-title')?.textContent === title) ?? null;
}
const FIND_GROUP_SOURCE = findGroup.toString();

async function clickModeButton(page, mode) {
  await page.evaluate((target) => {
    window.__studioApp.inspector.container.querySelector(`.mode-toggle-btn[data-mode="${target}"]`).click();
  }, mode);
}

test('mode toggle click sets the tier, stores it, re-renders once and marks the active button', async ({ page }) => {
  await openStudio(page);
  await recordCalls(page, '__studioApp.inspector', ['render']);

  const readToggle = () => page.evaluate(() => {
    const inspector = window.__studioApp.inspector;
    return {
      uiTier: inspector.uiTier,
      stored: localStorage.getItem('fdws_studio_uiMode'),
      buttons: [...inspector.container.querySelectorAll('.inspector-mode-toggle .mode-toggle-btn')]
        .map((btn) => [btn.dataset.mode, btn.textContent, btn.classList.contains('active')]),
      hint: inspector.container.querySelector('.inspector-mode-toggle .prop-hint')?.textContent,
    };
  });

  expect(await readToggle()).toEqual({
    uiTier: 'guided',
    stored: null,
    buttons: [['guided', 'Guided', true], ['build', 'Build', false], ['full', 'Full', false]],
    hint: 'ⓘ',
  });

  for (const mode of ['full', 'build', 'guided']) {
    await clearCalls(page, '__studioApp.inspector');
    await clickModeButton(page, mode);
    const toggle = await readToggle();
    expect(toggle.uiTier, mode).toBe(mode);
    expect(toggle.stored, mode).toBe(mode);
    expect(toggle.buttons.filter(([, , active]) => active).map(([id]) => id), mode).toEqual([mode]);
    expect((await readCalls(page, '__studioApp.inspector')).map((call) => call.method), mode).toEqual(['render']);
  }
});

test('tierHidesField follows the three tier rules and treats unmarked values as visible', async ({ page }) => {
  await openStudio(page);
  await constructFreshInspector(page);
  const table = await page.evaluate(() => {
    const inspector = window.__inspectorHarness.fresh;
    const result = {};
    for (const tier of ['guided', 'build', 'full']) {
      inspector.uiTier = tier;
      result[tier] = ['advanced', 'build', 'simple-only', 'other', '', undefined]
        .map((dataTier) => inspector.tierHidesField(dataTier));
    }
    return result;
  });
  expect(table).toEqual({
    guided: [true, true, false, false, false, false],
    build: [true, false, false, false, false, false],
    full: [false, false, true, false, false, false],
  });
});

test('applyUiMode hides tier-marked elements, except in a section the user revealed', async ({ page }) => {
  await openStudio(page);
  const result = await page.evaluate(() => {
    const inspector = window.__studioApp.inspector;
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="inspector-group"><span data-tier="advanced" id="plain-advanced"></span><span data-tier="simple-only" id="plain-simple"></span></div>
      <div class="inspector-group tier-override"><span data-tier="advanced" id="override-advanced"></span></div>`;
    inspector.container.appendChild(host);
    const read = () => Object.fromEntries([...host.querySelectorAll('[data-tier]')]
      .map((el) => [el.id, el.classList.contains('hidden')]));
    const out = {};
    for (const tier of ['guided', 'full']) {
      inspector.uiTier = tier;
      inspector.applyUiMode();
      out[tier] = read();
    }
    host.remove();
    return out;
  });
  expect(result).toEqual({
    guided: { 'plain-advanced': true, 'plain-simple': false, 'override-advanced': false },
    full: { 'plain-advanced': false, 'plain-simple': true, 'override-advanced': false },
  });
});

test('the active tab persists across selection changes; a multi-selection forces Style without writing it', async ({ page }) => {
  await openStudio(page);
  const [idA, idB] = await seedComponents(page, [
    { id: 'tab-a', type: 'core.button', style: {}, props: { label: 'A' } },
    { id: 'tab-b', type: 'core.button', style: {}, props: { label: 'B' } },
  ]);
  const readTabs = () => page.evaluate(() => {
    const inspector = window.__studioApp.inspector;
    const root = inspector.container;
    return {
      stored: inspector.activeInspectorTab,
      buttons: [...root.querySelectorAll('.inspector-tab-btn')]
        .map((btn) => [btn.getAttribute('data-testid'), btn.textContent, btn.classList.contains('active'), btn.disabled]),
      activePanels: [...root.querySelectorAll('.inspector-panel.active')].map((panel) => panel.getAttribute('data-testid')),
      panelCount: root.querySelectorAll('.inspector-panel').length,
    };
  });
  const tab = (name, active, disabled) => [
    `inspector-tab-${name}`, { general: 'General', style: 'Style', data: 'Data', events: 'Events' }[name], active, disabled,
  ];

  await selectComponents(page, [idA]);
  expect(await readTabs()).toEqual({
    stored: 'general',
    buttons: [tab('general', true, false), tab('style', false, false), tab('data', false, false), tab('events', false, false)],
    activePanels: ['inspector-panel-general'],
    panelCount: 4,
  });

  await page.locator('[data-testid="inspector-tab-data"]').click();
  expect(await readTabs()).toMatchObject({ stored: 'data', activePanels: ['inspector-panel-data'] });

  // The choice survives another component and the widget root.
  await selectComponents(page, [idB]);
  expect(await readTabs()).toMatchObject({ stored: 'data', activePanels: ['inspector-panel-data'] });
  await selectComponents(page, []);
  expect(await readTabs()).toMatchObject({ stored: 'data', activePanels: ['inspector-panel-data'] });

  // Multi-selection: three tabs disabled, Style active whatever was stored, clicking Style writes nothing.
  await selectComponents(page, [idA, idB]);
  expect(await readTabs()).toEqual({
    stored: 'data',
    buttons: [tab('general', false, true), tab('style', true, false), tab('data', false, true), tab('events', false, true)],
    activePanels: ['inspector-panel-style'],
    panelCount: 4,
  });
  await page.locator('[data-testid="inspector-tab-style"]').click();
  expect(await readTabs()).toMatchObject({ stored: 'data', activePanels: ['inspector-panel-style'] });

  // Back to a single selection the earlier tab is restored.
  await selectComponents(page, [idA]);
  expect(await readTabs()).toMatchObject({ stored: 'data', activePanels: ['inspector-panel-data'] });

  await page.locator('[data-testid="inspector-tab-events"]').click();
  expect((await readTabs()).stored).toBe('events');
});

test('accordions seed from isOpenDefault once and then keep the user choice across renders and selections', async ({ page }) => {
  await openStudio(page);
  const readGroup = (title) => page.evaluate(({ target, source }) => {
    const group = new Function(`return (${source})`)()(target);
    const body = group?.querySelector('.inspector-group-body');
    return group && {
      open: body.classList.contains('open'),
      collapsed: body.classList.contains('collapsed'),
      chevronOpen: group.querySelector('.group-chevron')?.classList.contains('open') ?? null,
      expanded: window.__studioApp.inspector.expandedGroups.has(target),
    };
  }, { target: title, source: FIND_GROUP_SOURCE });
  const clickHeader = (title) => page.evaluate(({ target, source }) => {
    new Function(`return (${source})`)()(target).querySelector('.inspector-group-header').click();
  }, { target: title, source: FIND_GROUP_SOURCE });

  expect(await readGroup('METADATA & SPECIFICATION')).toEqual({ open: true, collapsed: false, chevronOpen: true, expanded: true });
  expect(await readGroup('GRID & DIMENSIONS')).toEqual({ open: false, collapsed: true, chevronOpen: false, expanded: false });

  // Collapsing an open-by-default group is remembered; the default is not re-applied on re-render.
  await clickHeader('METADATA & SPECIFICATION');
  expect(await readGroup('METADATA & SPECIFICATION')).toEqual({ open: false, collapsed: true, chevronOpen: false, expanded: false });
  await page.evaluate(() => window.__studioApp.state.notify('WIDGET_META_UPDATED'));
  expect(await readGroup('METADATA & SPECIFICATION')).toEqual({ open: false, collapsed: true, chevronOpen: false, expanded: false });

  await clickHeader('GRID & DIMENSIONS');
  await page.evaluate(() => window.__studioApp.state.notify('WIDGET_META_UPDATED'));
  expect(await readGroup('GRID & DIMENSIONS')).toEqual({ open: true, collapsed: false, chevronOpen: true, expanded: true });

  // A component's groups sit inside the tab panels: always open, no chevron, but still recorded
  // in expandedGroups from their isOpenDefault the first time they are seen.
  const [idA] = await seedComponents(page, [{ id: 'acc-a', type: 'core.button', style: {}, props: { label: 'A' } }]);
  await selectComponents(page, [idA]);
  expect(await readGroup('LAYOUT & LAYERING')).toEqual({ open: true, collapsed: false, chevronOpen: null, expanded: true });
  expect(await readGroup('BEHAVIOR')).toEqual({ open: true, collapsed: false, chevronOpen: null, expanded: false });

  // The widget-root choices survive a trip through a component selection.
  await selectComponents(page, []);
  expect(await readGroup('METADATA & SPECIFICATION')).toEqual({ open: false, collapsed: true, chevronOpen: false, expanded: false });
  expect(await readGroup('GRID & DIMENSIONS')).toEqual({ open: true, collapsed: false, chevronOpen: true, expanded: true });
});

test('buildAccordionGroup builds the header, body and section JSON record', async ({ page }) => {
  await openStudio(page);
  await constructFreshInspector(page);
  const result = await page.evaluate(() => {
    const inspector = window.__inspectorHarness.fresh;
    const renderBodies = [];
    const collapsible = inspector.buildAccordionGroup('SHAPE ONE', false, (body) => {
      renderBodies.push(body.className);
      body.textContent = 'content';
    }, 'a badge', { a: 1 });
    const flat = inspector.buildAccordionGroup('SHAPE TWO', false, () => {}, '', undefined, true);
    inspector.tierOverrideGroups.add('SHAPE THREE');
    const overridden = inspector.buildAccordionGroup('SHAPE THREE', true, () => {}, undefined, [], false);
    const describe = (group) => ({
      className: group.className,
      childClasses: [...group.children].map((child) => child.className),
      title: group.querySelector('.group-title').textContent,
      badge: group.querySelector('.group-badge')?.textContent ?? null,
      hasChevron: group.querySelector('.group-chevron') !== null,
      bodyText: group.querySelector('.inspector-group-body').textContent,
    });
    return {
      renderBodies,
      collapsible: describe(collapsible),
      flat: describe(flat),
      overridden: describe(overridden),
      jsonTitles: Object.keys(inspector._sectionJsonData),
      jsonData: { one: inspector._sectionJsonData['SHAPE ONE'], three: inspector._sectionJsonData['SHAPE THREE'] },
      expanded: [...inspector.expandedGroups],
      known: [...inspector.knownGroupTitles],
    };
  });
  expect(result.renderBodies).toEqual(['inspector-group-body collapsed']);
  expect(result.collapsible).toEqual({
    className: 'inspector-group',
    childClasses: ['inspector-group-header', 'inspector-group-body collapsed'],
    title: 'SHAPE ONE',
    badge: 'a badge',
    hasChevron: true,
    bodyText: 'content',
  });
  expect(result.flat).toEqual({
    className: 'inspector-group non-collapsible',
    childClasses: ['inspector-tab-section-header', 'inspector-group-body open'],
    title: 'SHAPE TWO',
    badge: null,
    hasChevron: false,
    bodyText: '',
  });
  expect(result.overridden.className).toBe('inspector-group tier-override');
  // The constructor's own widget-root render already recorded its six titles; these two follow.
  expect(result.jsonTitles.slice(-2)).toEqual(['SHAPE ONE', 'SHAPE THREE']);
  expect(result.jsonData).toEqual({ one: { a: 1 }, three: [] });
  // Only the default-open group is seeded as expanded; every title is remembered.
  expect(result.expanded).toContain('SHAPE THREE');
  expect(result.expanded).not.toContain('SHAPE ONE');
  expect(result.known).toEqual(expect.arrayContaining(['SHAPE ONE', 'SHAPE TWO', 'SHAPE THREE']));
});

test('"⋯ N more" counts tier-hidden fields exactly, singular and plural', async ({ page }) => {
  await openStudio(page);
  await constructFreshInspector(page);
  const result = await page.evaluate(() => {
    const inspector = window.__inspectorHarness.fresh;
    const build = (title, fieldTiers) => inspector.buildAccordionGroup(title, true, (body) => {
      for (const tier of fieldTiers) {
        const field = document.createElement('div');
        if (tier) field.dataset.tier = tier;
        body.appendChild(field);
      }
    });
    inspector.container.replaceChildren(
      build('ONE HIDDEN', ['advanced', 'simple-only', undefined]),
      build('THREE HIDDEN', ['advanced', 'build', 'advanced', 'simple-only']),
      build('NONE HIDDEN', ['simple-only', undefined]),
      build('ALREADY REVEALED', ['advanced']),
    );
    inspector.tierOverrideGroups.add('ALREADY REVEALED');
    inspector.uiTier = 'guided';
    inspector.applyTierMoreBadges();
    return [...inspector.container.querySelectorAll('.inspector-group')].map((group) => {
      const badge = group.querySelector('.group-tier-more');
      return {
        title: group.querySelector('.group-title').textContent,
        text: badge?.textContent ?? null,
        titleAttr: badge?.title ?? null,
        parent: badge?.parentElement.className ?? null,
        tag: badge?.tagName ?? null,
        type: badge?.type ?? null,
      };
    });
  });
  const cluster = 'group-title-cluster';
  expect(result).toEqual([
    { title: 'ONE HIDDEN', text: '⋯ 1 more', titleAttr: 'Show 1 more field in this section without leaving the current tier.', parent: cluster, tag: 'BUTTON', type: 'button' },
    { title: 'THREE HIDDEN', text: '⋯ 3 more', titleAttr: 'Show 3 more fields in this section without leaving the current tier.', parent: cluster, tag: 'BUTTON', type: 'button' },
    { title: 'NONE HIDDEN', text: null, titleAttr: null, parent: null, tag: null, type: null },
    { title: 'ALREADY REVEALED', text: null, titleAttr: null, parent: null, tag: null, type: null },
  ]);
});

test('clicking "⋯ N more" reveals the section, keeps it open and does not toggle it', async ({ page }) => {
  await openStudio(page);
  await recordCalls(page, '__studioApp.inspector', ['render']);
  const before = await page.evaluate(() => {
    const inspector = window.__studioApp.inspector;
    const badge = inspector.container.querySelector('.group-tier-more');
    const group = badge.closest('.inspector-group');
    const title = group.querySelector('.group-title').textContent;
    const body = group.querySelector('.inspector-group-body');
    // Make sure the group is expanded first, so a leaked header click would visibly collapse it.
    if (!inspector.expandedGroups.has(title)) group.querySelector('.inspector-group-header').click();
    const hidden = [...body.querySelectorAll('[data-tier]')].filter((el) => el.dataset.tier === 'advanced' || el.dataset.tier === 'build');
    return { title, text: badge.textContent, hiddenCount: hidden.length, expanded: inspector.expandedGroups.has(title) };
  });
  expect(before.text).toBe(`⋯ ${before.hiddenCount} more`);
  expect(before.expanded).toBe(true);

  await clearCalls(page, '__studioApp.inspector');
  const after = await page.evaluate((title) => {
    const inspector = window.__studioApp.inspector;
    const groupOf = () => [...inspector.container.querySelectorAll('.inspector-group')]
      .find((g) => g.querySelector('.group-title').textContent === title);
    groupOf().querySelector('.group-tier-more').click();
    const group = groupOf();
    return {
      override: inspector.tierOverrideGroups.has(title),
      expanded: inspector.expandedGroups.has(title),
      groupClass: group.className,
      bodyOpen: group.querySelector('.inspector-group-body').classList.contains('open'),
      moreBadge: group.querySelector('.group-tier-more') !== null,
      stillHidden: [...group.querySelectorAll('[data-tier]')].filter((el) => el.classList.contains('hidden')).length,
    };
  }, before.title);
  expect(after).toEqual({
    override: true,
    expanded: true,
    groupClass: 'inspector-group tier-override',
    bodyOpen: true,
    moreBadge: false,
    stillHidden: 0,
  });
  expect((await readCalls(page, '__studioApp.inspector')).map((call) => call.method)).toEqual(['render']);
});

test('section JSON views appear at Full only, after the content, and remember their open state', async ({ page }) => {
  await openStudio(page);
  const [id] = await seedComponents(page, [{
    id: 'json-btn', type: 'core.button', style: { border: { width: 2 } }, props: { label: 'Json' },
    binding: { readSimVar: 'A:GENERAL ENG RPM:1' },
  }]);
  await selectComponents(page, [id]);

  const readViews = () => page.evaluate(() => {
    const inspector = window.__studioApp.inspector;
    const views = {};
    for (const group of inspector.container.querySelectorAll('.inspector-group')) {
      const title = group.querySelector('.group-title').textContent;
      const body = group.querySelector('.inspector-group-body');
      const toggle = body.querySelector(':scope > .section-json-toggle');
      const pre = body.querySelector(':scope > .section-json-block');
      if (!toggle) continue;
      views[title] = {
        toggleText: toggle.textContent,
        toggleClass: toggle.className,
        preHidden: pre.classList.contains('hidden'),
        lastTwo: [body.children[body.children.length - 2] === toggle, body.lastElementChild === pre],
        matchesData: pre.textContent === JSON.stringify(inspector._sectionJsonData[title], null, 2),
      };
    }
    return { views, open: [...inspector.jsonViewOpenTitles], dataTitles: Object.keys(inspector._sectionJsonData) };
  });

  for (const tier of ['guided', 'build']) {
    await clickModeButton(page, tier);
    expect((await readViews()).views, tier).toEqual({});
  }

  await clickModeButton(page, 'full');
  const closed = await readViews();
  expect(Object.keys(closed.views).sort()).toEqual(['APPEARANCE', 'BEHAVIOR', 'DATA & CONTENT', 'LAYOUT & LAYERING']);
  expect([...closed.dataTitles].sort()).toEqual(Object.keys(closed.views).sort());
  for (const [title, view] of Object.entries(closed.views)) {
    expect(view, title).toEqual({
      toggleText: 'View JSON',
      toggleClass: 'bar-btn section-json-toggle',
      preHidden: true,
      lastTwo: [true, true],
      matchesData: true,
    });
  }

  const toggle = (title) => page.evaluate(({ target, source }) => {
    new Function(`return (${source})`)()(target).querySelector('.section-json-toggle').click();
  }, { target: title, source: FIND_GROUP_SOURCE });

  await toggle('BEHAVIOR');
  let views = await readViews();
  expect(views.open).toEqual(['BEHAVIOR']);
  expect(views.views.BEHAVIOR).toMatchObject({ toggleText: 'Hide JSON', preHidden: false });
  expect(views.views.APPEARANCE).toMatchObject({ toggleText: 'View JSON', preHidden: true });

  // The open state survives a re-render.
  await page.evaluate(() => window.__studioApp.state.notify('COMPONENT_UPDATED'));
  views = await readViews();
  expect(views.views.BEHAVIOR).toMatchObject({ toggleText: 'Hide JSON', preHidden: false });

  await toggle('BEHAVIOR');
  views = await readViews();
  expect(views.open).toEqual([]);
  expect(views.views.BEHAVIOR).toMatchObject({ toggleText: 'View JSON', preHidden: true });
});

test('the widget-root DECK EVENTS section shows an empty list as JSON when none are declared', async ({ page }) => {
  await openStudio(page);
  await clickModeButton(page, 'full');
  const result = await page.evaluate(({ source }) => {
    const inspector = window.__studioApp.inspector;
    const group = new Function(`return (${source})`)()('DECK EVENTS (v1.27)');
    return {
      pre: group.querySelector(':scope > .inspector-group-body > .section-json-block').textContent,
      titles: Object.keys(inspector._sectionJsonData),
    };
  }, { source: FIND_GROUP_SOURCE });
  expect(result.pre).toBe('[]');
  expect(result.titles).toContain('DECK EVENTS (v1.27)');
});

test('applySubtitleVisibility hides a heading with nothing visible under it and skips tier-marked headings', async ({ page }) => {
  await openStudio(page);
  const result = await page.evaluate(() => {
    const inspector = window.__studioApp.inspector;
    const host = document.createElement('div');
    host.innerHTML = `
      <div class="prop-section-subtitle" id="sv-empty">No fields</div>
      <div class="prop-section-subtitle" id="sv-hidden">All hidden</div>
      <div class="prop-field" style="display:none"></div>
      <div class="prop-field hidden"></div>
      <div class="prop-section-subtitle" id="sv-visible">A visible field</div>
      <div class="prop-field"></div>
      <div class="prop-section-subtitle" id="sv-nested">A nested field</div>
      <div class="wrapper"><div class="prop-field"></div></div>
      <div class="prop-section-subtitle hidden" id="sv-revealed">Now visible</div>
      <div class="prop-field"></div>
      <div class="prop-section-subtitle" id="sv-marked" data-tier="build">Tier-marked</div>
      <div class="prop-field" style="display:none"></div>
      <div class="prop-section-subtitle hidden" id="sv-marked-hidden" data-tier="build">Tier-marked, already hidden</div>
      <div class="prop-field"></div>`;
    inspector.container.appendChild(host);
    inspector.applySubtitleVisibility();
    const out = Object.fromEntries([...host.querySelectorAll('.prop-section-subtitle')]
      .map((el) => [el.id, el.classList.contains('hidden')]));
    host.remove();
    return out;
  });
  expect(result).toEqual({
    'sv-empty': true,
    'sv-hidden': true,
    'sv-visible': false,
    'sv-nested': false,
    'sv-revealed': false,
    // A heading carrying its own data-tier is left exactly as the tier pass set it.
    'sv-marked': false,
    'sv-marked-hidden': true,
  });
});

test('a rendered panel hides every heading that has no visible field beneath it', async ({ page }) => {
  await openStudio(page);
  const [id] = await seedComponents(page, [{ id: 'sub-btn', type: 'core.button', style: {}, props: { label: 'Sub' } }]);
  await selectComponents(page, [id]);
  await page.locator('[data-testid="inspector-tab-style"]').click();

  for (const tier of ['guided', 'build', 'full']) {
    await clickModeButton(page, tier);
    const headings = await page.evaluate(() => {
      const panel = window.__studioApp.inspector.container.querySelector('.inspector-panel.active');
      return [...panel.querySelectorAll('.prop-section-subtitle')].filter((subtitle) => !subtitle.dataset.tier).map((subtitle) => {
        let visible = false;
        for (let node = subtitle.nextElementSibling; node && !node.classList.contains('prop-section-subtitle'); node = node.nextElementSibling) {
          const fields = node.matches('.prop-field') ? [node] : [...node.querySelectorAll('.prop-field')];
          if (fields.some((field) => field.offsetParent !== null)) { visible = true; break; }
        }
        return { text: subtitle.textContent.trim().slice(0, 30), hidden: subtitle.classList.contains('hidden'), visible };
      });
    });
    expect(headings.length, tier).toBeGreaterThan(0);
    for (const heading of headings) expect(heading.hidden, `${tier}: ${heading.text}`).toBe(!heading.visible);
  }
});

test('the four summary badges describe layout, appearance, data and behavior', async ({ page }) => {
  await openStudio(page);
  await constructFreshInspector(page);
  const badges = await page.evaluate(() => {
    const inspector = window.__inspectorHarness.fresh;
    const grid = { w: 4, h: 2, col: 1, row: 3 };
    return {
      layout: [
        inspector.buildLayoutBadge({}),
        inspector.buildLayoutBadge({ layout: grid }),
        inspector.buildLayoutBadge({ layout: { w: 0, h: 0, col: 0, row: 0 }, layer: { group: 'gauges' } }),
        inspector.buildLayoutBadge({ layout: grid, layer: { group: 'gauges', pointerEvents: 'none' } }),
        inspector.buildLayoutBadge({ layout: grid, layer: { pointerEvents: 'auto' } }),
      ],
      appearance: [
        inspector.buildAppearanceBadge({}),
        inspector.buildAppearanceBadge({ style: {} }),
        inspector.buildAppearanceBadge({ style: { typography: {} } }),
        inspector.buildAppearanceBadge({ style: { orientation: 'vertical' } }),
        inspector.buildAppearanceBadge({ style: { rules: [{}], border: {} } }),
        inspector.buildAppearanceBadge({ style: { rules: [{}, {}] } }),
        inspector.buildAppearanceBadge({ style: { rules: [] } }),
        inspector.buildAppearanceBadge({ style: { rules: [], background: {} } }),
      ],
      data: [
        inspector.buildDataBadge({}),
        inspector.buildDataBadge({ binding: { readSimVar: 'RPM', writeEvent: 'SET' } }),
        inspector.buildDataBadge({ binding: { readSimVar: 'RPM' } }),
        inspector.buildDataBadge({ binding: { writeEvent: 'SET' } }),
        inspector.buildDataBadge({ binding: { stateVar: 'mode' } }),
        inspector.buildDataBadge({ binding: { stateRef: 'a.b' } }),
        inspector.buildDataBadge({ binding: { stateVar: 'mode', stateRef: 'a.b' } }),
      ],
      behavior: [
        inspector.buildBehaviorBadge({}),
        inspector.buildBehaviorBadge({ interactions: [{}] }),
        inspector.buildBehaviorBadge({ interactions: [{}, {}], visibleWhen: { state: 'x' } }),
        inspector.buildBehaviorBadge({ layout: { guard: { asset: 'a' } } }),
        inspector.buildBehaviorBadge({ interactions: [{}], visibleWhen: {}, layout: { guard: {} } }),
      ],
    };
  });
  expect(badges).toEqual({
    layout: ['?×? @ (?,?)', '4×2 @ (1,3)', '0×0 @ (0,0) · gauges', '4×2 @ (1,3) · gauges · pass-through', '4×2 @ (1,3)'],
    appearance: ['Default', 'Default', 'Customized', 'Customized', '1 conditional rule', '2 conditional rules', 'Default', 'Customized'],
    data: ['Not bound', '↔ RPM', '→ RPM', '⇄ SET', 'state: mode', 'state: a.b', 'state: mode'],
    behavior: [
      '0 interactions', '1 interaction', '2 interactions · conditional visibility', '0 interactions · guarded',
      '1 interaction · conditional visibility · guarded',
    ],
  });
});

test('accordion header badges show the same summaries on a rendered component', async ({ page }) => {
  await openStudio(page);
  const [id] = await seedComponents(page, [{
    id: 'badge-btn', type: 'core.button', style: { border: { width: 1 } }, props: { label: 'Badge' },
    binding: { readSimVar: 'A:AIRSPEED INDICATED' },
    interactions: [{ trigger: 'tap', action: 'navigate', target: 'page' }],
    layout: { col: 2, row: 3, w: 5, h: 4 },
  }]);
  await selectComponents(page, [id]);
  const badges = await page.evaluate(() => Object.fromEntries([...window.__studioApp.inspector.container.querySelectorAll('.inspector-group')]
    .map((group) => [group.querySelector('.group-title').textContent, group.querySelector('.group-badge')?.textContent ?? null])));
  expect(badges['LAYOUT & LAYERING']).toBe('5×4 @ (2,3)');
  expect(badges.APPEARANCE).toBe('Customized');
  expect(badges['DATA & CONTENT']).toBe('→ A:AIRSPEED INDICATED');
  expect(badges.BEHAVIOR).toBe('1 interaction');
});

test('every render runs the post-render passes in the same order on all three branches', async ({ page }) => {
  await openStudio(page);
  const [idA, idB] = await seedComponents(page, [
    { id: 'order-a', type: 'core.button', style: {}, props: { label: 'A' } },
    { id: 'order-b', type: 'core.button', style: {}, props: { label: 'B' } },
  ]);
  await selectComponents(page, []);
  await constructFreshInspector(page);
  await recordCalls(page, '__inspectorHarness.fresh', [
    'renderInner', 'buildModeToggle', 'renderWidgetInspector', 'renderComponentInspector', 'renderMultiSelectInspector',
    'applyUiMode', 'applySubtitleVisibility', 'applyTierMoreBadges', 'applySectionJsonViews', 'enhanceNumberInputs',
  ]);

  const sequence = async (ids) => {
    await selectComponents(page, ids);
    await clearCalls(page, '__inspectorHarness.fresh');
    await page.evaluate(() => window.__inspectorHarness.fresh.render());
    return (await readCalls(page, '__inspectorHarness.fresh')).map((call) => call.method);
  };
  const passes = ['applyUiMode', 'applySubtitleVisibility', 'applyTierMoreBadges', 'applySectionJsonViews', 'enhanceNumberInputs'];

  expect(await sequence([])).toEqual(['renderInner', 'buildModeToggle', 'renderWidgetInspector', ...passes]);
  expect(await sequence([idA])).toEqual(['renderInner', 'buildModeToggle', 'renderComponentInspector', ...passes]);
  expect(await sequence([idA, idB])).toEqual(['renderInner', 'buildModeToggle', 'renderMultiSelectInspector', ...passes]);
});

test('facade keeps one undo chain across widget, binding, rule and multi-select sections', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('fdws_studio_uiMode', 'full'));
  await openStudio(page);
  await page.evaluate(() => {
    const state = window.__studioApp.state;
    state.setWidgetDef({ fdws: '1.27', meta: { name: 'Before' }, components: [] }, false);
    state.undoStack = [];
    const field = document.querySelector('#w-meta-name');
    field.value = 'Integrated Inspector';
    field.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await page.locator('.inspector-group-header').filter({ hasText: 'GRID & DIMENSIONS' }).click();
  await seedComponents(page, [
    { id: 'trace-a', type: 'core.button', props: { label: 'A' }, style: {} },
    { id: 'trace-b', type: 'core.button', props: { label: 'B' }, style: {} },
  ]);
  await selectComponents(page, ['trace-a']);
  await page.getByTestId('inspector-tab-data').click();
  await page.evaluate(() => document.querySelector('#c-bind-write-connect').click());
  await page.locator('#cn-tab-raw').click();
  await page.locator('#cn-raw-input').fill('H:TRACE_EVENT');
  await page.getByRole('button', { name: 'Connect', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__studioApp.state.getComponent('trace-a').binding?.writeEvent))
    .toBe('H:TRACE_EVENT');
  expect(await page.evaluate(() => window.__studioApp.state.getComponent('trace-a').interactions))
    .toEqual([{ trigger: 'tap', action: { type: 'core.dispatchEvent' } }]);

  await page.getByTestId('inspector-tab-style').click();
  await page.evaluate(() => document.querySelector('#c-styletab-addrule').click());
  await expect.poll(() => page.evaluate(() => window.__studioApp.state.getComponent('trace-a').style.rules.length)).toBe(1);
  await selectComponents(page, ['trace-a', 'trace-b']);
  await page.locator('.style-preset-swatch').first().click();
  const beforeUndo = await page.evaluate(() => {
    const { inspector, state } = window.__studioApp;
    return {
      name: state.widgetDef.meta.name,
      ids: state.widgetDef.components.map((comp) => comp.id),
      write: state.getComponent('trace-a').binding.writeEvent,
      ruleCount: state.getComponent('trace-a').style.rules.length,
      styleA: state.getComponent('trace-a').style,
      styleB: state.getComponent('trace-b').style,
      tab: inspector.activeInspectorTab,
      tier: inspector.uiTier,
      expanded: [...inspector.expandedGroups],
      history: state.undoStack.length,
    };
  });
  expect(beforeUndo).toMatchObject({
    name: 'Integrated Inspector', ids: ['trace-a', 'trace-b'], write: 'H:TRACE_EVENT',
    ruleCount: 1, tab: 'style', tier: 'full', history: 6,
  });
  expect(beforeUndo.expanded).toContain('GRID & DIMENSIONS');
  expect(beforeUndo.styleA.typography).toEqual(beforeUndo.styleB.typography);
  expect(beforeUndo.styleA.border).toEqual(beforeUndo.styleB.border);
  await selectComponents(page, ['trace-a']);
  expect(await page.evaluate(() => ({
    tab: window.__studioApp.inspector.activeInspectorTab,
    tier: window.__studioApp.inspector.uiTier,
    expanded: [...window.__studioApp.inspector.expandedGroups],
  }))).toEqual({ tab: beforeUndo.tab, tier: beforeUndo.tier, expanded: beforeUndo.expanded });

  const undo = () => page.evaluate(() => window.__studioApp.state.undo());
  await undo();
  expect(await page.evaluate(() => window.__studioApp.state.getComponent('trace-a').style.rules)).toHaveLength(1);
  await undo();
  expect(await page.evaluate(() => window.__studioApp.state.getComponent('trace-a').style.rules)).toBeUndefined();
  await undo();
  expect(await page.evaluate(() => window.__studioApp.state.getComponent('trace-a').binding?.writeEvent)).toBeUndefined();
  await undo();
  await undo();
  expect(await page.evaluate(() => window.__studioApp.state.widgetDef.components)).toHaveLength(0);
  await undo();
  expect(await page.evaluate(() => window.__studioApp.state.widgetDef.meta.name)).not.toBe('Integrated Inspector');
});
