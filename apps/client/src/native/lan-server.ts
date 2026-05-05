/**
 * Re-export shim for the local Expo native module at
 * `apps/client/modules/expo-lan-server/`. The module is now
 * autolinked into the published bundle via `apps/client/package.json`'s
 * `"expo-lan-server": "file:./modules/expo-lan-server"` dependency,
 * so:
 *
 *   - On native (Android dev / preview / production builds), the
 *     Kotlin module loads, `isLanServerAvailable()` returns `true`,
 *     and `LanServer.start()` boots the embedded NanoHTTPD server.
 *   - On iOS native builds, the Swift skeleton is loaded but every
 *     async function except `stop()` / `unadvertise()` /
 *     `stopDiscovery()` throws "not implemented yet". The lobby's
 *     copy still flips because the module is loaded — but actual
 *     `start()` calls fail with a descriptive error. The HTTP+WS
 *     server side of iOS lands once Telegraph (or equivalent) is
 *     wired up in `modules/expo-lan-server/ios/LanServerModule.swift`.
 *   - On web (and Expo Go, where third-party modules don't ship),
 *     `requireOptionalNativeModule('LanServer')` returns `null`,
 *     `isLanServerAvailable()` returns `false`, and method calls
 *     throw the legacy "needs dev client" error. The lobby's
 *     `HostLanModal` falls through to manual URL entry, same as
 *     before autolinking landed.
 */

export {
  addListener,
  advertise,
  isLanServerAvailable,
  send,
  start,
  startDiscovery,
  stop,
  stopDiscovery,
  unadvertise,
} from 'expo-lan-server';
export type {
  LanServerAdvertiseOptions,
  LanServerCloseEvent,
  LanServerConnectionEvent,
  LanServerDiscoveredHost,
  LanServerHostLostEvent,
  LanServerMessageEvent,
  LanServerStartOptions,
  LanServerStartResult,
} from 'expo-lan-server';
