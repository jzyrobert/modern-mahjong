# expo-lan-server

Local Expo native module for hosting an HTTP + WebSocket server inside the
Modern Mahjong app — used by the lobby's **Host LAN match** flow. Mirrors the
shape of the legacy Capacitor `LanServer` plugin so adopting it requires no
call-site changes elsewhere in the client.

## Status

| Platform | Status |
|---|---|
| Android | Implemented via NanoHTTPD-WebSockets. WebSocket upgrade at the configured `wsPath` (default `/ws`); other HTTP requests serve the Expo Web export bundled into `assets/lan-bundle/` at APK build time, so guests can browser-join without installing the app (see "Bundling the web client" below). mDNS host advertisement + discovery are wired through `NsdManager`. |
| iOS     | Skeleton only — `start()` / `advertise()` / `startDiscovery()` throw. To finish, drop in [Telegraph](https://github.com/Building42/Telegraph) (or Swifter / GCDWebServer + a WebSocket layer) and follow the TODOs in `ios/LanServerModule.swift`. mDNS layer rides on `NetService` once the server boots. |

The TS bridge in `src/LanServer.ts` uses `requireOptionalNativeModule`, so on
web (and in Expo Go, where third-party modules aren't bundled) the module
resolves to `null`, `isLanServerAvailable()` returns `false`, and `start()`
throws the legacy "needs dev client" error. The lobby's `HostLanModal`
detects that and falls through to manual host-URL entry.

## Wiring

The module is autolinked into every native build via
`apps/client/package.json`'s `"expo-lan-server": "file:./modules/expo-lan-server"`
dependency. There's nothing to opt into — `pnpm install` resolves the local
module, `expo prebuild` writes `android/`/`ios/` projects that include it,
and `eas build` ships the resulting APK / IPA with the Kotlin / Swift
modules linked in.

| Environment | `isLanServerAvailable()` | Behaviour |
|---|---|---|
| Android dev / preview / production APK | `true` | Kotlin module hosts the WS + HTTP server. |
| iOS native build (any profile) | `true` | Swift skeleton loads; `start()` etc. throw — see "Status" above. |
| Web bundle (Cloudflare Pages) | `false` | `requireOptionalNativeModule` returns `null`; lobby falls back to manual host URL entry. |
| Expo Go | `false` | Same as web — third-party modules aren't bundled. |

## Local Android dev-client cycle

```bash
# 1. (Recommended) Produce the static Expo Web export so the LAN
#    host can serve guest browsers — see "Bundling the web client"
#    below.
pnpm --filter @mahjong/client export-web

# 2. Build a dev client APK locally on the workstation:
cd apps/client && eas build --profile development --platform android --local --output=./dev-client.apk

# 3. Install on a device or emulator.
adb install ./dev-client.apk
```

## Bundling the web client (browser guest join)

For guests to load the host's URL (`http://<lan-ip>:<port>/`) in any browser
without installing the app, the Expo Web export needs to be bundled into the
APK as Android assets. The module's `android/build.gradle` declares a Gradle
copy task (`stageLanBundleAssets`) that copies `apps/client/dist/` into
`assets/lan-bundle/` during APK build. So the activation sequence becomes:

```bash
# 1. Produce the static Expo Web export.
pnpm --filter @mahjong/client export-web   # writes apps/client/dist/

# 2. Build the dev client APK as before — Gradle picks dist/ up
#    automatically and ships it inside the APK.
cd apps/client && eas build --profile development --platform android --local
```

If `apps/client/dist/` doesn't exist, `stageLanBundleAssets` is a no-op and
the resulting APK ships without the web bundle. In that mode `serveHttp`
returns a 404 with a hint pointing at this section — i.e. host-WS still
works, but browser-join is disabled.

The host's URL serves:

- `/` and SPA routes (`/match`, etc.) → the Expo Router static HTML shell
  (deep-linked routes resolve via Expo Router's exported `*.html` files,
  with `index.html` as the SPA fallback).
- `/_expo/static/...` → the hashed JS / asset bundle, with
  `Cache-Control: public, immutable, max-age=31536000`.
- `/ws` (configurable via `start({ wsPath })`) → WebSocket upgrade for the
  match session.

## Architecture

```
┌────────────────┐  WebSocket       ┌────────────────────────┐
│ Guest device   │ ─────────────▶   │ Host device (this app) │
│ (this app or   │  ws://lan-ip/ws  │ ┌────────────────────┐ │
│  any browser)  │ ◀────────────    │ │ NanoHTTPD WSD      │ │
└────────────────┘                  │ │  (port 7777)       │ │
                                    │ └─────────┬──────────┘ │
                                    │           │  events    │
                                    │ ┌─────────▼──────────┐ │
                                    │ │ LanServerModule.kt │ │
                                    │ │  sendEvent(…)      │ │
                                    │ └─────────┬──────────┘ │
                                    │           │  JS bridge │
                                    │ ┌─────────▼──────────┐ │
                                    │ │ MatchSession (host │ │
                                    │ │  process — same    │ │
                                    │ │  reducer as Worker)│ │
                                    │ └────────────────────┘ │
                                    └────────────────────────┘
```

The host's `MatchSession` runs the same authoritative engine the Cloudflare
Worker uses for online matches. Per-connection messages from native fire as
JS `message` events; `applyClientMessage(connId, msg)` dispatches them and
the host calls `LanServer.send({ id, data })` to reply.

## Events

```ts
LanServer.addListener('connection', ({ id, query }) => { /* … */ });
LanServer.addListener('message',    ({ id, data })  => { /* … */ });
LanServer.addListener('close',      ({ id })        => { /* … */ });
```

The query string carries the legacy `playerId` + `name` + `matchCode`
parameters — same shape `MatchRoom.onConnect` expects.

## mDNS host advertisement / discovery

The host advertises `_modernmahjong._tcp.` via Android's `NsdManager`
once `start({ port })` returns; guests on the same Wi-Fi pick it up
automatically without the user typing a URL.

```ts
import { advertise, addListener, startDiscovery } from 'expo-lan-server';

// Host side, after `start()`:
await advertise({ serviceName: 'Robert\'s phone', port: result.port });

// Guest side:
await startDiscovery();
addListener('hostFound', ({ name, host, port }) => {
  console.log(`${name} → ws://${host}:${port}/ws`);
});
addListener('hostLost', ({ name }) => {
  console.log(`${name} left`);
});
```

The Android side uses `NsdManager.PROTOCOL_DNS_SD` for both register
and discover; the manifest declares
`CHANGE_WIFI_MULTICAST_STATE` so the mDNS announcements traverse
Wi-Fi multicast. iOS support is stubbed (`NetService` /
`NWBrowser`-based) — `advertise()` / `startDiscovery()` throw
`"not implemented"` until the iOS HTTP+WS server side lands.

The lobby's `HostLanModal` / `JoinLanModal` haven't been wired to
these events yet — that UI pass is queued in TODO.md. Today the
native primitives are available, just not surfaced.

## Wishlist

- iOS Telegraph implementation (HTTP+WS server itself; mDNS layer
  comes free with `NetService` once the server boots).
