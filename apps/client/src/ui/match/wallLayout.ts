import type { Seat } from '@mahjong/game-logic';

/**
 * Hong Kong mahjong wall layout — given the dice break + drawn count,
 * compute a per-seat list of stacks that are still visible on the table.
 *
 * Real Hong Kong tables build **17 stacks of 2 tiles per side** (17 ×
 * 2 × 4 = 136). Each stack here matches one physical pillbox. As tiles
 * are drawn the affected stack(s) shrink: a half-drawn stack shows 1
 * tile, a fully-drawn stack disappears entirely (no placeholder gap).
 * The dead wall (gang-replacement reserve) is excluded from the visual
 * because the player never sees it as separate at a real table — and a
 * faded reserve confuses casual players. Engine state (`state.wall.length`
 * + `state.deadWall.length`) still tracks both.
 *
 * Conventions used (per the user's confirmed rules):
 *   - Two dice, sum N = 2..12.
 *   - The break wall is `(dealer + (N - 1)) % 4`, walking
 *     counter-clockwise through `nextSeat` from the dealer.
 *   - On that wall, the break is **N stacks** in from the right end
 *     (i.e. stack index `STACKS_PER_WALL - N`).
 *   - Dead wall = 7 stacks (= 14 tiles) to the **right** of the break,
 *     wrapping onto the next wall when the count exceeds 17.
 *   - Live wall starts at the stack immediately **left** of the break
 *     and walks left, wrapping onto the **previous** wall (CCW from
 *     the break wall).
 */

export const STACKS_PER_WALL = 17;
export const TILES_PER_STACK = 2;
export const DEAD_WALL_STACKS = 7;
export const LIVE_WALL_TILES =
  STACKS_PER_WALL * 4 * TILES_PER_STACK - DEAD_WALL_STACKS * TILES_PER_STACK;

export interface WallSlot {
  /** Tiles still physically in this stack. 0 = drawn or dead-wall (renders
   *  as a transparent placeholder so the rest of the row keeps its
   *  original positions); 1 = half-drawn; 2 = full. */
  tiles: 0 | 1 | 2;
  /** True for the single next-to-draw slot. */
  isNextDraw: boolean;
}

export interface WallLayout {
  /** Visible stacks per seat, ordered along the wall (leftmost first). */
  slots: Record<Seat, WallSlot[]>;
  /** Which seat owns the next-to-draw stack — null if none (e.g. waiting). */
  nextDrawSeat: Seat | null;
}

interface ComputeOpts {
  dealer: Seat;
  breakPosition: number | undefined;
  /** How many tiles have been drawn from the live wall so far. */
  drawn: number;
  /** Whether the local seat is currently allowed to draw (drives the pulse). */
  allowDraw: boolean;
}

function emptyTruths(): Record<Seat, (0 | 1 | 2)[]> {
  const make = () => Array.from({ length: STACKS_PER_WALL }, () => 2 as 0 | 1 | 2);
  return { 0: make(), 1: make(), 2: make(), 3: make() };
}

function emptyAllFull(): Record<Seat, WallSlot[]> {
  const make = () =>
    Array.from({ length: STACKS_PER_WALL }, () => ({ tiles: 2 as const, isNextDraw: false }));
  return { 0: make(), 1: make(), 2: make(), 3: make() };
}

export function computeWallLayout(opts: ComputeOpts): WallLayout {
  const { dealer, breakPosition, drawn, allowDraw } = opts;

  if (breakPosition === undefined || breakPosition < 2 || breakPosition > 12) {
    return { slots: emptyAllFull(), nextDrawSeat: null };
  }

  const breakWall = ((dealer + (breakPosition - 1)) % 4) as Seat;
  const breakStack = STACKS_PER_WALL - breakPosition;
  const truths = emptyTruths();

  // Mark dead-wall stacks as 0 (hidden). Engine still tracks the gang
  // reserve, but the player doesn't see it on the felt.
  let seat: Seat = breakWall;
  let slotIdx = breakStack;
  for (let k = 0; k < DEAD_WALL_STACKS; k++) {
    if (slotIdx >= STACKS_PER_WALL) {
      slotIdx = 0;
      seat = ((seat + 1) % 4) as Seat;
    }
    truths[seat]![slotIdx] = 0;
    slotIdx++;
  }

  // Mark fully-drawn stacks as 0 and one half-drawn stack as 1, walking
  // CCW from one stack left of the break.
  const fullDrawn = Math.floor(drawn / TILES_PER_STACK);
  const halfDrawn = drawn % TILES_PER_STACK === 1;
  seat = breakWall;
  slotIdx = breakStack - 1;
  for (let k = 0; k < fullDrawn; k++) {
    if (slotIdx < 0) {
      seat = ((seat + 4 - 1) % 4) as Seat;
      slotIdx = STACKS_PER_WALL - 1;
    }
    truths[seat]![slotIdx] = 0;
    slotIdx--;
  }

  let nextDrawSeat: Seat | null = null;
  let nextDrawIdx: number | null = null;

  if (halfDrawn) {
    if (slotIdx < 0) {
      seat = ((seat + 4 - 1) % 4) as Seat;
      slotIdx = STACKS_PER_WALL - 1;
    }
    if (truths[seat]?.[slotIdx] === 2) {
      truths[seat]![slotIdx] = 1;
      nextDrawSeat = seat;
      nextDrawIdx = slotIdx;
    }
  } else {
    // Next-draw is the next live (full) stack, if there is one.
    let probeSeat = seat;
    let probeIdx = slotIdx;
    if (probeIdx < 0) {
      probeSeat = ((probeSeat + 4 - 1) % 4) as Seat;
      probeIdx = STACKS_PER_WALL - 1;
    }
    if (truths[probeSeat]?.[probeIdx] === 2) {
      nextDrawSeat = probeSeat;
      nextDrawIdx = probeIdx;
    }
  }

  // Always emit STACKS_PER_WALL slots per seat, including 0-tile entries
  // for drawn or dead-wall positions. The renderer turns those into
  // transparent placeholders so the still-visible stacks keep their
  // original positions on the felt as draws happen — the wall doesn't
  // shrink and recenter as tiles get pulled.
  const slots: Record<Seat, WallSlot[]> = { 0: [], 1: [], 2: [], 3: [] };
  for (const s of [0, 1, 2, 3] as const) {
    const t = truths[s];
    for (let i = 0; i < STACKS_PER_WALL; i++) {
      const tile = (t?.[i] ?? 0) as 0 | 1 | 2;
      const isNextDraw = allowDraw && nextDrawSeat === s && nextDrawIdx === i;
      slots[s].push({ tiles: tile, isNextDraw });
    }
  }

  return { slots, nextDrawSeat: allowDraw ? nextDrawSeat : null };
}
