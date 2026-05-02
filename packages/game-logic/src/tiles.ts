export type Suit = 'man' | 'pin' | 'sou';
export type SuitRank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
export type Honor = 'E' | 'S' | 'W' | 'N' | 'Z' | 'F' | 'B';
export type Copy = 0 | 1 | 2 | 3;

export type Tile =
  | { kind: 'suit'; suit: Suit; rank: SuitRank; copy: Copy }
  | { kind: 'honor'; honor: Honor; copy: Copy };

export const SUITS: readonly Suit[] = ['man', 'pin', 'sou'] as const;
export const HONORS: readonly Honor[] = ['E', 'S', 'W', 'N', 'Z', 'F', 'B'] as const;
export const RANKS: readonly SuitRank[] = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export const COPIES: readonly Copy[] = [0, 1, 2, 3] as const;

export const TOTAL_TILES = 136;

/** Pack a tile into a 0..135 integer for compact wire encoding and Map keys. */
export function tileId(t: Tile): number {
  if (t.kind === 'suit') {
    const s = SUITS.indexOf(t.suit);
    return s * 36 + (t.rank - 1) * 4 + t.copy;
  }
  const h = HONORS.indexOf(t.honor);
  return 27 * 4 + h * 4 + t.copy;
}

export function tileFromId(id: number): Tile {
  if (id < 27 * 4) {
    const s = Math.floor(id / 36);
    const rank = (Math.floor(id / 4) % 9) + 1;
    const copy = id % 4;
    return {
      kind: 'suit',
      suit: SUITS[s]!,
      rank: rank as SuitRank,
      copy: copy as Copy,
    };
  }
  const rest = id - 27 * 4;
  const h = Math.floor(rest / 4);
  const copy = rest % 4;
  return { kind: 'honor', honor: HONORS[h]!, copy: copy as Copy };
}

/** Equality ignoring copy index (i.e. "same face"). */
export function sameFace(a: Tile, b: Tile): boolean {
  if (a.kind === 'suit' && b.kind === 'suit') return a.suit === b.suit && a.rank === b.rank;
  if (a.kind === 'honor' && b.kind === 'honor') return a.honor === b.honor;
  return false;
}

/** Strict equality including copy index. */
export function sameTile(a: Tile, b: Tile): boolean {
  return tileId(a) === tileId(b);
}

/** Build the canonical 136-tile multiset (unsorted). */
export function buildWall(): Tile[] {
  const wall: Tile[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      for (const copy of COPIES) wall.push({ kind: 'suit', suit, rank, copy });
    }
  }
  for (const honor of HONORS) {
    for (const copy of COPIES) wall.push({ kind: 'honor', honor, copy });
  }
  return wall;
}

export function isHonor(t: Tile): boolean {
  return t.kind === 'honor';
}

export function isTerminal(t: Tile): boolean {
  return t.kind === 'suit' && (t.rank === 1 || t.rank === 9);
}

export function isTerminalOrHonor(t: Tile): boolean {
  return isHonor(t) || isTerminal(t);
}

/** Stable order suitable for hand display: man < pin < sou < honors; within suit by rank then copy. */
export function tileOrder(t: Tile): number {
  return tileId(t);
}

export function sortHand(tiles: readonly Tile[]): Tile[] {
  return [...tiles].sort((a, b) => tileOrder(a) - tileOrder(b));
}

/** Human-readable identifier — useful in tests. e.g. "5m", "E", "Z". */
export function tileLabel(t: Tile): string {
  if (t.kind === 'suit') {
    const s = t.suit === 'man' ? 'm' : t.suit === 'pin' ? 'p' : 's';
    return `${t.rank}${s}`;
  }
  return t.honor;
}
