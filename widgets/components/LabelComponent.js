/**
 * LabelComponent.js
 * Renderer for core.label (Static or telemetry-bound text label)
 */

import { BaseComponent } from './BaseComponent.js';
import { SecurityValidator } from '../../core/SecurityValidator.js';

export class LabelComponent extends BaseComponent {
  render() {
    super.render();
    this.element.classList.add('fd-comp-label');

    const props = this.def.props || {};
    const textSpan = document.createElement('span');
    textSpan.className = 'fd-comp-label-text';

    // FDWS v1.8 §1.1: props.align is core.label's pre-v1.8, undocumented,
    // horizontal-only alignment field, superseded by the generic style.align.h
    // (handled in BaseComponent.applyStyles()) but kept as a renderer fallback for
    // widgets authored before v1.8 — only applies when style.align.h is absent, so a
    // widget migrated to style.align (by Studio, or by hand) always wins.
    if (props.align && !this.def.style?.align?.h) {
      this.element.style.justifyContent = props.align === 'center' ? 'center' : (props.align === 'right' ? 'flex-end' : 'flex-start');
      this.element.style.textAlign = props.align;
    }

    if (props.truncate) {
      textSpan.style.whiteSpace = 'nowrap';
      textSpan.style.overflow = 'hidden';
      textSpan.style.textOverflow = 'ellipsis';
    }

    const initialText = props.text !== undefined ? props.text : (this.def.label || '');
    SecurityValidator.setText(textSpan, initialText);

    this.labelNode = textSpan;
    this.element.appendChild(textSpan);

    // labelNode didn't exist yet when super.render() ran applyStyles(), so its
    // typography/offset cascade was skipped on that first pass — redo it now that
    // the text span actually exists.
    this.applyStyles();

    return this.element;
  }

  update(val, allState) {
    super.update(val, allState);
    if (this.labelNode) {
      // Bug (found 2026-08-28): this used `this.def.props?.text || this.def.label`,
      // which treats an intentionally-empty props.text ("") as falsy and falls
      // through to def.label — the authoring-time Studio display name (e.g.
      // "COM 1 BG"), never meant to render. Harmless-looking whenever a
      // component's own typography color happened to match its background
      // (the "hide leftover placeholder text" trick documented in
      // ThemeColor.js), since the wrong text was rendered but invisible —
      // exposed the moment either color changes independently, e.g. a
      // FDWS v1.18 manual theme override. render() above already got this
      // right with an explicit `!== undefined` check; update() now matches it.
      const displayVal = val !== undefined && val !== null
        ? val
        : (this.def.props?.text !== undefined ? this.def.props.text : (this.def.label || ''));
      SecurityValidator.setText(this.labelNode, displayVal);
    }
  }
}
