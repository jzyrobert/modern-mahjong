import { type EventSubscription, requireOptionalNativeModule } from 'expo-modules-core';
import type {
  LanServerAdvertiseOptions,
  LanServerCloseEvent,
  LanServerConnectionEvent,
  LanServerDiscoveredHost,
  LanServerHostLostEvent,
  LanServerMessageEvent,
  LanServerStartOptions,
  LanServerStartResult,
} from './LanServer.types';

/**
 * `requireOptionalNativeModule` returns null when the module isn't
 * loaded — which is the Expo Go case. The bridge below mirrors the
 * legacy Capacitor `LanServer` shape; methods throw a descriptive
 * error when the native module is absent so callers can short-circuit
 * via `isLanServerAvailable()`.
 */
const native = requireOptionalNativeModule<{
  start(opts: LanServerStartOptions): Promise<LanServerStartResult>;
  stop(): Promise<void>;
  send(opts: { id: string; data: string }): Promise<void>;
  advertise(opts: LanServerAdvertiseOptions): Promise<void>;
  unadvertise(): Promise<void>;
  startDiscovery(): Promise<void>;
  stopDiscovery(): Promise<void>;
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}>('LanServer');

const NOT_LOADED_MSG =
  'expo-lan-server: native module not loaded. Build a development client (eas build --profile development --platform android --local) to enable LAN hosting; the module is not bundled in Expo Go.';

export function isLanServerAvailable(): boolean {
  return native !== null;
}

export async function start(opts: LanServerStartOptions): Promise<LanServerStartResult> {
  if (!native) throw new Error(NOT_LOADED_MSG);
  return native.start(opts);
}

export async function stop(): Promise<void> {
  if (!native) return;
  return native.stop();
}

export async function send(opts: { id: string; data: string }): Promise<void> {
  if (!native) throw new Error(NOT_LOADED_MSG);
  return native.send(opts);
}

/**
 * Register an mDNS service on the local network so guests can
 * auto-discover this host without typing a URL. Service type is
 * `_modernmahjong._tcp.`. Pair with `unadvertise()` when the host
 * stops accepting connections.
 *
 * Throws when the native module isn't loaded (Expo Go path).
 */
export async function advertise(opts: LanServerAdvertiseOptions): Promise<void> {
  if (!native) throw new Error(NOT_LOADED_MSG);
  return native.advertise(opts);
}

export async function unadvertise(): Promise<void> {
  if (!native) return;
  return native.unadvertise();
}

/**
 * Begin scanning for `_modernmahjong._tcp.` services on the local
 * network. Each resolved host fires a `hostFound` event with name +
 * host + port; departures fire `hostLost` with the name.
 *
 * No-op when the native module isn't loaded (Expo Go path).
 */
export async function startDiscovery(): Promise<void> {
  if (!native) return;
  return native.startDiscovery();
}

export async function stopDiscovery(): Promise<void> {
  if (!native) return;
  return native.stopDiscovery();
}

/**
 * Wire a callback to a named event. Matches the legacy Capacitor
 * shape — `addListener('connection' | 'message' | 'close', cb)` →
 * a `{ remove: () => void }` subscription handle.
 *
 * Under the hood we use `expo-modules-core`'s
 * `addListener` shim. The native side fires events via
 * `sendEvent('connection' | 'message' | 'close', payload)`.
 */
type EventName = 'connection' | 'message' | 'close' | 'hostFound' | 'hostLost';

export function addListener(
  event: 'connection',
  cb: (e: LanServerConnectionEvent) => void,
): EventSubscription;
export function addListener(
  event: 'message',
  cb: (e: LanServerMessageEvent) => void,
): EventSubscription;
export function addListener(
  event: 'close',
  cb: (e: LanServerCloseEvent) => void,
): EventSubscription;
export function addListener(
  event: 'hostFound',
  cb: (e: LanServerDiscoveredHost) => void,
): EventSubscription;
export function addListener(
  event: 'hostLost',
  cb: (e: LanServerHostLostEvent) => void,
): EventSubscription;
// `any` (rather than `unknown`) on the implementation cb so the
// overload signatures above remain assignable under strict function
// types. The typed entry points are the overloads; the impl is the
// escape hatch that hands the payload straight to the native
// emitter.
// biome-ignore lint/suspicious/noExplicitAny: see comment above
export function addListener(event: EventName, cb: (e: any) => void): EventSubscription {
  if (!native) {
    return { remove: () => undefined } as EventSubscription;
  }
  // Cast: requireOptionalNativeModule returns the native module shape
  // we declared above; addEventListener is added by the
  // `EventEmitter.Events('connection', 'message', 'close')` block in
  // the Kotlin / Swift module.
  const emitter = native as unknown as {
    addListener: (e: string, cb: (payload: unknown) => void) => EventSubscription;
  };
  return emitter.addListener(event, cb);
}

export type {
  LanServerAdvertiseOptions,
  LanServerCloseEvent,
  LanServerConnectionEvent,
  LanServerDiscoveredHost,
  LanServerHostLostEvent,
  LanServerMessageEvent,
  LanServerStartOptions,
  LanServerStartResult,
};
