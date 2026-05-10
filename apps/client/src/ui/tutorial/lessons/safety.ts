import type { Lesson } from '../types';

/**
 * Defensive-play lesson — pedagogical, no engine-mechanics walkthrough.
 * Builds on the basics scaffold (same passive-bot mix, same dealer
 * setup) but skips the discard exercise; the user reads through a
 * series of captions about how to interpret the discard pile and
 * what the heuristic ranker's "discard hint" gives them.
 *
 * Steps land on a different target than basics (the shared discard
 * pool / bottom-seat pile via `shared-discards`) so the player's
 * eye gets pulled to the table centre rather than their hand. The
 * lesson reads the same on both shells: mobile renders one shared
 * pool, desktop wraps the user's own perimeter pile, but both
 * visually anchor "the discards".
 */
export const safetyLesson: Lesson = {
  id: 'safety',
  title: 'Reading the table',
  blurb: 'Defensive play: what the discard pile tells you about your opponents.',
  // Same seed as basics so the dealt hand is familiar; a player
  // running the lessons in sequence sees their tiles where they
  // expect.
  seed: 5,
  dealer: 0,
  botScripts: {},
  steps: [
    {
      id: 'intro',
      caption: {
        title: 'Reading the table',
        body: "You can learn a lot from what your opponents discard. If a player throws away a 5-bamboo, they probably aren't trying to build a bamboo run around it — that tile is now safe-ish to discard yourself.",
      },
      ctaLabel: 'Got it',
    },
    {
      id: 'discard',
      caption: {
        title: 'Take a turn',
        body: 'Tap any tile to discard. We’ll talk about what the discards mean once everyone’s played.',
      },
      // Anchor on the hand so the scrim doesn’t cover up the
      // tap-target. The next step pivots the halo onto the pool
      // once tiles start landing in it.
      targetId: 'own-hand',
      completedWhen: (state) => (state.discards[0]?.length ?? 0) >= 1,
    },
    {
      id: 'watch',
      caption: {
        title: 'Watch the discards',
        body: 'Each tile here is a small clue about what the bots are (and aren’t) collecting. Wait for the pile to fill in.',
      },
      targetId: 'shared-discards',
      // Auto-advance once the bots have had a chance to start
      // filling the pile — 4+ total tiles, the user plus one full
      // bot cycle.
      completedWhen: (state) => {
        const total =
          (state.discards[0]?.length ?? 0) +
          (state.discards[1]?.length ?? 0) +
          (state.discards[2]?.length ?? 0) +
          (state.discards[3]?.length ?? 0);
        return total >= 4;
      },
    },
    {
      id: 'hint',
      caption: {
        title: 'Tip: enable the discard hint',
        body: 'Settings → "Discard hint" highlights the tile our heuristic ranker would discard for you. Useful while you’re still learning which tiles are dead weight; turn it off once you want to think for yourself.',
      },
      ctaLabel: 'Got it',
    },
    {
      id: 'complete',
      caption: {
        title: 'Lesson complete!',
        body: "Defence isn't about specific rules — it's about paying attention. Keep an eye on what each opponent leaves alone, and you'll dodge a lot of cheap losses.",
      },
      ctaLabel: 'Done',
    },
  ],
};
