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

      // Paints the visual UI (SV area, thumb, hue slider, preview swatch,
      // and — unless suppressed — the hex text input) from current `hsv`
      // state. Purely visual: never writes back to the caller. Used both
      // for the initial mount paint and as the shared tail of `commit()`.
      const paint = ({ syncHexInput = true } = {}) => {
        const hex = hsvToHex(hsv);
        svArea.style.background = `linear-gradient(0deg, #000, transparent), linear-gradient(90deg, #fff, hsl(${hsv.h},100%,50%))`;
        thumb.style.left = `${hsv.s * 100}%`;
        thumb.style.top = `${(1 - hsv.v) * 100}%`;
        hueSlider.value = String(Math.round(hsv.h));
        preview.style.background = hex;
        // Don't stomp the hex input's live value while the user is typing
        // into it (bug 2) — only sync it here when the change came from a
        // non-hex-input source (swatch/drag/hue slider).
        if (syncHexInput) hexInput.value = hex;
        return hex;
      };

      // Paints + commits the value back to the popover's Apply value. Only
      // ever called in response to an actual user interaction, never at
      // mount — the seed color's hex->HSV->hex round trip can drift by
      // ±1/channel (see ColorPickerLogic.test.js), so treating the initial
      // paint as a "change" could silently commit a slightly different
      // color even when Apply is clicked with zero edits (bug 1).
      const commit = ({ fromHexInput = false } = {}) => {
        const hex = paint({ syncHexInput: !fromHexInput });
        ctx.setValue(hex);
      };

      const setFromSv = (clientX, clientY) => {
        const rect = svArea.getBoundingClientRect();
        const s = clamp((clientX - rect.left) / rect.width, 0, 1);
        const v = 1 - clamp((clientY - rect.top) / rect.height, 0, 1);
        hsv = { ...hsv, s, v };
        commit();
      };

      let dragging = false;
      const onMouseMove = (e) => { if (dragging) setFromSv(e.clientX, e.clientY); };
      const stopDragging = () => { dragging = false; };
      svArea.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dragging = true;
        setFromSv(e.clientX, e.clientY);
      });
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', stopDragging);
      // A window `mouseup` never fires if the button is released outside
      // the browser window entirely — also clear `dragging` on signals
      // that the pointer left the document/window so a later stray
      // mousemove back over it isn't read as an active drag (bug 3).
      window.addEventListener('blur', stopDragging);
      document.addEventListener('mouseleave', stopDragging);

      hueSlider.addEventListener('input', (e) => {
        hsv = { ...hsv, h: Number(e.target.value) };
        commit();
      });

      hexInput.addEventListener('input', (e) => {
        const normalized = normalizeColorInput(e.target.value);
        if (normalized) {
          const next = hexToHsv(normalized);
          if (next) { hsv = next; commit({ fromHexInput: true }); }
        }
      });

      body.querySelectorAll('.cp-preset-swatch').forEach((btn) => {
        btn.addEventListener('click', () => {
          const next = hexToHsv(btn.dataset.preset);
          if (next) { hsv = next; commit(); }
        });
      });

      // Initial paint only — reflects the seed color visually without
      // treating it as a user-made change worth writing back (bug 1).
      paint();

      return () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', stopDragging);
        window.removeEventListener('blur', stopDragging);
        document.removeEventListener('mouseleave', stopDragging);
      };
    }
  });
}
