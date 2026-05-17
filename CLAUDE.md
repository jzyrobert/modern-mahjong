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
