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
   treat them as a hint, not a source of truth, and always re-check via
   `mcp__github__pull_request_read` with `method: 'get_check_runs'`.
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
locally and ~2m on CI (sharded ×4 after #348). Don't burn a CI cycle
on something a local run would have caught. To iterate on one spec:

```sh
pnpm --filter @mahjong/client exec playwright test e2e/solo-match.spec.ts
```

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

## PR screenshots — host on a sidecar branch, never on `main`

When a PR needs before/after screenshots (e.g. UI / layout changes),
**do not** commit the PNGs to the PR branch — they'd land on `main` at
squash-merge time and bloat the repo. Instead:

1. Create a sidecar branch off `main` named
   `claude/<pr-slug>-screenshots`, commit the PNGs there under
   `docs/screenshots/<topic>/`, and push it.
2. Reference the images in the PR body using absolute
   `https://github.com/jzyrobert/modern-mahjong/raw/<sidecar-branch>/docs/screenshots/<topic>/<file>.png`
   URLs so they render in the PR description without the screenshots
   appearing in the PR's diff.
3. After the PR squash-merges, delete the sidecar branch (`git push
   origin --delete claude/<pr-slug>-screenshots`). The image links in
   the merged PR body will 404, but that's fine — reviewers only need
   them while the PR is open.

The screenshot Playwright spec (`apps/client/e2e/replay-screenshots.spec.ts`
and similar) writes to `apps/client/e2e-output/` which is gitignored,
so the PNGs only exist on the sidecar branch until cleanup.

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
