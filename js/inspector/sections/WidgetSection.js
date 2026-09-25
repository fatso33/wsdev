/**
 * @module WidgetSection
 * Renders the widget-root Inspector tabs, metadata, layout, canvas style, theme, declared Deck Events,
 * capabilities and unrecognised definition fields. It also owns the Full JSON modal's submit callback.
 * StudioInspector remains the owner of tier, expansion state, tab selection, the container and the
 * render lifecycle; StudioState remains the owner of definition data, validation, notifications and
 * history. This module creates no parallel store or persistent lifecycle resource.
 *
 * The renderer reads the current definition and preview theme, calls the host's tab, accordion, theme,
 * color-pair, render and unrecognised-property delegates, and writes through StudioState's existing
 * metadata, layout, style, theme, Deck Event, notification and raw-field methods. Some handlers retain
 * render-time definition/theme values; style write helpers reread the live definition to preserve nested
 * updates. The asynchronous Deck Event modal validates names against the live definition before adding
 * a row. Render listeners stay on the current DOM and are discarded by the next host render.
 *
 * StudioModal owns both overlays, document keydown listeners and modal removal. Its submit validation
 * failures remain in the modal; JSON parsing errors are displayed to the user, invalid shapes are
 * rejected, and state-writer exceptions propagate. Cancelling either modal makes no definition write.
 */

import { DECK_EVENT_NAMES } from '../../../core/deckEvents.js';
import { themeAdjustColor, themeAdjustGradient } from '../../../widgets/components/ThemeColor.js';
import { openModal, showToast } from '../../StudioModal.js';
import { StudioValidator, findUnrecognisedDefPaths } from '../../StudioValidator.js';
import { GRADIENT_VALUE_RE, escapeHtmlAttr } from '../inspectorMarkup.js';

/**
 * Renders the widget-root Inspector into the host container, retaining the existing tab, accordion and
 * state-writer contracts. Metadata identity values remain at the top level through StudioState, while
 * the displayed defaults and theme override redirects preserve the authored definition semantics.
 * @param {object} host Live Inspector facade providing `state.widgetDef`, `state.previewTheme`,
 *   `uiTier`, `container`, `buildInspectorTabShell`, `buildAccordionGroup`, `getThemeEditContext`,
 *   `toHexColor`, `wireColorPair`, `render`, `openFullJsonPanel` and
 *   `renderUnrecognisedPropertiesBlock`.
 * @returns {void} Appends the root panels and registers listeners on their current DOM nodes.
 */
export function renderWidgetInspector(host) {
  const def = host.state.widgetDef;

  // Header
  const header = document.createElement('div');
  header.className = 'inspector-header';
  header.innerHTML = `
    <div class="inspector-title-row">
      <span class="inspector-badge">WIDGET</span>
      <h3 class="inspector-title">${def.meta?.name || 'Untitled Widget'}</h3>
      ${host.uiTier === 'full' ? '<button type="button" class="bar-btn" id="btn-full-json">{ } Full JSON</button>' : ''}
    </div>
    <div class="inspector-sub">${def.id || 'com.flightdeck.widget'} (FDWS v${def.fdws || '1.1'})</div>
  `;
  host.container.appendChild(header);
  header.querySelector('#btn-full-json')?.addEventListener('click', () => host.openFullJsonPanel());

  // Keep the same tab shell used by component panels.
  const { tabBar, panelsContainer, panels } = host.buildInspectorTabShell();
  host.container.appendChild(tabBar);
  host.container.appendChild(panelsContainer);

  // Group 1: Metadata & Identification
  panels.general.appendChild(host.buildAccordionGroup('METADATA & SPECIFICATION', true, (body) => {
    body.innerHTML = `
      <div class="prop-field">
        <label>Display Name (Title)</label>
        <input type="text" id="w-meta-name" class="prop-input" value="${def.meta?.name || ''}" placeholder="e.g. NAV 1 Radio" />
      </div>
      <div class="prop-row-2" data-tier="build">
        <div class="prop-field">
          <label>Short Name</label>
          <input type="text" id="w-meta-short" class="prop-input" value="${def.meta?.shortName || ''}" placeholder="NAV1" />
        </div>
        <div class="prop-field">
          <label>Category</label>
          <select id="w-meta-category" class="prop-select">
            <option value="Avionics" ${def.meta?.category === 'Avionics' ? 'selected' : ''}>Avionics</option>
            <option value="Controls" ${def.meta?.category === 'Controls' ? 'selected' : ''}>Controls</option>
            <option value="Gauges" ${def.meta?.category === 'Gauges' ? 'selected' : ''}>Gauges</option>
            <option value="Alerts" ${def.meta?.category === 'Alerts' ? 'selected' : ''}>Alerts</option>
            <option value="Utilities" ${def.meta?.category === 'Utilities' ? 'selected' : ''}>Utilities</option>
          </select>
        </div>
      </div>
      <div class="prop-field" data-tier="build">
        <label>Package ID (Reverse-DNS)</label>
        <input type="text" id="w-id" class="prop-input" value="${def.id || ''}" placeholder="com.author.widgetname" />
      </div>
      <div class="prop-row-2" data-tier="build">
        <div class="prop-field">
          <label>Revision</label>
          <input type="number" id="w-revision" class="prop-input" value="${def.revision || 1}" min="1" />
        </div>
        <div class="prop-field">
          <label>Author</label>
          <input type="text" id="w-author" class="prop-input" value="${def.meta?.author || ''}" placeholder="Author Name" />
        </div>
      </div>
      <div class="prop-field" data-tier="build">
        <label>Description</label>
        <textarea id="w-desc" class="prop-textarea" rows="2" placeholder="Brief widget description...">${def.meta?.description || ''}</textarea>
      </div>
    `;

    body.querySelector('#w-meta-name')?.addEventListener('change', (e) => host.state.updateWidgetMeta({ name: e.target.value }));
    body.querySelector('#w-meta-short')?.addEventListener('change', (e) => host.state.updateWidgetMeta({ shortName: e.target.value }));
    body.querySelector('#w-meta-category')?.addEventListener('change', (e) => host.state.updateWidgetMeta({ category: e.target.value }));
    body.querySelector('#w-id')?.addEventListener('change', (e) => host.state.updateWidgetMeta({ id: e.target.value }));
    body.querySelector('#w-revision')?.addEventListener('change', (e) => host.state.updateWidgetMeta({ revision: Number.parseInt(e.target.value, 10) || 1 }));
    body.querySelector('#w-author')?.addEventListener('change', (e) => host.state.updateWidgetMeta({ author: e.target.value }));
    body.querySelector('#w-desc')?.addEventListener('change', (e) => host.state.updateWidgetMeta({ description: e.target.value }));
  }, undefined, {
    // ID and revision are special-cased by updateWidgetMeta, so include both
    // top-level values in the Full-tier section snapshot with the meta fields.
    name: def.meta?.name, shortName: def.meta?.shortName, category: def.meta?.category,
    id: def.id, revision: def.revision, author: def.meta?.author, description: def.meta?.description
  }));

  // Group 2: Grid Layout & Sizing
  panels.general.appendChild(host.buildAccordionGroup('GRID & DIMENSIONS', false, (body) => {
    const layout = def.layout || {};
    const grid = layout.grid || { columns: 12, rows: 6 };

    body.innerHTML = `
      <div class="prop-section-subtitle" data-tier="build">Internal Sub-Grid</div>
      <div class="prop-row-2" data-tier="build">
        <div class="prop-field">
          <label>Sub-Grid Columns</label>
          <input type="number" id="w-grid-cols" class="prop-input" value="${grid.columns || 12}" min="2" max="64" />
        </div>
        <div class="prop-field">
          <label>Sub-Grid Rows</label>
          <input type="number" id="w-grid-rows" class="prop-input" value="${grid.rows || 6}" min="2" max="64" />
        </div>
      </div>

      <div class="prop-section-subtitle" style="margin-top:10px;" data-tier="build">Page Slot Footprint (Columns × Rows)</div>
      <div class="prop-row-2" data-tier="build">
        <div class="prop-field">
          <label>Default Width (W)</label>
          <input type="number" id="w-def-w" class="prop-input" value="${layout.defaultW || 8}" min="1" max="44" />
        </div>
        <div class="prop-field">
          <label>Default Height (H)</label>
          <input type="number" id="w-def-h" class="prop-input" value="${layout.defaultH || 4}" min="1" max="44" />
        </div>
      </div>
      <div class="prop-row-2" data-tier="advanced">
        <div class="prop-field">
          <label>Min Size (W × H)</label>
          <div style="display:flex;gap:4px;">
            <input type="number" id="w-min-w" class="prop-input" value="${layout.minW || 4}" min="1" placeholder="Min W" />
            <input type="number" id="w-min-h" class="prop-input" value="${layout.minH || 2}" min="1" placeholder="Min H" />
          </div>
        </div>
        <div class="prop-field">
          <label>Max Size (W × H)</label>
          <div style="display:flex;gap:4px;">
            <input type="number" id="w-max-w" class="prop-input" value="${layout.maxW || 44}" min="1" placeholder="Max W" />
            <input type="number" id="w-max-h" class="prop-input" value="${layout.maxH || 44}" min="1" placeholder="Max H" />
          </div>
        </div>
      </div>
    `;

    body.querySelector('#w-grid-cols')?.addEventListener('change', (e) => {
      host.state.updateWidgetLayout({ grid: { columns: Number.parseInt(e.target.value, 10) || 12, rows: grid.rows } });
    });
    body.querySelector('#w-grid-rows')?.addEventListener('change', (e) => {
      host.state.updateWidgetLayout({ grid: { columns: grid.columns, rows: Number.parseInt(e.target.value, 10) || 6 } });
    });
    body.querySelector('#w-def-w')?.addEventListener('change', (e) => host.state.updateWidgetLayout({ defaultW: Number.parseInt(e.target.value, 10) || 8 }));
    body.querySelector('#w-def-h')?.addEventListener('change', (e) => host.state.updateWidgetLayout({ defaultH: Number.parseInt(e.target.value, 10) || 4 }));
    body.querySelector('#w-min-w')?.addEventListener('change', (e) => host.state.updateWidgetLayout({ minW: Number.parseInt(e.target.value, 10) || 4 }));
    body.querySelector('#w-min-h')?.addEventListener('change', (e) => host.state.updateWidgetLayout({ minH: Number.parseInt(e.target.value, 10) || 2 }));
    body.querySelector('#w-max-w')?.addEventListener('change', (e) => host.state.updateWidgetLayout({ maxW: Number.parseInt(e.target.value, 10) || 44 }));
    body.querySelector('#w-max-h')?.addEventListener('change', (e) => host.state.updateWidgetLayout({ maxH: Number.parseInt(e.target.value, 10) || 44 }));
  }, undefined, def.layout || {}));

  // Group 3: Widget Canvas Appearance & Border
  panels.style.appendChild(host.buildAccordionGroup('CANVAS APPEARANCE & BORDER', false, (body) => {
    const style = def.style || {};
    const border = style.border || { width: 1, color: '#1f2937', radius: 10 };
    const bg = style.background || { type: 'color', color: '#0b0f17' };
    const themeEdit = host.getThemeEditContext();
    // In Manual mode's non-base preview, color and background edits target
    // themeOverride; border geometry remains authored on the base theme.
    const override = style.themeOverride || {};
    const rootColorCtx = { componentType: 'widget-root', layerGroup: 'background' };
    const effBorderColor = themeEdit.isOverrideEdit
      ? (override.border?.color ?? themeAdjustColor(border.color, { ...rootColorCtx, colorKind: 'border' }, host.state.previewTheme, themeEdit.baseTheme))
      : border.color;
    const effBg = themeEdit.isOverrideEdit
      ? (override.background || (
          bg.type === 'color' && bg.color
            ? { ...bg, color: themeAdjustColor(bg.color, { ...rootColorCtx, colorKind: 'background' }, host.state.previewTheme, themeEdit.baseTheme) }
            : bg.type === 'gradient' && bg.gradient
              ? { ...bg, gradient: themeAdjustGradient(bg.gradient, rootColorCtx, host.state.previewTheme, themeEdit.baseTheme) }
              : bg
        ))
      : bg;

    body.innerHTML = `
      ${themeEdit.isOverrideEdit ? `<div class="theme-override-banner">Editing ${host.state.previewTheme.toUpperCase()} theme override</div>` : ''}
      <div class="prop-row-2" data-tier="build">
        <div class="prop-field">
          <label>Border Width (px)</label>
          <input type="number" id="w-border-w" class="prop-input" value="${border.width ?? 1}" min="0" max="10" ${themeEdit.isOverrideEdit ? 'disabled title="Structural — edit on the base theme."' : ''} />
        </div>
        <div class="prop-field">
          <label>Corner Radius (px)</label>
          <input type="number" id="w-border-rad" class="prop-input" value="${border.radius ?? 10}" min="0" max="24" ${themeEdit.isOverrideEdit ? 'disabled title="Structural — edit on the base theme."' : ''} />
        </div>
      </div>
      <div class="prop-field" data-tier="build">
        <label>Border Color</label>
        <div class="color-picker-wrap">
          <button type="button" class="color-swatch" id="w-border-clr-pick" data-color="${host.toHexColor(effBorderColor) || '#1f2937'}" style="background:${host.toHexColor(effBorderColor) || '#1f2937'}" aria-label="Pick color"></button>
          <input type="text" id="w-border-clr-txt" class="prop-input" value="${effBorderColor || '#1f2937'}" />
        </div>
      </div>

      <div class="prop-field" style="margin-top:10px;" data-tier="build">
        <label>Background Type</label>
        <select id="w-bg-type" class="prop-select">
          <option value="color" ${effBg.type === 'color' ? 'selected' : ''}>Solid Color</option>
          <option value="gradient" ${effBg.type === 'gradient' ? 'selected' : ''}>CSS Gradient</option>
          <option value="image" ${effBg.type === 'image' ? 'selected' : ''}>Embedded Asset Image</option>
        </select>
      </div>
      <div id="w-bg-custom-field" class="prop-field" data-tier="build">
        <label>Background Value</label>
        ${effBg.type === 'color' ? `
          <div class="color-picker-wrap">
            <button type="button" class="color-swatch" id="w-bg-val-pick" data-color="${host.toHexColor(effBg.color) || '#0b0f17'}" style="background:${host.toHexColor(effBg.color) || '#0b0f17'}" aria-label="Pick color"></button>
            <input type="text" id="w-bg-val" class="prop-input" value="${effBg.color || '#0b0f17'}" />
          </div>
        ` : `
          <input type="text" id="w-bg-val" class="prop-input" value="${effBg.gradient || effBg.image?.assetId || ''}" />
        `}
      </div>
    `;

    const updateBorder = (updates) => {
      const curBorder = host.state.widgetDef.style?.border || {};
      host.state.updateWidgetStyle({ border: { ...curBorder, ...updates } });
    };
    const updateBorderColor = (color) => {
      if (themeEdit.isOverrideEdit) {
        const curOverride = host.state.widgetDef.style?.themeOverride || {};
        host.state.updateWidgetStyle({ themeOverride: { ...curOverride, border: { ...(curOverride.border || {}), color } } });
      } else {
        updateBorder({ color });
      }
    };
    const updateBg = (nextBg) => {
      if (themeEdit.isOverrideEdit) {
        const curOverride = host.state.widgetDef.style?.themeOverride || {};
        host.state.updateWidgetStyle({ themeOverride: { ...curOverride, background: nextBg } });
      } else {
        host.state.updateWidgetStyle({ background: nextBg });
      }
    };

    body.querySelector('#w-border-w')?.addEventListener('change', (e) => updateBorder({ width: Number.parseInt(e.target.value, 10) || 0 }));
    body.querySelector('#w-border-rad')?.addEventListener('change', (e) => updateBorder({ radius: Number.parseInt(e.target.value, 10) || 0 }));
    host.wireColorPair(body, 'w-border-clr-pick', 'w-border-clr-txt', updateBorderColor);

    body.querySelector('#w-bg-type')?.addEventListener('change', (e) => {
      const type = e.target.value;
      if (type === 'color') updateBg({ type: 'color', color: '#0b0f17' });
      if (type === 'gradient') updateBg({ type: 'gradient', gradient: 'linear-gradient(180deg, #141a24 0%, #0b0f17 100%)' });
      if (type === 'image') updateBg({ type: 'image', image: { assetId: host.state.widgetDef.assets?.[0]?.id || '' } });
    });

    // The value field represents a color, gradient or asset id. Only a color
    // has a paired swatch; gradients and asset IDs commit as plain text.
    const bgValApplyFn = (value) => {
      const bgType = body.querySelector('#w-bg-type').value;
      if (bgType === 'color' && GRADIENT_VALUE_RE.test(value.trim())) {
        updateBg({ type: 'gradient', gradient: value.trim() });
        showToast('That looks like a CSS gradient, not a color — switched Background Type to "CSS Gradient" so it stays theme-aware.');
        host.render();
        return;
      }
      if (bgType === 'color') updateBg({ type: 'color', color: value });
      if (bgType === 'gradient') updateBg({ type: 'gradient', gradient: value });
      if (bgType === 'image') updateBg({ type: 'image', image: { assetId: value } });
    };
    if (effBg.type === 'color') {
      host.wireColorPair(body, 'w-bg-val-pick', 'w-bg-val', bgValApplyFn, { allowGradient: true });
    } else {
      body.querySelector('#w-bg-val')?.addEventListener('change', (e) => bgValApplyFn(e.target.value));
    }
  }, undefined, def.style || {}));

  // The base theme identifies the authored style; Manual mode exposes the
  // other theme through style.themeOverride.
  panels.style.appendChild(host.buildAccordionGroup('THEME', false, (body) => {
    const baseTheme = def.baseTheme === 'light' ? 'light' : 'dark';
    const themeMode = def.themeMode === 'manual' ? 'manual' : 'auto';
    const otherTheme = baseTheme === 'light' ? 'dark' : 'light';

    body.innerHTML = `
      <div class="prop-field" data-tier="build">
        <label>Designed For <span class="prop-hint" title="Which theme this widget's style properties are literally authored for. Every component's style.* is that theme's color — switching this does NOT recolor anything, it just changes which theme is treated as the base.">ⓘ</span></label>
        <select id="w-theme-base" class="prop-select">
          <option value="dark" ${baseTheme === 'dark' ? 'selected' : ''}>Dark</option>
          <option value="light" ${baseTheme === 'light' ? 'selected' : ''}>Light</option>
        </select>
      </div>
      <div class="prop-field" data-tier="advanced">
        <label>${otherTheme === 'light' ? 'Light' : 'Dark'} Theme <span class="prop-hint" title="Auto: the app's dark/light switcher derives this theme's colors automatically from the ones above. Manual: author it yourself, field by field, per component.">ⓘ</span></label>
        <select id="w-theme-mode" class="prop-select">
          <option value="auto" ${themeMode === 'auto' ? 'selected' : ''}>Auto-derive</option>
          <option value="manual" ${themeMode === 'manual' ? 'selected' : ''}>Manual</option>
        </select>
      </div>
      ${themeMode === 'manual' ? `
        <div class="empty-tree-notice" style="margin-top:8px;" data-tier="advanced">
          Switch the canvas's Live Theme Preview (sun/moon button) to <strong>${otherTheme}</strong> to edit that theme's colors — every component's Text/Stroke/Glow/Border/Border Glow/Background Color fields will target the ${otherTheme} override instead of the base ${baseTheme} style. New components start from an auto-derived ${otherTheme} color you can then adjust.
        </div>
      ` : ''}
    `;

    body.querySelector('#w-theme-base')?.addEventListener('change', (e) => {
      host.state.updateWidgetThemeConfig({ baseTheme: e.target.value });
      host.render();
    });
    body.querySelector('#w-theme-mode')?.addEventListener('change', (e) => {
      host.state.updateWidgetThemeConfig({ themeMode: e.target.value });
      showToast(e.target.value === 'manual'
        ? `Manual mode on — every component's ${otherTheme}-theme colors were seeded from the current auto-derived values.`
        : `${otherTheme === 'light' ? 'Light' : 'Dark'} theme is auto-derived again.`);
      host.render();
    });
  }, undefined, { baseTheme: def.baseTheme, themeMode: def.themeMode }));

  // Add empty Data tab message
  const dataEmpty = document.createElement('div');
  dataEmpty.className = 'empty-tree-notice';
  dataEmpty.style.padding = '16px';
  dataEmpty.textContent = 'No properties available';
  panels.data.appendChild(dataEmpty);

  // Declared widget Deck Events carry their default read/write mapping suggestions.
  panels.events.appendChild(host.buildAccordionGroup('DECK EVENTS (v1.27)', false, (body) => {
    const events = def.deckEvents || [];
    // Declaring custom events for profile mapping is advanced work, so one
    // outer tier wrapper hides the complete section together.
    body.innerHTML = `
      <div data-tier="advanced">
      <p class="prop-help">
        Names this widget binds to, plus the SimVar/event each should map to by
        default. PC Bridge copies a suggestion into its profile table on
        install, so the widget arrives working instead of leaving empty rows.
        A row the user later edits is never overwritten by an update.
      </p>
      <p class="prop-help">
        Namespace custom names with a dot — <code>fenix.xpndrIdent</code> — so
        two authors can each define an "xpndrIdent" without colliding. A name
        matching a built-in Deck Event is rejected on import.
      </p>
      <div id="de-list"></div>
      <button id="de-add" class="panel-full-btn" style="margin-top:8px;">+ Declare a Deck Event</button>
      </div>
    `;

    const list = body.querySelector('#de-list');
    if (!events.length) {
      list.innerHTML = '<div class="caps-empty" style="padding:6px 0;">None declared.</div>';
    }
    events.forEach((ev, i) => {
      const row = document.createElement('div');
      row.className = 'de-row';
      const isRead = ev.kind === 'read';
      row.innerHTML = `
        <div class="de-row-head">
          <span class="caps-tag ${isRead ? 'read' : 'write'}">${isRead ? 'READ' : 'WRITE'}</span>
          <strong>${ev.name || '(unnamed)'}</strong>
          <button type="button" class="btn-mini-close" data-de-del="${i}" title="Remove">✕</button>
        </div>
        <div class="de-row-sub">${ev.label || ev.name || ''}${ev.category ? ` · ${ev.category}` : ''}</div>
        <div class="de-row-sub">${
          isRead
            ? (ev.suggest?.simvar ? `→ ${ev.suggest.simvar}${ev.suggest.unit ? ` / ${ev.suggest.unit}` : ''}` : '→ no suggested binding')
            : (ev.suggest?.event ? `⇄ ${ev.suggest.event}${ev.suggest.valueFormat ? ` / ${ev.suggest.valueFormat}` : ''}` : '⇄ no suggested binding')
        }</div>
      `;
      list.appendChild(row);
    });

    for (const btn of body.querySelectorAll('[data-de-del]')) {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.deDel);
        const next = (host.state.widgetDef.deckEvents || []).slice();
        next.splice(idx, 1);
        host.state.setDeckEvents(next);
        host.render();
      });
    }

    body.querySelector('#de-add')?.addEventListener('click', async () => {
      const result = await openModal({
        title: 'Declare a Deck Event',
        submitLabel: 'Add',
        bodyHtml: `
          <div class="modal-form-row"><label>Name</label>
            <input type="text" id="de-name" class="prop-input" placeholder="fenix.xpndrIdent" /></div>
          <div class="modal-form-row"><label>Direction</label>
            <select id="de-kind" class="prop-select">
              <option value="read">Read — telemetry in (a lamp, a readout)</option>
              <option value="write">Write — a command out (a button, a switch)</option>
            </select></div>
          <div class="modal-form-row"><label>Label</label>
            <input type="text" id="de-label" class="prop-input" placeholder="Fenix Transponder Ident" /></div>
          <div class="modal-form-row"><label>Category</label>
            <input type="text" id="de-category" class="prop-input" value="custom" /></div>
          <div class="modal-form-row"><label id="de-sug-label">Suggested SimVar</label>
            <input type="text" id="de-sug-a" class="prop-input" placeholder="L:S_XPDR_IDENT" /></div>
          <div class="modal-form-row"><label id="de-sug2-label">Unit</label>
            <input type="text" id="de-sug-b" class="prop-input" placeholder="Number" /></div>
          <p class="modal-confirm-text">The suggestion is optional — without one the row installs empty and the user maps it themselves.</p>
        `,
        onMount: (card) => {
          const kind = card.querySelector('#de-kind');
          const relabel = () => {
            const w = kind.value === 'write';
            card.querySelector('#de-sug-label').textContent = w ? 'Suggested Event' : 'Suggested SimVar';
            card.querySelector('#de-sug2-label').textContent = w ? 'Value Format' : 'Unit';
            card.querySelector('#de-sug-a').placeholder = w ? 'XPNDR_IDENT_ON  or  H:A320_XPDR_IDENT' : 'L:S_XPDR_IDENT';
            card.querySelector('#de-sug-b').placeholder = w ? 'FIXED_1' : 'Number';
          };
          kind.addEventListener('change', relabel);
          relabel();
          card.querySelector('#de-name')?.focus();
        },
        onSubmit: (card) => {
          const name = card.querySelector('#de-name').value.trim();
          if (!name) return { error: 'A name is required.' };
          if (/^[ALHK]:/i.test(name)) {
            return { error: 'That is a raw address, not a Deck Event — raw addresses bypass profiles and need no declaration.' };
          }
          if (DECK_EVENT_NAMES.includes(name)) {
            return { error: `"${name}" is a built-in Deck Event. Namespace yours instead, e.g. "myaircraft.${name}".` };
          }
          if ((host.state.widgetDef.deckEvents || []).some((e) => e.name === name)) {
            return { error: `"${name}" is already declared by this widget.` };
          }
          const kind = card.querySelector('#de-kind').value;
          const a = card.querySelector('#de-sug-a').value.trim();
          const b = card.querySelector('#de-sug-b').value.trim();
          const entry = {
            name, kind,
            label: card.querySelector('#de-label').value.trim() || name,
            category: card.querySelector('#de-category').value.trim() || 'custom'
          };
          if (a) entry.suggest = kind === 'write'
            ? { event: a, ...(b ? { valueFormat: b } : {}) }
            : { simvar: a, ...(b ? { unit: b } : {}) };
          return { value: entry };
        }
      });
      if (!result) return;
      const next = (host.state.widgetDef.deckEvents || []).concat([result]);
      host.state.setDeckEvents(next);
      showToast(`Declared "${result.name}".`);
      host.render();
    });
  // Preserve the empty-list snapshot when no event is declared so Full-tier
  // JSON can still show the section's current data shape.
  }, undefined, def.deckEvents || []));

  // The matrix summarizes read and write capabilities from the widget's components.
  panels.events.appendChild(host.buildAccordionGroup('CAPABILITIES MATRIX (§11)', false, (body) => {
    const caps = def.capabilities || { readSimVars: [], writeEvents: [] };
    // Capability synchronization is an advanced diagnostic, so one wrapper
    // keeps the matrix and its action in Full tier together.
    body.innerHTML = `
      <div data-tier="advanced">
      <div class="caps-summary-box">
        <div class="caps-sub-title">READ SIMVARS (${caps.readSimVars?.length || 0}):</div>
        <div class="caps-tags-list">
          ${(caps.readSimVars || []).map((sv) => `<span class="caps-tag read">${sv}</span>`).join('') || '<span class="caps-empty">None</span>'}
        </div>

        <div class="caps-sub-title" style="margin-top:10px;">WRITE EVENTS (${caps.writeEvents?.length || 0}):</div>
        <div class="caps-tags-list">
          ${(caps.writeEvents || []).map((ev) => `<span class="caps-tag write">${ev}</span>`).join('') || '<span class="caps-empty">None</span>'}
        </div>
      </div>
      <button id="btn-sync-caps" class="panel-full-btn" style="margin-top:8px;">Sync Capabilities with Components</button>
      </div>
    `;

    body.querySelector('#btn-sync-caps')?.addEventListener('click', () => {
      StudioValidator.syncCapabilities(host.state.widgetDef);
      host.state.notify('WIDGET_META_UPDATED');
      showToast('Capabilities synchronized with components.');
    });
  }, undefined, def.capabilities || { readSimVars: [], writeEvents: [] }));

  // Unknown top-level keys remain visible in General and are not tier-hidden,
  // so data from a newer or customized definition is not lost on save.
  const unrecognisedDef = findUnrecognisedDefPaths(def);
  if (unrecognisedDef.length > 0) {
    panels.general.appendChild(host.buildAccordionGroup('UNRECOGNISED PROPERTIES', true, (body) => {
      const block = host.renderUnrecognisedPropertiesBlock(unrecognisedDef, def.fdws, 'wroot', (path, value) => {
        host.state.updateWidgetRawField(path, value);
      });
      if (block) body.appendChild(block);
    }));
  }
}

/**
 * Opens the full-definition editor and applies one validated object through `setWidgetDef`.
 * Cancelling leaves state untouched; validation errors stay in the modal, while a valid result
 * records the existing whole-widget history entry and success toast.
 * @param {object} host Inspector facade providing `state.widgetDef` and `state.setWidgetDef`.
 * @returns {Promise<void>} Resolves after cancellation or a valid object is applied; parse and shape
 *   errors stay in the modal, while a state-writer exception rejects the promise.
 */
export async function openFullJsonPanel(host) {
  const currentJson = JSON.stringify(host.state.widgetDef, null, 2);
  const result = await openModal({
    title: 'Full Widget JSON (Read & Apply)',
    wide: true,
    bodyHtml: `
      <p class="modal-confirm-text">Edit the widget's complete JSON definition
      directly. Apply re-validates the JSON and replaces the current widget's
      whole definition — this participates in Undo (Ctrl+Z) like any other edit.</p>
      <textarea id="full-json-textarea" class="prop-textarea full-json-textarea" spellcheck="false">${escapeHtmlAttr(currentJson)}</textarea>
    `,
    submitLabel: 'Apply',
    onSubmit: (card) => {
      const raw = card.querySelector('#full-json-textarea').value;
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        return { error: `Invalid JSON: ${err.message}` };
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { error: 'Must be a JSON object (a widget definition), not an array or a bare value.' };
      }
      return { value: parsed };
    }
  });
  if (!result) return;
  host.state.setWidgetDef(result, true, 'Apply Full JSON');
  showToast('Applied — Undo (Ctrl+Z) to revert if something looks wrong.');
}
