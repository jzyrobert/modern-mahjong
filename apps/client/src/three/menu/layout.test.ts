import { describe, expect, test } from 'vitest';
import {
  DRIFT_COUNT,
  DRIFT_LIMIT,
  HERO_COUNT,
  HERO_HAND_CELLS,
  MENU_TILE_COUNT,
  classifyAspect,
  diceSlots,
  driftField,
  driftKeepOut,
  driftVisible,
  fanSlots,
  fanWidth,
  fitDistance,
  fogDensityFor,
  frameWidthAt,
  inKeepOut,
  menuLayout,
  placeOutsideKeepOut,
  seededRandom,
  wrapDriftY,
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
  ])(
    'menuLayout(%s) frames the fan with margin and keeps the hero in the upper part',
    (_n, aspect) => {
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
      // Dice rest on the plane, inside the framed width, and never
      // inside the rack's footprint (right of it on wide viewports,
      // in front of its right half — closer to the camera — on phones).
      for (const die of l.dice) {
        expect(die.y).toBeGreaterThan(0);
        expect(Math.abs(die.x) + 0.3).toBeLessThan(l.frameWidth / 2);
        if (l.viewCenter.x === 0.5 && l.aspect > 0.85) expect(die.x).toBeGreaterThan(width / 2);
        else expect(die.z).toBeGreaterThan(1);
      }
      expect(l.keepOut).toEqual(driftKeepOut(classifyAspect(aspect)));
    },
  );

  test('landscape-phone rack spans ≤ 26 % of the frame so it clears the card stack', () => {
    const l = menuLayout(915 / 412);
    const perRow = Math.ceil(HERO_COUNT / l.fan.rows);
    const width = fanWidth(perRow, l.fan.spacing);
    const frac = width / l.frameWidth;
    expect(frac).toBeLessThan(0.26);
    // Centre 0.16 → right edge (plus ~0.02 of parallax) stays left of 0.32.
    expect(l.viewCenter.x + frac / 2 + 0.02).toBeLessThan(0.32);
  });

  test('driftVisible thins the field on phones and never exceeds the pool', () => {
    expect(driftVisible('portrait')).toBeLessThan(driftVisible('landscape-phone'));
    expect(driftVisible('landscape-phone')).toBeLessThan(driftVisible('wide'));
    expect(driftVisible('wide')).toBe(DRIFT_COUNT);
    expect(driftVisible('portrait')).toBeGreaterThanOrEqual(12);
    expect(menuLayout(412 / 915).driftVisible).toBe(driftVisible('portrait'));
  });

  test('diceSlots keeps the two dice apart on every class', () => {
    for (const cls of ['portrait', 'landscape-phone', 'wide'] as const) {
      const [a, b] = diceSlots(cls, 8);
      const gap = Math.hypot(a.x - b.x, a.z - b.z);
      expect(gap).toBeGreaterThan(0.6);
    }
  });

  test('drift keep-out: seeds under the title are remapped below it and wraps re-enter below it', () => {
    for (const cls of ['portrait', 'landscape-phone', 'wide'] as const) {
      const k = driftKeepOut(cls);
      expect(k.y1).toBeGreaterThan(-DRIFT_LIMIT);
      expect(k.y1).toBeLessThan(0);
      for (const t of driftField(DRIFT_COUNT).map((d) => placeOutsideKeepOut(d, k))) {
        expect(inKeepOut(t.ux, t.uy, k)).toBe(false);
        expect(t.uy).toBeLessThanOrEqual(DRIFT_LIMIT);
      }
      // Inside the band on x: wrap lands just below the band.
      const xIn = (k.x0 + k.x1) / 2;
      expect(wrapDriftY(DRIFT_LIMIT + 0.05, xIn, k)).toBeCloseTo(k.y1 + 0.05, 9);
      // Untouched inside the range.
      expect(wrapDriftY(0.3, xIn, k)).toBe(0.3);
    }
    // Outside the band on x (wide class leaves the sides free): plain wrap.
    const wide = driftKeepOut('wide');
    expect(wrapDriftY(DRIFT_LIMIT + 0.05, 0.9, wide)).toBeCloseTo(-DRIFT_LIMIT + 0.05, 9);
    // Remap preserves order and never leaves the field.
    const moved = placeOutsideKeepOut({ ux: 0, uy: -1.0 }, wide);
    expect(moved.uy).toBeGreaterThanOrEqual(wide.y1);
    expect(moved.uy).toBeLessThan(DRIFT_LIMIT);
    // A seed already outside is returned unchanged.
    expect(placeOutsideKeepOut({ ux: 0, uy: 0.5 }, wide)).toEqual({ ux: 0, uy: 0.5 });
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
