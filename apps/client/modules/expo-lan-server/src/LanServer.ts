import { type EventSubscription, requireOptionalNativeModule } from 'expo-modules-core';
import type {
  LanServerCloseEvent,
  LanServerConnectionEvent,
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
 * Wire a callback to a named event. Matches the legacy Capacitor
 * shape — `addListener('connection' | 'message' | 'close', cb)` →
 * a `{ remove: () => void }` subscription handle.
 *
 * Under the hood we use `expo-modules-core`'s
 * `addListener` shim. The native side fires events via
 * `sendEvent('connection' | 'message' | 'close', payload)`.
 */
type EventName = 'connection' | 'message' | 'close';

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
export function addListener(event: EventName, cb: (e: unknown) => void): EventSubscription {
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
  LanServerCloseEvent,
  LanServerConnectionEvent,
  LanServerMessageEvent,
  LanServerStartOptions,
  LanServerStartResult,
};
