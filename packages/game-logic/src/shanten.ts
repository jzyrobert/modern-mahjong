import type { Tile } from './tiles.js';

/**
 * Shanten = minimum number of tile swaps needed to reach a winning shape.
 *  -1 → already winning (the hand is complete with 14 effective tiles).
 *   0 → "tenpai" (one tile away from winning).
 *
 * Three winning shapes are considered:
 *   - Standard: 4 groups + 1 pair.
 *   - Seven pairs (七對): 7 distinct pairs.
 *   - Thirteen orphans (十三幺): one of each terminal/honor + a pair on any one of them.
 */

type Counts = number[]; // length 9 (suit) or 7 (honors)

interface BlockResult {
  /** Complete groups (triplet or run). */
  g: number;
  /** Non-pair partials (ryanmen, penchan, kanchan, or unused pair). */
  p: number;
  /** Whether the decomposition has selected a pair as THE pair. */
  pair: boolean;
}

function bucket(tiles: readonly Tile[]): { suits: Counts[]; honors: Counts } {
  const suits: Counts[] = [
    new Array(9).fill(0),
    new Array(9).fill(0),
    new Array(9).fill(0),
  ];
  const honors: Counts = new Array(7).fill(0);
  for (const t of tiles) {
    if (t.kind === 'suit') {
      const sIdx = t.suit === 'man' ? 0 : t.suit === 'pin' ? 1 : 2;
      suits[sIdx]![t.rank - 1]!++;
    } else {
      const hIdx = ['E', 'S', 'W', 'N', 'Z', 'F', 'B'].indexOf(t.honor);
      honors[hIdx]!++;
    }
  }
  return { suits, honors };
}

function dedupe(arr: BlockResult[]): BlockResult[] {
  const seen = new Map<string, BlockResult>();
  for (const r of arr) {
    const k = `${r.g}:${r.p}:${r.pair ? 1 : 0}`;
    if (!seen.has(k)) seen.set(k, r);
  }
  return [...seen.values()];
}

/** Enumerate all decompositions of one suit block. */
function suitMelds(counts: Counts): BlockResult[] {
  const out: BlockResult[] = [];
  const stack: { c: Counts; idx: number; g: number; p: number; pair: boolean }[] = [
    { c: [...counts], idx: 0, g: 0, p: 0, pair: false },
  ];

  while (stack.length > 0) {
    let { c, idx, g, p, pair } = stack.pop()!;
    while (idx < 9 && c[idx] === 0) idx++;
    if (idx === 9) {
      out.push({ g, p, pair });
      continue;
    }
    // Branch: triplet
    if (c[idx]! >= 3) {
      const nc = [...c];
      nc[idx]! -= 3;
      stack.push({ c: nc, idx, g: g + 1, p, pair });
    }
    // Branch: run
    if (idx + 2 < 9 && c[idx]! >= 1 && c[idx + 1]! >= 1 && c[idx + 2]! >= 1) {
      const nc = [...c];
      nc[idx]!--;
      nc[idx + 1]!--;
      nc[idx + 2]!--;
      stack.push({ c: nc, idx, g: g + 1, p, pair });
    }
    // Branch: pair as THE pair (if we don't already have one)
    if (!pair && c[idx]! >= 2) {
      const nc = [...c];
      nc[idx]! -= 2;
      stack.push({ c: nc, idx, g, p, pair: true });
    }
    // Branch: pair as a non-pair partial (counts toward p)
    if (c[idx]! >= 2) {
      const nc = [...c];
      nc[idx]! -= 2;
      stack.push({ c: nc, idx, g, p: p + 1, pair });
    }
    // Branch: ryanmen/penchan partial
    if (idx + 1 < 9 && c[idx]! >= 1 && c[idx + 1]! >= 1) {
      const nc = [...c];
      nc[idx]!--;
      nc[idx + 1]!--;
      stack.push({ c: nc, idx, g, p: p + 1, pair });
    }
    // Branch: kanchan partial
    if (idx + 2 < 9 && c[idx]! >= 1 && c[idx + 2]! >= 1) {
      const nc = [...c];
      nc[idx]!--;
      nc[idx + 2]!--;
      stack.push({ c: nc, idx, g, p: p + 1, pair });
    }
    // Branch: floater (skip this tile)
    {
      const nc = [...c];
      nc[idx]!--;
      stack.push({ c: nc, idx, g, p, pair });
    }
  }
  return dedupe(out);
}

/** Honors decompose as triplets, pairs, or floaters — no runs. */
function honorMelds(counts: Counts): BlockResult[] {
  let frontier: BlockResult[] = [{ g: 0, p: 0, pair: false }];
  for (let i = 0; i < 7; i++) {
    const c = counts[i] ?? 0;
    const next: BlockResult[] = [];
    for (const f of frontier) {
      // skip
      next.push(f);
      if (c >= 3) next.push({ g: f.g + 1, p: f.p, pair: f.pair });
      if (!f.pair && c >= 2) next.push({ g: f.g, p: f.p, pair: true });
      if (c >= 2) next.push({ g: f.g, p: f.p + 1, pair: f.pair });
    }
    frontier = dedupe(next);
  }
  return frontier;
}

function combineBlocks(blocks: BlockResult[][]): BlockResult[] {
  let acc: BlockResult[] = [{ g: 0, p: 0, pair: false }];
  for (const block of blocks) {
    const next: BlockResult[] = [];
    for (const a of acc) {
      for (const b of block) {
        // Pair from at most one block.
        if (a.pair && b.pair) continue;
        next.push({ g: a.g + b.g, p: a.p + b.p, pair: a.pair || b.pair });
      }
    }
    acc = dedupe(next);
  }
  return acc;
}

function standardShanten(suits: Counts[], honors: Counts, alreadyGroups: number): number {
  const blocks = [
    suitMelds(suits[0]!),
    suitMelds(suits[1]!),
    suitMelds(suits[2]!),
    honorMelds(honors),
  ];
  const combos = combineBlocks(blocks);

  let best = Number.POSITIVE_INFINITY;
  for (const { g, p, pair } of combos) {
    const totalGroups = alreadyGroups + g;
    const usablePartials = Math.max(0, Math.min(p, 4 - totalGroups));
    const sh = 8 - 2 * totalGroups - usablePartials - (pair ? 1 : 0);
    if (sh < best) best = sh;
  }
  return best;
}

function sevenPairsShanten(tiles: readonly Tile[]): number {
  const { suits, honors } = bucket(tiles);
  let pairs = 0;
  let kinds = 0;
  for (const block of suits) {
    for (const c of block) {
      if (c >= 2) pairs++;
      if (c >= 1) kinds++;
    }
  }
  for (const c of honors) {
    if (c >= 2) pairs++;
    if (c >= 1) kinds++;
  }
  pairs = Math.min(pairs, 7);
  const missingKinds = Math.max(0, 7 - kinds);
  return 6 - pairs + missingKinds;
}

function thirteenOrphansShanten(tiles: readonly Tile[]): number {
  const { suits, honors } = bucket(tiles);
  const targets: number[] = [
    suits[0]![0]!,
    suits[0]![8]!,
    suits[1]![0]!,
    suits[1]![8]!,
    suits[2]![0]!,
    suits[2]![8]!,
    ...honors,
  ];
  let kinds = 0;
  let hasPair = false;
  for (const c of targets) {
    if (c >= 1) kinds++;
    if (c >= 2) hasPair = true;
  }
  return 13 - kinds - (hasPair ? 1 : 0);
}

export interface ShantenInput {
  hand: readonly Tile[];
  exposedMelds?: number;
  allowSpecial?: boolean;
}

export function shanten(input: ShantenInput): number {
  const { hand, exposedMelds = 0, allowSpecial = true } = input;
  const { suits, honors } = bucket(hand);

  const std = standardShanten(suits, honors, exposedMelds);
  if (!allowSpecial || exposedMelds > 0) return std;

  const sp = sevenPairsShanten(hand);
  const to = thirteenOrphansShanten(hand);
  return Math.min(std, sp, to);
}

export function isWinning(input: ShantenInput): boolean {
  return shanten(input) === -1;
}
