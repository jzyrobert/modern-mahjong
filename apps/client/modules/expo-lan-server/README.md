# expo-lan-server

Local Expo native module for hosting an HTTP + WebSocket server inside the
Modern Mahjong app — used by the lobby's **Host LAN match** flow. Mirrors the
shape of the legacy Capacitor `LanServer` plugin so adopting it requires no
call-site changes elsewhere in the client.

## Status

| Platform | Status |
|---|---|
| Android | Implemented via NanoHTTPD-WebSockets. WebSocket upgrade at the configured `wsPath` (default `/ws`); HTTP routes return 404 (bundling the Expo Web build for guest browsers is queued). |
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

## Wishlist

- iOS Telegraph implementation.
- mDNS host advertisement (so guests can discover hosts without typing a URL).
- Static-asset HTTP route serving the Expo Web export, so guests can join from
  a plain browser tab without installing the app — closes the legacy plan's
  "guest visits the host's URL in their browser" workflow.
