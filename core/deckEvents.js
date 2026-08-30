/**
 * deckEvents.js
 * Canonical list of default "Deck Events" — the simple, generic logical
 * names (e.g. "com1Swap", "xpndrIdent") that widgets/pages use to read
 * telemetry from and send commands to PC Bridge, independent of any real
 * SimConnect variable/event name.
 *
 * This is the single source of truth for default Deck Event names across
 * the whole Flight Deck suite:
 *   - pc-bridge/profileManager.js imports this directly (Node resolves the
 *     relative path across the repo, no copy step needed) to build
 *     DEFAULT_PROFILE's mappings/simVars *keys* — the real SimConnect
 *     variable/event each one resolves to stays local to pc-bridge only.
 *   - flight-deck-pwa and widget-studio get a synced copy via
 *     scripts/sync-shared.mjs (same mechanism as widgets/components and
 *     SecurityValidator.js) and use it to populate the Deck Event dropdown
 *     in PropertyInspector.js / StudioInspector.js.
 *
 * PWA and Widget Studio only ever see the `name`/`kind`/`category`/`label`
 * here — never a real SimVar or SimConnect event name. A user can still
 * type a raw SimConnect/L:Var/H:Event identifier directly into a binding's
 * "Custom" field instead of picking from this list (FDWS v1.2 §1.5 escape
 * hatch, still current under v1.4 — see also v1.4 §1.2's clarification that
 * a bare, unprefixed name like the ones in this list is a host-defined
 * logical binding name, not a guaranteed `A:`-namespace SimVar) — that
 * bypasses this list entirely and is resolved literally by pc-bridge (see
 * server.js's PREFIXED_VAR_RE).
 *
 * `kind`: "read" (telemetry PC Bridge pushes to widgets, resolved via a
 * profile's `simVars` table) or "write" (a command a widget sends, resolved
 * via a profile's `mappings` table).
 * `category`: "radio" | "ap" | "lights" — matches pc-bridge/config-ui.html's
 * tab grouping.
 */

export const DECK_EVENTS = [
  // --- Radios & Transponder ---
  { name: 'com1ActFreq', kind: 'read', category: 'radio', label: 'COM 1 Active Freq' },
  { name: 'com1StbyFreq', kind: 'read', category: 'radio', label: 'COM 1 Standby Freq' },
  { name: 'com2ActFreq', kind: 'read', category: 'radio', label: 'COM 2 Active Freq' },
  { name: 'com2StbyFreq', kind: 'read', category: 'radio', label: 'COM 2 Standby Freq' },
  { name: 'nav1ActFreq', kind: 'read', category: 'radio', label: 'NAV 1 Active Freq' },
  { name: 'nav1StbyFreq', kind: 'read', category: 'radio', label: 'NAV 1 Standby Freq' },
  { name: 'nav2ActFreq', kind: 'read', category: 'radio', label: 'NAV 2 Active Freq' },
  { name: 'nav2StbyFreq', kind: 'read', category: 'radio', label: 'NAV 2 Standby Freq' },
  { name: 'xpndrCode', kind: 'read', category: 'radio', label: 'Transponder Code' },
  { name: 'xpndrModeState', kind: 'read', category: 'radio', label: 'Transponder Mode State' },

  { name: 'com1Swap', kind: 'write', category: 'radio', label: 'COM 1 Swap' },
  { name: 'com1StbySet', kind: 'write', category: 'radio', label: 'COM 1 Standby Set' },
  { name: 'com2Swap', kind: 'write', category: 'radio', label: 'COM 2 Swap' },
  { name: 'com2StbySet', kind: 'write', category: 'radio', label: 'COM 2 Standby Set' },
  { name: 'nav1Swap', kind: 'write', category: 'radio', label: 'NAV 1 Swap' },
  { name: 'nav1StbySet', kind: 'write', category: 'radio', label: 'NAV 1 Standby Set' },
  { name: 'nav2Swap', kind: 'write', category: 'radio', label: 'NAV 2 Swap' },
  { name: 'nav2StbySet', kind: 'write', category: 'radio', label: 'NAV 2 Standby Set' },
  { name: 'xpndrSet', kind: 'write', category: 'radio', label: 'Squawk Code Set' },
  { name: 'xpndrIdent', kind: 'write', category: 'radio', label: 'Transponder Ident' },
  { name: 'xpndrModeSet', kind: 'write', category: 'radio', label: 'Transponder Mode' },

  // --- Autopilot ---
  { name: 'apMasterState', kind: 'read', category: 'ap', label: 'AP Master State' },
  { name: 'apFdState', kind: 'read', category: 'ap', label: 'Flight Director State' },
  { name: 'apYdState', kind: 'read', category: 'ap', label: 'Yaw Damper State' },
  { name: 'apAtState', kind: 'read', category: 'ap', label: 'Auto-Throttle State' },
  { name: 'apHdgModeState', kind: 'read', category: 'ap', label: 'HDG Mode State' },
  { name: 'apNavModeState', kind: 'read', category: 'ap', label: 'NAV Mode State' },
  { name: 'apBcModeState', kind: 'read', category: 'ap', label: 'Backcourse Mode State' },
  { name: 'apAprModeState', kind: 'read', category: 'ap', label: 'Approach Mode State' },
  { name: 'apAltModeState', kind: 'read', category: 'ap', label: 'ALT Hold State' },
  { name: 'apVnavModeState', kind: 'read', category: 'ap', label: 'VNAV Mode State' },
  { name: 'apVsModeState', kind: 'read', category: 'ap', label: 'VS Hold State' },
  { name: 'apSpdModeState', kind: 'read', category: 'ap', label: 'SPD Hold State' },
  { name: 'apFlcModeState', kind: 'read', category: 'ap', label: 'FLC Mode State' },
  { name: 'apHdgBugValue', kind: 'read', category: 'ap', label: 'HDG Bug Value' },
  { name: 'apCrsBugValue', kind: 'read', category: 'ap', label: 'CRS Bug Value' },
  { name: 'apAltBugValue', kind: 'read', category: 'ap', label: 'ALT Bug Value' },
  { name: 'apVsBugValue', kind: 'read', category: 'ap', label: 'VS Bug Value' },
  { name: 'apIasBugValue', kind: 'read', category: 'ap', label: 'IAS Bug Value' },

  { name: 'apMaster', kind: 'write', category: 'ap', label: 'AP Master' },
  { name: 'apFdToggle', kind: 'write', category: 'ap', label: 'Flight Director' },
  { name: 'autoThrottleArm', kind: 'write', category: 'ap', label: 'Auto-Throttle Arm' },
  { name: 'apWingLeveler', kind: 'write', category: 'ap', label: 'Wing Leveler' },
  { name: 'apToga', kind: 'write', category: 'ap', label: 'TOGA' },
  { name: 'yawDamperToggle', kind: 'write', category: 'ap', label: 'Yaw Damper' },
  { name: 'autopilotDisengageToggle', kind: 'write', category: 'ap', label: 'AP Disconnect' },
  { name: 'apHdgHoldToggle', kind: 'write', category: 'ap', label: 'HDG Mode' },
  { name: 'apNavToggle', kind: 'write', category: 'ap', label: 'NAV Mode' },
  { name: 'apBcToggle', kind: 'write', category: 'ap', label: 'Backcourse Mode' },
  { name: 'apAprToggle', kind: 'write', category: 'ap', label: 'Approach Mode' },
  { name: 'apAltHoldToggle', kind: 'write', category: 'ap', label: 'ALT Hold' },
  { name: 'apVnavHoldToggle', kind: 'write', category: 'ap', label: 'VNAV Mode' },
  { name: 'apVsHoldToggle', kind: 'write', category: 'ap', label: 'VS Hold' },
  { name: 'apFlcToggle', kind: 'write', category: 'ap', label: 'FLC Mode' },
  { name: 'apSpdHoldToggle', kind: 'write', category: 'ap', label: 'SPD Hold' },
  { name: 'apCrsSync', kind: 'write', category: 'ap', label: 'CRS Sync' },
  { name: 'apHdgSet', kind: 'write', category: 'ap', label: 'HDG Bug Set' },
  { name: 'apHdgBugInc', kind: 'write', category: 'ap', label: 'HDG Bug +' },
  { name: 'apHdgBugDec', kind: 'write', category: 'ap', label: 'HDG Bug -' },
  { name: 'apAltSet', kind: 'write', category: 'ap', label: 'ALT Bug Set' },
  { name: 'apAltBugInc', kind: 'write', category: 'ap', label: 'ALT Bug +' },
  { name: 'apAltBugDec', kind: 'write', category: 'ap', label: 'ALT Bug -' },
  { name: 'apVsSet', kind: 'write', category: 'ap', label: 'VS Bug Set' },
  { name: 'apSpdSet', kind: 'write', category: 'ap', label: 'IAS Bug Set' },

  // --- Lights ---
  { name: 'landingLightState', kind: 'read', category: 'lights', label: 'Landing Light State' },
  { name: 'taxiLightState', kind: 'read', category: 'lights', label: 'Taxi Light State' },
  { name: 'navLightState', kind: 'read', category: 'lights', label: 'Nav Light State' },
  { name: 'strobeLightState', kind: 'read', category: 'lights', label: 'Strobe Light State' },
  { name: 'beaconLightState', kind: 'read', category: 'lights', label: 'Beacon Light State' },
  { name: 'logoLightState', kind: 'read', category: 'lights', label: 'Logo Light State' },
  { name: 'wingLightState', kind: 'read', category: 'lights', label: 'Wing/Ice Light State' },
  { name: 'panelFloodState', kind: 'read', category: 'lights', label: 'Panel Flood State' },
  { name: 'cabinLightState', kind: 'read', category: 'lights', label: 'Cabin Light State' },
  { name: 'panelBrightnessLevel', kind: 'read', category: 'lights', label: 'Panel Brightness Level' },

  { name: 'landingLightsToggle', kind: 'write', category: 'lights', label: 'Landing Lights' },
  { name: 'taxiLightsToggle', kind: 'write', category: 'lights', label: 'Taxi Lights' },
  { name: 'navLightsToggle', kind: 'write', category: 'lights', label: 'Nav/Pos Lights' },
  { name: 'strobeLightsToggle', kind: 'write', category: 'lights', label: 'Strobe Lights' },
  { name: 'beaconLightsToggle', kind: 'write', category: 'lights', label: 'Beacon Lights' },
  { name: 'logoLightsToggle', kind: 'write', category: 'lights', label: 'Logo Lights' },
  { name: 'wingLightsToggle', kind: 'write', category: 'lights', label: 'Wing/Ice Lights' },
  { name: 'allLightsToggle', kind: 'write', category: 'lights', label: 'All Exterior Lights' },
  { name: 'panelLightsToggle', kind: 'write', category: 'lights', label: 'Panel Flood Toggle' },
  { name: 'panelLightsInc', kind: 'write', category: 'lights', label: 'Panel Brightness +' },
  { name: 'panelLightsDec', kind: 'write', category: 'lights', label: 'Panel Brightness -' },
  { name: 'cabinLightsToggle', kind: 'write', category: 'lights', label: 'Cabin Lights' },

  // --- Virtual Yoke ---
  // Continuous elevator/aileron axis values driven by VirtualYokeEngine.js,
  // not discrete K:Event triggers like everything else above — see
  // docs/Virtual-Yoke-Page.md for the throttling/dead-band handling that
  // makes streaming these through the normal SIM_EVENT_DISPATCH path safe.
  { name: 'yokeElevatorAxis', kind: 'write', category: 'yoke', label: 'Virtual Yoke Elevator Axis' },
  { name: 'yokeAileronAxis', kind: 'write', category: 'yoke', label: 'Virtual Yoke Aileron Axis' }
];

export const DECK_EVENT_NAMES = DECK_EVENTS.map((e) => e.name);

export function getDeckEventsByKind(kind) {
  return DECK_EVENTS.filter((e) => e.kind === kind);
}

export function getDeckEventsByCategory(category) {
  return DECK_EVENTS.filter((e) => e.category === category);
}
