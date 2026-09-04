import { describe, expect, test } from 'vitest';
import { BACK_CELL, FACE_COUNT } from '../tiles/faceAtlas';
import {
  AUTO_ORBIT_MS,
  ORBIT_AMPLITUDE,
  PREVIEW_BACK_ALBEDO,
  PREVIEW_BACK_FINISH,
  PREVIEW_BACK_HUE_TRIM,
  PREVIEW_BACK_SATURATION,
  PREVIEW_CAMERA,
  PREVIEW_HFOV_DEG,
  PREVIEW_MAX_ASPECT,
  PREVIEW_TABLE,
  PREVIEW_TILES,
  compensateBackColor,
  honorCell,
  linearLuminance,
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

  test('letterbox canvases floor the vertical fov so both rails stay in frame', () => {
    const floor = verticalFovFor(PREVIEW_MAX_ASPECT);
    // Phone landscape (~570×150) gets the same vertical fov as 1.9:1 …
    expect(verticalFovFor(3.8)).toBeCloseTo(floor, 6);
    expect(verticalFovFor(10)).toBeCloseTo(floor, 6);
    // … which is wide enough for the rail ring (depth 4.7 at ~8 units).
    expect(floor).toBeGreaterThan(24);
    // Below the cap the constant-horizontal-fov rule still applies.
    expect(verticalFovFor(1.7)).toBeGreaterThan(floor);
  });

  test('back compensation darkens greys and pushes chroma away from grey', () => {
    const grey = compensateBackColor([0.4, 0.4, 0.4]);
    expect(grey[0]).toBeCloseTo(0.4 * PREVIEW_BACK_ALBEDO, 6);
    expect(grey[1]).toBeCloseTo(grey[0], 6);
    expect(grey[2]).toBeCloseTo(grey[0], 6);
    // Luminance always scales by the albedo, whatever the hue — the
    // hue trim is chroma-only.
    const blue: [number, number, number] = [0.15, 0.33, 0.49];
    const neutral = compensateBackColor(blue);
    const trimmed = compensateBackColor(blue, undefined, undefined, PREVIEW_BACK_HUE_TRIM.blue);
    expect(linearLuminance(neutral)).toBeCloseTo(linearLuminance(blue) * PREVIEW_BACK_ALBEDO, 6);
    expect(linearLuminance(trimmed)).toBeCloseTo(linearLuminance(blue) * PREVIEW_BACK_ALBEDO, 6);
    // …while the spread around that luminance grows by the saturation factor.
    const yIn = linearLuminance(blue);
    const yOut = linearLuminance(neutral);
    expect((neutral[2] - yOut) / (blue[2] - yIn)).toBeCloseTo(
      PREVIEW_BACK_SATURATION * PREVIEW_BACK_ALBEDO,
      6,
    );
    // Blue's trim counters its cyan cast (more blue, less green); plum's
    // counters its pink cast (less red); cream is untouched.
    expect(trimmed[2] / trimmed[1]).toBeGreaterThan(neutral[2] / neutral[1]);
    const plum: [number, number, number] = [0.48, 0.21, 0.47];
    const plumTrim = compensateBackColor(plum, undefined, undefined, PREVIEW_BACK_HUE_TRIM.plum);
    expect(plumTrim[0] / plumTrim[2]).toBeLessThan(plum[0] / plum[2]);
    expect(PREVIEW_BACK_HUE_TRIM.cream).toEqual([1, 1, 1]);
    // Never negative, even for a fully saturated primary.
    for (const c of compensateBackColor([0, 0, 1], 0.8, 3)) expect(c).toBeGreaterThanOrEqual(0);
  });

  test('camera looks slightly in front of centre so the near rail clears the frame', () => {
    expect(PREVIEW_CAMERA.target[2]).toBeGreaterThan(0.2);
    expect(PREVIEW_CAMERA.position[1]).toBeGreaterThan(4);
    expect(PREVIEW_BACK_FINISH.clearcoat).toBeLessThan(0.3);
    expect(PREVIEW_BACK_FINISH.roughness).toBeGreaterThan(0.5);
  });

  test('vertical fov keeps the horizontal fov constant across aspects', () => {
    // Square canvas: vertical == horizontal.
    expect(verticalFovFor(1)).toBeCloseTo(PREVIEW_HFOV_DEG, 5);
    // Wider canvas → narrower vertical fov, monotonically.
    expect(verticalFovFor(1.7)).toBeGreaterThan(verticalFovFor(1.9));
    expect(verticalFovFor(1.9)).toBeGreaterThan(20);
    expect(verticalFovFor(1.7)).toBeLessThan(38);
    // Degenerate aspect never divides by zero.
    expect(Number.isFinite(verticalFovFor(0))).toBe(true);
  });
});
