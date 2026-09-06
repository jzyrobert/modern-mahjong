/**
 * The hero's live dice discs, published by `HeroScene` for the drift
 * field's rack keep-out (`DriftScene.rackRects`).
 *
 * The layout predicts where the dice rest (`RackFootprint.dice`), but
 * the hero nudges the pair off its slots when a die would straddle a
 * DOM edge (`HeroScene.placeDice`, e.g. away from the desktop Tutorial
 * card), and a keep-out built from the prediction then misses the
 * real discs by the nudge (round-6: a drift tile sat on a die that had
 * moved 0.4 units back). Discs are *canvas-local* CSS px — the hero
 * canvas is the band, so the field adds the live band's corner, the
 * same way it places the tiles' box; a scroll moves nothing here.
 *
 * Pure (no three / React) so vitest can drive it.
 */
export interface HeroDisc {
  x: number;
  y: number;
  r: number;
}

let discs: HeroDisc[] = [];
let version = 0;
const listeners = new Set<() => void>();

/** Ignore sub-half-pixel jitter so a settled die never re-publishes. */
const EPS_PX = 0.5;

function same(a: readonly HeroDisc[], b: readonly HeroDisc[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const p = a[i]!;
    const q = b[i]!;
    if (
      Math.abs(p.x - q.x) >= EPS_PX ||
      Math.abs(p.y - q.y) >= EPS_PX ||
      Math.abs(p.r - q.r) >= EPS_PX
    )
      return false;
  }
  return true;
}

/** Hero scene: publish this frame's dice discs (`[]` on dispose). */
export function publishHeroDice(next: readonly HeroDisc[]): void {
  if (same(discs, next)) return;
  discs = next.map((d) => ({ ...d }));
  version++;
  for (const l of listeners) l();
}

export function getHeroDice(): readonly HeroDisc[] {
  return discs;
}

/** Monotonic counter — bumps on every accepted change. */
export function heroDiceVersion(): number {
  return version;
}

export function subscribeHeroDice(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Test seam. */
export function resetHeroDice(): void {
  discs = [];
  version = 0;
  listeners.clear();
}
