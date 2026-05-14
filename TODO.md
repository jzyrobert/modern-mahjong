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
