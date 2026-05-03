import type { Seat } from '@mahjong/game-logic';
import type { SlotStatus } from './WallEdge.js';

/**
 * Hong Kong mahjong wall layout — given the dice break + drawn count,
 * compute a 36-slot status array per seat. Each seat's wall has 36 tile
 * slots (real tables have 18 stacks of 2 = 36 tiles per wall, but our
 * single-row visualization compresses each stack to one slot).
 *
 * Conventions used (per the user's confirmed rules):
 *   - Two dice, sum N = 2..12.
 *   - The break wall is `(dealer + (N - 1) % 4) % 4`, walking
 *     counter-clockwise through `nextSeat` from the dealer.
 *   - On that wall, the break is `2 * N` tiles in from the right end
 *     (i.e. slot index `36 - 2*N` if 2N ≤ 36; sums always satisfy
 *     this since 2*12 = 24 ≤ 36).
 *   - Dead wall = 14 tiles to the **right** of the break, wrapping
 *     onto the next wall when the count exceeds 36.
 *   - Live wall starts at the slot immediately **left** of the break
 *     and walks left, wrapping onto the **previous** wall (CCW from
 *     the break wall, which is `(s + 4 - 1) % 4` in seat terms — the
 *     wall whose owner sits to the dealer's right when sum=2, etc.).
 *
 * If `breakPosition` is undefined (e.g. waiting phase before
 * `startHand` populates `state.openingRolls`) we fall back to a
 * "no break, all slots live" rendering so the wall still draws.
 */

export const SLOTS_PER_WALL = 36;
export const DEAD_WALL_TILES = 14;
export const LIVE_WALL_TILES = SLOTS_PER_WALL * 4 - DEAD_WALL_TILES; // 130

export interface WallLayout {
  slots: Record<Seat, SlotStatus[]>;
  /** Which seat's wall the next-to-draw tile sits on — null if none. */
  nextDrawSeat: Seat | null;
  /** Slot index 0..35 within `nextDrawSeat`'s wall. */
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

/** All slots `live` — used as a fallback when dice info is unavailable. */
function emptyAllLive(): Record<Seat, SlotStatus[]> {
  return {
    0: Array.from({ length: SLOTS_PER_WALL }, () => 'live' as SlotStatus),
    1: Array.from({ length: SLOTS_PER_WALL }, () => 'live' as SlotStatus),
    2: Array.from({ length: SLOTS_PER_WALL }, () => 'live' as SlotStatus),
    3: Array.from({ length: SLOTS_PER_WALL }, () => 'live' as SlotStatus),
  };
}

export function computeWallLayout(opts: ComputeOpts): WallLayout {
  const { dealer, breakPosition, drawn, allowDraw } = opts;
  const slots = emptyAllLive();

  if (breakPosition === undefined || breakPosition < 2 || breakPosition > 12) {
    return { slots, nextDrawSeat: null, nextDrawSlot: null };
  }

  const breakWall = ((dealer + (breakPosition - 1)) % 4) as Seat;
  const breakSlot = SLOTS_PER_WALL - 2 * breakPosition; // tile index 0..35

  // Mark dead wall: 14 tiles starting at `breakSlot` walking RIGHT,
  // wrapping onto the next wall if we run off the right end.
  let seat: Seat = breakWall;
  let slotIdx = breakSlot;
  for (let k = 0; k < DEAD_WALL_TILES; k++) {
    if (slotIdx >= SLOTS_PER_WALL) {
      slotIdx = 0;
      seat = ((seat + 1) % 4) as Seat;
    }
    slots[seat]![slotIdx] = 'dead';
    slotIdx++;
  }

  // Mark drawn tiles: `drawn` tiles starting at `breakSlot - 1` walking
  // LEFT, wrapping onto the previous wall when we pass slot 0.
  seat = breakWall;
  slotIdx = breakSlot - 1;
  let nextDrawSeat: Seat | null = null;
  let nextDrawSlot: number | null = null;
  for (let k = 0; k < drawn; k++) {
    if (slotIdx < 0) {
      seat = ((seat + 4 - 1) % 4) as Seat;
      slotIdx = SLOTS_PER_WALL - 1;
    }
    slots[seat]![slotIdx] = 'drawn';
    slotIdx--;
  }

  // The "next-to-draw" tile is the one immediately left of the last
  // drawn tile (or breakSlot - 1 if nothing's been drawn yet). Wraps
  // onto the previous wall if slotIdx ran off the left.
  if (slotIdx < 0) {
    seat = ((seat + 4 - 1) % 4) as Seat;
    slotIdx = SLOTS_PER_WALL - 1;
  }
  if (slots[seat]?.[slotIdx] === 'live' && allowDraw) {
    slots[seat]![slotIdx] = 'nextDraw';
    nextDrawSeat = seat;
    nextDrawSlot = slotIdx;
  }

  return { slots, nextDrawSeat, nextDrawSlot };
}
