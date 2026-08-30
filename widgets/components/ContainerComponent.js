/**
 * ContainerComponent.js
 * Renderer for core.container (Layout-only grouping with flex/grid direction and gap)
 */

import { BaseComponent } from './BaseComponent.js';

export class ContainerComponent extends BaseComponent {
  render() {
    super.render();
    this.element.classList.add('fd-comp-container');

    const props = this.def.props || {};
    const direction = props.direction || 'row'; // 'row' | 'column' | 'grid'
    const gap = props.gap !== undefined ? props.gap : 4;

    if (direction === 'grid') {
      const cols = props.columns || 2;
      this.element.style.display = 'grid';
      this.element.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    } else {
      this.element.style.display = 'flex';
      this.element.style.flexDirection = direction;
    }
    this.element.style.gap = `${gap}px`;

    // Render child components if defined
    if (Array.isArray(this.def.components)) {
      this.childRenderers = [];
      this.def.components.forEach((childDef) => {
        const renderer = this.widget.createComponentRenderer(childDef);
        if (renderer) {
          const childNode = renderer.render();
          this.element.appendChild(childNode);
          this.childRenderers.push(renderer);
        }
      });
    }

    return this.element;
  }

  update(val, allState) {
    super.update(val, allState);
    if (this.childRenderers) {
      this.childRenderers.forEach((child) => child.update(val, allState));
    }
  }

  destroy() {
    if (this.childRenderers) {
      this.childRenderers.forEach((child) => child.destroy());
      this.childRenderers = [];
    }
    super.destroy();
  }
}
