/**
 * BaseComponent.js
 * Base renderer class for FDWS v1.2 components
 */

import { SecurityValidator } from '../../core/SecurityValidator.js';
import { evaluateConditionExpr, resolveActiveRuleStyle } from './ConditionEvaluator.js';
import { resolveThemedColors, resolveThemedBackground } from './ThemeColor.js';

export class BaseComponent {
  /**
   * @param {object} def - Component envelope definition
   * @param {import('../CompositeWidget.js').CompositeWidget} widget - Parent CompositeWidget instance
   */
  constructor(def, widget) {
    this.def = def;
    this.widget = widget;
    this.element = null;
    this.currentValue = null;
    this.activeStateName = 'inactive';
  }

  /**
   * Renders the component DOM node and applies layout/layering styles
   * @returns {HTMLElement}
   */
  render() {
    this.element = document.createElement('div');
    this.element.className = `fd-comp fd-comp-${this.def.type.replace('.', '-')}`;
    this.element.dataset.compId = this.def.id;

    // Apply grid placement on widget's internal grid
    this.applyLayout();

    // Apply v1.1 Layer properties
    this.applyLayering();

    // Apply visual styling (cascade: widget style -> component style)
    this.applyStyles();

    // Attach interaction triggers
    this.attachInteractions();

    return this.element;
  }

  /**
   * Positions component on internal sub-grid
   */
  applyLayout() {
    if (!this.element || !this.def.layout) return;
    const { col = 1, row = 1, w = 1, h = 1 } = this.def.layout;
    this.element.style.gridColumnStart = `${Math.max(1, col)}`;
    this.element.style.gridColumnEnd = `span ${Math.max(1, w)}`;
    this.element.style.gridRowStart = `${Math.max(1, row)}`;
    this.element.style.gridRowEnd = `span ${Math.max(1, h)}`;
  }

  /**
   * FDWS v1.2 §1.1 hit-testing rule: resolves the effective pointer-events value.
   * An explicit author-set 'auto'/'none' is always respected. When unset, the
   * component is 'auto' iff: its type is unconditionally interactive by contract
   * (core.button, core.input), OR it declares a non-empty interactions[], OR its
   * binding includes a write-capable field (pushEvent/writeEvent/ackEvent).
   * core.gauge and core.image never qualify via contract or write-capable binding —
   * only an explicit interactions[] can make them 'auto'.
   * @returns {'auto'|'none'}
   */
  resolvePointerEvents() {
    const layer = this.def.layer || {};
    const type = this.def.type;
    const alwaysDisplayOnly = type === 'core.gauge' || type === 'core.image';

    if (!alwaysDisplayOnly && (layer.pointerEvents === 'none' || layer.pointerEvents === 'auto')) {
      return layer.pointerEvents;
    }

    const hasInteractions = Array.isArray(this.def.interactions) && this.def.interactions.length > 0;
    if (hasInteractions) return 'auto';

    if (alwaysDisplayOnly) return 'none';

    const contractInteractiveTypes = ['core.button', 'core.input'];
    if (contractInteractiveTypes.includes(type)) return 'auto';

    const binding = this.def.binding || {};
    if (binding.pushEvent || binding.writeEvent || binding.ackEvent) return 'auto';

    return 'none';
  }

  /**
   * Applies CSS transition timing from an FDWS v1.2 binding.transition object.
   * @param {HTMLElement} el
   * @param {{durationMs?: number, easing?: string}} [transition]
   * @param {string} [property='all']
   */
  applyTransition(el, transition, property = 'all') {
    if (!el) return;
    if (!transition || !transition.durationMs) {
      el.style.transition = '';
      return;
    }
    const easingMap = { linear: 'linear', 'ease-out': 'ease-out', 'ease-in-out': 'ease-in-out' };
    const easing = easingMap[transition.easing] || 'ease-out';
    el.style.transition = `${property} ${transition.durationMs}ms ${easing}`;
  }

  /**
   * Applies v1.2 Layer & Hit-Testing properties
   */
  applyLayering() {
    if (!this.element) return;
    const layer = this.def.layer || {};

    // Pointer events: 'auto' | 'none'
    this.element.style.pointerEvents = this.resolvePointerEvents();

    // Clip to bounds
    if (layer.clipToBounds) {
      this.element.style.overflow = 'hidden';
    } else {
      this.element.style.overflow = 'visible';
    }

    // Explicit z-index if layer.z is specified
    if (typeof this.def._effectiveZ === 'number') {
      this.element.style.zIndex = `${this.def._effectiveZ}`;
    }
  }

  /**
   * Resolves styles and background (solid, gradient, image) with state variants
   * and — FDWS v1.15 — conditional style.rules.
   * @param {string} [stateOverride]
   * @param {object} [ruleAllState] - when provided (Widget Studio 2.0, Phase 2:
   *   passed from update() whenever this.def.style.rules is non-empty),
   *   evaluates style.rules against it and merges the first matching rule's
   *   style at the HIGHEST precedence — above per-state style, above base
   *   style. Omitted at initial render() time (no telemetry yet); update()
   *   re-invokes with the live allState once it exists.
   */
  applyStyles(stateOverride, ruleAllState) {
    if (!this.element) return;

    const style = this.def.style || {};
    const stateName = stateOverride || this.activeStateName;
    const stateStyle = (style.states && style.states[stateName]) || {};
    // FDWS v1.15 §style.rules: first-match-wins conditional style override,
    // reusing visibleWhen's own condition grammar (ConditionEvaluator.js) —
    // visibleWhen decides WHETHER this component renders; style.rules decides
    // WHICH style it renders with (e.g. a readout turning red past a limit,
    // amber approaching it — or, combined with §3 below, swapping which
    // background image asset is shown per state, for a photorealistic
    // multi-position switch with one photo per position instead of a single
    // continuous CSS transform).
    const ruleStyle = ruleAllState ? resolveActiveRuleStyle(style.rules, ruleAllState, this.widget) : {};

    // Widget-authored colors are literal hex, resolved once here and cascaded
    // to every dependent node below — the app/Studio's light/dark preview never
    // touches those literals directly. getPreviewTheme() is implemented by
    // every widget host (CompositeWidget.js, MockWidgetHost.js, StudioCanvas's
    // Interactive Sim mock) so this stays correct in the PWA runtime AND every
    // Widget Studio preview surface without this file caring which one it is.
    const theme = (typeof this.widget?.getPreviewTheme === 'function') ? this.widget.getPreviewTheme() : 'dark';
    // FDWS v1.18: baseTheme (which theme style.* was authored for) and
    // themeMode ('auto' derives the other theme same as always; 'manual' lets
    // style.themeOverride replace it field-by-field) — every widget host
    // implements this alongside getPreviewTheme() (CompositeWidget.js,
    // MockWidgetHost.js, StudioCanvas's own mock). Missing the method (an
    // older/simplified host) degrades to the pre-v1.18 default: dark-authored,
    // always auto-derive.
    const themeConfig = (typeof this.widget?.getThemeConfig === 'function')
      ? this.widget.getThemeConfig()
      : { baseTheme: 'dark', themeMode: 'auto' };
    const colorCtx = { componentType: this.def.type, layerGroup: this.def.layer?.group };
    // FDWS v1.18: only the BASE style object's own themeOverride applies — a
    // state/rule-variant override isn't supported (those are already dynamic/
    // conditional; manual per-theme tuning is for the component's steady-state
    // look), so this reads style.themeOverride, not stateStyle/ruleStyle's.
    const themeOverride = style.themeOverride || {};

    // Merged up front (rather than inline in each numbered section below) so
    // all three raw literal colors are available together for
    // resolveThemedColors() — it needs to see typography/border/background
    // TOGETHER to preserve an intentional exact match between them (e.g. an
    // author setting typography.color to the same literal hex as its own
    // background.color, a common trick to hide placeholder text) that deriving
    // each independently would otherwise break.
    const typography = { ...(style.typography || {}), ...(stateStyle.typography || {}), ...(ruleStyle.typography || {}) };
    const border = { ...(style.border || {}), ...(stateStyle.border || {}), ...(ruleStyle.border || {}) };
    const bg = ruleStyle.background || stateStyle.background || style.background;
    const adjustedColors = resolveThemedColors(
      {
        typographyColor: typography.color,
        borderColor: border.color,
        backgroundColor: bg && bg.type === 'color' ? bg.color : undefined
      },
      { typographyColor: themeOverride.typography?.color, borderColor: themeOverride.border?.color },
      colorCtx,
      theme,
      themeConfig.baseTheme,
      themeConfig.themeMode
    );
    const resolvedBg = resolveThemedBackground(bg, themeOverride.background, colorCtx, theme, themeConfig.baseTheme, themeConfig.themeMode);

    // Inner nodes registered by subclasses (btnNode, inputNode, labelNode, valueNode,
    // dotNode, ...) sit between this.element and the visible text/surface the user
    // actually sees. Their CSS classes must not hardcode font/border/background rules,
    // or those would win over anything applied here — see widgets.css. Typography and
    // color are CSS-inherited properties, so cascading them to every text-bearing node
    // (not just this.element) keeps them correct even if a subclass's markup nests
    // several elements deep (e.g. core.indicator's label lives inside an intermediate
    // box). Border/background are not inherited, so they need the same explicit
    // cascade to whichever nodes are the visible surface (button/input).
    const textNodes = [this.btnNode, this.inputNode, this.labelNode, this.valueNode].filter(Boolean);
    // Border/background target exactly ONE node — whichever one is that
    // component type's own canonical bordered/backgrounded surface per its
    // base CSS rule (widgets.css / studio.css), not "every surface-ish node."
    // core.button: .fd-comp-btn-inner (btnNode) already owns background/
    // border/radius by default — the outer wrapper (.fd-comp-button) has
    // none. core.input (and anything else with no btnNode): the wrapper
    // (.fd-comp-input-wrapper) owns it — .fd-comp-input-field is explicitly
    // border:none/background:transparent so the wrapper is the real frame.
    // Writing to BOTH nodes (the old behavior) meant an author-set
    // style.border rendered TWICE for a button — once on the wrapper, once
    // on the inner chip, ~4-6px apart because of the chip's own padding —
    // a visible "double border" (reported live on a popover's Cancel/Save
    // buttons; less visible on inputs only because the wrapper has zero
    // padding, so the two borders land almost exactly on top of each other).
    const surfaceTarget = this.btnNode || this.element;
    // ButtonComponent (and similarly-shaped subclasses) call applyStyles()
    // TWICE — once via super.render() before btnNode exists (so this ran
    // with surfaceTarget === this.element that first time) and once more
    // right after btnNode is created. Without clearing here, the first
    // pass's border/background stays stranded on this.element forever,
    // reintroducing the exact double-border/-background this whole
    // surfaceTarget scheme exists to prevent.
    if (surfaceTarget !== this.element) {
      this.element.style.border = '';
      this.element.style.background = '';
    }

    // 1. Typography
    if (typography.font) {
      this.element.style.fontFamily = typography.font;
      textNodes.forEach((n) => { n.style.fontFamily = typography.font; });
    }
    if (typography.size) {
      const size = typeof typography.size === 'number' ? `${typography.size}px` : typography.size;
      this.element.style.fontSize = size;
      textNodes.forEach((n) => { n.style.fontSize = size; });
    }
    if (typography.weight) {
      this.element.style.fontWeight = typography.weight;
      textNodes.forEach((n) => { n.style.fontWeight = typography.weight; });
    }
    if (typography.color) {
      const resolvedTextColor = adjustedColors.typographyColor;
      this.element.style.color = resolvedTextColor;
      textNodes.forEach((n) => { n.style.color = resolvedTextColor; });
    }
    // FDWS v1.15: text outline — keeps a readout legible over a busy
    // background image without darkening the whole tile. Empty string
    // (not skipped) when unset, so switching styles/rules away from a
    // stroke actually clears a previously-applied one.
    const strokeVal = (typography.stroke && typography.stroke.width)
      ? `${typography.stroke.width}px ${typography.stroke.color || '#000000'}`
      : '';
    this.element.style.webkitTextStroke = strokeVal;
    textNodes.forEach((n) => { n.style.webkitTextStroke = strokeVal; });
    // FDWS v1.15: soft glow/bloom — LCD backlight glow, annunciator bloom.
    const glowVal = (typography.glow && typography.glow.color)
      ? `0 0 ${typography.glow.blur ?? 6}px ${typography.glow.color}`
      : '';
    this.element.style.textShadow = glowVal;
    textNodes.forEach((n) => { n.style.textShadow = glowVal; });

    // 2. Border — see surfaceTarget's comment above for why this writes to
    // exactly one node instead of both the wrapper and an inner surface.
    if (border.width !== undefined) {
      surfaceTarget.style.borderWidth = `${border.width}px`;
      // FDWS v1.17: border.style ('solid'/'dashed'/'dotted') — was always
      // hardcoded 'solid' here; added for core.divider's line-style option,
      // but generic on any component's border since it's just as valid there.
      surfaceTarget.style.borderStyle = border.width > 0 ? (border.style || 'solid') : 'none';
    }
    if (border.color) {
      surfaceTarget.style.borderColor = adjustedColors.borderColor;
    }
    if (border.radius !== undefined) {
      surfaceTarget.style.borderRadius = `${border.radius}px`;
    }

    // 3. Background (none, color, gradient, image) — a rule's background (if
    // its condition matched) wins over per-state, which wins over base. This
    // is what lets a photorealistic multi-position switch swap its
    // background image per state entirely via style.rules, instead of
    // needing a continuous transform.
    if (resolvedBg) {
      if (resolvedBg.type === 'none') {
        surfaceTarget.style.background = 'transparent';
      } else if (resolvedBg.type === 'color' && resolvedBg.color) {
        surfaceTarget.style.background = resolvedBg.color;
      } else if (resolvedBg.type === 'gradient' && resolvedBg.gradient) {
        surfaceTarget.style.background = resolvedBg.gradient;
      } else if (resolvedBg.type === 'image' && resolvedBg.image) {
        const assetUrl = this.widget.resolveAssetUrl(resolvedBg.image.assetId);
        if (assetUrl) {
          surfaceTarget.style.backgroundImage = `url("${assetUrl}")`;
          surfaceTarget.style.backgroundSize = resolvedBg.image.fit || 'cover';
          surfaceTarget.style.backgroundPosition = resolvedBg.image.position || 'center';
          surfaceTarget.style.backgroundRepeat = resolvedBg.image.fit === 'tile' ? 'repeat' : 'no-repeat';
        }
      }
    }

    // 4. Alignment (FDWS v1.8 §1.1) — every component wrapper (this.element) is
    // already a flex container (base .fd-comp rule), so h/v alignment is just
    // justify-content/align-items there. But several component types (core.display's
    // value box, core.button's inner <button>, core.indicator's tile box) render an
    // intermediate node that itself fills the wrapper edge-to-edge (width/height:100%)
    // and is itself a flex container centering its own children — the wrapper's
    // alignment has no visible effect there, so the same justify/align must also land
    // on that inner "boxNode" (registered by the subclass) directly. core.input is a
    // further special case: it fills its box for the same reason, but has no children
    // to flex-align — h instead sets the input's own text-align, and v is a
    // deliberate no-op there (use offset.y instead, see below).
    const align = { ...(style.align || {}), ...(stateStyle.align || {}), ...(ruleStyle.align || {}) };
    const fillNodes = [this.boxNode, this.btnNode].filter(Boolean);
    if (align.h) {
      const justify = align.h === 'left' ? 'flex-start' : align.h === 'right' ? 'flex-end' : 'center';
      this.element.style.justifyContent = justify;
      fillNodes.forEach((n) => { n.style.justifyContent = justify; });
      if (this.inputNode) this.inputNode.style.textAlign = align.h;
    }
    if (align.v) {
      const items = align.v === 'top' ? 'flex-start' : align.v === 'bottom' ? 'flex-end' : 'center';
      this.element.style.alignItems = items;
      fillNodes.forEach((n) => { n.style.alignItems = items; });
    }

    // 5. Fine-position offset (FDWS v1.8 §1.2) — a small paint-only pixel nudge on
    // top of whatever align (or the type's default) already produced, layered onto
    // whichever inner content node this component type registered. Doesn't affect
    // layout/hit-testing (transform, not position/margin).
    const offset = { ...(style.offset || {}), ...(stateStyle.offset || {}), ...(ruleStyle.offset || {}) };
    // 6. Orientation (FDWS v1.15) — rotates this component's text, for
    // vertically-mounted placards and rotary-style side labels. 90/270 use
    // `writing-mode` for proper vertical typesetting (glyphs upright,
    // reading top-to-bottom or bottom-to-top) rather than a sideways-rotated
    // horizontal line; 180 (upside-down) has no writing-mode equivalent, so
    // it composes into the same transform as the offset nudge below —
    // both target the same single node, so they're combined into one
    // `transform` value rather than one silently overwriting the other.
    const orientation = ruleStyle.orientation ?? stateStyle.orientation ?? style.orientation ?? 0;
    const transformTarget = this.labelNode || this.valueNode || this.inputNode || this.btnNode || this.dotNode;
    if (transformTarget) {
      const transformParts = [];
      if (offset.x || offset.y) transformParts.push(`translate(${offset.x || 0}px, ${offset.y || 0}px)`);
      if (orientation === 180) transformParts.push('rotate(180deg)');
      transformTarget.style.transform = transformParts.join(' ');
      if (orientation === 90) {
        transformTarget.style.writingMode = 'vertical-rl';
        transformTarget.style.textOrientation = 'mixed';
      } else if (orientation === 270) {
        transformTarget.style.writingMode = 'vertical-lr';
        transformTarget.style.textOrientation = 'mixed';
      } else {
        transformTarget.style.writingMode = '';
      }
    }
  }

  /**
   * Attaches declared interaction event handlers
   */
  attachInteractions() {
    if (!this.element || !Array.isArray(this.def.interactions) || this.def.interactions.length === 0) {
      return;
    }

    const hasTap = this.def.interactions.some((i) => i.trigger === 'tap');
    const hasLongpress = this.def.interactions.some((i) => i.trigger === 'longpress');

    if (hasTap || hasLongpress) {
      let pressTimer = null;
      let didLongPress = false;
      let startX = 0;
      let startY = 0;

      const onPointerDown = (e) => {
        if (this.resolvePointerEvents() === 'none' || this.isInteractionBlocked()) return;
        didLongPress = false;
        startX = e.clientX;
        startY = e.clientY;

        if (hasLongpress) {
          clearTimeout(pressTimer);
          pressTimer = setTimeout(() => {
            didLongPress = true;
            this.widget?.handleInteraction?.(this.def, 'longpress', { originalEvent: e });
          }, 500);
        }
      };

      const onPointerUp = (e) => {
        if (this.resolvePointerEvents() === 'none' || this.isInteractionBlocked()) return;
        clearTimeout(pressTimer);
        const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
        if (!didLongPress && dist < 12 && hasTap) {
          this.widget?.handleInteraction?.(this.def, 'tap', { originalEvent: e });
        }
      };

      const onPointerCancel = () => {
        clearTimeout(pressTimer);
      };

      this.element.addEventListener('pointerdown', onPointerDown);
      this.element.addEventListener('pointerup', onPointerUp);
      this.element.addEventListener('pointercancel', onPointerCancel);
    }
  }

  /**
   * Updates component value from telemetry or local state
   * @param {any} val
   * @param {object} [allState]
   */
  update(val, allState) {
    this.currentValue = val;
    this.applyVisibility(allState);
    // FDWS v1.15 §style.rules: re-run the style cascade against live state so
    // a rule's condition can react to new telemetry/local-state — but ONLY
    // when this component actually declares rules, so a widget that doesn't
    // use conditional formatting pays zero extra cost on every update (this
    // can fire at Fast-tier ~100Hz for a pollFrequencyHz-bound component).
    if (Array.isArray(this.def.style?.rules) && this.def.style.rules.length > 0) {
      this.applyStyles(undefined, allState);
    }
  }

  /**
   * Evaluates visibleWhen expression and toggles visibility.
   * FDWS v1.2 §2.4: visibleWhen may be a single {state, ...} predicate (v1.1 form,
   * treated as an implicit single-condition allOf) or a compound {allOf:[...]}/{anyOf:[...]}
   * expression that nests arbitrarily, with gt/gte/lt/lte/between comparison operators
   * alongside the existing equals/notEquals.
   * @param {object} allState
   */
  applyVisibility(allState = {}) {
    if (!this.element) return;
    const { visibleWhen } = this.def;
    if (!visibleWhen || typeof visibleWhen !== 'object') {
      this.element.style.display = '';
      return;
    }

    const isVisible = this.evaluateVisibilityExpr(visibleWhen, allState);
    this.element.style.display = isVisible ? '' : 'none';
  }

  /**
   * Recursively evaluates a visibleWhen predicate/compound expression.
   * @param {object} expr
   * @param {object} allState
   * @returns {boolean}
   */
  evaluateVisibilityExpr(expr, allState) {
    return evaluateConditionExpr(expr, allState, this.widget);
  }

  /**
   * FDWS v1.2 §2.2: builds a guard overlay for a guarded control (core.button,
   * core.selector, core.rocker). Call from the subclass's render() and append the
   * returned node last (on top). While closed, isInteractionBlocked() returns true
   * so the subclass's own interaction handlers can bail out.
   * @returns {HTMLElement|null}
   */
  setupGuard() {
    const guard = this.def.layout?.guard;
    if (!guard || !guard.enabled) return null;

    this._guardOpen = false;
    this._guardAutoCloseTimer = null;

    const overlay = document.createElement('div');
    overlay.className = 'fd-guard-overlay fd-guard-closed';

    const img = document.createElement('img');
    img.className = 'fd-guard-img';
    img.alt = 'Guard';
    overlay.appendChild(img);
    this._guardImgNode = img;

    const setAsset = (assetId) => {
      const url = assetId ? this.widget?.resolveAssetUrl?.(assetId) : null;
      if (url) img.src = url;
      else img.removeAttribute('src');
    };
    setAsset(guard.closedAsset);

    const closeGuard = (e) => {
      if (!this._guardOpen) return;
      this._guardOpen = false;
      clearTimeout(this._guardAutoCloseTimer);
      overlay.classList.remove('fd-guard-open');
      overlay.classList.add('fd-guard-closed');
      overlay.style.pointerEvents = 'auto';
      setAsset(guard.closedAsset);
      this.widget?.handleInteraction?.(this.def, 'guardClose', { originalEvent: e });
    };
    this._closeGuard = closeGuard;

    const openGuard = (e) => {
      if (this._guardOpen) return;
      this._guardOpen = true;
      overlay.classList.remove('fd-guard-closed');
      overlay.classList.add('fd-guard-open');
      overlay.style.pointerEvents = 'none';
      setAsset(guard.openAsset);
      this.widget?.handleInteraction?.(this.def, 'guardOpen', { originalEvent: e });
      if (guard.autoCloseAfterMs) {
        clearTimeout(this._guardAutoCloseTimer);
        this._guardAutoCloseTimer = setTimeout(() => closeGuard(e), guard.autoCloseAfterMs);
      }
    };

    overlay.addEventListener('click', (e) => {
      e.stopPropagation();
      if (this._guardOpen) closeGuard(e);
      else openGuard(e);
    });

    return overlay;
  }

  /**
   * True while a declared guard is closed and interactions should not dispatch.
   * @returns {boolean}
   */
  isInteractionBlocked() {
    const guard = this.def.layout?.guard;
    if (!guard || !guard.enabled) return false;
    return !this._guardOpen;
  }

  /**
   * Sets active visual state variant ('active', 'inactive', 'warning', etc.)
   * @param {string} stateName
   */
  setState(stateName) {
    if (this.activeStateName !== stateName) {
      this.activeStateName = stateName;
      this.applyStyles();
    }
  }

  destroy() {
    clearTimeout(this._guardAutoCloseTimer);
    if (this.element && this.element.parentNode) {
      this.element.parentNode.removeChild(this.element);
    }
    this.element = null;
  }
}
