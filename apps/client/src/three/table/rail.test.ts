import { describe, expect, test } from 'vitest';
import { FELT_HALF, RAIL_H, RAIL_WIDTH } from './layout';
import { RAIL_SKIRT, buildRailGeometry, railProfile } from './rail';

describe('mitred rail', () => {
  test('the profile runs from the felt edge to the outer skirt with a chamfered top', () => {
    const p = railProfile();
    expect(p[0]).toEqual({ d: FELT_HALF, y: 0 });
    expect(p[p.length - 1]).toEqual({ d: FELT_HALF + RAIL_WIDTH, y: -RAIL_SKIRT });
    expect(Math.max(...p.map((q) => q.y))).toBeCloseTo(RAIL_H - 0.02, 6);
    // Monotonic outward.
    for (let i = 1; i < p.length; i++) expect(p[i]!.d).toBeGreaterThanOrEqual(p[i - 1]!.d);
  });
  test('adjacent sides meet on the 45° diagonal — every corner vertex is shared, none overlaps', () => {
    const geo = buildRailGeometry();
    const pos = geo.getAttribute('position');
    const profile = railProfile();
    const perSide = (profile.length - 1) * 4;
    expect(pos.count).toBe(perSide * 4);
    // Collect the end vertices of each side (along = ±d) keyed by
    // position: each corner point is emitted by both neighbours (twice
    // each for an interior profile point, which ends one strip and
    // starts the next) — so every key is shared and nothing is unique
    // to one side, which is what a mitre means.
    const ends = new Map<string, number>();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // A corner vertex lies on a diagonal |x| == |z|.
      if (Math.abs(Math.abs(x) - Math.abs(z)) > 1e-6) continue;
      const k = `${x.toFixed(4)},${pos.getY(i).toFixed(4)},${z.toFixed(4)}`;
      ends.set(k, (ends.get(k) ?? 0) + 1);
    }
    expect(ends.size).toBe(profile.length * 4);
    const yTop = profile[0]!.y;
    const yBottom = profile[profile.length - 1]!.y;
    for (const [k, n] of ends) {
      const y = Number(k.split(',')[1]);
      const endpoint = Math.abs(y - yTop) < 1e-4 || Math.abs(y - yBottom) < 1e-4;
      expect(n).toBe(endpoint ? 2 : 4);
    }
    // Nothing reaches past the outer edge.
    for (let i = 0; i < pos.count; i++) {
      expect(Math.abs(pos.getX(i))).toBeLessThanOrEqual(FELT_HALF + RAIL_WIDTH + 1e-6);
      expect(Math.abs(pos.getZ(i))).toBeLessThanOrEqual(FELT_HALF + RAIL_WIDTH + 1e-6);
    }
  });
  test('normals: the top faces up, the inner face looks at the felt, the outer face away', () => {
    const geo = buildRailGeometry();
    const pos = geo.getAttribute('position');
    const nrm = geo.getAttribute('normal');
    let top = 0;
    let inner = 0;
    let outer = 0;
    for (let i = 0; i < pos.count; i++) {
      const ny = nrm.getY(i);
      const radial = nrm.getX(i) * pos.getX(i) + nrm.getZ(i) * pos.getZ(i);
      if (ny > 0.99) top++;
      else if (Math.abs(ny) < 1e-6 && radial < 0) inner++;
      else if (Math.abs(ny) < 1e-6 && radial > 0) outer++;
    }
    expect(top).toBe(16);
    expect(inner).toBe(16);
    expect(outer).toBe(16);
  });
});
