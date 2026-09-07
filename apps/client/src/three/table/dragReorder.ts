import type { ScreenRect } from './picking';

/**
 * Pure maths for the 3D shell's drag-to-reorder (`hud/HitTargets`).
 * Everything here works in the projected hit-target space (CSS px of
 * the table canvas), so it covers the desktop / landscape single row
 * and the portrait held hand's two rows alike: slots are located by
 * their 2D centres, never by x alone.
 */

export interface Pt {
  x: number;
  y: number;
}

/** Pointer travel (CSS px) that turns a press into a drag. */
export const DRAG_START_PX = 6;
/** Touch: holding this long without moving also arms the drag. */
export const DRAG_HOLD_MS = 180;
/** Lift of the carried tile along its own up axis, world units. */
export const DRAG_LIFT = 0.35;
/** Backward lean added to the carried tile, radians. */
export const DRAG_TILT = 0.12;

export function rectCentre(r: ScreenRect): Pt {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

export function exceedsDragThreshold(dx: number, dy: number, threshold = DRAG_START_PX): boolean {
  return dx * dx + dy * dy > threshold * threshold;
}

/**
 * Display order of the hand tiles from their *settled* projected rects:
 * rows by centre y (a new row starts where the centre drops by more than
 * half a tile's height), left to right within a row. Returns the ids in
 * that order plus the slot centres, index-aligned, so a drag can be
 * resolved against the slots even while the buttons' DOM order and the
 * store are a render behind.
 */
export function slotsFromRects(entries: readonly { id: number; rect: ScreenRect }[]): {
  order: number[];
  centres: Pt[];
} {
  const items = entries.map((e) => ({ id: e.id, c: rectCentre(e.rect), h: e.rect.height }));
  items.sort((a, b) => a.c.y - b.c.y);
  const rows: (typeof items)[] = [];
  for (const it of items) {
    const row = rows[rows.length - 1];
    if (row && Math.abs(it.c.y - row[0]!.c.y) <= Math.max(1, row[0]!.h) / 2) row.push(it);
    else rows.push([it]);
  }
  const order: number[] = [];
  const centres: Pt[] = [];
  for (const row of rows) {
    row.sort((a, b) => a.c.x - b.c.x);
    for (const it of row) {
      order.push(it.id);
      centres.push(it.c);
    }
  }
  return { order, centres };
}

/** Index of the slot whose centre is nearest the pointer; -1 for no slots. */
export function nearestSlotIndex(centres: readonly Pt[], p: Pt): number {
  let best = -1;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < centres.length; i++) {
    const c = centres[i]!;
    const dx = c.x - p.x;
    const dy = c.y - p.y;
    const d = dx * dx + dy * dy;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * `ids` with the item at `from` moved to `to` (the classic
 * `Hand.onReorder` contract: splice out, splice in). Returns the input
 * array itself when nothing changes so callers can skip a store write.
 */
export function moveIndex<T>(ids: readonly T[], from: number, to: number): readonly T[] {
  if (from === to || from < 0 || to < 0 || from >= ids.length || to >= ids.length) return ids;
  const next = ids.slice();
  const [moved] = next.splice(from, 1);
  if (moved === undefined) return ids;
  next.splice(to, 0, moved);
  return next;
}

/**
 * Keyboard reorder: the slot a tile at `index` moves to for an arrow
 * key. Left / Right step along the display order (wrapping across the
 * portrait row break); Up / Down jump to the nearest slot on the row
 * above / below. `null` when there is nowhere to go.
 */
export function keyboardMoveIndex(
  centres: readonly Pt[],
  index: number,
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
): number | null {
  const n = centres.length;
  if (index < 0 || index >= n) return null;
  if (key === 'ArrowLeft') return index > 0 ? index - 1 : null;
  if (key === 'ArrowRight') return index < n - 1 ? index + 1 : null;
  const cur = centres[index]!;
  let best: number | null = null;
  let bestD = Number.POSITIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const c = centres[i]!;
    const dy = c.y - cur.y;
    // Rows are far apart in y compared with the jitter within a row.
    if (key === 'ArrowUp' ? dy >= -1 : dy <= 1) continue;
    const d = Math.abs(c.x - cur.x) + Math.abs(dy) * 0.01;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
