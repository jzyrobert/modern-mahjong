import type { Tile } from '@mahjong/game-logic';
import { sameFace, shanten, waitTiles } from '@mahjong/game-logic';
import type { Lesson, LessonBotScripts } from '../types';

/**
 * Ron lesson — winning off an opponent's discard. The user is dealt
 * the rigged shanten-1 hand at seed=16355: sorted, it reads
 *
 *   1m 4m 5m 6m 2p 3p 4p 5p 5p 5p 4s 5s 6s HW
 *
 * The lone HW (West wind) at the end of the hand is the obvious
 * discard — drop it and seat 0 lands at shanten 0 waiting on **1m**.
 * Seat 1 (the immediate next player) holds 1m in their opening hand.
 * The lesson's `setupAfterFirstDiscard` hook reads the user's actual
 * remaining hand, derives the wait, finds a bot that holds it, and
 * writes that bot's first scripted discard via
 * `globalThis.__MAHJONG_TEST_BOT_SCRIPTS__` — identical mechanism to
 * `claims.ts`. This means whichever winning discard the user picks
 * (HW → wait 1m, or 1m → wait HW), the next bot turn surfaces the
 * wait tile and the user's `<ClaimBar>` shows the gold "Win" button.
 *
 * If the user picks a tile that breaks tenpai entirely, the lesson
 * hangs on the "watch the bots" step (same graceful-fail model as
 * `claims.ts`). The discard caption nudges the user toward the
 * honour tile at the end of their hand.
 *
 * `faanMin: 0` is pinned by `joinSoloTutorial` so a faan-0 win is
 * legal — the lesson teaches the *shape* of ron, not scoring.
 */
export const ronLesson: Lesson = {
  id: 'ron',
  title: 'Winning off a discard',
  blurb: "Claim 'hu' when an opponent throws away the tile your hand is waiting on.",
  seed: 16355,
  dealer: 0,
  // The scripted bot's discard is decided at runtime in
  // `setupAfterFirstDiscard` once we can see the user's remaining
  // 13-tile hand and pick the wait tile they actually landed on.
  botScripts: {},
  setupAfterFirstDiscard: (state) => {
    const userHand = state.hands[0];
    if (shanten({ hand: userHand, exposedMelds: 0, allowSpecial: false }) !== 0) {
      // User discarded something that didn't leave them tenpai — the
      // lesson can't engineer a ron from here. Lesson hangs on the
      // watch step; user can back out and replay.
      return;
    }
    const waits = waitTiles({ hand: userHand, exposedMelds: 0, allowSpecial: false });
    if (waits.length === 0) return;
    // Walk seats 1 → 2 → 3 looking for the first bot that holds a
    // wait tile. Earlier seats fire sooner, so the lesson resolves
    // faster when seat 1 is the holder.
    let pick: { seat: 1 | 2 | 3; tile: Tile } | null = null;
    for (const seat of [1, 2, 3] as const) {
      for (const w of waits) {
        // The wait tile shouldn't be a 5th copy of something the user
        // already holds 4 of — `waitTiles` already filters that out,
        // so this is belt-and-braces.
        let inHand = 0;
        for (const h of userHand) if (sameFace(h, w)) inHand++;
        if (inHand >= 4) continue;
        if (state.hands[seat].some((t) => sameFace(t, w))) {
          pick = { seat, tile: w };
          break;
        }
      }
      if (pick) break;
    }
    if (!pick) return;
    const w = globalThis as { __MAHJONG_TEST_BOT_SCRIPTS__?: LessonBotScripts };
    const scripts: LessonBotScripts = { ...(w.__MAHJONG_TEST_BOT_SCRIPTS__ ?? {}) };
    scripts[pick.seat] = { ...(scripts[pick.seat] ?? {}), discards: [pick.tile] };
    w.__MAHJONG_TEST_BOT_SCRIPTS__ = scripts;
  },
  steps: [
    {
      id: 'intro',
      caption: {
        title: 'Winning off a discard',
        body: "You can win by claiming an opponent's discard — it's called 'ron' (or just 'hu' for any win). When an opponent throws away the exact tile your hand is waiting on, the claim bar lights up with a gold Win button.",
      },
      ctaLabel: 'Got it',
    },
    {
      id: 'discard',
      caption: {
        title: 'Set up your wait',
        body: 'Your hand is one tile away from winning. Tap the honour tile at the end of your hand (West wind) to discard it — that leaves you waiting on a single tile a bot is about to throw.',
      },
      targetId: 'own-hand',
      completedWhen: (state) => (state.discards[0]?.length ?? 0) >= 1,
    },
    {
      id: 'watch',
      caption: {
        title: 'Watch the bots play',
        body: "The other seats take their turns. We've rigged the next bot's discard to be your wait tile — when it lands, the claim bar pops up with the Win option.",
      },
      // Anchor on the shared discard pool so the user sees tiles
      // landing in the centre while the bots play. `claim-bar`
      // doesn't mount until the engine actually parks at the
      // right `awaitingClaims` state, so previewing it here would
      // render dead-centre with no halo.
      targetId: 'shared-discards',
      // Advance only when the engine parks at a claim window with a
      // discard that came from a bot (not the user themselves) and
      // is actually a tile the user could ron on — checked by
      // `waitTiles` matching `lastDiscard.tile`. Intermediate
      // `awaitingClaims` states from bot discards the user can't win
      // on (e.g. a passive bot throwing a tile that isn't the wait)
      // don't qualify; passive bots resolve them through the
      // engine's pre-filled passes anyway.
      completedWhen: (state) => {
        if (state.phase !== 'awaitingClaims') return false;
        const ld = state.lastDiscard;
        if (!ld || ld.from === 0) return false;
        const hand = state.hands[0];
        return waitTiles({ hand, exposedMelds: 0, allowSpecial: false }).some((w) =>
          sameFace(w, ld.tile),
        );
      },
    },
    {
      id: 'claim',
      caption: {
        title: 'Claim the win!',
        body: 'Tap "Win" — the gold button — to declare ron on the discarded tile.',
      },
      targetId: 'claim-bar',
      // Auto-advance once the hand resolves with seat 0 as the winner
      // off a non-self-draw — i.e. a ron. The win lesson uses the
      // same `lastResult.kind === 'win' && winner === 0` predicate;
      // the extra `selfDraw === false` clause makes this strictly a
      // ron rather than a tsumo so the caption advance can't be
      // tripped by some other lesson code path.
      completedWhen: (state) =>
        state.lastResult?.kind === 'win' &&
        state.lastResult.winner === 0 &&
        state.lastResult.selfDraw === false,
    },
    {
      id: 'complete',
      caption: {
        title: 'Lesson complete!',
        body: "That's ron. Anytime your hand is at tenpai (one tile away from winning) and an opponent throws your wait tile, the claim bar offers Win — same flow as chi or peng, but with the gold button on top.",
      },
      ctaLabel: 'Done',
    },
  ],
};
