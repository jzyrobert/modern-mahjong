import type { GameState, Seat, Tile } from '@mahjong/game-logic';
import { tileId } from '@mahjong/game-logic';
import type { Lesson } from '../types';

/**
 * Wait-shapes (聽牌形) lesson — the first strategy probe in the
 * curriculum. Teaches the four canonical tenpai shapes:
 *
 *   - kanchan  (嵌張): closed-middle gap (e.g. 6s _ 8s, waiting on 7s)
 *   - ryanmen  (兩面): two-sided open run (e.g. 5s-6s, waiting on 4s/7s)
 *   - shanpon  (雙碰): pair-pair, waiting on either pair's third copy
 *   - tanki    (單騎): single-tile pair wait (4 melds + an isolated tile)
 *
 * Per plan U8 (`docs/plans/2026-05-20-001-...`) this lesson is the
 * explicit strategy probe: built against the existing `Lesson` shell
 * so the strain — if any — surfaces as a real-world deliverable to the
 * R10 follow-up brainstorm (U9). Read the PR body for the "what the
 * shell didn't support cleanly" section that section is the U9 input.
 *
 * Shell-fit conclusion (the U9 input, in short):
 *   The existing shell supports ONE static `prepareState` snapshot per
 *   lesson. A 13-tile shanten-0 hand has exactly ONE wait-shape
 *   category by structural decomposition — kanchan, ryanmen, shanpon,
 *   or tanki. A single deal therefore cannot simultaneously demonstrate
 *   all four shapes; multi-decomposition hands exist but the waits
 *   still fall into one category, and the contrived "nobetan" pattern
 *   is just two tanki waits.
 *
 *   Two workarounds were considered:
 *     1. Per-step `setupBeforeStep` lifecycle hook on `LessonStep` so
 *        each of the four shape captions could install its own
 *        13-tile hand. NOT taken — the plan explicitly says don't
 *        pre-design a new shell shape; let the friction be the U9
 *        input.
 *     2. Pick one shape as the live concrete example and prose-teach
 *        the other three via caption text + mini-ASCII examples baked
 *        into the body copy. TAKEN — kanchan is the visible shape
 *        (single distinctive 7s wait), the other three are described
 *        with literal tile labels in the body text. The 聽 badge stays
 *        live across all four shape captions because the hand is
 *        static.
 *
 *   This is the friction R10 needs to know about: strategy lessons
 *   want per-step state setup; the shell only offers per-lesson.
 *
 * Lesson flow (existing shell, single deal):
 *   1. intro caption (read-and-advance, no `completedWhen`)
 *   2. discard the tail honor (auto-advance on first own discard);
 *      after the discard the 13-tile hand is shanten-0 kanchan,
 *      `waitTiles` returns [7s], and `<ReadyHandBadge>` mounts.
 *   3-6. four read-and-advance captions, one per wait shape. Each
 *      anchors on `'ready-hand-badge'` (NEW target id added in this
 *      PR) so the gold pill is highlighted while the caption explains.
 *   7. lesson-complete dismissal (R14 — strategy lesson ends without
 *      driving the engine to a terminal state).
 *
 * CTA convention chosen: every read-and-advance step **omits**
 * `completedWhen` so the default "Got it" CTA renders
 * (`TutorialOverlay.tsx:283` — the Next button is hidden when
 * `completedWhen` is set, so manual-advance steps must omit it).
 * Applied uniformly across intro + four shape captions + complete.
 *
 * The 14-tile dealer hand installed by `prepareState`:
 *   1m 2m 3m 4m 5m 6m 1p 2p 3p 5s 5s 6s 8s + W (white wind)
 *
 * Decomposition of the post-discard 13-tile hand (after dropping W):
 *   chi 1m-2m-3m + chi 4m-5m-6m + chi 1p-2p-3p + pair 5s-5s + kanchan 6s_8s
 *   → shanten 0, single wait on 7s. (Verified via `waitTiles`.)
 */

const TARGET_HAND_14: readonly Tile[] = [
  { kind: 'suit', suit: 'man', rank: 1, copy: 0 },
  { kind: 'suit', suit: 'man', rank: 2, copy: 0 },
  { kind: 'suit', suit: 'man', rank: 3, copy: 0 },
  { kind: 'suit', suit: 'man', rank: 4, copy: 0 },
  { kind: 'suit', suit: 'man', rank: 5, copy: 0 },
  { kind: 'suit', suit: 'man', rank: 6, copy: 0 },
  { kind: 'suit', suit: 'pin', rank: 1, copy: 0 },
  { kind: 'suit', suit: 'pin', rank: 2, copy: 0 },
  { kind: 'suit', suit: 'pin', rank: 3, copy: 0 },
  { kind: 'suit', suit: 'sou', rank: 5, copy: 0 },
  { kind: 'suit', suit: 'sou', rank: 5, copy: 1 },
  { kind: 'suit', suit: 'sou', rank: 6, copy: 0 },
  { kind: 'suit', suit: 'sou', rank: 8, copy: 0 },
  // Honor at the tail — the discard-step caption asks the user to
  // drop the last tile. After dropping W the remaining 13 tiles are
  // shanten 0 with a single kanchan wait on 7-sou.
  { kind: 'honor', honor: 'W', copy: 0 },
];

export const waitShapesLesson: Lesson = {
  id: 'wait-shapes',
  title: 'Wait shapes',
  blurb: 'Recognise the four classic tenpai shapes — kanchan, ryanmen, shanpon, tanki.',
  // Seed is arbitrary — `prepareState` replaces seat 0's hand
  // wholesale, so the seeded deal only matters for the bots / wall.
  // Reuse `basics`'s seed `5` so other deterministic side effects
  // (opening dice, wall layout for the bot turns we don't reach)
  // match the seed everything else in the e2e suite uses.
  seed: 5,
  dealer: 0,
  // Passive bots are forced by the tutorial flow; no scripted moves
  // needed because the lesson never runs past the user's first
  // discard.
  botScripts: {},
  prepareState: (state) => installSeat0Hand(state, TARGET_HAND_14),
  steps: [
    {
      id: 'intro',
      caption: {
        title: 'Reading your waits',
        body: 'Once your hand is one tile away from winning — 聽牌 (tenpai) — the shape of the missing piece matters. A wait on one closed-middle tile is much narrower than a wait on a two-sided open run. This lesson walks through the four classic shapes: kanchan, ryanmen, shanpon, and tanki.',
      },
      ctaLabel: 'Got it',
    },
    {
      id: 'discard',
      caption: {
        title: 'Drop the white-dragon',
        body: "We've rigged your hand so dropping the lone wind tile at the end leaves you tenpai. Tap the W (white-wind) tile at the tail of your hand to discard it — the gold 聽 badge will appear above your melds row once you're in a ready shape.",
      },
      targetId: 'own-hand',
      completedWhen: (state) => (state.discards[0]?.length ?? 0) >= 1,
    },
    {
      id: 'kanchan',
      caption: {
        title: '1 / 4 — Kanchan (嵌張)',
        body: "Your hand is now waiting on 7-sou — that's a kanchan, a closed-middle gap. Look at the badge: the wait tile sits between the 6-sou and 8-sou you're holding. Kanchan waits are the narrowest of the four shapes (only the inner tile completes them) — 4 copies of one face in the deck at best, and any already-discarded copies cut into that.",
      },
      targetId: 'ready-hand-badge',
      ctaLabel: 'Got it',
    },
    {
      id: 'ryanmen',
      caption: {
        title: '2 / 4 — Ryanmen (兩面)',
        body: "A ryanmen is a two-sided wait — instead of 6_8 you'd be holding 6-7, accepting both 5 and 8. Twice the deck coverage of a kanchan (up to 8 copies across two faces). Whenever you're shaping a hand from scratch, prefer building toward open runs (5-6, 6-7, 7-8) over closed gaps (5_7, 6_8) — the ryanmen is the strongest of the open-wait shapes.",
      },
      targetId: 'ready-hand-badge',
      ctaLabel: 'Got it',
    },
    {
      id: 'shanpon',
      caption: {
        title: '3 / 4 — Shanpon (雙碰)',
        body: "A shanpon (pair-pair) waits when you hold two pairs and need a third copy of either to complete the second pair into a triplet. Example: holding 3-pin 3-pin AND 7-sou 7-sou with three other melds already complete — you're waiting on either a third 3-pin or a third 7-sou. Up to 4 copies across two faces, but each pair locks up two tiles you can't discard.",
      },
      targetId: 'ready-hand-badge',
      ctaLabel: 'Got it',
    },
    {
      id: 'tanki',
      caption: {
        title: '4 / 4 — Tanki (單騎)',
        body: "A tanki (single-tile) wait is the inverse of a shanpon — you've got 4 complete melds already and a single lone tile, waiting on its pair. Tanki waits are flexible (you can swap which face you wait on by holding a different singleton) but slow (you need a specific face to land in your hand). Often the wait of last resort when the rest of your hand froze early.",
      },
      targetId: 'ready-hand-badge',
      ctaLabel: 'Got it',
    },
    {
      id: 'complete',
      caption: {
        title: 'Lesson complete!',
        body: "That's the four-shape vocabulary. When you're scoring your own hand in flight, look for the wait shape you're heading into — ryanmen for speed, shanpon for blocking opponents, tanki for flexibility, kanchan only when the deck still has the inner tile available. Reading opponents' waits comes later — for now, just being able to name your own is a big step up.",
      },
      ctaLabel: 'Done',
    },
  ],
};

/**
 * Replace seat 0's 14-tile dealer hand with `target`, preserving
 * the 136-tile multiset invariant. Strategy: for each target tile,
 * locate one matching copy somewhere on the board (in any hand,
 * the wall, or the dead wall), swap it with whatever currently sits
 * at seat 0's hand position. Tiles that get displaced from seat 0
 * cascade into the donor location.
 *
 * Approach: build a `targetIds` multiset (using `tileId` keys),
 * walk seat 0's hand and either keep tiles that are needed or
 * swap them out for the missing target tiles. The donor pool is
 * the other three hands + wall + deadWall, scanned in that order.
 * Throws if a required tile cannot be found — that would indicate
 * a `TARGET_HAND_14` typo (e.g. asking for 5 copies of one face).
 */
function installSeat0Hand(state: GameState, target: readonly Tile[]): GameState {
  if (target.length !== 14) {
    throw new Error(`wait-shapes prepareState: expected 14 tiles, got ${target.length}`);
  }
  const hands: Record<Seat, Tile[]> = {
    0: [...state.hands[0]],
    1: [...state.hands[1]],
    2: [...state.hands[2]],
    3: [...state.hands[3]],
  };
  const wall = [...state.wall];
  const deadWall = [...state.deadWall];

  // Build the multiset of target tile-ids (tileId encodes face+copy).
  const need: Map<number, number> = new Map();
  for (const t of target) {
    const id = tileId(t);
    need.set(id, (need.get(id) ?? 0) + 1);
  }

  // Pass 1: discount tiles already in seat 0's hand that match the
  // need set; pull them aside as `keep`. Leftovers in seat 0 go to
  // `surplus` (they'll be pushed back into the donor pool).
  const keep: Tile[] = [];
  const surplus: Tile[] = [];
  for (const t of hands[0]) {
    const id = tileId(t);
    const remaining = need.get(id) ?? 0;
    if (remaining > 0) {
      keep.push(t);
      need.set(id, remaining - 1);
    } else {
      surplus.push(t);
    }
  }

  // Pass 2: for each still-needed tile, find one in the donor pool
  // (other hands → wall → deadWall) and pull it. Replace the donor
  // slot with one of `surplus` (so the donor location keeps its
  // count). When `surplus` runs dry the donor slot is simply
  // removed — but that should never happen because |target| = 14
  // and we removed exactly 14 from seat 0, so |surplus| =
  // 14 - |keep| = number of still-needed tiles.
  const acquired: Tile[] = [];
  const donorBuckets: Array<Tile[]> = [hands[1], hands[2], hands[3], wall, deadWall];
  for (const [id, count] of need) {
    for (let k = 0; k < count; k++) {
      let found = false;
      for (const bucket of donorBuckets) {
        for (let i = 0; i < bucket.length; i++) {
          if (tileId(bucket[i]!) === id) {
            acquired.push(bucket[i]!);
            const replacement = surplus.pop();
            if (replacement) {
              bucket[i] = replacement;
            } else {
              bucket.splice(i, 1);
            }
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (!found) {
        throw new Error(`wait-shapes prepareState: required tile id ${id} not found on the board`);
      }
    }
  }

  hands[0] = [...keep, ...acquired];

  return {
    ...state,
    hands,
    wall,
    deadWall,
  };
}
