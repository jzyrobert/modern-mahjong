/**
 * Registry of DOM rects the 3D menu backdrop must respect. Lobby
 * surfaces register themselves (`useMenuOccluder`) and the drift field
 * (`three/menu/MenuScene.ts`) reads the rects every frame:
 *
 * - `glass` — a backdrop-filter card. Tiles fully behind it are fine
 *   (the blur reads as depth) and tiles fully outside are fine; a tile
 *   *straddling* the border renders half-sharp / half-blurred along a
 *   hard line, so tiles fade out within a band either side of every
 *   edge (which also empties the narrow gaps between stacked cards).
 * - `solid` — plain text over the void (footer credits, title). Tiles
 *   fade out anywhere inside the rect + band.
 *
 * Pure (no React / RN imports — vitest-friendly): rects are window CSS
 * px from `measureInWindow`, which RN-web maps to
 * `getBoundingClientRect`. The React side lives in `useMenuOccluder.ts`.
 */
export type OccluderKind = 'glass' | 'solid';

export interface OccluderRect {
  x: number;
  y: number;
  w: number;
  h: number;
  kind: OccluderKind;
  /** Per-rect fade ramp (CSS px); defaults to the caller's `band`. The
   *  3D hero rack registers itself with a short ramp so the phone's
   *  narrow side margins can still host whole tiles. */
  band?: number;
}

const rects = new Map<string, OccluderRect>();
const listeners = new Set<() => void>();
const measurers = new Set<() => void>();
let version = 0;

function notify(): void {
  version++;
  for (const l of listeners) l();
}

export function setOccluder(id: string, rect: OccluderRect): void {
  const prev = rects.get(id);
  if (
    prev &&
    prev.x === rect.x &&
    prev.y === rect.y &&
    prev.w === rect.w &&
    prev.h === rect.h &&
    prev.kind === rect.kind
  )
    return;
  rects.set(id, rect);
  notify();
}

export function removeOccluder(id: string): void {
  if (rects.delete(id)) notify();
}

export function getOccluders(): OccluderRect[] {
  return Array.from(rects.values());
}

/** Monotonic counter — bumps on every rect change (cheap dirty check). */
export function occluderVersion(): number {
  return version;
}

export function subscribeOccluders(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Ask every registered surface to re-measure (scroll / resize / test). */
export function remeasureOccluders(): void {
  for (const m of measurers) m();
}

/** Test seam — drop every rect and listener. */
export function resetOccluders(): void {
  rects.clear();
  listeners.clear();
  measurers.clear();
  version = 0;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Signed distance from (x, y) to the rect boundary — negative inside. */
export function rectSignedDistance(x: number, y: number, r: OccluderRect): number {
  const dx = Math.max(r.x - x, 0, x - (r.x + r.w));
  const dy = Math.max(r.y - y, 0, y - (r.y + r.h));
  const outside = Math.hypot(dx, dy);
  if (outside > 0) return outside;
  const inside = Math.min(x - r.x, r.x + r.w - x, y - r.y, r.y + r.h - y);
  return inside === 0 ? 0 : -inside;
}

/** Half-width of the fade ramp either side of an edge, CSS px. */
export const OCCLUDER_BAND_PX = 24;

/**
 * Visibility factor (0..1) for a disc of radius `radius` centred on
 * (x, y): 1 clear of every rect, 0 while it overlaps a `solid` rect
 * or straddles a `glass` edge, ramping linearly over `band` px.
 * `glassInterior` (default 1) caps the factor for a disc that sits
 * fully inside a `glass` rect.
 */
export function occluderFactor(
  x: number,
  y: number,
  radius: number,
  list: readonly OccluderRect[],
  band = OCCLUDER_BAND_PX,
  glassInterior = 1,
): number {
  let f = 1;
  for (const r of list) {
    const d = rectSignedDistance(x, y, r);
    const ramp = r.band ?? band;
    let g: number;
    if (r.kind === 'solid') g = clamp01((d - radius) / ramp);
    else {
      g = clamp01((Math.abs(d) - radius) / ramp);
      // Deep behind the glass the blur reads as depth, but a full-size
      // tile inside a form card still reads as debris — callers cap
      // the interior so those tiles shrink into faint depth cues.
      if (d < 0 && g > glassInterior) g = glassInterior;
    }
    if (g < f) f = g;
    if (f === 0) break;
  }
  return f;
}

/** Register a re-measure callback (see `remeasureOccluders`). */
export function addOccluderMeasurer(fn: () => void): () => void {
  measurers.add(fn);
  return () => {
    measurers.delete(fn);
  };
}
