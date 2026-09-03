import { describe, expect, test } from 'vitest';
import { DOM_FAN_TILES, classifyAspect, domFan, heroAnchor } from './heroAnchor';

describe('hero anchor', () => {
  test('classifyAspect buckets the verifier viewports', () => {
    expect(classifyAspect(412 / 915)).toBe('portrait');
    expect(classifyAspect(834 / 1194)).toBe('portrait');
    expect(classifyAspect(915 / 412)).toBe('landscape-phone');
    expect(classifyAspect(1440 / 900)).toBe('wide');
    expect(classifyAspect(1280 / 900)).toBe('wide');
  });

  test('anchor keeps the hero in the upper part on portrait / wide and left on landscape', () => {
    const portrait = heroAnchor(412 / 915);
    expect(portrait.x).toBe(0.5);
    expect(portrait.y).toBeLessThan(0.4);
    const wide = heroAnchor(1440 / 900);
    expect(wide.x).toBe(0.5);
    expect(wide.y).toBeLessThan(0.4);
    const land = heroAnchor(915 / 412);
    expect(land.x).toBeLessThan(0.3);
    expect(land.y).toBeGreaterThan(0.5);
  });

  test.each([
    ['phone', 412, 915],
    ['phone-landscape', 915, 412],
    ['tablet', 834, 1194],
    ['desktop', 1440, 900],
  ])('domFan(%s) stays inside the safe area with ≥ 44 px tiles', (_n, w, h) => {
    const slots = domFan(w, h);
    expect(slots.length).toBeGreaterThanOrEqual(7);
    expect(slots.length).toBeLessThanOrEqual(DOM_FAN_TILES.length);
    for (const s of slots) {
      expect(s.width).toBeGreaterThanOrEqual(44);
      expect(s.left).toBeGreaterThanOrEqual(12);
      expect(s.left + s.width).toBeLessThanOrEqual(w - 12);
      expect(s.top).toBeGreaterThan(0);
      expect(s.top + s.height).toBeLessThan(h);
    }
    // Symmetric arc: ends sit lower than the centre and yaw outward.
    const first = slots[0]!;
    const last = slots[slots.length - 1]!;
    const centre = slots[(slots.length - 1) / 2]!;
    expect(first.top).toBeGreaterThan(centre.top);
    expect(first.top).toBe(last.top);
    expect(first.rotate).toBeCloseTo(-last.rotate, 9);
    expect(centre.rotate).toBe(0);
    // Centred on the anchor.
    const a = heroAnchor(w / h);
    const mid = (first.left + last.left + last.width) / 2;
    expect(Math.abs(mid - w * a.x)).toBeLessThan(1.5);
  });

  test('fan tiles are distinct and drawn from both suits and honors', () => {
    const keys = new Set(DOM_FAN_TILES.map((t) => JSON.stringify({ ...t, copy: 0 })));
    expect(keys.size).toBe(DOM_FAN_TILES.length);
    expect(DOM_FAN_TILES.some((t) => t.kind === 'honor')).toBe(true);
    expect(DOM_FAN_TILES.some((t) => t.kind === 'suit')).toBe(true);
  });
});
