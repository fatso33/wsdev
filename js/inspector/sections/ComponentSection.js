/**
 * @module ComponentSection
 * Renders the selected component's header, layout, tab sections, type-specific props and
 * unrecognised fields. StudioState owns selection, component writes and history; the live
 * StudioInspector owns tier, style-target state and rendering. This module keeps only listeners on the
 * current DOM mount, discarded by the next host render. It creates no persistent resource.
 */
import { StudioValidator, findUnrecognisedComponentPaths } from '../../StudioValidator.js';
import { showToast } from '../../StudioModal.js';
import { TYPE_FIELDS as REGISTRY_TYPE_FIELDS } from '../../../widgets/PropertyRegistry.js';
import { escapeHtmlAttr } from '../inspectorMarkup.js';
import { renderComponentAppearance } from './AppearanceSection.js';
import { renderComponentBindings } from './BindingsSection.js';
import { renderComponentInteractions } from './InteractionsSection.js';

// Only these types pair a runtime content field with the Studio authoring label.
const CONTENT_FIELD_BY_TYPE = {
  'core.label': 'props.text',
  'core.button': 'props.label',
  'core.indicator': 'props.label',
};

/**
 * Builds the component Inspector through the host's existing tab, accordion, field and
 * commit delegates. Reads the current definition and component at render time, retains
 * captured values in DOM handlers, and resets appearance targets on selection change.
 * @param {object} host Live Inspector with container, state and section delegates.
 * @param {object} comp Selected component.
 * @returns {void}
 */
export function renderComponentInspector(host, comp) {
  if (host._styleTabCompId !== comp.id) {
    host._styleTabCompId = comp.id;
    host._styleTab = 'normal';
    // A rule index from the previous component may not exist on this one.
    host._styleTabRuleIndex = null;
  }

  const def = host.state.widgetDef;
  const layerGroups = def.layerGroups || [];
  const layerGroupsMap = new Map(layerGroups.map((lg) => [lg.id, lg.z || 0]));

  const groupZ = comp.layer?.group ? (layerGroupsMap.get(comp.layer.group) ?? 0) : 0;
  const localZ = comp.layer?.z ?? 0;
  const effectiveZ = groupZ + localZ;

  // Header
  const header = document.createElement('div');
  header.className = 'inspector-header';
  header.innerHTML = `
    <div class="inspector-title-row">
      <span class="inspector-badge comp-type">${comp.type.replace('core.', '')}</span>
      <h3 class="inspector-title">${comp.label || comp.id}</h3>
      <button id="btn-deselect-comp" class="btn-mini-close" title="Back to Widget Root">✕</button>
    </div>
    <div class="inspector-sub">ID: ${comp.id} • Effective Z: ${effectiveZ}</div>
  `;
  host.container.appendChild(header);

  header.querySelector('#btn-deselect-comp')?.addEventListener('click', () => {
    host.state.clearSelection();
  });

  const { tabBar, panelsContainer, panels } = host.buildInspectorTabShell();
  host.container.appendChild(tabBar);
  host.container.appendChild(panelsContainer);

  // Layout and geometry share one section because both describe placement.
  panels.general.appendChild(host.buildAccordionGroup('LAYOUT & LAYERING', true, (outerBody) => {
  ((body) => {
    const layer = comp.layer || {};
    const contentPath = CONTENT_FIELD_BY_TYPE[comp.type];
    // Reuse the registry's own per-type tooltip (already tailored — e.g.
    // core.button's mentions binding.stateRef) rather than a hand-written
    // one-size string, appending only the fallback note this pairing adds.
    const contentFieldDef = contentPath
      ? REGISTRY_TYPE_FIELDS[comp.type]?.find((f) => f.path === contentPath)
      : null;
    const contentTooltip = `${contentFieldDef?.tooltip || ''} Falls back to "Called" (right) if this has never been set.`.trim();
    body.innerHTML = `
      ${contentPath ? `
      <div class="prop-row-2">
        <div class="prop-field">
          <label>Shows <span class="prop-hint" title="${escapeHtmlAttr(contentTooltip)}">ⓘ</span></label>
          <input type="text" id="c-content-field" class="prop-input" value="${escapeHtmlAttr(host.getFieldValue(comp, contentPath) ?? '')}" placeholder="Runtime text..." />
        </div>
        <div class="prop-field">
          <label>Called <span class="prop-hint" title="Studio-only authoring name — shown in the layer tree and this panel's header. Never rendered on the widget itself.">ⓘ</span></label>
          <input type="text" id="c-label" class="prop-input" value="${comp.label || ''}" placeholder="Component label..." />
        </div>
      </div>
      ` : `
      <div class="prop-field">
        <label>Display Label</label>
        <input type="text" id="c-label" class="prop-input" value="${comp.label || ''}" placeholder="Component label..." />
      </div>
      `}
      <div class="prop-row-2">
        <div class="prop-field" data-tier="advanced">
          <label>Component ID</label>
          <input type="text" id="c-id" class="prop-input" value="${comp.id}" />
        </div>
        <div class="prop-field">
          <label>Type</label>
          <select id="c-type" class="prop-select">
            ${StudioValidator.CORE_COMPONENT_TYPES.map((t) => `<option value="${t}" ${comp.type === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="prop-section-subtitle" style="margin-top:10px;" data-tier="advanced">Layer Group & Z-Index (§9.3)</div>
      <div class="prop-row-2" data-tier="advanced">
        <div class="prop-field">
          <label>Layer Group <span class="prop-hint" title="Puts this component on a named z-order layer (e.g. 'background', 'controls') defined in the Layers panel's own Z field — lets a whole group of components move in front of/behind another group at once, instead of hand-tuning every component's Z individually.">ⓘ</span></label>
          <select id="c-layer-group" class="prop-select">
            <option value="" ${!layer.group ? 'selected' : ''}>None (Ungrouped)</option>
            ${layerGroups.map((g) => `<option value="${g.id}" ${layer.group === g.id ? 'selected' : ''}>${g.id} (Z: ${g.z || 0})</option>`).join('')}
          </select>
        </div>
        <div class="prop-field">
          <label>Local Z-Offset <span class="prop-hint" title="Fine z-order adjustment on top of the Layer Group's own Z (Effective Z, shown in the header above, is the group's Z plus this offset) — use this to order two components within the SAME group, e.g. an indicator's glow behind its lens.">ⓘ</span></label>
          <input type="number" id="c-layer-z" class="prop-input" value="${layer.z ?? 0}" min="-1000" max="1000" />
        </div>
      </div>

      <div class="prop-row-2" style="margin-top:6px;" data-tier="advanced">
        <div class="prop-field">
          <label>Pointer Events <span class="prop-hint" title="'none' makes this component visually present but click/tap-through — the component (or whatever's behind it) receives the touch instead. Useful for a purely decorative overlay (a glass glare image, a label sitting on top of a button) that shouldn't steal taps from what's underneath.">ⓘ</span></label>
          <select id="c-pointer-events" class="prop-select">
            <option value="auto" ${layer.pointerEvents !== 'none' ? 'selected' : ''}>auto (Interactive)</option>
            <option value="none" ${layer.pointerEvents === 'none' ? 'selected' : ''}>none (Pass-through)</option>
          </select>
        </div>
        <div class="prop-field">
          <label>Clip to Bounds <span class="prop-hint" title="When true, anything this component draws outside its own grid cell (an oversized background image, a glow/shadow effect) is cut off at the cell edge instead of overflowing into neighboring components.">ⓘ</span></label>
          <select id="c-clip" class="prop-select">
            <option value="false" ${!layer.clipToBounds ? 'selected' : ''}>false (Visible)</option>
            <option value="true" ${layer.clipToBounds ? 'selected' : ''}>true (Clipped)</option>
          </select>
        </div>
      </div>
    `;

    body.querySelector('#c-label')?.addEventListener('change', (e) => host.state.updateComponent(comp.id, { label: e.target.value }));
    body.querySelector('#c-content-field')?.addEventListener('change', (e) => host.commitField(comp, contentPath, e.target.value));
    body.querySelector('#c-id')?.addEventListener('change', (e) => {
      const newId = e.target.value.trim();
      if (newId && newId !== comp.id) {
        host.state.updateComponent(comp.id, { id: newId });
      }
    });
    body.querySelector('#c-type')?.addEventListener('change', (e) => {
      host.state.updateComponent(comp.id, { type: e.target.value });
    });
    body.querySelector('#c-layer-group')?.addEventListener('change', (e) => {
      const val = e.target.value || null;
      host.state.updateComponent(comp.id, { layer: { ...(comp.layer || {}), group: val } });
    });
    body.querySelector('#c-layer-z')?.addEventListener('change', (e) => {
      const zVal = Number.parseInt(e.target.value, 10) || 0;
      host.state.updateComponent(comp.id, { layer: { ...(comp.layer || {}), z: zVal } });
    });
    body.querySelector('#c-pointer-events')?.addEventListener('change', (e) => {
      host.state.updateComponent(comp.id, { layer: { ...(comp.layer || {}), pointerEvents: e.target.value } });
    });
    body.querySelector('#c-clip')?.addEventListener('change', (e) => {
      host.state.updateComponent(comp.id, { layer: { ...(comp.layer || {}), clipToBounds: e.target.value === 'true' } });
    });
  })(outerBody.appendChild(document.createElement('div')));

  const geomDivider = document.createElement('div');
  geomDivider.className = 'prop-section-subtitle';
  geomDivider.style.marginTop = '14px';
  geomDivider.textContent = 'Grid Position & Size';
  // Guided users place/resize on the canvas (drag-to-place); typing exact
  // grid coordinates is a Build+ convenience, matching the same
  // data-tier="build" precedent already set by widget-root's own
  // Sub-Grid/Default-Size fields (GRID & DIMENSIONS accordion above).
  geomDivider.setAttribute('data-tier', 'build');
  outerBody.appendChild(geomDivider);

  ((body) => {
    const layout = comp.layout || { col: 1, row: 1, w: 2, h: 2 };
    const maxCols = def.layout?.grid?.columns || 12;
    const maxRows = def.layout?.grid?.rows || 6;

    body.innerHTML = `
      <div class="prop-row-2" data-tier="build">
        <div class="prop-field">
          <label>Column (X)</label>
          <input type="number" id="c-layout-col" class="prop-input" value="${layout.col || 1}" min="1" max="${maxCols}" />
        </div>
        <div class="prop-field">
          <label>Row (Y)</label>
          <input type="number" id="c-layout-row" class="prop-input" value="${layout.row || 1}" min="1" max="${maxRows}" />
        </div>
      </div>
    `;

    // Use the same compound-row structure as registry-driven size controls.
    const wField = document.createElement('div');
    wField.className = 'prop-field';
    wField.innerHTML = `<label>Width (Span Columns)</label><input type="number" id="c-layout-w" class="prop-input" value="${layout.w || 1}" min="1" max="${maxCols}" />`;
    const hField = document.createElement('div');
    hField.className = 'prop-field';
    hField.innerHTML = `<label>Height (Span Rows)</label><input type="number" id="c-layout-h" class="prop-input" value="${layout.h || 1}" min="1" max="${maxRows}" />`;
    const sizeRow = host.assembleCompoundRow('compound-row-size', [
      { wrap: wField, label: 'W:', tooltip: 'Width (Span Columns)' },
      { wrap: hField, label: 'H:', tooltip: 'Height (Span Rows)' }
    ]);
    sizeRow.setAttribute('data-tier', 'build');
    body.appendChild(sizeRow);

    const updateLayout = (updates) => {
      host.state.updateComponent(comp.id, { layout: { ...comp.layout, ...updates } });
    };

    body.querySelector('#c-layout-col')?.addEventListener('change', (e) => updateLayout({ col: Number.parseInt(e.target.value, 10) || 1 }));
    body.querySelector('#c-layout-row')?.addEventListener('change', (e) => updateLayout({ row: Number.parseInt(e.target.value, 10) || 1 }));
    body.querySelector('#c-layout-w')?.addEventListener('change', (e) => updateLayout({ w: Number.parseInt(e.target.value, 10) || 1 }));
    body.querySelector('#c-layout-h')?.addEventListener('change', (e) => updateLayout({ h: Number.parseInt(e.target.value, 10) || 1 }));
  })(outerBody.appendChild(document.createElement('div')));
  }, host.buildLayoutBadge(comp), { label: comp.label, id: comp.id, type: comp.type, layer: comp.layer, layout: comp.layout }, true));

  // Create both shells before filling them so tab placement and field order stay stable.
  // Empty styles still render as an empty JSON object in the Full-tier view.
  const appearanceGroup = host.buildAccordionGroup('APPEARANCE', false, () => {}, host.buildAppearanceBadge(comp), comp.style || {}, true);
  const dataGroup = host.buildAccordionGroup('DATA & CONTENT', false, () => {}, host.buildDataBadge(comp), { props: comp.props, binding: comp.binding }, true);
  // Unknown fields remain visible in their corresponding sections.
  const unrecognised = findUnrecognisedComponentPaths(comp);
  const commitUnrecognised = (path, value) => host.commitField(comp, path, value);
  panels.style.appendChild(appearanceGroup);
  panels.data.appendChild(dataGroup);
  const appearanceBody = appearanceGroup.querySelector('.inspector-group-body');
  const dataBody = dataGroup.querySelector('.inspector-group-body');

  ((body) => {
    host.renderTypeSpecificProps(comp, body);
  })(dataBody.appendChild(document.createElement('div')));

  renderComponentAppearance(host, comp, def, appearanceBody.appendChild(document.createElement('div')));

  const unrecStyleBlock = host.renderUnrecognisedPropertiesBlock(unrecognised.style, def.fdws, `${comp.id}-style`, commitUnrecognised);
  if (unrecStyleBlock) appearanceBody.appendChild(unrecStyleBlock);

  const bindDivider = document.createElement('div');
  bindDivider.className = 'prop-section-subtitle';
  bindDivider.style.marginTop = '14px';
  bindDivider.textContent = 'SimVars & Bindings';
  dataBody.appendChild(bindDivider);

  renderComponentBindings(host, comp, def, dataBody.appendChild(document.createElement('div')));

  const unrecDataBlock = host.renderUnrecognisedPropertiesBlock([...unrecognised.props, ...unrecognised.binding], def.fdws, `${comp.id}-data`, commitUnrecognised);
  if (unrecDataBlock) dataBody.appendChild(unrecDataBlock);

  // Interactions and visibility share the Behavior section.
  panels.events.appendChild(host.buildAccordionGroup('BEHAVIOR', false, (outerBody) => {
  renderComponentInteractions(host, comp, outerBody.appendChild(document.createElement('div')));

  const visibilityDivider = document.createElement('div');
  visibilityDivider.className = 'prop-section-subtitle';
  visibilityDivider.style.marginTop = '14px';
  visibilityDivider.textContent = 'Visibility & Guard';
  outerBody.appendChild(visibilityDivider);

  host.renderVisibilityAndGuard(comp, def, outerBody.appendChild(document.createElement('div')));
  }, host.buildBehaviorBadge(comp), { interactions: comp.interactions, visibleWhen: comp.visibleWhen, layout: { guard: comp.layout?.guard } }, true));

  // Root fields have no relevant props, bindings or style section.
  if (unrecognised.other.length > 0) {
    panels.general.appendChild(host.buildAccordionGroup('UNRECOGNISED PROPERTIES', true, (body) => {
      const block = host.renderUnrecognisedPropertiesBlock(unrecognised.other, def.fdws, `${comp.id}-other`, commitUnrecognised);
      if (block) body.appendChild(block);
    }));
  }
}

/**
 * Appends the selected type's registry fields and bespoke controls to the Data tab.
 * Gauge compose and list-template handlers write through existing host/state methods;
 * their listeners live only as long as this mount.
 * @param {object} host Live Inspector with state and field/commit delegates.
 * @param {object} comp Selected component.
 * @param {HTMLElement} body Data-tab mount.
 * @returns {void}
 */
export function renderTypeSpecificProps(host, comp, body) {
  const props = comp.props || {};
  const assets = host.state.widgetDef.assets || [];

  switch (comp.type) {
    case 'core.label': {
      const fieldMount = document.createElement('div');
      body.appendChild(fieldMount);
      host.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.label'].filter((f) => f.path !== CONTENT_FIELD_BY_TYPE['core.label']));
      const notice = document.createElement('div');
      notice.className = 'empty-tree-notice';
      notice.textContent = "Alignment is set in the Style tab's Appearance section, shared by every component type.";
      body.appendChild(notice);
      break;
    }

    // The registry supplies format-dependent visibility and the odometer format choice.
    case 'core.display': {
      const fieldMount = document.createElement('div');
      body.appendChild(fieldMount);
      host.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.display']);
      break;
    }

    case 'core.button': {
      const fieldMount = document.createElement('div');
      body.appendChild(fieldMount);
      host.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.button'].filter((f) => f.path !== CONTENT_FIELD_BY_TYPE['core.button']));
      break;
    }

    // Unset bounds use the format defaults at runtime.
    case 'core.input': {
      const fieldMount = document.createElement('div');
      body.appendChild(fieldMount);
      host.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.input']);
      break;
    }

    // Test State Var belongs to the Bindings panel, so only props render here.
    case 'core.indicator': {
      const fieldMount = document.createElement('div');
      body.appendChild(fieldMount);
      host.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.indicator'].filter((f) => f.path.startsWith('props.') && f.path !== CONTENT_FIELD_BY_TYPE['core.indicator']));
      break;
    }

    case 'core.image': {
      const fieldMount = document.createElement('div');
      body.appendChild(fieldMount);
      host.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.image']);
      break;
    }

    // Compose is an optional object: enabling seeds defaults and disabling removes it.
    // Arc uses a stroke sweep, so its translate axis is gated by the registry.
    case 'core.gauge': {
      const stateVars = host.state.widgetDef.state || [];
      const composeFields = REGISTRY_TYPE_FIELDS['core.gauge'].filter((f) => f.path.startsWith('props.compose'));
      const mainFields = REGISTRY_TYPE_FIELDS['core.gauge'].filter((f) => !f.path.startsWith('props.compose'));

      const fieldMount = document.createElement('div');
      body.appendChild(fieldMount);
      host.renderRegistryFields(comp, fieldMount, mainFields);

      const composeToggleWrap = document.createElement('div');
      composeToggleWrap.className = 'prop-field';
      composeToggleWrap.setAttribute('data-tier', 'advanced');
      composeToggleWrap.innerHTML = `
        <label style="display:flex;align-items:center;gap:6px;">
          <input type="checkbox" id="p-gauge-compose-toggle" ${props.compose ? 'checked' : ''} />
          Composed Secondary Transform <span class="prop-hint" title="FDWS v1.5: a SECOND transform, sourced from a local state[] variable (not a live binding), composed after the primary one on this same gauge — e.g. an attitude horizon that rotates for bank AND translates for pitch as one rigid body. FDWS v1.6 adds an optional 'Relative To' for a target indicator (like a flight-director bar) that needs to render relative to a reference value a sibling gauge already uses for its own current-reading motion. Not meaningful for 'Arc' (it's an SVG stroke sweep, not a CSS transform) — ignored there.">ⓘ</span>
        </label>
      `;
      body.appendChild(composeToggleWrap);

      const composeMount = document.createElement('div');
      composeMount.className = props.compose ? '' : 'hidden';
      composeMount.setAttribute('data-tier', 'advanced');
      body.appendChild(composeMount);
      if (props.compose) host.renderRegistryFields(comp, composeMount, composeFields);

      composeToggleWrap.querySelector('#p-gauge-compose-toggle')?.addEventListener('change', (e) => {
        if (e.target.checked) {
          const nextProps = {
            ...comp.props,
            compose: comp.props.compose || { transform: 'translate', axis: 'y', stateVar: stateVars[0]?.name || '', valueRange: [0, 1], outputRange: [0, 1], clamp: true }
          };
          host.state.updateComponent(comp.id, { props: nextProps });
          composeMount.classList.remove('hidden');
          host.renderRegistryFields(comp, composeMount, composeFields);
        } else {
          const { compose: _compose, ...nextProps } = comp.props;
          host.state.updateComponent(comp.id, { props: nextProps });
          composeMount.classList.add('hidden');
        }
      });
      break;
    }

    // The list template uses a JSON editor for shape validation.
    case 'core.slider': {
      const fieldMount = document.createElement('div');
      body.appendChild(fieldMount);
      host.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.slider']);
      break;
    }

    case 'core.selector': {
      const fieldMount = document.createElement('div');
      body.appendChild(fieldMount);
      host.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.selector']);
      break;
    }

    case 'core.rocker': {
      const fieldMount = document.createElement('div');
      body.appendChild(fieldMount);
      host.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.rocker']);
      break;
    }

    case 'core.list': {
      const fieldMount = document.createElement('div');
      body.appendChild(fieldMount);
      host.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.list']);

      const templateWrap = document.createElement('div');
      templateWrap.className = 'prop-field';
      templateWrap.innerHTML = `
        <label>Item Template (JSON — components[] with props.textBinding: "item.field")
          <button type="button" id="p-list-template-example" class="btn-mini-inline">Insert example</button>
        </label>
        <textarea id="p-list-itemtemplate" class="prop-input" rows="5">${JSON.stringify(props.itemTemplate || { components: [] }, null, 0)}</textarea>
        <div id="p-list-itemtemplate-error" class="prop-json-error hidden"></div>
      `;
      body.appendChild(templateWrap);
      templateWrap.querySelector('#p-list-itemtemplate')?.addEventListener('change', (e) => {
        host.updateCompJsonProp(comp, 'itemTemplate', e.target.value, templateWrap.querySelector('#p-list-itemtemplate-error'));
      });
      templateWrap.querySelector('#p-list-template-example')?.addEventListener('click', () => {
        const example = { components: [{ id: 'row_label', type: 'core.label', layout: { col: 1, row: 1, w: 12, h: 1 }, props: { text: '', textBinding: 'item.label' } }] };
        host.updateCompProp(comp, 'itemTemplate', example);
      });
      break;
    }

    case 'core.ref': {
      const fieldMount = document.createElement('div');
      body.appendChild(fieldMount);
      host.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.ref']);
      break;
    }

    // These remaining types read their type-specific fields from the registry.
    case 'core.divider': {
      const fieldMount = document.createElement('div');
      body.appendChild(fieldMount);
      host.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.divider']);
      const notice = document.createElement('div');
      notice.className = 'empty-tree-notice';
      notice.textContent = "Thickness, color and dash style are set in the Style tab's Appearance section, under Border. This line reuses those fields.";
      body.appendChild(notice);
      break;
    }

    case 'core.tape': {
      const fieldMount = document.createElement('div');
      body.appendChild(fieldMount);
      host.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.tape']);
      const notice = document.createElement('div');
      notice.className = 'empty-tree-notice';
      notice.textContent = "The current value's own numeric readout isn't part of this component — layer a separate core.display on top at the index line, same as a needle over a dial.";
      body.appendChild(notice);
      break;
    }

    case 'core.pad': {
      const fieldMount = document.createElement('div');
      body.appendChild(fieldMount);
      host.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.pad']);
      break;
    }

    case 'core.container': {
      const fieldMount = document.createElement('div');
      body.appendChild(fieldMount);
      host.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.container']);
      break;
    }

    case 'core.stepper': {
      const fieldMount = document.createElement('div');
      body.appendChild(fieldMount);
      host.renderRegistryFields(comp, fieldMount, REGISTRY_TYPE_FIELDS['core.stepper']);
      break;
    }

    case 'core.rotary': {
      host.renderRegistryFieldGroups(comp, body, REGISTRY_TYPE_FIELDS['core.rotary']);
      break;
    }

    default:
      body.innerHTML = `<div class="caps-empty">Standard properties active for ${comp.type}</div>`;
      break;
  }
}

/**
 * Renders unknown paths without discarding them. Scalars offer an unvalidated edit
 * through onCommit; object values stay read-only. Invalid numeric values show a toast.
 * Listeners belong to the returned node and are discarded on the next render.
 * @param {object} host Live Inspector facade.
 * @param {Array<{path:string,value:*}>} items Unknown paths; empty input returns null.
 * @param {string} fdwsVersion Version displayed beside each path.
 * @param {string} idPrefix Unique control ID prefix.
 * @param {(path:string, value:*) => void} onCommit Existing state writer.
 * @returns {HTMLElement|null} DOM block or null when no items exist.
 */
export function renderUnrecognisedPropertiesBlock(host, items, fdwsVersion, idPrefix, onCommit) {
  if (!items || items.length === 0) return null;

  const isScalar = (v) => ['number', 'string', 'boolean'].includes(typeof v);

  const rowHtml = (item, idx) => {
    const rid = `${idPrefix}-unrec-${idx}`;
    const badge = `<span class="tmpl-badge">FDWS v${escapeHtmlAttr(fdwsVersion || '?')}</span>`;
    if (!isScalar(item.value)) {
      return `
        <div class="unrec-props-row">
          <div class="unrec-props-path">${escapeHtmlAttr(item.path)} ${badge}</div>
          <pre class="unrec-props-readonly">${escapeHtmlAttr(JSON.stringify(item.value, null, 2))}</pre>
        </div>
      `;
    }
    const valueType = typeof item.value;
    const inputHtml = valueType === 'boolean'
      ? `<input type="checkbox" id="${rid}-input" ${item.value ? 'checked' : ''} />`
      : `<input type="${valueType === 'number' ? 'number' : 'text'}" id="${rid}-input" class="prop-input" value="${escapeHtmlAttr(item.value)}" />`;
    return `
      <div class="unrec-props-row">
        <div class="unrec-props-path">${escapeHtmlAttr(item.path)} ${badge}</div>
        <div class="unrec-props-value-line">
          <span class="unrec-props-value" id="${rid}-display">${escapeHtmlAttr(JSON.stringify(item.value))}</span>
          <button type="button" class="bar-btn" id="${rid}-toggle">✎ Edit (unvalidated)</button>
        </div>
        <div class="unrec-props-edit hidden" id="${rid}-panel">
          <div class="text-amber unrec-props-warning">⚠ Unrecognised field — this build doesn't know what this value means. Editing it is not validated against any schema.</div>
          ${inputHtml}
          <div class="saved-card-btns">
            <button type="button" class="bar-btn primary" id="${rid}-save">Save</button>
            <button type="button" class="bar-btn" id="${rid}-cancel">Cancel</button>
          </div>
        </div>
      </div>
    `;
  };

  const wrap = document.createElement('div');
  wrap.className = 'unrec-props-block';
  wrap.innerHTML = `
    <div class="unrec-props-header">⚠ UNRECOGNISED PROPERTIES <span class="prop-hint" title="Fields present in this widget's saved data that this build's registry doesn't declare — likely from a newer Studio version, or hand-authored. Always preserved on save, never dropped.">ⓘ</span></div>
    ${items.map(rowHtml).join('')}
  `;

  items.forEach((item, idx) => {
    if (!isScalar(item.value)) return;
    const rid = `${idPrefix}-unrec-${idx}`;
    const toggleBtn = wrap.querySelector(`#${rid}-toggle`);
    const panel = wrap.querySelector(`#${rid}-panel`);
    const cancelBtn = wrap.querySelector(`#${rid}-cancel`);
    const saveBtn = wrap.querySelector(`#${rid}-save`);
    const inputEl = wrap.querySelector(`#${rid}-input`);

    toggleBtn?.addEventListener('click', () => panel.classList.toggle('hidden'));
    cancelBtn?.addEventListener('click', () => {
      if (typeof item.value === 'boolean') inputEl.checked = item.value;
      else inputEl.value = item.value;
      panel.classList.add('hidden');
    });
    saveBtn?.addEventListener('click', () => {
      const valueType = typeof item.value;
      let next;
      if (valueType === 'boolean') {
        next = inputEl.checked;
      } else if (valueType === 'number') {
        next = Number(inputEl.value);
        if (Number.isNaN(next)) { showToast('Not a valid number.'); return; }
      } else {
        next = inputEl.value;
      }
      onCommit(item.path, next);
    });
  });

  return wrap;
}
