# expo-lan-server

Local Expo native module for hosting an HTTP + WebSocket server inside the
Modern Mahjong app — used by the lobby's **Host LAN match** flow. Mirrors the
shape of the legacy Capacitor `LanServer` plugin so adopting it requires no
call-site changes elsewhere in the client.

## Status

| Platform | Status |
|---|---|
| Android | Implemented via NanoHTTPD-WebSockets. WebSocket upgrade at the configured `wsPath` (default `/ws`); other HTTP requests serve the Expo Web export bundled into `assets/lan-bundle/` at APK build time, so guests can browser-join without installing the app (see "Bundling the web client" below). |
| iOS     | Skeleton only — `start()` throws. To finish, drop in [Telegraph](https://github.com/Building42/Telegraph) (or Swifter / GCDWebServer + a WebSocket layer) and follow the TODOs in `ios/LanServerModule.swift`. |

The TS bridge in `src/LanServer.ts` uses `requireOptionalNativeModule`, so
when the module isn't loaded (e.g. running in Expo Go) `isLanServerAvailable()`
returns `false` and `start()` throws a descriptive error. That's the path the
lobby's `HostLanModal` falls back to when explaining to users they need a dev
client.

## Activating in a development build

Expo Go can't load third-party native modules. To host a LAN match you need a
custom development client:

```bash
# 1. Add the local module to apps/client's deps so autolinking picks it up.
#    (Already declared via `file:./modules/expo-lan-server` once you uncomment
#    that line in apps/client/package.json — see "Wiring" below.)

# 2. Generate native projects (apps/client/{android,ios}). These directories
#    are gitignored — CI regenerates them on every build.
cd apps/client && npx expo prebuild --no-install

# 3. Build a dev client APK locally.
eas build --profile development --platform android --local --output=./dev-client.apk

# 4. Install on a device or emulator.
adb install ./dev-client.apk
```

Once the dev client is running, `isLanServerAvailable()` returns true and
the host modal stops showing the "needs dev client" hint.

## Wiring

This module is **not** in `apps/client/package.json`'s dependencies by default —
that keeps Expo Go bundling clean. To activate, add:

```jsonc
{
  "dependencies": {
    "expo-lan-server": "file:./modules/expo-lan-server"
  }
}
```

Then run `pnpm install` and the module gets autolinked on the next prebuild.

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
