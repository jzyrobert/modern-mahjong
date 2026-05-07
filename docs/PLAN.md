# Modern Hong Kong Mahjong — Detailed Design Plan

## Context

This document captures the original ground-up design for the project. The repository now contains an implemented monorepo, but the goals, architecture, and tradeoffs below remain the reference. Live progress against this plan is tracked in [`../TODO.md`](../TODO.md).

**Goals**

- Implement the simplest variant of Hong Kong mahjong using only suit and honor tiles: **136 tiles total** (3 suits × 9 ranks × 4 = 108, 4 winds × 4 = 16, 3 dragons × 4 = 12). No flowers/seasons/jokers.
- Cross-platform: a single React/TypeScript codebase that runs as a webapp on desktop and mobile and is packaged into Android and iOS apps via Capacitor.
- Smooth, "fluid" animations on tile draws/discards/melds, while remaining performant on low-end mobile devices (target: 60 fps tile motion on a mid-range Android from ~2020).
- No traditional accounts; each device has a persistent player UUID stored in `localStorage`, plus a user-chosen display name that can be edited any time.
- Lobby-based multiplayer: a host creates a match and shares a short join code; either an **online** match (via Cloudflare's `partyserver`) or a **LAN/offline** match (via a native WebSocket server inside the Capacitor app — Minecraft-LAN style: host advertises `ws://<lan-ip>:<port>` and guests connect directly).
- A **pure, isolated, fully unit-testable** game-logic engine that is the single source of truth for legal moves, scoring, and end-of-hand resolution — the same engine runs on the server (authoritative) and the client (predictive/UI rendering).
- Correct, race-condition-proof handling of `chi`/`peng`/`gang`/`hu` (sequence/triplet/quad/win) claims after a discard.
- Configurable AI bots (simple and heuristic strategies) to fill empty seats and enable single-player practice.

**Decisions captured from clarifying Q&A**

| Topic | Decision |
|---|---|
| UI stack | React + Vite + TypeScript + Capacitor |
| Online server | `partyserver` ([cloudflare/partykit/packages/partyserver](https://github.com/cloudflare/partykit/tree/main/packages/partyserver)); fall back to raw Durable Objects if blocked |
| LAN/offline | Direct WebSocket: host runs a native WebSocket server (Capacitor plugin) on a LAN port; the host shares the URL via tap-to-copy and guests join by pasting it. WebRTC is **not** used; QR sharing was prototyped and dropped (it ate scarce vertical space on landscape mobile and the URL-copy path covers the same flow). |
| Match scope | One hand per "round"; lobby leader can start another hand if no one has disconnected |
| Bots | Configurable per seat: `simple` (random-but-legal) and `heuristic` (shanten-aware discard + claim if completes a meld) |
| HK ruleset | Configurable per-lobby (faan threshold 0/1/3/5; toggles for common rules) |
| Turn timer | Soft turn timer (~20s) + 3-second claim window after each discard |
| Disconnect handling | ~60s grace period; a stand-in bot plays only safe minimal moves until the player returns or the grace expires |

---

## High-level architecture

```
┌──────────────────────────────────────────┐    WS    ┌─────────────────────────────┐
│           Client (React + Vite)          │ ◄──────► │     Authoritative engine    │
│  ┌─────────┐  ┌──────────────┐  ┌─────┐  │          │  partyserver Room (online)  │
│  │  UI     │  │ game-logic   │  │ Net │  │          │  Native WS server in host's │
│  │ (zustd) │◄─┤ (pure TS)    │  │     │  │          │  Capacitor app (LAN)        │
│  └─────────┘  └──────────────┘  └─────┘  │          │  Identical engine + bots    │
└──────────────────────────────────────────┘          └─────────────────────────────┘
        │                                                       │
        └─ Capacitor wraps to native iOS/Android                └─ Cloudflare Workers (online)
                                                                   / one peer's installed app (LAN)
```

The same `@mahjong/game-logic` package runs on the server (truth) and the client (prediction + rendering). Networking is thin: clients send `Action` messages, the server runs them through the engine and broadcasts the resulting `StateDelta`.

---

## Repository layout (pnpm workspaces monorepo)

```
modern-mahjong/
├── package.json                    # workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── packages/
│   ├── game-logic/                 # pure TS engine — NO React, NO DOM, NO network
│   │   ├── src/
│   │   │   ├── tiles.ts            # tile enum + 136-tile wall builder
│   │   │   ├── hand.ts             # hand/meld representations
│   │   │   ├── shanten.ts          # tiles-away-from-winning calculator
│   │   │   ├── scoring.ts          # faan calculator (configurable)
│   │   │   ├── rng.ts              # seeded PRNG (Mulberry32) for deterministic shuffles
│   │   │   ├── state.ts            # GameState type + initial state
│   │   │   ├── actions.ts          # Action union + reduce(state, action) -> {state, events}
│   │   │   ├── claims.ts           # claim-resolution priority logic
│   │   │   └── index.ts
│   │   └── test/                   # vitest unit + property tests
│   ├── protocol/                   # shared message types + zod schemas (client ↔ server)
│   │   └── src/index.ts
│   └── bots/                       # AI strategies (consumes game-logic)
│       └── src/{simple,heuristic}.ts
├── apps/
│   ├── client/                     # React + Vite + Capacitor
│   │   ├── src/
│   │   │   ├── ui/                 # presentational components (Tile, Hand, Board, Hud)
│   │   │   ├── screens/            # Lobby, Match, Settings
│   │   │   ├── state/              # zustand stores (UI state only)
│   │   │   ├── net/                # transport adapters (partysocket, webrtc)
│   │   │   ├── identity/           # local UUID + display name persistence
│   │   │   ├── animations/         # framer-motion wrappers + layoutId map
│   │   │   └── main.tsx
│   │   ├── android/                # Capacitor-generated, committed
│   │   ├── ios/                    # Capacitor-generated, committed
│   │   └── capacitor.config.ts
│   └── server/                     # partyserver Worker
│       ├── src/
│       │   ├── MatchRoom.ts        # extends Server from partyserver
│       │   ├── matchmaking.ts      # short-code generator + room lookup
│       │   └── index.ts
│       └── wrangler.toml
└── README.md
```

Why a monorepo: the engine and protocol must be physically shared between client and server to guarantee byte-for-byte agreement on legal moves and serialized state.

---

## Game-logic engine (`packages/game-logic`)

### Tile model

```ts
type Suit = 'man' | 'pin' | 'sou';      // characters / dots / bamboo
type Honor = 'E' | 'S' | 'W' | 'N'      // winds
           | 'Z' | 'F' | 'B';            // 中 發 白 dragons (zhong/fa/bai)

type Tile =
  | { kind: 'suit'; suit: Suit; rank: 1|2|3|4|5|6|7|8|9; copy: 0|1|2|3 }
  | { kind: 'honor'; honor: Honor; copy: 0|1|2|3 };
```

The `copy` field uniquely identifies one of the four physical copies of a tile. This makes the wall a `Tile[]` of length **exactly 136**, lets us assert "no tile appears twice on the table", and is essential for deterministic replay.

A `tileId(t: Tile): number` helper packs each into a 0–135 integer for compact wire encoding.

### State (single object, immutable updates via Immer)

```ts
type Seat = 0 | 1 | 2 | 3;  // East, South, West, North (counter-clockwise turn order)

interface GameState {
  phase: 'waiting' | 'dealing' | 'turn' | 'awaitingClaims' | 'resolved';
  rules: RuleConfig;            // faanMin, allow self-draw bonus, etc.
  seed: number;                 // PRNG seed for this hand (recorded for replay)
  prevailingWind: 'E'|'S'|'W'|'N';
  dealer: Seat;
  turn: Seat;
  wall: Tile[];                 // remaining draw pile
  deadWall: Tile[];             // 14 tiles for gang replacements
  hands: Record<Seat, Tile[]>;  // concealed
  melds: Record<Seat, Meld[]>;  // exposed peng/gang/chi
  discards: Record<Seat, Tile[]>;
  lastDiscard?: { tile: Tile; from: Seat };
  pendingClaims?: ClaimRound;   // present only while phase === 'awaitingClaims'
  scoreboard: Record<Seat, number>;
}
```

### Actions and the reducer

```ts
type Action =
  | { t: 'startHand'; seed: number }
  | { t: 'draw'; seat: Seat }            // server-issued
  | { t: 'discard'; seat: Seat; tile: Tile }
  | { t: 'declareClaim'; seat: Seat; claim: Claim }
  | { t: 'resolveClaims' }               // server-issued at end of claim window
  | { t: 'declareGang'; seat: Seat; tiles: Tile[] }   // concealed gang on own turn
  | { t: 'declareWin'; seat: Seat; selfDraw: boolean };

function reduce(state: GameState, action: Action): { state: GameState; events: Event[] };
```

Key invariants enforced by the reducer (and asserted in tests):

- `wall.length + deadWall.length + Σ hand sizes + Σ exposed-meld sizes + Σ discard sizes === 136` always.
- A player's hand size is `13` between turns, `14` mid-turn (between draw and discard), plus 1 per gang they own.
- Actions sent in the wrong phase or from the wrong seat are rejected with a typed error — never silently ignored.

### Shanten + winning-hand detection

`shanten.ts` exports `shanten(hand: Tile[], melds: Meld[]): number` returning the minimum number of tile swaps to reach a winning shape. It implements the standard recursive meld-decomposition with memoization over the canonical multi-set key (suits separable, honors trivially separable). `isWinning(hand, melds, winningTile)` is a thin wrapper returning `shanten === -1`.

Special hands supported under "configurable" mode: thirteen orphans (十三幺), seven pairs (七對) — toggled by `RuleConfig`.

### Scoring (faan)

`scoring.ts` returns `{ faan: number; breakdown: Reason[] }` for a winning hand. The implemented set covers the common HK list: 平和, 對對和, 混一色, 清一色, 字一色, 大三元/小三元, 大四喜/小四喜, 自摸, etc. `RuleConfig.faanMin` filters wins client-side when declared and is enforced by the reducer.

### Determinism and replay

Every shuffle uses `seedrandom`-style Mulberry32 seeded by the server. The seed is part of state, so the entire hand can be replayed deterministically from `(seed, sequence-of-actions)`. This is the foundation of testability and of debugging player-reported issues.

---

## Race-condition-proof claim resolution

Mahjong's hardest correctness problem: after a discard, multiple players can race to claim the same tile with different priorities.

**Algorithm (server-authoritative):**

1. Player X's `discard` action transitions state to `phase = 'awaitingClaims'` and writes a `pendingClaims` record:

   ```ts
   interface ClaimRound {
     discard: { tile: Tile; from: Seat };
     deadlineMs: number;             // serverTime + claimWindowMs (default 3000)
     submitted: Partial<Record<Seat, Claim>>;
   }
   type Claim =
     | { kind: 'pass' }
     | { kind: 'chi'; with: [Tile, Tile] }    // only legal for next-seat player
     | { kind: 'peng' }
     | { kind: 'gang' }
     | { kind: 'hu' };                         // win
   ```

2. The server broadcasts the `awaitingClaims` state to all clients. Each client renders the legal claim buttons it can offer (computed locally from public state).

3. Each player either submits a claim or a `pass`. Submissions are stored in `pendingClaims.submitted`.

4. The server triggers `resolveClaims` exactly once, when **whichever happens first**:
   - all four players have submitted,
   - the deadline (`deadlineMs`) elapses (server timer in the room actor).

5. `resolveClaims` picks the winner with strict priority:
   1. `hu` (win) beats everything. If multiple players declare `hu`, the one whose seat is closest counter-clockwise to the discarder wins.
   2. `peng`/`gang` beat `chi`.
   3. `chi` is only legal for the next seat.
   4. Otherwise the turn advances to the next seat.

6. The state transitions to `turn` (or `resolved` on win), and a `StateDelta` is broadcast.

**Why this is race-proof:**

- All claim resolution happens in the room's single-threaded actor (`partyserver` Durable Object isolation, or the host browser tab in WebRTC mode). There is no shared mutable state, no transactions, no row locks needed — just JS event-loop order.
- Clients never resolve; they only *propose* claims. A rogue or laggy client cannot race ahead of the server.
- The deadline is on **server clock** only. Client-side countdown is purely cosmetic.
- Re-entrancy guard: `resolveClaims` is idempotent and a no-op if `phase !== 'awaitingClaims'`.

**Tests** (in `packages/game-logic/test/claims.test.ts`):

- All 16 combinations of {pass, chi, peng, hu} from the four seats produce the right winner.
- Late submissions after deadline are rejected.
- Two simultaneous `hu` claims resolve by seat order.
- Property test: for any sequence of submitted claims, the resolved winner's claim has the highest priority among submissions.

---

## Networking

### Protocol package (`packages/protocol`)

Defines `ClientMessage` and `ServerMessage` discriminated unions plus `zod` schemas for runtime validation on both ends. Wire format is JSON for now (small payloads, simpler debugging); a binary CBOR option is left as a later optimization.

```ts
type ClientMessage =
  | { t: 'hello'; playerId: string; displayName: string; matchCode: string }
  | { t: 'action'; action: Action }
  | { t: 'chat'; text: string }
  | { t: 'leave' };

type ServerMessage =
  | { t: 'state'; state: GameState; you: Seat | 'spectator' }
  | { t: 'delta'; events: Event[]; state: GameState }
  | { t: 'error'; code: string; detail?: string }
  | { t: 'lobby'; players: PublicPlayer[]; host: string; rules: RuleConfig };
```

### Online transport — `partyserver`

`apps/server/src/MatchRoom.ts` extends `Server` from `partyserver` (per [cloudflare/partykit/packages/partyserver](https://github.com/cloudflare/partykit/tree/main/packages/partyserver) and the example fixtures at [cloudflare/partykit/fixtures](https://github.com/cloudflare/partykit/tree/main/fixtures)). Each match code maps 1:1 to a `MatchRoom` instance (one Durable Object). The room owns the `GameState`, validates incoming actions against the engine, and broadcasts deltas. The room's `alarm` is used to trigger `resolveClaims` and turn timeouts.

Match codes are 5-character base32 strings, generated avoiding ambiguous characters (`0/O`, `1/I/L`). A small `matchmaking.ts` keeps a Workers KV mapping of `code -> roomId` (or — simpler — uses the code directly as the room id).

If during integration `partyserver` proves unstable, fall back to writing a Durable Object directly (one DO class with `webSocketMessage`/`webSocketClose` handlers) — the engine and protocol code don't change.

Client uses `partysocket` (auto-reconnect, exponential back-off, pings) to talk to the room.

### LAN transport — direct WebSocket (Minecraft-LAN style)

The simplest possible model: the host opens a real listening port on the LAN; guests connect directly. No SDP exchange, no QR sharing, no STUN/TURN — the host taps Copy on the URL and the guest pastes it into a browser.

**Who needs the app installed.**

- **Host**: must run the installed Capacitor app — only native code can open a listening port, and only the app bundle ships the static client assets.
- **Guests**: do **not** need to install anything. The host's native plugin serves a small HTTP server alongside the WebSocket endpoint, returning the entire client bundle (HTML/JS/CSS/SVG) that lives in the Capacitor app's resources. A guest just opens `http://<host-ip>:<port>` in their phone's browser, the React app loads from the host, and it then opens a WebSocket back to the same origin. The flow is essentially "host = portable web server + game server."

This is enabled by the same native plugin: it speaks HTTP/1.1 (using `NanoHTTPD` on Android, `Telegraph` or `Swifter` on iOS — both well-maintained pure-Swift micro-servers) and upgrades to WebSocket on `/ws`. Static files are streamed from the Capacitor sync directory (`ios/App/App/public/` / `android/app/src/main/assets/public/`) where Vite's build output lands during `cap sync`.

**Flow:**

1. Host taps "Host LAN match."
2. The app:
   - reads its LAN IPv4 via the native plugin's interface enumeration,
   - starts the native HTTP+WS server on a fixed port (default `7777`; auto-falls-through to `7778`/`7779` if taken),
   - displays a human-readable URL `http://192.168.1.42:7777` next to a Copy button.
3. The host taps Copy and shares the URL via chat / SMS / verbally; each guest opens it in their phone's browser, or pastes it into the installed app's "Join LAN match" form.
4. The bundled client opens a single WebSocket to `ws://192.168.1.42:7777/ws?code=ABCDE&playerId=...&name=...` derived from `window.location`.
5. The host's app runs the same `MatchRoom` engine in-process and broadcasts via the accepted WebSocket connections. The wire protocol is byte-for-byte identical to the online one — same `ClientMessage` / `ServerMessage` types from `packages/protocol`.

**Native plugin.** A small custom Capacitor plugin (Swift + Kotlin, ~250 lines each) exposing:

```ts
interface LanServer {
  // Starts an HTTP+WS server. Static GETs are served from staticRoot
  // (the Capacitor public/ folder by default). Upgrades on wsPath
  // become WebSocket connections delivered via the listeners below.
  start(opts: {
    port: number;
    staticRoot?: string;   // default: app bundle's public/ directory
    wsPath?: string;       // default: '/ws'
  }): Promise<{ port: number; addresses: string[] }>;
  stop(): Promise<void>;
  addListener('connection', (e: { id: string; query: string }) => void);
  addListener('message',    (e: { id: string; data: string }) => void);
  addListener('close',      (e: { id: string }) => void);
  send(opts: { id: string; data: string }): Promise<void>;
}
```

Implementation: `NanoHTTPD-WebSockets` on Android (LGPL — we'll depend on it as an .aar; alternatively `Java-WebSocket` plus a hand-rolled HTTP handler) and `Telegraph` (MIT) or `Swifter` on iOS. Both ship HTTP + WS in one server and stream files from disk efficiently.

**iOS local-network permission.** iOS 14+ requires the `NSLocalNetworkUsageDescription` Info.plist key and a Bonjour service declaration (`NSBonjourServices`). We'll register `_mahjong._tcp` and optionally use mDNS for zero-config discovery so guests don't have to copy a URL at all (instead pick from a list of nearby hosts). Documented as a v1.1 enhancement; v1 ships URL-copy + manual address.

**HTTP-vs-HTTPS implications for the host-served bundle.** Guests load over plain `http://` (no LAN certificate authority). The host-served client therefore cannot rely on:

- Service workers (HTTPS-only). Acceptable: not used by mahjong.
- The `MediaDevices` camera API (HTTPS-only). Not used.
- Web Push, Web Bluetooth, Web USB, Wallet APIs. Not used.
- PWA install prompt. Not used.

Everything actually needed by the game (`<canvas>` / SVG, touch, pointer events, `WebSocket`, `localStorage`, `crypto.randomUUID()`, `requestAnimationFrame`, CSS transforms) works fully on `http://`. The Vite build is configured with `base: ''` (relative asset paths) so the bundle works regardless of origin (`https://mahjong.example.com`, `capacitor://localhost`, or `http://192.168.1.42:7777` all serve the same files).

**Tradeoffs vs. WebRTC:**

- ✅ Single direct connection per guest. No SDP, no ICE, no two-way exchange.
- ✅ Guests don't need the app installed — the host serves the entire client bundle, so the pasted URL loads everything in a plain browser.
- ✅ Trivially debuggable (`curl http://host-ip:7777`, `websocat ws://host-ip:7777/ws`).
- ✅ Same on-the-wire protocol as the online server, so almost all code is shared.
- ✅ Survives short blips on the LAN with normal WebSocket reconnection.
- ⚠️ Host must run the installed Capacitor app.
- ⚠️ Routers with AP/client isolation block LAN-to-LAN traffic (same constraint as Minecraft LAN play). In-app error message points at this.
- ⚠️ iOS local-network permission prompt on first run.
- ⚠️ Plain `http://` for guests forfeits service workers / camera API, but neither is needed by gameplay.

A `net/transport.ts` interface abstracts both transports so screens don't know whether they're online or LAN:

```ts
interface Transport {
  send(msg: ClientMessage): void;
  onMessage(cb: (msg: ServerMessage) => void): Unsubscribe;
  status: 'connecting' | 'open' | 'closed';
}
```

---

## Player identity & lobby

- On first launch the client generates `crypto.randomUUID()`, stores it in `localStorage` under `mahjong.playerId`. This is the durable identity.
- Display name: stored under `mahjong.displayName`, freely editable. Sent in every `hello` so the server has the latest.
- The server keeps an in-memory `seatBySeatToPlayerId` map per room. On reconnect (`hello` with same `playerId` and `matchCode`), the player resumes their seat with full state replayed from the room's authoritative `GameState`.
- The host of a lobby is the first player to enter the room. If they leave, the seat next in CCW order is promoted.
- After each hand resolves, the host sees a "Continue" button. It is enabled only if all four `playerId`s that started the previous hand are still connected; otherwise the lobby reverts to pre-hand state and waits.

---

## AI bots (`packages/bots`)

Each bot exposes:

```ts
interface Bot {
  decideAction(view: PlayerView, legalActions: Action[]): Action;
  decideClaim(view: PlayerView, claimChoices: Claim[]): Claim;
}
```

- **Simple bot**: discards the tile that maximizes "isolation" (no neighbors of the same suit within ±2 ranks; no other copies of the same honor). Claims `peng`/`gang` only if they complete a meld, never `chi` unless it reduces shanten. Never declares `hu` below the lobby's faan minimum.
- **Heuristic bot**: same plus a one-step shanten lookahead — for each candidate discard, computes the resulting `shanten(hand)` and prefers the lowest. Ties broken by tile safety (count of same tile already discarded across all players).

Bots run wherever the engine runs (server for online matches, host browser for LAN matches). They consume only `PlayerView` (the seat-restricted projection of `GameState`), guaranteeing a bot can't "cheat" by reading other players' hands.

The disconnect-stand-in is a special **passive bot**: never claims, always discards the just-drawn tile. This minimizes harm to the absent player's hand and to the table.

---

## UI layer (`apps/client`)

### Component skeleton

- `Tile` — one mahjong tile. SVG path/symbol, sized via CSS custom properties so the entire board scales to viewport. Memoized.
- `Hand` — the local player's 13/14 tiles, draggable to reorder, click-to-discard with a confirmation halo on mobile.
- `OpponentHand` — back-of-tile rendering for the three other players, oriented to the table's bottom/left/right/top edges.
- `MeldRow` — exposed pengs/gangs/chis per seat.
- `DiscardPile` — fan-laid discards in front of each seat.
- `ClaimBar` — appears during the 3s claim window with available actions and a server-synced countdown ring.
- `Hud` — turn indicator, wall count, faan target, scoreboard, chat affordance.

### State management

- `zustand` for UI-only state (selected tile, animation in flight, dialog open).
- Server `GameState` is held in a single `useGameState` store; selectors derive per-component slices to avoid re-renders.
- React 19 concurrent features (`useTransition` around tile-reorder drags) keep input snappy.

### Animations

- `framer-motion`, leveraging `layoutId` on every `Tile` so motion across containers (wall → hand, hand → discards, hand → meld) is automatically smooth FLIP-style.
- All motion uses `transform` (translate/scale/rotate) — never `width`/`top`/`left` — so animations run on the compositor thread.
- `prefers-reduced-motion` honored: animations collapse to instantaneous.
- A perf budget: any tile transition > 250 ms is unacceptable. We measure with `performance.mark`s in dev and fail Lighthouse CI if interaction-to-next-paint regresses.

### Performance for slow devices

- Bundle target: < 250 KB gzipped initial JS. Vite + tree-shaken icon library + no UI framework like MUI.
- Tiles are SVG `<symbol>` references (one definition, 136 instances) — minimizes DOM work.
- `content-visibility: auto` on the discard piles.
- `will-change: transform` only during active drags, removed afterwards.
- Avoid React reconciliation thrashing during the claim-window countdown by driving the ring with a CSS animation, not state updates.

---

## Capacitor packaging

- `apps/client/capacitor.config.ts` configures app id `com.example.modernmahjong`, splash, and StatusBar.
- Build pipeline: `pnpm --filter client build` → `npx cap sync` → `npx cap open ios|android`.
- Native plugins used: `@capacitor/preferences` (for `playerId` on iOS where Safari wipes `localStorage` aggressively), `@capacitor/status-bar`, `@capacitor/screen-orientation` (lock landscape during a match), `@capacitor/haptics` (optional taps on actions).
- WebRTC inside Capacitor: works out of the box via `WKWebView` / Android `WebView`. `RTCPeerConnection` requires an HTTPS origin, which `capacitor://` and `ionic://` provide.

CI builds the web target on every PR; native builds are produced manually for store releases (debug APK in CI is optional).

---

## Testing strategy

The single most important commitment of this design is that the **game logic is fully testable in isolation**, with no network and no UI.

- `packages/game-logic`: vitest unit tests + property tests (`fast-check`).
  - 136 tiles always conserved.
  - Shuffle is deterministic given seed.
  - Reducer rejects illegal actions.
  - Claim priority resolves correctly under all permutations.
  - Scoring matches a hand-verified table of 30+ canonical hands.
- `packages/bots`: each bot vs. itself for 1000 hands; assert no crashes, hands always legal, average shanten decreases monotonically across the hand for the heuristic bot.
- `packages/protocol`: zod round-trip on every message type.
- `apps/server`: `partyserver` test harness — spawn an in-memory room, connect 4 mock clients, run a scripted hand, assert deltas.
- `apps/client`: Playwright e2e for the lobby + a scripted single hand against three bots. Visual regression on key tile layouts.

---

## Implementation phases (recommended order)

1. **Repo scaffold**: pnpm workspaces, tsconfig, vitest, biome (lint + format), basic CI on push.
2. **`packages/game-logic`**: tile model, wall builder, state, reducer, shanten, claim resolver — all behind tests, no UI.
3. **`packages/bots`**: simple + heuristic + passive disconnect-stand-in. Self-play harness.
4. **`packages/protocol`**: message types and zod schemas.
5. **`apps/server`**: `MatchRoom` extending `partyserver`'s `Server`, lobby/host election, claim-window alarm, turn timer alarm. Local dev via `wrangler dev`.
6. **`apps/client` minimal**: identity, lobby screen, online transport via `partysocket`, render of `GameState` — no animations yet, ugly but playable.
7. **Animations + polish**: `framer-motion` with `layoutId`, perf measurement.
8. **LAN transport**: write the `LanServer` Capacitor plugin (iOS + Android), wire it up behind `Transport`, build the host/guest screens (URL display + tap-to-copy on the host, paste-or-typed address entry on the guest), host-runs-engine path identical to online.
9. **Capacitor packaging**: native shells, splash, orientation lock, native preferences.
10. **Hardening**: reconnect grace, scoring breakdown UI, configurable rule UI, rule set tested against canonical HK hands.

Each phase ends with a green test suite and a manual smoke test of the new capability.

---

## Critical files (when implementation begins)

- `packages/game-logic/src/state.ts` — `GameState` shape; touching this propagates everywhere.
- `packages/game-logic/src/actions.ts` — the reducer. Add new mahjong rules here.
- `packages/game-logic/src/claims.ts` — claim priority; correctness-critical.
- `packages/game-logic/src/scoring.ts` — faan rules; rule-config-driven.
- `packages/protocol/src/index.ts` — wire format; touched whenever a new client/server interaction is added.
- `apps/server/src/MatchRoom.ts` — server entry point; alarms + WS handlers.
- `apps/client/src/net/transport.ts` — abstract transport, swapped for online vs LAN.
- `apps/client/src/animations/layoutIds.ts` — central registry of FLIP animation ids.

## Reused libraries / utilities

- `partyserver` and `partysocket` from `cloudflare/partykit` (room actor + auto-reconnect WS client).
- `framer-motion` for animations.
- `zustand` for client UI state.
- `zod` for runtime message validation.
- `immer` for ergonomic immutable updates inside the reducer.
- `fast-check` for property tests.
- `vitest`, `playwright`, `biome` for testing/lint.
- A custom Capacitor `LanServer` plugin (in `apps/client/native/lan-server`) hosting both an HTTP server (for the static client bundle) and WebSockets (for live game messages):
  - iOS: `Telegraph` (MIT) — combined HTTP + WS Swift server.
  - Android: `NanoHTTPD` + its `NanoWSD` WebSocket extension.
  - JS bridge: ~250 lines per platform.
- Vite is configured with `base: ''` so the same `dist/` works under `https://mahjong.example.com`, `capacitor://localhost`, and `http://192.168.1.42:7777` without rebuilds.

## Verification

End-to-end checks performed at the close of implementation:

1. `pnpm -r test` — all unit + property tests green; coverage of `game-logic` ≥ 90%.
2. `pnpm --filter server dev` (wrangler) + `pnpm --filter client dev` — open four browser tabs, all four join the same match code, complete a full hand including a `chi` and a `peng` race, observe correct resolution and animations.
3. Disconnect one tab mid-hand; observe stand-in bot, reconnect within 60s, observe resumed seat.
4. Strangle network (Chrome DevTools throttle + 200ms latency) — animations remain smooth, no double-claims, server clock is authoritative.
5. `npx cap run android` and `npx cap run ios` on a connected device — same flow, locked landscape, haptics fire on discard.
6. LAN flow: one phone has the installed Capacitor app and hosts. Three guests use whatever they have:
   - Guest A: same installed app — taps "Join," pastes the host URL.
   - Guest B: phone with no app — opens the host URL the host shared (chat / SMS / verbally) in their browser, the React bundle loads from the host, plays.
   - Guest C: laptop with no app — pastes `http://192.168.1.42:7777` into a browser address bar.
   All four complete a full hand including a `chi`/`peng` race. Verify with the WiFi router's WAN cable unplugged — gameplay continues with zero internet.
7. Lighthouse mobile score ≥ 90 on the lobby and match screens.
8. `playwright` e2e: bot-vs-bot full hand passes headless in CI in under 30 seconds.
