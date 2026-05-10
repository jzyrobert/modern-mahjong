import type { Lesson } from '../types';

/**
 * Winning lesson — the user is dealt a hand that's already
 * complete (4 melds + a pair) at seed=174502 / dealer=0. They
 * declare tsumo immediately, see the win celebration, and the
 * lesson ends.
 *
 * The dealt hand at this seed:
 *   3m 4s 2m 6s 8s 7s 1m 5s 9m 4m 5m 9m 3s 6m
 *   = man: 1m-2m-3m, 4m-5m-6m, 9m-9m
 *   + sou: 3s-4s-5s, 6s-7s-8s
 *   = 4 melds + 1 pair → standard winning shape.
 *
 * Tutorials run with `faanMin: 0` (set in `joinSoloTutorial`)
 * so this faan-0 win is legal. In a real ruleset (faanMin: 3) the
 * engine would reject it, but the lesson's purpose is to show the
 * shape of "winning a hand", not to model HK scoring constraints.
 */
export const winLesson: Lesson = {
  id: 'win',
  title: 'Winning a hand',
  blurb: 'Declare tsumo on a pre-built winning deal.',
  seed: 174502,
  dealer: 0,
  // No bot scripts needed — the user wins on their first action
  // (tsumo) before any bot turn fires.
  botScripts: {},
  steps: [
    {
      id: 'intro',
      caption: {
        title: 'Winning a hand',
        body: "You win mahjong by completing 4 sets and a pair, totalling 14 tiles. A 'set' is either three of a kind (peng) or three consecutive numbers in the same suit (chi).",
      },
      ctaLabel: 'Got it',
    },
    {
      id: 'declare',
      caption: {
        title: "You're already winning!",
        body: 'This deal is rigged — your hand is one of the rare 14-tile starts that\'s complete out of the box. Tap the "Declare win (tsumo)" button to call your win.',
      },
      targetId: 'tsumo-button',
      // Auto-advance once the hand resolves with seat 0 as winner.
      // `lastResult` is populated by `declareWin`; phase flips to
      // `'resolved'` and stays there until the next hand starts.
      completedWhen: (state) => state.lastResult?.kind === 'win' && state.lastResult.winner === 0,
    },
    {
      id: 'complete',
      caption: {
        title: 'Lesson complete!',
        body: "That's a win. In a real match the score panel would tally the faan and shoot the points around — we lowered the faan minimum here so any basic winning shape counted. Play more hands, build better sets, and the points stack up fast.",
      },
      ctaLabel: 'Done',
    },
  ],
};
