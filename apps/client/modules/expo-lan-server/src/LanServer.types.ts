/**
 * Types shared between the TS bridge and consumers. The shape mirrors
 * the legacy Capacitor `LanServer` plugin so adopting this module on
 * the dev client doesn't require call-site changes — `client/src/
 * native/lan-server.ts` just swaps its `NotImplementedLanServer` for
 * the real module.
 */

export interface LanServerStartOptions {
  /** Port to listen on. The native side may fall back to the next
   *  free port and report what it actually bound. */
  port: number;
  /** Path under which the WebSocket endpoint accepts upgrades.
   *  Defaults to `/ws`. */
  wsPath?: string;
}

export interface LanServerStartResult {
  /** Port actually bound. */
  port: number;
  /** All routable addresses the host can be reached on (LAN IPv4s,
   *  mDNS host name). */
  addresses: string[];
}

export interface LanServerConnectionEvent {
  id: string;
  /** Query string of the upgrade request,
   *  e.g. `?matchCode=ABCDE&playerId=...&name=Alice`. */
  query: string;
}

export interface LanServerMessageEvent {
  id: string;
  data: string;
}

export interface LanServerCloseEvent {
  id: string;
}

export interface LanServerAdvertiseOptions {
  /** Human-readable instance name shown to guests. The native side
   *  will deduplicate against existing advertisements with the same
   *  name on the local network. */
  serviceName: string;
  /** Port the service is listening on (e.g. the port returned from
   *  `start({ port })`). */
  port: number;
}

export interface LanServerDiscoveredHost {
  /** mDNS instance name. */
  name: string;
  /** Resolved IPv4 host address. */
  host: string;
  /** Resolved port. */
  port: number;
}

export interface LanServerHostLostEvent {
  /** mDNS instance name that left the network. */
  name: string;
}

export type LanServerEvents = {
  connection: (e: LanServerConnectionEvent) => void;
  message: (e: LanServerMessageEvent) => void;
  close: (e: LanServerCloseEvent) => void;
  hostFound: (e: LanServerDiscoveredHost) => void;
  hostLost: (e: LanServerHostLostEvent) => void;
};
