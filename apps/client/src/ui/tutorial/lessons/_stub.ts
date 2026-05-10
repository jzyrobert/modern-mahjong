import type { Lesson } from '../types';

/**
 * Two-step stub lesson. Lets the framework PR exercise the registry,
 * overlay, controller, and step advancement without committing to a
 * full lesson script. The real `basics` lesson lands in the follow-up
 * PR; this stub stays available so future framework changes can be
 * verified in isolation.
 *
 * Step 1 is purely informational (no `completedWhen`, advances on
 * "Got it"); step 2 anchors a coach-mark on the player's hand and
 * waits for the user to discard any tile (engine `discards[seat 0]`
 * grows by one).
 */
export const stubLesson: Lesson = {
  id: '_stub',
  title: 'Framework smoke test',
  // Arbitrary fixed seed — picking a real number for determinism so
  // any future smoke test can rely on the wall being identical.
  seed: 12345,
  dealer: 0,
  botScripts: {},
  steps: [
    {
      id: 'intro',
      caption: {
        title: 'Tutorial framework',
        body: 'This is a smoke-test lesson. Tap "Got it" to advance to the next step.',
      },
      ctaLabel: 'Got it',
    },
    {
      id: 'discard',
      caption: {
        title: 'Try a discard',
        body: 'Tap any tile in your hand to discard it. The lesson advances when you do.',
      },
      targetId: 'own-hand',
      completedWhen: (state) => state.discards[0]?.length === 1,
    },
  ],
};
