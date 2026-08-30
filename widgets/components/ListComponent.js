/**
 * ListComponent.js
 * Renderer for core.list (FDWS v1.2 §3.1) — scrollable repeater rendering itemTemplate
 * once per element of an array-typed local-state var (itemsBinding.stateVar). Inside
 * itemTemplate, a child's props.textBinding value of the form "item.<field>" is resolved
 * against the current array element instead of widget-level state — the only place
 * item.* bindings are valid, per spec.
 */

import { BaseComponent } from './BaseComponent.js';

export class ListComponent extends BaseComponent {
  render() {
    super.render();
    this.element.classList.add('fd-comp-list');

    const props = this.def.props || {};
    if (props.scrollable === false) {
      this.element.style.overflowY = 'hidden';
    }

    this.itemsBinding = props.itemsBinding || {};
    this.itemTemplate = props.itemTemplate || { components: [] };
    this.maxVisible = props.maxVisible;
    this.itemGroups = [];
    this._lastItemsRef = undefined;

    this.renderItems(this.readItems());
    return this.element;
  }

  readItems() {
    const stateVar = this.itemsBinding.stateVar;
    if (!stateVar || !this.widget?.getLocalState) return [];
    const items = this.widget.getLocalState(stateVar);
    return Array.isArray(items) ? items : [];
  }

  /** Resolves a props.textBinding value like "item.altitude" against the current item. */
  resolveItemField(textBinding, item) {
    if (typeof textBinding !== 'string' || !textBinding.startsWith('item.')) return undefined;
    const field = textBinding.slice('item.'.length);
    return item ? item[field] : undefined;
  }

  renderItems(items) {
    // Clear any previously mounted item groups
    this.itemGroups.forEach((group) => group.renderers.forEach((r) => r.destroy()));
    this.itemGroups = [];
    while (this.element.firstChild) this.element.removeChild(this.element.firstChild);

    const visible = this.maxVisible ? items.slice(0, this.maxVisible) : items;
    const allState = this.widget?.getAllStateObject?.() || {};

    visible.forEach((item, index) => {
      const row = document.createElement('div');
      row.className = 'fd-list-item';
      row.dataset.listIndex = String(index);

      const templateComponents = Array.isArray(this.itemTemplate.components) ? this.itemTemplate.components : [];
      const renderers = [];

      templateComponents.forEach((childDefRaw) => {
        const childDef = { ...childDefRaw, id: `${childDefRaw.id}__item${index}` };
        const renderer = this.widget.createComponentRenderer(childDef);
        if (!renderer) return;
        const node = renderer.render();
        row.appendChild(node);
        renderers.push(renderer);

        const textBinding = childDefRaw.props?.textBinding;
        if (textBinding) {
          renderer.update(this.resolveItemField(textBinding, item), allState);
        } else {
          renderer.update(undefined, allState);
        }
      });

      row.addEventListener('click', () => {
        this.widget?.handleInteraction?.(this.def, 'itemTap', { index });
      });

      this.itemGroups.push({ row, renderers });
      this.element.appendChild(row);
    });
  }

  update(val, allState) {
    super.update(val, allState);
    const items = this.readItems();
    // Cheap change detection: re-render only when the array reference or length changes.
    if (items !== this._lastItemsRef) {
      this._lastItemsRef = items;
      this.renderItems(items);
    }
  }

  destroy() {
    this.itemGroups.forEach((group) => group.renderers.forEach((r) => r.destroy()));
    this.itemGroups = [];
    super.destroy();
  }
}
