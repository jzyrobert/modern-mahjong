# Modern Mahjong

A cross-platform Hong Kong mahjong game (web + iOS + Android) built around a pure, fully unit-tested game engine.

The web build runs at <https://modern-mahjong.pages.dev>. See the design plan in [`docs/PLAN.md`](./docs/PLAN.md) (historical reference; the original Vite + Capacitor stack has since been replaced by Expo Router + Metro), the deployment guide in [`docs/DEPLOY.md`](./docs/DEPLOY.md), and the live roadmap in [`TODO.md`](./TODO.md).

## Layout

```
packages/
  game-logic/   # Pure TS engine: tiles, state, reducer, shanten, scoring, claims
  protocol/     # Shared client ↔ server message types + zod schemas
  bots/         # AI strategies (simple / heuristic / passive)
apps/
  server/       # partyserver Worker (online matches)
  client/       # Expo Router + Metro app — one codebase for web (react-native-web)
                # + Android + iOS, packaged via EAS Build
  client/modules/expo-lan-server/
                # Local Expo Module skeleton for the LAN host's
                # embedded HTTP+WS server. Android (Kotlin /
                # NanoHTTPD-WebSockets) implemented; iOS is a stub.
                # Not auto-linked into the published bundle yet — a
                # dev-client build is needed to enable LAN host mode.
```

## Quick start

```sh
pnpm install
pnpm test           # run all package tests
pnpm -r typecheck   # type-check the whole workspace
pnpm lint           # biome check
```

Day-to-day client work:

```sh
pnpm --filter @mahjong/client start        # Metro dev server (native + web)
pnpm --filter @mahjong/client web          # web-only dev (browser at :8081)
pnpm --filter @mahjong/client export-web   # static web bundle into apps/client/dist/
pnpm --filter @mahjong/client e2e          # Playwright (against the static bundle)
```

For the online server: `pnpm --filter @mahjong/server dev` (`wrangler dev` on `:8787`). The client picks up `EXPO_PUBLIC_SERVER_URL` if set and falls back to `localhost:8787`.

To build a real Android APK locally see [`docs/DEPLOY.md`](./docs/DEPLOY.md#android-apk); CI also produces a debug APK on every push as the `client-apk-debug` workflow artifact.

## Architecture

The same `@mahjong/game-logic` package is the single source of truth on both server and client. Clients send `Action` messages over a thin `Transport` interface; the server runs them through the engine and broadcasts the resulting state. All claim races (`chi`/`peng`/`gong`/`hu`) are resolved server-authoritatively in the room actor's single-threaded event loop.

There are three transport flavours, sharing a `createWsTransport` core:

- **Online** — a `partyserver` Durable Object on Cloudflare Workers. Each match code maps 1:1 to a single-threaded DO actor.
- **Solo** — an in-process engine loop that seats three bots (heuristic / simple / passive). No WebSocket, no server.
- **LAN** — guests connect to `ws://<host-lan-ip>:<port>/`. The host runs an embedded HTTP+WS server inside the app, exposed via the `expo-lan-server` native module. Android implementation is in place; iOS is stubbed and the module isn't auto-linked into the published bundle, so LAN host mode currently requires a dev-client build (see [`apps/client/modules/expo-lan-server/README.md`](./apps/client/modules/expo-lan-server/README.md)).
