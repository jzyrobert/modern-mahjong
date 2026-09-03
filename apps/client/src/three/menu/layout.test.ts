import { describe, expect, test } from 'vitest';
import {
  DRIFT_COUNT,
  HERO_COUNT,
  HERO_HAND_CELLS,
  MENU_TILE_COUNT,
  classifyAspect,
  driftField,
  fanSlots,
  fanWidth,
  fitDistance,
  fogDensityFor,
  frameWidthAt,
  menuLayout,
  seededRandom,
  wrapUnit,
} from './layout';

describe('menu layout', () => {
  test('hero hand is a legal 14-tile shape drawn from the 34 face cells', () => {
    expect(HERO_HAND_CELLS).toHaveLength(14);
    expect(HERO_COUNT).toBe(14);
    for (const cell of HERO_HAND_CELLS) {
      expect(cell).toBeGreaterThanOrEqual(0);
      expect(cell).toBeLessThan(34);
    }
    // No face appears more than four times (four copies per face).
    const counts = new Map<number, number>();
    for (const c of HERO_HAND_CELLS) counts.set(c, (counts.get(c) ?? 0) + 1);
    for (const n of counts.values()) expect(n).toBeLessThanOrEqual(4);
  });

  test('pool budget: hero + drift instances stay well under the 80k triangle menu budget', () => {
    expect(MENU_TILE_COUNT).toBe(HERO_COUNT + DRIFT_COUNT);
    // RoundedBoxGeometry(segments 3) → 7×7 quads × 6 faces × 2 = 588 tris per tile.
    expect(MENU_TILE_COUNT * 588).toBeLessThan(40_000);
  });

  test('fitDistance frames exactly the requested width', () => {
    const d = fitDistance(20, 34, 1.6);
    expect(frameWidthAt(d, 34, 1.6)).toBeCloseTo(20, 6);
  });

  test('fog leaves the hero ~10% fogged at its camera distance', () => {
    const d = 15;
    const rho = fogDensityFor(d);
    const fogged = 1 - Math.exp(-((rho * d) ** 2));
    expect(fogged).toBeGreaterThan(0.08);
    expect(fogged).toBeLessThan(0.12);
  });

  test('classifyAspect buckets the three verifier viewports', () => {
    expect(classifyAspect(412 / 915)).toBe('portrait');
    expect(classifyAspect(915 / 412)).toBe('landscape-phone');
    expect(classifyAspect(1440 / 900)).toBe('wide');
    expect(classifyAspect(834 / 1194)).toBe('portrait');
  });

  test('fan slots are centred, symmetric and rest on the plane', () => {
    const p = { spacing: 1, lean: 0.46, yaw: 0.045, zStep: 0.06, curve: 0.006, rows: 1, rowGap: 0 };
    const slots = fanSlots(14, p);
    expect(slots).toHaveLength(14);
    const xs = slots.map((s) => s.x);
    expect(xs[0]).toBeCloseTo(-xs[13]!, 9);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(fanWidth(14, 1) - 1, 9);
    for (const s of slots) {
      expect(s.y).toBeGreaterThan(0.5);
      expect(s.y).toBeLessThan(1);
      expect(s.rx).toBeLessThan(0); // leaning back toward the camera
    }
    // Ends yaw inward, mirrored.
    expect(slots[0]!.ry).toBeCloseTo(-slots[13]!.ry, 9);
    // Centre tiles are closest to the camera.
    expect(slots[6]!.z).toBeGreaterThan(slots[0]!.z);
  });

  test('two-row fan puts the back row further from the camera', () => {
    const p = { spacing: 1, lean: 0.46, yaw: 0, zStep: 0, curve: 0, rows: 2, rowGap: 1.2 };
    const slots = fanSlots(14, p);
    expect(slots.slice(0, 7).every((s) => s.z < slots[7]!.z)).toBe(true);
    // Each row is centred on x = 0.
    const rowSum = (from: number, to: number) =>
      slots.slice(from, to).reduce((acc, s) => acc + s.x, 0);
    expect(rowSum(0, 7)).toBeCloseTo(0, 9);
    expect(rowSum(7, 14)).toBeCloseTo(0, 9);
  });

  test.each([
    ['phone', 412 / 915],
    ['phone-landscape', 915 / 412],
    ['tablet', 834 / 1194],
    ['desktop', 1440 / 900],
  ])('menuLayout(%s) frames the fan with margin and keeps the hero in the upper part', (_n, aspect) => {
    const l = menuLayout(aspect);
    const perRow = Math.ceil(HERO_COUNT / l.fan.rows);
    const width = fanWidth(perRow, l.fan.spacing);
    expect(l.frameWidth).toBeGreaterThan(width);
    expect(l.viewCenter.y).toBeLessThan(0.7);
    expect(l.viewCenter.y).toBeGreaterThan(0.2);
    expect(l.camera.position[2]).toBeGreaterThan(0);
    expect(l.camera.position[1]).toBeGreaterThan(l.camera.target[1]);
    expect(l.fogDensity).toBeGreaterThan(0);
    expect(l.drift.far).toBeGreaterThan(l.drift.near);
    // Dice sit just outside the fan on the plane.
    expect(l.dice[0].x).toBeGreaterThan(width / 2);
    expect(l.dice[0].y).toBeGreaterThan(0);
  });

  test('drift field is deterministic, bounded and mixes faces with backs', () => {
    const a = driftField(DRIFT_COUNT);
    const b = driftField(DRIFT_COUNT);
    expect(a).toEqual(b);
    expect(a).toHaveLength(DRIFT_COUNT);
    for (const t of a) {
      expect(Math.abs(t.ux)).toBeLessThanOrEqual(1);
      expect(Math.abs(t.uy)).toBeLessThanOrEqual(1);
      expect(t.depth).toBeGreaterThan(0);
      expect(t.depth).toBeLessThanOrEqual(1);
      expect(t.cell).toBeGreaterThanOrEqual(-1);
      expect(t.cell).toBeLessThan(34);
      expect(t.stagger).toBeGreaterThanOrEqual(0);
      expect(t.stagger).toBeLessThan(1);
    }
    expect(a.some((t) => t.cell === -1)).toBe(true);
    expect(a.some((t) => t.cell >= 0)).toBe(true);
  });

  test('seededRandom is reproducible and in [0,1)', () => {
    const r1 = seededRandom(9);
    const r2 = seededRandom(9);
    for (let i = 0; i < 50; i++) {
      const v = r1();
      expect(v).toBe(r2());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test('wrapUnit keeps drift coordinates inside the padded range', () => {
    expect(wrapUnit(1.2)).toBeCloseTo(-1.1, 9);
    expect(wrapUnit(-1.2)).toBeCloseTo(1.1, 9);
    expect(wrapUnit(0.3)).toBe(0.3);
  });
});
