# Roadmap

Live tracker for queued and out-of-scope work. The full design lives in [`docs/PLAN.md`](./docs/PLAN.md); shipped milestones live in `git log` (every PR title carries a one-line summary). This file is intentionally short — only what's still open or deliberately deferred.

## Shipped (high-level milestones)

- Pure TS engine (`packages/game-logic`): tile model, seeded shuffle, reducer, shanten (standard + 7-pairs + 13-orphans), claim resolution, HK faan scoring.
- Shared protocol (`packages/protocol`): `ClientMessage` / `ServerMessage` unions + zod schemas + match-code helpers.
- Bots (`packages/bots`): simple, heuristic, passive (disconnect stand-in).
- Server (`apps/server`): `partyserver` `MatchRoom` Durable Object, claim-window alarm, host gating, snapshot/restore, reconnect grace timer, viewer count.
- Client (`apps/client`): identity, lobby, three transports (online / solo / LAN), match shell with desktop perimeter felt + mobile vertical-stack.
- Animations: between-hand shuffle, dice ceremony, win celebration, FLIP transitions on every tile via the `FlipBag` context, active-turn pulses.
- Match polish: dice-roll dealer derivation, scoring breakdown modal, settings panel, game log, chat / emotes, drag-to-reorder hand, seat-color discard pool, scoreboard.
- Mobile bottom sheets: 136-tile reference (📖 inside ☰), match menu (☰ — Settings / Game log / Tile reference / Leave), and players panel (tap the GameStatusBar pill).
- Cross-platform packaging: Expo Router + Metro replaced Vite + Capacitor (#80); web ships to <https://modern-mahjong.pages.dev>; Android APK built locally via `eas build --local` on the GitHub runner; Android lifecycle smoke runs an x86_64 AVD on every push to `main`.
- LAN: `expo-lan-server` Expo Module — embedded NanoHTTPD HTTP+WS server, mDNS host advertise / discover via `NsdManager`, static-asset HTTP route serving the bundled web export, autolinked into every native build. Auto-populates the host URL + lists nearby hosts in the lobby modals.
- CI: typecheck + tests + lint + web build + e2e + Lighthouse (performance ≥ 0.9, median of 3 runs) on every PR.
- Solo-match e2e claim flow: scriptable solo-transport bots drive deterministic chi / peng / gang claim opportunities via the `__MAHJONG_TEST_BOT_SCRIPTS__` test hook in `solo-transport.ts` (#116).

## Open

### Future (post-MVP)

- Maestro / UIAutomator UI driving so the Android lifecycle smoke can drive a match into mid-hand, background it, and assert the snapshot really did restore (the current smoke only catches crash-on-resume, not state loss).

## Out of scope until a maintainer decides

- **iOS build.** No iOS shell or build profile is currently planned; the project ships web + Android only. The Swift `LanServer` skeleton at `apps/client/modules/expo-lan-server/ios/LanServerModule.swift` exists so `expo prebuild` produces a valid `ios/` tree, not because a Swift implementation is being worked on. If a maintainer ever does want iOS, the Android Kotlin module is the reference: drop in Telegraph (or Swifter / GCDWebServer + a WS layer) for the HTTP+WS server, `NetService` / `NWBrowser` for mDNS, `getifaddrs` for `lanAddresses()`. Macos runner + signing certs would also need to be added to CI.
- Account system / cross-device identity sync.
- Match history / replays beyond the in-memory seed-based determinism.
- Spectator mode for live matches (server tracks the count; UI doesn't surface a watcher view).
- Internationalisation (currently English + traditional-character mahjong terms only).
