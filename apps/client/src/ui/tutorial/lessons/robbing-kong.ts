import type { GameState, Meld, Seat, Tile } from '@mahjong/game-logic';
import type { Lesson, LessonBotScripts } from '../types';

/**
 * Robbing-kong (搶槓) lesson — the user is at shanten-0 single-wait
 * on face 3-pin when the lesson begins; seat 1 has already formed a
 * peng meld of 3-pin and holds the 4th 3-pin in their hand. On
 * seat 1's first own-turn the bot pacing loop consumes the scripted
 * `promotions[0]` entry, fires `declareGangPromoted`, the engine
 * opens the rob window, and the user (the only seat with a winning
 * shape on 3-pin) sees the gold Win button in the claim bar.
 *
 * Why `prepareState` instead of a live peng:
 *   - The natural peng-then-promote chain is essentially
 *     seed-impossible to engineer (search over 1M seeds yielded
 *     0 successes — the 4th W rarely lands at seat 1's first
 *     post-peng wall draw). See `docs/brainstorms/...` /  the U4
 *     plan unit for the empirical detail; the cost-benefit lands
 *     on injecting the meld up-front rather than churning the
 *     wall positioning.
 *   - `prepareState` is a single-shot post-`startHand` transform
 *     scoped to one Lesson field. The `__MAHJONG_TEST_*` family
 *     of hatches in `solo-transport.ts` carries the alternative
 *     test-side hook pattern; this lesson uses the Lesson-shape
 *     extension because the meld-injection is genuinely a *lesson*
 *     property (not a test override), and routing it through a
 *     test global would muddy the boundary.
 *
 * Why `faanMin: 3`:
 *   - The engine's `faanMin` rule is a typed union — `0 | 1 | 3 | 5`
 *     — so the "exactly above-ron-but-at-or-below-rob" threshold
 *     has to land on a permitted value. Seed 25701's user hand
 *     scores `門前清 + 平和 = 2 faan` on a plain ron of 3-pin, and
 *     `搶槓 + 門前清 + 平和 = 3 faan` on the rob. Setting
 *     `faanMin: 3` gates the plain ron (engine pre-passes via
 *     `canScoredHu`) but admits the rob (3 ≥ 3).
 *   - In practice no bot can even discard 3-pin during this lesson
 *     (all 4 copies live on seat 1 after `prepareState`), but the
 *     faan gate is belt-and-braces against future seed changes —
 *     and against the user's own inputs (e.g., the rob CTA only
 *     surfaces when the projected score clears the floor).
 *
 * The dealt 14-tile hand at seed 25701:
 *   6m 7m 8m 2p 4p 5p 5p 7p 8p 9p 4s 5s 6s F
 *
 * The lone F (White dragon) sorts to the end of the hand, so the
 * "discard the last tile" reflex (consistent with the `ron` and
 * `peng` lessons' discard caption) drops F. The remaining 13 tiles
 * are shanten-0 kanchan on 3-pin (the 2p-4p kanchan needs 3p to
 * complete; 5p-5p is the pair; 6m-7m-8m, 7p-8p-9p, 4s-5s-6s are
 * complete chi runs).
 *
 * Step-by-step engine flow when the user follows the captions:
 *   1. User discards F. Engine pre-passes all seats; phase=turn, turn=1.
 *   2. Bot pacing loop fires for seat 1: draws → checks
 *      `__MAHJONG_TEST_BOT_SCRIPTS__[1].promotions[0]` → matches
 *      the precondition (peng meld of 3-pin + 3-pin in hand) →
 *      pops the entry → applies `declareGangPromoted`.
 *   3. Engine opens the rob window
 *      (`state.pendingPromotedGang = { seat: 1, tile: 3-pin, meldIdx: 0 }`).
 *   4. Engine's `legalClaimsFor` restricts non-pass to `hu` only;
 *      `<ClaimBar>` reads `canScoredHu` and shows the Win button
 *      because the rob score (3 faan) clears the floor.
 *   5. User taps Win → engine resolves the rob → `lastResult.kind === 'win'`,
 *      `selfDraw === false`, `faanBreakdown` includes 搶槓.
 */

const WAIT_FACE = { suit: 'pin' as const, rank: 3 as const };

function isWait(t: Tile): boolean {
  return t.kind === 'suit' && t.suit === WAIT_FACE.suit && t.rank === WAIT_FACE.rank;
}

export const robbingKongLesson: Lesson = {
  id: 'robbing-kong',
  title: 'Robbing the kong',
  blurb:
    "Snipe an opponent's promoted gang when the upgrade tile is the one your hand was waiting on.",
  seed: 25701,
  dealer: 0,
  faanMin: 3,
  botScripts: buildBotScripts(),
  prepareState: (state) => injectSeat1PengAndPromoteTile(state),
  steps: [
    {
      id: 'intro',
      caption: {
        title: 'Robbing the kong (搶槓)',
        body: "An opponent can promote an existing peng (triple) into a gang (kong) by adding the fourth copy of that tile on their own turn. If YOU were one tile from winning AND that fourth copy is the tile you were waiting on, you can claim 'hu' to rob the kong before it forms — a +1 faan win that snatches the hand out from under them.",
      },
      ctaLabel: 'Got it',
    },
    {
      id: 'discard',
      caption: {
        title: 'Take your first turn',
        body: 'Tap the White-dragon tile at the end of your hand. That leaves you waiting on 3-dots — and seat 1 already has a peng of 3-dots (the meld showing below their seat label). When seat 1 promotes that peng to a gang, the rob window opens.',
      },
      targetId: 'own-hand',
      completedWhen: (state) => (state.discards[0]?.length ?? 0) >= 1,
    },
    {
      id: 'watch',
      caption: {
        title: 'Watch seat 1 draw',
        body: "Seat 1 is about to draw a tile. They're holding the 4th 3-dots — when they pick it up, they'll try to upgrade their peng to a kong, and the rob window will open for you.",
      },
      // Anchor on the wall-draw cue so the user's eye is on the
      // wall as the bot draws. The claim-bar target doesn't mount
      // until the rob window actually opens, so previewing it here
      // would render dead-centre with no halo (same constraint as
      // `claims.ts` / `ron.ts` / `peng.ts`).
      targetId: 'wall-draw',
      completedWhen: (state) => state.pendingPromotedGang !== undefined,
    },
    {
      id: 'rob',
      caption: {
        title: 'Rob the kong!',
        body: 'Tap the gold "Win" button to declare hu on the 3-dots seat 1 was about to add to their gang. This is 搶槓 — robbing the kong.',
      },
      targetId: 'claim-bar',
      // Resolution check: the engine finalises the rob inside
      // `resolveAndApply` (declareWin chained with `robbingKong: true`).
      // `lastResult.kind === 'win'` + winner=0 + selfDraw=false is
      // the signature; the e2e spec asserts the 搶槓 entry shows up
      // in `lastResult.breakdown` for extra coverage.
      completedWhen: (state) =>
        state.lastResult?.kind === 'win' &&
        state.lastResult.winner === 0 &&
        state.lastResult.selfDraw === false,
    },
    {
      id: 'complete',
      caption: {
        title: 'Lesson complete!',
        body: "Nicely done. Robbing the kong is rare — it only fires when an opponent promotes a peng AND your hand happens to be tenpai on the exact promotion face — but it's a +1 faan steal that turns the tables in one tap. Concealed gangs (4-in-hand) can't be robbed, only promoted-gangs (peng + 1 from the wall).",
      },
      ctaLabel: 'Done',
    },
  ],
};

/**
 * Build the per-seat bot scripts. Seat 1 has a single `promotions`
 * entry queued for its first own-turn — the solo transport's bot
 * pacing loop pops it once the precondition (peng meld of 3-pin +
 * 3-pin in hand) is satisfied. Other seats have no scripted moves;
 * they default to passive discards under the tutorial's forced bot
 * skill override (`joinSoloTutorial` passes
 * `['passive', 'passive', 'passive']`).
 */
function buildBotScripts(): LessonBotScripts {
  return {
    1: {
      promotions: [{ tile: { kind: 'suit', suit: 'pin', rank: 3, copy: 0 } }],
    },
  };
}

/**
 * Inject a pre-built peng meld of 3-pin into seat 1's melds AND
 * place the 4th 3-pin in seat 1's hand, so the lesson can fire the
 * promoted-gang path on seat 1's first own-turn without first
 * playing through a live peng claim.
 *
 * Engineering note: in HK mahjong all four copies of a face share
 * a face but differ in `copy` index (0..3). The four 3-pin tiles
 * are scattered across hands / wall / dead wall in the seeded
 * starting state. We:
 *   1. Pull all four 3-pin copies out of their original locations.
 *   2. Refill the holes in hands 0/2/3 and the dead wall by
 *      popping non-3-pin tiles from the back of the live wall.
 *   3. Shrink seat 1's hand from 13 → 9 (since they've got a
 *      3-tile meld now: 13 - 3 = 10, then push the 4th 3-pin onto
 *      the hand so it sits last in the array → 10 tiles).
 *   4. Push the 3 collected meld tiles into seat 1's melds as a
 *      single `peng` meld with `from = 2` (lesson copy says
 *      "seat 2 discarded it").
 * Tile conservation is asserted by the engine's
 * `assertTileConservation` (called from the parity tests); the
 * total stays at 136.
 */
function injectSeat1PengAndPromoteTile(state: GameState): GameState {
  const hands: Record<Seat, Tile[]> = {
    0: [...state.hands[0]],
    1: [...state.hands[1]],
    2: [...state.hands[2]],
    3: [...state.hands[3]],
  };
  const wall = [...state.wall];
  const deadWall = [...state.deadWall];

  // Collect all 4 copies of the wait face. Remove them in place.
  const collected: Tile[] = [];
  for (const seat of [0, 1, 2, 3] as const) {
    const h = hands[seat];
    for (let i = h.length - 1; i >= 0; i--) {
      if (isWait(h[i]!)) {
        collected.push(h[i]!);
        h.splice(i, 1);
      }
    }
  }
  for (let i = wall.length - 1; i >= 0; i--) {
    if (isWait(wall[i]!)) {
      collected.push(wall[i]!);
      wall.splice(i, 1);
    }
  }
  for (let i = deadWall.length - 1; i >= 0; i--) {
    if (isWait(deadWall[i]!)) {
      collected.push(deadWall[i]!);
      deadWall.splice(i, 1);
    }
  }
  if (collected.length !== 4) {
    throw new Error(
      `robbing-kong prepareState: expected 4 2-sou copies, found ${collected.length}`,
    );
  }

  // Refill non-seat-1 hands + dead wall from the live wall.
  const targetSizes: Record<Seat, number> = { 0: 14, 1: 10, 2: 13, 3: 13 };
  for (const seat of [0, 2, 3] as const) {
    while (hands[seat].length < targetSizes[seat]) {
      const refill = wall.pop();
      if (!refill) throw new Error('robbing-kong prepareState: wall exhausted refilling hand');
      hands[seat].push(refill);
    }
  }
  while (deadWall.length < 14) {
    const refill = wall.pop();
    if (!refill) throw new Error('robbing-kong prepareState: wall exhausted refilling deadWall');
    deadWall.push(refill);
  }

  // Shrink seat 1's hand to 9 tiles (we'll push the 4th wait tile
  // as the 10th to bring it up to target 10). Excess tiles go back
  // to the wall (random non-2-sou tiles).
  while (hands[1].length > targetSizes[1] - 1) {
    const overflow = hands[1].pop();
    if (overflow) wall.push(overflow);
  }
  hands[1].push(collected[3]!);

  // Build the peng meld for seat 1 using the first three collected tiles.
  const pengMeld: Meld = {
    kind: 'peng',
    tiles: [collected[0]!, collected[1]!, collected[2]!],
    from: 2 as Seat,
  };
  const newMelds = {
    ...state.melds,
    1: [...state.melds[1], pengMeld] as Meld[],
  };

  return {
    ...state,
    hands,
    wall,
    deadWall,
    melds: newMelds,
  };
}
