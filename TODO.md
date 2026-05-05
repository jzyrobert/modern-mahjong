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

## Open

### iOS Swift `LanServer` (Phase 8 carry-over)

- [ ] Port the Kotlin LanServer logic to Swift in `apps/client/modules/expo-lan-server/ios/LanServerModule.swift`. The skeleton currently throws `"not implemented yet"` on every async function except `stop` / `unadvertise` / `stopDiscovery`. Pieces:
  - HTTP + WebSocket server: [Telegraph](https://github.com/Building42/Telegraph) is the cleanest fit; Swifter / GCDWebServer + a WS layer also work.
  - mDNS via `NetService` / `NWBrowser` (advertise + discover).
  - `lanAddresses()` via `getifaddrs`, skipping `lo0` and IPv6.
  - Mirror the Kotlin side's static-asset HTTP route for browser-guest joins.
  - Blocked on iOS shell shipping in CI (no `macos-latest` runner / signing certs configured).

### Future (post-MVP)

- Maestro / UIAutomator UI driving so the Android lifecycle smoke can drive a match into mid-hand, background it, and assert the snapshot really did restore (the current smoke only catches crash-on-resume, not state loss).
- Solo-match e2e claim flow (chow / pung / kong) — driving into a deterministic claim opportunity needs either a JS-side state-injection hook (dev-only) or a polling-with-flake spec.

## Out of scope until a maintainer decides

- Account system / cross-device identity sync.
- Match history / replays beyond the in-memory seed-based determinism.
- Spectator mode for live matches (server tracks the count; UI doesn't surface a watcher view).
- Internationalisation (currently English + traditional-character mahjong terms only).
