/**
 * StudioBindingParse.js
 * Release 0.4-B: extracted from StudioInspector.js so the Property Inspector's
 * paste buttons and the bottom-bar SimVar Tester share one parser instead of
 * drifting apart. Studio-internal only.
 *
 * Still a deliberate second copy of pc-bridge/config-ui.html's parsePastedBinding():
 * that file is a plain non-module <script> and this is an ES module, so a copy of
 * a small pure function stays lower-risk than forcing a module boundary across
 * the two apps. The two are behaviourally identical as of 0.4 and should be
 * diffed together if either changes.
 *
 * Why a pasted WRITE lands differently in Studio than in the PC Bridge config
 * table: `1 (>K:XPNDR_IDENT_ON)` carries an event AND a value. config-ui.html
 * has a box for each (event + valueFormat). A widget binding has nowhere to put
 * the value — there is no `binding.value` in FDWS. For a raw address it belongs
 * on `interactions[].actions[].value` (what InteractionDispatcher reads); for a
 * bare Deck Event it belongs to PC Bridge's profile row. Either way, never on
 * `binding`. So Studio's consumers fill writeEvent and REPORT the value rather
 * than silently dropping it. `value: null` means the paste carried no value at
 * all, which is distinct from an explicit 0.
 */

/**
 * Classifies a write target by its prefix. Three kinds, two transports:
 * `write` (K:) goes out via transmitClientEvent; `hevent` (H:) and `lvarset`
 * (L:) are both calculator code executed by the WASM shim. They stay separate
 * kinds because the UI copy differs — "fires an event" vs "sets a variable" —
 * but every consumer that handles one of the shim kinds must handle both.
 */
function classifyWriteTarget(target, value, raw) {
  if (/^H:/i.test(target)) return { kind: 'hevent', event: target, value, raw };
  if (/^L:/i.test(target)) return { kind: 'lvarset', event: target, value, raw };
  return { kind: 'write', event: target, value, raw };
}

export function parsePastedBinding(raw) {
  const text = String(raw || '').trim();
  if (!text) return { kind: 'empty' };

  // Write: "<value> (><target>)" -- "1 (>K:XPNDR_IDENT_ON)", "1 (>L:S_XPDR_IDENT)"
  let m = text.match(/^(-?[\d.]+)\s*\(\s*>\s*([A-Za-z0-9_:.\-\s]+?)\s*\)\s*$/);
  if (m) {
    return classifyWriteTarget(m[2].trim(), Number(m[1]), text);
  }

  // Write with no explicit value -- "(>K:COM1_RADIO_SWAP)", "(>H:AS1000_PFD_SOFTKEY_1)".
  // Was H:-only, which left the valueless K: form — how HubHop publishes most
  // toggles, and the single most common paste there is — falling through to
  // 'complex' and reporting itself as untestable.
  m = text.match(/^\(\s*>\s*([A-Za-z0-9_:.\-\s]+?)\s*\)\s*$/);
  if (m) {
    return classifyWriteTarget(m[1].trim(), null, text);
  }

  // Read: "(A:Name, Unit)" or "(L:Name, Unit)"
  m = text.match(/^\(\s*([A-Za-z]:[A-Za-z0-9_:.\-\s]+?)\s*,\s*([A-Za-z0-9_%. \/]+?)\s*\)\s*$/);
  if (m) {
    return { kind: 'read', name: m[1].trim(), unit: m[2].trim(), raw: text };
  }

  // Read with no unit -- "(L:S_XPDR_IDENT)". HubHop lists LVars this way
  // constantly. `unit: null` is already the "caller decides" signal the bare-name
  // branch below uses, so consumers need no new handling for it.
  m = text.match(/^\(\s*([A-Za-z]:[A-Za-z0-9_:.\-\s]+?)\s*\)\s*$/);
  if (m) {
    return { kind: 'read', name: m[1].trim(), unit: null, raw: text };
  }

  // Read: bare name, no parens/prefix/arrow -- "TRANSPONDER CODE:1" or "xpndrCode"
  if (!/[()]/.test(text) && !/>/.test(text)) {
    return { kind: 'read', name: text, unit: null, raw: text };
  }

  return { kind: 'complex', raw: text };
}
