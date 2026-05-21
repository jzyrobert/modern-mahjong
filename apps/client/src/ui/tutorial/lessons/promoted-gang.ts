import type { Seat, Tile } from '@mahjong/game-logic';
import { sameFace } from '@mahjong/game-logic';
import type { Lesson, LessonBotScripts } from '../types';

/**
 * Promoted-gang lesson — promote an existing peng meld into a
 * `gang-promoted` meld by drawing the fourth copy of the peng face
 * on a later turn and tapping the new "Promote gang" button. The
 * lesson splits the open-gang content (per plan U6: `open-gang-claim`
 * teaches the discard-claim variant; this lesson teaches the
 * promotion variant).
 *
 * Approach (seed-engineered, no new lifecycle hooks):
 * - Seed `6755` lands seat 0 (dealer) at the sorted opening hand
 *     3m 6m 7m 2p 3p 7p 7p 9p 4s 8s E W N F
 *   — a pair of 7-pin in the middle, an honour singleton F at the
 *   tail. Seat 1 holds the third 7-pin in their opening hand. The
 *   fourth 7-pin sits five tiles deep into the live wall — far
 *   enough that bots' wall draws between the user's two own turns
 *   don't reach it.
 * - User discards F (last sorted tile, mirroring the discard caption
 *   convention used by `peng.ts` / `open-gang-claim.ts`).
 *   `setupAfterFirstDiscard` then scripts seat 1's first discard to
 *   pop the third copy of *whichever* pair survived the user's
 *   discard — same reactive shape as `peng.ts`. At this seed the
 *   only pair-with-third-copy combination is 7-pin / seat 1, so the
 *   walk is deterministic.
 * - User pengs seat 1's 7-pin → exposed meld `peng[7p,7p,7p]`. User
 *   discards last sorted tile again (N — White-wind singleton).
 * - Seats 1 → 2 → 3 each take their next natural turn (passive bots,
 *   discarding their drawn tile per `passiveBot.pickDiscard`). None
 *   of those discards lights up a user claim window — the seed
 *   search verified that.
 * - User's next natural draw is the fourth 7-pin (`wall[wallLen-5]`
 *   at deal time — see seed-search rationale below). The new
 *   "Promote gang" button surfaces; tapping it dispatches
 *   `declareGangPromoted`, the engine pops `7p` from hand into the
 *   meld (`gang-promoted[7p,7p,7p,7p]`), draws a replacement from
 *   the dead wall, and bumps `gangReplacementCount`.
 *
 * Why no rob window fires:
 * - `declareGangPromoted` opens a rob window only when an opponent
 *   is shanten-0 on the promoted face. At seed 6755 no opponent has
 *   that shape, so the engine skips the window entirely (engine
 *   short-circuit at `actions.ts:593`) and stays in `phase: 'turn'`
 *   with `phase` never transitioning to `awaitingClaims`. The e2e
 *   spec asserts this explicitly as the "robbing-kong-not-fired
 *   guard" (per plan U6 test scenarios).
 *
 * Seed-search audit trail (mirrors the methodology used for
 * `peng.ts` / `open-gang-claim.ts`):
 * - Search range: 1..10_000. Filter: dealer-seat-0 opening hand has
 *   a pair whose third copy is held by seat 1 (so seat 1's scripted
 *   first discard fires fast), AND the post-peng natural-play
 *   sequence (seat 1 / 2 / 3 each draw + passively discard) does
 *   not surface a user-claimable tile (the engine would park at
 *   `awaitingClaims` waiting on the user, breaking the lesson),
 *   AND wall[wallLen-5] (the user's first post-peng natural draw)
 *   is the fourth copy of the peng face. Three seeds passed the
 *   filter: 6755 (7p), 7873 (1m), 8841 (8s). Chose 6755 as the
 *   earliest hit. The seed-search script is reproducible from the
 *   compiled engine; details live in the PR body.
 */
export const promotedGangLesson: Lesson = {
  id: 'promoted-gang',
  // Seed search ranged over 1..10000 with the engine-driven verifier
  // described above. Seed 6755 is the earliest hit; 7873 and 8841
  // are the alternates surfaced by the same search if a future
  // engine change ever breaks 6755.
  seed: 6755,
  dealer: 0,
  title: 'Promoting a gang',
  blurb: 'Upgrade an existing peng to a gang when you draw the fourth copy on a later turn.',
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
        title: 'Promoting a gang',
        body: "When you already have a peng (open triple) and then later draw the fourth copy of that same face, you can promote the peng into a gang. It's the slow-cooker version of the open gang — instead of claiming all four in one move from a discard, you stake out the triple first and upgrade it once the fourth copy walks into your hand. The promotion earns you a replacement draw from the back of the wall, same as any gang.",
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
        body: 'The other seats take their turns. When a bot throws a tile matching one of your pairs, the claim bar will light up so you can grab it as a peng — the same flow as the earlier peng lesson.',
      },
      // Anchor on the shared discard pool — `claim-bar` doesn't
      // mount until the engine parks at the right `awaitingClaims`
      // state, so previewing it here would render dead-centre with
      // no halo (same constraint as `peng.ts` / `open-gang-claim.ts`).
      targetId: 'shared-discards',
      // Advance only when the engine parks at a claim window with a
      // discard from a bot whose face matches one of the user's
      // pairs. Intermediate `awaitingClaims` states resolve via the
      // engine's pre-passes (and #419's tutorial pass-by-default
      // safeguard) without stalling here.
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
        title: 'Claim the peng',
        body: 'A bot just discarded the third copy of one of your pairs. Tap "Peng" to grab it — your pair becomes an exposed triple, and now we wait for the fourth copy to walk into your hand on a later turn.',
      },
      targetId: 'claim-bar',
      // Auto-advance once a peng meld lands in seat 0's melds. We
      // assert the meld *kind* (rather than just `length >= 1`) so
      // an accidental gang claim — surfaced by the same claim bar
      // when the user happens to hold three of the discarded face —
      // doesn't satisfy this step (it would, but it would also
      // short-circuit the rest of the lesson by giving the user a
      // gang outright; the seed eliminates this case but the kind
      // check documents the intent).
      completedWhen: (state) => state.melds[0].some((m) => m.kind === 'peng'),
    },
    {
      id: 'discard-again',
      caption: {
        title: 'Take your post-peng turn',
        body: "Pengs claim out of order — the engine drops you straight into your turn without drawing. Tap any safe tile (your honour singletons at the end of the hand are easy picks) to keep play moving. The bots will then loop back to you, and the next tile you draw is the one we've been waiting on.",
      },
      targetId: 'own-hand',
      // Advance once the user has discarded twice (first discard
      // before the peng counted, post-peng discard adds a second
      // entry to `state.discards[0]`).
      completedWhen: (state) => (state.discards[0]?.length ?? 0) >= 2,
    },
    {
      id: 'draw',
      caption: {
        title: 'Draw your next tile',
        body: "The bots have played their turns; it's back to you. Tap the wall to draw your next tile — at this seed it's the fourth copy of the face you just peng'd, so the promote-gang button will surface as soon as the tile lands in your hand.",
      },
      // Anchor on the wall-draw cue so the highlight halo points
      // the user at the next-draw stack. The pulsing halo + click
      // handler are already wired up by `WallEdge`; tutorial just
      // adds the anchor reticle.
      targetId: 'wall-draw',
      // Advance once the user has drawn (state.hasDrawn flips
      // true on `drawTile`) — we also gate on it being the user's
      // own turn so the predicate doesn't false-fire on a bot's
      // draw earlier in the round.
      completedWhen: (state) => state.phase === 'turn' && state.turn === 0 && state.hasDrawn,
    },
    {
      id: 'promote',
      caption: {
        title: 'Promote your peng to a gang!',
        body: 'You drew the fourth copy of the face you peng\'d earlier. Tap "Promote gang" to upgrade your open triple into an open gang — the fourth tile slots into the meld, and the engine deals you a replacement tile from the back of the wall.',
      },
      // Anchor on the new `promote-gang` tutorial target. The
      // button only renders when `promotedGangTile` is set
      // (defined in `Match.tsx`), so the highlight halo only
      // surfaces once the user is actually in the promote-able
      // state — same lazy-mount pattern as `claim-bar`.
      targetId: 'promote-gang',
      // Auto-advance once any seat-0 meld flips to kind
      // `gang-promoted`. The robbing-kong-not-fired guard is
      // implicit: if a rob fired, the engine would resolve the
      // hand to `phase: 'resolved'` with `lastResult.kind === 'win'`
      // before any meld flipped to `gang-promoted` (the meld only
      // upgrades inside `finalizePromotion`, called from the
      // no-robbers fast path or the all-pass branch of
      // `resolveAndApply`). At seed 6755 nobody can rob, so the
      // engine takes the no-robbers fast path inline.
      completedWhen: (state) => state.melds[0].some((m) => m.kind === 'gang-promoted'),
    },
    {
      id: 'complete',
      caption: {
        title: 'Lesson complete!',
        body: "That's the promoted gang. It feels slower than an open-gang claim because you have to commit to the peng first and then wait for the fourth copy to find you — but the payoff is the same (a four-tile meld plus a replacement draw). One catch: opponents who were one tile from winning on the promotion face get a chance to 'rob the kong' before the gang locks in. The robbing-kong lesson covered that side of the table.",
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
 * holder, which is the engineered case at seed 6755. Falls back
 * to `null` if no pair-and-third combination exists (silent-hang
 * fallback, same as `peng.ts` / `open-gang-claim.ts`).
 *
 * Same shape as `peng.ts:pickPengTarget` deliberately — the lesson
 * teaches the *promotion*, not the initial peng, so the peng-setup
 * half mirrors `peng.ts` step-for-step.
 */
function pickPengTarget(
  userHand: readonly Tile[],
  botHands: readonly [readonly Tile[], readonly Tile[], readonly Tile[]],
): { seat: Seat; tile: Tile } | null {
  const seen = new Set<string>();
  const pairs: Tile[] = [];
  for (const t of userHand) {
    const key = faceKey(t);
    if (seen.has(key)) continue;
    seen.add(key);
    let count = 0;
    for (const u of userHand) if (sameFace(u, t)) count++;
    if (count >= 2) {
      pairs.push(t);
    }
  }
  for (const seat of [1, 2, 3] as const) {
    const botHand = botHands[seat - 1];
    if (!botHand) continue;
    for (const tile of pairs) {
      // Skip if the user already holds 4 — peng needs the third,
      // not a fourth copy.
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
