# Roadmap

Tracker for outstanding plan work. The full design lives in [`docs/PLAN.md`](./docs/PLAN.md). This file is the short version: what's done, what's queued, and what's deliberately out of scope until later.

## Done

- [x] Monorepo scaffold (pnpm workspaces, tsconfig, biome, vitest).
- [x] `packages/game-logic`: tile model, seeded shuffle, reducer, shanten (standard + 7-pairs + 13-orphans), claim resolution, HK faan scoring.
- [x] `packages/protocol`: ClientMessage / ServerMessage union + zod schemas + match-code helpers.
- [x] `packages/bots`: simple, heuristic, passive (disconnect stand-in).
- [x] `apps/server`: partyserver MatchRoom Durable Object with claim-window alarm.
- [x] `apps/client`: identity, lobby, online WebSocket transport, basic match UI.
- [x] Engine property + flow tests (fast-check, kong, win-on-discard, scoring).
- [x] GitHub Actions CI: typecheck + tests + lint + client/server builds.
- [x] Match-flow controls: lobby "create match", in-game "start match" + "start next hand" with HK dealer rotation.
- [x] Animations: framer-motion `layoutId` FLIP on every tile, table-orientation layout, discard piles per seat, `prefers-reduced-motion` honored.
- [x] Configurable rules: `setRules` action + `RulePanel` (faan minimum, seven-pairs / thirteen-orphans toggles, turn timeout, claim window).
- [x] Cumulative `Scoreboard` between hands.
- [x] Server-side dealer rotation (`nextDealer` in game-logic).
- [x] Host-only gating on `startHand` / `setRules` (in the client UI; server-side gating still queued).
- [x] Dice-roll opening (`OpeningRolls` on state, `DiceCeremony` modal, winner-rolls-only on subsequent hands).
- [x] Discard-toss rotation jitter so discards don't look perfectly aligned.
- [x] `MatchSession` extracted from `MatchRoom` for unit-testable room logic; integration test runs a full bot-vs-bot hand.

## Queued (in dependency order)

### Animations & layout polish
- [x] Between-hand shuffle overlay: a brief swirl of face-down tiles plays whenever a fresh seed lands (visual cue at the start of every hand).
- [ ] Perf check: tile transitions ≤ 250 ms, all animation on `transform` only (instrumentation + Lighthouse run).
- [ ] Full mechanical shuffle/dispense: render the wall as physical stacks around the table, animate every used tile flowing into the center pile and back out into the new walls. Needs a visible `<Wall>` component and a state-machine extension so the engine pauses briefly between hands for the animation to complete.
- [x] Replaced the Draw button with a pulsing face-down draw-tile in the center HUD. Surfaces during the local player's turn before they've drawn; clicking it dispatches `{ t: 'draw' }`. New e2e test exercises the full draw-tile path.
- [x] Mobile landscape layout pass: the `Match` container now sets `--tile-w` / `--tile-h` to `max(28px, 4.4vmin)` / `max(40px, 6.2vmin)` so every tile (own hand, opponent backs, discards, draw-tile) shrinks under cramped viewports. `Table.tsx` swaps the fixed 560/220 minHeights for `min(…, 70vh)` / `min(…, 38vh)` and uses clamp-based padding/gap so the table doesn't blow past the viewport on landscape phones.
- [x] SVG tile icons: `TileGlyph` renders a 36×50 viewBox face per tile (Arabic numeral + 萬 for man, dot patterns for pin, vertical bamboo bars for sou, Chinese characters for winds, 中/發/blank for the three dragons). The button still carries `aria-label={tileLabel(tile)}` for screen readers; the SVG itself is `aria-hidden`. Authentic per-rank pin layouts (e.g. canonical pin-5 colour) are simplified for v1 — drop-in real glyph SVGs can replace the simplified positions later.

### Scoring breakdown UX
- [x] Scoring breakdown modal on the result screen with per-pattern faan list + the tile composition that produced it. `FaanBreakdown.tiles` carries the engine's view of which tiles triggered each pattern (e.g. 9 dragon tiles for 大三元, the winning tile for 自摸, every tile in the hand for 字一色); the modal renders them as a tile row beneath each pattern.

### Server hardening
- [x] Bot-handoff on disconnect: when a seated player drops, a passive `Bot` takes their seat so the game keeps moving.
- [x] Reconnect: a `hello` from the same `playerId` clears the stand-in bot and restores the seat.
- [x] Server-side host gating: `startHand` / `setRules` are rejected for non-host connections with a typed `HOST` error.
- [x] Reconnect grace timer — `MatchSession` now tracks `disconnectedSinceMs` and re-arms a single DO alarm at the soonest of (claim window, every disconnected seat's 60s grace expiry). On grace expiry the seat's playerId is cleared (auto-bot keeps playing), `hostPlayerId` hands off to the next connected human, and the seat becomes reclaimable by a new joiner via `findOrAssignSeat`.
- [x] Persist `MatchSession` snapshot to DO storage. `MatchSession.snapshot()` / `restore(snap)` round-trip the engine state + lobby + auto-bot stand-in flag through plain JSON; `MatchRoom.onStart` reads from `ctx.storage` on the way out of hibernation, and every `dispatch` writes the new snapshot back. Connection IDs are intentionally not persisted (clients re-hello).

### Single-player / bots-only offline match
- [x] "Play vs bots" lobby entry: `apps/client/src/net/solo-transport.ts` runs an in-process engine loop with three bots (heuristic, simple, passive) seated. Skips the WebSocket handshake entirely; runs offline, no LAN setup needed.

### LAN transport
- [x] `createLanTransport({ hostUrl, matchCode, ... })` factory sharing a `createWsTransport` core with the online flow.
- [x] `isLanOrigin()` heuristic so a guest visiting an `http://192.168.x.x` URL can default into LAN-guest mode.
- [x] Lobby gets "Host LAN match" / "Join LAN match" buttons; host modal shows the URL with a clipboard copy button. (QR generation was removed — it auto-rendered while the host typed and was hiding the "Start hosting" button on landscape mobile.)
- [x] Capacitor `LanServer` TS bridge stub (iOS / Android native code still pending).
- [x] `isLanOrigin()` is now wired into the lobby: visiting an `http://192.168.x.x:port` URL auto-opens the Join LAN modal with the host URL pre-filled.
- [ ] Camera-based QR scanning for guests (`MediaDevices` + `jsqr`); requires HTTPS so only available in the installed Capacitor app.
- [ ] Native `LanServer` plugin: iOS (Telegraph or Swifter for HTTP+WS), Android (NanoHTTPD-WebSockets), and a small static-file server for the bundled `dist/`.
- [ ] mDNS discovery (v1.1) — guests browse nearby hosts.

### Capacitor packaging
- [x] `apps/client/capacitor.config.ts` with app id, splash, and status-bar config.
- [x] `@capacitor/core` + StatusBar + ScreenOrientation + Haptics + Preferences deps installed; lazy-loaded by `apps/client/src/native/init.ts`.
- [x] `vibrateLight()` haptic helper fires when the local player discards a tile.
- [x] Landscape orientation lock applied automatically when running on a native shell.
- [x] CI-built debug APK: `build-android` job in `.github/workflows/ci.yml` regenerates `apps/client/android/` each run, runs `gradlew assembleDebug`, uploads the APK as a workflow artifact (no Xcode / Android Studio needed locally).
- [ ] iOS shell: needs `macos-latest` runner + signing certs; deferred until release time.
- [x] Identity (`getPlayerId` / `getDisplayName`) now mirrors writes to `@capacitor/preferences` (lazy-loaded; no-op on web). `hydrateIdentity()` runs once at startup, copies preferences into localStorage if the WebView wiped it, and conversely seeds preferences from localStorage on first install. Sync getter API preserved so the lobby's controlled inputs don't need restructuring.

### Final hardening
- [x] Playwright e2e: `apps/client/e2e/solo-match.spec.ts` opens the app, clicks Play vs bots, starts a hand, clicks a tile to discard, asserts the wall count drops as bots take over. Runs as a `e2e` job in CI on every PR; browser cache is keyed off the lockfile so reruns are fast. Reports + traces are uploaded as artifacts.
- [x] Lighthouse CI: `apps/client/lighthouserc.json` + a `lighthouse` job in CI runs `lhci autorun` against `vite preview`. Performance ≥ 0.9 is enforced (errors the build); accessibility/best-practices warn at 0.9/0.85. Reports upload as the `lighthouse-report` artifact.
- [x] Documented release process: see [`docs/DEPLOY.md`](./docs/DEPLOY.md). Cloudflare Pages (client) + Workers (server) auto-deploy from `main` via `.github/workflows/deploy.yml`; debug APK is a CI artifact. iOS Store + production-signed Android still pending.

## Out of scope until a maintainer decides

- Account system / cross-device identity sync.
- Match history / replays beyond the in-memory seed-based determinism.
- Spectator mode for live matches.
- Internationalization (currently English + traditional-character mahjong terms only).
