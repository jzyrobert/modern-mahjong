import { describe, expect, test } from 'vitest';
import {
  CARD_GAP,
  CHROME_GAP,
  FEATHER_OUT,
  FEATHER_TIGHT,
  HALO_PAD,
  featherFor,
  haloFor,
  placeCaption,
  safeInset,
} from './placement';

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

  test('clamps to the safe area when the viewport is known', () => {
    // Result panel taller than a landscape phone: ring stays inset.
    const h = haloFor({ x: 220, y: 4, w: 480, h: 460 }, landscape);
    expect(h).toEqual({ left: 212, top: 12, width: 496, height: 412 - 24 });
    // A well-inset target is untouched.
    expect(haloFor({ x: 100, y: 100, w: 40, h: 20 }, phone)).toEqual({
      left: 92,
      top: 92,
      width: 56,
      height: 36,
    });
  });
});

describe('placeCaption with chrome to avoid', () => {
  const hand = { left: 12, top: 800, width: 388, height: 100 };
  // YOUR TURN pill + sort chips row sitting 6 px above the hand halo.
  const actionRow = [
    { left: 20, top: 770, width: 140, height: 24 },
    { left: 240, top: 770, width: 160, height: 24 },
  ];

  test('above dock lifts clear of the adjacent action row instead of bisecting it', () => {
    const p = placeCaption({ viewport: phone, halo: hand, cardHeight: 220, avoid: actionRow });
    expect(p.kind).toBe('above');
    expect(p.top + 220 + CHROME_GAP).toBeLessThanOrEqual(770);
    expect(p.overlapsChrome).toBe(false);
    // Still aims the notch at the halo centre and stays on screen.
    expect((p.notch ?? 0) + p.left).toBeCloseTo(hand.left + hand.width / 2, 0);
    expect(inside(p, 220, phone)).toBe(true);
  });

  test("chrome mostly inside the halo (the target's own buttons) is ignored", () => {
    const inHalo = [{ left: 30, top: 820, width: 100, height: 30 }];
    const plain = placeCaption({ viewport: phone, halo: hand, cardHeight: 220 });
    const p = placeCaption({ viewport: phone, halo: hand, cardHeight: 220, avoid: inHalo });
    expect(p).toEqual(plain);
  });

  test('prefers the vertical slot that ends up clear of chrome', () => {
    // More room below (so below is preferred), but a solid block of
    // chrome under the halo cannot be cleared within the safe area.
    const halo = { left: 100, top: 300, width: 200, height: 60 };
    const block = [{ left: 0, top: 380, width: 412, height: 535 }];
    const p = placeCaption({ viewport: phone, halo, cardHeight: 200, avoid: block });
    expect(p.kind).toBe('above');
    expect(p.overlapsChrome).toBe(false);
  });

  test('reports overlap when no slot can be made clear', () => {
    const halo = { left: 100, top: 300, width: 200, height: 60 };
    const everywhere = [
      { left: 0, top: 0, width: 412, height: 280 },
      { left: 0, top: 380, width: 412, height: 535 },
    ];
    const p = placeCaption({ viewport: phone, halo, cardHeight: 200, avoid: everywhere });
    expect(p.overlapsChrome).toBe(true);
    expect(inside(p, 200, phone)).toBe(true);
  });

  test('covers a control fully rather than clipping its edge when it cannot clear it', () => {
    // Dice modal on a phone: the card cannot fit between the top HUD
    // and the halo, so it docks flush to the safe top and covers the
    // HUD instead of cutting 5 px into the menu button.
    const halo = { left: 12, top: 287, width: 388, height: 340 };
    const hud = [
      { left: 362, top: 12, width: 38, height: 33 },
      { left: 40, top: 22, width: 200, height: 14 },
      // Action row + hand tiles below: docking there would cover far more.
      { left: 12, top: 777, width: 388, height: 26 },
      { left: 20, top: 805, width: 372, height: 90 },
    ];
    const p = placeCaption({ viewport: phone, halo, cardHeight: 232, avoid: hud });
    expect(p.kind).toBe('above');
    expect(p.top).toBe(12);
    expect(p.overlapsChrome).toBe(true);
  });

  test('side dock pulls its inner edge past a chip it would otherwise clip', () => {
    // Landscape phone, dice modal halo, `Player` chip ending 7 px inside
    // the strip the card docks into.
    const halo = { left: 230, top: 30, width: 440, height: 350 };
    const chip = [{ left: 655, top: 150, width: 42, height: 20 }];
    const p = placeCaption({ viewport: landscape, halo, cardHeight: 280, avoid: chip });
    expect(p.kind).toBe('right');
    expect(p.left).toBeGreaterThanOrEqual(697 + CHROME_GAP);
    expect(p.width).toBeGreaterThanOrEqual(168);
    expect(p.overlapsChrome).toBe(false);
  });

  test('side dock nudges past a chip the target itself half covers', () => {
    // Landscape phone dice modal: the `Player` chip is 58% under the
    // modal, so it is not "chrome to dodge" for the row search, but the
    // sliver peeking out must not be cut by the card's inner edge.
    const halo = { left: 239, top: 35, width: 436, height: 342 };
    const chip = [{ left: 648, top: 51, width: 48, height: 17 }];
    const p = placeCaption({ viewport: landscape, halo, cardHeight: 289, avoid: chip });
    expect(p.kind).toBe('right');
    expect(p.left).toBeGreaterThanOrEqual(696 + CHROME_GAP);
    expect(p.left + p.width).toBeLessThanOrEqual(915 - safeInset(915));
    expect(p.overlapsChrome).toBe(false);
  });

  test('side dock slides down off the top status row', () => {
    const halo = { left: 210, top: 20, width: 480, height: 372 };
    const statusRow = [{ left: 700, top: 14, width: 200, height: 40 }];
    const p = placeCaption({ viewport: landscape, halo, cardHeight: 320, avoid: statusRow });
    expect(p.kind).toBe('right');
    expect(p.top).toBeGreaterThanOrEqual(54 + CHROME_GAP);
    expect(p.overlapsChrome).toBe(false);
    expect(inside(p, 320, landscape)).toBe(true);
  });
});

describe('featherFor', () => {
  const dice = { left: 240, top: 30, width: 440, height: 350 };

  test('keeps the full feather with nothing nearby', () => {
    expect(featherFor(dice, [])).toEqual({
      top: FEATHER_OUT,
      right: FEATHER_OUT,
      bottom: FEATHER_OUT,
      left: FEATHER_OUT,
    });
  });

  test('tightens only the side that butts against an opaque neighbour', () => {
    // Hand row starting right under the dice modal on a landscape phone.
    const hand = { left: 200, top: 376, width: 520, height: 36 };
    const f = featherFor(dice, [hand]);
    expect(f.bottom).toBe(FEATHER_TIGHT);
    expect(f.top).toBe(FEATHER_OUT);
    expect(f.left).toBe(FEATHER_OUT);
    expect(f.right).toBe(FEATHER_OUT);
  });

  test('ignores neighbours mostly inside the halo and ones outside the band', () => {
    const inside = { left: 300, top: 100, width: 100, height: 40 };
    const far = { left: 240, top: 420, width: 440, height: 40 };
    const beside = { left: 0, top: 100, width: 200, height: 40 }; // 40 px gap on the left
    const f = featherFor(dice, [inside, far, beside]);
    expect(f).toEqual({
      top: FEATHER_OUT,
      right: FEATHER_OUT,
      bottom: FEATHER_OUT,
      left: FEATHER_OUT,
    });
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
