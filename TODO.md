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

Every subsystem passed its art-director critic before the manual play-test; the play-test feedback round (`docs/STATUS.json` → `feedbackRounds[0]`) then fixed all 18 user-reported items, verified per item by the critics. The lists below are the critic residuals still open, ranked; each names the state and viewport where the critic saw it. The next `/loop` iteration resumes from the lowest-scoring subsystem.

- **manual feedback round 1** — 18/18 user items fixed; area critics: mobile 7.9 → 8.4 → 8; table 7.3 → 7.7 → 8.1; tutorial 7.4 → 8.2 → 8.5 pass; settings 8.6 pass; input 8.7 pass. Table and mobile stayed under 8.5 on critic-added residuals (listed under table below).
- **table (desktop + mobile)** (latest critic: **8.1/10, below 8.5**; 8.3 → 8.6 → 8.6 → 8.1):
  - [ ] [medium] [desktop] Portrait 'Watch the wall run out' card hides the entire table (tutorial-owned) — _tutorial-drawn-game-2.phone.3d.png_
  - [ ] [low] [desktop] Landscape breakdown modal clips the TOTAL row and overlaps the coach card — _match-result-breakdown.phone-landscape.3d.png_
  - [ ] [low] [desktop] Breakdown header uses seat index instead of the player name — _match-result-breakdown at all viewports: 'Seat 0 wins — 2 faan', 'DISCARDED BY SEAT 1'_
  - [ ] [low] [desktop] Phone portrait shows no dead-wall count until the wall is nearly empty — _match-dealt.phone / match-late-hand.phone: pill '69 LEFT' / '22 LEFT'; plate '14 DEAD' is ~5 px_
  - [ ] [low] [desktop] Desktop sort control sits over the rail's bottom-right mitre — _critic-crops/corner-BR (match-my-turn.desktop)_
  - [ ] [medium] [mobile] Side-seat melds sit flush against the side walls (portrait + landscape) — _phone/match-mid-hand, phone-small/match-mid-hand, phone-landscape/match-claim + match-mid-hand_
  - [ ] [medium] [mobile] Landscape hand row stands in front of the near wall's lower row — _phone-landscape/match-dealt, match-mid-hand, match-claim — hand top ≈282 CSS, wall front face visible to the seam_
  - [ ] [medium] [mobile] Portrait river-zoom toast lands on the near wall's tile backs — _phone/match-river-zoom (toast y≈350-392 CSS over wall backs y≈345-395), phone-small/match-river-zoom (same, mid-fade)_
  - [ ] [medium] [mobile] 360x640 lobby: collapsed RULES summary row is buried under the panel fade — _phone-small/match-lobby — 'RULES Min 0 faan · no timer' clipped at the panel's bottom edge under the fade cue_
  - [ ] [low] [mobile] Result panel winning hand wraps 12 + 2 at 360 wide — _phone-small/match-result_
  - [ ] [low] [mobile] Seat badges vanish for the whole toast hold on short phones — _phone + phone-small: match-claim, match-mid-hand, match-claim-toast_
  - [ ] [low] [mobile] Landscape far-seat melds crowd the chrome row — _phone-landscape/match-mid-hand — 西西西 meld at y≈35-57 CSS directly under the header pills_
- **tutorial** (latest critic: **8.5/10, pass**; 8.3 → 8.7 → 8.5):
  - [ ] [high] Regression run: two three-table.spec tests fail under host load (pre-existing, table owner) — _e2e/three-table.spec.ts:402 'landscape river zoom stays through the own turn' and :671 'the discard flight stretches under the slow-motion seam'_
  - [ ] [medium] 'Now watch the bots' card hides bot seat badges at every viewport — _tutorial-basics-4 @ phone / phone-landscape / desktop_
  - [ ] [medium] Phone and desktop no-target cards park over the centre plate and river — _basics-1, claims-0, scoring-0, drawn-game-2 @ phone and desktop; claims-3 @ phone_
  - [ ] [low] Landscape claim strip and tsumo ring are flush with the viewport bottom — _tutorial-claims-3 and tutorial-win-1 @ phone-landscape_
  - [ ] [low] Landscape own-hand ring halo grazes the footer badge border — _tutorial-basics-2 @ phone-landscape_
  - [ ] [low] Landscape dice step leaves a sliver of hand tile tops between modal and card — _tutorial-basics-0 @ phone-landscape_
  - [ ] [low] Last live wall tile spotlight reads as a plain cream slab — _tutorial-drawn-game-2 @ desktop (1075-1120 x 640-700) and phone-landscape (1500-1570 x 500-580)_
  - [ ] [low] Phone dice step card hides the footer badge and sort control completely — _tutorial-basics-0 @ phone_
- **menu** (latest critic: **8.6/10, pass**; 8.5 → 8.6):
  - [ ] [medium] Desktop: a drift tile back sits on the hero rack's 一萬 corner (rack keep-out is phone-only) — _menu, menu-tutorials @ desktop 1440x900 (3d)_
  - [ ] [medium] Desktop replay shelf reads small and aliased inside a 620 px card — _replay-library @ desktop 1440x900 (3d, dpr 1)_
  - [ ] [low] Reduced-motion portrait field is one lone edge-on tile in the left margin — _menu-reduced-motion @ phone 412x915 (3d)_
  - [ ] [low] DISMISS pill label is ~0.55-alpha grey, below the 0.62 secondary-text spec — _menu, menu-tutorials, replay-library, settings @ phone-landscape 915x412 (3d)_
  - [ ] [low] Settings landscape letterbox still leaves ~38 % of the preview canvas as void — _settings, settings-jade-plum, settings-landscape @ phone-landscape 915x412 (3d)_
  - [ ] [low] Desktop dpr 1 preview: stair-step edges on tiles and glyph strokes — _settings, settings-jade-plum @ desktop 1440x900 (3d)_
  - [ ] [low] Regression run hijacked by a stale serve on 4173 (process hazard, not a menu defect) — _npx playwright test three-menu/three-settings/... from the menu worktree_
- **settings** (latest critic: **8.6/10, pass**; 8.6 → 8.6):
  - [ ] [medium] Desktop: Players and Game log are phone bottom-sheets pasted onto a 1440x900 canvas — _match-players, match-game-log_
  - [ ] [medium] Phone landscape: breakdown TOTAL and older log rows fall below the fold with no scroll cue — _match-result-breakdown, match-game-log_
  - [ ] [low] Scoring-rules accordion snaps; sheets use stock RN Modal slide/fade — _match-scoring-rules (all viewports)_
  - [ ] [low] Game log tile chips show code abbreviations instead of tile faces — _match-game-log (all viewports)_
  - [ ] [low] Behaviour toggles still use the classic coral track + teal knob inside the glass sheet — _settings-skins, settings-phone-small_
  - [ ] [low] Scoring-rules example hands wrap 11+3 on phone — _match-scoring-rules_
  - [ ] [low] Tooling: desktop recipes stall on the dice-modal dismiss step under load — _match-menu/tile-reference/scoring-rules/players, settings-jade-plum/skins @ desktop_
- **whole game** (round 3: **8.7/10, pass** — visual 8.8 / motion 8.7 / legibility 8.4 / polish 8.4 / cohesion 9.1; rounds 8.2 → 8.6 → 8.7): scored before the feedback round; re-score after the residuals above are closed. 13 ranked residuals remain in `docs/STATUS.json` → `wholeGame.issues` (several are now fixed by the feedback round: dead-wall marker on every viewport, landscape lobby, coach-card opacity, camera settle).
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
