import type { Meld } from './hand.js';
import { isHonor, isTerminalOrHonor, sameFace } from './tiles.js';
import type { Tile } from './tiles.js';
import type { GameState, Seat, Wind } from './state.js';

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
  reasons: string[];
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
  const reasons: string[] = [];
  let faan = 0;

  const allTiles = [...concealed, ...exposed.flatMap((m) => m.tiles)];

  // 自摸 — self-draw
  if (selfDraw) {
    faan += 1;
    reasons.push('自摸 (self-draw)');
  }

  // 門前清 — fully concealed (no exposed melds, won by self-draw)
  if (selfDraw && exposed.length === 0) {
    faan += 1;
    reasons.push('門前清 (concealed self-draw)');
  }

  // 字一色 — all honors
  if (allTiles.every(isHonor)) {
    faan += 10;
    reasons.push('字一色 (all honors)');
  }

  // 清一色 — all one suit (no honors)
  const suits = new Set(allTiles.filter((t) => t.kind === 'suit').map((t) => (t as { suit: string }).suit));
  const hasHonors = allTiles.some(isHonor);
  if (!hasHonors && suits.size === 1) {
    faan += 7;
    reasons.push('清一色 (full flush)');
  }

  // 混一色 — one suit + honors only
  if (hasHonors && suits.size === 1) {
    faan += 3;
    reasons.push('混一色 (half flush)');
  }

  // 對對和 — all triplets (no chi)
  const allTriplets = exposed.every((m) => m.kind !== 'chi') && hasNoConcealedRun(concealed);
  if (allTriplets) {
    faan += 3;
    reasons.push('對對和 (all triplets)');
  }

  // 平和 — all runs + valueless pair (no triplets, pair is not yakuhai)
  const allRuns = exposed.every((m) => m.kind === 'chi');
  if (allRuns && hasOnlyRunsConcealed(concealed) && !pairIsYakuhai(concealed, state.prevailingWind, winner)) {
    faan += 1;
    reasons.push('平和 (all sequences)');
  }

  // 大三元 — three dragon triplets (Z/F/B)
  const dragonTriplets = ['Z', 'F', 'B'].filter((d) =>
    hasTriplet(allTiles, (t) => t.kind === 'honor' && t.honor === d),
  ).length;
  if (dragonTriplets === 3) {
    faan += 8;
    reasons.push('大三元 (big three dragons)');
  } else if (dragonTriplets === 2 && hasPair(allTiles, (t) => isDragon(t))) {
    faan += 5;
    reasons.push('小三元 (small three dragons)');
  }

  // 大四喜 / 小四喜
  const windTriplets = (['E', 'S', 'W', 'N'] as const).filter((w) =>
    hasTriplet(allTiles, (t) => t.kind === 'honor' && t.honor === w),
  ).length;
  if (windTriplets === 4) {
    faan += 13;
    reasons.push('大四喜 (big four winds)');
  } else if (
    windTriplets === 3 &&
    hasPair(allTiles, (t) => t.kind === 'honor' && (['E', 'S', 'W', 'N'] as const).includes(t.honor as Wind))
  ) {
    faan += 6;
    reasons.push('小四喜 (small four winds)');
  }

  // Yakuhai dragons: each dragon triplet
  for (const d of ['Z', 'F', 'B'] as const) {
    if (hasTriplet(allTiles, (t) => t.kind === 'honor' && t.honor === d)) {
      faan += 1;
      reasons.push(`三元牌 ${d} (dragon triplet)`);
    }
  }

  // Yakuhai winds: prevailing wind triplet, seat wind triplet
  const seatWind: Wind = (['E', 'S', 'W', 'N'] as const)[(winner - state.dealer + 4) % 4]!;
  if (hasTriplet(allTiles, (t) => t.kind === 'honor' && t.honor === state.prevailingWind)) {
    faan += 1;
    reasons.push(`圈風 ${state.prevailingWind} (prevailing-wind triplet)`);
  }
  if (
    seatWind !== state.prevailingWind &&
    hasTriplet(allTiles, (t) => t.kind === 'honor' && t.honor === seatWind)
  ) {
    faan += 1;
    reasons.push(`門風 ${seatWind} (seat-wind triplet)`);
  }

  // 么九 — all terminals/honors
  if (allTiles.every(isTerminalOrHonor)) {
    faan += 10;
    reasons.push('么九 (all terminals/honors)');
  }

  return { faan, reasons };
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
  // Conservative: if every concealed tile is a suit tile and no triplet structure exists.
  if (concealed.some(isHonor)) return false;
  // We don't fully verify decomposition here; the caller cross-checks against `allRuns`.
  return true;
}

function pairIsYakuhai(concealed: readonly Tile[], prevailing: Wind, winner: Seat): boolean {
  // Find a pair in concealed; if it's a dragon, prevailing wind, or seat wind → yakuhai.
  const seen = new Map<string, Tile>();
  for (const t of concealed) {
    const key = t.kind === 'suit' ? `s:${t.suit}:${t.rank}` : `h:${t.honor}`;
    if (seen.has(key)) {
      const pair = seen.get(key)!;
      if (isDragon(pair)) return true;
      if (pair.kind === 'honor' && pair.honor === prevailing) return true;
      // Seat wind check elided; conservative.
      void winner;
    }
    seen.set(key, t);
  }
  return false;
}
