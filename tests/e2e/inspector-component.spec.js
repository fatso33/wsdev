import { expect, openStudio, test } from './fixtures/inspectorHarness.js';

async function selectTypeOnDataTab(page, type, id) {
  await page.evaluate(({ type, id }) => {
    const state = window.__studioApp.state;
    state.widgetDef.components.push({ id, type, props: {}, style: {} });
    state.selectComponent(id);
  }, { type, id });
  await page.getByTestId('inspector-tab-data').click();
}

test('label and divider explain their current Style tab fields', async ({ page }) => {
  await openStudio(page);
  await selectTypeOnDataTab(page, 'core.label', 'label-notice');
  await expect(page.getByTestId('inspector-panel-data')).toContainText("Alignment is set in the Style tab's Appearance section, shared by every component type.");
  await selectTypeOnDataTab(page, 'core.divider', 'divider-notice');
  await expect(page.getByTestId('inspector-panel-data')).toContainText("Thickness, color and dash style are set in the Style tab's Appearance section, under Border. This line reuses those fields.");
});
