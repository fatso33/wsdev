/**
 * ComponentRegistry.js
 * Catalog of known component types and renderers for FDWS v1.2
 */

import { LabelComponent } from './LabelComponent.js';
import { DisplayComponent } from './DisplayComponent.js';
import { InputComponent } from './InputComponent.js';
import { ButtonComponent } from './ButtonComponent.js';
import { IndicatorComponent } from './IndicatorComponent.js';
import { StepperComponent } from './StepperComponent.js';
import { RotaryComponent } from './RotaryComponent.js';
import { ContainerComponent } from './ContainerComponent.js';
import { ImageComponent } from './ImageComponent.js';
import { GaugeComponent } from './GaugeComponent.js';
import { SliderComponent } from './SliderComponent.js';
import { SelectorComponent } from './SelectorComponent.js';
import { RockerComponent } from './RockerComponent.js';
import { ListComponent } from './ListComponent.js';
import { RefComponent } from './RefComponent.js';
import { PadComponent } from './PadComponent.js';
import { DividerComponent } from './DividerComponent.js';
import { TapeComponent } from './TapeComponent.js';
import { BaseComponent } from './BaseComponent.js';
import { SecurityValidator } from '../../core/SecurityValidator.js';

class UnsupportedComponent extends BaseComponent {
  render() {
    super.render();
    this.element.classList.add('fd-comp-unsupported');
    this.element.style.border = '1px dashed var(--btn-border, #333)';
    this.element.style.display = 'flex';
    this.element.style.alignItems = 'center';
    this.element.style.justifyContent = 'center';
    this.element.style.color = 'var(--text-dim, #888)';
    this.element.style.fontSize = '10px';
    this.element.style.padding = '4px';

    const text = document.createElement('span');
    SecurityValidator.setText(text, `[${this.def.type || 'Unknown'}]`);
    this.element.appendChild(text);
    return this.element;
  }
}

export class ComponentRegistry {
  static catalog = new Map([
    ['core.label', { type: 'core.label', classRef: LabelComponent }],
    ['core.display', { type: 'core.display', classRef: DisplayComponent }],
    ['core.input', { type: 'core.input', classRef: InputComponent }],
    ['core.button', { type: 'core.button', classRef: ButtonComponent }],
    ['core.indicator', { type: 'core.indicator', classRef: IndicatorComponent }],
    ['core.stepper', { type: 'core.stepper', classRef: StepperComponent }],
    ['core.rotary', { type: 'core.rotary', classRef: RotaryComponent }],
    ['core.container', { type: 'core.container', classRef: ContainerComponent }],
    ['core.image', { type: 'core.image', classRef: ImageComponent }],
    ['core.gauge', { type: 'core.gauge', classRef: GaugeComponent }],
    ['core.slider', { type: 'core.slider', classRef: SliderComponent }],
    ['core.selector', { type: 'core.selector', classRef: SelectorComponent }],
    ['core.rocker', { type: 'core.rocker', classRef: RockerComponent }],
    ['core.list', { type: 'core.list', classRef: ListComponent }],
    ['core.ref', { type: 'core.ref', classRef: RefComponent }],
    ['core.pad', { type: 'core.pad', classRef: PadComponent }],
    ['core.divider', { type: 'core.divider', classRef: DividerComponent }],
    ['core.tape', { type: 'core.tape', classRef: TapeComponent }]
  ]);

  /**
   * Retrieves renderer class for component type, with safe placeholder fallback (§4.1 Rule 3)
   * @param {string} type
   * @returns {typeof BaseComponent}
   */
  static getRenderer(type) {
    const entry = this.catalog.get(type);
    if (!entry) {
      console.warn(`[ComponentRegistry] Unsupported component type: "${type}". Using safe fallback placeholder.`);
      return UnsupportedComponent;
    }
    return entry.classRef;
  }

  /**
   * Registers a new or custom component renderer (for vendor extensions)
   * @param {string} type
   * @param {typeof BaseComponent} classRef
   */
  static registerComponent(type, classRef) {
    this.catalog.set(type, { type, classRef });
  }
}
