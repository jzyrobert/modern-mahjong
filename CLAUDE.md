# Project notes for Claude

Operational + architectural decisions worth carrying across sessions. Update
this file (don't dump notes into PR descriptions) so the next session can pick
up the rules without re-deriving them.

## Repo at a glance

Hong Kong mahjong client + server, monorepo via pnpm workspaces.

- `packages/game-logic` — pure TS engine, XState v5 reducer with property
  fuzzing. State, scoring, shanten, claims, openings.
- `packages/protocol` — wire contract (`ServerMessage` / `ClientMessage`
  unions + zod schemas).
- `packages/bots` — opponent strategies.
- `packages/match-session` — engine wrapper used by both the server and
  the solo client transport; owns snapshot / restore.
- `apps/server` — partyserver Durable Object on Cloudflare; thin shell
  around `MatchSession`.
- `apps/client` — Expo Router + Metro app (web + native). Two match
  shells: `DesktopShell.tsx` (wide viewport) and `MobileShell.tsx`;
  `Match.tsx` picks one by viewport. Sounds, animations, and recorder
  hooks fan in through `transport-context.tsx` (universal, not
  per-shell) — that's also where engine events (`drew`, `discarded`,
  `opened`, `claimsResolved`, `gangDeclared`) are dispatched. Root-level
  overlays (post-draw popup, claim-announcement banner, shuffle
  ceremony) are mounted per shell — check both when adding one.

When operating from a web session without a local checkout: lean on the
GitHub MCP for code reads / PR ops, and be explicit about what you can
and can't verify. Don't claim a local run you didn't actually do.

## Branching policy

**Default: one PR = one new branch off `main`.**

Do NOT reuse a long-lived feature branch and force-push for each PR. After
a PR merges, branch off `main` again for the next chunk:

```sh
git fetch origin main
git checkout -b claude/<short-slug> origin/main
# ...do the work, commit, push, open PR, wait for CI, merge...
```

This keeps the repo's branch history clean and avoids force-pushes that
rewrite history other tools may have linked to.

If a session-startup instruction names a specific branch, prefer the naming
convention from that instruction but still create a fresh branch per PR
rather than reusing the named one across multiple PRs.

### Carve-out: long-lived migration branches

For explicitly-bounded multi-week refactors that touch the build system or
swap out a major dependency wholesale (e.g., Vite → Expo + Metro,
Capacitor → React Native), a single long-lived branch is acceptable. The
default per-PR-stays-green discipline isn't compatible with a coordinated
stack-replacement that breaks `main` halfway through.

Rules for these branches:

- Get explicit user approval before opening one. Do not unilaterally
  decide a task is "long-lived migration" — assume the default applies
  unless the user has waived it.
- The first commit on the branch should reference / link to the plan or
  user instruction that approved it.
- Commits along the way are fine — treat the branch like a feature branch
  with multiple commits, not like `main`.
- At the end, **still squash-merge** to a single mainline commit.
- The default ("one PR = one branch") still applies to all other work
  done in parallel during the migration period.

### Carve-out: iterating on an open PR that's awaiting manual merge

When there is already an open PR that is **awaiting the user's manual-merge
decision** ("don't auto-merge", "wait for me to review"), the default flips:
**any further change request from the user stacks onto that same PR's
branch as additional commits**, NOT a fresh branch off `main`. Branching
off `main` for each tweak forces the user to merge the earlier PR before
seeing the next iteration, which breaks the "I want to keep tweaking and
reviewing before merging" workflow they're explicitly using.

Two overrides revert to a fresh branch off `main`:

1. The user **explicitly** asks for the new work to land in its own PR
   ("open a separate PR for this", "new PR please").
2. A **multi-PR plan** has already been generated and shared (e.g. from a
   `/ce-code-review` output, an approved planning doc, or a prior session
   that produced a queued PR list) — then each PR in that plan lands on
   its own branch as planned.

Once the open PR squash-merges, the default ("one PR = one branch off
`main`") immediately resumes for the next chunk of work.

## PR workflow

1. Run the full check pipeline locally before pushing: `pnpm -r typecheck`,
   `pnpm lint`, `pnpm test`, and where relevant `pnpm --filter @mahjong/client
   export-web && pnpm --filter @mahjong/client e2e` + a build. Playwright
   serves `apps/client/dist/`, so skip `export-web` (or forget to rerun it
   after a merge) and you're testing a stale bundle. Pushing red-on-CI
   burns a CI cycle for nothing.
2. After opening the PR, **always poll the CI status every ~2 minutes**
   until every check is green, then squash-merge — don't wait to be told.
   The default is "open → poll → merge" as one continuous flow, not
   three separate user-prompted steps. Stop only if the user explicitly
   says to hold the merge (e.g. "wait for me to review", "don't merge
   yet"). Webhook activity events for the subscribed PR are unreliable —
   treat them as a hint, not a source of truth, and always re-check
   directly. From a web session, that's `mcp__github__pull_request_read`
   with `method: 'get_check_runs'`. From a local checkout it's:

   ```sh
   until gh pr view <PR> --json statusCheckRollup --jq \
     '[.statusCheckRollup[] | select(.status != "COMPLETED")] | length == 0' \
     | grep -q true; do sleep 30; done
   ```

   The `ci` workflow expands into 5 separate check runs
   (test → build-server / build-web / e2e-shard ×4 / lighthouse), so a
   naive `gh pr view ... --jq '.[].status'` returns a multi-line string
   and `[ "$status" = "COMPLETED" ]` never matches even when every check
   is green. Use the "are any checks unfinished?" predicate above, not
   a single-value equality on a named check. Don't suppress stderr on
   the poll — that's how `gh pr checks --json` (an invalid flag) silently
   turned past loops into infinite no-ops.

   For PRs that came with a sidecar screenshot branch, delete that
   branch immediately after the squash-merge lands (see "PR screenshots"
   below).
3. After merge, sync `main` (`git fetch origin main && git reset --hard
   origin/main` is fine on the working branch since it's just been
   incorporated) and branch off again for the next PR.
4. Squash-merge by default. The repo's history reads cleanest with one
   commit per PR; the title format is `<change summary> (#NN)` (the GitHub
   default).

The default flow is one continuous loop, not a series of user-prompted
checkpoints: **simplify → branch off main → commit → push → open PR →
poll → squash-merge → sync working tree → branch off again**. Don't
commit straight to `main`. Don't park work as an uncommitted diff
expecting the user to ship it manually. Don't skip the `simplify`
sweep on the grounds that the diff is small. Diverge from the flow
only when the user explicitly asks you to.

## Local validation for client-touching PRs

Any PR that touches the engine, transports, hooks, UI, or claim / turn
flow must run the full Playwright suite locally before pushing:

```sh
pnpm --filter @mahjong/client export-web && pnpm --filter @mahjong/client e2e
```

CI is the final check, not the first signal. The suite runs in ~30s
locally and ~2m on CI (sharded ×4 — initial sharding in #348, switched
from `--shard=N/M` to named projects in #400). Don't burn a CI cycle
on something a local run would have caught. To iterate on one spec:

```sh
pnpm --filter @mahjong/client exec playwright test e2e/solo-match.spec.ts
```

To reproduce a single failing CI shard locally (matrix shard N maps to
the `shard-N` Playwright project):

```sh
pnpm --filter @mahjong/client e2e --project=shard-N
```

Shard membership is hand-balanced in `apps/client/playwright.config.ts`
via per-shard `testMatch` arrays. When adding a new spec that costs more
than ~10 s of wall-clock, measure each shard with `--project=shard-N`
and slot the new spec into the lightest one (edit the matching
`SHARD_N_SPECS` array). New specs that aren't added to an explicit
shard fall into shard 4 via its `testIgnore` catch-all — fine for
small specs, drifty for heavy ones. A vitest case
(`src/playwright-shards.test.ts`) catches duplicate or missing
assignments before CI does.

Pure logic, copy, or refactor PRs that don't reach the client can skip
the e2e step.

Add coverage in the same PR if the change isn't already exercised. Solo
flows have two test hatches for determinism:

- `__MAHJONG_TEST_GET_STATE__` — read the live engine state from the page.
- `__MAHJONG_TEST_BOT_SCRIPTS__` — pin bot actions to a scripted sequence.

## Dev server policy

Don't start a dev server by default. Spin one up only when the PR
genuinely needs a visual smoke test (UI layout, animation, skinning)
that typecheck + lint + unit + e2e can't validate. Logic, copy, or
refactor PRs don't warrant one.

When you do need one:

- One Expo web dev server per PR, always on port `8081`.
- Reuse it across iterations of the PR; stop the process tree once the
  PR merges.
- Use plain `expo start` (or `pnpm --filter @mahjong/client start`).
  **Never** start with `--web` or the `web` script — those auto-open
  browser tabs that pile up. Press `w` only if you actually need a
  browser; for scripted launches prefix with `BROWSER=none`.
- Don't escalate to `8082+` if the port is in use; kill the prior
  `8081` process tree and reclaim it.
- On Windows, `TaskStop` only kills the wrapper bash — the Metro node
  process gets re-parented and keeps the port. Clean up with
  `Stop-Process -Force` or `taskkill /F /T /PID <pid>`.

## PR screenshots — required for UI changes, hosted on a sidecar branch

**Any PR that changes how the client renders MUST include before/after
comparison screenshots in the PR body.** That means anything touching
component output, layout, styling, copy, animation timing, or the
match/replay/lobby shells. Logic-only, server, protocol, engine, copy-
that-isn't-rendered-as-UI, or test-only PRs are exempt. When in doubt
(refactor that *might* change rendering, theming-token edit, etc.),
take the screenshot — the cost is one extra Playwright run.

The screenshot driver lives in
`apps/client/e2e/replay-screenshot-{portrait,landscape,desktop}.spec.ts`
and `replay-library-screenshot-{portrait,desktop}.spec.ts` for the
replay surfaces (one file per orientation so each can land in a
different e2e shard) and as ad-hoc specs for match-shell shots (set
viewport, drive to the state you want, `page.screenshot({ path: ... })`).
Shared setup lives in `apps/client/e2e/_helpers-replay.ts`. Output
lands in `apps/client/e2e-output/` (gitignored), so capturing at
multiple commits is fine — switch HEAD, re-`export-web`, re-run the
spec under
a different `*_SHOT_LABEL` env, repeat.

Hosting: **do not** commit the PNGs to the PR branch — they'd land on
`main` at squash-merge time and bloat the repo. Instead:

1. Create a sidecar branch off `main` named
   `claude/<pr-slug>-screenshots`, commit the PNGs there under
   `docs/screenshots/<topic>/`, and push it.
2. Reference the images in the PR body using absolute
   `https://github.com/jzyrobert/modern-mahjong/raw/<sidecar-branch>/docs/screenshots/<topic>/<file>.png`
   URLs so they render in the PR description without the screenshots
   appearing in the PR's diff. A side-by-side markdown table
   (`| Before | After |`) reads cleanest.
3. After the PR squash-merges, delete the sidecar branch (`git push
   origin --delete claude/<pr-slug>-screenshots`). The image links in
   the merged PR body will 404, but that's fine — reviewers only need
   them while the PR is open.

**Keep every image URL under ~150 characters.** The GitHub MCP write
path (`update_pull_request`, comments) code-wraps any URL longer than
that in double backticks, which silently breaks the `<img>` / `![]()`
and the screenshot renders as a broken link. Measured on PR #434: the
125-char `github.com/<owner>/<repo>/raw/<branch>/<path>/` prefix plus a
32-char filename was wrapped, 31 chars was not, and the same body was
otherwise untouched. Use a short sidecar slug and folder
(`claude/3d-screenshots` + `docs/screenshots/3d/`) rather than the
long descriptive form, prefer `github.com/.../raw/...` over
`raw.githubusercontent.com` (11 chars shorter), and read the PR back
after updating to confirm no `` `` `` landed around a URL.

Any ad-hoc Playwright spec written purely to drive these shots stays
untracked — it's a capture tool, not test coverage, and committing it
clutters the suite. Stash or delete it after the shots are saved.

## Commit messages

- Long-form body: lead with the user-facing summary, then break into a
  per-file or per-area block describing what changed and why. Skip
  bookkeeping noise ("ran tests"). Reference earlier PRs by `#NN` when
  building on them.
- End every commit with `https://claude.ai/code/session_<id>` so the user
  can trace it back to the originating session.

## TODO.md is the source of truth for queued work

When picking up a new chunk, read `TODO.md`'s `Design port follow-ups`
section (or whichever queue is currently active) to choose the next item.
After landing a PR, edit `TODO.md` in the same commit so the queue stays in
sync with `main`:

- `[x]` an item with `_Shipped in #NN._` once the PR's commit lands.
- Split larger items into smaller ones if you only ship part. Don't leave
  the same bullet half-checked.
- New ideas / queued follow-ups go at the bottom of the relevant section.

## Cross-package conventions

- **Engine state shape changes** (e.g. adding a field to `GameState`):
  initialize the field in `emptyState()` so `startHand` (which spreads
  `emptyState`) resets it cleanly each hand. Confirm `MatchSession.snapshot()`
  / `restore()` round-trip the new field — Capacitor / partyserver serialise
  via `JSON.stringify` so plain-object fields just work.
- **Protocol additions**: the `ServerMessage` / `ClientMessage` unions in
  `packages/protocol/src/index.ts` are the wire contract. Add zod schemas
  alongside the type if the field is something the server validates;
  optional fields (`viewers?: number`) keep older servers / clients
  parse-clean.
- **Client state**: `useGame` (zustand) holds session state. New slices that
  shouldn't survive a `reset()` need explicit clearing in the reset action.
  Anything that should outlive a tab refresh goes through
  `apps/client/src/native/preferences.ts` (lazy-loaded
  `@capacitor/preferences` + localStorage mirror). Settings (the
  `useGame.settings` slice) round-trip via `loadSettings()` /
  `persistSettings()` to localStorage; new settings default in
  `DEFAULT_SETTINGS` and users with persisted overrides keep theirs.
- **CSS-var skinning**: per-skin overrides (felt, tile-back) are applied as
  CSS vars on the `Match` container. Components like `Tile.tsx` and
  `Table.tsx` read `var(--token, fallback)` so they render correctly outside
  a Match too (e.g. inside `SettingsPanel`'s tile reference).

## State that needs a synchronous external reset → put it in zustand

If a component's state must be cleared by an action that runs outside the
component's normal render cycle (e.g. a zustand store action fired
several layers away), lift the state into the store. Don't fight React
render timing with `useEffect` or render-time `setState` — those patterns
can pass tests and still fail in production. Clear inside the store's
`set(...)` call so the clear lands synchronously before any consumer
renders.

PRs #274 → #279 → #282 took three iterations to learn this for the
tutorial overlay. Render-time `setState` ("Adjusting state based on
props") is valid in React but fragile under concurrent / batched
updates — reach for it only when there's no zustand-shaped alternative.
`useEffect`-based clears are never sufficient when an open / visible
predicate evaluates against the stale value, because effects run after
commit. Note also that Playwright `page.goto('/')` is a hard reload that
wipes in-memory state; for regressions that depend on root-mounted
components surviving a soft nav, drive the in-app nav path instead.

### `useRef` dedup guards have the same remount-reset trap

A `useRef(initialValue)` re-runs its initialiser on every mount, same as
`useState`. When a ref is used as a dedupe guard against a monotonic
counter on the store (e.g. `lastSeq` in `ClaimMissedToast` /
`ClaimAnnouncementToast`), a hard-coded `0` seed will treat any
already-fired event as fresh after a remount and re-fire the toast.
Seed from the live store value at construction:

```ts
// Good — survives a remount mid-match without re-firing.
const lastSeq = useRef(announcement?.seq ?? -1);
```

Use a sentinel that can't alias a real seq (the store starts at 1, so
`?? 0` is fine in practice but `?? -1` documents the intent). PR #390
fixed `ClaimAnnouncementToast` after a multiplayer game showed the
PENG toast popping up on every move once one claim had fired.

## Live-read from `useGame.getState()` inside callbacks that read-modify-write

When a callback reads a store slice, applies a patch, and writes it back,
do not close over the render-time selector value — read live inside the
callback:

```ts
// Bad — two same-tick chip taps clobber each other.
const lobbyPrefs = useGame((s) => s.settings.lobbyRulePrefs);
return (patch) => setSettings({ lobbyRulePrefs: { ...lobbyPrefs, ...patch } });

// Good — second tap merges onto the first's persisted value.
return (patch) => {
  const livePrefs = useGame.getState().settings.lobbyRulePrefs;
  setSettings({ lobbyRulePrefs: { ...livePrefs, ...patch } });
};
```

The render-time variant looks correct in isolation, but two callback
calls fired in the same React batch each see the same pre-batch
snapshot — the second write silently drops the first. Lives are fixed
in `RulePanel` (PR #384) and `LobbyAccordion.useRuleSetter` (follow-up
to #384's review). Applies to *any* read-modify-write pattern against a
store slice: settings, lobby prefs, accordion-open sections,
hand-local UI state that's been lifted. Selectors are still the right
choice for plain *reads* (rendered values); the live-read rule is
specifically about the write path.

## Orientation: use `matchMedia`, not `width > height`

Deriving `isLandscape` from `useWindowDimensions().width > height` on
web is a soft-keyboard hazard. Android Chrome shrinks
`window.innerHeight` when the soft keyboard opens, which can flip the
comparison mid-tap on phone-class viewports. Any subtree conditionally
rendered on that boolean unmounts — taking a focused `TextInput` (and
the keyboard) with it.

Use the shared `useIsLandscape` hook in
`apps/client/src/ui/useOrientation.ts` instead, which reads
`matchMedia('(orientation: landscape)')` on web and falls back to
`width > height` on native (where `useWindowDimensions` reflects the
stable layout viewport and matchMedia isn't available). PR #389 hit
this in `MobileLobby` (the home lobby) and the follow-up extended it
to `LobbyAccordion` (the in-match waiting room). The same rule applies
to any *other* dimension-derived boolean that gates which subtree
mounts — phone-vs-tablet width gates can flip the same way if the
short edge is near the breakpoint and the keyboard opens.

## Animation primitives

- The `FlipBag` context (`apps/client/src/ui/FlipBag.tsx`) does most of
  the heavy lifting for tile movement (wall → hand on draw, discard →
  meld on claim, between-hand re-deal). Wrap a tile in `<FlipView
  flipId="...">` and the context records its rect on layout, then
  springs from the previous rect on the next layout pass — layoutId-
  style FLIP without a `framer-motion` / `react-native-reanimated`
  dependency (both stripped in the Expo migration). Don't reach for
  absolute positioning + manual interpolation unless `FlipView` can't
  express the motion.
- Pulses / halos use scale + opacity overlays (transform/opacity only, no
  box-shadow keyframes) so the compositor can run them without per-frame
  paint. See `WallEdge.tsx`'s next-draw halo (`Animated.loop` with
  scale + opacity) for the canonical pattern.
- The `useGame.shuffling` flag flips `Tile.tsx` to a slower spring during
  the between-hand dispense — don't shorten the spring, that's a deliberate
  readability choice.

## Tests + e2e are load-bearing for `data-testid`s

- `data-testid="own-hand-tile"` on the user's hand tiles and
  `data-testid="wall-draw-next"` on the pulsing draw cue are exercised by
  `apps/client/e2e/solo-match.spec.ts`. Refactors that change Hand or Wall
  must keep these testIds on the live click-target.
- `pnpm test` covers the engine + server unit tests; the server tests in
  particular guard the snapshot/restore round-trip, the host-only action
  gate, and the spectator viewer count.

## Three.js render layer (`apps/client/src/three/`)

ARCHITECTURE.md is the contract: folder-per-subsystem, perf budget,
CC0-only asset policy, verifier rules. Operational notes:

- **Renderer switch**: `resolveRenderer(settings.renderer)` in
  `src/three/renderer.ts`. Precedence: `__MAHJONG_TEST_RENDERER__`
  global > `?renderer=classic|3d` query > persisted setting > auto
  (3D on web with WebGL2, classic elsewhere / native). The legacy
  Playwright suite pins `classic` through `e2e/_helpers.ts` (the
  fixture also wraps `browser.newContext`, so every spec must import
  `test` from `./_helpers`, never from `@playwright/test`). New 3D specs
  are `e2e/three-*.spec.ts` and pin `'3d'` themselves.
- **Platform split**: consumers import from `src/three/entry` (native
  stub exporting `null`s) — Metro picks `entry.web.tsx` on web. Always
  null-check the exports. Nothing under `src/three/` other than
  `renderer.ts` and `entry.tsx` may be imported by universal code.
- **Evidence rule**: no visual claim without a screenshot from
  `node scripts/shot.mjs --state <name> --viewport
  phone|phone-tall|phone-small|phone-landscape|desktop --renderer
  3d|classic [--dist dist-x] [--label run]` (writes PNG + JSON with
  console/page errors, `__MAHJONG_PERF__`, budget verdict to
  `apps/client/shots/<label>/`). Recipes live in
  `scripts/shot-states.mjs`; add a recipe rather than hand-driving. The
  tool needs an export first (`npx expo export --platform web
  [--output-dir dist-x]`, ~35 s). It runs on SwiftShader — gate on draw
  calls / triangles / programs / JS frame time, not fps.
- **Phone viewports are a phone *in a browser***: `phone` is 412×700
  CSS px at dpr 2.625 (1080×1830 device px once Chrome's address bar
  and the system bars take their share of a 1080×2400 panel). The
  full-screen 412×915 (installed PWA / fullscreen) is `phone-tall`,
  and `phone-small` is a 360×640 budget phone. Every portrait match
  state must compose at `phone` and `phone-small`, not only at the tall
  size (round-5 feedback: the tall-only tuning zoomed the table out into
  a 280 px square with void columns on a real phone). A recipe pinned
  to `viewport: 'phone'` shoots at whichever portrait phone size the
  CLI asks for. Portrait maths that must give ground on short phones
  goes through `cameraPresets.portraitMetrics(height)` /
  `portraitFitFor` rather than per-size constants. Short-phone rules
  that follow from the pitched camera: portrait toasts take the seat
  strip's row (`data-toast-slot="strip"`, badges step aside) because
  the far rail sits ~10 px under the strip; the tutorial's opening-dice
  step parks the held hand below the viewport (`heldHandParkedBaseline`,
  `data-hand-parked`) so the dense dice card and the lesson card share
  the band, centred as a pair (`portraitDiceLessonTop`) rather than
  pinned under the strip; the portrait lobby is one scrolling panel
  over a 56 px felt band (`LOBBY_PORTRAIT_FELT_BAND`) with Start /
  Leave pinned under it, and its Rules card collapses to the summary
  row only when the expanded card would overflow the capped panel
  (`usePortraitRulesCollapse` — the tall phone keeps it expanded);
  the 360×640 result card pins to the top (`resultPanelPinsTop`) so the
  scoring caption docks below the winning hand. Timing-dependent HUD
  (a bot's claim toast) gets its own store-driven recipe
  (`match-claim-toast-flash` fires `flashClaimAnnouncement` through
  `__MAHJONG_TEST_GET_STATE__`) instead of hoping `match-claim` catches
  one. Shoot with one `shot.mjs` process at a time — three in parallel on SwiftShader once
  produced a frame with the camera still easing in from the lobby.
- **The portrait river zoom is a plan view of the four rivers, not a
  dolly of the resting camera** (`cameraPresets.riverZoomFrameFor`,
  84°): the far river's last row pins 4 px under the zoom header, the
  frame is the tight river block (`ZOOM_X_HALF_MIN`) where the block
  then clears the held hand (the tall phone) and backs off until it
  does on short phones — a 412×700 band cannot hold a plan-view block
  and a wall, so the zoom lays out no wall and no side seat
  (`LayoutOptions.hideWalls` / `hideSideSeats`) and the tray's turn row
  carries the `wall-draw-next` pill (`hud/HandRail.DrawPill`). Do not
  re-introduce a near-wall-in-frame constraint: at 84° it caps the
  short phone at 1.2× (round-FB4).
- **Table pointer parallax is a drift, not a follow**
  (`cameraPresets.TABLE_PARALLAX`: 0.08 units, 0.5 s half-life via
  `CameraRig.parallaxHalfLife`) on the match table and the replay.
  Round-FB4 desktop feedback called the old 0.45 / 0.15 s sway
  nauseating. The rig's default stays 0.35 / 0.15 for the menu; the
  lobby backdrop keeps its own gentler value. The gold turn cue under
  the standing hand is a contact glow at the tiles' feet
  (`TableScene` `CUE_HALO_HAND_FRONT` / `CUE_HALO_BAND_OPACITY`), never
  a bar on the felt behind the row.
- **Sandboxed containers**: `pnpm install --offline --frozen-lockfile`
  works in a fresh worktree (store is warm). Point
  `PW_CHROMIUM_PATH=/opt/pw-browsers/chromium` at the pre-installed
  browser for `pnpm e2e`; `shot.mjs` auto-detects it.
- **Critic scoreboard**: `docs/STATUS.json` — every gauntlet round
  writes scores + ranked open issues there; the next `/loop` iteration
  resumes from the lowest-scoring subsystem.
- **Page chrome keys on the surface, not the renderer**: `usePageChrome()`
  in `app/_layout.tsx` (`pageSurface(pathname)` + `pageChrome(surface,
  renderer)` in `src/ui/menu/palette.ts`) paints html/body/theme-color,
  the hydration shell and the Stack `contentStyle`. The lobby and
  `/replays*` are the void under both renderers; only the classic
  `/match` is cream. Android Chrome keeps the layout box at the *small*
  viewport when the URL bar retracts, so whatever is behind the app root
  shows in the exposed strip — the static default in `+html.tsx` is the
  void too, and `LobbyBackdrop` overshoots the root by 160 px. Round-FB2
  feedback ("white band at the bottom when scrolling") was this. Sticky
  bars over the scrolling hero rack need a ≥ 0.94-alpha void fill, not
  quiet glass — blur over ivory tiles reads khaki.
- **The menu hero scrolls as DOM, not as a re-aimed camera**: the rack +
  dice render into a canvas mounted *inside* `HeroBandSlot` (ScrollView
  content, `data-testid="menu-3d-hero"`), so the compositor moves them
  with the title; only the drift field stays in the fixed backdrop
  canvas (`menu-3d`). Round-3 phone feedback ("background tiles jitter
  when scrolling") was the previous design re-applying `setViewOffset`
  from scroll events a frame behind the compositor. The hero scene
  (`three/menu/HeroScene.ts`) fits the rack in a *viewport-sized* frame
  with the band at the origin and renders the band's sub-rectangle
  (`setViewOffset(frameW, frameH, ox, oy, bandW, bandH)`, camera aspect =
  viewport) — pixel-identical to the single-canvas rack, and the fit is
  translation-invariant (layout test) so scroll position never enters.
  Never subscribe the hero to `heroBand` / scroll; a re-fit is a resize
  only (`__MAHJONG_MENU_DEBUG__.viewOffsetApplies` must stay flat across
  a scroll — `three-menu.spec.ts` asserts it). `__MAHJONG_PERF__` is the
  *sum* over live canvases (`core/perf.ts`), so a budget still judges the
  page. A scene frame that writes poses must return `live` even when its
  last tween just finished, or the final frame never renders (the hero
  was captured "settled" half-way through its drop-in on SwiftShader).
  Both menu frames are **keyed on the viewport width**: Android Chrome
  fires `resize` (innerHeight +56–100 px) as the URL bar retracts
  *mid-scroll*, so a height-only change with the same width re-fits
  nothing — the hero frame (`HeroScene.onWindowResize`), the drift fit
  (`DriftScene.resize` just extends the view offset over the taller
  canvas) and the portrait band height (`useStableViewportHeight`)
  all hold; a width change / band resize re-fits. `SceneHost` redraws
  **synchronously** after a real `setSize` (`Loop.renderNow`) — the
  re-allocated buffer is cleared, and waiting for the next rAF presents
  an empty canvas for a frame (round-4 "tiles flicker when scrolling").
  `__MAHJONG_MENU_DEBUG__.heroRelayouts` / `driftRelayouts` count re-fits
  for the spec. Menu parallax strengths live in `three/menu/parallax.ts`
  (40 % of the rig default, smoothed over 0.42 s) — never retune the
  `CameraRig` default for the menu's sake.
- **Anything that hugs a tile is scene geometry, not a DOM overlay**:
  the discard hint is a gold frame quad in `TableScene` (`hintFrame`)
  placed from the hinted tile's pool pose every `writePoses` — same
  quaternion, +Z offset of `TILE_D / 2 + HINT_GAP`, scaled with the
  tile — so it is aligned by construction on every camera and follows
  the tile through drags, re-sorts and the draw / discard springs (a
  DOM ring re-projected from the HUD side lagged the desktop camera).
  The hinted tile also rides `HINT_LIFT` on its up axis through the
  shared `lift` array. `HitTargets` keeps a zero-visual
  `data-testid="hand-tile-recommended"` span for the shared count
  assertion only. `TableScene.tileRect` is the projection of the whole
  tile box (top bevel + back edge included, then floored to 44 px for
  the tap target); `tileFaceRect` / `projectTileFaceRect` is the +Z
  printed face only — the debug snapshot's `hint.faceRect` and any DOM
  overlay that must still hug a face use it, and
  `three-table.spec.ts` asserts the frame's projected stroke
  (`hint.markerRect`) matches it. Do not inherit the classic shell's
  `bottom: 10` lift zone on 3D overlays.
- **Glass result card**: the top-right corner belongs to the 和 seal
  (`ResultVeil.WinStamp`); controls (save replay) ride inline in the
  action rows via `SaveReplayButton inline`.
- **Replay under 3D**: `src/three/replay/ReplayTable3D` mounts the
  match's `TableScene` for `frames[cursor].state` (`sync({ state, me,
  revealAll, snap })`) — the same pattern as `LobbyTableBackdrop`; the
  documented `replay/ → table/` import exception is in ARCHITECTURE.md.
  Recipes seed a deterministic record through
  `__MAHJONG_TEST_REPLAY_FIXTURE__` (`src/replay/fixture.ts`) and deep-
  link with `?frame=`. RN-web `nativeEvent` has no `locationX` — use
  `src/ui/replay/timeline.ts`'s `pressX` for any tap-to-seek surface.
- **Tile finish is satin, not lacquer** (`src/three/tiles/materials.ts`:
  body roughness 0.5, clearcoat 0.3 / 0.45). The steep phone camera
  looks at the held hand almost face-on, so a glossy body put the key
  light's specular lobe across the right-hand faces and greyed their
  ink (round-FB3 "tiles fade toward the right"). Moving the light only
  moves the wash; keep the finish and the e2e luminance guard in
  `three-table.spec.ts` (face spread ≤ 12, darkest-ink spread ≤ 28).
- **Walls are a yawed pinwheel** (`layout.WALL_STAGGER` + `WALL_YAW`,
  round-4 feedback): every 17-stack run is shifted 2.0 units along its
  own axis toward its owner's right and turned 2.5° about its centre
  with the overhanging end swinging *out* toward its owner's rail (same
  sense on all four), so from the user's seat the near wall overhangs
  on their right (`WALL_END` ≈ 10.76) and no wall lies parallel to its
  rail — like a real table. The sign is load-bearing: an overhang's tip
  stands in the next seat's row corridor, and swinging it out is what
  opens the along-row gap (`WALL_OVERHANG_INNER`; rows slide right to
  keep `ROW_OVERHANG_GAP` = 1.0 via `rowLeftLimit`, the user's row 0.6)
  and the 0.88 between the left wall's tip and a 14-tile hand. The yaw
  costs the rows around the wall their slack, so the portrait side rows
  (`SIDE_SEAT_OUT_PORTRAIT`), every preset's far row (`FAR_SEAT_OUT`)
  and the held hand's melds (`OWN_MELD_Z_HELD`) step out by 0.25–0.35;
  the in-swinging half clears the 1.36× river's third row by 0.03
  (`WALL_YAW_LIFT`). `wallSlotRefs` (break / dead / live bookkeeping) is
  untouched; only `wallSlotPosition` → `wallRunPoint` carries the
  stagger + yaw, so anything that hard-codes a wall *end* or face
  (lobby framing tests, HUD anchors near a corner, the river-interior
  rect) must read `WALL_END` / `WALL_OVERHANG_*` / `wallInnerFaceAt`
  rather than assume a straight ±8.74 run at z 8.12–9.48.
- **Dead wall = darker back shade only; own melds = plain aligned rows**
  (round-4 feedback). The 14 dead tiles are told apart by `aBackVariant`
  selecting `uDeadBack*` (`materials.deadBackColors`, same hue, darker)
  and nothing else — the gold inlay band that used to run along the
  stacks' inner edge read as "extra yellow stripes" on the walls, so it,
  its `aStackTop` attribute and `TileSlot.stackTop` are gone; do not
  bring back a per-tile marker. The user's standing melds
  (`layoutMeldStanding` / `placeStandingMelds`) sit on the hand's line
  with no claimed-tile step — under the 44° desktop camera a tile
  stepped toward the camera read as misplaced; only the flat opponents'
  melds keep the turned-tile provenance rule. The phone held hand splits
  rows from the hand *with the drawn slot reserved*
  (`heldRowSplit(total, hasDrawn)`): a row never exceeds
  `HELD_ROW_UNITS` (7 tiles incl. the drawn one) and the back row holds
  across a draw / discard — a 7-tile hand is 4 + 3 → 4 + 4, never one
  overflowing row of 8.
- **Coach-card body takes the room the placement has**
  (`src/ui/tutorial/bodyCap.ts`): cap = room − measured chrome, whole
  text when it fits, dense / tight frames on short phones, strips fill
  their band — but the hand and seat-strip keep-outs always win (a
  placement that intersects a tile is invalid; fall back to the strip
  or a shorter body). The card stays at opacity 0 until measurement,
  frame choice and hand-at-rest have settled, then reveals once
  (`revealed` seam; recipes wait on it) — never relayout after first
  paint.
