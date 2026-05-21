import type { GameState, Seat, Tile } from '@mahjong/game-logic';
import { tileId } from '@mahjong/game-logic';
import type { Lesson } from '../types';

/**
 * Wait-shapes (聽牌形) lesson — the first strategy probe in the
 * curriculum. Teaches the four canonical tenpai shapes:
 *
 *   - kanchan  (嵌張): closed-middle gap (e.g. 6s _ 8s, waiting on 7s)
 *   - ryanmen  (兩面): two-sided open run (e.g. 7p-8p, waiting on 6p/9p)
 *   - shanpon  (雙碰): pair-pair, waiting on either pair's third copy
 *   - tanki    (單騎): single-tile pair wait (4 melds + an isolated tile)
 *
 * Per plan U8 (`docs/plans/2026-05-20-001-...`) this lesson was the
 * original strategy probe — shipped against the single-`prepareState`
 * shell with three shapes living as prose. U2 of plan
 * `docs/plans/2026-05-21-002-feat-strategy-shell-extension-plan.md`
 * backports it onto the `setupBeforeStep` hook (U1) so all four wait
 * shapes are now live engineered hands rather than three of them
 * existing only as caption text. Same lesson flow + caption rhythm; the
 * difference is the user sees a distinct shanten-0 hand on screen for
 * every shape step.
 *
 * Lesson flow:
 *   1. intro caption (read-and-advance, no `completedWhen`)
 *   2. discard the tail honor (auto-advance on first own discard);
 *      after the discard the 13-tile hand is shanten-0 kanchan,
 *      `waitTiles` returns [7s], and `<ReadyHandBadge>` mounts.
 *   3. kanchan caption — the hand the user just produced by discarding
 *      W is the kanchan example. No `setupBeforeStep` here; the
 *      lesson's `prepareState` already set up the right shape.
 *   4. ryanmen caption — `setupBeforeStep` swaps in a new 13-tile
 *      shanten-0 hand whose waits are 6p / 9p (two-sided run on 7p-8p).
 *   5. shanpon caption — swap to a hand with two pairs (9m-9m + 5p-5p)
 *      plus three complete melds; waits = 9m or 5p.
 *   6. tanki caption — swap to a hand with four complete melds plus a
 *      lone 5s; wait = 5s.
 *   7. lesson-complete dismissal (R14 — strategy lesson ends without
 *      driving the engine to a terminal state).
 *
 * CTA convention chosen: every read-and-advance step **omits**
 * `completedWhen` so the default "Got it" CTA renders
 * (`TutorialOverlay.tsx:283` — the Next button is hidden when
 * `completedWhen` is set, so manual-advance steps must omit it).
 * Applied uniformly across intro + four shape captions + complete.
 *
 * Safety invariant (per U1 Approach): `setupBeforeStep` updates the
 * React mirror of engine state via `useGame.setState`, NOT the
 * authoritative state owned by the solo transport. Safe here because
 * no engine emit fires between step entry and step exit for the four
 * shape captions: the tutorial forces bots passive
 * (`__MAHJONG_TUTORIAL_FORCE_PASS__`), `turnTimeoutMs: 0` disables
 * auto-discard re-emits, and the lesson never reaches a bot's claim
 * window. The staged hand therefore persists visually until the user
 * taps Got it / leaves the lesson.
 *
 * The 14-tile dealer hand installed by `prepareState`:
 *   1m 2m 3m 4m 5m 6m 1p 2p 3p 5s 5s 6s 8s + W (white wind)
 *
 * Decomposition of the post-discard 13-tile hand (after dropping W):
 *   chi 1m-2m-3m + chi 4m-5m-6m + chi 1p-2p-3p + pair 5s-5s + kanchan 6s_8s
 *   → shanten 0, single wait on 7s. (Verified via `waitTiles`.)
 */

const KANCHAN_DEALER_14: readonly Tile[] = [
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

/**
 * Ryanmen example — three complete chows + a pair + a two-sided 7p-8p
 * partial. Decomposition:
 *   chi 2m-3m-4m + chi 5m-6m-7m + chi 2p-3p-4p + pair 5s-5s + ryanmen 7p-8p
 * Waits: 6p OR 9p (2 tiles, the canonical "two-sided open run" shape).
 */
const RYANMEN_HAND_13: readonly Tile[] = [
  { kind: 'suit', suit: 'man', rank: 2, copy: 0 },
  { kind: 'suit', suit: 'man', rank: 3, copy: 0 },
  { kind: 'suit', suit: 'man', rank: 4, copy: 0 },
  { kind: 'suit', suit: 'man', rank: 5, copy: 0 },
  { kind: 'suit', suit: 'man', rank: 6, copy: 0 },
  { kind: 'suit', suit: 'man', rank: 7, copy: 0 },
  { kind: 'suit', suit: 'pin', rank: 2, copy: 0 },
  { kind: 'suit', suit: 'pin', rank: 3, copy: 0 },
  { kind: 'suit', suit: 'pin', rank: 4, copy: 0 },
  { kind: 'suit', suit: 'sou', rank: 5, copy: 0 },
  { kind: 'suit', suit: 'sou', rank: 5, copy: 1 },
  { kind: 'suit', suit: 'pin', rank: 7, copy: 0 },
  { kind: 'suit', suit: 'pin', rank: 8, copy: 0 },
];

/**
 * Shanpon example — one pung + two chows + two pairs. Decomposition:
 *   pung 1m-1m-1m + chi 2p-3p-4p + chi 5s-6s-7s + pair 9m-9m + pair 5p-5p
 * Waits: 9m OR 5p (2 tiles, each completes one pair into a triplet
 * with the other staying as the eyes).
 */
const SHANPON_HAND_13: readonly Tile[] = [
  { kind: 'suit', suit: 'man', rank: 1, copy: 0 },
  { kind: 'suit', suit: 'man', rank: 1, copy: 1 },
  { kind: 'suit', suit: 'man', rank: 1, copy: 2 },
  { kind: 'suit', suit: 'pin', rank: 2, copy: 0 },
  { kind: 'suit', suit: 'pin', rank: 3, copy: 0 },
  { kind: 'suit', suit: 'pin', rank: 4, copy: 0 },
  { kind: 'suit', suit: 'sou', rank: 5, copy: 0 },
  { kind: 'suit', suit: 'sou', rank: 6, copy: 0 },
  { kind: 'suit', suit: 'sou', rank: 7, copy: 0 },
  { kind: 'suit', suit: 'man', rank: 9, copy: 0 },
  { kind: 'suit', suit: 'man', rank: 9, copy: 1 },
  { kind: 'suit', suit: 'pin', rank: 5, copy: 0 },
  { kind: 'suit', suit: 'pin', rank: 5, copy: 1 },
];

/**
 * Tanki example — one pung + three chows + a lone tile. Decomposition:
 *   pung 1m-1m-1m + chi 2m-3m-4m + chi 5p-6p-7p + chi 7s-8s-9s + lone 5s
 * Waits: 5s (1 tile, the pair-completing single).
 */
const TANKI_HAND_13: readonly Tile[] = [
  { kind: 'suit', suit: 'man', rank: 1, copy: 0 },
  { kind: 'suit', suit: 'man', rank: 1, copy: 1 },
  { kind: 'suit', suit: 'man', rank: 1, copy: 2 },
  { kind: 'suit', suit: 'man', rank: 2, copy: 0 },
  { kind: 'suit', suit: 'man', rank: 3, copy: 0 },
  { kind: 'suit', suit: 'man', rank: 4, copy: 0 },
  { kind: 'suit', suit: 'pin', rank: 5, copy: 0 },
  { kind: 'suit', suit: 'pin', rank: 6, copy: 0 },
  { kind: 'suit', suit: 'pin', rank: 7, copy: 0 },
  { kind: 'suit', suit: 'sou', rank: 7, copy: 0 },
  { kind: 'suit', suit: 'sou', rank: 8, copy: 0 },
  { kind: 'suit', suit: 'sou', rank: 9, copy: 0 },
  { kind: 'suit', suit: 'sou', rank: 5, copy: 0 },
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
  prepareState: (state) => installSeat0Hand(state, KANCHAN_DEALER_14),
  steps: [
    {
      id: 'intro',
      caption: {
        title: 'Reading your waits',
        body: 'Once your hand is one tile away from winning — 聽牌 (tenpai) — the shape of the missing piece matters. A wait on one closed-middle tile is much narrower than a wait on a two-sided open run. This lesson walks through the four classic shapes: kanchan, ryanmen, shanpon, and tanki — with a fresh example hand for each.',
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
        body: "Look at the badge: you're waiting on 7-sou — that's a kanchan, a closed-middle gap. The wait tile sits between the 6-sou and 8-sou you're holding. Kanchan waits are the narrowest of the four shapes (only the inner tile completes them) — 4 copies of one face in the deck at best, and any already-discarded copies cut into that.",
      },
      targetId: 'ready-hand-badge',
      ctaLabel: 'Got it',
    },
    {
      id: 'ryanmen',
      caption: {
        title: '2 / 4 — Ryanmen (兩面)',
        body: "Fresh hand: now you're holding 7-pin 8-pin and the badge shows waits on 6-pin OR 9-pin. That's a ryanmen — a two-sided open run, accepting the tile on either end. Twice the deck coverage of a kanchan (up to 8 copies across two faces). When you're shaping a hand from scratch, prefer building toward open runs like this over closed gaps — the ryanmen is the strongest of the open-wait shapes.",
      },
      targetId: 'ready-hand-badge',
      ctaLabel: 'Got it',
      setupBeforeStep: (state) => installSeat0Hand(state, RYANMEN_HAND_13),
    },
    {
      id: 'shanpon',
      caption: {
        title: '3 / 4 — Shanpon (雙碰)',
        body: "New hand again. You're holding two pairs — 9-man 9-man and 5-pin 5-pin — alongside three complete melds. The badge shows waits on 9-man OR 5-pin: whichever lands first becomes the third copy that completes one pair into a triplet, and the other pair stays as the eyes. That's a shanpon (pair-pair) wait — up to 4 copies across two faces, but each pair locks up two tiles you can't safely discard.",
      },
      targetId: 'ready-hand-badge',
      ctaLabel: 'Got it',
      setupBeforeStep: (state) => installSeat0Hand(state, SHANPON_HAND_13),
    },
    {
      id: 'tanki',
      caption: {
        title: '4 / 4 — Tanki (單騎)',
        body: "Final shape: four complete melds and a single lone 5-sou, waiting on its pair. The badge confirms a one-tile wait on 5-sou. That's a tanki (single-tile) wait — the inverse of a shanpon. Tanki waits are flexible (you can swap which face you wait on by holding a different singleton) but slow (you need a specific face to land in your hand). Often the wait of last resort when the rest of your hand froze early.",
      },
      targetId: 'ready-hand-badge',
      ctaLabel: 'Got it',
      setupBeforeStep: (state) => installSeat0Hand(state, TANKI_HAND_13),
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
 * Replace seat 0's hand with `target`, preserving the 136-tile multiset
 * invariant. Strategy: for each target tile, locate one matching copy
 * somewhere on the board (in any hand, the wall, or the dead wall),
 * swap it with whatever currently sits at seat 0's hand position.
 * Tiles that get displaced from seat 0 cascade into the donor location.
 *
 * Accepts any `target` length so the same helper drives the 14-tile
 * dealer setup (via `prepareState`) and the 13-tile post-discard
 * swaps (via per-step `setupBeforeStep` for ryanmen / shanpon / tanki).
 *
 * Approach: build a `targetIds` multiset (using `tileId` keys),
 * walk seat 0's current hand and either keep tiles that are needed or
 * mark them as surplus. The donor pool is the other three hands +
 * wall + deadWall, scanned in that order. Throws if a required tile
 * cannot be found — that would indicate a target-hand typo (e.g.
 * asking for 5 copies of one face). When `target.length` matches the
 * current seat-0 hand length the surplus / deficit counts balance
 * exactly; when they differ (we don't currently use mismatched
 * lengths, but the helper allows it), surplus tiles are returned to
 * the donor pool and any shortfall is taken without backfill.
 */
function installSeat0Hand(state: GameState, target: readonly Tile[]): GameState {
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
  // count) until surplus is exhausted, then splice the donor slot
  // when no surplus is left. This works for both equal-length
  // replacements (full swap, no net change in counts anywhere) and
  // shrink/grow replacements (surplus drains first, then we splice).
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
        throw new Error(
          `wait-shapes installSeat0Hand: required tile id ${id} not found on the board`,
        );
      }
    }
  }

  // Any surplus tiles still floating (when target shrank seat 0's
  // hand) need a home — push them onto the wall to preserve the
  // 136-tile invariant. Today we only call with target.length 13 or
  // 14, and seat 0's current hand is always 13 or 14, so surplus is
  // either empty or matches the deficit and gets fully consumed
  // above. Keep the fallback for safety.
  while (surplus.length > 0) {
    wall.push(surplus.pop()!);
  }

  hands[0] = [...keep, ...acquired];

  return {
    ...state,
    hands,
    wall,
    deadWall,
  };
}
