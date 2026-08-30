/**
 * DividerComponent.js
 * Renderer for core.divider (FDWS v1.17) — a plain grid-snapped separator
 * line, horizontal or vertical. Reuses style.border.width/color/style as the
 * line's thickness/color/dash-style rather than inventing a parallel schema,
 * so it's already theme-aware for free (same border color derivation every
 * other component gets from BaseComponent.applyStyles()) and an author edits
 * it with the exact same Border controls as everything else.
 */

import { BaseComponent } from './BaseComponent.js';
import { resolveThemedColor } from './ThemeColor.js';

export class DividerComponent extends BaseComponent {
  render() {
    super.render();
    this.element.classList.add('fd-comp-divider');

    // super.render()'s generic border pass (BaseComponent.applyStyles) has no
    // notion of "one edge only" — it always writes a uniform 4-side border
    // straight onto this.element, which would show as a faint box around the
    // line. Clear it; the line itself is drawn on a dedicated inner node
    // below instead, colored/sized independently.
    this.element.style.border = 'none';

    const line = document.createElement('div');
    line.className = 'fd-comp-divider-line';
    this.element.appendChild(line);
    this.lineNode = line;

    this.applyLine();

    return this.element;
  }

  update(val, allState) {
    super.update(val, allState);
    // Base's style.rules re-run (see BaseComponent.update()) only touches
    // this.element's generic border, not lineNode — re-derive the line too
    // whenever a rule could have changed it.
    if (Array.isArray(this.def.style?.rules) && this.def.style.rules.length > 0) {
      this.applyLine();
    }
  }

  applyLine() {
    if (!this.lineNode) return;
    const border = this.def.style?.border || {};
    const theme = (typeof this.widget?.getPreviewTheme === 'function') ? this.widget.getPreviewTheme() : 'dark';
    const themeConfig = (typeof this.widget?.getThemeConfig === 'function')
      ? this.widget.getThemeConfig()
      : { baseTheme: 'dark', themeMode: 'auto' };
    const colorCtx = { componentType: this.def.type, layerGroup: this.def.layer?.group, colorKind: 'border' };
    // FDWS v1.18: reuses the same style.themeOverride.border.color every other
    // component's border can carry manually — see BaseComponent.applyStyles().
    const overrideColor = this.def.style?.themeOverride?.border?.color;
    const color = resolveThemedColor(border.color, overrideColor, colorCtx, theme, themeConfig.baseTheme, themeConfig.themeMode)
      || 'var(--card-border, #222736)';
    const thickness = Math.max(1, border.width ?? 2);
    const lineStyle = border.style || 'solid';
    const orientation = this.def.props?.orientation === 'vertical' ? 'vertical' : 'horizontal';

    this.lineNode.style.borderTop = 'none';
    this.lineNode.style.borderLeft = 'none';
    this.lineNode.style.borderRight = 'none';
    this.lineNode.style.borderBottom = 'none';

    if (orientation === 'vertical') {
      this.lineNode.style.width = '0';
      this.lineNode.style.height = '100%';
      this.lineNode.style.borderLeft = `${thickness}px ${lineStyle} ${color}`;
    } else {
      this.lineNode.style.height = '0';
      this.lineNode.style.width = '100%';
      this.lineNode.style.borderTop = `${thickness}px ${lineStyle} ${color}`;
    }
  }
}
