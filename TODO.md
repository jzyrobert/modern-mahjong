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

Every subsystem passed its art-director critic before the manual play-tests; the three play-test feedback rounds (`docs/STATUS.json` → `feedbackRounds[0..2]`) then fixed all 18 + 5 + 3 user-reported items, verified per item by the critics. The lists below are the critic residuals still open, ranked; each names the state and viewport where the critic saw it. The next `/loop` iteration resumes from the lowest-scoring subsystem.

- **manual feedback round 1** — 18/18 user items fixed; area critics: mobile 7.9 → 8.4 → 8; table 7.3 → 7.7 → 8.1; tutorial 7.4 → 8.2 → 8.5 pass; settings 8.6 pass; input 8.7 pass. Table and mobile stayed under 8.5 on critic-added residuals (listed under table below).
- **manual feedback round 2** — 5/5 user items fixed (discard-hint ring on the tile face, menu cream underlay + hero rack under the title, replay player on the 3D table, 和 seal off the save control); area critics: menu 8.6 pass (follow-up fixed the khaki app bar), replay 7.5 → 9.0 pass.
- **manual feedback round 3** — 3/3 user items fixed (menu rack scrolls natively with the page, satin tile finish so the held hand stays even, tutorial body takes the room it has); critics: menu 8.9 pass, tutorial 7.5 → 9.0 pass.
- **manual feedback round 4** — 12/12 user items fixed + the wall-layout request and its angle follow-up (menu scroll flicker + gentler parallax; plan-view river zoom; 7-tile hand rows; table parallax as a drift; in-scene 3D discard hint; contact glow under the hand; aligned own melds; dead-wall inlay removed; pinwheel walls with a 2.5° yaw); critics: menu 8.9 pass; table 8.3 → 8.2 (all user items verified fixed — the score is held under 8.5 by the wall-overhang projection residuals below; the zoom felt-edge high was fixed after the critic and shot-verified).
- **manual feedback round 5** — 3/3 user items fixed (zoomed melds on a shelf above the held hand; tiles sink through the felt and rise back instead of blinking off / popping in, felt and rail blend on the same beat; carved glyph relief on the ivory edge of every stroke); table critic 8.4 → **8.6 pass** (round 1 measured the symmetric relief blackening coloured ink and adding river-tile edge noise; the ivory-side, footprint-aware relief fixed both — river tiles pixel-identical to the previous build, 發 ink luminance back at 142).
- **critic queue round 6** — the user asked for the queued mediums, then the lows. All 13 mediums and the lows below were worked by seven agents in their own worktrees (mobile table, tutorial, menu / settings / replay, desktop table lows, then landscape, portrait and menu follow-ups on the critics' findings); independent critics on the integrated build: table 8.3 (15 of 20 claims verified fixed, 3 partial, 1 not fixed; the two regressions it found — the far seat's landscape meld in the left corner, the relocated chip in the zoom's hand band — were fixed by the follow-ups, e2e-pinned), tutorial **8.9 pass**, menu **9.0 pass**, settings **8.8 pass**, replay **9.2 pass**. Two items closed as documented geometry rather than fixed (the landscape hand top vs the near wall's stack seam; the held 1.3× melds vs the near tip on the 55° / 51° portrait cameras — see CLAUDE.md).
- **replay** (latest critic: **9.2/10, pass**; 7.5 → 9.0 → 9.2):
  - [x] [low] Compact timeline seam ~4 px / 2 frames off the rendered card edge — _round 6: playhead flush with the hand-2 card at frame 105 (≤ 1 CSS px) on phone-small and phone-landscape._
  - [x] [low] Chapter result clips its faan on the 360 px strip — _round 6: the name run ellipsises, "0 faan" intact._
  - [x] [low] Speed / POV-All segments at 10 px, dealer 莊 glyph at 9 px — _round 6: every segment / badge at 11 px._
  - [ ] [low] [desktop] The empty-state shelf spans ~440 px of the 620 px card (~80 px of empty card either side); either widen the rack fit or leave it — 58 px tiles already read well — _replay-library @ desktop (round-6 critic)_
- **table (desktop + mobile)** (latest critic: 8.3; 8.3 → 8.6 → 8.6 → 8.1 → 8.3 → 8.2 → 8.4 → 8.6 → 8.3 — the round-6 score was taken before the landscape / portrait follow-ups fixed its two regressions and its left-seat / chip / shelf partials; re-score next round):
  - [x] [medium] [mobile] Right seat's lowest meld wedged under the near wall's overhanging stack on the phone cameras — _round 6: `rowTuningFor` sizes the near-end stop by projection (the tip's top-face shadow + visible felt); 5.7–6.5 px at 412×700, 8.5–10.5 landscape; the 360×640 low end (4.7 px) was lifted to 5.3 px by a px-sized felt floor (`rowOverhangFeltFor`, 5 px)._
  - [x] [medium] [mobile] User's 14-tile hand meets the left wall's overhanging tip corner on phone-landscape — _round 6: the side walls step in 0.6 on landscape (`SIDE_WALL_IN_LOW`) and the row follows the inset tip; 12.5–14.5 px of felt._
  - [x] [medium] [mobile] Portrait dealer chip wedged in the pinwheel pocket — _round 6: parked on the felt in front of the near wall's heel (0.62 to the tip, 1.0 to the rail); in the river zoom it sinks with the rail (`CHIP_SINK`) — the critic's regression (chip in the zoom's hand band) is fixed and e2e-pinned._
  - [x] [medium] [mobile] Side-seat melds sit flush against the side walls (portrait + landscape) — _round 6: both side seats' melds lie beside their wall's heel half; the right seat keeps 4.6–11 px of felt on portrait. The left seat's "0 px at the seam" was its own rack's end tile casting over the meld, not the wall: the meld → rack seam is now sized by projection (`sideMeldGapFor`, 4 px of felt from the meld's bottom edge; 5.0–5.7 px measured at 412×700 / 360×640, right seat 6–8 px). Landscape keeps `SIDE_MELD_GAP_BEHIND` for the left seat and clears both silhouettes by ≥ 4 px (e2e)._
  - [x] [medium] [mobile] Landscape hand row stands in front of the near wall's lower row — _closed as documented geometry (CLAUDE.md): the hand's silhouette top and the wall's stack seam both sit ≈ 1.2–1.4 above the felt, 1.55 apart, so the hand top stays 0.3–0.5 units above the seam for every elevation 25–39°; 6 px of felt needs the wall 1.2 nearer the centre or the hand past the felt's edge. The 27° landscape preset (round 6) keeps the hand at 44 px and drops the far melds ≥ 8 px under the chrome row._
  - [x] [medium] [mobile] 360×640 lobby: collapsed RULES summary row buried under the panel fade — _round 6: pinned as the panel footer; the scroll region snaps so no seat / skill row straddles the fold at rest (`useFoldSnap`, e2e at 412×700 and 360×640)._
  - [x] [medium] [desktop] Portrait 'Watch the wall run out' card hides the entire table (tutorial-owned) — _round 6: the last live wall tile is ringed on the 3D table (`wall-draw` anchor) and the card docks beside it with the count visible at phone / landscape / desktop; residual below._
  - [x] [medium] [mobile] Portrait river-zoom toast lands on the near wall's tile backs — _fixed in round 4: the zoom lays out no wall; the toast slot is the felt under the block / the header row._
  - [x] [low] [mobile] Landscape far-seat melds crowd the chrome row — _round 6: 27° preset + melds on the rail's inner half (`RAIL_MELD_Z`); tops ≥ 8 px under the pills (e2e). The follow-up also fixed the critic's regression (the far row had slid into the left wall's corner by the camera-sized gap — only the right seat's near end takes it now)._
  - [x] [low] [desktop] User's badge crowds the left wall's tip stack — _round 6: hangs below the hand line on the near rail, 45 px under the stack (e2e)._
  - [x] [low] [mobile] Early-hand river zoom frames three empty river rows — _round 6: the block fits the rows present with grow-only hysteresis (`riverZoomBlock` / `growZoomBlock`); 412×700 river tiles 25 → 34 px._
  - [x] [low] [desktop] Hint states run 13 draw calls — _round 6: cue halo + hint frame are two quads of one glow mesh; 12 calls in every state._
  - [x] [low] [desktop] Contact glow under the hand is faint at desktop — _round 6: 0.55 → 0.75 opacity with a wider falloff (`CUE_BAND_SIGMA` 0.32); feet-band luminance +9 %. The critic measured the 0.65 step only (+8 %, "still two end pools") — re-check the wider band next round._
  - [x] [low] [desktop] Landscape breakdown modal clips the TOTAL row and overlaps the coach card — _round 6: TOTAL pinned as the footer, fade + chevron while rows are below the fold._
  - [x] [low] [desktop] Breakdown header uses seat index instead of the player name — _round 6: "You win — 2 faan · DISCARDED BY DAO"._
  - [x] [low] [desktop] Phone portrait shows no dead-wall count until the wall is nearly empty — _round 6: the pill reads "69 LEFT · 14 DEAD"._
  - [x] [low] [desktop] Desktop sort control sits over the rail's bottom-right mitre — _round 6: 85 px clear of the corner._
  - [x] [low] [mobile] Result panel winning hand wraps 12 + 2 at 360 wide — _round 6: 14 tiles on one row at ~20 px._
  - [x] [low] [mobile] Seat badges vanish for the whole toast hold on short phones — _round 6: badges shrink to 23 px wind discs under a strip toast; residual below._
  - [x] [low] Desktop 48 px faces render the relief as speckle inside the pin rings — _round 6: the carve fades on face device px (56 → 76 px), independent of the atlas scale; desktop rings clean at 8×, phone hand keeps the carve, rivers pixel-identical._
  - [x] [low] [mobile] Faint felt speckles where a wall crosses the felt plane mid-sink — _round 6: per-instance shadow casters; a sinking tile leaves the casters once its top is within `SHADOW_CAST_FLOOR` of the felt (0 bright px beside the stacks at ×200)._
  - [x] [low] [mobile] Zoom meld shelf reads attached to the hand with a one-row near river — _round 6: the shelf lies in the block's reserved row just past the user's own river's last row (`ZoomShelfBlock.ownNear`); 3.4 / 2.7 / 5.5 px under the river at 412×700 / 360×640 / 412×915._
  - [x] [low] [mobile] Tall phone zoom with melds out: toast slot falls back to the header strip — _round 6: the toast sits on the felt under the shelf on the tall phone._
  - [x] [low] [mobile] Four-meld shelf verified geometrically only — _round 6: `match-river-zoom-four-melds` recipe; 12 tiles on one shelf row in frame at 412×700 and 360×640._
  - [ ] [low] [mobile] Held 1.3× melds meet the near wall's yawed tip on the 55° / 51° portrait cameras (0 px of felt at 412×700 / 360×640, 1–3 px at 412×915; `match-own-meld-near-wall`) — a design residual, not a layout one: the strip between the yawed wall's outer face (9.88) and the rail (11.9) is 2.02 units, a 1.3× flat tile takes 1.77 and its top face casts 0.57 more toward the wall; no step, alignment or scale ≥ 1× shows felt on both sides (CLAUDE.md). Needs the near wall lower or the held melds elsewhere — _portrait, own melds while the near overhang stands_
  - [ ] [low] [mobile] The left seat's meld → rack seam is wide by construction (≈ 1.75–2 tile widths of felt on the 55° camera); `SIDE_SEAM_FELT_PX` (4) is the knob if the critic prefers a tighter seam — _match-left-meld @ phone, phone-small (round-6 portrait follow-up)_
  - [ ] [low] [mobile] Under a strip toast the 西 disc is partly behind the toast's left edge at 360×640 (8 px visible) — _match-claim-toast @ phone-small (round-6 critic)_
- **tutorial** (latest critic: **8.9/10, pass**; 8.3 → 8.7 → 8.5 → 7.5 → 9.0 → 8.9):
  - [x] Two three-table.spec tests failing under host load — _stale: both were reworked (waitForFunction / HOLD_DICE) and pass on CI._
  - [x] [medium] 'Now watch the bots' card hides bot seat badges at every viewport — _round 6: a bottom strip on phones, the left column on desktop, between the badge and the hand on landscape; 0 px overlap at all three._
  - [x] [medium] Phone and desktop no-target cards park over the centre plate and river — _round 6 (desktop): the cards take the column beside the river block, plate and rivers clear. Phone residual below._
  - [x] [low] Strip title ellipsised ("Now watch t…") beside Skip / Restart at 360×640 — _round 6: whole title, "Skip" / "Restart"._
  - [x] [low] Geometry floor still leaves a scroll on the smallest phone (basics-4 3/4) — _round 6: basics-4 shows 4/4 lines at 360×640; scoring-0 / claims-0 at 412×600 not re-measured._
  - [x] [low] Landscape claim strip and tsumo ring are flush with the viewport bottom — _round 6: the ring opens toward the edge (no bottom stroke)._
  - [x] [low] Landscape dice step leaves a sliver of hand tile tops between modal and card — _round 6: the strip covers the tops whole (8 px of scrim between)._
  - [x] [low] Last live wall tile spotlight reads as a plain cream slab — _round 6: the spotlit back keeps its shade (`SPOTLIGHT_LEVEL_BACK`)._
  - [ ] [low] Landscape own-hand ring halo grazes the footer badge border (5.5 px) — _tutorial-basics-2 @ phone-landscape_
  - [ ] [low] Phone dice step card / landscape strip hides the footer badge, sort control and turn pills — _tutorial-basics-0 @ phone, phone-landscape_
  - [ ] [low] Phone no-target cards (basics-1, claims-0, scoring-0) still park over the plate and rivers at 412×700 — no band clears the river; text is whole — _phone (round-6 critic)_
  - [ ] [low] Landscape claims-3 / win-1 centred card sits over the plate and the river where the claimable discard just landed — _phone-landscape (round-6 critic)_
  - [ ] [low] 'Watch the wall run out' side-docked card's lower band covers the remaining near-wall stacks (only the ringed tile stays visible) — treat the projected wall run as a soft keep-out so the card slides up — _tutorial-drawn-game-2 @ desktop, phone-landscape (round-6 critic)_
  - [ ] [low] The turn pill's rounded cap peeks ~6 px above the phone bottom strip — hide the pill under a strip or stretch the strip 8 px — _tutorial-basics-4 @ phone, phone-small (round-6 critic)_
  - [ ] [low] [desktop] Left-column cards cover the left wall run's near end and the basics-4 card's right edge grazes the dealer chip — add the wall runs and the chip to the soft keep-outs — _tutorial-basics-1, claims-0, scoring-0, basics-4 @ desktop (round-6 critic)_
  - [ ] [low] Landscape basics-4 tight card shows 3 of 4 lines + the cue with less than one line of room left — let the tight frame drop its padding when the last line is within one line height — _tutorial-basics-4 @ phone-landscape (round-6 critic)_
- **menu** (latest critic: **9.0/10, pass**; 8.5 → 8.6 → 8.6 → 8.9 → 8.9 → 9.0):
  - [x] [low] Drift-tile fragments clip in at both viewport edges level with the rack on the 360 px phone — _round 6: 0 bright px in the edge columns._
  - [x] [low] A rotation costs three drift re-fits — _round 6: fits coalesce over 80 ms (`FIT_COALESCE_MS`); a real rotation remounts the hero, so the counter reads 0._
  - [x] [low] On a slow main thread the scene chunk can fetch before FCP — _round 6: the idle import is gated on the first-contentful-paint entry (3 s timeout)._
  - [x] Replay shelf could freeze mid-intro (last tween frame never rendered) — _fixed with the hero-canvas round (ShelfScene renders the landing frame)._
  - [x] [low] Desktop rack sits 7.8 px above the first card — _round 6: ≥ 9 px._
  - [x] [low] Portrait drift field is reduced to viewport-edge slivers at the rack's height — _round 6 follow-up: a deeper portrait plane (34–66 units), the field floored at the hero band, rack + dice keep-outs; 8 whole tiles in motion at 412×700 (was 1 of 14), 6 at 360×640._
  - [x] [low] Fullscreen prompt overlaps the LAN card copy on a grown + scrolled landscape phone — _round 6: inline in the wide lobby's header row, scrolls with the content._
  - [x] [medium] Desktop: a drift tile back sits on the hero rack's 一萬 corner — _round 6: the rack keep-out applies on every viewport class._
  - [x] [medium] Desktop replay shelf reads small and aliased inside a 620 px card — _round 6: 331 → 438 px of tiles, 3× supersampled at dpr 1._
  - [x] [low] Reduced-motion portrait field is one lone edge-on tile — _round 6 follow-up: the frozen tilt is capped (`FROZEN_TILT`); 8 tiles frozen at 412×700._
  - [x] [low] DISMISS pill label is ~0.55-alpha grey — _round 6: 0.84._
  - [x] [low] Settings landscape letterbox leaves ~38 % of the preview canvas as void — _round 6: 30 % (`PREVIEW_MAX_ASPECT` 2.6)._
  - [x] [low] Desktop dpr 1 preview: stair-step edges — _round 6: 3× supersample at dpr < 1.5; the critic found the edges crisper rather than smoother at 400×236 CSS — subtle._
  - [x] [low] Regression run hijacked by a stale serve on 4173 — _process hazard, not a menu defect; the e2e helpers take `PW_PORT`._
  - [x] [medium] The sheet fold cue's chevron sat on live body text — _round 6 follow-up: the cue ends in an opaque 16 px strip (0.96 of the sheet fill) and the chevron lies inside it._
  - [x] [low] Phone bottom sheets opened at ~90 % height, hiding the table peek — _round 6 follow-up: capped at 78 % (`SHEET_PHONE_MAX_FRAC`)._
  - [x] [low] The lobby Rules card's "No turn timer" toggle still coral / teal — _round 6 follow-up: the glass switch._
  - [x] [low] A 412×700 → 700×412 rotation fitted the rack into a 216 px column and truncated the row titles — _round 6 follow-up: a landscape viewport with a short edge ≤ 480 is a landscape phone (`classifyViewport`); the Replays row wraps to its own line; `phone-landscape-short` shot viewport._
  - [ ] [low] The 700×412 lobby still scrolls slightly (the wrapped Replays row) — _menu @ phone-landscape-short (round-6 follow-up)_
  - [ ] [low] Settings preview budget lifted to 18 programs / 20 textures with the page measured at 17 / 19 — audit the preview's texture set (shared atlas + felt + rail should be ~4–5) before the next feature lands there; keep the ceiling at measured + 1 — _settings @ all viewports (round-6 critic)_
- **settings** (latest critic: **8.8/10, pass**; 8.6 → 8.6 → 8.8):
  - [x] [medium] Desktop: Players and Game log are phone bottom-sheets pasted onto a 1440×900 canvas — _round 6: centred 516 px glass panels on desktop; phones keep bottom sheets._
  - [x] [medium] Phone landscape: breakdown TOTAL and older log rows fall below the fold with no scroll cue — _round 6: TOTAL pinned, fade + chevron._
  - [x] [low] Scoring-rules accordion snaps; sheets use stock RN Modal slide/fade — _round 6: 280 / 180 ms glass presence tween, 220 ms accordion settle (code-verified; no motion recipe)._
  - [x] [low] Game log tile chips show code abbreviations instead of tile faces — _round 6: ~20 px tile faces on felt chips._
  - [x] [low] Behaviour toggles still use the classic coral track + teal knob — _round 6: gold track + ivory knob._
  - [x] [low] Scoring-rules example hands wrap 11+3 on phone — _round 6: one row at 412 and 360._
  - [x] [low] Tooling: desktop recipes stall on the dice-modal dismiss step under load — _run critic shots with `SHOT_TIMEOUT_SCALE=3` on a shared host (shot.mjs header); all four stalls pass at 3×._
- **whole game** (round 3: **8.7/10, pass** — visual 8.8 / motion 8.7 / legibility 8.4 / polish 8.4 / cohesion 9.1; rounds 8.2 → 8.6 → 8.7): scored before the feedback round; re-score after the residuals above are closed. 13 ranked residuals remain in `docs/STATUS.json` → `wholeGame.issues` (several are now fixed by the feedback round: dead-wall marker on every viewport, landscape lobby, coach-card opacity, camera settle).
- **blind judges**: 3 judges × 15 A/B pairs (3D vs pre-rewrite baseline, labels shuffled) → 45/45 preferred the rewrite (`docs/STATUS.json` → `blindJudges`).
- [ ] Native (Android) still uses the classic shells — the `expo-gl` port of `src/three/` is out of scope for this pass (ARCHITECTURE.md §0). Sized in `docs/NATIVE-3D.md`: roughly 3–6 weeks for parity (canvas-drawn textures, DOM HUD, `fwidth` shader, no device evidence pipeline); the cheap route is the exported web build in a WebView, or the PWA.

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
