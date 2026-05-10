import type { Lesson } from '../types';

/**
 * The first lesson — a one-hand walkthrough that teaches the core
 * loop: see your hand, pick a tile to discard, watch the bots play,
 * land on a result. Three passive bots (forced via the solo
 * transport's `tutorial` option) keep the round predictable: nobody
 * claims, nobody calls hu off the user's discard, and the hand
 * eventually resolves to either a bot self-draw or a drawn game.
 *
 * Seed `5` is the same fixed value the rest of the e2e suite uses
 * (`__MAHJONG_TEST_SEED__ = 5` in `solo-match.spec.ts`); with
 * `dealer: 0` baked into `startHand`, seat 0 always opens with 14
 * tiles, so the "tap any tile to discard" step always has something
 * to anchor against.
 */
export const basicsLesson: Lesson = {
  id: 'basics',
  title: 'Basics: a guided hand',
  blurb: 'The core loop: see your hand, discard, watch the round play out.',
  seed: 5,
  dealer: 0,
  // Basics is the only lesson that surfaces the opening dice
  // ceremony — it's part of teaching what a hand actually starts
  // with. Other lessons suppress the modal so it doesn't stack on
  // top of the welcome caption.
  showOpeningRolls: true,
  // Bots are forced to `passive` by the solo transport when a
  // tutorial is active, so per-seat scripts aren't needed here.
  botScripts: {},
  steps: [
    {
      id: 'dice',
      caption: {
        title: 'Opening dice',
        body: "Each hand starts with a roll: East player rolls three dice, and the result picks who deals this round. You'll see those dice now — they pick a seat to receive 14 tiles instead of 13.",
      },
      ctaLabel: 'Got it',
    },
    {
      id: 'welcome',
      caption: {
        title: 'Welcome to mahjong',
        body: "We'll play one hand together. You're the dealer in seat 0; three bots play the other seats. Tap Got it to begin.",
      },
      ctaLabel: 'Got it',
    },
    {
      id: 'your-hand',
      caption: {
        title: 'These are your 14 tiles',
        body: 'Mahjong hands have 13 tiles in steady-state; the dealer opens with 14 and discards one to start the round. Tap Got it once you can see your hand.',
      },
      targetId: 'own-hand',
      ctaLabel: 'Got it',
    },
    {
      id: 'first-discard',
      caption: {
        title: 'Pick a tile to discard',
        body: "Tap any tile in your hand. Don't worry about strategy yet — we'll get to that.",
      },
      targetId: 'own-hand',
      // Auto-advance the moment the user has discarded once.
      completedWhen: (state) => (state.discards[0]?.length ?? 0) >= 1,
    },
    {
      id: 'watch-bots',
      caption: {
        title: 'Now watch the bots',
        body: 'The other three seats take their turns in order, drawing and discarding just like you did. Their discards land in this pool — watch it fill up as the round goes round.',
      },
      // Anchor on the shared discard pool so the caption docks at
      // the top of the screen and the user can actually see tiles
      // landing in the highlighted area. Without a target the
      // caption centres mid-screen and covers the very thing the
      // step is asking the user to look at.
      targetId: 'shared-discards',
      // Wait for each bot seat (1, 2, 3) to have discarded at least
      // once. We don't run all the way to `phase === 'resolved'`
      // because once the user's second turn comes around the engine
      // would block on their input — auto-discarding the user is
      // governed by `turnTimeoutMs` (20s default), which would stall
      // the lesson UX. One bot cycle is enough to demonstrate the
      // round's flow without holding the user hostage.
      completedWhen: (state) =>
        (state.discards[1]?.length ?? 0) >= 1 &&
        (state.discards[2]?.length ?? 0) >= 1 &&
        (state.discards[3]?.length ?? 0) >= 1,
    },
    {
      id: 'complete',
      caption: {
        title: 'Lesson complete!',
        body: "That's the core loop. From here you can play full matches against bots in 'Practice', or jump online to play with friends. Tap Done to wrap up.",
      },
      ctaLabel: 'Done',
    },
  ],
};
