/**
 * SimBridge.js
 * Dynamic WebSocket Transport, RPC Event Negotiator & Preset Sync Client for MSFS 2024 PC Bridge
 */

import { SecurityValidator } from './SecurityValidator.js';

export class SimBridge {
  constructor(eventBus, serverUrl = null) {
    this.eventBus = eventBus;
    this.storageManager = null;
    this.customUrl = typeof localStorage !== 'undefined' ? localStorage.getItem('flightdeck_bridge_custom_url') : null;
    this.serverUrl = serverUrl || this.customUrl;
    this.ws = null;
    this.connected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 100;
    this.reconnectDelayMs = 1500;
    this.heartbeatInterval = null;
    this.pendingAcks = new Map();
    this.reqCounter = 1;
    this.lastSyncTime = null;
    // Debounce guard for USER_PRESETS_UPDATED-triggered resyncs (see
    // checkAndSyncPresets() below) — set the instant a check starts, cleared
    // 2s later regardless of outcome.
    this._lastSyncCheckStartedAt = 0;
    this.syncStats = {
      cachedProfilesCount: 0,
      cachedWidgetsCount: 0,
      cachedComponentsCount: 0
    };

    // Link eventBus to this bridge
    this.eventBus.setBridgeClient(this);
  }

  /**
   * Links storage manager for asset persistence synchronization
   * @param {import('./StorageManager.js').StorageManager} storageManager
   */
  setStorageManager(storageManager) {
    this.storageManager = storageManager;
    if (this.storageManager) {
      this.storageManager.setSimBridge(this);
    }
  }

  /**
   * Sets or updates custom PC Bridge Server URL / IP
   * @param {string|null} newUrl
   */
  setServerUrl(newUrl) {
    let clean = (newUrl || '').trim();
    if (clean) {
      if (!clean.startsWith('ws://') && !clean.startsWith('wss://') && !clean.startsWith('http://') && !clean.startsWith('https://')) {
        // A bare host ("192.168.1.50:8080") defaults to wss://, NOT to a
        // scheme derived from window.location.protocol. PC Bridge creates
        // exactly one server — `https.createServer()` in pc-bridge/server.js,
        // with no plain-HTTP fallback — so ws:// is never a reachable target
        // and deriving it from an http://-served page produced a URL that
        // could not work by construction. That bit Widget Studio hardest
        // (normally opened over file:// or a local http:// dev server), but
        // the PWA had the same latent bug whenever it wasn't served from PC
        // Bridge's own https:// address. An explicitly typed ws:// is still
        // honored below, for a hand-modified bridge without TLS.
        clean = `wss://${clean}`;
      } else if (clean.startsWith('http://')) {
        clean = clean.replace(/^http:\/\//, 'ws://');
      } else if (clean.startsWith('https://')) {
        clean = clean.replace(/^https:\/\//, 'wss://');
      }
      this.serverUrl = clean;
      // Keep customUrl in step with the stored value. It used to be read once
      // in the constructor and never updated, so any consumer reading it back
      // after a set (rather than re-reading localStorage, which is what the
      // PWA's SettingsView does) saw a stale value — Widget Studio's server
      // dialog hit exactly that, opening blank instead of pre-filled.
      this.customUrl = clean;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem('flightdeck_bridge_custom_url', clean);
      }
    } else {
      this.serverUrl = null;
      this.customUrl = null;
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem('flightdeck_bridge_custom_url');
      }
    }

    if (this.ws) {
      try {
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
    this.connected = false;
    this.reconnectAttempts = 0;
    this.eventBus.publish('BRIDGE_STATUS', { connected: false, url: this.getResolvedUrl() });
    this.connect();
  }

  /**
   * Default PC Bridge port. The bridge (pc-bridge/server.js) runs as its own
   * process independent of whatever serves the PWA's static files, so its
   * port can't be inferred from window.location.port.
   */
  static DEFAULT_BRIDGE_PORT = 8080;

  /**
   * Returns active or resolved WebSocket connection URL
   * @returns {string}
   */
  getResolvedUrl() {
    if (this.serverUrl) return this.serverUrl;
    if (typeof window !== 'undefined') {
      const loc = window.location;
      const protocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${protocol}//${loc.hostname}:${SimBridge.DEFAULT_BRIDGE_PORT}`;
    }
    return `ws://localhost:${SimBridge.DEFAULT_BRIDGE_PORT}`;
  }

  /**
   * Connects to WebSocket PC Bridge
   */
  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const wsUrl = this.getResolvedUrl();

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = async () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        console.log('[SimBridge] Connected to PC Bridge:', wsUrl);
        this.eventBus.publish('BRIDGE_STATUS', { connected: true, url: wsUrl });

        // 1. Request initial telemetry state
        this.requestFullState();

        // 1b. 0.2-B(c): pending/unmapped bindings -- see requestPendingMappings()
        this.requestPendingMappings();

        // 2. Resync registered custom dynamic SimVars/Events
        this.resyncActiveSchemaManifest();

        // 3. Automated Persistence Sync: Check for non-default presets, widgets, and components
        await this.checkAndSyncPresets();

        // 4. Start keep-alive heartbeat
        this.startHeartbeat();
      };

      this.ws.onmessage = (event) => {
        try {
          const packet = JSON.parse(event.data);
          this.handleIncomingMessage(packet);
        } catch (err) {
          console.error('[SimBridge] Error parsing incoming packet:', err);
        }
      };

      this.ws.onclose = () => {
        this.handleDisconnect();
      };

      this.ws.onerror = (err) => {
        console.warn('[SimBridge] WebSocket error:', err);
        this.handleDisconnect();
      };
    } catch (err) {
      console.error('[SimBridge] Connection failed:', err);
      this.scheduleReconnect();
    }
  }

  handleDisconnect() {
    if (this.connected) {
      this.connected = false;
      this.eventBus.publish('BRIDGE_STATUS', { connected: false });
      this.eventBus.publish('SIM_STATUS', { connected: false });
    }
    this.stopHeartbeat();
    this.scheduleReconnect();
  }

  scheduleReconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelayMs * Math.pow(1.3, this.reconnectAttempts - 1), 10000);
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.connected && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.sendRaw({ type: 'ping', timestamp: Date.now() });
      }
    }, 10000);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Routes incoming Bridge message
   * @param {object} packet
   */
  async handleIncomingMessage(packet) {
    if (!packet) return;

    // Handle ACKs and RPC Responses
    if (
      packet.type === 'REGISTER_EVENT_ACK' ||
      packet.type === 'SUBSCRIBE_ACK' ||
      packet.type === 'SAVE_USER_PRESET_ACK' ||
      packet.type === 'DELETE_USER_PRESET_ACK'
    ) {
      if (packet.requestId && this.pendingAcks.has(packet.requestId)) {
        const resolve = this.pendingAcks.get(packet.requestId);
        this.pendingAcks.delete(packet.requestId);
        resolve(packet);
      }
      return;
    }

    // 1. Sync Manifest Response (Diff of missing non-default assets)
    if (packet.type === 'SYNC_MANIFEST_RESPONSE') {
      if (packet.requestId && this.pendingAcks.has(packet.requestId)) {
        const resolve = this.pendingAcks.get(packet.requestId);
        this.pendingAcks.delete(packet.requestId);
        resolve(packet);
      }

      if (this.storageManager && packet.missing) {
        const stats = await this.storageManager.applyRemotePresets(packet.missing);
        // Pull-down handles what the client is missing; also push up anything
        // the PC is missing (e.g. a widget installed while offline, or one
        // whose original save-time push never landed) so sync is bidirectional.
        const pushStats = await this.storageManager.reconcilePushUp(packet.serverManifest);
        this.lastSyncTime = Date.now();
        console.log(`[SimBridge Sync] Sync complete: Applied ${stats.updatedProfiles} profiles, ${stats.updatedWidgets} widgets from PC Bridge. Pushed ${pushStats.pushedProfiles} profiles, ${pushStats.pushedWidgets} widgets to PC Bridge.`);
        this.eventBus.publish('USER_PRESETS_SYNCED', {
          stats,
          pushStats,
          missing: packet.missing,
          serverManifest: packet.serverManifest,
          lastSyncTime: this.lastSyncTime
        });
      }
      return;
    }

    // 2. Full User Presets Dump Response
    if (packet.type === 'ALL_USER_PRESETS_DATA') {
      if (packet.requestId && this.pendingAcks.has(packet.requestId)) {
        const resolve = this.pendingAcks.get(packet.requestId);
        this.pendingAcks.delete(packet.requestId);
        resolve(packet);
      }

      if (this.storageManager) {
        const stats = await this.storageManager.applyRemotePresets({
          profiles: packet.profiles,
          widgets: packet.widgets,
          components: packet.components
        });
        this.lastSyncTime = Date.now();
        console.log(`[SimBridge Sync] Hydrated mobile cache with all PC presets: ${stats.total} items.`);
        this.eventBus.publish('USER_PRESETS_SYNCED', {
          stats,
          profiles: packet.profiles,
          widgets: packet.widgets,
          components: packet.components,
          lastSyncTime: this.lastSyncTime
        });
      }
      return;
    }

    // 3. Live Broadcast from PC when assets change on PC Bridge
    if (packet.type === 'USER_PRESETS_UPDATED') {
      console.log(`[SimBridge Sync] Received PC Bridge live asset update: ${packet.itemType} (${packet.action})`);
      await this.checkAndSyncPresets();
      return;
    }

    // FDWS v1.2 §3.1a: structured array-data broadcast (flight plan, CAS messages, etc.)
    if (packet.type === 'ARRAY_DATA_UPDATE') {
      this.eventBus.ingestArrayData(packet.source, packet.items);
      return;
    }

    if (packet.type === 'SUBSCRIBE_ARRAY_DATA_ACK') {
      return;
    }

    // Handle Telemetry frame. packet.data is the normal shape (a flat
    // simVarName -> value map); the `packet` fallback supports a legacy
    // format that put simvars directly at the top level (no wrapper at
    // all — see the `packet.com1_act !== undefined` sniff above). The two
    // are mutually exclusive: whichever one contains real values, use it
    // alone. The previous `{ ...packet.data, ...packet }` merge always
    // re-added packet's own envelope keys (`type`, `profile`, and `data`
    // itself, redundantly) on top, silently queuing three bogus "simvar"
    // entries into every telemetry frame that had a `.data` wrapper at all.
    if (packet.type === 'simData' || packet.data || packet.com1_act !== undefined) {
      // 0.2-B(d): requestState's response is also type 'simData' and is the
      // only simData message that ever carries a `profile` field -- periodic
      // broadcasts from updateSimVars() never do. This is that field's one
      // arrival point; PROFILE_CHANGED (below) covers a live in-session switch.
      if (packet.profile) {
        this.eventBus.publish('BINDING_PROFILE_CHANGED', { name: packet.profile });
      }
      const telemetry = packet.data || packet;
      this.eventBus.ingestTelemetry(telemetry);
      return;
    }

    if (packet.type === 'pong') {
      return;
    }

    // SimConnect (sim) status, distinct from the PC Bridge WebSocket status above
    if (packet.type === 'STATUS') {
      this.eventBus.publish('SIM_STATUS', { connected: !!packet.connected });
      return;
    }

    // 0.2-B(d): fires on a live profile switch (from PC Bridge's own UI) --
    // was already broadcast server-side (broadcastProfileChange()) but never
    // handled here.
    if (packet.type === 'PROFILE_CHANGED') {
      this.eventBus.publish('BINDING_PROFILE_CHANGED', { name: packet.profileName });
      return;
    }

    // 0.2-B(c): response to requestPendingMappings() below, called once on
    // every connect so a phone that missed the one-shot
    // PENDING_MAPPINGS_UPDATED broadcast (virtually always -- it fires only
    // at widget-install time, which the phone is rarely connected for) still
    // sees what needs configuring before flight.
    if (packet.type === 'PENDING_MAPPINGS_RESPONSE') {
      this.eventBus.publish('PENDING_MAPPINGS_UPDATED', { pending: packet.pending || [] });
      return;
    }

    // Broadcast fired only when a widget install adds new unmapped entries
    // (added > 0) -- carries a count, not the full list, so a session that's
    // open when it fires just re-requests the full list rather than trying
    // to reconstruct it from `added`/`widgetId` alone.
    if (packet.type === 'PENDING_MAPPINGS_UPDATED') {
      this.requestPendingMappings();
      return;
    }

    // 0.2-B(b): rendered previously only in pc-bridge's own bridge-ui.html/
    // config-ui.html.
    if (packet.type === 'SIMVAR_BINDING_ERROR') {
      this.eventBus.publish('SIMVAR_BINDING_ERROR', packet);
      return;
    }

    // 0.2-B(a): the write-dispatch failure path (dispatchSimEvent()) used to
    // be silent -- console.warn() on the PC, nothing on the phone that just
    // pressed the button.
    if (packet.type === 'SIM_EVENT_DISPATCH_FAILED') {
      this.eventBus.publish('SIM_EVENT_DISPATCH_FAILED', packet);
      return;
    }

    // 0.3-B: responses to probeReadSimVar()/testExecuteCalculatorCode()/
    // resolveDeckEvent() below -- same generic pendingAcks correlation
    // fetchAllUserPresets() etc. already use, just routed for five response
    // types at once since all three RPCs share this one resolution shape.
    if (
      packet.type === 'PROBE_READ_RESULT' || packet.type === 'PROBE_READ_ERROR' ||
      packet.type === 'PROBE_WRITE_RESULT' || packet.type === 'PROBE_WRITE_ERROR' ||
      packet.type === 'RESOLVE_DECK_EVENT_RESULT'
    ) {
      if (packet.requestId && this.pendingAcks.has(packet.requestId)) {
        const resolve = this.pendingAcks.get(packet.requestId);
        this.pendingAcks.delete(packet.requestId);
        resolve(packet);
      }
      return;
    }

    // PC Bridge just live-rebuilt its SimConnect data definitions after a
    // binding edit (unit/SimVar fixed, or the active profile switched) — see
    // server.js's rebuildDynamicSimVarChunks(). The corrected values will
    // start arriving on their own via the normal periodic simData stream,
    // but request a fresh snapshot right away too so a widget that's been
    // sitting on stale/no data doesn't have to wait out the next tick.
    if (packet.type === 'SIMVAR_BINDINGS_UPDATED') {
      this.requestFullState();
      this.eventBus.publish('SIMVAR_BINDINGS_UPDATED', {});
      return;
    }
  }

  /**
   * Sends raw JSON payload over WebSocket
   * @param {object} payload
   */
  sendRaw(payload) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
      return true;
    }
    return false;
  }

  /**
   * Request full telemetry state snapshot
   */
  requestFullState() {
    this.sendRaw({ type: 'requestState' });
  }

  /**
   * 0.2-B(c): asks PC Bridge for every currently-unmapped auto-discovered
   * binding across all profiles. Response arrives as PENDING_MAPPINGS_RESPONSE
   * (see handleIncomingMessage()) -- fire-and-forget, no requestId
   * correlation needed since nothing here awaits a specific response.
   */
  requestPendingMappings() {
    this.sendRaw({ type: 'GET_PENDING_MAPPINGS', requestId: `pm_${Date.now()}` });
  }

  /**
   * Resyncs active schema manifest on reconnection
   */
  resyncActiveSchemaManifest() {
    const manifest = this.eventBus.getActiveSchemaManifest();
    if (manifest.simVars.length > 0 || manifest.events.length > 0) {
      this.sendRaw({
        type: 'SYNC_SCHEMA_MANIFEST',
        manifest
      });
    }
  }

  /**
   * Checks with PC Bridge if mobile cache has latest non-default presets, widgets, and components.
   * If missing or outdated, fetches them and saves to mobile cache.
   *
   * Debounced against its own trigger: `USER_PRESETS_UPDATED` (broadcast to every
   * connected client, including whichever one just pushed a save — see
   * handleIncomingMessage()) calls this unconditionally on receipt. A genuine
   * server-side inconsistency (reproduced 2026-08-29: a duplicate widget file with
   * an unstable reported `updatedAt` — see pc-bridge's userPresetManager.js) could
   * make reconcilePushUp() decide to push again every single time, and each push's
   * own broadcast immediately re-triggered this — an unbounded resync loop with no
   * external timer needed. That root cause is fixed server-side, but this debounce
   * stays as a backstop: without it, any future one-off inconsistency turns into the
   * same runaway loop instead of self-correcting after one harmless extra round trip.
   * @returns {Promise<object>}
   */
  async checkAndSyncPresets() {
    if (!this.connected || !this.storageManager) return null;

    const now = Date.now();
    if (now - this._lastSyncCheckStartedAt < 2000) {
      return { status: 'DEBOUNCED' };
    }
    this._lastSyncCheckStartedAt = now;

    try {
      const localManifest = await this.storageManager.generateSyncManifest();
      const requestId = `sync_chk_${this.reqCounter++}_${Date.now()}`;

      const payload = {
        type: 'CHECK_SYNC_MANIFEST',
        requestId,
        manifest: localManifest
      };

      return new Promise((resolve) => {
        this.pendingAcks.set(requestId, resolve);
        this.sendRaw(payload);

        // Timeout fallback
        setTimeout(() => {
          if (this.pendingAcks.has(requestId)) {
            this.pendingAcks.delete(requestId);
            resolve({ status: 'TIMEOUT' });
          }
        }, 5000);
      });
    } catch (err) {
      console.warn('[SimBridge] Check and sync presets failed:', err);
      return null;
    }
  }

  /**
   * Requests a full download of all non-default user presets, widgets, and components from PC Bridge
   * @returns {Promise<object>}
   */
  async fetchAllUserPresets() {
    if (!this.connected) return null;

    const requestId = `sync_all_${this.reqCounter++}_${Date.now()}`;
    const payload = {
      type: 'FETCH_ALL_USER_PRESETS',
      requestId
    };

    return new Promise((resolve) => {
      this.pendingAcks.set(requestId, resolve);
      this.sendRaw(payload);

      setTimeout(() => {
        if (this.pendingAcks.has(requestId)) {
          this.pendingAcks.delete(requestId);
          resolve({ status: 'TIMEOUT' });
        }
      }, 6000);
    });
  }

  /**
   * 0.3-B: paste-and-test read-side probe -- adds `rawName` to PC Bridge's
   * own scratch data definition (server.js's probeReadSimVar(), isolated
   * from every real widget's chunk) and returns one live value. Same
   * function config-ui.html calls over Electron IPC; this is the WS RPC
   * path for a plain web page (Widget Studio) with no IPC access.
   * @param {string} rawName - raw A:/L:-prefixed address (H:/K: rejected)
   * @param {string} [unit]
   * @returns {Promise<number>}
   */
  probeReadSimVar(rawName, unit) {
    if (!this.connected) return Promise.reject(new Error('Not connected to PC Bridge.'));
    const requestId = `probe_read_${this.reqCounter++}_${Date.now()}`;
    return new Promise((resolve, reject) => {
      this.pendingAcks.set(requestId, (packet) => {
        if (packet.type === 'PROBE_READ_ERROR') reject(new Error(packet.reason));
        else resolve(packet.value);
      });
      this.sendRaw({ type: 'PROBE_READ_SIMVAR', requestId, rawName, unit });
      setTimeout(() => {
        if (this.pendingAcks.has(requestId)) {
          this.pendingAcks.delete(requestId);
          reject(new Error('Timed out waiting for PC Bridge.'));
        }
      }, 4000);
    });
  }

  /**
   * 0.3-B paste-box write test: executes arbitrary calculator code verbatim
   * via the WASM shim (server.js's testExecuteCalculatorCode()) -- test
   * path only, never the save path (a saved binding always dispatches
   * through the real transmitClientEvent path at runtime). See the paste
   * box's own hazard labelling for why that distinction matters.
   * @param {string} code
   * @returns {Promise<{executed: boolean|null, fvalue: number|null, timedOut: boolean}>}
   */
  testExecuteCalculatorCode(code) {
    if (!this.connected) return Promise.reject(new Error('Not connected to PC Bridge.'));
    const requestId = `probe_write_${this.reqCounter++}_${Date.now()}`;
    return new Promise((resolve, reject) => {
      this.pendingAcks.set(requestId, (packet) => {
        if (packet.type === 'PROBE_WRITE_ERROR') reject(new Error(packet.reason));
        else resolve({ executed: packet.executed, fvalue: packet.fvalue, timedOut: packet.timedOut });
      });
      this.sendRaw({ type: 'PROBE_TEST_WRITE', requestId, code });
      setTimeout(() => {
        if (this.pendingAcks.has(requestId)) {
          this.pendingAcks.delete(requestId);
          reject(new Error('Timed out waiting for PC Bridge.'));
        }
      }, 4000);
    });
  }

  /**
   * 0.1-C(c)/0.3-B: resolves a bare Deck Event's live unit + active profile
   * name, e.g. "Bco16 — from profile 'Default'" -- read-only, mirrors
   * exactly what the real dynamic-subscribe path would resolve to.
   * @param {string} logicalName
   * @returns {Promise<{simVar: string, unit: string, profileName: string}|null>}
   */
  resolveDeckEvent(logicalName) {
    if (!this.connected) return Promise.resolve(null);
    const requestId = `resolve_de_${this.reqCounter++}_${Date.now()}`;
    return new Promise((resolve) => {
      this.pendingAcks.set(requestId, (packet) => resolve(packet.resolved));
      this.sendRaw({ type: 'RESOLVE_DECK_EVENT', requestId, logicalName });
      setTimeout(() => {
        if (this.pendingAcks.has(requestId)) {
          this.pendingAcks.delete(requestId);
          resolve(null);
        }
      }, 4000);
    });
  }

  /**
   * Saves or updates a non-default preset, custom widget, or custom component to PC Bridge disk storage
   * @param {'profile'|'widget'|'component'} itemType
   * @param {object} data
   * @returns {Promise<object>}
   */
  saveUserPreset(itemType, data) {
    if (!this.connected || !data || !data.id) {
      return Promise.resolve({ status: 'OFFLINE' });
    }

    const requestId = `save_prs_${this.reqCounter++}_${Date.now()}`;
    const payload = {
      type: 'SAVE_USER_PRESET',
      requestId,
      itemType,
      data,
      updatedAt: Date.now()
    };

    return new Promise((resolve) => {
      this.pendingAcks.set(requestId, resolve);
      this.sendRaw(payload);

      setTimeout(() => {
        if (this.pendingAcks.has(requestId)) {
          this.pendingAcks.delete(requestId);
          resolve({ status: 'TIMEOUT' });
        }
      }, 4000);
    });
  }

  /**
   * Deletes a non-default preset, widget, or component from PC Bridge disk storage
   * @param {'profile'|'widget'|'component'} itemType
   * @param {string} id
   * @returns {Promise<object>}
   */
  deleteUserPreset(itemType, id) {
    if (!this.connected || !id) {
      return Promise.resolve({ status: 'OFFLINE' });
    }

    const requestId = `del_prs_${this.reqCounter++}_${Date.now()}`;
    const payload = {
      type: 'DELETE_USER_PRESET',
      requestId,
      itemType,
      id
    };

    return new Promise((resolve) => {
      this.pendingAcks.set(requestId, resolve);
      this.sendRaw(payload);

      setTimeout(() => {
        if (this.pendingAcks.has(requestId)) {
          this.pendingAcks.delete(requestId);
          resolve({ status: 'TIMEOUT' });
        }
      }, 4000);
    });
  }

  /**
   * Dynamic Event Registration RPC
   * @param {string} eventName
   * @param {string} category
   * @param {string} description
   * @returns {Promise<object>}
   */
  registerDynamicEvent(eventName, category = 'K_EVENT', description = '') {
    const cleanEvent = SecurityValidator.sanitizeEventName(eventName);
    if (!cleanEvent) return Promise.reject(new Error('Invalid event identifier'));

    const requestId = `req_ev_${this.reqCounter++}_${Date.now()}`;
    const payload = {
      type: 'REGISTER_EVENT',
      requestId,
      eventName: cleanEvent,
      category,
      description
    };

    return new Promise((resolve) => {
      this.pendingAcks.set(requestId, resolve);
      this.sendRaw(payload);
      // Timeout fallback
      setTimeout(() => {
        if (this.pendingAcks.has(requestId)) {
          this.pendingAcks.delete(requestId);
          resolve({ status: 'TIMEOUT', eventName: cleanEvent });
        }
      }, 3000);
    });
  }

  /**
   * Dynamic SimVar Telemetry Subscription RPC
   *
   * FDWS v1.7 §1.1: `pollFrequencyHz` is a coarse rate *hint*, not a literal
   * target Hz — PC Bridge only has two SimConnect polling tiers to place a
   * var into (1Hz "normal", or SimConnect's fastest available period "fast"
   * — see `pc-bridge/server.js`'s `subscribeDynamicSimVar()`), so any value
   * above its fast-tier threshold gets the same "fast" treatment regardless
   * of how much higher it is. Defaults to `1` (normal/legacy 1Hz tier) —
   * only widgets that actually need fast updates (e.g. an attitude
   * indicator's pitch/bank) should pass a higher value.
   * FDWS v1.26 §1: `groupKey` (from `binding.pollGroup` / `state[].pollGroup`,
   * defaulting to the subscribing widget's own definition id if the author
   * left it blank — see BaseWidget.js/CompositeWidget.js) picks which
   * SimConnect chunk this var's data definition joins on the bridge, so a
   * widget's own vars land together in one chunk instead of being
   * interleaved with unrelated widgets' vars purely by subscribe-order
   * timing. Only meaningful the first time PC Bridge sees this simVar.
   * @param {string} simVar
   * @param {string} unit
   * @param {number} deadband
   * @param {number} pollFrequencyHz
   * @param {string} [groupKey]
   */
  subscribeSimVar(simVar, unit = 'Number', deadband = 0, pollFrequencyHz = 1, groupKey) {
    const cleanVar = SecurityValidator.sanitizeSimVar(simVar);
    if (!cleanVar) return;

    this.sendRaw({
      type: 'SUBSCRIBE_SIMVAR',
      simVar: cleanVar,
      unit: unit || 'Number',
      pollFrequencyHz: Number(pollFrequencyHz) || 1,
      pollGroup: groupKey || undefined,
      deadband: Number(deadband) || 0
    });
  }

  /**
   * FDWS v1.2 §3.1a: Structured Array Data Subscription RPC — the array-typed
   * counterpart to subscribeSimVar(), for flight-plan legs, CAS/EICAS message queues,
   * and nearest-airport lists. Matching ARRAY_DATA_UPDATE broadcasts are routed to
   * EventBus.ingestArrayData() in handleIncomingMessage().
   * @param {string} source - e.g. "FLIGHTPLAN", "CAS_MESSAGES", "NEAREST_AIRPORTS"
   */
  subscribeArrayData(source) {
    if (!source) return;
    this.sendRaw({
      type: 'SUBSCRIBE_ARRAY_DATA',
      source
    });
  }

  /**
   * Dynamic SimVar Unregister RPC
   * @param {string} simVar
   */
  unregisterSimVar(simVar) {
    const cleanVar = SecurityValidator.sanitizeSimVar(simVar);
    if (!cleanVar) return;

    this.sendRaw({
      type: 'UNREGISTER_SIMVAR',
      simVar: cleanVar
    });
  }

  /**
   * Dispatches SimEvent to PC Bridge
   * @param {string} event
   * @param {number|string} value
   * @param {string} category
   */
  sendEvent(event, value = 0, category = 'K_EVENT') {
    const cleanEvent = SecurityValidator.sanitizeEventName(event);
    if (!cleanEvent) return;

    this.sendRaw({
      type: 'event',
      event: cleanEvent,
      name: cleanEvent,
      value: value !== undefined ? value : 0,
      category: category || 'K_EVENT'
    });
  }

  /**
   * Switches active aircraft profile on PC Bridge
   * @param {string} profileId
   */
  setActiveProfile(profileId) {
    this.sendRaw({
      type: 'setProfile',
      profileId
    });
  }
}
