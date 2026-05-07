import { type FaanBreakdown, type GameState, SEATS, type Seat } from './state.js';
import {
  DRAGONS,
  WINDS,
  isDragon,
  isHonor,
  isTerminal,
  isTerminalOrHonor,
  sameFace,
  tileId,
} from './tiles.js';
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
  // 門前清: no melds claimed from anyone, regardless of self-draw vs ron.
  // Stacks with 自摸 (a self-draw on a fully concealed hand scores both).
  if (exposed.length === 0) add('門前清', 'concealed hand', 1, [winningTile]);

  // 槓上開花 / 槓上槓: win on a gang-replacement draw. The engine
  // increments `state.gangReplacementCount` inside
  // `declareGangConcealed` / `declareGangPromoted` and resets it on
  // any discard, so a non-zero count at win time means we're still
  // inside the chain. Only meaningful for self-draw (ron on someone
  // else's gang replacement isn't possible — it goes straight to
  // their hand without a discard window).
  if (selfDraw && state.gangReplacementCount >= 2) {
    add('槓上槓', 'double kong replacement', 9, [winningTile]);
  } else if (selfDraw && state.gangReplacementCount === 1) {
    add('槓上開花', 'kong replacement', 2, [winningTile]);
  }

  // 海底撈月: win on the last tile from the live wall, or the final
  // discard before the wall would otherwise empty into a draw-game.
  // Excluded when the win came off a gang replacement (the winning
  // tile was from the dead wall, not the live wall) — that's already
  // covered by 槓上開花 / 槓上槓.
  if (state.wall.length === 0 && state.gangReplacementCount === 0) {
    add('海底撈月', 'last tile', 1, [winningTile]);
  }

  // 天/地/人糊: the three "blessing" hands. All depend on no
  // intervening play (zero claimed melds across the whole table)
  // and very specific discard-pile contents:
  //   - 天糊: dealer wins on opening 14-tile self-draw. Discards
  //     entirely empty.
  //   - 地糊: non-dealer wins on the dealer's first discard.
  //     Exactly one discard total, and it's the dealer's.
  //   - 人糊: non-dealer wins on their first own self-draw. The
  //     winning seat hasn't discarded yet.
  const totalDiscards = SEATS.reduce((n: number, s) => n + state.discards[s].length, 0);
  const totalMelds = SEATS.reduce((n: number, s) => n + state.melds[s].length, 0);
  if (selfDraw && winner === state.dealer && totalDiscards === 0 && totalMelds === 0) {
    add('天糊', 'blessing of heaven', 13, allTiles);
  } else if (
    !selfDraw &&
    winner !== state.dealer &&
    totalDiscards === 1 &&
    state.discards[state.dealer].length === 1 &&
    totalMelds === 0
  ) {
    add('地糊', 'blessing of earth', 13, allTiles);
  } else if (
    selfDraw &&
    winner !== state.dealer &&
    state.discards[winner].length === 0 &&
    state.melds[winner].length === 0
  ) {
    add('人糊', 'blessing of man', 13, allTiles);
  }

  // All-honors win — the canonical 字一色. Implicitly includes the
  // 對對和 baseline (you can't form sequences out of honors), so
  // we suppress 對對和 when this fires.
  const allHonors = allTiles.every(isHonor);
  if (allHonors) add('字一色', 'all honors', 10, allTiles);

  // Terminal-only / terminal-and-honor variants. Both shapes imply
  // 對對和 (no run can be made out of just 1s/9s without a 2/8), so
  // they replace it. Distinguish:
  //   - 清么九: only 1s and 9s, no honors. Highest grade (13).
  //   - 混么九: 1s/9s and at least one honor (and not all-honors).
  //     The sheet's 4 fan already includes the 3 of 對對和.
  const everyTerminalOrHonor = !allHonors && allTiles.every(isTerminalOrHonor);
  const everyTerminal = !allHonors && allTiles.every(isTerminal);
  if (everyTerminal) {
    add('清么九', 'all terminals', 13, allTiles);
  } else if (everyTerminalOrHonor) {
    add('混么九', 'mixed terminals', 4, allTiles);
  }

  const suits = new Set(
    allTiles.filter((t) => t.kind === 'suit').map((t) => (t as { suit: string }).suit),
  );
  const hasHonors = allTiles.some(isHonor);
  // 九蓮寶燈 (Nine Gates): 1112345678999 of one suit + a 14th tile of
  // the same suit. Strictly-concealed (no claimed melds). Sits under
  // 清一色 in the rule sheet — replaces it.
  const isNineGates = isNineGatesShape(concealed, exposed.length, suits, hasHonors);
  if (!hasHonors && suits.size === 1) {
    if (isNineGates) {
      add('九蓮寶燈', 'nine gates', 13, allTiles);
    } else {
      add('清一色', 'full flush', 7, allTiles);
    }
  }
  if (hasHonors && suits.size === 1) add('混一色', 'half flush', 3, allTiles);

  // 十三幺 / 七對子 — non-standard winning shapes. Both demand the
  // hand be fully concealed (no claimed melds) and replace any
  // 對對和 / 平和 scoring entirely. Detected by tile-count signature
  // independent of the standard 4-sets-and-pair decomposition.
  const isThirteenOrphans = exposed.length === 0 && detectThirteenOrphans(concealed);
  const isSevenPairs = exposed.length === 0 && detectSevenPairs(concealed);
  if (isThirteenOrphans) add('十三幺', 'thirteen orphans', 13, allTiles);
  if (isSevenPairs && !isThirteenOrphans) add('七對子', 'seven pairs', 4, allTiles);
  // Gate the standard-shape patterns (對對和 / 平和 / 四暗刻 / 四槓子)
  // on having ruled out the special shapes — a 7-pair hand of
  // non-consecutive ranks would otherwise pass `hasNoConcealedRun`
  // and falsely trigger the all-triplets path.
  const standardShape = !isThirteenOrphans && !isSevenPairs;

  const allTriplets =
    standardShape && exposed.every((m) => m.kind !== 'chi') && hasNoConcealedRun(concealed);
  // 四暗刻: every triplet is concealed. Requires no exposed melds at
  // all (a peng / exposed gang would expose a triplet). On a ron win
  // the winning tile must complete the pair — if it completes a
  // triplet, that triplet is exposed-by-rule (only 三暗刻).
  const winFaceCount = concealed.filter((t) => sameFace(t, winningTile)).length;
  const isFourConcealed = allTriplets && exposed.length === 0 && (selfDraw || winFaceCount === 2);
  // 四槓子: every set is a gang. The hand size grows because each
  // gang is 4 tiles + a dead-wall replacement, but `state.melds` still
  // has length 4.
  const isFourGangs =
    exposed.length === 4 &&
    exposed.every(
      (m) => m.kind === 'gang-exposed' || m.kind === 'gang-concealed' || m.kind === 'gang-promoted',
    );
  // Suppress 對對和 when a stronger triplet-implying pattern fires
  // above (字一色, 清么九, 混么九, 四暗刻, 四槓子) — those subsume it.
  const tripletsCovered = allHonors || everyTerminal || everyTerminalOrHonor;
  if (allTriplets && !tripletsCovered && !isFourConcealed && !isFourGangs) {
    add('對對和', 'all triplets', 3, allTiles);
  }
  if (isFourConcealed) add('四暗刻', 'all concealed triplets', 8, allTiles);
  if (isFourGangs) add('四槓子', 'all gangs', 13, allTiles);

  const allRuns = standardShape && exposed.every((m) => m.kind === 'chi');
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
  // Score seat-wind triplet independently. When seat == prevailing,
  // both fire and the triplet is worth the rule-sheet's "2 fan when
  // both" via two separate 1-fan entries. The pre-fix code gated this
  // on `seatWind !== prevailingWind` and quietly dropped the second fan.
  const seatTrip = findN(allTiles, (t) => t.kind === 'honor' && t.honor === seatWind, 3);
  if (seatTrip.length === 3) {
    add(`門風 ${seatWind}`, 'seat-wind triplet', 1, seatTrip);
  }

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

/**
 * 九蓮寶燈 detection: a single-suit, fully-concealed hand with rank
 * counts that include 3+ copies of rank 1, 3+ copies of rank 9, and
 * at least one of every rank 2-8. The 14th tile lifts one rank's
 * count by 1, so any of the resulting count-shapes
 * `[3,1,1,1,1,1,1,1,3]` plus any +1 are accepted.
 */
function isNineGatesShape(
  concealed: readonly Tile[],
  exposedLen: number,
  suits: ReadonlySet<string>,
  hasHonors: boolean,
): boolean {
  if (exposedLen !== 0) return false;
  if (hasHonors) return false;
  if (suits.size !== 1) return false;
  if (concealed.length !== 14) return false;
  const counts = new Array(9).fill(0);
  for (const t of concealed) {
    if (t.kind !== 'suit') return false;
    counts[t.rank - 1]!++;
  }
  if (counts[0]! < 3 || counts[8]! < 3) return false;
  for (let i = 1; i <= 7; i++) if (counts[i]! < 1) return false;
  return true;
}

/** Collapse a tile to a face-id Map key (ignores `copy`). */
function faceKey(t: Tile): number {
  // Tile IDs are `<face-base> + copy`; dividing out the copy bits
  // gives a stable per-face key suitable for Map lookups.
  return Math.floor(tileId(t) / 4);
}

function countFaces(tiles: readonly Tile[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const t of tiles) {
    const key = faceKey(t);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * 十三幺 detection: 13 distinct terminal-or-honor faces with one
 * appearing twice (the pair) and the others once each.
 */
function detectThirteenOrphans(concealed: readonly Tile[]): boolean {
  if (concealed.length !== 14) return false;
  if (!concealed.every(isTerminalOrHonor)) return false;
  const counts = countFaces(concealed);
  if (counts.size !== 13) return false;
  let pairs = 0;
  for (const c of counts.values()) {
    if (c === 2) pairs++;
    else if (c !== 1) return false;
  }
  return pairs === 1;
}

/**
 * 七對子 detection: exactly seven distinct face-pairs in the
 * concealed hand. Every face appears exactly twice; no triplets,
 * runs, or singletons.
 */
function detectSevenPairs(concealed: readonly Tile[]): boolean {
  if (concealed.length !== 14) return false;
  const counts = countFaces(concealed);
  if (counts.size !== 7) return false;
  for (const c of counts.values()) if (c !== 2) return false;
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
