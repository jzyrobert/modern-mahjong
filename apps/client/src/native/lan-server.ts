/**
 * Capacitor `LanServer` plugin bridge — TS spec for the (not-yet-built)
 * native plugin. When the iOS/Android implementations land, the
 * `NotImplementedLanServer` stub below is swapped for a
 * `registerPlugin('LanServer', ...)` call.
 */

export interface LanServerStartOptions {
  /** Port to listen on. The native side may fall back to the next free port and report what it bound. */
  port: number;
  /** Path under which the WebSocket endpoint accepts upgrades (default `/ws`). */
  wsPath?: string;
}

export interface LanServerStartResult {
  /** Port actually bound. */
  port: number;
  /** All routable addresses the host can be reached on (LAN IPv4s, mDNS host name). */
  addresses: string[];
}

export interface LanServerConnectionEvent {
  id: string;
  /** URL query string for the upgrade request, e.g. `?matchCode=ABCDE&playerId=...`. */
  query: string;
}
export interface LanServerMessageEvent {
  id: string;
  data: string;
}
export interface LanServerCloseEvent {
  id: string;
}

export interface LanServer {
  start(opts: LanServerStartOptions): Promise<LanServerStartResult>;
  stop(): Promise<void>;
  send(opts: { id: string; data: string }): Promise<void>;
  addListener(
    event: 'connection',
    cb: (e: LanServerConnectionEvent) => void,
  ): { remove: () => void };
  addListener(event: 'message', cb: (e: LanServerMessageEvent) => void): { remove: () => void };
  addListener(event: 'close', cb: (e: LanServerCloseEvent) => void): { remove: () => void };
}

class NotImplementedLanServer implements LanServer {
  async start(): Promise<LanServerStartResult> {
    throw new Error(
      'LanServer native plugin not implemented yet — see apps/client/native/lan-server/README.',
    );
  }
  async stop(): Promise<void> {
    /* no-op */
  }
  async send(): Promise<void> {
    throw new Error('LanServer native plugin not implemented yet.');
  }
  addListener(): { remove: () => void } {
    return { remove: () => undefined };
  }
}

/** Detect whether we're running inside a Capacitor shell that has the native plugin available. */
export function isLanServerAvailable(): boolean {
  // The real check will look for `Capacitor.isPluginAvailable('LanServer')` once Capacitor is wired up.
  return false;
}

export const LanServer: LanServer = new NotImplementedLanServer();
