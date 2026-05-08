import type { Meld } from './hand.js';
import { scoreHand } from './scoring.js';
import { isWinning } from './shanten.js';
import type { Claim, ClaimRound, GameState, Seat } from './state.js';
import { computeTurnDeadline, nextSeat } from './state.js';
import { sameFace } from './tiles.js';
import type { Tile } from './tiles.js';

/**
 * Resolve a completed claim round to a single winner. Returns:
 *   - { kind: 'win'; seat; claim }   for the highest-priority non-pass claim
 *   - { kind: 'pass' }               if all seats passed (or none submitted)
 *
 * Priority (highest first):
 *   1. hu (win). If multiple, the seat closest counter-clockwise to the
 *      discarder wins.
 *   2. peng / gang  (peng and gang are equivalent for ordering — only one
 *      seat can hold three or four copies, so they don't truly compete).
 *   3. chi (only the next seat after the discarder is eligible).
 *
 * The function is pure: it inspects only `round` and never mutates state.
 */
export type ClaimResolution =
  | { kind: 'win'; seat: Seat; claim: Exclude<Claim, { kind: 'pass' }> }
  | { kind: 'pass' };

export function resolveClaims(round: ClaimRound): ClaimResolution {
  const seats = Object.keys(round.submitted).map((s) => Number(s) as Seat);
  const submissions = seats
    .map((seat) => ({ seat, claim: round.submitted[seat]! }))
    .filter((s) => s.claim.kind !== 'pass') as {
    seat: Seat;
    claim: Exclude<Claim, { kind: 'pass' }>;
  }[];

  if (submissions.length === 0) return { kind: 'pass' };

  // 1. hu wins — pick the closest counter-clockwise to the discarder.
  const wins = submissions.filter((s) => s.claim.kind === 'hu');
  if (wins.length > 0) {
    const best = pickClosestCcw(wins, round.discard.from);
    return { kind: 'win', seat: best.seat, claim: best.claim };
  }

  // 2. peng / gang
  const pengs = submissions.filter((s) => s.claim.kind === 'peng' || s.claim.kind === 'gang');
  if (pengs.length > 0) {
    return { kind: 'win', seat: pengs[0]!.seat, claim: pengs[0]!.claim };
  }

  // 3. chi (next seat only — should be enforced upstream too)
  const chis = submissions.filter((s) => s.claim.kind === 'chi');
  if (chis.length > 0) {
    const next = nextSeat(round.discard.from);
    const valid = chis.find((s) => s.seat === next);
    if (valid) return { kind: 'win', seat: valid.seat, claim: valid.claim };
  }

  return { kind: 'pass' };
}

function pickClosestCcw<T extends { seat: Seat }>(items: T[], from: Seat): T {
  let best = items[0]!;
  let bestDist = ccwDistance(from, best.seat);
  for (let i = 1; i < items.length; i++) {
    const d = ccwDistance(from, items[i]!.seat);
    if (d < bestDist) {
      bestDist = d;
      best = items[i]!;
    }
  }
  return best;
}

function ccwDistance(from: Seat, to: Seat): number {
  return (to - from + 4) % 4;
}

/** Computes which claim kinds are legal for a given seat to declare against the current discard. */
export function legalClaimsFor(state: GameState, seat: Seat): Claim['kind'][] {
  if (state.phase !== 'awaitingClaims' || !state.lastDiscard) return [];
  if (seat === state.lastDiscard.from) return [];
  // Promoted-gang rob window: only `hu` (left to caller) is a valid
  // claim. Chi/peng/gang on a tile that's about to land in someone
  // else's gang is never legal in HK rules.
  if (state.pendingPromotedGang) return ['pass'];
  const out: Claim['kind'][] = ['pass'];
  const tile = state.lastDiscard.tile;
  const hand = state.hands[seat];
  const same = hand.filter((t) => sameFace(t, tile));
  if (same.length >= 2) out.push('peng');
  if (same.length >= 3) out.push('gang');
  if (seat === nextSeat(state.lastDiscard.from)) {
    if (canChi(hand, tile)) out.push('chi');
  }
  // hu is left to caller (must consult shanten + scoring).
  return out;
}

/**
 * Whether `seat` has any non-trivial action against the given discard:
 * a legal chi/peng/gang, OR a winning hand on `hu` that also meets
 * `state.rules.faanMin`. Mirrors what `Match.hasClaimOption` uses to
 * decide whether to render the `ClaimBar` — exposing it from the
 * engine keeps client + server + engine pre-pass logic in lockstep.
 *
 * Used by the `discard` reducer to pre-fill `submitted` with passes
 * for seats that can't act, so the hand resolves the moment all
 * "interesting" seats have weighed in (often 0–1 in practice).
 *
 * The faan-min check matters: `canFinalizeHu` in the actions reducer
 * silently demotes any hu submission below the configured floor to
 * a pass, so a shape-wise winning seat with insufficient faan can't
 * legally claim. Without this guard, those seats would surface a
 * ClaimBar with PASS as the only enabled button — a forced no-op.
 */
export function hasMeaningfulClaim(state: GameState, seat: Seat, discard: Tile): boolean {
  if (state.phase !== 'awaitingClaims' || !state.lastDiscard) return false;
  if (state.lastDiscard.from === seat) return false;
  const allowSpecial = state.rules.allowSevenPairs || state.rules.allowThirteenOrphans;
  // Promoted-gang rob window: the only meaningful action is hu —
  // legalClaimsFor returns just ['pass'] above, so the standard
  // "legal includes a non-pass" branch never fires here.
  if (state.pendingPromotedGang) {
    return canScoredHu(state, seat, discard, allowSpecial);
  }
  const legal = legalClaimsFor(state, seat);
  if (legal.some((k) => k !== 'pass')) return true;
  return canScoredHu(state, seat, discard, allowSpecial);
}

function canScoredHu(state: GameState, seat: Seat, discard: Tile, allowSpecial: boolean): boolean {
  const winnable = isWinning({
    hand: [...state.hands[seat], discard],
    exposedMelds: state.melds[seat].length,
    allowSpecial,
  });
  if (!winnable) return false;
  const score = scoreHand({
    state,
    winner: seat,
    winningTile: discard,
    selfDraw: false,
    robbingKong: state.pendingPromotedGang !== undefined,
  });
  return score.faan >= state.rules.faanMin;
}

export function canChi(hand: readonly Tile[], discard: Tile): boolean {
  if (discard.kind !== 'suit') return false;
  const suit = discard.suit;
  const r = discard.rank;
  const has = (rank: number): boolean =>
    rank >= 1 &&
    rank <= 9 &&
    hand.some((t) => t.kind === 'suit' && t.suit === suit && t.rank === rank);
  // [r-2, r-1] | [r-1, r+1] | [r+1, r+2]
  return (has(r - 2) && has(r - 1)) || (has(r - 1) && has(r + 1)) || (has(r + 1) && has(r + 2));
}

/**
 * Enumerate every legal chi completion for `discard` against `hand`.
 * Returns each option as the two tiles that would be pulled from the
 * hand to complete the run (the third tile is the discard itself).
 *
 * The discard fits into a chi as the lowest, middle, or highest of a
 * 3-tile run, giving up to three options:
 *   - low   → run is `[discard, r+1, r+2]`
 *   - mid   → run is `[r-1, discard, r+1]`
 *   - high  → run is `[r-2, r-1, discard]`
 *
 * When the hand holds multiple copies of a needed rank, this picks the
 * first match — chi semantics are face-based (a `1m` is a `1m`), so the
 * specific copy doesn't matter for resolution.
 */
export function chiOptions(hand: readonly Tile[], discard: Tile): [Tile, Tile][] {
  if (discard.kind !== 'suit') return [];
  const suit = discard.suit;
  const r = discard.rank;
  const find = (rank: number): Tile | undefined =>
    rank >= 1 && rank <= 9
      ? hand.find((t) => t.kind === 'suit' && t.suit === suit && t.rank === rank)
      : undefined;
  const out: [Tile, Tile][] = [];
  const lowMinus2 = find(r - 2);
  const lowMinus1 = find(r - 1);
  const plus1 = find(r + 1);
  const plus2 = find(r + 2);
  if (lowMinus2 && lowMinus1) out.push([lowMinus2, lowMinus1]); // discard is high
  if (lowMinus1 && plus1) out.push([lowMinus1, plus1]); // discard is mid
  if (plus1 && plus2) out.push([plus1, plus2]); // discard is low
  return out;
}

/**
 * Apply a winning non-pass claim to state: builds the meld, transitions
 * phase, and clears `pendingClaims`.
 */
export function applyClaim(
  state: GameState,
  resolution: Extract<ClaimResolution, { kind: 'win' }>,
): GameState {
  if (!state.lastDiscard) throw new Error('applyClaim: no lastDiscard');
  const { seat, claim } = resolution;
  const tile = state.lastDiscard.tile;
  const from = state.lastDiscard.from;

  if (claim.kind === 'hu') {
    // Hand the seat the turn back and clear the claim window —
    // `resolveAndApply` chains `declareWin(state, seat, false)`
    // immediately on top of this state to finalize the win in the
    // same engine step. The intermediate phase: 'turn' is a
    // transient that callers shouldn't observe.
    return {
      ...state,
      phase: 'turn',
      pendingClaims: undefined,
      turn: seat,
      // declareWin chains immediately; this turn deadline is
      // transient. Set it anyway so the field stays consistent.
      turnDeadlineMs: computeTurnDeadline(state.rules),
    };
  }

  let meld: Meld;
  let newHand = [...state.hands[seat]];
  if (claim.kind === 'peng') {
    const used: Tile[] = [];
    for (let i = 0; i < newHand.length && used.length < 2; i++) {
      if (sameFace(newHand[i]!, tile)) {
        used.push(newHand[i]!);
        newHand.splice(i, 1);
        i--;
      }
    }
    meld = { kind: 'peng', tiles: [tile, ...used], from };
  } else if (claim.kind === 'gang') {
    const used: Tile[] = [];
    for (let i = 0; i < newHand.length && used.length < 3; i++) {
      if (sameFace(newHand[i]!, tile)) {
        used.push(newHand[i]!);
        newHand.splice(i, 1);
        i--;
      }
    }
    meld = { kind: 'gang-exposed', tiles: [tile, ...used], from };
  } else {
    // chi — sort tiles by rank so the meld renders 4-5-6 even when
    // the discard came in as the middle or high tile. Without this,
    // a chi where the player held [4,6] and called the 5 displayed
    // as [5,4,6] in `MeldStrip`, which reads as out-of-order.
    const [a, b] = claim.with;
    newHand = removeOne(newHand, a);
    newHand = removeOne(newHand, b);
    const ordered = [tile, a, b].sort((x, y) => {
      // chi is suit-only by construction (canChi rejects honors).
      const xr = x.kind === 'suit' ? x.rank : 0;
      const yr = y.kind === 'suit' ? y.rank : 0;
      return xr - yr;
    });
    meld = { kind: 'chi', tiles: ordered, from };
  }

  const newMelds = { ...state.melds, [seat]: [...state.melds[seat], meld] };
  const newHands = { ...state.hands, [seat]: newHand };

  // Pop the just-claimed tile back off the discarder's pile (it now lives in the meld instead).
  const fromPile = [...state.discards[from]];
  const popIdx = lastIndex(fromPile, (t) => sameFace(t, tile));
  if (popIdx >= 0) fromPile.splice(popIdx, 1);
  const newDiscards = { ...state.discards, [from]: fromPile };

  // Same pop on the chronological log so the mobile shared pool stays
  // accurate.
  const newDiscardOrder = [...state.discardOrder];
  const orderIdx = lastIndex(newDiscardOrder, (e) => e.from === from && sameFace(e.tile, tile));
  if (orderIdx >= 0) newDiscardOrder.splice(orderIdx, 1);

  return {
    ...state,
    phase: 'turn',
    pendingClaims: undefined,
    turn: seat,
    hasDrawn: true, // claimed seat must discard next, no draw
    hands: newHands,
    melds: newMelds,
    discards: newDiscards,
    discardOrder: newDiscardOrder,
    lastDiscard: undefined,
    // The previous seat's gang chain (if any) was broken by their
    // discard; the new turn-holder starts with a fresh 0 count.
    gangReplacementCount: 0,
    turnDeadlineMs: computeTurnDeadline(state.rules),
  };
}

function lastIndex<T>(arr: readonly T[], pred: (t: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i]!)) return i;
  return -1;
}

function removeOne(hand: Tile[], target: Tile): Tile[] {
  const idx = hand.findIndex((t) => sameFace(t, target));
  if (idx < 0) throw new Error('removeOne: tile not in hand');
  const out = [...hand];
  out.splice(idx, 1);
  return out;
}
