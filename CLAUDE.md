# Project notes for Claude

Operational + architectural decisions worth carrying across sessions. Update
this file (don't dump notes into PR descriptions) so the next session can pick
up the rules without re-deriving them.

## Branching policy

**One PR = one new branch off `main`.**

Do NOT reuse a long-lived feature branch and force-push for each PR. After
a PR merges, branch off `main` again for the next chunk:

```sh
git fetch origin main
git checkout -b claude/<short-slug> origin/main
# ...do the work, commit, push, open PR. Auto-merge takes it from here...
```

This keeps the repo's branch history clean and avoids force-pushes that
rewrite history other tools may have linked to.

If a session-startup instruction names a specific branch, prefer the naming
convention from that instruction but still create a fresh branch per PR
rather than reusing the named one across multiple PRs.

## PR workflow

1. Run the full check pipeline locally before pushing: `pnpm -r typecheck`,
   `pnpm lint`, `pnpm test`, and where relevant `pnpm --filter @mahjong/client
   e2e` + a build. Pushing red-on-CI burns a CI cycle for nothing.
2. Open the PR and stop. **Auto-merge is enabled on this repo**, so the PR
   will squash-merge itself once CI passes — do NOT poll CI or call
   `mcp__github__merge_pull_request` yourself. If a webhook reports a CI
   failure, investigate and push a fix; otherwise treat opening the PR as
   the end of the chunk and move on to the next task.
3. After merge (signalled by the `merged` webhook event), sync `main`
   (`git fetch origin main && git reset --hard origin/main` is fine on the
   working branch since it's just been incorporated) and branch off again
   for the next PR.
4. Squash-merge is configured as the auto-merge strategy. The repo's
   history reads cleanest with one commit per PR; the title format is
   `<change summary> (#NN)` (the GitHub default).

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
  `@capacitor/preferences` + localStorage mirror).
- **CSS-var skinning**: per-skin overrides (felt, tile-back) are applied as
  CSS vars on the `Match` container. Components like `Tile.tsx` and
  `Table.tsx` read `var(--token, fallback)` so they render correctly outside
  a Match too (e.g. inside `SettingsPanel`'s tile reference).

## Animation primitives

- `framer-motion`'s `layoutId` does most of the heavy lifting for tile
  movement (wall → hand on draw, discard → meld on claim, between-hand
  re-deal). Don't reach for absolute positioning + manual interpolation
  unless layoutId can't express the motion.
- Pulses / halos use scale + opacity overlays (transform/opacity only, no
  box-shadow keyframes) so the compositor can run them without per-frame
  paint. See `Wall.tsx`'s `PULSE_HALO_ANIMATE` for the canonical pattern.
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
