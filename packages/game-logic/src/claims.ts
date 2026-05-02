import type { Meld } from './hand.js';
import { sameFace } from './tiles.js';
import type { Tile } from './tiles.js';
import type { Claim, ClaimRound, GameState, Seat } from './state.js';
import { nextSeat } from './state.js';

/**
 * Resolve a completed claim round to a single winner. Returns:
 *   - { kind: 'win'; seat; claim }   for the highest-priority non-pass claim
 *   - { kind: 'pass' }               if all seats passed (or none submitted)
 *
 * Priority (highest first):
 *   1. hu (win). If multiple, the seat closest counter-clockwise to the
 *      discarder wins.
 *   2. peng / gong  (peng and gong are equivalent for ordering — only one
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
    .filter((s) => s.claim.kind !== 'pass') as { seat: Seat; claim: Exclude<Claim, { kind: 'pass' }> }[];

  if (submissions.length === 0) return { kind: 'pass' };

  // 1. hu wins — pick the closest counter-clockwise to the discarder.
  const wins = submissions.filter((s) => s.claim.kind === 'hu');
  if (wins.length > 0) {
    const best = pickClosestCcw(wins, round.discard.from);
    return { kind: 'win', seat: best.seat, claim: best.claim };
  }

  // 2. peng / gong
  const pengs = submissions.filter((s) => s.claim.kind === 'peng' || s.claim.kind === 'gong');
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
  const out: Claim['kind'][] = ['pass'];
  const tile = state.lastDiscard.tile;
  const hand = state.hands[seat];
  const same = hand.filter((t) => sameFace(t, tile));
  if (same.length >= 2) out.push('peng');
  if (same.length >= 3) out.push('gong');
  if (seat === nextSeat(state.lastDiscard.from)) {
    if (canChi(hand, tile)) out.push('chi');
  }
  // hu is left to caller (must consult shanten + scoring).
  return out;
}

export function canChi(hand: readonly Tile[], discard: Tile): boolean {
  if (discard.kind !== 'suit') return false;
  const suit = discard.suit;
  const r = discard.rank;
  const has = (rank: number): boolean =>
    rank >= 1 && rank <= 9 && hand.some((t) => t.kind === 'suit' && t.suit === suit && t.rank === rank);
  // [r-2, r-1] | [r-1, r+1] | [r+1, r+2]
  return (
    (has(r - 2) && has(r - 1)) || (has(r - 1) && has(r + 1)) || (has(r + 1) && has(r + 2))
  );
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
    // Caller will follow up with declareWin; here we just mark phase.
    return {
      ...state,
      phase: 'turn',
      pendingClaims: undefined,
      turn: seat,
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
  } else if (claim.kind === 'gong') {
    const used: Tile[] = [];
    for (let i = 0; i < newHand.length && used.length < 3; i++) {
      if (sameFace(newHand[i]!, tile)) {
        used.push(newHand[i]!);
        newHand.splice(i, 1);
        i--;
      }
    }
    meld = { kind: 'kong-exposed', tiles: [tile, ...used], from };
  } else {
    // chi
    const [a, b] = claim.with;
    newHand = removeOne(newHand, a);
    newHand = removeOne(newHand, b);
    meld = { kind: 'chi', tiles: [tile, a, b], from };
  }

  const newMelds = { ...state.melds, [seat]: [...state.melds[seat], meld] };
  const newHands = { ...state.hands, [seat]: newHand };

  // Pop the just-claimed tile back off the discarder's pile (it now lives in the meld instead).
  const fromPile = [...state.discards[from]];
  const popIdx = lastIndex(fromPile, (t) => sameFace(t, tile));
  if (popIdx >= 0) fromPile.splice(popIdx, 1);
  const newDiscards = { ...state.discards, [from]: fromPile };

  return {
    ...state,
    phase: 'turn',
    pendingClaims: undefined,
    turn: seat,
    hasDrawn: true, // claimed seat must discard next, no draw
    hands: newHands,
    melds: newMelds,
    discards: newDiscards,
    lastDiscard: undefined,
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
