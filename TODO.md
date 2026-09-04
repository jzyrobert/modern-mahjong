# Roadmap

Live tracker for queued and out-of-scope work. The full design lives in [`docs/PLAN.md`](./docs/PLAN.md); shipped milestones live in `git log` (every PR title carries a one-line summary). This file is intentionally short — only what's still open or deliberately deferred.

## Shipped (high-level milestones)

- Pure TS engine (`packages/game-logic`): tile model, seeded shuffle, shanten (standard + 7-pairs + 13-orphans), claim resolution, HK faan scoring. The reducer is an XState v5 state machine — `waiting` / `turn` / `awaitingClaims.{normal,robWindow}` / `resolved` — driven via the stateless `transition()` API, with a committed Mermaid diagram (`docs/state-diagram.md`) auto-generated from the source (#251, tightened in #252).
- Engine fuzzing: random-action property tests guard the XState reducer against drift (`property.test.ts`, `invariants.test.ts`); a 30-min `MAHJONG_FUZZ=1` campaign harness (`fuzz-campaign.test.ts`) is opt-in for nightly runs (#250).
- Shared protocol (`packages/protocol`): `ClientMessage` / `ServerMessage` unions + zod schemas + match-code helpers.
- Bots (`packages/bots`): simple, heuristic, passive (disconnect stand-in).
- Server (`apps/server`): `partyserver` `MatchRoom` Durable Object, claim-window alarm, host gating, snapshot/restore, reconnect grace timer, viewer count.
- Per-turn timeout: server-enforced countdown that auto-discards on expiry (#236), mirrored by the solo transport (#237). Mobile surfaces the countdown in the `GameStatusBar` pill (#239).
- Client (`apps/client`): identity, lobby, three transports (online / solo / LAN), match shell with desktop perimeter felt + mobile vertical-stack. Android shell supports both portrait and landscape; the UI auto-swaps `DesktopShell` / `MobileShell` from `useWindowDimensions()` on rotation (#254).
- Visual polish: physical-tile glyph faces ported from a Claude design handoff covering all 136 tiles (#240, #241, #249), faux-3D wall stacks with felt-facing side faces (#242–#246), Riichi-style grid discard pile on desktop (#247), discard piles anchored to the inner felt edge (#235), desktop felt that scales with viewport width (#232–#233).
- Animations: between-hand shuffle, dice ceremony, win celebration, FLIP transitions on every tile via the `FlipBag` context, active-turn pulses, draw-cue halo on the next wall slot.
- Match polish: dice-roll dealer derivation, scoring breakdown modal, settings panel, game log, chat / emotes, drag-to-reorder hand, seat-color discard pool, scoreboard.
- Mobile bottom sheets: 136-tile reference (📖 inside ☰), match menu (☰ — Settings / Game log / Tile reference / Leave), and players panel (tap the GameStatusBar pill).
- Cross-platform packaging: Expo Router + Metro replaced Vite + Capacitor (#80); web ships to <https://modern-mahjong.pages.dev>; Android APK built locally via `eas build --local` on the GitHub runner (the EAS tarball now keeps `dist/` so the LAN host's static route works in release APKs — #253); Android lifecycle smoke runs an x86_64 AVD on every push to `main`.
- LAN: `expo-lan-server` Expo Module — embedded NanoHTTPD HTTP+WS server, mDNS host advertise / discover via `NsdManager`, static-asset HTTP route serving the bundled web export, autolinked into every native build. Auto-populates the host URL + lists nearby hosts in the lobby modals.
- CI: typecheck + tests + lint + web build + e2e + Lighthouse (performance ≥ 0.9, median of 3 runs) on every PR; `react-native-cicd.yml` produces development + production APKs on every push to `main`.
- Solo-match e2e claim flow: scriptable solo-transport bots drive deterministic chi / peng / gang claim opportunities via the `__MAHJONG_TEST_BOT_SCRIPTS__` test hook in `solo-transport.ts` (#116).
- Replay system: in-match `Save this match` row records the wire-stream into a localStorage-backed library, `/replays` lists saved matches, `/replays/[id]` plays them back with a scrubber + bookmark pips (hand-start / gang / 搶槓 / win / draw) + per-seat POV toggle (all visible vs. POV-restricted) + JSON export to clipboard + paste-import. Auto-record toggle defaults off so users opt in per match.
- Ready-hand (聽牌) indicator: gold pill above the user's hand showing the wait tiles when their concealed shape is at shanten 0. Backed by a new `waitTiles()` helper in `@mahjong/game-logic`; rendered by `ReadyHandBadge` in both desktop and mobile shells.
- Lobby browser: new singleton `LobbyRegistry` DO tracks public match summaries; `GET /lobbies` returns the live list with CORS open. `MatchRoom` syncs into it after every dispatch (JSON-diff guard skips redundant pings); client surfaces a "Browse open lobbies" ghost button on the Online card that opens a bottom-sheet picker.
- Spectator UI: `hello` now accepts `spectate: true` so a user can intentionally watch a non-full room. `SpectatorView` renders a read-only felt anchored to the dealer with `OppHandStrip` for every seat, `SharedDiscardPool` for the centre, a "WATCHING" badge, and a "Stop watching" button. Lobby-browser rows surface both Join + Watch affordances. Engine state filtering for spectators is still client-only — server-side hand projection is a known follow-up.
- Sound effects: pooled `expo-audio` cues in `apps/client/src/sound.ts` — random `mahjong_tile_*` clack on discard / chi / peng / gang, random `roll_two_dice_*` on the opening dice ceremony, and a random 2 s slice of `shuffle_the_mahjong_tiles` with fade in/out during the between-hand shuffle overlay. Gated on `settings.sound` (now defaults on); credit banner sits at the bottom of the main menu.

## Open

### Code-review follow-ups (from the #377–#390 batch review)

- [ ] Extract `HOST_PORT` + `onHostLan` + `OnlineConnectionStatus` + `LessonRow` (small visual delta — 18 vs 22 px circle) out of `MobileLobby.tsx` / `Lobby.tsx` into a shared module. The original deferral cited "retirement of `Lobby.tsx`" as the blocker, but the investigation found that `Lobby.tsx` is the active phone-vs-desktop dispatcher (not legacy) and its inline `DesktopLobby` is the tablet/desktop surface — there is no retirement plan. A `useLanHost(transport)` hook + a shared `LessonRow` with a `compact` prop is the cleanest shape.

### Three.js rewrite follow-ups (PR #434 gauntlet — see `docs/STATUS.json`)

Every subsystem and the whole game pass their art-director critic (≥ 8.5, zero console errors, perf budget met). The residuals below are what the critics left open, ranked; each names the state and viewport where the critic saw it. The next `/loop` iteration resumes from the lowest-scoring subsystem (`docs/STATUS.json`).

- **table** (round 3: **8.6/10, pass**; 8.3 → 8.6 → 8.6):
  - [ ] [medium] Dead-wall marker is portrait-only in practice; desktop and landscape dead stacks are a 12-luminance shade away from live stacks — _match-dealt, match-claim, match-late-hand @ desktop 1440x900; match-dealt, match-claim, match-late-hand @ phone-landscape 915x412 (3d)_
  - [ ] [medium] Landscape lobby: the 3D waiting table is invisible behind the panel and the merged panel clips a gold segmented control at the viewport's bottom edge — _match-lobby @ phone-landscape 915x412 (3d)_
  - [ ] [low] Portrait claim toast sits 4 CSS px above the far-wall tile tops, flush on the far rail — _match-mid-hand, match-claim @ phone 412x915 (3d) - 吃 CHI toast_
  - [ ] [low] Landscape river zoom shows two DRAW affordances and the FULLSCREEN/DISMISS prompt spills out of the glass header onto the felt — _match-river-zoom-landscape @ phone-landscape 915x412 (3d)_
  - [ ] [low] Desktop lobby: the far rail's wood line passes behind the seam between the SEATS and BOT SKILL panels as a brown smear — _match-lobby @ desktop 1440x900 (3d)_
  - [ ] [low] Portrait 1x river glyphs: characters/honors read, 索 3-5 and 筒 5-7 are still pattern-counted at ~22-25 CSS px — _match-mid-hand, match-late-hand @ phone 412x915 (3d) - side rivers and far row_
  - [ ] [low] Landscape zoom hand-rail thumbnails at 24x33 CSS px are marginal for dots/bamboo — _match-river-zoom-landscape @ phone-landscape 915x412 (3d)_
- **tutorial** (round 2: **8.7/10, pass**; 8.3 → 8.7):
  - [ ] [medium] 3D landscape own-hand ring runs through the footer badge and the SUIT sort pill — _tutorial-basics-2 @ phone-landscape 915x412 (3d)_
  - [ ] [low] Green dragon 發 ink is 3.8-3.9:1 on the spotlit hand (and unlit); landscape red 萬 sits right at 4.5 — _tutorial-basics-2 @ phone, phone-landscape, desktop (3d)_
  - [ ] [low] Scroll-cue chevron is painted over the last visible line instead of in the fade gutter — _tutorial-scoring-0 @ phone-landscape (3d and classic); tutorial-scoring-1 / match-result side dock @ phone-landscape (classic)_
  - [ ] [low] Compact side dock says 'STEP 5/6' while every other card says 'STEP n OF m' — _tutorial-basics-4 @ phone-landscape (3d and classic)_
  - [ ] [low] Desktop river ring clips the dealer chip's edge; chip inclusion differs per viewport — _tutorial-basics-4 @ desktop 1440x900 (3d); compare phone and phone-landscape_
  - [ ] [low] Card settles 6 px after measurement during the entrance — _tutorial-basics-0 @ desktop (3d), observed under x1/x4/x8 CPU throttle_
  - [ ] [low] Classic desktop scoring-1 ring top crosses the 北/南 seat badges (round-1 #3 residual) — _tutorial-scoring-1 / match-result @ desktop 1440x900 (classic)_
- **menu** (round 2: **8.6/10, pass**; 8.5 → 8.6):
  - [ ] [medium] Desktop: a drift tile back sits on the hero rack's 一萬 corner (rack keep-out is phone-only) — _menu, menu-tutorials @ desktop 1440x900 (3d)_
  - [ ] [medium] Desktop replay shelf reads small and aliased inside a 620 px card — _replay-library @ desktop 1440x900 (3d, dpr 1)_
  - [ ] [low] Reduced-motion portrait field is one lone edge-on tile in the left margin — _menu-reduced-motion @ phone 412x915 (3d)_
  - [ ] [low] DISMISS pill label is ~0.55-alpha grey, below the 0.62 secondary-text spec — _menu, menu-tutorials, replay-library, settings @ phone-landscape 915x412 (3d)_
  - [ ] [low] Settings landscape letterbox still leaves ~38 % of the preview canvas as void — _settings, settings-jade-plum, settings-landscape @ phone-landscape 915x412 (3d)_
  - [ ] [low] Desktop dpr 1 preview: stair-step edges on tiles and glyph strokes — _settings, settings-jade-plum @ desktop 1440x900 (3d)_
  - [ ] [low] Regression run hijacked by a stale serve on 4173 (process hazard, not a menu defect) — _npx playwright test three-menu/three-settings/... from the menu worktree_
- **settings** (round 2: **8.6/10, pass**; 8.6):
  - [ ] [medium] Phone portrait: rail corners clip the frame edge and the Live preview pill sits on the wood — _settings / settings-jade-plum @ phone (412x915)_
  - [ ] [low] Blue back still reads cyan/pale toward the far edge — _settings @ phone + desktop_
  - [ ] [low] Desktop dpr 1 preview shows stair-step aliasing on tile edges and glyph strokes — _settings / settings-jade-plum @ desktop (1440x900, dpr 1)_
  - [ ] [low] No hover state on skin chips or segmented controls — _settings @ desktop_
  - [ ] [low] Status pill and Live preview badge use 10 px labels (spec is 11 px) — _settings @ all viewports_
  - [ ] [low] match-dealt (table-owned) exceeds the triangle budget: 159,938 > 150,000 — _match-dealt @ phone, desktop, phone-landscape (--renderer 3d)_
  - [ ] [low] Phone landscape stage is small with ~45% of the canvas as empty void — _settings-landscape @ 915x412_
- **whole game** (round 3: **8.7/10, pass** — visual 8.8 / motion 8.7 / legibility 8.4 / polish 8.4 / cohesion 9.1; rounds 8.2 → 8.6 → 8.7): the round-3 critic verified 8 of 13 round-2 issues fixed; 13 ranked residuals remain in `docs/STATUS.json` → `wholeGame.issues`. The two mediums are both table: the dead-wall marker is only visible from the portrait camera (desktop / landscape need an inner-edge hairline or a side-face band), and the landscape pre-game lobby panel covers the whole waiting table and clips the BOT SKILL control at the viewport edge.
- **blind judges**: 3 judges × 15 A/B pairs (3D vs pre-rewrite baseline, labels shuffled) → 45/45 preferred the rewrite (`docs/STATUS.json` → `blindJudges`).
- [ ] Native (Android) still uses the classic shells — `expo-gl` port of `src/three/` is out of scope for this pass (ARCHITECTURE.md §0).

### Future (post-MVP)

- Maestro / UIAutomator UI driving so the Android lifecycle smoke can drive a match into mid-hand, background it, and assert the snapshot really did restore (the current smoke only catches crash-on-resume, not state loss).
- Replay-system follow-ups (deferred from the v1 PR):
  - Cloud share-links (requires a server endpoint that stores replays and a recipient-side fetch path; v1 is local-only via clipboard).
  - "What would you have done?" diff mode — pause at a frame, let the user pick a discard, then reveal what was actually played.
  - Search / filter the library by player name, faan score, hand length.
  - Heatmap of dangerous tiles overlaid on opponents' discards during playback.
  - Spectate-from-current-frame: jump into a live match and rewind a few moments.
  - Compress saved frames — currently every delta's full state is stored as JSON. A typical 4-hand match lands at ~2–8 MB; gzip would 5–10× that. v1 uses localStorage with a 50-replay quota cap to keep the budget bounded.

## Out of scope until a maintainer decides

- **iOS build.** No iOS shell or build profile is currently planned; the project ships web + Android only. The Swift `LanServer` skeleton at `apps/client/modules/expo-lan-server/ios/LanServerModule.swift` exists so `expo prebuild` produces a valid `ios/` tree, not because a Swift implementation is being worked on. If a maintainer ever does want iOS, the Android Kotlin module is the reference: drop in Telegraph (or Swifter / GCDWebServer + a WS layer) for the HTTP+WS server, `NetService` / `NWBrowser` for mDNS, `getifaddrs` for `lanAddresses()`. Macos runner + signing certs would also need to be added to CI.
- Account system / cross-device identity sync.
- Internationalisation (currently English + traditional-character mahjong terms only).
