/**
 * deckEventPacks.js
 * Community Deck Events Packs — an authoring-tool-only convenience layer on
 * top of the FDWS v1.4 §1.2 bare-logical-name escape hatch (see
 * deckEvents.js). A widget referencing a logical name the host doesn't
 * recognize already works today — PC Bridge's profileManager.js
 * auto-registers it as an unmapped placeholder the moment such a widget is
 * installed (Appendix B item 3). What's missing is purely on the *authoring*
 * side: today "Custom…" suggestions in a binding picker only ever come from
 * names the same user already typed into another widget on this same
 * machine (see widgetVarExtractor.js's extractCustomDeckEvents), so a fresh
 * install has zero suggestions and there's no way for community widget
 * authors to share a common vocabulary of logical names beyond the fixed
 * canonical list.
 *
 * A "pack" is just a small importable/exportable JSON file — {name, kind,
 * category, label} entries, same shape as deckEvents.js's DECK_EVENTS — that
 * extends a binding picker's suggestions. It never touches the wire format,
 * the validator's accepted grammar, or any host resolution code: every name
 * a pack suggests is still a plain bare logical name, resolved exactly the
 * same (host-defined, §1.2) whether or not the host or any other user has
 * ever seen this particular pack.
 *
 * Synced (see ../scripts/sync-shared.mjs) to both flight-deck-pwa (used by
 * PropertyInspector.js) and widget-studio (used by StudioInspector.js and
 * StudioLayersPanel.js). Each app's imported packs live in that app's own
 * localStorage — importing a pack in Widget Studio does not make it appear
 * in the PWA, and vice versa; the JSON pack file itself is the sharing unit.
 */

import { DECK_EVENT_NAMES } from './deckEvents.js';

const STORAGE_KEY = 'fdws_deck_event_packs';

/** @typedef {{ name: string, kind: 'read'|'write', category?: string, label?: string }} PackEvent */
/** @typedef {{ id: string, name: string, author?: string, description?: string, events: PackEvent[] }} DeckEventPack */

export function loadImportedPacks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function savePacks(packs) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(packs));
}

/**
 * Validates and normalizes a raw parsed JSON object into a pack, or throws
 * with a human-readable reason (surfaced directly in the import dialog).
 * @param {any} raw
 * @returns {DeckEventPack}
 */
export function parsePackFile(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Not a valid pack file (expected a JSON object).');
  if (!raw.name || typeof raw.name !== 'string') throw new Error('Pack is missing a "name".');
  if (!Array.isArray(raw.events) || raw.events.length === 0) throw new Error('Pack has no "events" array, or it is empty.');

  const events = raw.events.map((e, idx) => {
    if (!e || typeof e.name !== 'string' || !e.name.trim()) throw new Error(`Event #${idx + 1} is missing a "name".`);
    if (e.kind !== 'read' && e.kind !== 'write') throw new Error(`Event "${e.name}" has invalid "kind" (must be "read" or "write").`);
    if (DECK_EVENT_NAMES.includes(e.name)) throw new Error(`Event "${e.name}" collides with a canonical Deck Event name — packs may only suggest new names.`);
    return { name: e.name.trim(), kind: e.kind, category: e.category || 'custom', label: e.label || e.name };
  });

  return {
    id: raw.id || `pack_${Date.now().toString(36)}`,
    name: raw.name,
    author: raw.author || 'Unknown',
    description: raw.description || '',
    events
  };
}

/**
 * Imports a pack, replacing any previously-imported pack with the same id
 * (re-importing an updated version of a pack you already have).
 * @param {DeckEventPack} pack
 */
export function importPack(pack) {
  const packs = loadImportedPacks().filter((p) => p.id !== pack.id);
  packs.push(pack);
  savePacks(packs);
  return pack;
}

export function removePack(id) {
  savePacks(loadImportedPacks().filter((p) => p.id !== id));
}

/**
 * Flattened, deduplicated view of every event suggested by any imported
 * pack — this is what a binding picker's "Custom…" dropdown merges in
 * alongside names found in the user's own saved/installed widgets.
 * @returns {(PackEvent & { fromPack: string })[]}
 */
export function getPackSuggestedEvents() {
  const seen = new Map();
  for (const pack of loadImportedPacks()) {
    for (const evt of pack.events) {
      if (!seen.has(evt.name)) seen.set(evt.name, { ...evt, fromPack: pack.name });
    }
  }
  return [...seen.values()];
}

/**
 * Builds a shareable pack file from a set of locally-coined custom Deck
 * Events (the same list extractCustomDeckEvents already computes for the
 * "used by another widget" suggestions) — the export half of the loop: a
 * user who came up with a good logical-name vocabulary for, say, a G1000
 * aircraft can hand this file to someone else, who imports it above.
 * @param {{name: string, kind: 'read'|'write', widgetIds: string[]}[]} customEvents
 * @param {{ name: string, author?: string, description?: string }} meta
 * @returns {DeckEventPack}
 */
export function buildPackFromCustomEvents(customEvents, meta) {
  return {
    id: `pack_${(meta.name || 'export').toLowerCase().replace(/[^a-z0-9]+/g, '-')}_${Date.now().toString(36)}`,
    name: meta.name || 'My Custom Deck Events',
    author: meta.author || '',
    description: meta.description || '',
    events: customEvents.map((e) => ({ name: e.name, kind: e.kind, category: 'custom', label: e.name }))
  };
}
