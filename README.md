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
                # Local Expo Module for the LAN host's embedded
                # HTTP+WS server (NanoHTTPD-WebSockets) + mDNS
                # advertise/discover (NsdManager). Android Kotlin
                # implementation is complete; iOS is a Swift
                # skeleton that throws on `start()`. Autolinked
                # into every native build via `package.json`.
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

## Running on an Android emulator (AVD)

One-time setup:

1. Install Android Studio and create an AVD in **Tools → Device Manager** (Pixel 6 / API 34 is a good default).
2. Add `platform-tools` to your `PATH` so `adb` is on the shell — usually `~/Android/Sdk/platform-tools` (macOS/Linux) or `%LOCALAPPDATA%\Android\Sdk\platform-tools` (Windows).
3. Boot the AVD from Android Studio's Device Manager (or `emulator -avd <name>` from the command line) and wait for the home screen.

Run the app — pick **one** path:

- **Expo Go** (fastest, JS-only changes):
  ```sh
  pnpm --filter @mahjong/client start   # Metro on :8081
  # then press `a` in the Metro terminal to launch on the running AVD
  ```
  First time on a fresh emulator, run `adb reverse tcp:8081 tcp:8081` once so Expo Go can reach Metro at the host's localhost. Expo Go cannot host a LAN match (the `expo-lan-server` native module is unavailable there) — use a development build for that.

- **Development build** (required for native modules — LAN host, etc.):
  ```sh
  pnpm --filter @mahjong/client android   # = `expo run:android` — builds + installs the dev client on the running AVD
  ```
  Subsequent JS-only changes only need `pnpm --filter @mahjong/client start` again; rebuild only when native deps change.

Verify the emulator is visible to `adb`: `adb devices` should list `emulator-5554` (or similar) before pressing `a` or running `expo run:android`. If the bundle stays stuck on "Bundling…", confirm `adb reverse tcp:8081 tcp:8081` ran — Metro listens on the host's loopback only.

## Running tests

The full pre-push check pipeline (the same one CI runs):

```sh
pnpm -r typecheck                  # tsc --noEmit across all packages
pnpm lint                          # biome check
pnpm test                          # vitest in every package (engine, bots, protocol, server)
pnpm --filter @mahjong/client export-web   # rebuild dist/ — required before e2e
pnpm --filter @mahjong/client e2e          # Playwright against the static bundle
```

Notes for anyone running this for the first time:

- **`pnpm test` is fast** (~1s total) — covers engine reducers, shanten, scoring, claim flows, the heuristic ranker, the bots, the protocol schemas, and `MatchSession` snapshot/restore. Run it as the cheap inner loop while iterating on `packages/`.
- **E2e serves `apps/client/dist/`, not the dev server.** Playwright's `webServer` runs `npx serve dist`. If you skip `export-web` (or forget to rebuild after a code change) you'll be testing a stale bundle and may see confusing failures. CI always runs `export-web` immediately before Playwright; do the same locally.
- **First-run Playwright setup**: `pnpm --filter @mahjong/client exec playwright install chromium` if you don't have the browser cached. After that, `pnpm --filter @mahjong/client e2e` runs the whole suite (~50s on a laptop). To run a single spec, drop down to Playwright directly:
  ```sh
  pnpm --filter @mahjong/client exec playwright test e2e/discard-hint.spec.ts
  ```
- **Deterministic seeds for e2e**: specs that need a specific dice outcome (e.g. forcing the user to be dealer) inject a seed via `globalThis.__MAHJONG_TEST_SEED__` in a `page.addInitScript`. See `e2e/solo-match.spec.ts` and `e2e/discard-hint.spec.ts` for the pattern.
- **Engine state hatch**: `globalThis.__MAHJONG_TEST_GET_STATE__()` returns the live zustand store. Useful in specs when threading a `data-testid` through the component tree would be heavier than just reading the engine state.
- **Load-bearing test IDs**: `data-testid="own-hand-tile"`, `wall-draw-next`, and `hand-tile-recommended` are exercised by the e2e suite. Refactors to `Hand`, `Wall`, or `HandTile` need to keep these on the live click target — see `CLAUDE.md` for the full list.

To build a real Android APK locally see [`docs/DEPLOY.md`](./docs/DEPLOY.md#android-apk); CI also produces development + production APKs on every push to `main` as the `app-builds` workflow artifact (`react-native-cicd.yml`).

## Architecture

The same `@mahjong/game-logic` package is the single source of truth on both server and client. Clients send `Action` messages over a thin `Transport` interface; the server runs them through the engine and broadcasts the resulting state. All claim races (`chi`/`peng`/`gang`/`hu`) are resolved server-authoritatively in the room actor's single-threaded event loop.

There are three transport flavours, sharing a `createWsTransport` core:

- **Online** — a `partyserver` Durable Object on Cloudflare Workers. Each match code maps 1:1 to a single-threaded DO actor.
- **Solo** — an in-process engine loop that seats three bots (heuristic / simple / passive). No WebSocket, no server.
- **LAN** — guests connect to `ws://<host-lan-ip>:<port>/`. The host runs an embedded HTTP+WS server inside the app, exposed via the `expo-lan-server` native module (autolinked into every native build). On Android the host auto-populates its URL + advertises `_modernmahjong._tcp.` over mDNS; the guest's Join LAN modal subscribes to discovery and shows tap-to-pick nearby hosts. iOS native builds load the Swift skeleton — `start()` throws "not implemented" until Telegraph (or equivalent) is wired up. Web / Expo Go fall back to manual host-URL entry. Full activation notes: [`apps/client/modules/expo-lan-server/README.md`](./apps/client/modules/expo-lan-server/README.md).
