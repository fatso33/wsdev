/**
 * @module InspectorShell
 * Structure and persistent view choices of the Property Inspector: the Guided/Build/Full tier toggle,
 * the General/Style/Data/Events tab shell, collapsible accordion groups, the "⋯ N more" reveal links,
 * the Full-tier section JSON views, subtitle visibility and the collapsed-section summary badges.
 * Every function takes the live Inspector `host` first and reads it at call time; the module holds no
 * state of its own. The host fields it writes after construction are `uiTier` (and its
 * `fdws_studio_uiMode` localStorage copy), `activeInspectorTab`, `expandedGroups`, `knownGroupTitles`,
 * `tierOverrideGroups`, `jsonViewOpenTitles` and the `_sectionJsonData` entries; it reads `container`.
 * The facade constructor creates those fields and migrates the stored tier, `renderInner` resets
 * `_sectionJsonData` before each render, and the Bindings section's "switch to Full mode" links also
 * write `uiTier` and the stored mode, each where it was authored.
 * Listeners: the mode buttons, tab buttons, accordion headers, "⋯ N more" buttons and JSON toggles it
 * builds all live on DOM that the next render discards. Handlers re-render through `host.render()`;
 * the tier-visibility and subtitle passes go through `host.tierHidesField` and
 * `host.applySubtitleVisibility`, so an instance-level override still takes effect. It uses no async
 * callbacks or modal lifecycles, and DOM errors propagate to the caller.
 */
import { escapeHtmlAttr } from './inspectorMarkup.js';

/**
 * Builds the always-visible Guided/Build/Full tier switch, independent of what is selected. A click
 * stores the tier on the host and in `localStorage` and re-renders the whole panel.
 * @param {object} host Inspector facade providing `uiTier` and `render`.
 * @returns {HTMLElement} The `.inspector-mode-toggle` bar, not yet attached.
 */
export function buildModeToggle(host) {
  const bar = document.createElement('div');
  bar.className = 'inspector-mode-toggle';
  bar.innerHTML = `
      <button type="button" class="mode-toggle-btn ${host.uiTier === 'guided' ? 'active' : ''}" data-mode="guided">Guided</button>
      <button type="button" class="mode-toggle-btn ${host.uiTier === 'build' ? 'active' : ''}" data-mode="build">Build</button>
      <button type="button" class="mode-toggle-btn ${host.uiTier === 'full' ? 'active' : ''}" data-mode="full">Full</button>
      <span class="prop-hint" title="Guided shows only what a first widget needs. Build (the default) adds the rest of what most widgets need. Full shows everything, flat — compose transforms, poll tuning, custom bindings, and similar. Fields are never removed, only hidden; nothing you've already set is lost by switching, and every section's '⋯ N more' link reveals its own hidden fields without leaving the tier.">ⓘ</span>
    `;
  for (const btn of bar.querySelectorAll('.mode-toggle-btn')) {
    btn.addEventListener('click', () => {
      host.uiTier = btn.dataset.mode;
      localStorage.setItem('fdws_studio_uiMode', host.uiTier);
      host.render();
    });
  }
  return bar;
}

/**
 * Says whether a field or section marked with this `data-tier` value is hidden at the current tier.
 * Three values exist:
 * - `advanced`: Full only (registry `field.tier === 'advanced'`).
 * - `build`: Build and Full, hidden only in Guided (registry `field.tier === 'simple'` without
 *   `field.guided`).
 * - `simple-only`: Guided and Build, hidden only in Full. These are friendlier front ends onto a field
 *   that Full already exposes directly, so showing both would be two competing controls for one value.
 *
 * Anything unmarked, or marked with any other value, is always visible.
 * @param {object} host Inspector facade providing `uiTier`.
 * @param {string|undefined} dataTier The element's `data-tier` value.
 * @returns {boolean} True when the element must carry the `hidden` class.
 */
export function tierHidesField(host, dataTier) {
  if (dataTier === 'advanced') return host.uiTier !== 'full';
  if (dataTier === 'build') return host.uiTier === 'guided';
  if (dataTier === 'simple-only') return host.uiTier === 'full';
  return false;
}

/**
 * Applies `tierHidesField` to every `data-tier` element in the container, except inside an accordion
 * section the user has expanded through its own "⋯ N more" link (`buildAccordionGroup` marks that
 * section `.tier-override`), so revealing a section's hidden fields does not require leaving the tier
 * for the whole panel. It finishes with `host.applySubtitleVisibility()`. Call after any (re-)render.
 * @param {object} host Inspector facade providing `container`, `tierHidesField` and
 *   `applySubtitleVisibility`.
 * @returns {void} Toggles the `hidden` class in place.
 */
export function applyUiMode(host) {
  for (const el of host.container.querySelectorAll('[data-tier]')) {
    const overridden = el.closest('.inspector-group.tier-override');
    el.classList.toggle('hidden', !overridden && host.tierHidesField(el.dataset.tier));
  }
  host.applySubtitleVisibility();
}

/**
 * Hides a `.prop-section-subtitle` heading whose fields are all hidden, so no title floats over
 * nothing (for example Appearance's Layout and Background groups at the Guided tier). A subtitle that
 * carries its own `data-tier` is a separate, static-heading mechanism and is left alone. Visibility is
 * judged by rendered layout (`offsetParent`) rather than the `hidden` class, so a field shown only
 * because it holds an authored non-default value, which deliberately carries no `data-tier`, still
 * counts as something for the heading to show. A heading counts the fields between itself and the next
 * heading among its following siblings, directly or nested.
 * @param {object} host Inspector facade providing `container`.
 * @returns {void} Toggles the `hidden` class on each heading; the container must be attached to the
 *   document for the layout check to see real visibility.
 */
export function applySubtitleVisibility(host) {
  for (const subtitle of host.container.querySelectorAll('.prop-section-subtitle')) {
    if (subtitle.dataset.tier) continue;
    let hasVisibleField = false;
    let node = subtitle.nextElementSibling;
    while (node && !node.classList.contains('prop-section-subtitle')) {
      const fields = node.matches('.prop-field') ? [node] : Array.from(node.querySelectorAll('.prop-field'));
      if (fields.some((f) => f.offsetParent !== null)) { hasVisibleField = true; break; }
      node = node.nextElementSibling;
    }
    subtitle.classList.toggle('hidden', !hasVisibleField);
  }
}

/**
 * Injects the "⋯ N more" link into every accordion section that has fields hidden by the current tier,
 * the escape hatch that makes hiding fields by tier acceptable at all. It must run after the whole
 * panel has finished rendering, like `applyUiMode`, and not from inside `buildAccordionGroup`: some
 * sections build an empty accordion shell and fill its body afterwards, so counting there would
 * undercount to zero. A click stops propagation (the header's own click toggles expand/collapse), adds
 * the title to `tierOverrideGroups` and `expandedGroups` (revealing fields in a collapsed section is a
 * dead end otherwise), and re-renders.
 * @param {object} host Inspector facade providing `container`, `tierOverrideGroups`, `expandedGroups`,
 *   `tierHidesField` and `render`.
 * @returns {void} Appends one button to `.group-title-cluster` of each affected, not yet revealed group.
 */
export function applyTierMoreBadges(host) {
  for (const group of host.container.querySelectorAll('.inspector-group')) {
    const title = group.querySelector('.group-title')?.textContent;
    if (!title || host.tierOverrideGroups.has(title)) continue;
    const body = group.querySelector('.inspector-group-body');
    const hiddenCount = Array.from(body.querySelectorAll('[data-tier]'))
      .filter((el) => host.tierHidesField(el.dataset.tier)).length;
    if (hiddenCount === 0) continue;
    const moreBtn = document.createElement('button');
    moreBtn.type = 'button';
    moreBtn.className = 'group-tier-more';
    moreBtn.textContent = `⋯ ${hiddenCount} more`;
    moreBtn.title = `Show ${hiddenCount} more field${hiddenCount === 1 ? '' : 's'} in this section without leaving the current tier.`;
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      host.tierOverrideGroups.add(title);
      host.expandedGroups.add(title);
      host.render();
    });
    group.querySelector('.group-title-cluster')?.appendChild(moreBtn);
  }
}

/**
 * Full tier's per-section JSON: a read-only view of each accordion section's own underlying data, for
 * verifying the raw shape rather than a translated form. It is not an editing surface. The data comes
 * from `host._sectionJsonData`, keyed by group title and recorded by `buildAccordionGroup`. It must run
 * after the whole panel has rendered, like `applyTierMoreBadges`: appending from inside
 * `buildAccordionGroup` would land the block before the content of sections that populate their body
 * afterwards, above the fields on some sections and below them on the rest. Each section gets a toggle
 * button and a `<pre>` appended after its content; the open state persists in `jsonViewOpenTitles`.
 * @param {object} host Inspector facade providing `uiTier`, `container`, `_sectionJsonData` and
 *   `jsonViewOpenTitles`.
 * @returns {void} Does nothing outside the Full tier.
 */
export function applySectionJsonViews(host) {
  if (host.uiTier !== 'full') return;
  for (const group of host.container.querySelectorAll('.inspector-group')) {
    const title = group.querySelector('.group-title')?.textContent;
    const data = title ? host._sectionJsonData[title] : undefined;
    if (data === undefined) continue;
    const body = group.querySelector('.inspector-group-body');
    if (!body) continue;
    const isOpen = host.jsonViewOpenTitles.has(title);

    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'bar-btn section-json-toggle';
    toggleBtn.textContent = isOpen ? 'Hide JSON' : 'View JSON';
    body.appendChild(toggleBtn);

    const pre = document.createElement('pre');
    pre.className = `section-json-block ${isOpen ? '' : 'hidden'}`;
    pre.textContent = JSON.stringify(data, null, 2);
    body.appendChild(pre);

    toggleBtn.addEventListener('click', () => {
      const nowOpen = !host.jsonViewOpenTitles.has(title);
      if (nowOpen) host.jsonViewOpenTitles.add(title); else host.jsonViewOpenTitles.delete(title);
      toggleBtn.textContent = nowOpen ? 'Hide JSON' : 'View JSON';
      pre.classList.toggle('hidden', !nowOpen);
    });
  }
}

/**
 * Builds the General/Style/Data/Events tab bar and its four panels. `disabledTabs` and `forceActiveTab`
 * serve the multi-select shell, which needs General, Data and Events visibly disabled and Style forced
 * active whatever tab an earlier single selection left in `activeInspectorTab`. Both default to the
 * single-selection behavior. When a tab is forced, clicking it stays a no-op rather than writing into
 * the persistent `activeInspectorTab`: that write would survive deselection and silently reopen the
 * Inspector on Style instead of the tab the single selection had active.
 * @param {object} host Inspector facade providing `activeInspectorTab` and `render`.
 * @param {{disabledTabs?: string[], forceActiveTab?: string|null}} [opts] Tabs to disable, and a tab
 *   to show active regardless of `activeInspectorTab`.
 * @returns {{tabBar: HTMLElement, panelsContainer: HTMLElement, panels: Object<string, HTMLElement>}}
 *   Unattached elements; `panels` is keyed `general`, `style`, `data`, `events`. An enabled tab button
 *   stores its name and re-renders.
 */
export function buildInspectorTabShell(host, { disabledTabs = [], forceActiveTab = null } = {}) {
  const tabBar = document.createElement('div');
  tabBar.className = 'inspector-tab-bar';

  const tabs = ['general', 'style', 'data', 'events'];
  const tabLabels = { general: 'General', style: 'Style', data: 'Data', events: 'Events' };
  const panels = {};
  const activeTab = forceActiveTab || host.activeInspectorTab;

  for (const tabName of tabs) {
    const isDisabled = disabledTabs.includes(tabName);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `inspector-tab-btn ${tabName === activeTab ? 'active' : ''}`;
    btn.textContent = tabLabels[tabName];
    btn.setAttribute('data-testid', `inspector-tab-${tabName}`);
    if (isDisabled) {
      btn.disabled = true;
    } else if (!forceActiveTab) {
      btn.addEventListener('click', () => {
        host.activeInspectorTab = tabName;
        host.render();
      });
    }
    tabBar.appendChild(btn);
  }

  const panelsContainer = document.createElement('div');
  panelsContainer.className = 'inspector-panels';

  for (const tabName of tabs) {
    const panel = document.createElement('div');
    panel.className = `inspector-panel ${tabName === activeTab ? 'active' : ''}`;
    panel.setAttribute('data-testid', `inspector-panel-${tabName}`);
    panelsContainer.appendChild(panel);
    panels[tabName] = panel;
  }

  return { tabBar, panelsContainer, panels };
}

// Collapsed-group summary badges. Deliberately plain, short, scannable strings rather than full
// sentences, since they sit inline in a section header next to the chevron.

/**
 * Summarizes a component's grid placement, layer group and pointer pass-through.
 * @param {object} host Inspector facade (unused; kept for the shared delegate signature).
 * @param {object} comp Component whose `layout` and `layer` are read; missing values show as `?`.
 * @returns {string} For example `4×2 @ (1,3) · gauges · pass-through`.
 */
export function buildLayoutBadge(host, comp) {
  const layout = comp.layout || {};
  const parts = [`${layout.w ?? '?'}×${layout.h ?? '?'} @ (${layout.col ?? '?'},${layout.row ?? '?'})`];
  if (comp.layer?.group) parts.push(comp.layer.group);
  if (comp.layer?.pointerEvents === 'none') parts.push('pass-through');
  return parts.join(' · ');
}

/**
 * Summarizes a component's style: the number of conditional rules, else whether any base style group is
 * customized.
 * @param {object} host Inspector facade (unused; kept for the shared delegate signature).
 * @param {object} comp Component whose `style` is read.
 * @returns {string} `N conditional rule(s)`, `Customized` or `Default`.
 */
export function buildAppearanceBadge(host, comp) {
  const style = comp.style || {};
  const ruleCount = style.rules?.length || 0;
  if (ruleCount > 0) return `${ruleCount} conditional rule${ruleCount === 1 ? '' : 's'}`;
  const customized = !!(style.typography || style.border || style.background || style.align || style.offset || style.orientation);
  return customized ? 'Customized' : 'Default';
}

/**
 * Summarizes a component's data binding, first match wins: read and write, read only, write only, a
 * state variable, a state reference, else nothing.
 * @param {object} host Inspector facade (unused; kept for the shared delegate signature).
 * @param {object} comp Component whose `binding` is read.
 * @returns {string} For example `↔ A:GENERAL ENG RPM:1`, `state: mode` or `Not bound`.
 */
export function buildDataBadge(host, comp) {
  const binding = comp.binding || {};
  if (binding.readSimVar && binding.writeEvent) return `↔ ${binding.readSimVar}`;
  if (binding.readSimVar) return `→ ${binding.readSimVar}`;
  if (binding.writeEvent) return `⇄ ${binding.writeEvent}`;
  if (binding.stateVar) return `state: ${binding.stateVar}`;
  if (binding.stateRef) return `state: ${binding.stateRef}`;
  return 'Not bound';
}

/**
 * Summarizes a component's behavior: its interaction count, plus conditional visibility and a guard
 * when present.
 * @param {object} host Inspector facade (unused; kept for the shared delegate signature).
 * @param {object} comp Component whose `interactions`, `visibleWhen` and `layout.guard` are read.
 * @returns {string} For example `2 interactions · conditional visibility · guarded`.
 */
export function buildBehaviorBadge(host, comp) {
  const count = comp.interactions?.length || 0;
  const parts = [`${count} interaction${count === 1 ? '' : 's'}`];
  if (comp.visibleWhen) parts.push('conditional visibility');
  if (comp.layout?.guard) parts.push('guarded');
  return parts.join(' · ');
}

/**
 * Builds one accordion section. Its open state is seeded from `isOpenDefault` only the first time a
 * title is seen; afterwards the user's own expand/collapse choice, tracked in `expandedGroups`, wins on
 * every re-render. The section's "⋯ N more" link is not injected here (see `applyTierMoreBadges`).
 * @param {object} host Inspector facade providing `_sectionJsonData`, `knownGroupTitles`,
 *   `expandedGroups` and `tierOverrideGroups`.
 * @param {string} title Section title; it is also the key of every per-title set and record.
 * @param {boolean} isOpenDefault Whether the section starts expanded the first time it is seen.
 * @param {function(HTMLElement): void} renderFn Fills the section body; it runs before the body is
 *   attached to the group. Some callers pass an empty function and fill the body afterwards.
 * @param {string} [badge] Plain-text summary shown in the header whether the section is expanded or
 *   collapsed (see the `build*Badge` functions).
 * @param {*} [jsonData] The section's own underlying data for Full tier's "View JSON"; recorded in
 *   `host._sectionJsonData[title]` when not `undefined`, and rendered later by `applySectionJsonViews`.
 * @param {boolean} [nonCollapsible=false] For sections inside a tab: a simplified header without a
 *   chevron, and a body that is always open.
 * @returns {HTMLElement} The `.inspector-group` element, not yet attached. A collapsible header click
 *   toggles the body and updates `expandedGroups`.
 */
export function buildAccordionGroup(host, title, isOpenDefault, renderFn, badge, jsonData, nonCollapsible = false) {
  if (jsonData !== undefined) host._sectionJsonData[title] = jsonData;
  if (!host.knownGroupTitles.has(title)) {
    host.knownGroupTitles.add(title);
    if (isOpenDefault) host.expandedGroups.add(title);
  }
  const isOpen = host.expandedGroups.has(title);
  const isTierOverridden = host.tierOverrideGroups.has(title);

  const group = document.createElement('div');
  group.className = `inspector-group${isTierOverridden ? ' tier-override' : ''}${nonCollapsible ? ' non-collapsible' : ''}`;

  if (nonCollapsible) {
    const header = document.createElement('div');
    header.className = 'inspector-tab-section-header';
    header.innerHTML = `
        <span class="group-title-cluster">
          <span class="group-title">${title}</span>
          ${badge ? `<span class="group-badge">${escapeHtmlAttr(badge)}</span>` : ''}
        </span>
      `;
    group.appendChild(header);
  } else {
    const header = document.createElement('div');
    header.className = 'inspector-group-header';
    header.innerHTML = `
        <span class="group-title-cluster">
          <span class="group-title">${title}</span>
          ${badge ? `<span class="group-badge">${escapeHtmlAttr(badge)}</span>` : ''}
        </span>
        <svg class="group-chevron ${isOpen ? 'open' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
      `;

    header.addEventListener('click', () => {
      const nowOpen = !body.classList.contains('open');
      body.classList.toggle('open', nowOpen);
      body.classList.toggle('collapsed', !nowOpen);
      header.querySelector('.group-chevron')?.classList.toggle('open', nowOpen);
      if (nowOpen) host.expandedGroups.add(title);
      else host.expandedGroups.delete(title);
    });

    group.appendChild(header);
  }

  const body = document.createElement('div');
  body.className = nonCollapsible ? 'inspector-group-body open' : `inspector-group-body ${isOpen ? 'open' : 'collapsed'}`;

  renderFn(body);

  group.appendChild(body);
  return group;
}
