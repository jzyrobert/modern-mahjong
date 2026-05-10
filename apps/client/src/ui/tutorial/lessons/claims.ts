import type { Tile } from '@mahjong/game-logic';
import { chiOptions } from '@mahjong/game-logic';
import type { Lesson, LessonBotScripts } from '../types';

/**
 * Claims lesson — the chi walkthrough. Builds on basics + safety
 * by introducing the claim window. Seat 3's first discard is
 * chosen reactively: after the user makes their opening discard,
 * `setupAfterFirstDiscard` scans bot 3's hand for a face that
 * gives the user *exactly one* chi option against their remaining
 * tiles, then writes that tile into
 * `globalThis.__MAHJONG_TEST_BOT_SCRIPTS__[3]` so the solo
 * transport's `withTestScript` shim picks it up on bot 3's first
 * `pickDiscard` call. This means whatever tile the user opens
 * with — including the man tiles the lesson originally needed
 * them to keep — they still see a single, unambiguous chi
 * opportunity rather than a hung lesson or a multi-option picker.
 *
 * Single-option preference: the `<ClaimBar>` opens a sub-picker
 * when the user has multiple chi completions for the same
 * discard, which the lesson copy doesn't walk through. Picking a
 * tile with `chiOptions().length === 1` keeps the experience to
 * one tap.
 */
export const claimsLesson: Lesson = {
  id: 'claims',
  title: 'Claiming a chi',
  blurb: 'Grab an opponent’s discard to complete a sequence in your hand.',
  seed: 5,
  dealer: 0,
  // Bot 3's discard is chosen at runtime in `setupAfterFirstDiscard`.
  botScripts: {},
  setupAfterFirstDiscard: (state) => {
    const userHand = state.hands[0];
    const bot3Hand = state.hands[3];
    const tile = pickSingleChiCompletion(userHand, bot3Hand);
    if (!tile) return;
    const w = globalThis as { __MAHJONG_TEST_BOT_SCRIPTS__?: LessonBotScripts };
    const scripts: LessonBotScripts = { ...(w.__MAHJONG_TEST_BOT_SCRIPTS__ ?? {}) };
    scripts[3] = { ...(scripts[3] ?? {}), discards: [tile] };
    w.__MAHJONG_TEST_BOT_SCRIPTS__ = scripts;
  },
  steps: [
    {
      id: 'intro',
      caption: {
        title: 'Claiming a tile',
        body: "When an opponent discards a tile that completes a sequence in your hand, you can call 'chi' to grab it instead of drawing. We'll set you up for one — pick anything you don't need to discard.",
      },
      ctaLabel: 'Got it',
    },
    {
      id: 'discard',
      caption: {
        title: 'Take your first turn',
        body: "Tap any tile to discard. Your honour tiles (the ones with single Chinese characters at the end of your hand) are usually a safe pick — they can't form chi sequences. Once you discard, the bots will play, and one of them will throw a tile you can claim.",
      },
      targetId: 'own-hand',
      completedWhen: (state) => (state.discards[0]?.length ?? 0) >= 1,
    },
    {
      id: 'claim',
      caption: {
        title: 'Claim the chi!',
        body: 'A bot just discarded a tile that completes a sequence in your hand. Tap "Chi" to take it.',
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
        body: "Nicely done. Claiming pulls you out of turn order — your meld is locked, and now it's your turn to discard. The same flow handles 'peng' (a third copy of one of your tiles) and 'gang' (a fourth).",
      },
      ctaLabel: 'Done',
    },
  ],
};

/**
 * Walk bot 3's hand looking for a face whose `chiOptions(userHand,
 * tile).length === 1` — i.e., the user has exactly one chi
 * completion for that tile, so the in-game `<ClaimBar>` won't
 * open a multi-option picker. Falls back to any tile that gives
 * at least one chi if no single-option face exists, then to
 * `null` if the user can't chi anything bot 3 holds. The hand is
 * scanned once and the first match wins — chi semantics are
 * face-based, so the specific copy doesn't matter.
 */
function pickSingleChiCompletion(
  userHand: readonly Tile[],
  bot3Hand: readonly Tile[],
): Tile | null {
  // Dedupe by face so we don't reconsider the same tile twice.
  const seen = new Set<string>();
  let fallback: Tile | null = null;
  for (const tile of bot3Hand) {
    const key = faceKey(tile);
    if (seen.has(key)) continue;
    seen.add(key);
    const options = chiOptions(userHand, tile);
    if (options.length === 1) return tile;
    if (options.length >= 1 && fallback === null) fallback = tile;
  }
  return fallback;
}

function faceKey(t: Tile): string {
  return t.kind === 'suit' ? `${t.suit}-${t.rank}` : `h-${t.honor}`;
}
