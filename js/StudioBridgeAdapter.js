/**
 * StudioBridgeAdapter.js
 * Minimal EventBus-shaped adapter so shared/SimBridge.js (moved there 0.3-A,
 * synced into core/SimBridge.js) can run against StudioState's notify()-based
 * pub/sub instead of the PWA's own per-topic EventBus. SimBridge only ever
 * calls five methods on whatever it's given (setBridgeClient/publish/
 * ingestTelemetry/ingestArrayData/getActiveSchemaManifest) — this class is
 * exactly that surface, nothing more.
 *
 * Scope is intentionally narrow for 0.3-A: connection lifecycle only
 * (BRIDGE_STATUS/SIM_STATUS -> the nav header's connection indicator, see
 * StudioApp.js). getActiveSchemaManifest() stays a stub (an empty manifest
 * just means Studio doesn't resubscribe to anything extra on connect,
 * harmless) — 0.3-B is what actually reads live values through this
 * connection and needs it to scan the currently-edited widget's own
 * bindings.
 */
export class StudioBridgeAdapter {
  constructor(studioState) {
    this.state = studioState;
    this.bridgeClient = null;
    this._listeners = new Map(); // eventName -> Set<callback>
  }

  setBridgeClient(bridge) {
    this.bridgeClient = bridge;
  }

  /**
   * @param {string} eventName
   * @param {(data: object) => void} callback
   * @returns {() => void} unsubscribe
   */
  subscribe(eventName, callback) {
    if (!this._listeners.has(eventName)) this._listeners.set(eventName, new Set());
    this._listeners.get(eventName).add(callback);
    return () => this._listeners.get(eventName)?.delete(callback);
  }

  publish(eventName, data) {
    this._listeners.get(eventName)?.forEach((cb) => cb(data));
  }

  ingestTelemetry(flatMap) {
    for (const [key, value] of Object.entries(flatMap || {})) {
      this.state.updateSimTelemetry(key, value);
    }
  }

  ingestArrayData(_source, _items) {
    // FDWS v1.2 §3.1a structured data (flight plan, CAS messages, etc.) --
    // not relevant to per-widget authoring in Studio. No-op.
  }

  getActiveSchemaManifest() {
    return { simVars: [], events: [] };
  }
}
