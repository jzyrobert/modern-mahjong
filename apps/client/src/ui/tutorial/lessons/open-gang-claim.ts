import type { Seat, Tile } from '@mahjong/game-logic';
import { sameFace } from '@mahjong/game-logic';
import type { Lesson, LessonBotScripts } from '../types';

/**
 * Open-gang-claim lesson — call `gang` on an opponent's discard when
 * the user already holds three copies of the discarded face. The
 * resulting meld is `gang-exposed` (per `packages/game-logic/src/hand.ts:4`).
 *
 * Mechanically a close sibling of `peng.ts` — same claim-bar window,
 * same `setupAfterFirstDiscard` reactive shape — with one tile of
 * difference (the user holds three copies instead of two, and the
 * scripted bot supplies the fourth).
 *
 * Approach (same robustness story as `peng.ts`):
 * - Seed `271` lands seat 0 (dealer) at a sorted opening hand of
 *     1m 1m 1m 5m 4p 7p 9p 1s 7s E S W Z F
 *   — three man-1 at the front of the hand, an honour singleton F at
 *   the end. Seat 1 holds the 4th man-1. The triple sits at the head
 *   of the sort order so the "tap the last tile" reflex (consistent
 *   with the discard caption in `peng.ts` / `ron.ts`) drops an
 *   honour singleton rather than breaking the triple.
 * - `setupAfterFirstDiscard` scans the user's post-discard hand for
 *   *any* face they hold three copies of, then finds the first bot
 *   (seat 1 → 2 → 3) holding the fourth copy and scripts that bot's
 *   first discard via `__MAHJONG_TEST_BOT_SCRIPTS__`. The reactive
 *   shape survives the user discarding into the engineered triple —
 *   if they drop a man-1 we just look for a different triple, and
 *   if none exists the lesson hangs gracefully on the watch step
 *   (same fail mode as `claims.ts` and `peng.ts`).
 * - Per the post-#419 fix, unscripted bot claim windows in tutorials
 *   default to pass, so we don't have to defend against another bot
 *   peng-ing the user's discard before our scripted bot reaches its
 *   throw.
 */
export const openGangClaimLesson: Lesson = {
  id: 'open-gang-claim',
  // Seed search ranged over 1–2000 looking for a dealer-seat-0 hand
  // with (a) a triple in the opening 14, (b) at least one bot
  // holding the 4th copy, (c) the last sorted tile being an honour
  // singleton, and (d) the holder being seat 1 (earliest scripted
  // discard). Seed 271 was the first hit and satisfies all four.
  seed: 271,
  dealer: 0,
  title: 'Claiming an open gang',
  blurb: "Grab the fourth copy of a face you already hold three of from an opponent's discard.",
  // Bot script is decided at runtime in `setupAfterFirstDiscard`.
  botScripts: {},
  setupAfterFirstDiscard: (state) => {
    const userHand = state.hands[0];
    const pick = pickOpenGangTarget(userHand, [state.hands[1], state.hands[2], state.hands[3]]);
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
        title: 'Claiming an open gang',
        body: "When you hold three copies of a face and an opponent discards the fourth, you can call 'gang' to grab it — same as peng, but for four-of-a-kind. This is the *open* version of a gang, formed from a discard; the hidden version (four-in-hand) comes later. Open gangs lock four tiles into a meld and earn you a replacement draw from the back of the wall.",
      },
      ctaLabel: 'Got it',
    },
    {
      id: 'discard',
      caption: {
        title: 'Take your first turn',
        body: 'Tap any tile *except* a triple you might want to gang. Your honour tiles at the end of your hand are usually safe — they’re rare singles. Once you discard, the bots will play and one of them will throw the fourth copy of a face you hold three of.',
      },
      targetId: 'own-hand',
      completedWhen: (state) => (state.discards[0]?.length ?? 0) >= 1,
    },
    {
      id: 'watch',
      caption: {
        title: 'Watch the bots play',
        body: "The other seats take their turns. An open gang can be called on any seat's discard — when a bot throws the fourth copy of one of your triples, the claim bar will light up.",
      },
      // Anchor on the shared discard pool — `claim-bar` doesn't mount
      // until the engine parks at the right `awaitingClaims` state,
      // so previewing it here would render dead-centre with no halo
      // (same constraint as `claims.ts` / `peng.ts`).
      targetId: 'shared-discards',
      // Advance only when the engine parks at a claim window with a
      // discard from a bot whose face matches a triple in the user's
      // hand. Intermediate `awaitingClaims` states from discards the
      // user can't gang on don't qualify; passive bots resolve them
      // through the engine's pre-filled passes (and #419's tutorial
      // pass-by-default safeguard).
      completedWhen: (state) => {
        if (state.phase !== 'awaitingClaims') return false;
        const ld = state.lastDiscard;
        if (!ld || ld.from === 0) return false;
        const hand = state.hands[0];
        let copies = 0;
        for (const t of hand) if (sameFace(t, ld.tile)) copies++;
        return copies >= 3;
      },
    },
    {
      id: 'claim',
      caption: {
        title: 'Claim the gang!',
        body: 'A bot just discarded the fourth copy of one of your triples. Tap "Gang" to lock all four tiles into an open meld — you’ll also draw a replacement tile from the back of the wall.',
      },
      targetId: 'claim-bar',
      // Auto-advance once a `gang-exposed` meld lands in the user's
      // melds slot. Asserting the meld *kind* (rather than just the
      // length) distinguishes this lesson's open-gang outcome from
      // an accidental peng claim — the claim bar surfaces both
      // buttons when the user holds three of the discarded face.
      completedWhen: (state) => state.melds[0].some((m) => m.kind === 'gang-exposed'),
    },
    {
      id: 'complete',
      caption: {
        title: 'Lesson complete!',
        body: "That's an open gang. It's worth more than a peng (four tiles instead of three) and earns you a replacement draw from the back of the wall — but it also exposes a full set of a face, so opponents know exactly what you have. The hidden version of a gang (four copies in your concealed hand) comes in a later lesson.",
      },
      ctaLabel: 'Done',
    },
  ],
};

/**
 * Look for a triple (three of a face) in the user's hand whose
 * fourth copy is held by at least one bot. Returns the seat to
 * script and the tile to discard. Walks bots in seat order
 * (1 → 2 → 3) so earlier seats fire sooner. Falls back to `null`
 * if no triple-and-fourth combination exists (silent-hang
 * fallback, same as `peng.ts`).
 *
 * Skips faces where the user already holds 4 — that would be a
 * concealed gang opportunity, not a claim-bar gang, and there's no
 * fourth copy left for a bot to throw anyway.
 */
function pickOpenGangTarget(
  userHand: readonly Tile[],
  botHands: readonly [readonly Tile[], readonly Tile[], readonly Tile[]],
): { seat: Seat; tile: Tile } | null {
  const seen = new Set<string>();
  const triples: Tile[] = [];
  for (const t of userHand) {
    const key = faceKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    let count = 0;
    for (const u of userHand) if (sameFace(u, t)) count++;
    if (count === 3) {
      triples.push(t);
    }
  }
  for (const seat of [1, 2, 3] as const) {
    const botHand = botHands[seat - 1];
    if (!botHand) continue;
    for (const tile of triples) {
      if (botHand.some((t) => sameFace(t, tile))) {
        return { seat, tile };
      }
    }
  }
  return null;
}

function faceKey(t: Tile): string {
  return t.kind === 'suit' ? `${t.suit}-${t.rank}` : `h-${t.honor}`;
}
