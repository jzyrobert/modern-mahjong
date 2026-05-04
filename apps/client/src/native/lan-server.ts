/**
 * `LanServer` bridge — TS spec for the Expo native module that lives
 * at `apps/client/modules/expo-lan-server/`. The shape mirrors the
 * legacy Capacitor plugin so adopting the dev-client native module
 * is a one-import swap (see "Activation" below).
 *
 * **Activation path** — when ready to switch to a dev client:
 *
 *   1. Add the local module to `apps/client/package.json`:
 *      `"expo-lan-server": "file:./modules/expo-lan-server"`
 *   2. `pnpm install`
 *   3. Re-export from this file:
 *      ```ts
 *      export {
 *        addListener, isLanServerAvailable, send, start, stop,
 *      } from 'expo-lan-server';
 *      ```
 *      (Replacing the `NotImplementedLanServer` block below.)
 *   4. `npx expo prebuild --no-install` then
 *      `eas build --profile development --platform android --local`.
 *
 * Until then `isLanServerAvailable()` returns false, the lobby's
 * Host LAN modal explains the dev-client requirement, and any
 * `start()` / `send()` call throws a descriptive error.
 */

export interface LanServerStartOptions {
  port: number;
  wsPath?: string;
}

export interface LanServerStartResult {
  port: number;
  addresses: string[];
}

export interface LanServerConnectionEvent {
  id: string;
  query: string;
}

export interface LanServerMessageEvent {
  id: string;
  data: string;
}

export interface LanServerCloseEvent {
  id: string;
}

interface LanServerApi {
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

const NOT_LOADED_MSG =
  'LanServer native module not loaded. Build a development client (eas build --profile development --platform android --local) to enable LAN hosting; the module is not bundled in Expo Go.';

class NotImplementedLanServer implements LanServerApi {
  async start(): Promise<LanServerStartResult> {
    throw new Error(NOT_LOADED_MSG);
  }
  async stop(): Promise<void> {
    /* no-op */
  }
  async send(): Promise<void> {
    throw new Error(NOT_LOADED_MSG);
  }
  addListener(): { remove: () => void } {
    return { remove: () => undefined };
  }
}

/**
 * True when the Expo Dev Client has the LanServer native module
 * loaded. In Expo Go / web / SSR this is always false.
 */
export function isLanServerAvailable(): boolean {
  return false;
}

export const LanServer: LanServerApi = new NotImplementedLanServer();
