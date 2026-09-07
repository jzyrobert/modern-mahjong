import { BoxGeometry } from 'three';
import { describe, expect, test } from 'vitest';
import {
  DICE_ATLAS_COLS,
  DICE_ATLAS_ROWS,
  DIE_FACE_VALUES,
  PIP_LAYOUT,
  diceCellFor,
  remapDiceUvs,
} from './dice';

describe('procedural dice', () => {
  test('opposite faces sum to seven', () => {
    const [px, nx, py, ny, pz, nz] = DIE_FACE_VALUES;
    expect(px! + nx!).toBe(7);
    expect(py! + ny!).toBe(7);
    expect(pz! + nz!).toBe(7);
    expect([...DIE_FACE_VALUES].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('every value has the right pip count inside the unit square', () => {
    for (let v = 1; v <= 6; v++) {
      const pips = PIP_LAYOUT[v] ?? [];
      expect(pips).toHaveLength(v);
      for (const [x, y] of pips) {
        expect(x).toBeGreaterThan(0.1);
        expect(x).toBeLessThan(0.9);
        expect(y).toBeGreaterThan(0.1);
        expect(y).toBeLessThan(0.9);
      }
    }
  });

  test('atlas cells tile a 3×2 grid without overlap', () => {
    const seen = new Set<string>();
    for (let v = 1; v <= 6; v++) {
      const [cx, cy] = diceCellFor(v);
      expect(cx).toBeLessThan(DICE_ATLAS_COLS);
      expect(cy).toBeLessThan(DICE_ATLAS_ROWS);
      seen.add(`${cx},${cy}`);
    }
    expect(seen.size).toBe(6);
  });

  test('remapDiceUvs keeps each face inside its own atlas cell', () => {
    const geo = remapDiceUvs(new BoxGeometry(1, 1, 1, 2, 2, 2));
    const uv = geo.getAttribute('uv');
    const perFace = uv.count / 6;
    for (let face = 0; face < 6; face++) {
      const [cx, cy] = diceCellFor(DIE_FACE_VALUES[face]!);
      const u0 = cx / DICE_ATLAS_COLS;
      const u1 = (cx + 1) / DICE_ATLAS_COLS;
      const v0 = 1 - (cy + 1) / DICE_ATLAS_ROWS;
      const v1 = 1 - cy / DICE_ATLAS_ROWS;
      for (let i = face * perFace; i < (face + 1) * perFace; i++) {
        expect(uv.getX(i)).toBeGreaterThanOrEqual(u0 - 1e-6);
        expect(uv.getX(i)).toBeLessThanOrEqual(u1 + 1e-6);
        expect(uv.getY(i)).toBeGreaterThanOrEqual(v0 - 1e-6);
        expect(uv.getY(i)).toBeLessThanOrEqual(v1 + 1e-6);
      }
    }
  });
});
