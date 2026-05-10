import type { Lesson } from '../types';

/**
 * Claims lesson — the chi walkthrough. Builds on basics + safety
 * by introducing the claim window. Forces seat 3 (the seat whose
 * discards seat 0 can chi — `nextSeat(3) === 0`) to throw a 6-man
 * on its first turn. The user, dealt 7-man + 8-man via seed=5,
 * sees a chi opportunity and gets coach-marked through the claim
 * bar.
 *
 * 6-man over (e.g.) 5-pin specifically because at this seed the
 * user has 4p, 6p, 7p, 9p — 5-pin would yield two chi options
 * (4-5-6 *or* 5-6-7), which opens the multi-option picker. We pick
 * a tile that has exactly one completion path (6-7-8 man) so the
 * single tap commits the chi directly without a sub-picker.
 *
 * Bot 3's natural passive discard at seed=5 is 9-pin (last tile
 * in hand). The script overrides via `__MAHJONG_TEST_BOT_SCRIPTS__`,
 * which the solo transport already consumes through
 * `withTestScript()`. Bot 3's hand at this seed contains 6-man,
 * so the override is legal.
 */
export const claimsLesson: Lesson = {
  id: 'claims',
  title: 'Claiming a chi',
  seed: 5,
  dealer: 0,
  botScripts: {
    // Bot 3 discards 6-man first. User holds 7-man + 8-man, so
    // 6-man completes the only legal chi against their hand
    // (6-7-8 of characters).
    3: {
      discards: [{ kind: 'suit', suit: 'man', rank: 6, copy: 0 }],
    },
  },
  steps: [
    {
      id: 'intro',
      caption: {
        title: 'Claiming a tile',
        body: "When an opponent discards a tile that completes a sequence in your hand, you can call 'chi' to grab it instead of drawing. We'll set you up for one.",
      },
      ctaLabel: 'Got it',
    },
    {
      id: 'discard',
      caption: {
        title: 'Take your first turn',
        body: 'Tap any tile to discard. The bots will play, and one of them will throw a tile you can claim.',
      },
      targetId: 'own-hand',
      completedWhen: (state) => (state.discards[0]?.length ?? 0) >= 1,
    },
    {
      id: 'claim',
      caption: {
        title: 'Claim the chi!',
        body: 'A bot just discarded a 6-man — combined with the 7-man and 8-man already in your hand, that\'s a chi (6-7-8 of characters). Tap "Chi" to take the tile.',
      },
      targetId: 'claim-bar',
      // Auto-advance once the user actually claims — `melds[0]`
      // grows by one entry when chi is accepted. Prefer length
      // comparison over kind checking; that survives future meld
      // shape changes.
      completedWhen: (state) => state.melds[0].length >= 1,
    },
    {
      id: 'complete',
      caption: {
        title: 'Lesson complete!',
        body: "Nicely done. Claiming pulls you out of turn order — your meld is locked, and now it's your turn to discard. The same flow handles 'pong' (a third copy of one of your tiles) and 'kan' (a fourth).",
      },
      ctaLabel: 'Done',
    },
  ],
};
