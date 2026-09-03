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

export function parsePastedBinding(raw) {
  const text = String(raw || '').trim();
  if (!text) return { kind: 'empty' };

  // Write: "<value> (><event>)" -- "1 (>K:XPNDR_IDENT_ON)"
  let m = text.match(/^(-?[\d.]+)\s*\(\s*>\s*([A-Za-z0-9_:.\-\s]+?)\s*\)\s*$/);
  if (m) {
    const event = m[2].trim();
    return { kind: /^H:/i.test(event) ? 'hevent' : 'write', event, value: Number(m[1]), raw: text };
  }

  // Write: bare H:Event with no value -- "(>H:AS1000_PFD_SOFTKEY_1)"
  m = text.match(/^\(\s*>\s*(H:[A-Za-z0-9_:.\-]+)\s*\)\s*$/i);
  if (m) {
    return { kind: 'hevent', event: m[1], value: null, raw: text };
  }

  // Read: "(A:Name, Unit)" or "(L:Name, Unit)"
  m = text.match(/^\(\s*([A-Za-z]:[A-Za-z0-9_:.\-\s]+?)\s*,\s*([A-Za-z0-9_%. \/]+?)\s*\)\s*$/);
  if (m) {
    return { kind: 'read', name: m[1].trim(), unit: m[2].trim(), raw: text };
  }

  // Read: bare name, no parens/prefix/arrow -- "TRANSPONDER CODE:1" or "xpndrCode"
  if (!/[()]/.test(text) && !/>/.test(text)) {
    return { kind: 'read', name: text, unit: null, raw: text };
  }

  return { kind: 'complex', raw: text };
}
