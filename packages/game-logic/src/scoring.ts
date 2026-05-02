import type { FaanBreakdown, GameState, Seat } from './state.js';
import { DRAGONS, WINDS, isDragon, isHonor, isTerminalOrHonor, sameFace } from './tiles.js';
import type { Honor, Tile, Wind } from './tiles.js';

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

  function add(name: string, english: string, faan: number, tiles: Tile[]) {
    breakdown.push({ name, english, faan, tiles });
  }

  if (selfDraw) add('自摸', 'self-draw', 1, [winningTile]);
  if (selfDraw && exposed.length === 0) add('門前清', 'concealed self-draw', 1, [winningTile]);

  if (allTiles.every(isHonor)) add('字一色', 'all honors', 10, allTiles);

  const suits = new Set(
    allTiles.filter((t) => t.kind === 'suit').map((t) => (t as { suit: string }).suit),
  );
  const hasHonors = allTiles.some(isHonor);
  if (!hasHonors && suits.size === 1) add('清一色', 'full flush', 7, allTiles);
  if (hasHonors && suits.size === 1) add('混一色', 'half flush', 3, allTiles);

  const allTriplets = exposed.every((m) => m.kind !== 'chi') && hasNoConcealedRun(concealed);
  if (allTriplets) add('對對和', 'all triplets', 3, allTiles);

  const allRuns = exposed.every((m) => m.kind === 'chi');
  if (
    allRuns &&
    hasOnlyRunsConcealed(concealed) &&
    !pairIsYakuhai(concealed, state.prevailingWind, winner)
  ) {
    add('平和', 'all sequences', 1, allTiles);
  }

  const dragonTrips = DRAGONS.map((d) => ({
    d,
    tiles: findN(allTiles, (t) => t.kind === 'honor' && t.honor === d, 3),
  })).filter((x) => x.tiles.length === 3);
  const allDragonTripTiles = dragonTrips.flatMap((x) => x.tiles);
  if (dragonTrips.length === 3) {
    add('大三元', 'big three dragons', 8, allDragonTripTiles);
  } else if (dragonTrips.length === 2) {
    const dragonPair = findN(allTiles, isDragon, 2);
    if (dragonPair.length === 2) {
      add('小三元', 'small three dragons', 5, [...allDragonTripTiles, ...dragonPair]);
    }
  }

  const windTrips = WINDS.map((w) => ({
    w,
    tiles: findN(allTiles, (t) => t.kind === 'honor' && t.honor === w, 3),
  })).filter((x) => x.tiles.length === 3);
  const allWindTripTiles = windTrips.flatMap((x) => x.tiles);
  if (windTrips.length === 4) {
    add('大四喜', 'big four winds', 13, allWindTripTiles);
  } else if (windTrips.length === 3) {
    const windPair = findN(
      allTiles,
      (t) => t.kind === 'honor' && (WINDS as readonly Honor[]).includes(t.honor),
      2,
    );
    if (windPair.length === 2) {
      add('小四喜', 'small four winds', 6, [...allWindTripTiles, ...windPair]);
    }
  }

  // HK rules stack bonuses: each individual 三元牌 X also adds +1 on top of
  // 大三元/小三元, so we emit them as separate breakdown entries.
  for (const trip of dragonTrips) {
    add(`三元牌 ${trip.d}`, 'dragon triplet', 1, trip.tiles);
  }

  const seatWind: Wind = WINDS[(winner - state.dealer + 4) % 4]!;
  const prevailingTrip = findN(
    allTiles,
    (t) => t.kind === 'honor' && t.honor === state.prevailingWind,
    3,
  );
  if (prevailingTrip.length === 3) {
    add(`圈風 ${state.prevailingWind}`, 'prevailing-wind triplet', 1, prevailingTrip);
  }
  if (seatWind !== state.prevailingWind) {
    const seatTrip = findN(allTiles, (t) => t.kind === 'honor' && t.honor === seatWind, 3);
    if (seatTrip.length === 3) {
      add(`門風 ${seatWind}`, 'seat-wind triplet', 1, seatTrip);
    }
  }

  if (allTiles.every(isTerminalOrHonor)) add('么九', 'all terminals/honors', 10, allTiles);

  const faan = breakdown.reduce((s, b) => s + b.faan, 0);
  return { faan, breakdown };
}

/** Return the first `n` same-face tiles matching `pred`, or [] if not enough exist. */
function findN(tiles: readonly Tile[], pred: (t: Tile) => boolean, n: number): Tile[] {
  let target: Tile | undefined;
  const collected: Tile[] = [];
  for (const t of tiles) {
    if (!pred(t)) continue;
    if (!target) {
      target = t;
      collected.push(t);
    } else if (sameFace(t, target)) {
      collected.push(t);
      if (collected.length === n) return collected;
    }
  }
  return [];
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
