/**
 * Scene-derived screen bounds the tutorial overlay clips its coach-mark
 * targets to — published by the table scene from its update loop and
 * read by `ui/tutorial` through `three/entry`. Lives in `core/` for the
 * same reason `spotlight.ts` does (ARCHITECTURE.md §1: the table and
 * the tutorial share only `core/` and `tiles/`).
 *
 * Today it carries one rect: the river interior — the felt square
 * inside the four walls' visible edges, in *client* (page) CSS px. The
 * table registers the discard pool as the projected ±7.6 square, whose
 * axis-aligned bounding box widens with perspective onto the near wall
 * row and the side wall columns; clipping the pool's coach-mark ring to
 * this interior keeps the ring off the walls at every viewport.
 */
export interface ScreenBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

let riverInterior: ScreenBounds | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function close(a: ScreenBounds | null, b: ScreenBounds | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.right - b.right) < 0.5 &&
    Math.abs(a.bottom - b.bottom) < 0.5
  );
}

/** Publish the river interior (client px). A near-identical write is a no-op. */
export function publishRiverInterior(bounds: ScreenBounds | null): void {
  if (close(riverInterior, bounds)) return;
  riverInterior = bounds ? { ...bounds } : null;
  seq++;
  for (const l of listeners) l();
}

export function getRiverInterior(): ScreenBounds | null {
  return riverInterior;
}

/** Monotonic; bumps on every accepted write. */
export function riverInteriorVersion(): number {
  return seq;
}

export function subscribeRiverInterior(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
