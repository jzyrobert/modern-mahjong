# Modern Mahjong

A cross-platform Hong Kong mahjong game (web + iOS + Android) built around a pure, fully unit-tested game engine.

See the design plan in [`docs/PLAN.md`](./docs/PLAN.md) and the live roadmap in [`TODO.md`](./TODO.md).

## Layout

```
packages/
  game-logic/   # Pure TS engine: tiles, state, reducer, shanten, scoring, claims
  protocol/     # Shared client ↔ server message types + zod schemas
  bots/         # AI strategies (simple / heuristic / passive)
apps/
  server/       # partyserver Worker (online matches)
  client/       # React + Vite + Capacitor app
```

## Quick start

```sh
pnpm install
pnpm test           # run all package tests
pnpm typecheck      # type-check the whole workspace
pnpm lint           # biome check
```

## Architecture

The same `@mahjong/game-logic` package is the single source of truth on both server and client. Clients send `Action` messages over a thin `Transport` interface; the server (a `partyserver` Durable Object online, or a host's Capacitor-bundled WebSocket server on the LAN) runs them through the engine and broadcasts the resulting state. All claim races (`chi`/`peng`/`gong`/`hu`) are resolved server-authoritatively in the room actor's single-threaded event loop.
