import { describe, expect, it } from 'vitest';
import * as inspectorModule from '../js/StudioInspector.js';

// The facade's module surface. `window.__studioApp.inspector` exposes the whole
// instance to specs and devtools, so every prototype method stays a
// caller-visible name even as its implementation moves into js/inspector/.
const PROTOTYPE_METHODS = [
  'initDOM', 'render', 'renderInner',
  'enhanceNumberInputs', 'getNumberStep', 'decimalPlaces', 'roundToDecimals',
  'buildMultiSelectStyleProxy', 'applyMultiSelectFieldAvailability', 'renderMultiSelectInspector',
  'buildModeToggle', 'tierHidesField', 'applyUiMode', 'applySubtitleVisibility',
  'applyTierMoreBadges', 'applySectionJsonViews',
  'renderWidgetInspector', 'openFullJsonPanel',
  'openConditionEditorPopover',
  'buildInspectorTabShell',
  'renderComponentInspector',
  'renderVisibilityAndGuard', 'renderConditionListEditor',
  'renderTypeSpecificProps',
  'updateCompJsonProp',
  'renderRangeEditor', 'renderRowListEditor',
  'getThemeEditContext',
  'toHexColor', 'wireColorPair',
  'getFieldValue', 'commitRotaryFeelContext', 'commitRotaryFeelEntry', 'commitField',
  'renderUnrecognisedPropertiesBlock',
  'evaluateShowWhen',
  'humanizeFieldLabel', 'fieldDomId',
  'remapAppearancePath', 'retargetAppearanceFields', 'renderAppearanceSection',
  'renderBaseThemeAwareAppearanceFields',
  'renderRegistryFieldGroups', 'renderRegistryFields', 'renderCompoundGroup', 'assembleCompoundRow',
  'buildFieldWrap', 'formatShowWhenReason', 'resolveEffectiveValue',
  'resolveFeelFloorHint', 'resolvePulseFeelDescription',
  'renderPlainField', 'renderCheckboxField', 'renderSelectField', 'renderColorField',
  'renderRowListField', 'renderStateVarField', 'renderAssetField', 'renderRangeField', 'renderPivotField',
  'updateCompProp',
  'openAddInteractionModal',
  'openConnectDialog',
  'buildLayoutBadge', 'buildAppearanceBadge', 'buildDataBadge', 'buildBehaviorBadge',
  'buildAccordionGroup',
];

const ASYNC_METHODS = ['openAddInteractionModal', 'openConditionEditorPopover', 'openConnectDialog', 'openFullJsonPanel'];

describe('StudioInspector facade surface', () => {
  it('exports only the StudioInspector class', () => {
    expect(Object.keys(inspectorModule)).toEqual(['StudioInspector']);
    expect(typeof inspectorModule.StudioInspector).toBe('function');
  });

  it('keeps exactly the 68 prototype methods', () => {
    const proto = inspectorModule.StudioInspector.prototype;
    const names = Object.getOwnPropertyNames(proto).filter((name) => name !== 'constructor');
    expect(PROTOTYPE_METHODS).toHaveLength(68);
    expect([...names].sort()).toEqual([...PROTOTYPE_METHODS].sort());
    for (const name of names) {
      expect(typeof Object.getOwnPropertyDescriptor(proto, name).value, name).toBe('function');
    }
  });

  it('keeps exactly the four async methods', () => {
    const proto = inspectorModule.StudioInspector.prototype;
    const asyncNames = Object.getOwnPropertyNames(proto)
      .filter((name) => name !== 'constructor' && proto[name].constructor.name === 'AsyncFunction');
    expect(asyncNames.sort()).toEqual(ASYNC_METHODS);
  });
});
