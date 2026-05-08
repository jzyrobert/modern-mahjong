import { type Tile as MTile, type Suit, sortHand, tileId } from '@mahjong/game-logic';
import type { SortMode } from './match/SortPicker';

const SUIT_ORDER: Record<Suit, number> = { man: 0, pin: 1, sou: 2 };
const HONOR_ORDER: Record<string, number> = { E: 0, S: 1, W: 2, N: 3, Z: 4, F: 5, B: 6 };

/**
 * Apply a hand sort mode to a tile list. Used by `<Hand>` for the
 * live render and by `<Match>` when seeding `manualOrder` on a
 * `suit`/`number` → `manual` transition so the user's current
 * arrangement is preserved instead of snapping back to engine order.
 */
export function orderHand(tiles: readonly MTile[], mode: SortMode): MTile[] {
  if (mode === 'manual') return [...tiles];
  if (mode === 'suit') return sortHand(tiles);
  // 'num' — by rank, then by suit canonical order. Honors after
  // suited tiles in the canonical 風/三元 order.
  return [...tiles].sort((a, b) => {
    if (a.kind === 'suit' && b.kind === 'suit') {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
    }
    if (a.kind === 'suit') return -1;
    if (b.kind === 'suit') return 1;
    return (HONOR_ORDER[a.honor] ?? 99) - (HONOR_ORDER[b.honor] ?? 99);
  });
}

/**
 * Sort a tile list by an explicit `tileId` ordering. Tiles whose ids
 * aren't in the order array sort to the end (newly-drawn tiles
 * before they've been placed in the manual order) — `Hand`'s drag
 * handler appends them there on every reorder.
 */
export function manualOrderHand(tiles: readonly MTile[], order: readonly number[]): MTile[] {
  const indexById = new Map<number, number>();
  for (const [i, id] of order.entries()) indexById.set(id, i);
  return [...tiles].sort((a, b) => {
    const ia = indexById.get(tileId(a));
    const ib = indexById.get(tileId(b));
    if (ia === undefined && ib === undefined) return 0;
    if (ia === undefined) return 1;
    if (ib === undefined) return -1;
    return ia - ib;
  });
}
