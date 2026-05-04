import type { Seat } from '@mahjong/game-logic';
import type { SlotStatus } from './WallEdge';

/**
 * Hong Kong mahjong wall layout — given the dice break + drawn count,
 * compute a 17-stack status array per seat. A traditional table has
 * **17 stacks of 2 tiles per side** (17 × 2 × 4 = 136 tiles, matching
 * the engine's tile count); each visual slot here represents one stack
 * of two tiles, rendered as a 2-tile-tall pillbox by `WallEdge`.
 *
 * Conventions used (per the user's confirmed rules):
 *   - Two dice, sum N = 2..12.
 *   - The break wall is `(dealer + (N - 1)) % 4`, walking
 *     counter-clockwise through `nextSeat` from the dealer.
 *   - On that wall, the break is **N stacks** in from the right end
 *     (i.e. stack index `STACKS_PER_WALL - N`; sums always satisfy
 *     `N ≤ 12 < 17`).
 *   - Dead wall = 7 stacks (= 14 tiles) to the **right** of the break,
 *     wrapping onto the next wall when the count exceeds 17.
 *   - Live wall starts at the stack immediately **left** of the break
 *     and walks left, wrapping onto the **previous** wall (CCW from
 *     the break wall).
 *
 * Each stack holds 2 tiles. Drawing alternates top-then-bottom of the
 * current stack; we treat a stack as `'drawn'` once both tiles are
 * gone (`drawn / 2` floored), so a half-drawn stack still appears as
 * the next-to-draw slot. If `breakPosition` is undefined (e.g. waiting
 * phase before `startHand` populates `state.openingRolls`) we fall back
 * to a "no break, all slots live" rendering so the wall still draws.
 */

export const STACKS_PER_WALL = 17;
export const TILES_PER_STACK = 2;
export const DEAD_WALL_STACKS = 7;
export const LIVE_WALL_TILES =
  STACKS_PER_WALL * 4 * TILES_PER_STACK - DEAD_WALL_STACKS * TILES_PER_STACK;

export interface WallLayout {
  slots: Record<Seat, SlotStatus[]>;
  /** Which seat's wall the next-to-draw stack sits on — null if none. */
  nextDrawSeat: Seat | null;
  /** Stack index 0..16 within `nextDrawSeat`'s wall. */
  nextDrawSlot: number | null;
}

interface ComputeOpts {
  dealer: Seat;
  breakPosition: number | undefined;
  /** How many tiles have been drawn from the live wall so far. */
  drawn: number;
  /** Whether the local seat is currently allowed to draw (drives the pulse). */
  allowDraw: boolean;
}

function emptyAllLive(): Record<Seat, SlotStatus[]> {
  return {
    0: Array.from({ length: STACKS_PER_WALL }, () => 'live' as SlotStatus),
    1: Array.from({ length: STACKS_PER_WALL }, () => 'live' as SlotStatus),
    2: Array.from({ length: STACKS_PER_WALL }, () => 'live' as SlotStatus),
    3: Array.from({ length: STACKS_PER_WALL }, () => 'live' as SlotStatus),
  };
}

export function computeWallLayout(opts: ComputeOpts): WallLayout {
  const { dealer, breakPosition, drawn, allowDraw } = opts;
  const slots = emptyAllLive();

  if (breakPosition === undefined || breakPosition < 2 || breakPosition > 12) {
    return { slots, nextDrawSeat: null, nextDrawSlot: null };
  }

  const breakWall = ((dealer + (breakPosition - 1)) % 4) as Seat;
  const breakStack = STACKS_PER_WALL - breakPosition;

  let seat: Seat = breakWall;
  let slotIdx = breakStack;
  for (let k = 0; k < DEAD_WALL_STACKS; k++) {
    if (slotIdx >= STACKS_PER_WALL) {
      slotIdx = 0;
      seat = ((seat + 1) % 4) as Seat;
    }
    slots[seat]![slotIdx] = 'dead';
    slotIdx++;
  }

  const drawnStacks = Math.floor(drawn / TILES_PER_STACK);
  seat = breakWall;
  slotIdx = breakStack - 1;
  let nextDrawSeat: Seat | null = null;
  let nextDrawSlot: number | null = null;
  for (let k = 0; k < drawnStacks; k++) {
    if (slotIdx < 0) {
      seat = ((seat + 4 - 1) % 4) as Seat;
      slotIdx = STACKS_PER_WALL - 1;
    }
    slots[seat]![slotIdx] = 'drawn';
    slotIdx--;
  }

  if (slotIdx < 0) {
    seat = ((seat + 4 - 1) % 4) as Seat;
    slotIdx = STACKS_PER_WALL - 1;
  }
  if (slots[seat]?.[slotIdx] === 'live' && allowDraw) {
    slots[seat]![slotIdx] = 'nextDraw';
    nextDrawSeat = seat;
    nextDrawSlot = slotIdx;
  }

  return { slots, nextDrawSeat, nextDrawSlot };
}
