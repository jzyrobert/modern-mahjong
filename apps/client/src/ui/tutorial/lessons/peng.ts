import type { Seat, Tile } from '@mahjong/game-logic';
import { sameFace } from '@mahjong/game-logic';
import type { Lesson, LessonBotScripts } from '../types';

/**
 * Peng lesson — claim the third copy of a face the user already
 * holds a pair of. Mechanically the smaller sibling of `claims.ts`
 * (chi): the `<ClaimBar>` peng button never opens a sub-picker (a
 * peng claim is unambiguous — three of the same face), so we don't
 * need single-option seed engineering.
 *
 * Approach mirrors `claims.ts`:
 * - Pick a seed where seat 0 holds at least one pair after their
 *   opening discard AND a bot holds the third copy. Seed `140`
 *   gives seat 0 `1s 2s 3m 4s 5s 5s 6s 6s 7p 9p HB HE HF HN` —
 *   two pairs (5s, 6s); seat 1 holds a 6s. Honours sort last, so
 *   the user's "tap the last tile" reflex (nudged by the discard
 *   caption) drops `HN` and preserves both pairs.
 * - Reactively script a bot's first discard via
 *   `__MAHJONG_TEST_BOT_SCRIPTS__` in `setupAfterFirstDiscard` so
 *   the discard matches whichever pair the user still holds. The
 *   reactive shape survives the user discarding into one of their
 *   pairs — we just pick a different pair to peng on.
 *
 * If the user's first discard breaks every pair, the lesson hangs
 * gracefully on the "watch the bots" step (same fail mode as
 * `claims.ts`'s no-chi-options branch). The discard caption nudges
 * the user toward an honour tile at the end of their hand to
 * reduce the silent-hang surface.
 */
export const pengLesson: Lesson = {
  id: 'peng',
  // Seed `140` lands seat 0 at `1s 2s 3m 4s 5s 5s 6s 6s 7p 9p HB
  // HE HF HN` with seat 1 holding a 6s. Two pairs (5s, 6s) make
  // the lesson robust to the user discarding into one of them —
  // the other still gets peng'd. The seed search ranged over 1–
  // 200; this was the earliest seat-1 holder with a non-honour
  // pair (so the suggested "discard the last tile" reflex never
  // breaks the engineered peng opportunity).
  seed: 140,
  dealer: 0,
  title: 'Claiming a peng',
  blurb: "Grab an opponent's discard when it matches a pair you already hold.",
  // Bot script is decided at runtime in `setupAfterFirstDiscard`.
  botScripts: {},
  setupAfterFirstDiscard: (state) => {
    const userHand = state.hands[0];
    const pick = pickPengTarget(userHand, [state.hands[1], state.hands[2], state.hands[3]]);
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
        title: 'Claiming a peng',
        body: "When you hold a pair and an opponent discards the third copy of that same face, you can call 'peng' to grab it — same as chi, but for triples instead of sequences. Peng works on any seat's discard, not just the player before you.",
      },
      ctaLabel: 'Got it',
    },
    {
      id: 'discard',
      caption: {
        title: 'Take your first turn',
        body: 'Tap any tile *except* a pair you might want to peng. Your honour tiles at the end of your hand are usually safe — they’re rare singles. Once you discard, the bots will play and one of them will throw a tile that matches a pair in your hand.',
      },
      targetId: 'own-hand',
      completedWhen: (state) => (state.discards[0]?.length ?? 0) >= 1,
    },
    {
      id: 'watch',
      caption: {
        title: 'Watch the bots play',
        body: "The other seats take their turns. Peng can be called on any seat's discard — when a bot throws a tile matching one of your pairs, the claim bar will light up.",
      },
      // Anchor on the shared discard pool — `claim-bar` doesn't
      // mount until the engine parks at the right `awaitingClaims`
      // state, so previewing it here would render dead-centre with
      // no halo (same constraint as `claims.ts`).
      targetId: 'shared-discards',
      // Advance only when the engine parks at a claim window with a
      // discard from a bot whose face matches one of the user's
      // pairs. Intermediate `awaitingClaims` states from discards
      // the user can't peng on don't qualify; passive bots resolve
      // them through the engine's pre-filled passes.
      completedWhen: (state) => {
        if (state.phase !== 'awaitingClaims') return false;
        const ld = state.lastDiscard;
        if (!ld || ld.from === 0) return false;
        const hand = state.hands[0];
        let copies = 0;
        for (const t of hand) if (sameFace(t, ld.tile)) copies++;
        return copies >= 2;
      },
    },
    {
      id: 'claim',
      caption: {
        title: 'Claim the peng!',
        body: 'A bot just discarded the third copy of one of your pairs. Tap "Peng" to grab it — your pair becomes an exposed triple.',
      },
      targetId: 'claim-bar',
      // Auto-advance once the claim lands. Same `melds[0]` length
      // predicate as `claims.ts` — it survives future meld shape
      // changes and avoids coupling to a specific meld kind.
      completedWhen: (state) => state.melds[0].length >= 1,
    },
    {
      id: 'complete',
      caption: {
        title: 'Lesson complete!',
        body: "That's peng. Same as chi, the claim pulls you out of turn order — your meld is locked face-up, and now it's your turn to discard. Peng is the most common claim; you'll lean on it whenever a pair you're holding sees its third copy hit the table.",
      },
      ctaLabel: 'Done',
    },
  ],
};

/**
 * Look for a pair in the user's hand whose third copy is held by
 * at least one bot. Returns the seat to script and the tile to
 * discard. Walks bots in seat order (1 → 2 → 3) so earlier seats
 * fire sooner — the lesson resolves faster when seat 1 is the
 * holder. Falls back to `null` if no pair-and-third combination
 * exists (silent-hang fallback, same as `claims.ts`).
 */
function pickPengTarget(
  userHand: readonly Tile[],
  botHands: readonly [readonly Tile[], readonly Tile[], readonly Tile[]],
): { seat: Seat; tile: Tile } | null {
  // Group user's hand by face; any face with count >= 2 is a
  // peng candidate.
  const seen = new Set<string>();
  const pairs: Tile[] = [];
  for (const t of userHand) {
    const key = faceKey(t);
    if (seen.has(key)) continue;
    let count = 0;
    for (const u of userHand) if (sameFace(u, t)) count++;
    if (count >= 2) {
      pairs.push(t);
      seen.add(key);
    } else {
      seen.add(key);
    }
  }
  // Walk seats 1 → 2 → 3 and pick the first (pair, holder) match.
  for (const seat of [1, 2, 3] as const) {
    const botHand = botHands[seat - 1];
    if (!botHand) continue;
    for (const tile of pairs) {
      // Skip if the user already holds 4 — peng needs the third,
      // not a fourth copy (that would be a gang, not a peng).
      let inHand = 0;
      for (const u of userHand) if (sameFace(u, tile)) inHand++;
      if (inHand >= 4) continue;
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
