import { describe, expect, test } from 'vitest';
import { BACK_CELL, FACE_COUNT } from '../tiles/faceAtlas';
import {
  AUTO_ORBIT_MS,
  ORBIT_AMPLITUDE,
  PREVIEW_HFOV_DEG,
  PREVIEW_TABLE,
  PREVIEW_TILES,
  honorCell,
  suitCell,
  verticalFovFor,
} from './previewConfig';

describe('settings preview config', () => {
  test('五萬 is man rank 5 → cell 4', () => {
    expect(suitCell(0, 5)).toBe(4);
    expect(PREVIEW_TILES[0]!.cell).toBe(4);
    expect(PREVIEW_TILES[0]!.faceUp).toBe(true);
  });

  test('發 is the green dragon honor → cell 32', () => {
    expect(honorCell('F')).toBe(32);
    expect(honorCell('E')).toBe(27);
    expect(honorCell('B')).toBe(FACE_COUNT - 1);
    expect(PREVIEW_TILES[1]!.cell).toBe(32);
  });

  test('unknown honors throw rather than sampling a random cell', () => {
    expect(() => honorCell('X')).toThrow();
  });

  test('third tile is face-down showing the back cell', () => {
    const back = PREVIEW_TILES[2]!;
    expect(back.faceUp).toBe(false);
    expect(back.cell).toBe(BACK_CELL);
  });

  test('tiles have unique pool ids and sit inside the rail', () => {
    const ids = new Set(PREVIEW_TILES.map((t) => t.id));
    expect(ids.size).toBe(PREVIEW_TILES.length);
    for (const t of PREVIEW_TILES) {
      expect(Math.abs(t.x)).toBeLessThan(PREVIEW_TABLE.railInnerW / 2 - 0.5);
      expect(Math.abs(t.z)).toBeLessThan(PREVIEW_TABLE.railInnerD / 2 - 0.68);
    }
  });

  test('rail ring encloses the felt slab and sway stays gentle', () => {
    expect(PREVIEW_TABLE.railInnerW).toBeLessThan(PREVIEW_TABLE.feltW);
    expect(PREVIEW_TABLE.railInnerD).toBeLessThan(PREVIEW_TABLE.feltD);
    expect(PREVIEW_TABLE.railOuterW).toBeGreaterThan(PREVIEW_TABLE.feltW);
    expect(ORBIT_AMPLITUDE).toBeLessThan(0.4);
    expect(AUTO_ORBIT_MS).toBeGreaterThanOrEqual(5_000);
  });

  test('vertical fov keeps the horizontal fov constant across aspects', () => {
    // Square canvas: vertical == horizontal.
    expect(verticalFovFor(1)).toBeCloseTo(PREVIEW_HFOV_DEG, 5);
    // Wider canvas → narrower vertical fov, monotonically.
    expect(verticalFovFor(1.7)).toBeGreaterThan(verticalFovFor(1.9));
    expect(verticalFovFor(1.9)).toBeGreaterThan(20);
    expect(verticalFovFor(1.7)).toBeLessThan(35);
    // Degenerate aspect never divides by zero.
    expect(Number.isFinite(verticalFovFor(0))).toBe(true);
  });
});
