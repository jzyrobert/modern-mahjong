import type { Lesson } from '../types';

/**
 * Drawn-game lesson — teach what happens when the wall runs out
 * before any seat wins. The engine resolves to
 * `lastResult: { kind: 'draw', reason: 'wall-empty' }` (see
 * `packages/game-logic/src/actions.ts:226`); the dealer stays put
 * and the hand re-deals. The lesson runs short: intro caption →
 * one user discard → 3 bot turns of natural play (the third bot's
 * draw runs into the empty-wall branch) → drawn-game resolution.
 *
 * Approach (per plan U7):
 * - Reuse `basics`'s seed `5` (the same fixed seed `solo-match.spec.ts`
 *   uses) — `__MAHJONG_TUTORIAL_FORCE_PASS__` is on for the duration
 *   of the lesson, so bots pass every claim window and nobody snipes
 *   a hu off the user's discard.
 * - Truncate the wall to 2 tiles via `prepareState` so the wall
 *   exhausts after exactly two bot draws. The third bot's draw hits
 *   the `wall.length === 0` check in `drawTile` and resolves the
 *   hand. A natural drain at the production wall length is ~17
 *   minutes of bot turns, which is not a lesson-shaped experience.
 *   Wall depth `2` is chosen specifically so the user never gets a
 *   second turn — turn order after seat 0's first discard is
 *   1 → 2 → 3 → 0 → ..., and with wall=2 the third bot (seat 3) is
 *   the one that runs into the empty wall. Anything bigger and the
 *   user lands a mid-lesson turn they'd have to act on (the
 *   tutorial `turnTimeoutMs: 0` disables the auto-discard timer).
 *   The new `__MAHJONG_TEST_WALL_DEPTH__` global (added in the
 *   previous commit) layers on top so Playwright specs can pin the
 *   same depth deterministically — but the lesson itself owns its
 *   production behaviour through this hook rather than relying on a
 *   global side effect at module load.
 * - Step list: intro → "discard to start" (auto-advance on first
 *   user discard) → "watch the wall run out" (anchored on `wall-draw`,
 *   auto-advance when `state.lastResult?.kind === 'draw'`) →
 *   "lesson complete".
 *
 * Why `prepareState` carries production behaviour and the global is
 * test-side: the alternative (a module-level side-effect that sets
 * `globalThis.__MAHJONG_TEST_WALL_DEPTH__`) would fire on import for
 * every lesson registry consumer, including ones that never enter the
 * drawn-game lesson. `prepareState` is the existing lesson lifecycle
 * hook (already used by `robbing-kong.ts`) and keeps the wall mutation
 * scoped to lesson activation. The global hatch still applies AFTER
 * `prepareState` — see `applyTestWallDepth` in `solo-transport.ts` —
 * so a Playwright spec can override the production depth if it wants
 * a different value.
 *
 * Why no further bot scripting: the tutorial-active flow already
 * forces all bots to `passive` and toggles `__MAHJONG_TUTORIAL_FORCE_PASS__`,
 * so passing on every claim window is the default. Passive bots
 * discard their drawn tile (`passiveBot.pickDiscard`) — none of those
 * discards is engineered to land in the user's hand, and the seed-5
 * deal at seat 0 has no two-tile-from-winning shape that an unlucky
 * bot draw could accidentally complete. The lesson resolves to draw
 * deterministically.
 */
export const drawnGameLesson: Lesson = {
  id: 'drawn-game',
  title: 'Drawn game',
  blurb: "What happens when the wall runs out and nobody's won yet.",
  seed: 5,
  dealer: 0,
  botScripts: {},
  // Truncate the wall to 2 tiles. The dealer-14 deal is intact;
  // post-first-discard, bot 1 draws (wall→1), bot 2 draws (wall→0),
  // bot 3 attempts a draw, hits the empty-wall branch in `drawTile`
  // (`actions.ts:226-229`), and the hand resolves to
  // `{ kind: 'draw', reason: 'wall-empty' }`. The user never gets a
  // second turn — by design (see the "Why wall=2" note above).
  prepareState: (state) => ({ ...state, wall: state.wall.slice(-2) }),
  steps: [
    {
      id: 'intro',
      caption: {
        title: 'Drawn games',
        body: 'Most hands end with a winner — but if the wall runs out before anyone wins, the hand ends in a draw. Nobody pays anyone, the dealer stays put, and the next hand starts with the same dealer rolling the dice again.',
      },
      ctaLabel: 'Got it',
    },
    {
      id: 'discard',
      caption: {
        title: 'Discard to start',
        body: "Tap any tile to throw it away. We've pinned the wall to just a few tiles for this lesson, so you won't be drawing again — your job here is to start the round so we can watch it run out together.",
      },
      targetId: 'own-hand',
      completedWhen: (state) => (state.discards[0]?.length ?? 0) >= 1,
    },
    {
      id: 'watch',
      caption: {
        title: 'Watch the wall run out',
        body: 'The wall is almost empty. Watch the bots play out the last few tiles — if nobody declares hu before the last tile is drawn, the hand ends in a draw.',
      },
      // Anchor on the wall-draw cue so the highlight halo points the
      // user at the live wall. `WallEdge.tsx` wraps the pulsing cue
      // in a `<TutorialTarget id="wall-draw">` so the reticle can
      // resolve a rect even though it's the bots draining the wall,
      // not the user.
      targetId: 'wall-draw',
      // Auto-advance when the engine resolves to a drawn game. The
      // shape comes from `actions.ts:226-229`: when `drawTile` is
      // called with `state.wall.length === 0`, the reducer flips to
      // `phase: 'resolved'` with `lastResult: { kind: 'draw', reason:
      // 'wall-empty' }`. We gate on `phase: 'resolved'` too so a
      // future engine change that surfaced `lastResult` earlier in
      // the cycle (or set it for non-terminal reasons) wouldn't
      // false-fire the predicate.
      completedWhen: (state) => state.phase === 'resolved' && state.lastResult?.kind === 'draw',
    },
    {
      id: 'complete',
      caption: {
        title: 'Lesson complete!',
        body: "That's a drawn game. Nobody scored, but nobody lost ground either — the dealer keeps the chair for the next hand, which gives them a small structural edge (every successive deal as dealer is worth more in scoring). In a real four-player match drawn games are fairly common — usually one every few hands when the wait shapes don't line up.",
      },
      ctaLabel: 'Done',
    },
  ],
};
