import { describe, expect, test } from 'vitest';
import { MENU_PARALLAX, MENU_PARALLAX_BEFORE, PointerSmoother, normalisePointer } from './parallax';

describe('menu parallax (round 4: gentler pointer response)', () => {
  test('every response is 35–45 % of what the menu answered with before', () => {
    const ratio = (k: keyof typeof MENU_PARALLAX_BEFORE) =>
      MENU_PARALLAX[k] / MENU_PARALLAX_BEFORE[k];
    for (const k of [
      'cameraStrength',
      'heroShiftX',
      'heroShiftY',
      'driftShiftBase',
      'driftShiftPerDepth',
    ] as const) {
      expect(ratio(k), k).toBeGreaterThanOrEqual(0.35);
      expect(ratio(k), k).toBeLessThanOrEqual(0.45);
    }
    // The nearest drift tile (depth 1) moves ≤ 45 % as far as before.
    const far = MENU_PARALLAX.driftShiftBase + MENU_PARALLAX.driftShiftPerDepth;
    const farBefore = MENU_PARALLAX_BEFORE.driftShiftBase + MENU_PARALLAX_BEFORE.driftShiftPerDepth;
    expect(far / farBefore).toBeLessThanOrEqual(0.45);
  });

  test('the pointer is smoothed over a longer time constant than before', () => {
    expect(MENU_PARALLAX.smoothingS).toBeGreaterThanOrEqual(2.5 * MENU_PARALLAX_BEFORE.smoothingS);
  });

  test('the smoother halves its distance to the target after one half-life and reports rest', () => {
    const s = new PointerSmoother(0.42);
    s.set(1, -1);
    // Half-life of 1 − 2^(−dt/τ) is τ.
    expect(s.step(0.42)).toBe(true);
    expect(s.x).toBeCloseTo(0.5, 6);
    expect(s.y).toBeCloseTo(-0.5, 6);
    // Frame-rate independent: 42 × 10 ms lands where one 420 ms step did.
    const t = new PointerSmoother(0.42);
    t.set(1, -1);
    for (let i = 0; i < 42; i++) t.step(0.01);
    expect(t.x).toBeCloseTo(0.5, 6);
    // Settles: after ~15 half-lives the residual is under the rest threshold.
    for (let i = 0; i < 15; i++) s.step(0.42);
    expect(s.step(0.42)).toBe(false);
  });

  test('a still pointer is at rest from the first frame', () => {
    const s = new PointerSmoother();
    expect(s.step(0.016)).toBe(false);
    expect(s.x).toBe(0);
  });

  test('normalisePointer maps the viewport to [-1, 1] with +y up', () => {
    expect(normalisePointer(0, 0, 1000, 500)).toEqual({ x: -1, y: 1 });
    expect(normalisePointer(1000, 500, 1000, 500)).toEqual({ x: 1, y: -1 });
    expect(normalisePointer(500, 250, 1000, 500)).toEqual({ x: 0, y: -0 });
    // A zero-size window (mid-layout) never divides by zero.
    expect(Number.isFinite(normalisePointer(10, 10, 0, 0).x)).toBe(true);
  });
});
