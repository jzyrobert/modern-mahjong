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
- [x] Perf check: tile transitions ≤ 250 ms, all animation on `transform` / `opacity` only. See [`docs/PERF.md`](./docs/PERF.md) for the full inventory + verification recipe. The wall's next-draw pulse switched from a `boxShadow` keyframe (paint per frame) to a scale+opacity halo overlay (compositor only). Lighthouse CI enforces the Performance ≥ 0.9 budget on every PR.
- [x] (v1) Visible `<Wall>` component in the center HUD: renders up to 16 face-down tiles in two rows scaled to viewport, plus the live remaining-count badge. Each face-down tile carries the engine's real `tileId` so framer-motion's `layoutId` animates the wall→hand transition for free when a tile is drawn. Replaces the floating draw-tile + `Wall: N` text. The next-to-draw tile (`state.wall[0]`) pulses + accepts the click when it's the user's turn.
- [x] Four-walls layout (v2a): each seat gets a single-row Wall in their grid cell between the hand and the inner discards. The user's wall carries the click-to-draw highlight on its first tile; opponent walls are decorative (no count badge). `Match` distributes `state.wall` into per-seat slices by `index % 4` so the dealer's slice keeps the draw order stable.
- [x] Mechanical dispense animation (v2b): tiles animate via framer-motion's `layoutId` between hands — `state.wall[i]` from the old seed maps to a different position in the new seed, and `Tile`'s `layoutId` traces the path. The `ShuffleOverlay`'s radial-gradient backdrop keeps that motion visible. `Tile` swaps to a `SLOW_SPRING` (~400 ms) while `useGame.shuffling` is true so the dispense reads as deliberate motion instead of a 150 ms blur. The "fully proper" gather-into-center-pile-then-disperse — pausing the engine via an explicit `dispensing` phase — was deemed not worth the engine-state-machine cost given the layoutId animation already does the visual job.
- [x] Replaced the Draw button with a pulsing face-down draw-tile in the center HUD. Surfaces during the local player's turn before they've drawn; clicking it dispatches `{ t: 'draw' }`. New e2e test exercises the full draw-tile path.
- [x] Mobile landscape layout pass:
  - `Match` container scales `--tile-w` / `--tile-h` via vmin so every tile (own hand, opponent backs, discards, draw-tile) shrinks under cramped viewports. `Table.tsx` swaps fixed 560/220 minHeights for `min(620px, 80vh)` / `min(220px, 38vh)` with clamp-based padding/gap.
  - `Lobby` is now a `repeat(auto-fit, minmax(260px, 1fr))` grid so on a landscape phone (~800×360) the Online / Practice / LAN sections sit side-by-side instead of stacking past the fold — fixes the "Android app missing the offline button" report.
  - `index.html` ships a global `body { background: #0e1320; margin: 0 }` reset so the deployed Pages site doesn't show white margins around the dark app on phones.
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
- [x] Lobby gets "Host LAN match" / "Join LAN match" buttons; host modal shows the URL with a clipboard copy button. (No QR code: the URL-copy flow is intentionally the only sharing path — auto-rendering a QR while the host typed was hiding the "Start hosting" button on landscape mobile, and a tap-to-copy URL covers the use case without the layout cost.)
- [x] Capacitor `LanServer` TS bridge stub (iOS / Android native code still pending).
- [x] `isLanOrigin()` is now wired into the lobby: visiting an `http://192.168.x.x:port` URL auto-opens the Join LAN modal with the host URL pre-filled.
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

### Design port follow-ups

The first design pass (cream-paper / sage-felt language, refined SVG tile faces, depth-gradient tile body) is in. The structural redesigns from `/tmp/design/design/{menu,app,app-mobile}.jsx` are queued.

- [x] Lobby v2: rebuild against `menu.jsx` — hero with `WindEmblem` 東 + 麻雀, three `ModeCard`s (Online / Practice / LAN), `LobbyPreview` with 東南西北 wind glyphs and dashed open-seat boxes, scattered tile decorations. _Shipped in #39._
- [x] Desktop table chrome: new `GameStatusBar` pill (live wall count, prevailing wind, dealer name, my-turn pulse), `TopBar` with game id + Leave + Settings, `OpponentSeat` badges with avatar / seat wind / score / active-turn glow, exposed-meld strips per opponent. _Shipped in #40 (existing `Wall` retained instead of perimeter `WallEdge`)._
- [x] Hand UX: `SortPicker` (Suit / Number / Manual), `CallButton` style for `ClaimBar.tsx` (Chow/Pung/Kong/Win/Pass with bilingual labels and gradient backgrounds). _Shipped in #41._
- [x] Hand UX residue: drag-to-reorder under manual sort. HTML5 drag-and-drop on desktop + pointer-event drag with long-press threshold on touch; `useGame.manualOrder` persists per-hand, cleared on `handStarted`. _Drawn-tile glow shipped in #48; drag-to-reorder shipped in #49._
- [x] Settings panel: modal toggled from `TopBar` with bindings for turn-timer seconds (host-only), sound, felt color skin, auto-sort hand, animations override, tile back colour. Below: 136-tile reference grouped by suit using the new `TileGlyph`. _Shipped in #42._
- [x] Mobile/desktop shell split: viewport-driven — landscape mobile (≤900) renders `MobileMatch.tsx` (glass top-bars, `OppHandStrip`, shared discard pool with seat-color underlines); portrait mobile shows a "rotate your device" message; desktop renders the `DesktopMatchBody`. _Shipped in #43._
- [x] Last-discarded tile highlight: pulse the matching `tileId` on the discard pile while `phase === 'awaitingClaims'`. _Shipped in #44._
- [x] DiceCeremony / ShuffleOverlay restyle: warm-paper instead of dark slate. _Shipped in #44._
- [x] Settings persistence: mirror `useGame.settings` to `@capacitor/preferences` so they survive a WebView wipe. _Shipped in #45._
- [x] Win celebration animation: brief 和 emblem + winner name + faan readout on `state.lastResult.kind === 'win'` with gold confetti, auto-dismisses after 3.5s. _Shipped in #46._
- [x] Leave-game flow: client-side path that sends `ClientMessage.t === 'leave'` (already in protocol) and navigates back to lobby. _Shipped in #40._
- [x] Game log buffer: ring-buffer the engine `Event[]` per `apply` in `useGame`; surfaced as a 📜 button in `TopBar` that opens a "Last actions" modal. _Shipped in #47._
- [ ] Mobile bottom sheets: menu / 136-tile reference / players panels from the design's `app-mobile.jsx`. (Game log already accessible via the TopBar button on both shells.)
- [x] Per-tile discard sequence number on the engine: new `state.discardOrder: { tile; from }[]` log appended on every `discard` reducer + popped on `applyClaim`. The mobile shared pool now reads this directly and renders in true turn order. _Shipped in #51._
- [x] Sound effects: discard thud (every `discarded` event) + win fanfare (C-major arpeggio on `lastResult.kind === 'win'`). Synthesised via Web Audio API — no asset bloat. Off by default; toggleable in Settings; suppressed when `settings.animations === false` (reduced-motion). _Shipped in #50._
- [x] Chat / emotes: 6-emote `ChatBar` (👍😎🎉🤔😅🔥) wired through `ClientMessage.t === 'chat'`. Server broadcasts as `ServerMessage.t === 'chat'` tagged with sender seat + ts; client renders floating bubble near the sender via `ChatBubbles`, auto-dismisses after 3.5s. _Shipped in #52._
- [x] Spectator viewer count (server-side): `MatchSession.spectators` tracks non-seated connections (clients that joined a full room). Lobby broadcast carries the live `viewers` count; `TopBar` shows 👁 N next to the live pill. _Shipped in #53._

### React review follow-ups

Tracking concrete fixes from the in-repo React code review.

- [x] **Critical** — `WinCelebration.tsx`: invalid HTML (`<button>` containing `<div>`) — switch to `motion.div role="dialog"` with `aria-modal` + window Escape listener. _Shipped in #67._
- [x] **Critical** — `Hand.tsx`: document `pointermove`/`pointerup`/`pointercancel` listeners leak when a tile unmounts mid-long-press; clean up via `AbortController` + unmount effect. _Shipped in #67._
- [x] **High** — `RulePanel.tsx`: `SecondsInput` syncs prop to state via `useEffect`; reset via `key={ms}` from the parent and drop the effect. _Shipped in #68._
- [x] **High** — `DiceCeremony.tsx`: backdrop dismissal isn't keyboard-accessible — add a window Escape listener mirroring `Modal.tsx`. _Shipped in #69._
- [x] **High** — `HostLanModal.tsx`: Host URL input has no accessible label (`<Label>` is a styled `<div>`); replace with `TextField` from `buttons.tsx` or wire `htmlFor`/`id`. _Shipped in #70._
- [x] **Medium** — `buttons.tsx` (`TextField`) and `ChatBar.tsx`: drop direct DOM style mutation in favour of CSS pseudo-classes (`:focus-visible`, `:active`); current touch pressed-state doesn't fire on `pointerdown`/`pointerup`. _Shipped in #71._
- [x] **Medium** — `Match.tsx` / `MobileMatch.tsx`: build a typed `byPosition` map once instead of repeating `placements.find(...)` four times per render. _Shipped in #72._
- [x] **Medium** — `Match.tsx`: `DesktopMatchBody` re-subscribes to `useGame((s) => s.state)!` and asserts non-null; pass `state` + `seat` from the parent that already validated them. _Shipped in #72._
- [x] **Medium** — `Match.tsx`: memoize `seatToPosition` and the `--tile-w`/`--tile-h`/`--felt-1`/`--felt-2` style object so consumers can adopt `React.memo` without inline-prop churn defeating it. _Shipped in #72._
- [x] **Medium** — `ChatBubbles.tsx`: schedule a single timer per chat seq via a ref-tracked `Set` instead of clearing-and-rebuilding all timers on every `chats` change. _Shipped in #73._
- [x] **Low** — `buttons.tsx` (`PrimaryButton`, `GhostButton`) and `Lobby.tsx` (`ModeCard`): replace `useState(hover)` + `onMouseEnter`/`onMouseLeave` with CSS `:hover` / `:focus-visible`. _Shipped in #71._
- [x] **Low** — `Lobby.tsx`: switch `useState(getDisplayName())` to a lazy initialiser `useState(() => getDisplayName())`. _Shipped in #74._
- [x] **Low** — `Tile.tsx`: every visible tile re-renders on `useGame((s) => s.shuffling)` flips; lift the spring choice to the wall/match container or split into an inner `<TileMotion>`. _Shipped in #75._
- [x] **Low** — `ScoringBreakdownModal`/index-key callsites: prefer stable composite keys (`${name}-${i}`) over bare `key={i}` where a stable id is already in scope. _Shipped in #74._
- [x] **Low** — File decomposition (component size > 300 lines): extract `Lobby.tsx` icon SVGs into `ui/menu/icons.tsx`; pull `TileReference` + swatch helpers out of `SettingsPanel.tsx`; split `TileWrapper` from `Hand.tsx` into `ui/HandTile.tsx`. _Shipped in #76._

### Expo migration follow-ups

The Vite + Capacitor → Expo Router + Metro migration squash-merged in #80. The web bundle deploys to <https://modern-mahjong.pages.dev> via `expo export -p web`; CI builds a debug APK locally on the runner via `eas build --local` (#82, #85). All Phase 4–7 / 9–10 / 11 gates are shipped; the only remaining work is in Phase 8 (LAN native modules), which was deliberately held back from the squash-merge — the module ships in the repo at `apps/client/modules/expo-lan-server/` but isn't auto-linked, so a dev-client build is required to enable host mode.

**Phase 8 (LAN native modules) — open:**
- [ ] **iOS Swift implementation** — `modules/expo-lan-server/ios/LanServerModule.swift:33` is a skeleton that throws on `start()`. Needs Telegraph / Swifter / GCDWebServer wired up with connection / message / close `sendEvent` calls + `getifaddrs` for `lanAddresses()`. Blocked on iOS shell shipping (no `macos-latest` runner / signing certs in CI yet).
- [ ] **mDNS host advertisement** — currently the host has to share their `ws://...` URL via tap-to-copy. With mDNS the host would advertise `_modernmahjong._tcp.local` and guests would auto-discover. Needs entries in both Kotlin and (eventually) Swift.
- [x] **Static-asset HTTP route in the Kotlin module** — `serveHttp` now serves the Expo Web export bundled into `assets/lan-bundle/` at APK build time, so guests on the same Wi-Fi can join via `http://<host>:port/` in any browser without installing the app. Activation needs `pnpm --filter @mahjong/client export-web` before the dev-client `eas build`; if the export wasn't run the APK ships without a bundle and `serveHttp` returns a friendly 404.
- [ ] **Auto-link the module into the published bundle** (or document the dev-client activation as the supported path). Until that decision is made, the lobby's "Host LAN match" button stays in the "needs dev client" fallback for everyone on the published web/APK.

**Other follow-ups carried over from the migration:**
- [ ] **Background/foreground lifecycle smoke** — manually verify (or e2e on Android) that backgrounding mid-hand, foregrounding >30 s later, and reconnecting still resumes via `MatchSession.snapshot()` without dropping seats. Round-trip is unit-tested in `apps/server/test/MatchSession.test.ts` but not exercised against a real WebView app lifecycle.

## Out of scope until a maintainer decides

- Account system / cross-device identity sync.
- Match history / replays beyond the in-memory seed-based determinism.
- Spectator mode for live matches.
- Internationalization (currently English + traditional-character mahjong terms only).
