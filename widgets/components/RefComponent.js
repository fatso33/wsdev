/**
 * RefComponent.js
 * Renderer for core.ref (FDWS v1.2 §3.3) — references another packaged
 * "component-library" definition instead of inlining repeated structure (e.g. a
 * reusable numeric keypad). Resolves props.libraryId through the same WidgetRegistry
 * catalog lookup CompositeWidget.resolveDefinition() already uses for widget defs, and
 * inlines the referenced components[] as children. Full component-library *packaging*
 * (import/bundling of external .fdwidget library packages) is out of scope of this
 * codebase today, so an unregistered libraryId degrades to a clear placeholder rather
 * than failing silently.
 */

import { BaseComponent } from './BaseComponent.js';
import { SecurityValidator } from '../../core/SecurityValidator.js';

export class RefComponent extends BaseComponent {
  render() {
    super.render();
    this.element.classList.add('fd-comp-ref');

    const props = this.def.props || {};
    const libraryId = props.libraryId;
    const library = libraryId ? this.widget?.resolveComponentLibrary?.(libraryId) : null;

    this.childRenderers = [];

    if (library && Array.isArray(library.components)) {
      library.components.forEach((childDef) => {
        const renderer = this.widget.createComponentRenderer(childDef);
        if (renderer) {
          this.element.appendChild(renderer.render());
          this.childRenderers.push(renderer);
        }
      });
    } else {
      this.element.style.border = '1px dashed var(--btn-border, #333)';
      this.element.style.display = 'flex';
      this.element.style.alignItems = 'center';
      this.element.style.justifyContent = 'center';
      this.element.style.color = 'var(--text-dim, #888)';
      this.element.style.fontSize = '10px';
      const text = document.createElement('span');
      SecurityValidator.setText(text, `[core.ref: "${libraryId || 'unset'}" not registered]`);
      this.element.appendChild(text);
    }

    return this.element;
  }

  update(val, allState) {
    super.update(val, allState);
    this.childRenderers.forEach((child) => child.update(val, allState));
  }

  destroy() {
    this.childRenderers.forEach((child) => child.destroy());
    this.childRenderers = [];
    super.destroy();
  }
}
