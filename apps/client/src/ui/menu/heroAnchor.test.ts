import { describe, expect, test } from 'vitest';
import { DOM_FAN_TILES, classifyAspect, domFan, heroAnchor } from './heroAnchor';
import { HERO_GAP_BOTTOM_PX, HERO_GAP_TOP_PX, heroBox } from './heroBand';

/** Bounding box of the fan's slots (unrotated wrappers). */
function fanBounds(slots: ReturnType<typeof domFan>) {
  return {
    top: Math.min(...slots.map((s) => s.top)),
    bottom: Math.max(...slots.map((s) => s.top + s.height)),
    left: Math.min(...slots.map((s) => s.left)),
    right: Math.max(...slots.map((s) => s.left + s.width)),
  };
}

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

  test('landscape-phone fan stays inside the title column (clear of the card stack at x ≈ 0.32)', () => {
    const slots = domFan(915, 412);
    const last = slots[slots.length - 1]!;
    expect(last.left + last.width).toBeLessThan(915 * 0.315);
    // …and below the title block (label + heading end ≈ y 130).
    expect(Math.min(...slots.map((s) => s.top))).toBeGreaterThan(150);
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

  test.each([
    // [viewport, band the lobby measured under its title block]
    ['phone 412×700', 412, 700, { x: 16, y: 136, w: 380, h: 140 }],
    ['phone-small 360×640', 360, 640, { x: 16, y: 160, w: 328, h: 130 }],
    ['phone-tall 412×915', 412, 915, { x: 16, y: 136, w: 380, h: 183 }],
    ['phone-landscape 915×412', 915, 412, { x: 16, y: 130, w: 260, h: 200 }],
    ['desktop 1440×900', 1440, 900, { x: 24, y: 182, w: 1072, h: 160 }],
  ])(
    'domFan(%s) sits inside the measured band, clear of the title and the first card',
    (_n, w, h, band) => {
      const slots = domFan(w, h, { band });
      const b = fanBounds(slots);
      const box = heroBox(band)!;
      // ≥ 16 px under the title block's last line, ≥ 8 px above the cards
      // (the box is the band inset by those gaps; the ends' rotation is
      // covered by the fit's slop, so wrappers sit strictly inside).
      expect(b.top).toBeGreaterThanOrEqual(band.y + HERO_GAP_TOP_PX);
      expect(b.bottom).toBeLessThanOrEqual(band.y + band.h - HERO_GAP_BOTTOM_PX);
      expect(b.left).toBeGreaterThanOrEqual(box.x);
      expect(b.right).toBeLessThanOrEqual(box.x + box.w);
      // Centred in the box.
      expect(Math.abs((b.left + b.right) / 2 - (box.x + box.w / 2))).toBeLessThan(2);
      expect(Math.abs((b.top + b.bottom) / 2 - (box.y + box.h / 2))).toBeLessThan(2);
      // Still legible: nothing below 28 px, and the band is generous
      // enough on every verifier viewport for ≥ 40 px tiles.
      for (const s of slots) expect(s.width).toBeGreaterThanOrEqual(40);
    },
  );

  test('a short band shrinks the fan instead of letting it overlap; no band keeps the anchor', () => {
    const tall = domFan(412, 700, { band: { x: 16, y: 136, w: 380, h: 200 } });
    const short = domFan(412, 700, { band: { x: 16, y: 136, w: 380, h: 90 } });
    expect(short[0]!.width).toBeLessThan(tall[0]!.width);
    expect(short[0]!.width).toBeGreaterThanOrEqual(28);
    const sb = fanBounds(short);
    expect(sb.top).toBeGreaterThanOrEqual(136 + HERO_GAP_TOP_PX);
    expect(sb.bottom).toBeLessThanOrEqual(136 + 90 - HERO_GAP_BOTTOM_PX);
    // A degenerate band (mid-layout) and a missing one both fall back
    // to the viewport-fraction anchor.
    expect(domFan(412, 700, { band: { x: 16, y: 136, w: 380, h: 30 } })).toEqual(domFan(412, 700));
    expect(domFan(412, 700, { band: null })).toEqual(domFan(412, 700));
  });
});
