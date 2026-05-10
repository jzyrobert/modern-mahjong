import type { Lesson } from '../types';

/**
 * Concealed-gang lesson — the user is dealt a hand at seed=63 with
 * four 5-sou tiles, lets them declare a hidden gang on their first
 * action. The "Declare gang" button only renders when the user
 * holds 4 of any face (computed in `Match.tsx` as
 * `concealedGangTile`); at this seed the dealer's 14-tile deal
 * satisfies it from the start.
 *
 * The dealt hand at this seed:
 *   6p 4m 6m 5p 9p E 5s 5s 3m 5s 2s 5s 6m N
 *   = four 5-sou tiles (the gang target) + 10 other tiles.
 *
 * Declaring the gang moves the four 5-sou into a concealed-meld
 * group, the user draws a replacement tile from the back of the
 * wall (`gangReplacementCount` increments), and the lesson
 * advances. The user is left in `phase: 'turn'` with a fresh
 * 11-tile hand and a replacement draw, free to keep playing —
 * but the lesson ends after the gang is recorded.
 */
export const hiddenGangLesson: Lesson = {
  id: 'hidden-gang',
  title: 'Concealed gang',
  blurb: 'Lock four-of-a-kind from your hand into a meld and draw a replacement.',
  seed: 63,
  dealer: 0,
  botScripts: {},
  steps: [
    {
      id: 'intro',
      caption: {
        title: 'Concealed gang',
        body: "When you have all four copies of a tile in your concealed hand, you can call a 'gang' — locking those four tiles into a meld and drawing a replacement tile from the back of the wall. It's worth more than a triplet (peng), but you can only do it on your turn after you've drawn.",
      },
      ctaLabel: 'Got it',
    },
    {
      id: 'declare',
      caption: {
        title: "You've got four 5-bamboos!",
        body: 'Your hand was rigged with all four 5-bamboo tiles. Tap "Declare gang" to lock them as a concealed meld.',
      },
      targetId: 'tsumo-button',
      // Auto-advance once a meld lands in the user's melds slot —
      // a concealed gang appends one entry of kind 'gang-concealed'.
      // Using `length >= 1` keeps the predicate stable against
      // future meld-shape refactors.
      completedWhen: (state) => state.melds[0].length >= 1,
    },
    {
      id: 'complete',
      caption: {
        title: 'Lesson complete!',
        body: "Done — your four 5-bamboos are now a meld, and the engine drew you a fresh replacement tile from the back of the wall. In a real match you'd keep playing toward a winning hand from here. Promoted gangs (adding a fourth tile to an existing peng) work similarly, with one extra wrinkle: opponents get a chance to 'rob' the gang if they were waiting on that tile.",
      },
      ctaLabel: 'Done',
    },
  ],
};
