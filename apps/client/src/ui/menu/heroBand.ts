/**
 * The measured hero band: the empty slot the lobby lays out directly
 * under the title block (`HeroBandSlot`), as its live window rect in
 * CSS px — re-measured on scroll, so the hero travels with the title
 * instead of staying under the cards that scroll over it. Both
 * renderers read it: the 3D menu scene fits the rack + dice inside it
 * (`three/menu/layout.ts`) and the classic DOM fan centres itself in it
 * (`heroAnchor.domFan`).
 * Pure (no React / RN) so vitest can drive it; the React side is
 * `HeroBandSlot.tsx`.
 */
export interface HeroBand {
  x: number;
  y: number;
  w: number;
  h: number;
}

let band: HeroBand | null = null;
let version = 0;
const listeners = new Set<() => void>();

/** Ignore sub-pixel jitter so a re-measure never re-lays the scene out. */
const EPS_PX = 1;

export function setHeroBand(next: HeroBand | null): void {
  if (next === null) {
    if (band === null) return;
    band = null;
  } else {
    if (!(next.w > 0 && next.h > 0)) return;
    if (
      band &&
      Math.abs(band.x - next.x) < EPS_PX &&
      Math.abs(band.y - next.y) < EPS_PX &&
      Math.abs(band.w - next.w) < EPS_PX &&
      Math.abs(band.h - next.h) < EPS_PX
    )
      return;
    band = { x: next.x, y: next.y, w: next.w, h: next.h };
  }
  version++;
  for (const l of listeners) l();
}

export function getHeroBand(): HeroBand | null {
  return band;
}

/** Monotonic counter — bumps on every accepted change. */
export function heroBandVersion(): number {
  return version;
}

export function subscribeHeroBand(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Test seam — drop the band and every listener. */
export function resetHeroBand(): void {
  band = null;
  listeners.clear();
  version = 0;
}

/** Clearance the rack keeps under the title block's last line. */
export const HERO_GAP_TOP_PX = 16;
/** Clearance the rack keeps above the first card. */
export const HERO_GAP_BOTTOM_PX = 8;
/** A band shorter / narrower than this is treated as unmeasured. */
const MIN_BOX_H = 40;
const MIN_BOX_W = 80;

/**
 * The box the hero must fit: the band inset by the two clearances.
 * `null` when the band is missing or degenerate (mid-layout, a font
 * still loading), in which case callers fall back to the viewport
 * fractions of `heroAnchor`.
 */
export function heroBox(band: HeroBand | null | undefined): HeroBand | null {
  if (!band) return null;
  const y = band.y + HERO_GAP_TOP_PX;
  const h = band.h - HERO_GAP_TOP_PX - HERO_GAP_BOTTOM_PX;
  if (h < MIN_BOX_H || band.w < MIN_BOX_W) return null;
  return { x: band.x, y, w: band.w, h };
}
