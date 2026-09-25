/**
 * @module MultiSelectInspector
 *
 * Renders and supports multi-selection in the Inspector. The live
 * `StudioInspector` host owns transient Inspector view state, while StudioState
 * owns selection, component data and history. Rendering reads
 * `host.state.multiSelectedIds`, calls `host.state.getComponent`, reads
 * `host.state.copiedStyle`, `copiedStateKey`, `copiedRuleScoped`,
 * `previewTheme` and `widgetDef.assets`. Render coordination stores the
 * selection key and active sub-tab only on the host's `_multiStyleTabKey` and
 * `_multiStyleTab` fields. The synthetic proxy presents common style values
 * to the shared field renderer; field writes continue through
 * `host.commitField` and its existing `__multiSelect` fan-out to
 * `StudioState.applyFieldToSelection`.
 *
 * The renderer calls the host's `buildInspectorTabShell`,
 * `buildMultiSelectStyleProxy`, `getThemeEditContext`,
 * `renderAppearanceSection`, `applyMultiSelectFieldAvailability` and `render`
 * methods. Preset and paste actions call `host.state.applyStyleToSelection`
 * and `host.state.pasteStyleToSelection`; their toasts use `showToast`. It
 * appends DOM to `host.container` and attaches preset, paste and sub-tab
 * listeners to that DOM. `renderInner` owns discarding the DOM on later
 * renders, so the module adds no subscription, timer, modal, or separate
 * cleanup path.
 */

import { getMultiSelectAvailability } from '../InspectorLogic.js';
import { showToast } from '../StudioModal.js';
import { STYLE_PRESETS } from '../StudioStylePresets.js';

/**
 * Builds a synthetic component whose nested style contains only values shared
 * by every selected component. Object branches merge recursively; a scalar,
 * array, or nullish disagreement becomes `undefined`, so existing field
 * rendering uses its normal default. The returned identity fields mark the
 * proxy for `host.commitField` without giving it ownership of real component
 * styles.
 *
 * @param {object} host - The live Inspector host retained by the host-first module contract; this pure merge does not inspect it.
 * @param {Array<object>} realComps - The selected components whose styles are merged.
 * @returns {object} A synthetic component with common style values and the `__multiSelect` marker.
 * @throws {TypeError} Propagates when a leaf value cannot be JSON-stringified.
 */
export function buildMultiSelectStyleProxy(host, realComps) {
  const mergeCommon = (vals) => {
    const allObjects = vals.every((v) => v && typeof v === 'object' && !Array.isArray(v));
    if (allObjects) {
      const keys = new Set();
      for (const value of vals) {
        for (const key of Object.keys(value)) keys.add(key);
      }
      const result = {};
      for (const key of keys) {
        const merged = mergeCommon(vals.map((value) => value[key]));
        if (merged !== undefined) result[key] = merged;
      }
      return result;
    }
    const [first, ...rest] = vals;
    return rest.every((value) => JSON.stringify(value) === JSON.stringify(first)) ? first : undefined;
  };

  return {
    id: '__multiselect__',
    type: realComps[0]?.type,
    label: `${realComps.length} components`,
    __multiSelect: true,
    style: mergeCommon(realComps.map((comp) => comp.style || {})) || {},
    props: {},
    binding: {},
    layer: {}
  };
}

/**
 * Disables each rendered style wrapper whose original `style.*` path is not
 * in the type-intersection availability list. Wrappers stay in the DOM so
 * the Author can see which fields are unsupported by part of the selection.
 *
 * @param {object} host - The live Inspector host retained by the host-first module contract; DOM availability is supplied explicitly.
 * @param {HTMLElement} mount - The rendered multi-selection Style panel.
 * @param {{enabledFieldPaths: string[]}} availability - Paths supported by all selected component types.
 * @returns {void} Adds the disabled class and disables descendant form controls in unsupported wrappers.
 * @throws {TypeError} Propagates when the mount or availability list does not satisfy its DOM and array contracts.
 */
export function applyMultiSelectFieldAvailability(host, mount, availability) {
  for (const wrap of mount.querySelectorAll('[data-testid^="style-field-"]')) {
    const suffix = wrap.getAttribute('data-testid').replace('style-field-', '');
    if (availability.enabledFieldPaths.includes(`style.${suffix}`)) continue;
    wrap.classList.add('prop-field-multiselect-disabled');
    for (const element of wrap.querySelectorAll('input, select, textarea, button')) {
      element.disabled = true;
    }
  }
}

/**
 * Renders the forced Style tab for a multi-selection through the shared
 * appearance and field engine. A new sorted selection key resets its own
 * Base/State choice to Normal. The State sub-tab exists only when the
 * selected types and variants resolve to the same alternate state; Rule
 * editing stays single-component because rule arrays have no shared index
 * semantics across a selection.
 *
 * @param {object} host - The live Inspector instance and owner of render state.
 * @returns {void} Appends the header and tab shell, renders common fields, and wires preset, paste, and sub-tab actions.
 * @throws {Error} Propagates exceptions from DOM operations or host/state collaborators.
 */
export function renderMultiSelectInspector(host) {
  const ids = [...host.state.multiSelectedIds];
  const comps = ids.map((id) => host.state.getComponent(id)).filter(Boolean);

  // A new selection identity starts on Normal, matching single-selection target changes.
  const selectionKey = ids.slice().sort().join(',');
  if (host._multiStyleTabKey !== selectionKey) {
    host._multiStyleTabKey = selectionKey;
    host._multiStyleTab = 'normal';
  }

  const header = document.createElement('div');
  header.className = 'inspector-header';
  header.innerHTML = `
      <div class="inspector-title-row">
        <span class="inspector-badge">${comps.length} SELECTED</span>
        <h3 class="inspector-title">Multiple Components</h3>
      </div>
      <div class="inspector-sub">${comps.map((comp) => comp.id).join(', ')}</div>
    `;
  host.container.appendChild(header);

  const { tabBar, panelsContainer, panels } = host.buildInspectorTabShell({
    disabledTabs: ['general', 'data', 'events'],
    forceActiveTab: 'style'
  });
  host.container.appendChild(tabBar);
  host.container.appendChild(panelsContainer);

  const availability = getMultiSelectAvailability(comps);
  const proxyComp = host.buildMultiSelectStyleProxy(comps);
  const activeTab = (availability.stateTabName && host._multiStyleTab === 'state') ? 'state' : 'normal';
  const themeEdit = host.getThemeEditContext();

  const styleBody = panels.style.appendChild(document.createElement('div'));
  const canPasteBase = !!host.state.copiedStyle && !host.state.copiedStateKey && !host.state.copiedRuleScoped;
  const canPaste = activeTab === 'state' ? !!host.state.copiedStyle : canPasteBase;
  styleBody.innerHTML = `
      ${themeEdit.isOverrideEdit ? `<div class="theme-override-banner">Editing ${host.state.previewTheme.toUpperCase()} theme override — Text/Stroke/Glow/Border/Border Glow/Background Color apply only to this theme; other properties stay shared with the base ${themeEdit.baseTheme} style.</div>` : ''}
      <div class="empty-tree-notice">Editing ${comps.length} selected components. Fields below apply to every one of them; a greyed-out field isn't supported by every selected component's type.</div>

      <button type="button" id="ms-style-paste" class="panel-full-btn" style="margin-top:8px;" ${canPaste ? '' : 'disabled'}>
        ${activeTab === 'state'
          ? `Paste ${availability.stateTabLabel || 'State'} Style onto All ${comps.length}`
          : canPasteBase
            ? `Paste Copied Style onto All ${comps.length} (replaces each one's full style)`
            : host.state.copiedStateKey
              ? 'Paste Style — state-scoped copy needs a matching State sub-tab active above'
              : host.state.copiedRuleScoped
                ? 'Paste Style — rule-scoped copy has no matching Rule sub-tab here; copy the full style instead'
                : 'Paste Style — copy a style from a single component\'s panel first'}
      </button>

      <div class="prop-section-subtitle" style="margin-top:10px;">Style Presets <span class="prop-hint" title="Applies typography, border, and background together to every selected component, then leaves every field below exactly as editable as before.">ⓘ</span></div>
      <div class="style-preset-strip">
        ${STYLE_PRESETS.map((preset) => `
          <button type="button" class="style-preset-swatch" data-preset="${preset.id}" title="${preset.name}" style="--preset-bg:${preset.swatch.bg};--preset-fg:${preset.swatch.fg};--preset-border:${preset.swatch.border};">
            <span class="style-preset-swatch-inner">Aa</span>
            <span class="style-preset-name">${preset.name}</span>
          </button>
        `).join('')}
      </div>

      ${availability.stateTabName ? `
      <div class="prop-row-2" style="margin:10px 0 12px;flex-wrap:wrap;gap:6px;">
        <button type="button" class="mode-toggle-btn ${activeTab === 'normal' ? 'active' : ''}" id="ms-styletab-normal" style="flex:0 1 auto;">Normal</button>
        <button type="button" class="mode-toggle-btn ${activeTab === 'state' ? 'active' : ''}" id="ms-styletab-state" data-testid="style-state-tab-${availability.stateTabName}" style="flex:0 1 auto;">${availability.stateTabLabel || 'State'}</button>
      </div>
      ${activeTab === 'state' ? `<div class="prop-hint-block" style="font-size:11px;opacity:0.7;margin-bottom:8px;">Overrides merged over the base style while ${comps.length > 1 ? 'these components are' : 'this component is'} ${(availability.stateTabLabel || 'in this state').toLowerCase()} — applied identically to all ${comps.length} selected. Fields with an accent left border are overridden for this state.</div>` : ''}
      ` : ''}

      <div id="ms-appearance-fields"></div>
    `;

  for (const button of styleBody.querySelectorAll('.style-preset-swatch')) {
    button.addEventListener('click', () => {
      const preset = STYLE_PRESETS.find((item) => item.id === button.dataset.preset);
      if (!preset) return;
      host.state.applyStyleToSelection(preset.style);
      showToast(`Applied "${preset.name}" style to ${comps.length} components — still fully editable below.`);
    });
  }

  styleBody.querySelector('#ms-style-paste')?.addEventListener('click', () => {
    const stateKey = activeTab === 'state' ? availability.stateTabName : undefined;
    host.state.pasteStyleToSelection(stateKey);
    showToast(`Pasted${stateKey ? ` ${availability.stateTabLabel}` : ''} style onto ${comps.length} components.`);
  });

  styleBody.querySelector('#ms-styletab-normal')?.addEventListener('click', () => {
    host._multiStyleTab = 'normal';
    host.render();
  });
  styleBody.querySelector('#ms-styletab-state')?.addEventListener('click', () => {
    host._multiStyleTab = 'state';
    host.render();
  });

  const target = activeTab === 'state' ? { kind: 'state', name: availability.stateTabName } : { kind: 'base' };
  const style = proxyComp.style;
  const typography = style.typography || {};
  const border = style.border || {};
  const background = style.background || {};
  const baseThemeCtx = {
    themeEdit,
    effTypoColor: typography.color,
    effBorderColor: border.color,
    effBg: background,
    effStrokeColor: typography.stroke?.color,
    effGlowColor: typography.glow?.color,
    effBorderGlowColor: border.glow?.color,
    assets: host.state.widgetDef.assets || []
  };
  host.renderAppearanceSection(proxyComp, styleBody.querySelector('#ms-appearance-fields'), target, baseThemeCtx);

  host.applyMultiSelectFieldAvailability(styleBody, availability);
}
