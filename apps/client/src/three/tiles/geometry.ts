import type { BufferGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * Tile dimensions in world units (1 unit ≈ 26 mm, a Hong Kong tile's
 * width). Face is +Z in object space; the back is −Z. `TilePool`
 * rotates instances so a face-up tile lying on the felt has +Z up.
 */
export const TILE_W = 1.0;
export const TILE_H = 1.36;
export const TILE_D = 0.62;
export const TILE_RADIUS = 0.08;

/**
 * Corner segments. 2 → a 5×5 grid per face = 300 triangles per tile,
 * 40.8k for the full 136-tile pool (the previous 3 → 588 / 80k blew
 * most of the 150k in-game triangle budget on tiles alone). The edge
 * radius still reads as a soft bevel at phone size.
 */
export const TILE_SEGMENTS = 2;

let cached: BufferGeometry | null = null;

export function tileGeometry(): BufferGeometry {
  if (cached) return cached;
  cached = new RoundedBoxGeometry(TILE_W, TILE_H, TILE_D, TILE_SEGMENTS, TILE_RADIUS);
  cached.computeBoundingSphere();
  return cached;
}
