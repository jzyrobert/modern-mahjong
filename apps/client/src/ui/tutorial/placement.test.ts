import { describe, expect, test } from 'vitest';
import { CARD_GAP, HALO_PAD, haloFor, placeCaption, safeInset } from './placement';

const phone = { width: 412, height: 915 };
const landscape = { width: 915, height: 412 };
const desktop = { width: 1440, height: 900 };

function inside(
  p: { left: number; top: number; width: number },
  h: number,
  vp: { width: number; height: number },
) {
  return p.left >= 0 && p.top >= 0 && p.left + p.width <= vp.width && p.top + h <= vp.height;
}

describe('haloFor', () => {
  test('pads symmetrically and clamps to the origin', () => {
    expect(haloFor({ x: 100, y: 50, w: 40, h: 20 })).toEqual({
      left: 100 - HALO_PAD,
      top: 50 - HALO_PAD,
      width: 40 + HALO_PAD * 2,
      height: 20 + HALO_PAD * 2,
    });
    expect(haloFor({ x: 2, y: 3, w: 10, h: 10 })?.left).toBe(0);
    expect(haloFor(null)).toBeNull();
  });
});

describe('placeCaption', () => {
  test('no target → centred card inside the safe area', () => {
    const p = placeCaption({ viewport: phone, halo: null, cardHeight: 200 });
    expect(p.kind).toBe('center');
    expect(p.notch).toBeNull();
    expect(p.left).toBe(safeInset(phone.width));
    expect(p.top).toBe(Math.round((915 - 200) / 2));
    expect(inside(p, 200, phone)).toBe(true);
  });

  test('own-hand at the bottom → docks above with a notch on the halo centre', () => {
    const halo = { left: 12, top: 760, width: 388, height: 120 };
    const p = placeCaption({ viewport: phone, halo, cardHeight: 220 });
    expect(p.kind).toBe('above');
    expect(p.top + 220 + CARD_GAP).toBeLessThanOrEqual(halo.top);
    expect(p.notch).not.toBeNull();
    // Notch aims at the halo centre in card-local coordinates.
    expect((p.notch ?? 0) + p.left).toBeCloseTo(halo.left + halo.width / 2, 0);
    expect(inside(p, 220, phone)).toBe(true);
  });

  test('top-chrome target → docks below', () => {
    const halo = { left: 300, top: 8, width: 100, height: 40 };
    const p = placeCaption({ viewport: phone, halo, cardHeight: 200 });
    expect(p.kind).toBe('below');
    expect(p.top).toBe(halo.top + halo.height + CARD_GAP);
    // Card clamps to the right safe edge; notch stays inside the card.
    expect(p.left + p.width).toBeLessThanOrEqual(phone.width - safeInset(phone.width));
    expect(p.notch).toBeLessThanOrEqual(p.width);
  });

  test('tall centred result panel on desktop → side dock, CTA on screen', () => {
    const halo = { left: 470, top: 80, width: 500, height: 740 };
    const p = placeCaption({ viewport: desktop, halo, cardHeight: 260 });
    expect(p.kind === 'left' || p.kind === 'right').toBe(true);
    expect(p.left >= halo.left + halo.width || p.left + p.width <= halo.left).toBe(true);
    expect(inside(p, 260, desktop)).toBe(true);
  });

  test('tall centred result panel on a portrait phone → overlaps the bottom only', () => {
    const halo = { left: 16, top: 60, width: 380, height: 800 };
    const p = placeCaption({ viewport: phone, halo, cardHeight: 240 });
    expect(p.kind).toBe('below');
    expect(p.top).toBe(915 - 240 - safeInset(phone.width));
    expect(inside(p, 240, phone)).toBe(true);
  });

  test('landscape phone result panel → narrow side card clamped vertically', () => {
    const halo = { left: 218, top: 20, width: 480, height: 372 };
    const p = placeCaption({ viewport: landscape, halo, cardHeight: 330 });
    expect(p.kind === 'left' || p.kind === 'right').toBe(true);
    expect(p.width).toBeGreaterThanOrEqual(168);
    expect(inside(p, 330, landscape)).toBe(true);
  });

  test('unmeasured card uses the tall estimate and still stays on screen', () => {
    const halo = { left: 12, top: 800, width: 388, height: 100 };
    const p = placeCaption({ viewport: phone, halo, cardHeight: null });
    expect(p.top).toBeGreaterThanOrEqual(safeInset(phone.width));
  });
});
