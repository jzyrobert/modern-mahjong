import { BufferGeometry, Float32BufferAttribute } from 'three';
import { FELT_HALF, RAIL_H, RAIL_WIDTH, type Rel, toWorld } from './layout';

/**
 * The wood rail as one mitred ring. Each side is a cross-section
 * *profile* (across the rail, `d` from the table centre; `y` up) swept
 * along the side: at across-distance `d` the side runs from `−d` to
 * `+d` along the wall, so a profile point of one side lands exactly on
 * the same world point as its neighbour's — the four sides meet on the
 * 45° diagonals with no overlap and no gap. The earlier build merged
 * four RoundedBox slabs whose ends ran past the corners; the rounded
 * ends showed through the neighbour's top as seams, and the two
 * coplanar tops z-fought (the user saw the corners "overlapping and
 * glitching").
 *
 * Profile (inner edge first): a vertical inner face rising from the
 * felt, a chamfer onto the top, the flat top, a chamfer down to the
 * outer face, and the outer face dropping below the felt so the
 * table's edge reads as a solid block from the low presets.
 *
 * UVs: `u` runs along each side (0..1 over the full length, so the
 * wood grain follows the side — a mitred frame's grain does), `v` runs
 * across the profile (0..1 inner → outer).
 */
export const RAIL_CHAMFER = 0.1;
/** How far the outer face drops below the felt plane. */
export const RAIL_SKIRT = 0.35;

interface ProfilePoint {
  d: number;
  y: number;
}

/** Cross-section from the inner felt edge to the outer bottom edge. */
export function railProfile(): ProfilePoint[] {
  const inner = FELT_HALF;
  const outer = FELT_HALF + RAIL_WIDTH;
  const top = RAIL_H - 0.02;
  const c = RAIL_CHAMFER;
  return [
    { d: inner, y: 0 },
    { d: inner, y: top - c },
    { d: inner + c, y: top },
    { d: outer - c, y: top },
    { d: outer, y: top - c },
    { d: outer, y: -RAIL_SKIRT },
  ];
}

/** One mitred ring: four swept profiles, indexed, with normals + UVs. */
export function buildRailGeometry(): BufferGeometry {
  const profile = railProfile();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  // Profile arc length for the v coordinate.
  const vAt: number[] = [0];
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1]!;
    const b = profile[i]!;
    vAt.push(vAt[i - 1]! + Math.hypot(b.d - a.d, b.y - a.y));
  }
  const vTotal = vAt[vAt.length - 1]!;
  const len = (FELT_HALF + RAIL_WIDTH) * 2;
  for (let rel = 0; rel < 4; rel++) {
    const r = rel as Rel;
    for (let i = 0; i + 1 < profile.length; i++) {
      const a = profile[i]!;
      const b = profile[i + 1]!;
      // Normal of the segment in the (d, y) plane: the segment direction
      // (dd, dy) rotated +90° → (−dy, dd). The inner face (rising, dd =
      // 0, dy > 0) faces the felt (−d), the top (dd > 0, dy = 0) faces
      // up, the outer face (dy < 0) faces away from the table.
      const dd = b.d - a.d;
      const dy = b.y - a.y;
      const l = Math.hypot(dd, dy) || 1;
      const nd = -dy / l;
      const ny = dd / l;
      const [wnx, wnz] = toWorld(r, 0, nd);
      const base = positions.length / 3;
      const corners: [number, number, number, number][] = [
        [-a.d, a.d, a.y, vAt[i]!],
        [a.d, a.d, a.y, vAt[i]!],
        [b.d, b.d, b.y, vAt[i + 1]!],
        [-b.d, b.d, b.y, vAt[i + 1]!],
      ];
      for (const [along, d, y, v] of corners) {
        const [x, z] = toWorld(r, along, d);
        positions.push(x, y, z);
        normals.push(wnx, ny, wnz);
        uvs.push(along / len + 0.5, v / vTotal);
      }
      indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeBoundingSphere();
  return geo;
}
