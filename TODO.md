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

### Scoring breakdown UX
- [ ] Scoring breakdown modal on the result screen with per-pattern faan list + the tile composition that produced it.

### Server hardening
- [x] Bot-handoff on disconnect: when a seated player drops, a passive `Bot` takes their seat so the game keeps moving.
- [x] Reconnect: a `hello` from the same `playerId` clears the stand-in bot and restores the seat.
- [x] Server-side host gating: `startHand` / `setRules` are rejected for non-host connections with a typed `HOST` error.
- [ ] Reconnect grace timer — currently a disconnected player can reclaim their seat indefinitely; add an alarm-driven "give up after 60s" that kicks them and exposes the seat to a new player.
- [ ] Persist `GameState` to DO storage so a hibernated room rehydrates correctly.

### LAN transport
- [x] `createLanTransport({ hostUrl, matchCode, ... })` factory sharing a `createWsTransport` core with the online flow.
- [x] `isLanOrigin()` heuristic so a guest visiting an `http://192.168.x.x` URL can default into LAN-guest mode.
- [x] Lobby gets "Host LAN match" / "Join LAN match" buttons; host modal renders a QR + URL via `qrcode`.
- [x] Capacitor `LanServer` TS bridge stub (iOS / Android native code still pending).
- [ ] Wire `isLanOrigin()` into the lobby so visiting an `http://192.168.x.x:port` URL auto-fills the LAN-join form.
- [ ] Camera-based QR scanning for guests (`MediaDevices` + `jsqr`); requires HTTPS so only available in the installed Capacitor app.
- [ ] Native `LanServer` plugin: iOS (Telegraph or Swifter for HTTP+WS), Android (NanoHTTPD-WebSockets), and a small static-file server for the bundled `dist/`.
- [ ] mDNS discovery (v1.1) — guests browse nearby hosts.

### Capacitor packaging
- [x] `apps/client/capacitor.config.ts` with app id, splash, and status-bar config.
- [x] `@capacitor/core` + StatusBar + ScreenOrientation + Haptics + Preferences deps installed; lazy-loaded by `apps/client/src/native/init.ts`.
- [x] `vibrateLight()` haptic helper (no-ops on web; available for the UI to fire on discards once wired up).
- [x] Landscape orientation lock applied automatically when running on a native shell.
- [ ] `npx cap add ios` and `npx cap add android` (requires Xcode / Android Studio); commit the generated shells.
- [ ] Migrate `getPlayerId` / `getDisplayName` to `@capacitor/preferences` so iOS doesn't lose identity when the WebView clears localStorage.
- [ ] Wire `vibrateLight()` into the discard button.

### Final hardening
- [ ] Visual regression / e2e test (Playwright): bot-vs-bot full hand headless.
- [ ] Lighthouse-score CI check (≥ 90 mobile).
- [ ] Documented release process (web → Cloudflare Pages, server → Workers, mobile → store).

## Out of scope until a maintainer decides

- Account system / cross-device identity sync.
- Match history / replays beyond the in-memory seed-based determinism.
- Spectator mode for live matches.
- Internationalization (currently English + traditional-character mahjong terms only).
