import type { Tile } from './tiles.js';
import { sameFace, sortHand } from './tiles.js';

export type MeldKind = 'chi' | 'peng' | 'kong-exposed' | 'kong-concealed' | 'kong-promoted';

export interface Meld {
  kind: MeldKind;
  tiles: Tile[]; // 3 for chi/peng, 4 for any kong
  /** Seat the claimed tile came from (undefined for concealed kong). */
  from?: 0 | 1 | 2 | 3;
}

export function meldSize(m: Meld): number {
  return m.kind === 'chi' || m.kind === 'peng' ? 3 : 4;
}

/** Removes the first tile from `tiles` that has the same face as `t`. Returns a new array. */
export function removeFirstFace(tiles: readonly Tile[], t: Tile): Tile[] {
  const out = [...tiles];
  const i = out.findIndex((x) => sameFace(x, t));
  if (i >= 0) out.splice(i, 1);
  return out;
}

/** Multi-remove: for each face in `targets`, remove one tile from `tiles`. */
export function removeFaces(tiles: readonly Tile[], targets: readonly Tile[]): Tile[] {
  let out = [...tiles];
  for (const t of targets) out = removeFirstFace(out, t);
  return out;
}

export function countFace(tiles: readonly Tile[], target: Tile): number {
  let n = 0;
  for (const t of tiles) if (sameFace(t, target)) n++;
  return n;
}

/** Checks that `tiles` contains at least one tile face-equal to `target`. */
export function containsFace(tiles: readonly Tile[], target: Tile): boolean {
  return tiles.some((t) => sameFace(t, target));
}

export function sortHandStable(tiles: readonly Tile[]): Tile[] {
  return sortHand(tiles);
}
