import type { FaanBreakdown, GameState, Seat, Wind } from './state.js';
import { isHonor, isTerminalOrHonor, sameFace } from './tiles.js';
import type { Tile } from './tiles.js';

export interface ScoringInput {
  state: GameState;
  winner: Seat;
  /** The tile that completed the hand. */
  winningTile: Tile;
  /** True if the player drew the winning tile themselves. */
  selfDraw: boolean;
}

export interface ScoreResult {
  faan: number;
  breakdown: FaanBreakdown[];
}

/**
 * Hong Kong faan calculation. Implements the most common patterns. We score
 * a flat list of patterns; faan totals are summed with a configurable cap
 * left to the caller (the rule config's `faanMin` is enforced elsewhere).
 *
 * The decomposition into groups assumes the win has already been verified
 * by `isWinning`. We re-derive groups here for pattern detection by
 * combining exposed melds with the implied concealed groups.
 */
export function scoreHand(input: ScoringInput): ScoreResult {
  const { state, winner, winningTile, selfDraw } = input;
  const concealed = [...state.hands[winner], winningTile];
  const exposed = state.melds[winner];
  const breakdown: FaanBreakdown[] = [];

  const allTiles = [...concealed, ...exposed.flatMap((m) => m.tiles)];

  function add(name: string, english: string, faan: number) {
    breakdown.push({ name, english, faan });
  }

  if (selfDraw) add('自摸', 'self-draw', 1);
  if (selfDraw && exposed.length === 0) add('門前清', 'concealed self-draw', 1);

  if (allTiles.every(isHonor)) add('字一色', 'all honors', 10);

  const suits = new Set(
    allTiles.filter((t) => t.kind === 'suit').map((t) => (t as { suit: string }).suit),
  );
  const hasHonors = allTiles.some(isHonor);
  if (!hasHonors && suits.size === 1) add('清一色', 'full flush', 7);
  if (hasHonors && suits.size === 1) add('混一色', 'half flush', 3);

  const allTriplets = exposed.every((m) => m.kind !== 'chi') && hasNoConcealedRun(concealed);
  if (allTriplets) add('對對和', 'all triplets', 3);

  const allRuns = exposed.every((m) => m.kind === 'chi');
  if (
    allRuns &&
    hasOnlyRunsConcealed(concealed) &&
    !pairIsYakuhai(concealed, state.prevailingWind, winner)
  ) {
    add('平和', 'all sequences', 1);
  }

  const dragonTriplets = ['Z', 'F', 'B'].filter((d) =>
    hasTriplet(allTiles, (t) => t.kind === 'honor' && t.honor === d),
  ).length;
  if (dragonTriplets === 3) add('大三元', 'big three dragons', 8);
  else if (dragonTriplets === 2 && hasPair(allTiles, isDragon))
    add('小三元', 'small three dragons', 5);

  const windTriplets = (['E', 'S', 'W', 'N'] as const).filter((w) =>
    hasTriplet(allTiles, (t) => t.kind === 'honor' && t.honor === w),
  ).length;
  if (windTriplets === 4) add('大四喜', 'big four winds', 13);
  else if (
    windTriplets === 3 &&
    hasPair(
      allTiles,
      (t) => t.kind === 'honor' && (['E', 'S', 'W', 'N'] as const).includes(t.honor as Wind),
    )
  ) {
    add('小四喜', 'small four winds', 6);
  }

  for (const d of ['Z', 'F', 'B'] as const) {
    if (hasTriplet(allTiles, (t) => t.kind === 'honor' && t.honor === d)) {
      add(`三元牌 ${d}`, 'dragon triplet', 1);
    }
  }

  const seatWind: Wind = (['E', 'S', 'W', 'N'] as const)[(winner - state.dealer + 4) % 4]!;
  if (hasTriplet(allTiles, (t) => t.kind === 'honor' && t.honor === state.prevailingWind)) {
    add(`圈風 ${state.prevailingWind}`, 'prevailing-wind triplet', 1);
  }
  if (
    seatWind !== state.prevailingWind &&
    hasTriplet(allTiles, (t) => t.kind === 'honor' && t.honor === seatWind)
  ) {
    add(`門風 ${seatWind}`, 'seat-wind triplet', 1);
  }

  if (allTiles.every(isTerminalOrHonor)) add('么九', 'all terminals/honors', 10);

  const faan = breakdown.reduce((s, b) => s + b.faan, 0);
  return { faan, breakdown };
}

function isDragon(t: Tile): boolean {
  return t.kind === 'honor' && (t.honor === 'Z' || t.honor === 'F' || t.honor === 'B');
}

function hasTriplet(tiles: readonly Tile[], pred: (t: Tile) => boolean): boolean {
  let count = 0;
  let target: Tile | undefined;
  for (const t of tiles) {
    if (!pred(t)) continue;
    if (!target) {
      target = t;
      count = 1;
    } else if (sameFace(t, target)) {
      count++;
    }
  }
  return count >= 3;
}

function hasPair(tiles: readonly Tile[], pred: (t: Tile) => boolean): boolean {
  let count = 0;
  let target: Tile | undefined;
  for (const t of tiles) {
    if (!pred(t)) continue;
    if (!target) {
      target = t;
      count = 1;
    } else if (sameFace(t, target)) {
      count++;
    }
  }
  return count >= 2;
}

/** Heuristic: scan the concealed tiles for any set of 3 consecutive same-suit ranks present. */
function hasNoConcealedRun(concealed: readonly Tile[]): boolean {
  for (const suit of ['man', 'pin', 'sou'] as const) {
    const counts = new Array(9).fill(0);
    for (const t of concealed) if (t.kind === 'suit' && t.suit === suit) counts[t.rank - 1]!++;
    for (let i = 0; i <= 6; i++) {
      if (counts[i]! > 0 && counts[i + 1]! > 0 && counts[i + 2]! > 0) return false;
    }
  }
  return true;
}

function hasOnlyRunsConcealed(concealed: readonly Tile[]): boolean {
  if (concealed.some(isHonor)) return false;
  return true;
}

function pairIsYakuhai(concealed: readonly Tile[], prevailing: Wind, winner: Seat): boolean {
  const seen = new Map<string, Tile>();
  for (const t of concealed) {
    const key = t.kind === 'suit' ? `s:${t.suit}:${t.rank}` : `h:${t.honor}`;
    if (seen.has(key)) {
      const pair = seen.get(key)!;
      if (isDragon(pair)) return true;
      if (pair.kind === 'honor' && pair.honor === prevailing) return true;
      void winner;
    }
    seen.set(key, t);
  }
  return false;
}
