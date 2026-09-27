/**
 * @module AppearanceSection
 * The Property Inspector's APPEARANCE section for one component, and the theme-aware field engine it
 * shares with the multi-select Style tab. It renders the target strip (Normal, the one interaction
 * state the component type reads, `style.rules` chips, "+ Rule" and the Light/Dark Override chip),
 * copy/paste and style presets, orphaned `style.states` repairs, the active rule's condition, order,
 * removal and JSON editors, and then the Typography/Layout/Border/Background fields retargeted at the
 * selected storage location (`style.*`, `style.states.<name>.*` or `style.rules.<i>.style.*`).
 *
 * Every function takes the live Inspector `host` first and reads it at call time; the module holds no
 * state of its own. After construction it is the only writer of the host's `_styleTab`,
 * `_styleTabRuleIndex` and `_conditionalStyleJsonOpen` fields, except that the component render resets
 * `_styleTab` and `_styleTabRuleIndex` (with `_styleTabCompId`) when the selected component changes
 * identity. It reads `host.state.widgetDef`, `previewTheme` and `copiedStyle`, and calls
 * `host.state.updateComponent`, `copyComponentStyle`, `pasteStyleToComponent` and `setPreviewTheme`.
 * Field writes go through `host.commitField`, so the multi-select proxy fans them out to the whole
 * selection. Other host members are reached through their facade delegates (`render`,
 * `getThemeEditContext`, `renderAppearanceSection`, `remapAppearancePath`, `retargetAppearanceFields`,
 * `renderBaseThemeAwareAppearanceFields`, `renderRegistryFields`, `getFieldValue`, `toHexColor`,
 * `wireColorPair`, `openConditionEditorPopover` and `renderConditionListEditor`), so an instance-level
 * override still takes effect.
 *
 * Side effects: rendering a `core.label` that still carries `props.align` and has no `style.align.h`
 * queues one microtask that moves the value to `style.align.h` through `updateComponent`, during
 * render. Listeners (buttons, rule-chip click and drag-and-drop, selects and color pairs) live on DOM
 * that the next render discards. The rule condition popover and the Remove confirmation are awaited;
 * their modal lifecycles belong to `StudioModal`. DOM errors propagate to the caller.
 */

import { confirmModal, showToast } from '../../StudioModal.js';
import { reorderRules, summarizeCondition } from '../../InspectorLogic.js';
import { STYLE_PRESETS } from '../../StudioStylePresets.js';
import { COMMON_FIELDS as REGISTRY_COMMON_FIELDS, getStateStyleConfig } from '../../../widgets/PropertyRegistry.js';
import { themeAdjustColor, themeAdjustGradient } from '../../../widgets/components/ThemeColor.js';
import { GRADIENT_VALUE_RE, escapeHtmlAttr } from '../inspectorMarkup.js';

/**
 * FDWS v1.25: resolves the one interaction-state style entry (if any) this component's type and
 * variant read at runtime. `style.states.<name>` holds border/background/typography overrides merged
 * over the base style while the component is in that state (BaseComponent.applyStyles, and
 * applyOptionalStateStyle for multi-surface components). The table lives in
 * `PropertyRegistry.getStateStyleConfig`, shared with StudioValidator's cross-check.
 * @param {object} comp Component being edited.
 * @returns {{name: string, label: string, tabLabel: string} | null} The state entry, or null when the
 *   type has no state styling.
 */
function resolveStateStyleConfig(comp) {
  return getStateStyleConfig(comp.type, comp.props);
}

/**
 * The Appearance panel's field set, filtered from the registry's COMMON_FIELDS rather than hand-listed,
 * so a new common style field appears here automatically. It excludes the `style.rules` array entry
 * (a rule's own fields are these same rows, retargeted per rule), `style.states` (this section is its
 * editor) and `style.themeOverride.*` (reached through the Override chip's redirect on the Base target).
 * @returns {object[]} Registry field descriptors whose paths start with `style.`.
 */
function getAppearanceFieldSpecs() {
  return REGISTRY_COMMON_FIELDS.filter((f) =>
    f.path.startsWith('style.') &&
    f.path !== 'style.rules' &&
    f.path !== 'style.states' &&
    !f.path.startsWith('style.themeOverride.')
  );
}

/**
 * Renders the single-selection APPEARANCE body into `body`: the theme-override banner, copy/paste,
 * style presets, the target strip, orphaned-state repairs, the active rule's editors and the
 * retargeted field engine. `comp`, `def`, the component's style, its rules and the active rule are
 * captured at render time; handlers commit through `host.state.updateComponent` (one Undo entry each;
 * reorders use the `'Reorder Rule'` label, and a condition edit passes the editor's own history flag)
 * and most re-render the panel through `host.render()`. Removing the last rule stores `rules: undefined`.
 * @param {object} host Inspector facade (see the module notes for the members it uses).
 * @param {object} comp Selected component, captured for the handlers.
 * @param {object} def Widget definition read at render time (`def.state` feeds "+ Rule" and conditions).
 * @param {HTMLElement} body Empty container, already attached to the Appearance group, to fill.
 * @returns {void}
 */
export function renderComponentAppearance(host, comp, def, body) {
  const style = comp.style || {};
  const stateCfg = resolveStateStyleConfig(comp);
  // A style.states key that is not the one name this component type/variant reads (for example one
  // left behind by a Button Variant change) has no effect. StudioValidator reports the same condition
  // as a warning (its style.states cross-check); this section offers the repair inline.
  const orphanedStateKeys = style.states && typeof style.states === 'object'
    ? Object.keys(style.states).filter((k) => k !== stateCfg?.name)
    : [];
  const themeEdit = host.getThemeEditContext();
  const assets = host.state.widgetDef.assets || [];
  const stateVars = def.state || [];
  // Rule chips are a further target for the same field engine, alongside Normal and State. Every
  // component type supports style.rules (unlike interaction-state styling, which is per type), so
  // they render regardless of stateCfg.
  const rules = Array.isArray(style.rules) ? style.rules : [];
  const activeRuleIndex = (host._styleTabRuleIndex != null && host._styleTabRuleIndex < rules.length)
    ? host._styleTabRuleIndex : null;
  const activeRule = activeRuleIndex !== null ? rules[activeRuleIndex] : null;

  // The six color fields and the whole Background section are hand-coded on the Base target (see
  // renderAppearanceSection for why); these reads feed them. Every other Appearance field, on every
  // target, renders through renderAppearanceSection's generic per-target engine.
  const typo = style.typography || {};
  const border = style.border || {};
  const bg = style.background || {};
  const override = style.themeOverride || {};
  // With no stored override yet (for example a component added after the widget was switched to
  // Manual mode), the shown value is what auto-derivation would produce, not the raw base-theme value;
  // otherwise the color picker would show the dark-authored swatch while previewing light.
  const themeColorCtx = { componentType: comp.type, layerGroup: comp.layer?.group };
  const effTypoColor = themeEdit.isOverrideEdit
    ? (override.typography?.color ?? themeAdjustColor(typo.color, { ...themeColorCtx, colorKind: 'typography' }, host.state.previewTheme, themeEdit.baseTheme))
    : typo.color;
  const effBorderColor = themeEdit.isOverrideEdit
    ? (override.border?.color ?? themeAdjustColor(border.color, { ...themeColorCtx, colorKind: 'border' }, host.state.previewTheme, themeEdit.baseTheme))
    : border.color;
  const effBg = themeEdit.isOverrideEdit
    ? (override.background || (
        bg.type === 'color' && bg.color
          ? { ...bg, color: themeAdjustColor(bg.color, { ...themeColorCtx, colorKind: 'background' }, host.state.previewTheme, themeEdit.baseTheme) }
          : bg.type === 'gradient' && bg.gradient
            ? { ...bg, gradient: themeAdjustGradient(bg.gradient, themeColorCtx, host.state.previewTheme, themeEdit.baseTheme) }
            : bg
      ))
    : bg;
  // FDWS v1.29: the same isOverrideEdit redirect covers the other three color-valued style fields
  // (text outline, text glow, border glow).
  const effStrokeColor = themeEdit.isOverrideEdit
    ? (override.typography?.stroke?.color ?? themeAdjustColor(typo.stroke?.color, { ...themeColorCtx, colorKind: 'typography' }, host.state.previewTheme, themeEdit.baseTheme))
    : typo.stroke?.color;
  const effGlowColor = themeEdit.isOverrideEdit
    ? (override.typography?.glow?.color ?? themeAdjustColor(typo.glow?.color, { ...themeColorCtx, colorKind: 'typography' }, host.state.previewTheme, themeEdit.baseTheme))
    : typo.glow?.color;
  const effBorderGlowColor = themeEdit.isOverrideEdit
    ? (override.border?.glow?.color ?? themeAdjustColor(border.glow?.color, { ...themeColorCtx, colorKind: 'border' }, host.state.previewTheme, themeEdit.baseTheme))
    : border.glow?.color;

  // FDWS v1.8 §1.1: core.label's pre-v1.8 props.align (horizontal only) is superseded by the generic
  // style.align.h. When a label with the old field and no new one is opened here, it is migrated at
  // once (eager persistence) so the widget does not carry two competing alignment sources. The write
  // is queued as a microtask, so it runs after the current render returns.
  if (comp.type === 'core.label' && comp.props?.align && !style.align?.h) {
    queueMicrotask(() => {
      const { align: _drop, ...restProps } = comp.props || {};
      host.state.updateComponent(comp.id, {
        props: restProps,
        style: { ...(comp.style || {}), align: { ...(comp.style?.align || {}), h: comp.props.align } }
      });
    });
  }

  // "normal", the one state name this component supports, or a rule. A rule chip takes precedence
  // when set, since the rule index is only ever non-null through an explicit chip click or "+ Rule"
  // (the component render resets it when the selected component changes).
  const activeTab = activeRuleIndex !== null ? 'rule' : ((stateCfg && host._styleTab === 'state') ? 'state' : 'normal');

  // The active rule's condition uses the same shared one-level compound editor as Visible When
  // (renderConditionListEditor), including its JSON fallback for a hand-authored nested `when`.
  const ruleCondSummary = activeTab === 'rule' && activeRule ? summarizeCondition(activeRule.when) : '';
  const ruleJsonOpen = activeRuleIndex !== null && !!host._conditionalStyleJsonOpen?.[activeRuleIndex];
  // The Override chip toggles StudioState.previewTheme itself (the canvas header's sun/moon control)
  // rather than introducing a new target kind; see getThemeEditContext. It modifies the Base target
  // and is not a peer target: no state or rule field path consults themeEdit, because the runtime has
  // nowhere to put a themed variant of a state or rule.
  const otherTheme = themeEdit.baseTheme === 'light' ? 'dark' : 'light';

  body.innerHTML = `
        ${themeEdit.isOverrideEdit ? `<div class="theme-override-banner">Editing ${host.state.previewTheme.toUpperCase()} theme override — Text/Stroke/Glow/Border/Border Glow/Background Color apply only to this theme; other properties stay shared with the base ${themeEdit.baseTheme} style.</div>` : ''}
        <div class="prop-row-2" style="margin-bottom:4px;">
          <button type="button" id="c-style-copy" class="bar-btn">Copy Style</button>
          <button type="button" id="c-style-paste" class="bar-btn" ${host.state.copiedStyle ? '' : 'disabled'}>Paste Style</button>
        </div>

        <div class="prop-section-subtitle">Style Presets <span class="prop-hint" title="One-click starting points — applies typography, border, and background together, then leave every field below exactly as editable as before.">ⓘ</span></div>
        <div class="style-preset-strip">
          ${STYLE_PRESETS.map((p) => `
            <button type="button" class="style-preset-swatch" data-preset="${p.id}" title="${p.name}" style="--preset-bg:${p.swatch.bg};--preset-fg:${p.swatch.fg};--preset-border:${p.swatch.border};">
              <span class="style-preset-swatch-inner">Aa</span>
              <span class="style-preset-name">${p.name}</span>
            </button>
          `).join('')}
        </div>

        <div class="prop-row-2" style="margin:10px 0 12px;flex-wrap:wrap;gap:6px;">
          <button type="button" class="mode-toggle-btn ${activeTab === 'normal' ? 'active' : ''}" id="c-styletab-normal" style="flex:0 1 auto;">Normal</button>
          ${stateCfg ? `<button type="button" class="mode-toggle-btn ${activeTab === 'state' ? 'active' : ''}" id="c-styletab-state" data-testid="style-state-tab-${stateCfg.name}" style="flex:0 1 auto;">${stateCfg.tabLabel}</button>` : ''}
          ${rules.map((r, i) => `<button type="button" class="mode-toggle-btn ${activeRuleIndex === i ? 'active' : ''}" data-rule-chip="${i}" style="flex:0 1 auto;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="Rule ${i + 1} of ${rules.length} — ${escapeHtmlAttr(summarizeCondition(r.when))} (first matching rule wins)">${i + 1}. ${escapeHtmlAttr(summarizeCondition(r.when))}</button>`).join('')}
          <button type="button" class="mode-toggle-btn" id="c-styletab-addrule" style="flex:0 1 auto;" title="Add a conditional style rule">+ Rule</button>
          <span style="width:1px;align-self:stretch;background:var(--studio-panel-border);margin:0 2px;"></span>
          <button type="button" class="mode-toggle-btn ${themeEdit.isOverrideEdit ? 'active' : ''}" id="c-styletab-theme" style="flex:0 1 auto;" ${
        themeEdit.themeMode !== 'manual'
          ? `disabled title="This widget's Theme Mode is Auto — the ${otherTheme} theme is fully auto-derived. Switch Theme Mode to Manual (widget-root Theme settings) to author a separate override here."`
          : activeTab !== 'normal'
            ? `disabled title="Theme overrides apply to the Base style only — states and rules are already conditional."`
            : `title="Edit this component's ${otherTheme} theme override — Text/Stroke/Glow/Border/Border Glow/Background Color only."`
      }>${otherTheme.charAt(0).toUpperCase() + otherTheme.slice(1)} Override</button>
        </div>
        ${orphanedStateKeys.map((key) => {
      const canMigrate = !!stateCfg?.name && style.states[stateCfg.name] === undefined;
      return `
          <div class="prop-hint-block" style="font-size:11px;margin-bottom:8px;border-left:2px solid var(--accent-red, #ef4444);padding-left:8px;">
            <div>⚠ style.states.${escapeHtmlAttr(key)} has no effect — ${stateCfg?.name ? `this component only reads style.states.${escapeHtmlAttr(stateCfg.name)}.` : 'this component type has no interaction-state style support at all.'}</div>
            <div style="margin-top:4px;display:flex;gap:8px;align-items:center;">
              ${stateCfg?.name ? (canMigrate
            ? `<button type="button" class="btn-small" data-orphan-migrate="${escapeHtmlAttr(key)}">Migrate to ${escapeHtmlAttr(stateCfg.name)}</button>`
            : `<span class="prop-hint" title="style.states.${escapeHtmlAttr(stateCfg.name)} already has its own data — migrating would overwrite it.">Migrate unavailable ⓘ</span>`
          ) : ''}
              <button type="button" class="btn-small" data-orphan-delete="${escapeHtmlAttr(key)}">Delete</button>
            </div>
          </div>
          `;
    }).join('')}
        ${activeTab === 'state' ? `<div class="prop-hint-block" style="font-size:11px;opacity:0.7;margin-bottom:8px;">Overrides merged over the base style while this component is ${stateCfg.tabLabel.toLowerCase()}. Fields with an accent left border are overridden for this state; click the 'x' icon to clear an override.</div>` : ''}
        ${activeTab === 'rule' ? `
        <div class="prop-hint-block" style="font-size:11px;opacity:0.7;margin-bottom:8px;">Overrides merged over the base style whenever this rule's condition is true — first matching rule wins over lower rules and over Normal. Dimmed fields are inherited from the Normal style, same as a state.</div>
        <div class="prop-section-subtitle" style="margin-top:0;">Condition <span class="prop-hint" title="Same condition grammar as Visible When — a rule here only changes the STYLE, never whether the component shows at all.">ⓘ</span></div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px;">
          <div style="flex:1;padding:6px 8px;background:var(--studio-panel-bg);border:1px solid var(--studio-panel-border);border-radius:3px;font-size:12px;color:var(--studio-text-secondary);">${escapeHtmlAttr(ruleCondSummary)}</div>
          <button type="button" id="rule-edit-condition" class="bar-btn" title="Edit condition in popover">Edit</button>
        </div>
        <div class="prop-row-2" style="margin-bottom:8px;flex-wrap:wrap;">
          <button type="button" id="c-rule-move-up" class="bar-btn" ${activeRuleIndex === 0 ? 'disabled' : ''} title="Move this rule earlier — first matching rule wins, so earlier rules take priority">▲ Move Up</button>
          <button type="button" id="c-rule-move-down" class="bar-btn" ${activeRuleIndex === rules.length - 1 ? 'disabled' : ''} title="Move this rule later">▼ Move Down</button>
          <button type="button" id="c-rule-remove" class="bar-btn">Remove This Rule</button>
          <button type="button" id="c-rule-json-toggle" class="bar-btn">${ruleJsonOpen ? 'Hide' : 'Advanced'} JSON</button>
        </div>
        <div class="${ruleJsonOpen ? '' : 'hidden'}" style="margin-bottom:10px;">
          <textarea id="c-rule-json" class="prop-input" rows="4">${escapeHtmlAttr(JSON.stringify(activeRule?.style || {}, null, 0))}</textarea>
          <div id="c-rule-json-error" class="prop-json-error hidden"></div>
        </div>
        ` : ''}

        <div id="c-appearance-fields"></div>
      `;

  for (const btn of body.querySelectorAll('.style-preset-swatch')) {
    btn.addEventListener('click', () => {
      const preset = STYLE_PRESETS.find((p) => p.id === btn.dataset.preset);
      if (!preset) return;
      host.state.updateComponent(comp.id, { style: { ...(comp.style || {}), ...preset.style } });
      showToast(`Applied "${preset.name}" style — still fully editable below.`);
    });
  }

  body.querySelector('#c-style-copy')?.addEventListener('click', () => {
    const stateKey = activeTab === 'state' ? stateCfg.name : undefined;
    const ruleIndex = activeTab === 'rule' ? activeRuleIndex : undefined;
    host.state.copyComponentStyle(comp.id, stateKey, ruleIndex);
    const stateLabel = stateKey ? ` (${stateCfg.tabLabel})` : (ruleIndex != null ? ` (Rule ${ruleIndex + 1})` : '');
    showToast(`Copied${stateLabel} style from "${comp.label || comp.id}".`);
    host.render();
  });
  body.querySelector('#c-style-paste')?.addEventListener('click', () => {
    const stateKey = activeTab === 'state' ? stateCfg.name : undefined;
    const ruleIndex = activeTab === 'rule' ? activeRuleIndex : undefined;
    host.state.pasteStyleToComponent(comp.id, stateKey, ruleIndex);
    const stateLabel = stateKey ? ` (${stateCfg.tabLabel})` : (ruleIndex != null ? ` (Rule ${ruleIndex + 1})` : '');
    showToast(`Pasted${stateLabel} style onto "${comp.label || comp.id}".`);
  });

  // FDWS v1.25: the Normal/<state> toggle re-renders the whole panel, because
  // renderAppearanceSection only builds the active target's fields.
  body.querySelector('#c-styletab-normal')?.addEventListener('click', () => {
    host._styleTab = 'normal';
    host._styleTabRuleIndex = null;
    host.render();
  });
  body.querySelector('#c-styletab-state')?.addEventListener('click', () => {
    host._styleTab = 'state';
    host._styleTabRuleIndex = null;
    host.render();
  });
  // Rule chips and "+ Rule".
  for (const btn of body.querySelectorAll('[data-rule-chip]')) {
    btn.addEventListener('click', () => {
      host._styleTabRuleIndex = Number(btn.dataset.ruleChip);
      host.render();
    });
    // Drag-and-drop reordering lets the author set rule precedence directly,
    // since the first matching rule wins.
    btn.draggable = true;
    btn.addEventListener('dragstart', (e) => {
      const fromIndex = Number(btn.dataset.ruleChip);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(fromIndex));
    });
    btn.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      btn.style.opacity = '0.7';
    });
    btn.addEventListener('dragleave', () => {
      btn.style.opacity = '';
    });
    btn.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromIndex = Number(e.dataTransfer.getData('text/plain'));
      const toIndex = Number(btn.dataset.ruleChip);
      btn.style.opacity = '';
      if (fromIndex !== toIndex && fromIndex >= 0 && toIndex >= 0) {
        const nextRules = reorderRules(rules, fromIndex, toIndex);
        host._styleTabRuleIndex = toIndex;
        host.state.updateComponent(comp.id, { style: { ...(comp.style || {}), rules: nextRules } }, true, 'Reorder Rule');
        host.render();
      }
    });
    btn.addEventListener('dragend', () => {
      for (const chip of body.querySelectorAll('[data-rule-chip]')) chip.style.opacity = '';
    });
  }
  body.querySelector('#c-styletab-addrule')?.addEventListener('click', () => {
    const nextRules = [...rules, { when: { state: stateVars[0]?.name || '', equals: '' }, style: { typography: { color: '#f87171' } } }];
    host._styleTabRuleIndex = nextRules.length - 1;
    host.state.updateComponent(comp.id, { style: { ...(comp.style || {}), rules: nextRules } });
    host.render();
  });
  // Migrate or delete an orphaned style.states key.
  for (const btn of body.querySelectorAll('[data-orphan-migrate]')) {
    btn.addEventListener('click', () => {
      const key = btn.dataset.orphanMigrate;
      const states = { ...(style.states || {}) };
      states[stateCfg.name] = states[key];
      delete states[key];
      host.state.updateComponent(comp.id, { style: { ...style, states } });
    });
  }
  for (const btn of body.querySelectorAll('[data-orphan-delete]')) {
    btn.addEventListener('click', () => {
      const key = btn.dataset.orphanDelete;
      const states = { ...(style.states || {}) };
      delete states[key];
      host.state.updateComponent(comp.id, { style: { ...style, states } });
    });
  }
  // Flips the same live-preview toggle the canvas header's sun/moon button drives. The Inspector
  // subscribes to PREVIEW_THEME_CHANGED, so the panel (including the banner and the redirect in
  // renderBaseThemeAwareAppearanceFields, gated on themeEdit.isOverrideEdit) re-renders without a
  // render() call here. The native `disabled` attribute, set whenever a State or Rule target is
  // active or the theme mode is Auto, keeps this handler from firing then.
  body.querySelector('#c-styletab-theme')?.addEventListener('click', () => {
    host.state.setPreviewTheme(themeEdit.isOverrideEdit ? themeEdit.baseTheme : otherTheme);
  });

  if (activeTab === 'rule' && activeRule) {
    // Edit opens the shared condition popover. Each edit commits at once and re-renders the popover;
    // `comp` is live after updateComponent, so later edits read the rules just written.
    body.querySelector('#rule-edit-condition')?.addEventListener('click', async () => {
      await host.openConditionEditorPopover('Edit Rule Condition', (rerender) =>
        host.renderConditionListEditor(
          comp, def, (comp.style?.rules || rules)[activeRuleIndex]?.when || null, 'rulecond',
          (nextValue, recordHistory = true) => {
            const nextRules = [...(comp.style?.rules || rules)];
            nextRules[activeRuleIndex] = { ...nextRules[activeRuleIndex], when: nextValue };
            host.state.updateComponent(comp.id, { style: { ...(comp.style || {}), rules: nextRules } }, recordHistory);
            rerender();
          }
        )
      );
    });

    // Rules are first-match-wins (resolveActiveRuleStyle), so order matters: a two-threshold gauge
    // authored amber-then-red never reaches red unless red comes first. Rules have no stable id
    // (an indexed array only), so this swaps by index and commits through the same updateComponent
    // call as add and remove, rather than a separate state-layer method.
    const moveRule = (delta) => {
      const to = activeRuleIndex + delta;
      if (to < 0 || to >= rules.length) return;
      const nextRules = [...rules];
      [nextRules[activeRuleIndex], nextRules[to]] = [nextRules[to], nextRules[activeRuleIndex]];
      host._styleTabRuleIndex = to;
      host.state.updateComponent(comp.id, { style: { ...(comp.style || {}), rules: nextRules } }, true, 'Reorder Rule');
      host.render();
    };
    body.querySelector('#c-rule-move-up')?.addEventListener('click', () => moveRule(-1));
    body.querySelector('#c-rule-move-down')?.addEventListener('click', () => moveRule(1));

    body.querySelector('#c-rule-remove')?.addEventListener('click', async () => {
      const ok = await confirmModal(`Remove this rule (${escapeHtmlAttr(summarizeCondition(activeRule.when))})?`, { title: 'Remove Rule', danger: true });
      if (!ok) return;
      const nextRules = rules.filter((_, i) => i !== activeRuleIndex);
      host._styleTabRuleIndex = null;
      host.state.updateComponent(comp.id, { style: { ...(comp.style || {}), rules: nextRules.length ? nextRules : undefined } });
      host.render();
    });

    body.querySelector('#c-rule-json-toggle')?.addEventListener('click', () => {
      host._conditionalStyleJsonOpen = host._conditionalStyleJsonOpen || {};
      host._conditionalStyleJsonOpen[activeRuleIndex] = !host._conditionalStyleJsonOpen[activeRuleIndex];
      host.render();
    });
    body.querySelector('#c-rule-json')?.addEventListener('change', (e) => {
      try {
        const parsedStyle = JSON.parse(e.target.value);
        const nextRules = [...rules];
        nextRules[activeRuleIndex] = { when: activeRule.when, style: parsedStyle };
        body.querySelector('#c-rule-json-error')?.classList.add('hidden');
        host.state.updateComponent(comp.id, { style: { ...(comp.style || {}), rules: nextRules } });
      } catch (err) {
        const errEl = body.querySelector('#c-rule-json-error');
        if (errEl) {
          errEl.textContent = `Invalid JSON — edit not applied: ${err.message}`;
          errEl.classList.remove('hidden');
        }
      }
    });
  }

  const target = activeTab === 'rule' ? { kind: 'rule', index: activeRuleIndex }
    : activeTab === 'state' ? { kind: 'state', name: stateCfg.name }
    : { kind: 'base' };
  host.renderAppearanceSection(comp, body.querySelector('#c-appearance-fields'), target, { themeEdit, effTypoColor, effBorderColor, effBg, effStrokeColor, effGlowColor, effBorderGlowColor, assets });
}

/**
 * FDWS v1.18: resolves whether the override-eligible color and background fields currently read and
 * write the widget's base style (`style.*`) or its Manual theme override (`style.themeOverride.*`).
 * The Live Theme Preview toggle (`StudioState.previewTheme`, the canvas header's sun/moon button)
 * says which theme is being looked at: when the widget is in Manual mode and the preview shows the
 * non-base theme, those fields target the override. Also used by the widget root and multi-select.
 * @param {object} host Inspector facade providing `state.widgetDef` and `state.previewTheme`.
 * @returns {{baseTheme:'dark'|'light', themeMode:'auto'|'manual', isOverrideEdit:boolean}} A missing
 *   or unknown base theme reads as `dark` and any theme mode other than `manual` as `auto`.
 */
export function getThemeEditContext(host) {
  const def = host.state.widgetDef;
  const baseTheme = def.baseTheme === 'light' ? 'light' : 'dark';
  const themeMode = def.themeMode === 'manual' ? 'manual' : 'auto';
  return { baseTheme, themeMode, isOverrideEdit: themeMode === 'manual' && host.state.previewTheme !== baseTheme };
}

/**
 * Rewrites one Appearance field path from Base storage (`style.*`) onto another target's storage.
 * Shared by retargetAppearanceFields and the group-level override indicators so they cannot drift.
 * @param {object} host Unused by this pure conversion; retained to keep the facade delegate signature uniform.
 * @param {string} path A `style.`-prefixed path; any other path is returned unchanged.
 * @param {{kind: 'base'} | {kind: 'state', name: string} | {kind: 'rule', index: number}} target
 *   `base` is a no-op, `state` maps to `style.states.<name>.` and `rule` to `style.rules.<index>.style.`.
 * @returns {string} The retargeted path.
 */
export function remapAppearancePath(host, path, target) {
  if (target.kind === 'state') return path.replace(/^style\./, `style.states.${target.name}.`);
  if (target.kind === 'rule') return path.replace(/^style\./, `style.rules.${target.index}.style.`);
  return path;
}

/**
 * Remaps an Appearance field list from Base storage onto another target's storage through
 * `host.remapAppearancePath`, applied to `path` and, if present, `showWhen.path`. Each clone keeps the
 * base path as `originalPath` (used for `style-field-*` test ids and compound-group matching) and gets
 * `inheritedValue`: the live value at the base path, which resolveEffectiveValue and evaluateShowWhen
 * use to show a dimmed inherited value and to gate on what the field resolves to without an override
 * here. A rule's inherited value is the literal Base value, not a full base→state→rule runtime
 * preview, because which state is concurrently active cannot be known from the Inspector's UI state.
 * @param {object} host Inspector facade providing `remapAppearancePath` and `getFieldValue`.
 * @param {object} comp Component whose Base values are inherited.
 * @param {object[]} fields Registry field descriptors with Base paths.
 * @param {object} target Retarget descriptor, as for remapAppearancePath.
 * @returns {object[]} The same array for a `base` target; otherwise new shallow field clones.
 */
export function retargetAppearanceFields(host, comp, fields, target) {
  if (target.kind === 'base') return fields;
  return fields.map((f) => ({
    ...f,
    originalPath: f.path,
    path: host.remapAppearancePath(f.path, target),
    showWhen: f.showWhen ? { ...f.showWhen, path: host.remapAppearancePath(f.showWhen.path, target) } : undefined,
    inheritedValue: host.getFieldValue(comp, f.path)
  }));
}

/**
 * The unified Appearance field renderer: one field list (getAppearanceFieldSpecs, from COMMON_FIELDS)
 * retargeted at whichever storage location `target` names. It renders up to four registry groups in
 * the order Typography, Layout, Border, Background, each under its own subtitle; a group with no
 * fields for the target is skipped, except Background on Base.
 *
 * On the Base target, Text, Stroke, Glow, Border and Border Glow Color and the whole Background group
 * are hand-coded by renderBaseThemeAwareAppearanceFields, because Manual theme mode (FDWS v1.18,
 * widened in v1.29 to stroke, glow and border glow) redirects their writes to `style.themeOverride.*`
 * while every other Appearance field always writes to `style.*`. The generic engine's commitField has
 * no per-field write redirect, and `style.themeOverride` only applies to the base style (the runtime
 * reads it only from the base style object), so the split exists only on Base.
 *
 * On a state or rule target, an overridden Outline, Glow or Border Glow sub-object gets a group-level
 * indicator whose clear button commits `undefined` at the sub-object path; its leaf fields are then
 * passed to renderRegistryFields as covered, so they do not show their own clear icons.
 * @param {object} host Inspector facade (field engine, path helpers and `commitField`).
 * @param {object} comp Component, or the multi-select style proxy, being edited.
 * @param {HTMLElement} mount Container; its contents are replaced.
 * @param {object} target Retarget descriptor, as for remapAppearancePath.
 * @param {object} baseThemeCtx Context for the Base-only hand-coded fields (see
 *   renderBaseThemeAwareAppearanceFields); unused on other targets.
 * @returns {void}
 */
export function renderAppearanceSection(host, comp, mount, target, baseThemeCtx) {
  mount.innerHTML = '';
  const allFields = getAppearanceFieldSpecs();
  const groupOrder = ['Typography', 'Layout', 'Border', 'Background'];
  // Nested sub-objects that a state or rule can override (and clear) as a whole:
  // [basePath, label, the leaf field paths under it].
  const CLEARABLE_SUB_OBJECTS = {
    Typography: [
      ['style.typography.stroke', 'Outline', ['style.typography.stroke.width', 'style.typography.stroke.color']],
      ['style.typography.glow', 'Glow', ['style.typography.glow.color', 'style.typography.glow.blur']]
    ],
    Border: [
      ['style.border.glow', 'Border Glow', ['style.border.glow.color', 'style.border.glow.blur', 'style.border.glow.inset']]
    ]
  };
  for (const groupName of groupOrder) {
    let groupFields = allFields.filter((f) => f.group === groupName);
    if (target.kind === 'base') {
      // FDWS v1.29: stroke.color, glow.color and border.glow.color join typography.color and
      // border.color as Base-only hand-coded fields (see renderBaseThemeAwareAppearanceFields) so
      // Manual theme mode can redirect their writes to style.themeOverride.*. stroke.width,
      // glow.blur and border.glow.inset are not colors and stay generic here.
      if (groupName === 'Typography') groupFields = groupFields.filter((f) => f.path !== 'style.typography.color' && f.path !== 'style.typography.stroke.color' && f.path !== 'style.typography.glow.color');
      if (groupName === 'Border') groupFields = groupFields.filter((f) => f.path !== 'style.border.color' && f.path !== 'style.border.glow.color');
      if (groupName === 'Background') groupFields = [];
    }
    if (!groupFields.length && !(target.kind === 'base' && groupName === 'Background')) continue;
    const subtitle = document.createElement('div');
    subtitle.className = 'prop-section-subtitle';
    subtitle.style.marginTop = '10px';
    subtitle.textContent = groupName;
    mount.appendChild(subtitle);
    const groupMount = mount.appendChild(document.createElement('div'));

    // Group-level override indicators for the Outline, Glow and Border Glow sub-objects.
    const isOverridable = target.kind === 'state' || target.kind === 'rule';
    const groupCoveredPaths = new Set(); // Leaf paths covered by a group-level indicator
    if (isOverridable) {
      const subObjsForGroup = CLEARABLE_SUB_OBJECTS[groupName] || [];
      const overriddenSubObjs = [];

      for (const [basePath, label, leafPaths] of subObjsForGroup) {
        const targetPath = host.remapAppearancePath(basePath, target);
        const isOverridden = host.getFieldValue(comp, targetPath) !== undefined;
        if (isOverridden) {
          overriddenSubObjs.push({ basePath, label, targetPath, leafPaths });
          // Map leaf paths to their remapped versions and add them to the covered set.
          for (const leafPath of leafPaths) {
            const remappedLeaf = host.remapAppearancePath(leafPath, target);
            groupCoveredPaths.add(remappedLeaf);
          }
        }
      }

      // Render group-level override indicators.
      for (const { basePath, label, targetPath } of overriddenSubObjs) {
        const groupIndicator = document.createElement('div');
        groupIndicator.className = 'prop-field is-overridden-group';
        groupIndicator.setAttribute('data-testid', `override-indicator-group-${basePath.replace(/\./g, '-')}`);

        const labelSpan = document.createElement('span');
        labelSpan.style.fontWeight = '600';
        labelSpan.style.fontSize = '10px';
        labelSpan.style.color = 'var(--text-label)';
        labelSpan.textContent = `${label}`;

        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'override-group-clear-icon';
        clearBtn.setAttribute('data-testid', `clear-override-group-${basePath.replace(/\./g, '-')}`);
        clearBtn.innerHTML = '✕';
        clearBtn.title = `Clear ${label} override`;
        clearBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          host.commitField(comp, targetPath, undefined);
        });

        groupIndicator.appendChild(labelSpan);
        groupIndicator.appendChild(clearBtn);
        groupMount.appendChild(groupIndicator);
      }
    }

    const fieldsMount = groupMount.appendChild(document.createElement('div'));
    if (groupFields.length) {
      host.renderRegistryFields(comp, fieldsMount, host.retargetAppearanceFields(comp, groupFields, target), target, groupCoveredPaths);
    }
    if (target.kind === 'base' && (groupName === 'Typography' || groupName === 'Border' || groupName === 'Background')) {
      host.renderBaseThemeAwareAppearanceFields(comp, groupName, groupMount.appendChild(document.createElement('div')), baseThemeCtx);
    }
  }
}

/**
 * Renders the Base-target fields kept out of the generic engine (see renderAppearanceSection): Text,
 * Stroke and Glow Color for Typography, Border and Border Glow Color for Border, and the whole
 * Background group (type, color, gradient and image asset/fit/position). Each shows an `eff*` value
 * from `ctx` and writes through a `ctx.themeEdit.isOverrideEdit`-gated writer: to
 * `style.themeOverride.*` while editing the Manual override, otherwise to `style.*`. Every write is a
 * `host.commitField` leaf commit, so the same fields work unchanged on the multi-select proxy.
 * Switching Background Type seeds a sensible value, and a gradient entered in Background Color
 * switches the type to CSS Gradient, shows a toast and re-renders.
 * @param {object} host Inspector facade providing `commitField`, `toHexColor`, `wireColorPair` and `render`.
 * @param {object} comp Component, or the multi-select style proxy; its current background is read at render.
 * @param {'Typography' | 'Border' | 'Background'} groupName Which hand-coded group to render; any
 *   other value renders the Background group.
 * @param {HTMLElement} mount Container; its contents are replaced.
 * @param {{themeEdit: object, effTypoColor?: string, effBorderColor?: string, effBg: object,
 *   effStrokeColor?: string, effGlowColor?: string, effBorderGlowColor?: string, assets: object[]}} ctx
 *   Theme-edit context, effective values to display and the widget's assets.
 * @returns {void}
 */
export function renderBaseThemeAwareAppearanceFields(host, comp, groupName, mount, ctx) {
  const { themeEdit, effTypoColor, effBorderColor, effBg, effStrokeColor, effGlowColor, effBorderGlowColor, assets } = ctx;
  // Every writer commits through commitField (a single nested-path leaf). Its clone-splice keeps every
  // sibling key for a single component, and it fans out to the whole selection when comp.__multiSelect
  // is set, so these fields also work unchanged on the multi-select Style tab's proxy.
  const updateStyle = (updates) => {
    for (const [key, val] of Object.entries(updates)) host.commitField(comp, `style.${key}`, val);
  };
  const updateOverride = (field, updates) => {
    for (const [key, val] of Object.entries(updates)) host.commitField(comp, `style.themeOverride.${field}.${key}`, val);
  };
  const updateOverrideBackground = (nextBg) => {
    host.commitField(comp, 'style.themeOverride.background', nextBg);
  };
  // FDWS v1.29: the stroke and glow siblings of updateOverride, one level deeper
  // (themeOverride.typography.stroke.color, themeOverride.typography.glow.color and
  // themeOverride.border.glow.color). Kept separate so updateOverride's Text Color and Border Color
  // callers do not need a third path segment.
  const updateOverrideNested = (field, subKey, updates) => {
    for (const [key, val] of Object.entries(updates)) host.commitField(comp, `style.themeOverride.${field}.${subKey}.${key}`, val);
  };

  if (groupName === 'Typography') {
    // These hand-coded color fields carry the same `style-field-<path>` test id convention as
    // buildFieldWrap (used by the generic rendering of the same paths on state and rule targets), so
    // applyMultiSelectFieldAvailability's `[data-testid^="style-field-"]` selector reaches and
    // disables them too.
    mount.innerHTML = `
        <div class="prop-field" data-testid="style-field-typography.color">
          <label>Text Color</label>
          <div class="color-picker-wrap">
            <button type="button" class="color-swatch" id="c-typo-color-pick" data-color="${host.toHexColor(effTypoColor) || '#f8fafc'}" style="background:${host.toHexColor(effTypoColor) || '#f8fafc'}" aria-label="Pick color"></button>
            <input type="text" id="c-typo-color" class="prop-input" value="${escapeHtmlAttr(effTypoColor || '#f8fafc')}" />
          </div>
        </div>
        <div class="prop-field" data-testid="style-field-typography.stroke.color">
          <label title="Text outline color. Leave unset for none.">Stroke Color</label>
          <div class="color-picker-wrap">
            <button type="button" class="color-swatch" id="c-typo-stroke-color-pick" data-color="${host.toHexColor(effStrokeColor) || '#000000'}" style="background:${host.toHexColor(effStrokeColor) || '#000000'}" aria-label="Pick color"></button>
            <input type="text" id="c-typo-stroke-color" class="prop-input" value="${escapeHtmlAttr(effStrokeColor || '')}" placeholder="none" />
          </div>
        </div>
        <div class="prop-field" data-testid="style-field-typography.glow.color">
          <label title="Text glow/bloom color. Leave unset for none.">Glow Color</label>
          <div class="color-picker-wrap">
            <button type="button" class="color-swatch" id="c-typo-glow-color-pick" data-color="${host.toHexColor(effGlowColor) || '#000000'}" style="background:${host.toHexColor(effGlowColor) || '#000000'}" aria-label="Pick color"></button>
            <input type="text" id="c-typo-glow-color" class="prop-input" value="${escapeHtmlAttr(effGlowColor || '')}" placeholder="none" />
          </div>
        </div>
      `;
    // Commits the single leaf (commitField's nested-clone splice keeps every sibling key) instead of
    // spreading comp.style?.typography into a whole replacement object: that spread, read off the
    // multi-select proxy's common-merged style, would blank any sibling typography field the selected
    // components do not agree on.
    const setTypoColor = (color) => themeEdit.isOverrideEdit
      ? updateOverride('typography', { color })
      : host.commitField(comp, 'style.typography.color', color);
    host.wireColorPair(mount, 'c-typo-color-pick', 'c-typo-color', setTypoColor);
    const setStrokeColor = (color) => themeEdit.isOverrideEdit
      ? updateOverrideNested('typography', 'stroke', { color })
      : host.commitField(comp, 'style.typography.stroke.color', color);
    host.wireColorPair(mount, 'c-typo-stroke-color-pick', 'c-typo-stroke-color', setStrokeColor);
    const setGlowColor = (color) => themeEdit.isOverrideEdit
      ? updateOverrideNested('typography', 'glow', { color })
      : host.commitField(comp, 'style.typography.glow.color', color);
    host.wireColorPair(mount, 'c-typo-glow-color-pick', 'c-typo-glow-color', setGlowColor);
    return;
  }

  if (groupName === 'Border') {
    mount.innerHTML = `
        <div class="prop-field" data-testid="style-field-border.color">
          <label>Border Color</label>
          <div class="color-picker-wrap">
            <button type="button" class="color-swatch" id="c-border-color-pick" data-color="${host.toHexColor(effBorderColor) || '#273344'}" style="background:${host.toHexColor(effBorderColor) || '#273344'}" aria-label="Pick color"></button>
            <input type="text" id="c-border-color" class="prop-input" value="${escapeHtmlAttr(effBorderColor || '#273344')}" />
          </div>
        </div>
        <div class="prop-field" data-testid="style-field-border.glow.color">
          <label title="Soft glow around the border. Leave unset for none.">Border Glow Color</label>
          <div class="color-picker-wrap">
            <button type="button" class="color-swatch" id="c-border-glow-color-pick" data-color="${host.toHexColor(effBorderGlowColor) || '#000000'}" style="background:${host.toHexColor(effBorderGlowColor) || '#000000'}" aria-label="Pick color"></button>
            <input type="text" id="c-border-glow-color" class="prop-input" value="${escapeHtmlAttr(effBorderGlowColor || '')}" placeholder="none" />
          </div>
        </div>
      `;
    const setBorderColor = (color) => themeEdit.isOverrideEdit
      ? updateOverride('border', { color })
      : host.commitField(comp, 'style.border.color', color);
    host.wireColorPair(mount, 'c-border-color-pick', 'c-border-color', setBorderColor);
    const setBorderGlowColor = (color) => themeEdit.isOverrideEdit
      ? updateOverrideNested('border', 'glow', { color })
      : host.commitField(comp, 'style.border.glow.color', color);
    host.wireColorPair(mount, 'c-border-glow-color-pick', 'c-border-glow-color', setBorderGlowColor);
    return;
  }

  // Background: the whole group, hand-coded (type, color, gradient, image). It keeps two conveniences
  // that the generic engine's showWhen-only gating does not reproduce, gradient-paste detection and
  // seeding a sensible value on a type switch. State and rule targets render Background generically,
  // without them.
  const setBg = themeEdit.isOverrideEdit ? updateOverrideBackground : (nextBg) => updateStyle({ background: nextBg });
  const curBg = themeEdit.isOverrideEdit ? (comp.style?.themeOverride?.background || {}) : (comp.style?.background || {});
  // Each hand-coded Background wrap carries the matching `style-field-background.*` test id, for the
  // same reason as the Typography and Border color fields above.
  mount.innerHTML = `
      <div class="prop-field" data-testid="style-field-background.type">
        <label>Background Type</label>
        <select id="c-bg-type" class="prop-select">
          <option value="none" ${effBg.type === 'none' ? 'selected' : ''}>None (Transparent)</option>
          <option value="color" ${(!effBg.type || effBg.type === 'color') ? 'selected' : ''}>Solid Color</option>
          <option value="gradient" ${effBg.type === 'gradient' ? 'selected' : ''}>CSS Gradient</option>
          <option value="image" ${effBg.type === 'image' ? 'selected' : ''}>Image (Asset Library)</option>
        </select>
      </div>
      <div id="c-bg-color-field" class="prop-field" data-testid="style-field-background.color" style="${(!effBg.type || effBg.type === 'color') ? '' : 'display:none;'}">
        <label>Background Color</label>
        <div class="color-picker-wrap">
          <button type="button" class="color-swatch" id="c-bg-color-pick" data-color="${host.toHexColor(effBg.color) || '#131b26'}" style="background:${host.toHexColor(effBg.color) || '#131b26'}" aria-label="Pick color"></button>
          <input type="text" id="c-bg-color" class="prop-input" value="${escapeHtmlAttr(effBg.color || '#131b26')}" />
        </div>
      </div>
      <div id="c-bg-gradient-field" class="prop-field" data-testid="style-field-background.gradient" style="${effBg.type === 'gradient' ? '' : 'display:none;'}">
        <label>CSS Gradient</label>
        <input type="text" id="c-bg-gradient" class="prop-input" value="${escapeHtmlAttr(effBg.gradient || '')}" placeholder="linear-gradient(180deg, #1a2332, #0b0f17)" />
      </div>
      <div id="c-bg-image-fields" style="${effBg.type === 'image' ? '' : 'display:none;'}">
        <div class="prop-field" data-testid="style-field-background.image.assetId">
          <label>Image <span class="prop-hint" title="FDWS v1.8 background.image, already fully supported at runtime. Add images on the Assets tab first. For a switch/control that looks different per position, use Conditional Formatting (below) to swap this per state instead of picking one fixed image here.">ⓘ</span></label>
          <select id="c-bg-image-asset" class="prop-select">
            <option value="">— none —</option>
            ${assets.map((a) => `<option value="${escapeHtmlAttr(a.id)}" ${effBg.image?.assetId === a.id ? 'selected' : ''}>${escapeHtmlAttr(a.id)} (${escapeHtmlAttr(a.mimeType)})</option>`).join('')}
          </select>
          ${assets.length === 0 ? '<div class="caps-empty">No assets uploaded yet — add one on the Assets tab.</div>' : ''}
        </div>
        <div class="prop-row-2">
          <div class="prop-field" data-testid="style-field-background.image.fit">
            <label>Fit</label>
            <select id="c-bg-image-fit" class="prop-select">
              <option value="cover" ${(!effBg.image?.fit || effBg.image?.fit === 'cover') ? 'selected' : ''}>Cover</option>
              <option value="contain" ${effBg.image?.fit === 'contain' ? 'selected' : ''}>Contain</option>
              <option value="tile" ${effBg.image?.fit === 'tile' ? 'selected' : ''}>Tile</option>
            </select>
          </div>
          <div class="prop-field" data-testid="style-field-background.image.position">
            <label>Position</label>
            <input type="text" id="c-bg-image-position" class="prop-input" value="${escapeHtmlAttr(effBg.image?.position || '')}" placeholder="center" />
          </div>
        </div>
      </div>
    `;
  mount.querySelector('#c-bg-type')?.addEventListener('change', (e) => {
    const type = e.target.value;
    mount.querySelector('#c-bg-color-field').style.display = type === 'color' ? '' : 'none';
    mount.querySelector('#c-bg-gradient-field').style.display = type === 'gradient' ? '' : 'none';
    mount.querySelector('#c-bg-image-fields').style.display = type === 'image' ? '' : 'none';
    if (type === 'none') setBg({ type: 'none' });
    else if (type === 'color') setBg({ type: 'color', color: curBg.color || '#131b26' });
    else if (type === 'gradient') setBg({ type: 'gradient', gradient: curBg.gradient || 'linear-gradient(180deg, #1a2332, #0b0f17)' });
    else if (type === 'image') setBg({ type: 'image', image: { assetId: curBg.image?.assetId || assets[0]?.id || '' } });
  });
  host.wireColorPair(mount, 'c-bg-color-pick', 'c-bg-color', (value) => {
    if (GRADIENT_VALUE_RE.test(value.trim())) {
      setBg({ type: 'gradient', gradient: value.trim() });
      showToast('That looks like a CSS gradient, not a color — switched Background Type to "CSS Gradient" so it stays theme-aware.');
      host.render();
      return;
    }
    setBg({ type: 'color', color: value });
  }, { allowGradient: true });
  mount.querySelector('#c-bg-gradient')?.addEventListener('change', (e) => setBg({ type: 'gradient', gradient: e.target.value }));
  const updateBgImage = (updates) => {
    const nextImage = { ...(curBg.image || {}), ...updates };
    setBg({ type: 'image', image: nextImage });
  };
  mount.querySelector('#c-bg-image-asset')?.addEventListener('change', (e) => updateBgImage({ assetId: e.target.value }));
  mount.querySelector('#c-bg-image-fit')?.addEventListener('change', (e) => updateBgImage({ fit: e.target.value }));
  mount.querySelector('#c-bg-image-position')?.addEventListener('change', (e) => updateBgImage({ position: e.target.value || undefined }));
}
