/**
 * SecurityValidator.js
 * Zero-Trust DOM & Bridge Injection Protection
 * Enforces strict whitelist validation on SimEvents, SimVars, and profile schemas.
 */

// Widget Studio 2.0, Phase 0: the `fdws` version enum now has one source
// (PropertyRegistry.js's FDWS_VERSIONS) instead of being hand-duplicated here AND
// in widget-studio/js/StudioValidator.js — the exact "two files, easy to forget"
// gotcha that left both capped at '1.7' when v1.8 shipped. '1.0' is kept as a
// pre-doc legacy value neither validator ever stopped accepting.
import { FDWS_VERSIONS } from '../widgets/PropertyRegistry.js';

export class SecurityValidator {
  // Event Name Whitelist Regex: Max 64 chars, case-tolerant alphanumeric, underscore, colon, dot,
  // hyphen. Case must be preserved (not normalized) — this now covers three distinct things that
  // are all case-sensitive: default Deck Event names (shared/deckEvents.js, camelCase, e.g.
  // "com1Swap"), custom Deck Event names a widget author chose, and raw SimConnect H:/K: escape-
  // hatch identifiers (FDWS v1.2 §1.5) — MSFS H:Events in particular only fire if the exact
  // declared casing is sent; forcing uppercase here would silently break them.
  static EVENT_REGEX = /^[A-Za-z0-9_:\.\-]{1,64}$/;
  
  // SimVar Whitelist Regex: Max 128 chars, case-tolerant identifier with standard SimVar namespace prefixes (e.g. L: A: H: K:)
  static SIMVAR_REGEX = /^[A-Za-z0-9_:\.\-\s\(\)]{1,128}$/;

  /**
   * Validates SimConnect Event Identifier
   * @param {string} eventName
   * @returns {boolean}
   */
  static isValidEventName(eventName) {
    if (typeof eventName !== 'string') return false;
    const trimmed = eventName.trim();
    return this.EVENT_REGEX.test(trimmed);
  }

  /**
   * Sanitizes SimConnect Event Identifier. Preserves case — see EVENT_REGEX's
   * comment for why (Deck Event names and H:/K: escape-hatch identifiers are
   * case-sensitive; this used to force-uppercase, which silently corrupted
   * both).
   * @param {string} eventName
   * @returns {string|null}
   */
  static sanitizeEventName(eventName) {
    if (typeof eventName !== 'string') return null;
    const cleaned = eventName.trim().replace(/[^A-Za-z0-9_:\.\-]/g, '');
    if (cleaned.length === 0 || cleaned.length > 64) return null;
    return cleaned;
  }

  /**
   * Validates SimVar Identifier
   * @param {string} simVar
   * @returns {boolean}
   */
  static isValidSimVar(simVar) {
    if (typeof simVar !== 'string') return false;
    const trimmed = simVar.trim();
    return this.SIMVAR_REGEX.test(trimmed);
  }

  /**
   * Sanitizes SimVar Identifier
   * @param {string} simVar
   * @returns {string|null}
   */
  static sanitizeSimVar(simVar) {
    if (typeof simVar !== 'string') return null;
    const cleaned = simVar.trim().replace(/[^A-Za-z0-9_:\.\-\s\(\)]/g, '');
    if (cleaned.length === 0 || cleaned.length > 128) return null;
    return cleaned;
  }

  /**
   * Like sanitizeSimVar()/sanitizeEventName(), but reports what it removed
   * instead of just silently returning the cleaned string. Those two
   * functions have ~17 call sites between them, several on hot runtime
   * paths with no UI to show a report in -- rather than change their return
   * shape (and every caller), this is a separate entry point for the two
   * places that actually want one: an import-time validator and a
   * keystroke-level authoring UI, both showing the user a diff so a pasted
   * forum string ("(A:TRANSPONDER IDENT:1, Bool)") reads as "we stripped
   * `,` `(` `)` — did you mean to paste forum syntax?" instead of just
   * mangling it invisibly.
   *
   * Character class is deliberately STRICTER than SIMVAR_REGEX above for the
   * 'simvar' kind: SIMVAR_REGEX tolerates `(`/`)` (some historical reason
   * upstream of this function, left alone per the no-touch rule), but this
   * function's whole purpose is catching forum/RPN paste debris -- and
   * `(`/`)` are exactly that, never part of a real bare Deck Event name or a
   * raw A:/L:/H:/K: address. Verified against the motivating case: pasting
   * "(A:TRANSPONDER IDENT:1, Bool)" with parens left allowed strips only the
   * comma, leaving "(A:TRANSPONDER IDENT:1 Bool)" -- still-wrapped garbage
   * that no longer even starts with "A:", so a raw-address check downstream
   * (Studio's unit-field-ownership toggle, 0.1-C) misclassifies it. Stripping
   * parens too was the fix.
   * @param {'simvar'|'event'} kind
   * @param {string} value
   * @returns {{cleaned: string|null, removed: string[], truncated: boolean}}
   *   cleaned is null if nothing valid survived; removed is the distinct set
   *   of disallowed characters that were stripped (empty if none were);
   *   truncated is true if the result was cut down to the max length.
   */
  static sanitizeWithReport(kind, value) {
    if (typeof value !== 'string') {
      return { cleaned: null, removed: [], truncated: false };
    }
    const disallowedRe = kind === 'simvar' ? /[^A-Za-z0-9_:\.\-\s]/g : /[^A-Za-z0-9_:\.\-]/g;
    const maxLen = kind === 'simvar' ? 128 : 64;
    const trimmed = value.trim();
    const removed = [...new Set(trimmed.match(disallowedRe) || [])];
    let cleaned = trimmed.replace(disallowedRe, '');
    const truncated = cleaned.length > maxLen;
    if (truncated) cleaned = cleaned.slice(0, maxLen);
    return { cleaned: cleaned.length > 0 ? cleaned : null, removed, truncated };
  }

  /**
   * Escapes text content for safe rendering in HTML contexts
   * @param {string} str
   * @returns {string}
   */
  static escapeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Safely sets text content on a DOM element
   * @param {HTMLElement} element
   * @param {string|number} text
   */
  static setText(element, text) {
    if (element && element.nodeType === Node.ELEMENT_NODE) {
      element.textContent = text !== null && text !== undefined ? String(text) : '';
    }
  }

  /**
   * Community Package Validation Gate (v2.2 Zero-Trust Spec)
   * Validates custom widget manifest and script content before IndexedDB ingestion
   * @param {object} manifest
   * @param {string} scriptContent
   * @returns {boolean}
   */
  static validateCustomPackage(manifest, scriptContent = '') {
    if (!manifest || typeof manifest !== 'object') {
      throw new Error('Security Violation: Manifest must be a valid JSON object');
    }

    // 1. Check prohibited JS tokens in script content
    if (typeof scriptContent === 'string' && scriptContent.length > 0) {
      const forbiddenTokens = ['eval(', 'new Function(', 'innerHTML', 'document.cookie', 'localStorage', 'indexedDB'];
      for (const token of forbiddenTokens) {
        if (scriptContent.includes(token)) {
          throw new Error(`Security Violation: Prohibited token "${token}" found in custom widget code.`);
        }
      }
    }

    // 2. Validate bounding box constraints
    const minW = manifest.minW ?? manifest.defaultLayout?.w ?? 1;
    const minH = manifest.minH ?? manifest.defaultLayout?.h ?? 1;
    const maxW = manifest.maxW ?? 44;
    const maxH = manifest.maxH ?? 44;

    if (minW < 1 || maxW > 44 || minH < 1 || maxH > 44) {
      throw new Error('Security Violation: Widget dimensions out of permitted grid bounds (1-44 cols, 1-44 rows)');
    }

    // 3. Validate SimConnect Bindings Identifier Regex
    if (manifest.defaultBindings) {
      const { readSimVar, incEvent, decEvent, writeEvent } = manifest.defaultBindings;
      const idRegex = /^[A-Z0-9_:\.\-]+$/i;
      for (const id of [readSimVar, incEvent, decEvent, writeEvent].filter(Boolean)) {
        if (!idRegex.test(id)) {
          throw new Error(`Security Violation: Invalid SimConnect identifier: "${id}"`);
        }
      }
    }

    return true;
  }

  /**
   * Validates Profile JSON structure against v2.3 and v2.2 Schemas
   * @param {object} profile
   * @returns {{valid: boolean, errors: string[]}}
   */
  static validateProfile(profile) {
    const errors = [];
    if (!profile || typeof profile !== 'object') {
      return { valid: false, errors: ['Profile must be an object'] };
    }

    const id = profile.id || profile.profileId;
    const name = profile.name || profile.aircraft;

    if (!id || typeof id !== 'string') {
      errors.push('Profile id or profileId is required and must be a string');
    }
    if (!name || typeof name !== 'string') {
      errors.push('Profile name or aircraft is required and must be a string');
    }

    if (!Array.isArray(profile.pages)) {
      errors.push('Profile pages must be an array');
    } else {
      profile.pages.forEach((page, pageIdx) => {
        if (!page.id || typeof page.id !== 'string') {
          errors.push(`Page [${pageIdx}] missing id`);
        }
        if (!page.name || typeof page.name !== 'string') {
          errors.push(`Page [${pageIdx}] missing name`);
        }

        // v2.3 Dual-Orientation Layouts format
        if (page.layouts && typeof page.layouts === 'object') {
          ['portrait', 'landscape'].forEach((ori) => {
            const layoutContainer = page.layouts[ori];
            if (layoutContainer && Array.isArray(layoutContainer.widgets)) {
              layoutContainer.widgets.forEach((widget, wIdx) => {
                if (!widget.id || typeof widget.id !== 'string') {
                  errors.push(`Widget [${wIdx}] on page [${page.id}] (${ori}) missing id`);
                }
                if (!widget.type || typeof widget.type !== 'string') {
                  errors.push(`Widget [${widget.id || wIdx}] (${ori}) missing type`);
                }
                if (!widget.layout || typeof widget.layout !== 'object') {
                  errors.push(`Widget [${widget.id || wIdx}] (${ori}) missing layout object`);
                }
              });
            }
          });
        } else if (Array.isArray(page.widgets)) {
          // Legacy v2 format
          page.widgets.forEach((widget, wIdx) => {
            if (!widget.id || typeof widget.id !== 'string') {
              errors.push(`Widget [${wIdx}] on page [${page.id}] missing id`);
            }
            if (!widget.type || typeof widget.type !== 'string') {
              errors.push(`Widget [${widget.id || wIdx}] missing type`);
            }
            if (!widget.layout || typeof widget.layout !== 'object') {
              errors.push(`Widget [${widget.id || wIdx}] missing layout object`);
            }
          });
        }
      });
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Sanitizes SVG raw text removing scripts and malicious tags (§9.1)
   * @param {string} svgText
   * @returns {string}
   */
  static sanitizeSVG(svgText) {
    if (typeof svgText !== 'string') return '';
    return svgText
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/<foreignObject\b[^<]*(?:(?!<\/foreignObject>)<[^<]*)*<\/foreignObject>/gi, '')
      .replace(/on\w+\s*=\s*(?:'[^']*'|"[^"]*"|[^\s>]+)/gi, '');
  }

  /**
   * Flight Deck Widget Standard (FDWS, current version v1.8) Package & Definition
   * Validator (§11). Structural/security gate only — this is the check every
   * import path in every app runs before a definition is allowed in at all, so it
   * must accept every FDWS version any app in the suite actually supports, kept
   * in sync with the `fdws` enum in the spec's own JSON Schema (Appendix A) as new
   * versions ship.
   * @param {object} def - FDWS Widget Definition JSON
   * @returns {{valid: boolean, errors: string[], warnings: string[], sanitizedDefinition: object}}
   */
  static validateFDWSDefinition(def) {
    const errors = [];
    const warnings = [];

    if (!def || typeof def !== 'object') {
      return { valid: false, errors: ['Widget definition must be a valid JSON object'], warnings, sanitizedDefinition: null };
    }

    // Clone to preserve unknown fields (§4.1 Rule 2) while sanitizing known keys
    const sanitized = JSON.parse(JSON.stringify(def));

    // 1. Structural validation
    if (!FDWS_VERSIONS.includes(sanitized.fdws)) {
      errors.push(`FDWS version must be one of: ${FDWS_VERSIONS.map((v) => `"${v}"`).join(', ')}`);
    }
    if (!sanitized.schemaVersion || typeof sanitized.schemaVersion !== 'string') {
      errors.push('schemaVersion must be a semver string');
    }

    const idRegex = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
    if (!sanitized.id || !idRegex.test(sanitized.id)) {
      errors.push(`Widget ID "${sanitized.id}" is invalid. Must match reverse-DNS format (e.g. com.example.mywidget)`);
    }

    // FDWS v1.3 §1.1: 'kind' discriminates a normal placeable widget from a
    // "popover" (opened only via core.openWidgetPopover, never placed on a page
    // layout). Missing kind defaults to "widget" per spec; an unrecognized value
    // is also treated as "widget" (graceful degradation, same rule as unknown
    // fields generally) rather than rejected outright.
    if (sanitized.kind !== undefined && sanitized.kind !== 'widget' && sanitized.kind !== 'popover') {
      warnings.push(`Unknown "kind": "${sanitized.kind}". Treated as "widget".`);
      sanitized.kind = 'widget';
    }

    // FDWS v1.4 §1.1: 'revision' is the author/tool-controlled monotonic counter
    // that PWA<->PC Bridge custom-widget sync (userPresetManager.computeDiff(),
    // StorageManager.reconcilePushUp()) already relies on to decide which copy
    // of a widget is newer. Optional and backward-compatible — absent is
    // equivalent to 1, per spec — so this only warns (never errors) on a
    // present-but-malformed value, same graceful-degradation posture as `kind`
    // above. A non-integer or non-positive value is coerced to 1 rather than
    // left as-is, so a bad value can't corrupt sync-diff comparisons downstream.
    if (sanitized.revision !== undefined && (!Number.isInteger(sanitized.revision) || sanitized.revision < 1)) {
      warnings.push(`"revision" must be a positive integer (got ${JSON.stringify(sanitized.revision)}) — defaulted to 1.`);
      sanitized.revision = 1;
    }

    // FDWS v1.18 §1.1: 'baseTheme' declares which theme this widget's style.*
    // (and every component's own style.*) was literally authored for — 'dark'
    // per spec default, same as every widget predating v1.18 already behaves.
    // 'themeMode' opts a widget into manually authoring the OTHER theme via
    // style.themeOverride instead of the usual auto-derivation. Same graceful-
    // degradation posture as 'kind'/'revision' above: an unrecognized value
    // only warns and is coerced to the default, never rejected outright.
    if (sanitized.baseTheme !== undefined && sanitized.baseTheme !== 'dark' && sanitized.baseTheme !== 'light') {
      warnings.push(`Unknown "baseTheme": ${JSON.stringify(sanitized.baseTheme)}. Defaulted to "dark".`);
      sanitized.baseTheme = 'dark';
    }
    if (sanitized.themeMode !== undefined && sanitized.themeMode !== 'auto' && sanitized.themeMode !== 'manual') {
      warnings.push(`Unknown "themeMode": ${JSON.stringify(sanitized.themeMode)}. Defaulted to "auto".`);
      sanitized.themeMode = 'auto';
    }

    if (!sanitized.meta || typeof sanitized.meta !== 'object') {
      errors.push('meta object is required');
    } else {
      if (!sanitized.meta.name || typeof sanitized.meta.name !== 'string') {
        errors.push('meta.name is required');
      } else if (sanitized.meta.name.length > 64) {
        sanitized.meta.name = sanitized.meta.name.substring(0, 64);
        warnings.push('meta.name exceeded 64 characters and was truncated');
      }
      if (!sanitized.meta.category || typeof sanitized.meta.category !== 'string') {
        sanitized.meta.category = 'Avionics';
      }
    }

    if (!sanitized.layout || typeof sanitized.layout !== 'object') {
      errors.push('layout object is required');
    } else {
      sanitized.layout.defaultW = Math.max(1, Math.min(44, sanitized.layout.defaultW || 8));
      sanitized.layout.defaultH = Math.max(1, Math.min(44, sanitized.layout.defaultH || 4));
      if (!sanitized.layout.grid || typeof sanitized.layout.grid !== 'object') {
        sanitized.layout.grid = { columns: 12, rows: 6 };
      } else {
        sanitized.layout.grid.columns = Math.max(1, Math.min(64, sanitized.layout.grid.columns || 12));
        sanitized.layout.grid.rows = Math.max(1, Math.min(64, sanitized.layout.grid.rows || 6));
      }
    }

    // 2. Layer Groups Validation (§5.2.2 & §9.3)
    const validGroupIds = new Set();
    if (Array.isArray(sanitized.layerGroups)) {
      if (sanitized.layerGroups.length > 16) {
        warnings.push('Widget declares more than 16 layer groups; excess groups truncated');
        sanitized.layerGroups = sanitized.layerGroups.slice(0, 16);
      }
      sanitized.layerGroups.forEach((lg, idx) => {
        if (!lg.id || typeof lg.id !== 'string') {
          lg.id = `group_${idx}`;
        }
        lg.z = Math.max(-1000, Math.min(1000, Number(lg.z) || 0));
        validGroupIds.add(lg.id);
      });
    }

    // 3. Components Validation (§5 & §11)
    // NOTE (FDWS v1.2 §3.3): the 64-component hard cap is removed. Components are
    // governed only by the payload-size limits below (§9.3) — no count-based rejection.
    if (!Array.isArray(sanitized.components)) {
      errors.push('components array is required');
      sanitized.components = [];
    } else {
      const foundSimVars = new Set();
      const foundWriteEvents = new Set();

      sanitized.components.forEach((comp, idx) => {
        if (!comp.id) comp.id = `comp_${idx}`;
        if (!comp.type || typeof comp.type !== 'string') {
          comp.type = 'core.label';
        }

        // Bounding box validation
        if (!comp.layout || typeof comp.layout !== 'object') {
          comp.layout = { col: 1, row: 1, w: 1, h: 1 };
        } else {
          comp.layout.col = Math.max(1, Number(comp.layout.col) || 1);
          comp.layout.row = Math.max(1, Number(comp.layout.row) || 1);
          comp.layout.w = Math.max(1, Number(comp.layout.w) || 1);
          comp.layout.h = Math.max(1, Number(comp.layout.h) || 1);
        }

        // FDWS v1.2 §2.2: guard object sanitation (button/selector/rocker; lives on layout)
        if (comp.layout.guard && typeof comp.layout.guard === 'object') {
          comp.layout.guard.enabled = Boolean(comp.layout.guard.enabled);
          if (comp.layout.guard.autoCloseAfterMs !== undefined) {
            comp.layout.guard.autoCloseAfterMs = Math.max(0, Number(comp.layout.guard.autoCloseAfterMs) || 0);
          }
        }

        // Layer Sanity Checks (FDWS v1.1 §11 Rule 6)
        if (comp.layer && typeof comp.layer === 'object') {
          comp.layer.z = Math.max(-1000, Math.min(1000, Number(comp.layer.z) || 0));
          if (comp.layer.group && !validGroupIds.has(comp.layer.group)) {
            warnings.push(`Component "${comp.id}" references non-existent layer group "${comp.layer.group}". Resetting to null.`);
            comp.layer.group = null;
          }
          // FDWS v1.2 §1.1: only coerce an *invalid* explicit value to 'auto'. Leave
          // pointerEvents unset (undefined) alone so BaseComponent's resolvePointerEvents()
          // can apply the new type/interactions/binding-driven default at render time.
          if (comp.layer.pointerEvents !== undefined && comp.layer.pointerEvents !== 'none' && comp.layer.pointerEvents !== 'auto') {
            comp.layer.pointerEvents = 'auto';
          }

          // Rule 6: Interactions on pointerEvents: "none" is stripped defensively
          if (comp.layer.pointerEvents === 'none' && Array.isArray(comp.interactions) && comp.interactions.length > 0) {
            warnings.push(`Security Rule 6: Component "${comp.id}" declared interactions with pointerEvents: "none". Interactions were stripped to prevent hidden click-jacking.`);
            comp.interactions = [];
          }
        }

        // Identifier Sanitization
        if (comp.binding && typeof comp.binding === 'object') {
          if (comp.binding.readSimVar) {
            const clean = SecurityValidator.sanitizeSimVar(comp.binding.readSimVar);
            if (clean) {
              comp.binding.readSimVar = clean;
              foundSimVars.add(clean.toLowerCase());
            } else {
              delete comp.binding.readSimVar;
            }
          }
          if (comp.binding.writeEvent) {
            const clean = SecurityValidator.sanitizeEventName(comp.binding.writeEvent);
            if (clean) {
              comp.binding.writeEvent = clean;
              foundWriteEvents.add(clean);
            } else {
              delete comp.binding.writeEvent;
            }
          }
          // ackEvent/pushEvent are alternate write-event fields BaseComponent's
          // resolvePointerEvents() and CompositeWidget's registerDynamicBindings()/
          // core.ackIndicator already treat as equivalent to writeEvent — sanitize
          // and count them the same way, or an unsanitized identifier here would
          // reach dispatchSimEvent() untouched, and a legitimate one would always
          // trip the §11 Rule 5 "not referenced" warning below.
          ['ackEvent', 'pushEvent'].forEach((field) => {
            if (comp.binding[field]) {
              const clean = SecurityValidator.sanitizeEventName(comp.binding[field]);
              if (clean) {
                comp.binding[field] = clean;
                foundWriteEvents.add(clean);
              } else {
                delete comp.binding[field];
              }
            }
          });
        }

        // FDWS v1.3 §1.2/§1.4: sanitize the three new popover action types.
        // popoverWidgetId is a widget id (same reverse-DNS shape checked above for
        // the top-level id); contextKey is a symbolic key, not a state path — reuse
        // the event-name whitelist for it since both are short, safe identifiers.
        // The actual capability enforcement (does contextKey match a
        // host-declared writable entry?) happens at runtime in
        // WidgetPopoverModal.js — this is only shape/injection validation, same
        // division of labor as readSimVar/writeEvent above.
        if (Array.isArray(comp.interactions)) {
          comp.interactions.forEach((inter, interIdx) => {
            const action = inter?.action;
            if (!action || typeof action !== 'object') return;

            if (action.type === 'core.openWidgetPopover') {
              if (!action.popoverWidgetId || !idRegex.test(action.popoverWidgetId)) {
                warnings.push(`Component "${comp.id}" interaction #${interIdx + 1}: core.openWidgetPopover has a missing or invalid "popoverWidgetId" — action stripped.`);
                inter.action = null;
              }
            } else if (action.type === 'core.commitToHost') {
              const clean = typeof action.contextKey === 'string' ? SecurityValidator.sanitizeEventName(action.contextKey) : null;
              if (!clean) {
                warnings.push(`Component "${comp.id}" interaction #${interIdx + 1}: core.commitToHost has a missing or invalid "contextKey" — action stripped.`);
                inter.action = null;
              } else {
                action.contextKey = clean;
              }
            } else if (action.type === 'core.dispatchEvent' && action.event) {
              // A component's writeEvent capability can also be exercised purely
              // through a dispatched action.event rather than comp.binding.writeEvent
              // (the common pattern for button taps — see CompositeWidget.js's
              // core.dispatchEvent case) — count it the same way for §11 Rule 5 below.
              const clean = SecurityValidator.sanitizeEventName(action.event);
              if (clean) foundWriteEvents.add(clean);
            }
          });
          comp.interactions = comp.interactions.filter((inter) => inter && inter.action);
        }

        // core.rocker (FDWS v1.2 §2.x): each zone dispatches its own writeEvent
        // directly (RockerComponent.js), independent of comp.binding/interactions
        // entirely — a fourth shape §11 Rule 5 below needs to know about.
        if (comp.type === 'core.rocker' && Array.isArray(comp.props?.zones)) {
          comp.props.zones.forEach((zone) => {
            if (zone?.writeEvent) {
              const clean = SecurityValidator.sanitizeEventName(zone.writeEvent);
              if (clean) foundWriteEvents.add(clean);
            }
          });
        }
      });

      // Local State declarations can also source a read capability via
      // state[].syncFrom (FDWS v1.2 §3.2) instead of a component's
      // binding.readSimVar — count those too, or the §11 Rule 5 cross-check
      // below falsely flags every syncFrom-only capability as unreferenced.
      if (Array.isArray(sanitized.state)) {
        sanitized.state.forEach((st) => {
          if (st?.syncFrom && typeof st.syncFrom === 'string') {
            const clean = SecurityValidator.sanitizeSimVar(st.syncFrom);
            if (clean) foundSimVars.add(clean.toLowerCase());
          }
        });
      }

      // 4. Capabilities cross-check warning (§11 Rule 5)
      if (sanitized.capabilities && typeof sanitized.capabilities === 'object') {
        const declaredReads = sanitized.capabilities.readSimVars || [];
        const declaredWrites = sanitized.capabilities.writeEvents || [];
        declaredReads.forEach((v) => {
          if (!foundSimVars.has(v.toLowerCase())) {
            warnings.push(`Declared read capability "${v}" is not referenced by any component.`);
          }
        });
        declaredWrites.forEach((e) => {
          if (!foundWriteEvents.has(e)) {
            warnings.push(`Declared write capability "${e}" is not referenced by any component.`);
          }
        });
      }
    }

    // FDWS v1.19 §1.5: 'popovers' lets a widget bundle the popover-kind
    // definition(s) its own core.openWidgetPopover interactions reference,
    // so a community widget + its popover(s) ship as one file instead of
    // requiring a separate import per popover. Purely an export/import
    // convenience — each entry is validated and installed exactly as if it
    // had been imported on its own (see WidgetRegistry.installDefinition),
    // then stripped from the host definition that actually gets persisted.
    // Bounded to one level: a popover can't itself open another popover
    // (InteractionDispatcher has no such action), so a nested "popovers" on
    // an embedded entry is dropped rather than recursed into.
    if (sanitized.popovers !== undefined) {
      if (!Array.isArray(sanitized.popovers)) {
        warnings.push('"popovers" must be an array; ignored.');
        delete sanitized.popovers;
      } else {
        const validPopovers = [];
        sanitized.popovers.forEach((p, idx) => {
          const raw = (p && typeof p === 'object') ? { ...p } : {};
          if (raw.popovers !== undefined) {
            warnings.push(`Embedded popover [${idx}] ("${raw.id || 'unknown'}") declared its own nested "popovers" — nesting isn't supported and was ignored.`);
            delete raw.popovers;
          }
          raw.kind = 'popover';
          const nested = SecurityValidator.validateFDWSDefinition(raw);
          if (!nested.valid) {
            warnings.push(`Embedded popover [${idx}] ("${raw.id || 'unknown'}") failed validation and was dropped: ${nested.errors.join('; ')}`);
            return;
          }
          nested.warnings.forEach((w) => warnings.push(`Embedded popover "${nested.sanitizedDefinition.id}": ${w}`));
          validPopovers.push(nested.sanitizedDefinition);
        });
        sanitized.popovers = validPopovers;
      }
    }

    // 5. Assets validation (§9.3)
    if (Array.isArray(sanitized.assets)) {
      let totalAssetSize = 0;
      const allowedMimes = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];

      sanitized.assets = sanitized.assets.filter((asset) => {
        if (!asset.id || !asset.data || !allowedMimes.includes(asset.mimeType)) {
          warnings.push(`Asset "${asset.id || 'unnamed'}" dropped: invalid MIME type or missing data.`);
          return false;
        }
        const size = asset.sizeBytes || Math.round(asset.data.length * 0.75);
        if (size > 2097152) {
          warnings.push(`Asset "${asset.id}" exceeds 2MB limit (${(size / 1048576).toFixed(1)}MB). Dropped.`);
          return false;
        }
        totalAssetSize += size;
        if (asset.mimeType === 'image/svg+xml') {
          try {
            const decoded = atob(asset.data);
            const cleanSvg = SecurityValidator.sanitizeSVG(decoded);
            asset.data = btoa(cleanSvg);
          } catch (_) {}
        }
        return true;
      });

      if (totalAssetSize > 20971520) {
        errors.push(`Total asset package size exceeds 20MB limit (${(totalAssetSize / 1048576).toFixed(1)}MB).`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      sanitizedDefinition: sanitized
    };
  }
}
