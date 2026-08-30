/**
 * ButtonComponent.js
 * Renderer for core.button (Momentary, toggle, swap, and preset chips)
 */

import { BaseComponent } from './BaseComponent.js';
import { SecurityValidator } from '../../core/SecurityValidator.js';
import { readStateRef } from '../utils/StateRefPath.js';

export class ButtonComponent extends BaseComponent {
  render() {
    super.render();
    this.element.classList.add('fd-comp-button');

    const props = this.def.props || {};
    const binding = this.def.binding || {};
    const variant = props.variant || 'momentary';
    this.element.classList.add(`fd-btn-var-${variant}`);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `fd-comp-btn-inner fd-btn-${variant}`;
    if (this.def.layer?.pointerEvents === 'none') {
      btn.style.pointerEvents = 'none';
    }

    // Icon support
    if (props.icon || variant === 'swap') {
      const iconSpan = document.createElement('span');
      iconSpan.className = 'fd-comp-btn-icon';
      if (props.icon === 'swap' || variant === 'swap') {
        iconSpan.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m16 3 4 4-4 4"></path><path d="M20 7H4"></path><path d="m8 21-4-4 4-4"></path><path d="M4 17h16"></path></svg>`;
      } else if (props.icon.startsWith('<svg')) {
        iconSpan.innerHTML = props.icon;
      } else {
        iconSpan.textContent = props.icon;
      }
      btn.appendChild(iconSpan);
    }

    // FDWS v1.14: binding.stateRef — the same nested/indexed-path mechanism
    // core.label/core.display already use — optionally drives this button's
    // primary label reactively; binding.sublabelStateRef does the same for
    // the sublabel. Unlike core.label's nullish-only fallback (which lets a
    // genuinely-empty bound value render blank), an EMPTY resolved value
    // here (not just undefined/null) falls back to props.label/
    // props.sublabel — so one static field does double duty as both "no
    // binding set" text and "bound but not configured yet" placeholder,
    // replacing what the removed props.emptyLabel used to do. Supersedes
    // the v1.9–v1.13 props.presetSlot/props.emptyLabel/variant:"preset"
    // mechanism entirely (removed in v1.14 — see that spec's §0 for why).
    const hasLabelRef = binding.stateRef !== undefined;
    const hasSublabelRef = binding.sublabelStateRef !== undefined;

    let labelText = props.label !== undefined ? props.label : (this.def.label || '');
    if (hasLabelRef && this.widget?.getLocalState) {
      labelText = readStateRef(this.widget, binding.stateRef) || labelText;
    }

    // A stateRef-bound button's label is inherently dynamic — the span must
    // exist from mount even when the text it would show right now is empty,
    // otherwise update() below has no node to write into once the bound
    // value is actually set, and the button silently never updates again.
    // Every other button keeps the original behavior: no label at all when
    // there's genuinely nothing to show (e.g. an icon-only swap button).
    if ((labelText !== undefined && labelText !== '') || hasLabelRef) {
      const labelSpan = document.createElement('span');
      labelSpan.className = 'fd-comp-btn-label';
      SecurityValidator.setText(labelSpan, labelText);
      btn.appendChild(labelSpan);
      this.labelNode = labelSpan;
    }

    // Sublabel — same "always create the span if a binding exists" reasoning.
    let sublabelText = props.sublabel || '';
    if (hasSublabelRef && this.widget?.getLocalState) {
      sublabelText = readStateRef(this.widget, binding.sublabelStateRef) || sublabelText;
    }
    if (sublabelText || hasSublabelRef) {
      const sublabelSpan = document.createElement('span');
      sublabelSpan.className = 'fd-comp-btn-sublabel';
      SecurityValidator.setText(sublabelSpan, sublabelText);
      btn.appendChild(sublabelSpan);
      this.sublabelNode = sublabelSpan;
    }

    // LED Indicator on button
    if (props.hasLed) {
      const led = document.createElement('span');
      led.className = 'fd-comp-btn-led';
      btn.appendChild(led);
      this.ledNode = led;
    }

    this.btnNode = btn;
    this.element.appendChild(btn);

    // btnNode didn't exist yet when super.render() ran applyStyles(), so its
    // typography/border/background cascade was skipped on that first pass — redo it
    // now that the inner <button> surface actually exists.
    this.applyStyles();

    return this.element;
  }

  update(val, allState) {
    super.update(val, allState);
    const props = this.def.props || {};
    const binding = this.def.binding || {};

    if (binding.stateRef !== undefined && this.labelNode) {
      const fallback = props.label !== undefined ? props.label : (this.def.label || '');
      SecurityValidator.setText(this.labelNode, readStateRef(this.widget, binding.stateRef) || fallback);
    }
    if (binding.sublabelStateRef !== undefined && this.sublabelNode) {
      SecurityValidator.setText(this.sublabelNode, readStateRef(this.widget, binding.sublabelStateRef) || (props.sublabel || ''));
    }

    if (props.variant === 'toggle') {
      const isActive = Boolean(val);
      this.element.classList.toggle('active', isActive);
      this.setState(isActive ? 'active' : 'inactive');
      if (this.ledNode) {
        this.ledNode.classList.toggle('lit', isActive);
      }
    }
  }
}
