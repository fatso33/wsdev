/**
 * ColorPickerPopover.js
 * Modern color-picking UI (saturation/value area + hue slider + preset
 * swatches + hex/RGBA text entry) wired into the generic AnchoredPopover
 * chrome (Apply/Cancel, positioned relative to the triggering swatch).
 * Replaces the old bare native `<input type="color">` swatch.
 */
import { openAnchoredPopover } from './AnchoredPopover.js';
import { PRESET_SWATCHES, hexToHsv, hsvToHex, hsvToRgba, rgbaToHex, normalizeColorInput, clamp } from './ColorPickerLogic.js';

const DEFAULT_HSV = { h: 210, s: 0.6, v: 0.9, a: 1 };

/**
 * @param {{anchor: Element, initialColor: string}} opts
 * @returns {Promise<string|null>} the applied hex color, or null if cancelled/dismissed
 */
export function openColorPickerPopover({ anchor, initialColor }) {
  const seedHex = normalizeColorInput(initialColor);
  const initialHsv = (seedHex && hexToHsv(seedHex)) || DEFAULT_HSV;

  return openAnchoredPopover({
    anchor,
    className: 'color-picker-popover',
    initialValue: seedHex || hsvToHex(DEFAULT_HSV),
    bodyHtml: `
      <div class="cp-sv-area">
        <div class="cp-sv-white"></div>
        <div class="cp-sv-black"></div>
        <div class="cp-sv-thumb"></div>
      </div>
      <input type="range" class="cp-hue-slider" min="0" max="359" step="1" />
      <div class="cp-preview-row">
        <div class="cp-preview-swatch"></div>
        <input type="text" class="cp-hex-input prop-input" placeholder="#rrggbb" />
      </div>
      <div class="cp-preset-row">
        ${PRESET_SWATCHES.map((c) => `<button type="button" class="cp-preset-swatch" data-preset="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}
      </div>
    `,
    onMount: (body, ctx) => {
      const svArea = body.querySelector('.cp-sv-area');
      const thumb = body.querySelector('.cp-sv-thumb');
      const hueSlider = body.querySelector('.cp-hue-slider');
      const hexInput = body.querySelector('.cp-hex-input');
      const preview = body.querySelector('.cp-preview-swatch');

      let hsv = { ...initialHsv };

      const render = () => {
        const hex = hsvToHex(hsv);
        svArea.style.background = `linear-gradient(0deg, #000, transparent), linear-gradient(90deg, #fff, hsl(${hsv.h},100%,50%))`;
        thumb.style.left = `${hsv.s * 100}%`;
        thumb.style.top = `${(1 - hsv.v) * 100}%`;
        hueSlider.value = String(Math.round(hsv.h));
        preview.style.background = hex;
        hexInput.value = hex;
        ctx.setValue(hex);
      };

      const setFromSv = (clientX, clientY) => {
        const rect = svArea.getBoundingClientRect();
        const s = clamp((clientX - rect.left) / rect.width, 0, 1);
        const v = 1 - clamp((clientY - rect.top) / rect.height, 0, 1);
        hsv = { ...hsv, s, v };
        render();
      };

      let dragging = false;
      const onMouseMove = (e) => { if (dragging) setFromSv(e.clientX, e.clientY); };
      const onMouseUp = () => { dragging = false; };
      svArea.addEventListener('mousedown', (e) => {
        dragging = true;
        setFromSv(e.clientX, e.clientY);
      });
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);

      hueSlider.addEventListener('input', (e) => {
        hsv = { ...hsv, h: Number(e.target.value) };
        render();
      });

      hexInput.addEventListener('input', (e) => {
        const normalized = normalizeColorInput(e.target.value);
        if (normalized) {
          const next = hexToHsv(normalized);
          if (next) { hsv = next; render(); }
        }
      });

      body.querySelectorAll('.cp-preset-swatch').forEach((btn) => {
        btn.addEventListener('click', () => {
          const next = hexToHsv(btn.dataset.preset);
          if (next) { hsv = next; render(); }
        });
      });

      render();

      return () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };
    }
  });
}
