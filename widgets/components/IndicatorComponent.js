/**
 * IndicatorComponent.js
 * Renderer for core.indicator (LED, annunciator flag, and warning tile)
 */

import { BaseComponent } from './BaseComponent.js';
import { SecurityValidator } from '../../core/SecurityValidator.js';

export class IndicatorComponent extends BaseComponent {
  render() {
    super.render();
    this.element.classList.add('fd-comp-indicator');

    const props = this.def.props || {};
    const shape = props.shape || 'tile'; // 'dot' | 'tile'
    // FDWS v1.2 §2.4: props.severity may be a static string (v1.1) or a computed
    // { bindingRef, thresholds[] } object resolved per-update — see resolveSeverity().
    const severity = typeof props.severity === 'string' ? props.severity : 'status';
    this._currentSeverityLevel = severity;

    this.element.classList.add(`fd-ind-shape-${shape}`, `fd-ind-sev-${severity}`);

    const indBox = document.createElement('div');
    indBox.className = `fd-ind-box fd-ind-${shape}`;

    if (shape === 'dot') {
      const dot = document.createElement('span');
      dot.className = 'fd-ind-dot';
      indBox.appendChild(dot);
      this.dotNode = dot;
    }

    const labelText = props.label !== undefined ? props.label : (this.def.label || '');
    if (labelText) {
      const label = document.createElement('span');
      label.className = 'fd-ind-label';
      SecurityValidator.setText(label, labelText);
      indBox.appendChild(label);
      this.labelNode = label;
    }

    this.boxNode = indBox;
    this.element.appendChild(indBox);

    // Neither labelNode nor boxNode existed yet when super.render() ran
    // applyStyles(), so the typography/alignment cascade was skipped on that first
    // pass — redo it now both exist. indBox (boxNode) fills the wrapper edge-to-edge
    // and is itself the flex container centering the label, so FDWS v1.8 align needs
    // to land there directly, not just on the (now-irrelevant) outer wrapper.
    this.applyStyles();

    return this.element;
  }

  update(val, allState) {
    super.update(val, allState);
    // FDWS v1.15: binding.testStateVar — when the referenced local state var
    // is truthy, this indicator lights regardless of its own bound value.
    // Purely declarative "lamp test" support: an author wires one shared
    // state var (e.g. "lampTest") into every indicator's testStateVar, and a
    // single button toggling that one var lights every annunciator at once —
    // no special broadcast action needed, no runtime change beyond this OR.
    const testVar = this.def.binding?.testStateVar;
    const isTestActive = testVar ? Boolean((allState || {})[testVar]) : false;
    const isActive = isTestActive || Boolean(val);
    this.element.classList.toggle('active', isActive);
    this.setState(isActive ? 'active' : 'inactive');

    const props = this.def.props || {};
    if (props.severity && typeof props.severity === 'object') {
      const level = this.resolveSeverity(props.severity, val, allState);
      if (level && level !== this._currentSeverityLevel) {
        this.element.classList.remove(`fd-ind-sev-${this._currentSeverityLevel}`);
        this.element.classList.add(`fd-ind-sev-${level}`);
        this._currentSeverityLevel = level;
      }
    }
  }

  /**
   * FDWS v1.2 §2.4: resolves a computed severity object against its bound value.
   * @param {{bindingRef: string, thresholds: Array<{max?: number, level: string}>}} severityDef
   * @param {any} val - This component's own bound value
   * @param {object} allState - All widget local state
   * @returns {string|null}
   */
  resolveSeverity(severityDef, val, allState = {}) {
    const source = severityDef.bindingRef === 'binding' || !severityDef.bindingRef
      ? val
      : allState[severityDef.bindingRef];
    const num = Number(source);
    if (isNaN(num) || !Array.isArray(severityDef.thresholds)) return null;

    for (const t of severityDef.thresholds) {
      if (t.max === undefined || num <= Number(t.max)) {
        return t.level;
      }
    }
    return null;
  }
}
