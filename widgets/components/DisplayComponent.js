/**
 * DisplayComponent.js
 * Renderer for core.display (Read-only formatted telemetry readout)
 *
 * FDWS v1.20 §4: `props.format: "ODOMETER"` renders a mechanical rolling-digit-drum
 * readout (classic 3-drum altimeter style) instead of plain text — each digit
 * position is its own vertically-scrolling "0123456789" strip, generated purely from
 * a digit count, not an artist-drawn asset. Simplified model: every digit's strip
 * position is computed directly as `(value / 10^place) % 10`, so all drums move
 * continuously and proportionally to the value — not true mechanical
 * carry-only-at-rollover behavior (where a higher digit only turns during the brief
 * moment the digit to its right passes through 9→0), which would need each digit's
 * position to depend on its neighbor's own fractional state. This reads convincingly
 * close for the additional complexity it avoids, and can be refined later without
 * any FDWS/authoring change (it's purely a rendering-side detail of one format).
 */

import { BaseComponent } from './BaseComponent.js';
import { ValueFormatter } from './ValueFormatter.js';
import { SecurityValidator } from '../../core/SecurityValidator.js';

const ODOMETER_STRIP_CHARS = '0123456789'.split('');
// One extra trailing '0' so the strip can scroll seamlessly through the 9→0
// wrap instead of snapping backward across ten positions.
const ODOMETER_STRIP_LENGTH = ODOMETER_STRIP_CHARS.length + 1;

export class DisplayComponent extends BaseComponent {
  render() {
    super.render();
    this.element.classList.add('fd-comp-display');

    const props = this.def.props || {};

    if (props.format === 'ODOMETER') {
      this.renderOdometer(props);
      return this.element;
    }

    const readoutBox = document.createElement('div');
    readoutBox.className = 'fd-comp-display-box';

    if (props.prefix) {
      const prefixEl = document.createElement('span');
      prefixEl.className = 'fd-comp-display-prefix';
      SecurityValidator.setText(prefixEl, props.prefix);
      readoutBox.appendChild(prefixEl);
    }

    const valueEl = document.createElement('span');
    valueEl.className = 'fd-comp-display-value';
    // FDWS v1.2 §2.3: props.literalOverride replaces the FIXED_0/FIXED_1 "always show
    // this constant" hack, bypassing format/val entirely when present.
    const initialFormatted = props.literalOverride !== undefined
      ? String(props.literalOverride)
      : ValueFormatter.format(
        props.defaultValue !== undefined ? props.defaultValue : null,
        props.format || 'RAW_INT',
        '',
        '',
        // FDWS v1.15 fix: props.coordAxis ('lat'|'lon') was never threaded
        // through to ValueFormatter's opts.axis before this — LATLON_DMS (and
        // now COORD_DECIMAL) silently always rendered N/S hemisphere labels,
        // even for a longitude-bound value that should show E/W.
        { decimals: props.decimals, axis: props.coordAxis }
      );
    SecurityValidator.setText(valueEl, initialFormatted);
    readoutBox.appendChild(valueEl);

    if (props.suffix) {
      const suffixEl = document.createElement('span');
      suffixEl.className = 'fd-comp-display-suffix';
      SecurityValidator.setText(suffixEl, props.suffix);
      readoutBox.appendChild(suffixEl);
    }

    // FDWS v1.2 §3.4: binding.transition — smooth value interpolation instead of snap.
    this.applyTransition(valueEl, this.def.binding?.transition, 'color');

    this.valueNode = valueEl;
    this.boxNode = readoutBox;
    this.element.appendChild(readoutBox);

    // Neither node existed yet when super.render() ran applyStyles(), so the
    // typography/alignment cascade was skipped on that first pass — redo it now that
    // both actually exist. readoutBox (boxNode) fills the wrapper edge-to-edge and is
    // itself the flex container centering prefix/value/suffix, so FDWS v1.8 align
    // needs to land there directly, not just on the (now-irrelevant) outer wrapper.
    this.applyStyles();

    return this.element;
  }

  /**
   * @param {object} props
   */
  renderOdometer(props) {
    const digitCount = Math.max(1, Number(props.odometerDigits) || 5);
    const readoutBox = document.createElement('div');
    readoutBox.className = 'fd-comp-display-box fd-odometer-box';
    readoutBox.style.display = 'flex';
    readoutBox.style.flexDirection = 'row';
    readoutBox.style.overflow = 'hidden';

    if (props.prefix) {
      const prefixEl = document.createElement('span');
      prefixEl.className = 'fd-comp-display-prefix';
      SecurityValidator.setText(prefixEl, props.prefix);
      readoutBox.appendChild(prefixEl);
    }

    const drumsWrap = document.createElement('div');
    drumsWrap.className = 'fd-odometer-drums';
    drumsWrap.style.display = 'flex';
    drumsWrap.style.flexDirection = 'row';
    drumsWrap.style.overflow = 'hidden';
    drumsWrap.style.height = '100%';

    const drums = [];
    for (let i = digitCount - 1; i >= 0; i--) {
      const digitWindow = document.createElement('div');
      digitWindow.className = 'fd-odometer-digit-window';
      digitWindow.style.overflow = 'hidden';
      digitWindow.style.height = '100%';
      digitWindow.style.flex = '1 1 0';
      digitWindow.style.position = 'relative';

      const strip = document.createElement('div');
      strip.className = 'fd-odometer-digit-strip';
      strip.style.position = 'absolute';
      strip.style.left = '0';
      strip.style.right = '0';
      strip.style.top = '0';
      strip.style.height = `${ODOMETER_STRIP_LENGTH * 100}%`;
      strip.style.display = 'flex';
      strip.style.flexDirection = 'column';
      this.applyTransition(strip, this.def.binding?.transition, 'transform');

      [...ODOMETER_STRIP_CHARS, '0'].forEach((ch) => {
        const digitEl = document.createElement('div');
        digitEl.className = 'fd-odometer-digit';
        digitEl.style.flex = `1 1 ${100 / ODOMETER_STRIP_LENGTH}%`;
        digitEl.style.display = 'flex';
        digitEl.style.alignItems = 'center';
        digitEl.style.justifyContent = 'center';
        digitEl.textContent = ch;
        strip.appendChild(digitEl);
      });

      digitWindow.appendChild(strip);
      drumsWrap.appendChild(digitWindow);
      drums.push({ strip, place: i });
    }

    readoutBox.appendChild(drumsWrap);

    if (props.suffix) {
      const suffixEl = document.createElement('span');
      suffixEl.className = 'fd-comp-display-suffix';
      SecurityValidator.setText(suffixEl, props.suffix);
      readoutBox.appendChild(suffixEl);
    }

    this.odometerDrums = drums;
    this.boxNode = readoutBox;
    this.element.appendChild(readoutBox);
    this.applyStyles();
    this.setOdometerValue(props.defaultValue !== undefined ? props.defaultValue : 0);
  }

  /**
   * @param {number} val
   */
  setOdometerValue(val) {
    if (!this.odometerDrums) return;
    const num = Number(val);
    const safeVal = Number.isFinite(num) ? Math.max(0, num) : 0;
    this.odometerDrums.forEach(({ strip, place }) => {
      const placeValue = 10 ** place;
      const continuousDigit = (safeVal / placeValue) % 10;
      strip.style.transform = `translateY(-${(continuousDigit / ODOMETER_STRIP_LENGTH) * 100}%)`;
    });
  }

  update(val, allState) {
    super.update(val, allState);

    if (this.odometerDrums) {
      this.setOdometerValue(val);
      return;
    }

    if (this.valueNode) {
      const props = this.def.props || {};
      const formatted = props.literalOverride !== undefined
        ? String(props.literalOverride)
        : ValueFormatter.format(val, props.format || 'RAW_INT', '', '', { decimals: props.decimals, axis: props.coordAxis });
      SecurityValidator.setText(this.valueNode, formatted);
    }
  }
}
