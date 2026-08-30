/**
 * ValueFormatter.js
 * Comprehensive Value Formatter for Avionics Readouts & Controls (FDWS §6.2)
 * Unifies display formatting and PC Bridge value transforms.
 */

export class ValueFormatter {
  // FDWS v1.2 §2.3: registry for vendor.<publisher>.<name> custom formats.
  // Each entry is a function (val, num, opts) => string.
  static vendorFormats = new Map();

  /**
   * Registers a vendor-namespaced custom format (component packs, not core).
   * @param {string} name - Full format id, e.g. "vendor.acme.roc"
   * @param {(val:any, num:number, opts:object) => string} fn
   */
  static registerVendorFormat(name, fn) {
    if (typeof name === 'string' && name.startsWith('vendor.') && typeof fn === 'function') {
      this.vendorFormats.set(name, fn);
    }
  }

  // FDWS v1.11 §1.1: the Format Catalog. Unlike the display-only `format()`
  // switch below, this carries INPUT semantics for core.input — fixed digit
  // shape (intDigits.decDigits), numeric bounds, and an auto-prefill string
  // (e.g. the leading "1" every valid COM/NAV frequency starts with).
  // core.input consults this via getFormatSpec() to drive masked typing,
  // range enforcement, and focus prefill; formats with no entry here behave
  // exactly as free-text always has. Any format id (built-in or vendor.*) can
  // have a spec registered — this is deliberately open-ended so future
  // formats can supply the same behavior without a runtime change.
  static FORMAT_SPECS = new Map([
    ['FREQ_COM', { intDigits: 3, decDigits: 3, min: 118.000, max: 136.975, autoPrefill: '1' }],
    ['FREQ_NAV', { intDigits: 3, decDigits: 2, min: 108.00, max: 117.95, autoPrefill: '1' }]
  ]);

  /**
   * Registers (or overrides) a format's input spec — digit shape, bounds,
   * and optional auto-prefill. Not restricted to vendor.* — a widget pack
   * can also override a built-in entry's bounds if needed.
   * @param {string} name - Format id, e.g. "FREQ_COM" or "vendor.acme.xpdr"
   * @param {{intDigits:number, decDigits:number, min?:number, max?:number, autoPrefill?:string}} spec
   */
  static registerFormatSpec(name, spec) {
    if (typeof name === 'string' && spec && typeof spec === 'object' && Number.isInteger(spec.intDigits) && Number.isInteger(spec.decDigits)) {
      this.FORMAT_SPECS.set(name, spec);
    }
  }

  /**
   * @param {string} format
   * @returns {object|null} the format's input spec, or null if it has none
   * (meaning: no masking/range enforcement — plain free-text input).
   */
  static getFormatSpec(format) {
    return this.FORMAT_SPECS.get(format) || null;
  }

  /**
   * Formats a raw numeric or string value according to FDWS Format Enum
   * @param {any} val - Raw input value
   * @param {string} format - Format enum
   * @param {string} [prefix='']
   * @param {string} [suffix='']
   * @param {object} [opts={}] - Extra format params, e.g. { decimals } for DECIMAL_N
   * @returns {string} Formatted string
   */
  static format(val, format = 'RAW_INT', prefix = '', suffix = '', opts = {}) {
    if (val === null || val === undefined || val === '') {
      return '---';
    }

    const num = Number(val);
    let formatted = '';

    // FDWS v1.2 §2.3: vendor.<publisher>.<name> custom formats, else graceful
    // degradation to RAW_INT behavior for any unrecognized format string.
    if (typeof format === 'string' && format.startsWith('vendor.')) {
      const vendorFn = this.vendorFormats.get(format);
      if (vendorFn) {
        formatted = vendorFn(val, num, opts);
        const p = prefix ? `${prefix} ` : '';
        const s = suffix ? ` ${suffix}` : '';
        return `${p}${formatted}${s}`;
      }
      formatted = isNaN(num) ? String(val) : String(Math.round(num));
      const p = prefix ? `${prefix} ` : '';
      const s = suffix ? ` ${suffix}` : '';
      return `${p}${formatted}${s}`;
    }

    switch (format) {
      case 'RAW_TEXT': {
        formatted = String(val);
        break;
      }

      case 'RAW_INT': {
        formatted = isNaN(num) ? String(val) : String(Math.round(num));
        break;
      }

      case 'DEGREE_3': {
        if (isNaN(num)) {
          formatted = '000';
        } else {
          let deg = Math.round(num) % 360;
          if (deg <= 0) deg += 360;
          formatted = String(deg).padStart(3, '0');
        }
        break;
      }

      case 'ALTITUDE': {
        if (isNaN(num)) {
          formatted = '0';
        } else {
          formatted = Math.round(num).toLocaleString('en-US');
        }
        break;
      }

      case 'SIGN_INT': {
        if (isNaN(num)) {
          formatted = '+0';
        } else {
          const rounded = Math.round(num);
          formatted = rounded > 0 ? `+${rounded}` : String(rounded);
        }
        break;
      }

      case 'FREQ_COM': {
        if (isNaN(num)) {
          formatted = String(val);
        } else {
          // If in Hz (e.g. 118700000) or kHz (118700), normalize to MHz
          let mhz = num;
          if (mhz > 1000000) mhz /= 1000000;
          else if (mhz > 1000) mhz /= 1000;
          formatted = mhz.toFixed(3);
        }
        break;
      }

      case 'FREQ_NAV': {
        if (isNaN(num)) {
          formatted = String(val);
        } else {
          let mhz = num;
          if (mhz > 1000000) mhz /= 1000000;
          else if (mhz > 1000) mhz /= 1000;
          formatted = mhz.toFixed(2);
        }
        break;
      }

      case 'HZ_INT': {
        if (isNaN(num)) {
          formatted = '0';
        } else {
          let hz = num;
          if (hz < 1000) hz = Math.round(hz * 1000000);
          formatted = String(Math.round(hz));
        }
        break;
      }

      case 'KHZ_INT': {
        if (isNaN(num)) {
          formatted = '0';
        } else {
          let khz = num;
          if (khz < 1000) khz = Math.round(khz * 1000);
          formatted = String(Math.round(khz));
        }
        break;
      }

      case 'BCD_HEX': {
        if (isNaN(num)) {
          formatted = String(val).padStart(4, '0');
        } else {
          formatted = Math.round(num).toString(16).toUpperCase().padStart(4, '0');
        }
        break;
      }

      // A 4-digit code display (transponder squawk and similar) where the
      // value arriving here is already plain decimal — PC Bridge decodes
      // BCD16-packed SimConnect values (e.g. "TRANSPONDER CODE:1") to plain
      // decimal server-side (see bcd16ToDecimal() in pc-bridge/server.js)
      // before broadcasting, specifically so no widget-side format needs to
      // know BCD16 was ever involved. Unlike BCD_HEX (which reinterprets the
      // value's hex digits as decimal ones — only correct for an actual raw
      // BCD16 integer), this just zero-pads.
      case 'SQUAWK_CODE': {
        formatted = isNaN(num) ? String(val).padStart(4, '0') : String(Math.round(num)).padStart(4, '0');
        break;
      }

      case 'FIXED_0': {
        formatted = '0';
        break;
      }

      case 'FIXED_1': {
        formatted = '1';
        break;
      }

      // --- FDWS v1.2 §2.3 new formats ---

      case 'MACH': {
        if (isNaN(num)) {
          formatted = 'M.000';
        } else {
          const thousandths = Math.round(Math.abs(num) * 1000);
          formatted = `M.${String(thousandths).padStart(3, '0')}`;
        }
        break;
      }

      case 'PERCENT': {
        formatted = isNaN(num) ? '0%' : `${Math.round(num)}%`;
        break;
      }

      case 'TEMP_C': {
        if (isNaN(num)) {
          formatted = '0°C';
        } else {
          const rounded = Math.round(num);
          formatted = `${rounded > 0 ? '+' : ''}${rounded}°C`;
        }
        break;
      }

      case 'TEMP_F': {
        if (isNaN(num)) {
          formatted = '0°F';
        } else {
          const rounded = Math.round(num);
          formatted = `${rounded > 0 ? '+' : ''}${rounded}°F`;
        }
        break;
      }

      case 'PRESSURE_INHG': {
        formatted = isNaN(num) ? '0.00 inHg' : `${num.toFixed(2)} inHg`;
        break;
      }

      case 'PRESSURE_HPA': {
        formatted = isNaN(num) ? '0 hPa' : `${Math.round(num)} hPa`;
        break;
      }

      case 'VS_FPM': {
        if (isNaN(num)) {
          formatted = '0 fpm';
        } else {
          const rounded = Math.round(num);
          const sign = rounded > 0 ? '+' : '';
          formatted = `${sign}${rounded.toLocaleString('en-US')} fpm`;
        }
        break;
      }

      case 'TIME_MMSS': {
        if (isNaN(num) || num < 0) {
          formatted = '00:00';
        } else {
          const totalSeconds = Math.round(num);
          const mm = Math.floor(totalSeconds / 60);
          const ss = totalSeconds % 60;
          formatted = `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
        }
        break;
      }

      case 'TIME_HHMMSS': {
        if (isNaN(num) || num < 0) {
          formatted = '00:00:00';
        } else {
          const totalSeconds = Math.round(num);
          const hh = Math.floor(totalSeconds / 3600);
          const mm = Math.floor((totalSeconds % 3600) / 60);
          const ss = totalSeconds % 60;
          formatted = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
        }
        break;
      }

      case 'LATLON_DMS': {
        if (isNaN(num)) {
          formatted = `0°00'00"${opts.axis === 'lon' ? 'E' : 'N'}`;
        } else {
          const hemisphere = opts.axis === 'lon'
            ? (num < 0 ? 'W' : 'E')
            : (num < 0 ? 'S' : 'N');
          const abs = Math.abs(num);
          const degrees = Math.floor(abs);
          const minutesFloat = (abs - degrees) * 60;
          const minutes = Math.floor(minutesFloat);
          const seconds = Math.round((minutesFloat - minutes) * 60);
          formatted = `${degrees}°${String(minutes).padStart(2, '0')}'${String(seconds).padStart(2, '0')}"${hemisphere}`;
        }
        break;
      }

      case 'DECIMAL_N': {
        const decimals = Number.isInteger(opts.decimals) ? opts.decimals : 1;
        formatted = isNaN(num) ? (0).toFixed(decimals) : num.toFixed(decimals);
        break;
      }

      // Decimal-degree coordinate — the FMS/GPS-page alternative to
      // LATLON_DMS's degrees/minutes/seconds form (e.g. "47.4502°N" instead
      // of "47°27'01"N"). Same opts.axis convention as LATLON_DMS.
      case 'COORD_DECIMAL': {
        if (isNaN(num)) {
          formatted = `0.0000°${opts.axis === 'lon' ? 'E' : 'N'}`;
        } else {
          const hemisphere = opts.axis === 'lon'
            ? (num < 0 ? 'W' : 'E')
            : (num < 0 ? 'S' : 'N');
          formatted = `${Math.abs(num).toFixed(4)}°${hemisphere}`;
        }
        break;
      }

      // Nearest 16-point compass label (N, NNE, NE, …) — for wind-direction
      // and heading-bug readouts that want a cardinal label instead of a raw
      // degree number.
      case 'COMPASS_CARDINAL': {
        if (isNaN(num)) {
          formatted = '---';
        } else {
          const points = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
          let deg = Math.round(num) % 360;
          if (deg < 0) deg += 360;
          formatted = points[Math.round(deg / 22.5) % 16];
        }
        break;
      }

      default: {
        formatted = isNaN(num) ? String(val) : String(num);
        break;
      }
    }

    const p = prefix ? `${prefix} ` : '';
    const s = suffix ? ` ${suffix}` : '';
    return `${p}${formatted}${s}`;
  }
}
