import { describe, expect, test } from 'vitest';
import {
  CARD_GAP,
  CENTRE_CHROME_GAP,
  CENTRE_DRIFT_MAX,
  CENTRE_MAX_WIDTH_SHORT,
  CHROME_GAP,
  FEATHER_OUT,
  FEATHER_TIGHT,
  HALO_OVERHANG,
  HALO_PAD,
  NOTCH_DEPTH,
  NOTCH_MAX_GAP,
  NO_OPEN_SIDES,
  SIDE_GUTTER,
  STRADDLE_MAX,
  STRADDLE_PAD,
  STRIP_HEIGHT_ESTIMATE,
  centredRoom,
  encloseStraddlers,
  featherFor,
  focusRect,
  haloFor,
  intersectionArea,
  placeCaption,
  safeInset,
  sideIdealTop,
  trimStraddlers,
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

  test('opens onto the viewport edge where the target itself reaches the safe line', () => {
    // Result panel taller than a landscape phone: the ring overhangs
    // top and bottom (clipped by the overlay) so no stroke is drawn
    // across the panel's header or action row; the sides stay padded.
    const h = haloFor({ x: 220, y: 4, w: 480, h: 460 }, landscape);
    expect(h).toEqual({
      left: 212,
      top: -HALO_OVERHANG,
      width: 496,
      height: 412 + HALO_OVERHANG * 2,
    });
    // Horizontal sides never open: the hand container spans a phone
    // edge to edge but its tiles sit inside the shell padding, so the
    // side clamp frames them.
    const wide = haloFor({ x: 0, y: 815, w: 412, h: 100 }, phone);
    expect(wide?.left).toBe(12);
    expect((wide?.left ?? 0) + (wide?.width ?? 0)).toBe(400);
    expect((wide?.top ?? 0) + (wide?.height ?? 0)).toBe(915 + HALO_OVERHANG);
    // Hand tiles running to 3 px past the safe line: bottom opens, the
    // three other sides keep their pad.
    const hand = haloFor({ x: 195, y: 335, w: 595, h: 67 }, landscape);
    expect(hand?.top).toBe(335 - HALO_PAD);
    expect(hand?.left).toBe(195 - HALO_PAD);
    expect((hand?.top ?? 0) + (hand?.height ?? 0)).toBe(412 + HALO_OVERHANG);
    // Padding alone poking past the safe line is still clamped.
    const inset = haloFor({ x: 100, y: 20, w: 40, h: 20 }, phone);
    expect(inset?.top).toBe(12);
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
    // The notch survives while the gap is small, aimed at the halo
    // centre; a card pushed further away drops it (see below).
    const gap = hand.top - (p.top + 220);
    expect(p.gap).toBe(gap);
    if (gap <= NOTCH_MAX_GAP) {
      expect((p.notch ?? 0) + p.left).toBeCloseTo(hand.left + hand.width / 2, 0);
    } else {
      expect(p.notch).toBeNull();
    }
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

describe('placeCaption: notch footprint and side re-dock', () => {
  test('the notch tip clears chrome too, not just the card body', () => {
    // Desktop own-hand: the wall counter pill sits 60 px above the halo.
    const hand = { left: 200, top: 680, width: 600, height: 80 };
    const counter = [{ left: 700, top: 612, width: 40, height: 14 }];
    // Neither side strip is wide enough, so the dock must stay vertical.
    const vp = { width: 1000, height: 900 };
    const p = placeCaption({ viewport: vp, halo: hand, cardHeight: 215, avoid: counter });
    expect(p.kind).toBe('above');
    // Card bottom + notch + gutter ends above the pill.
    expect(p.top + 215 + NOTCH_DEPTH + CHROME_GAP).toBeLessThanOrEqual(612);
  });

  test('a vertical dock pushed far from the halo drops its notch', () => {
    const halo = { left: 12, top: 800, width: 388, height: 100 };
    // Solid chrome band directly above the hand, too tall to sit beside.
    const band = [{ left: 12, top: 720, width: 388, height: 60 }];
    const p = placeCaption({ viewport: phone, halo, cardHeight: 200, avoid: band });
    expect(p.kind).toBe('above');
    expect(p.gap ?? 0).toBeGreaterThan(NOTCH_MAX_GAP);
    expect(p.notch).toBeNull();
    expect(p.overlapsChrome).toBe(false);
  });

  test('re-docks beside the halo on desktop when chrome pushes the card away', () => {
    // 1440×900 own-hand step: plate + sort chips + turn pill row above
    // the hand, wall counter above that. Right of the hand there is a
    // 420 px strip.
    const hand = { left: 420, top: 680, width: 600, height: 80 };
    const row = [
      { left: 450, top: 636, width: 130, height: 40 },
      { left: 600, top: 644, width: 200, height: 30 },
      { left: 830, top: 644, width: 160, height: 30 },
      { left: 700, top: 612, width: 40, height: 14 },
    ];
    const p = placeCaption({ viewport: desktop, halo: hand, cardHeight: 215, avoid: row });
    expect(p.kind).toBe('right');
    expect(p.left).toBe(1020 + 12);
    expect(p.left + p.width).toBe(1440 - 24);
    expect(p.notch).not.toBeNull();
    expect(p.top + 215).toBeLessThanOrEqual(900 - 24);
    expect(inside(p, 215, desktop)).toBe(true);
  });

  test('keeps the vertical dock when the only side strip is too narrow', () => {
    // Landscape phone: 195 px left of the hand is room for a compact
    // side card but not a comfortable one — stay above with no notch.
    const hand = { left: 195, top: 327, width: 595, height: 100 };
    const band = [{ left: 195, top: 250, width: 595, height: 60 }];
    const p = placeCaption({ viewport: landscape, halo: hand, cardHeight: 150, avoid: band });
    expect(p.kind).toBe('above');
    expect(p.notch).toBeNull();
  });

  test('a vertical dock slides sideways to keep a gutter from chrome beside it', () => {
    // Landscape phone own-hand: the round panel's labels start 8 px
    // right of where the centred card would end.
    const hand = { left: 204, top: 342, width: 580, height: 88 };
    const labels = [
      { left: 722, top: 134, width: 20, height: 11 },
      { left: 722, top: 149, width: 31, height: 11 },
    ];
    const plain = placeCaption({ viewport: landscape, halo: hand, cardHeight: 216 });
    const p = placeCaption({ viewport: landscape, halo: hand, cardHeight: 216, avoid: labels });
    expect(plain.left + plain.width).toBe(714);
    expect(p.left + p.width).toBeLessThanOrEqual(722 - SIDE_GUTTER);
    expect(p.kind).toBe('above');
    // Notch still aims at the halo centre.
    expect((p.notch ?? 0) + p.left).toBeCloseTo(hand.left + hand.width / 2, 0);
  });

  test('side dock respects the 24 px desktop inset on its outer edge', () => {
    // Result panel centred on desktop; the card must not touch the halo.
    const panel = { left: 420, top: 100, width: 600, height: 700 };
    const p = placeCaption({ viewport: desktop, halo: panel, cardHeight: 300 });
    expect(p.kind).toBe('right');
    expect(p.gap).toBe(12);
    expect(p.left + p.width).toBeLessThanOrEqual(1440 - 24);
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
    // Sitting over the panel: the card deepens its tint even though the
    // panel's buttons are spotlit content rather than chrome to dodge.
    expect(p.overlapsChrome).toBe(true);
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

describe('placeCaption: centred card over chrome', () => {
  // Landscape phone, scoring-intro step 0: the Order / Player toggle in
  // the discards header and the hand row at the bottom both fall under
  // a dead-centre 300 px card. (Short viewports widen the centred card
  // to CENTRE_MAX_WIDTH_SHORT — see the width tests below.)
  const toggle = { left: 602, top: 51, width: 94, height: 17 };
  const hand = { left: 210, top: 350, width: 560, height: 62 };

  test('dead centre with nothing underneath', () => {
    const p = placeCaption({ viewport: landscape, halo: null, cardHeight: 300 });
    expect(p.kind).toBe('center');
    expect(p.left).toBe(Math.round((915 - CENTRE_MAX_WIDTH_SHORT) / 2));
    expect(p.overlapsChrome).toBe(false);
  });

  test('slides off chrome it would otherwise ghost through', () => {
    const p = placeCaption({
      viewport: landscape,
      halo: null,
      cardHeight: 300,
      avoid: [toggle, hand],
    });
    expect(p.kind).toBe('center');
    const card = { left: p.left, top: p.top, width: p.width, height: 300 };
    const hits = (r: typeof toggle) =>
      card.left < r.left + r.width &&
      card.left + card.width > r.left &&
      card.top < r.top + r.height &&
      card.top + card.height > r.top;
    // The toggle is either clear of the card or swallowed whole — never
    // bisected; the hand row always stays clear.
    const covers = (r: typeof toggle) =>
      r.left >= card.left &&
      r.left + r.width <= card.left + card.width &&
      r.top >= card.top &&
      r.top + r.height <= card.top + card.height;
    expect(!hits(toggle) || covers(toggle)).toBe(true);
    expect(hits(hand)).toBe(false);
    expect(p.overlapsChrome).toBe(hits(toggle));
    expect(inside(p, 300, landscape)).toBe(true);
    expect(p.left).toBeGreaterThanOrEqual(safeInset(915));
  });

  test('covers a small toggle whole near centre rather than sliding 70 px off it', () => {
    // Landscape phone, 300 px card: the toggle's y range overlaps every
    // top the hand row allows, so only a horizontal move can clear it.
    // A 20 px shift that swallows the toggle (solid card) keeps the card
    // reading as centred; the clear spot is 74 px off and does not.
    const tallToggle = { left: 602, top: 51, width: 94, height: 17 };
    const p = placeCaption({
      viewport: landscape,
      halo: null,
      cardHeight: 300,
      avoid: [tallToggle, hand],
    });
    const idealLeft = Math.round((915 - CENTRE_MAX_WIDTH_SHORT) / 2);
    expect(Math.abs(p.left - idealLeft)).toBeLessThanOrEqual(CENTRE_DRIFT_MAX);
    expect(p.overlapsChrome).toBe(true);
    // Fully covered, never bisected.
    expect(p.left).toBeLessThanOrEqual(tallToggle.left);
    expect(p.left + p.width).toBeGreaterThanOrEqual(tallToggle.left + tallToggle.width);
    // ≥ 12 px of air above the hand row.
    expect(p.top + 300 + CENTRE_CHROME_GAP).toBeLessThanOrEqual(hand.top);
  });

  test('keeps CENTRE_CHROME_GAP of air even when a closer spot merely does not touch', () => {
    // Toggle at y 45..63 with a 305 px card: flush-over-the-toggle (top 45,
    // bottom 350) clears the hand row at 352 by 2 px and sits nearer the
    // ideal, but the spot 12 px above the hand wins on air.
    const toggle45 = { left: 602, top: 45, width: 94, height: 18 };
    const hand352 = { left: 210, top: 352, width: 560, height: 60 };
    const p = placeCaption({
      viewport: landscape,
      halo: null,
      cardHeight: 305,
      avoid: [toggle45, hand352],
    });
    expect(p.top + 305 + CENTRE_CHROME_GAP).toBeLessThanOrEqual(hand352.top);
    expect(Math.abs(p.left - Math.round((915 - CENTRE_MAX_WIDTH_SHORT) / 2))).toBeLessThanOrEqual(
      CENTRE_DRIFT_MAX,
    );
  });

  test('prefers a vertical shift over a sideways one when both clear the chrome', () => {
    const chip = { left: 430, top: 60, width: 60, height: 20 };
    const p = placeCaption({ viewport: landscape, halo: null, cardHeight: 200, avoid: [chip] });
    expect(p.left).toBe(Math.round((915 - CENTRE_MAX_WIDTH_SHORT) / 2));
    expect(p.overlapsChrome).toBe(false);
    expect(p.top).toBeGreaterThanOrEqual(60 + 20 + CENTRE_CHROME_GAP);
  });

  test('reports the overlap (→ solid card) when no nearby spot is clear', () => {
    // A wall of chrome across the whole middle band: nothing within the
    // shift budget clears it, so the card stays put and paints solid.
    const wall = { left: 0, top: 100, width: 915, height: 60 };
    const p = placeCaption({ viewport: landscape, halo: null, cardHeight: 300, avoid: [wall] });
    expect(p.kind).toBe('center');
    expect(p.overlapsChrome).toBe(true);
  });
});

describe('encloseStraddlers', () => {
  const halo = { left: 500, top: 280, width: 440, height: 340 };

  test('grows to swallow a label the ring would bisect', () => {
    // The "69 left" wall counter sits across the dice modal's bottom edge.
    const counter = { left: 700, top: 612, width: 40, height: 14 };
    const out = encloseStraddlers(halo, [counter], desktop);
    expect(out).not.toBeNull();
    expect(out!.top + out!.height).toBe(626 + STRADDLE_PAD);
    expect(out!.left).toBe(halo.left);
    expect(out!.width).toBe(halo.width);
  });

  test('grows sideways for a chip peeking past the right edge', () => {
    const chip = { left: 900, top: 300, width: 60, height: 18 };
    const out = encloseStraddlers(halo, [chip], desktop);
    expect(out!.left + out!.width).toBe(960 + STRADDLE_PAD);
  });

  test('never pulls in a neighbour whose centre lies outside the ring', () => {
    // Landscape scoring-1: the seat strip's '西 Bao' badge sits 20 px
    // above the result panel with only its bottom 6 px inside the halo
    // padding. It is a neighbour, not a bisected label — the ring must
    // hug the panel (HALO_PAD) instead of lighting the badge.
    const badge = { left: 690, top: 262, width: 120, height: 24 };
    expect(encloseStraddlers(halo, [badge], desktop)).toBe(halo);
    // The same badge mostly inside the ring is enclosed as before.
    const inside = { left: 690, top: 270, width: 120, height: 24 };
    expect(encloseStraddlers(halo, [inside], desktop)?.top).toBe(270 - STRADDLE_PAD);
  });

  test('leaves the halo alone for a neighbour that overhangs too far', () => {
    const region = { left: 400, top: 600, width: 640, height: 60 };
    const out = encloseStraddlers(halo, [region], desktop);
    expect(out).toBe(halo);
    expect(600 + 60 - (halo.top + halo.height)).toBeGreaterThan(STRADDLE_MAX);
  });

  test('ignores chrome that does not touch the ring and clamps to the safe inset', () => {
    const far = { left: 100, top: 100, width: 40, height: 14 };
    expect(encloseStraddlers(halo, [far], desktop)).toBe(halo);
    const edge = { left: 1392, top: 300, width: 30, height: 18 };
    const wide = { left: 500, top: 280, width: 910, height: 340 };
    const out = encloseStraddlers(wide, [edge], desktop);
    expect(out!.left + out!.width).toBe(1440 - safeInset(1440));
  });
});

describe('trimStraddlers', () => {
  // Landscape phone, basics step 0: the dice modal (halo) overlaps the
  // top ~50 px of the 14 hand tiles; each tile is ~55 × 80 and runs to
  // the bottom edge.
  const modal = { left: 210, top: 40, width: 495, height: 340 };
  const tiles = Array.from({ length: 14 }, (_, i) => ({
    left: 215 + i * 40,
    top: 330,
    width: 36,
    height: 80,
  }));

  test('cuts the ring back to the modal portion above the hand row and opens that side', () => {
    const { halo, open } = trimStraddlers(modal, tiles);
    expect(open).toEqual({ top: false, right: false, bottom: true, left: false });
    expect(halo).toEqual({ left: 210, top: 40, width: 495, height: 330 - STRADDLE_PAD - 40 });
  });

  test('leaves a lone small chip to encloseStraddlers', () => {
    const counter = { left: 400, top: 372, width: 40, height: 14 };
    const out = trimStraddlers(modal, [counter]);
    expect(out.halo).toBe(modal);
    expect(out.open).toEqual({ top: false, right: false, bottom: false, left: false });
  });

  test('ignores neighbours that only touch the halo padding', () => {
    // Tiles 6 px under the claim bar: they cross the 8 px pad but not the
    // target proper — featherFor tightens that side, the ring stays whole.
    const bar = { left: 100, top: 300, width: 600, height: 72 };
    const row = tiles.map((t) => ({ ...t, top: 366 }));
    expect(trimStraddlers(bar, row).halo).toBe(bar);
  });

  test('keeps the ring whole when the neighbour covers most of the target', () => {
    const region = { left: 0, top: 150, width: 915, height: 400 };
    expect(trimStraddlers(modal, [region]).halo).toBe(modal);
  });

  test('a null halo passes through', () => {
    expect(trimStraddlers(null, tiles)).toEqual({ halo: null, open: NO_OPEN_SIDES });
  });
});

describe('centredRoom', () => {
  // 3D landscape phone: HUD pills across the top (bottom ≈ 45), seat
  // badges at the sides, the hand row from y 300.
  const hand = { left: 115, top: 300, width: 685, height: 70 };
  const hud = [
    { left: 12, top: 12, width: 213, height: 33 },
    { left: 232, top: 12, width: 38, height: 33 },
    { left: 415, top: 12, width: 85, height: 33 },
  ];
  const sideBadges = [
    { left: 12, top: 60, width: 94, height: 34 },
    { left: 820, top: 90, width: 80, height: 34 },
  ];
  test('measures from the chrome above the card column to the hand row', () => {
    const room = centredRoom(hand, [...hud, ...sideBadges, hand], landscape, 440);
    expect(room).toBe(300 - CENTRE_CHROME_GAP - (45 + CENTRE_CHROME_GAP));
  });
  test('falls back to the safe inset with nothing above, and ignores lower-half chrome', () => {
    const low = [{ left: 300, top: 250, width: 100, height: 30 }];
    expect(centredRoom(hand, [...low, hand], landscape, 440)).toBe(
      300 - CENTRE_CHROME_GAP - safeInset(915),
    );
  });
});

describe('sideIdealTop', () => {
  test('bottom-third halo aligns the card bottom to the halo bottom', () => {
    const halo = { left: 420, top: 682, width: 600, height: 76 };
    expect(sideIdealTop(halo, 216, 900)).toBe(682 + 76 - 216);
  });
  test('top-third halo aligns the card top to the halo top', () => {
    const halo = { left: 229, top: 26, width: 456, height: 180 };
    expect(sideIdealTop(halo, 330, 412)).toBe(26);
  });
  test('middle band centres on the halo', () => {
    const halo = { left: 470, top: 200, width: 500, height: 400 };
    expect(sideIdealTop(halo, 260, 900)).toBe(400 - 130);
  });
  test('desktop own-hand side dock stays on the felt', () => {
    // The plate / sort-chip / turn-pill row above the hand pushes the
    // above-dock away, so the card re-docks beside the halo; the
    // bottom-third rule then hangs it from the halo's bottom edge
    // instead of centring it half over the rail.
    const halo = { left: 420, top: 682, width: 600, height: 76 };
    const row = [
      { left: 445, top: 635, width: 145, height: 50 },
      { left: 605, top: 645, width: 210, height: 28 },
      { left: 840, top: 645, width: 160, height: 28 },
    ];
    const p = placeCaption({ viewport: desktop, halo, cardHeight: 216, avoid: row });
    expect(p.kind === 'left' || p.kind === 'right').toBe(true);
    expect(p.top + 216).toBeLessThanOrEqual(halo.top + halo.height + 1);
    expect(p.notch).not.toBeNull();
  });
});

describe('focusRect', () => {
  const panel = { x: 30, y: 200, w: 350, h: 620 };
  test('clips the target to the band through the descendant', () => {
    const button = { left: 60, top: 400, width: 120, height: 36 };
    expect(focusRect(panel, button)).toEqual({ x: 30, y: 200, w: 350, h: 436 + HALO_PAD - 200 });
  });
  test('starts at the content box when the wrapper carries an outer margin', () => {
    const wrapper = { x: 238, y: 16, w: 440, h: 427 };
    const paper = { left: 238, top: 32, width: 440, height: 411 };
    const button = { left: 253, top: 160, width: 120, height: 36 };
    expect(focusRect(wrapper, button, HALO_PAD, paper)).toEqual({
      x: 238,
      y: 32,
      w: 440,
      h: 196 + HALO_PAD - 32,
    });
    // A "first child" that is not near the top (a scrolled list) is ignored.
    const low = { left: 238, top: 300, width: 440, height: 100 };
    expect(focusRect(wrapper, button, HALO_PAD, low).y).toBe(16);
  });

  test('returns the target unchanged without a descendant or when the clip is moot', () => {
    expect(focusRect(panel, null)).toBe(panel);
    const low = { left: 60, top: 810, width: 120, height: 36 };
    expect(focusRect(panel, low)).toBe(panel);
    const above = { left: 60, top: 100, width: 120, height: 36 };
    expect(focusRect(panel, above)).toBe(panel);
  });
});

describe('placeCaption: keepClear (partly spotlit target)', () => {
  // Desktop: the result panel spans 360..1080 × 220..660 but only its
  // score header + hand (top 200 px) is spotlit.
  const panel = { left: 360, top: 220, width: 720, height: 440 };
  const halo = { left: 352, top: 212, width: 736, height: 216 };

  test('re-docks beside the halo instead of covering the rest of the panel', () => {
    const p = placeCaption({ viewport: desktop, halo, cardHeight: 300, keepClear: panel });
    expect(p.kind === 'left' || p.kind === 'right').toBe(true);
    expect(p.left >= panel.left + panel.width || p.left + p.width <= panel.left).toBe(true);
    expect(p.overlapsChrome).toBe(false);
  });

  test('stays vertical without keepClear', () => {
    const p = placeCaption({ viewport: desktop, halo, cardHeight: 300 });
    expect(p.kind).toBe('below');
  });

  test('docks snug under the focus band over the dimmed remainder instead of floating past it', () => {
    // Portrait: the ideal below-dock lands on the panel's rules chips.
    // Those are the spotlit target's own dimmed remainder, which the
    // solid card covers whole — so the card stays at CARD_GAP with its
    // notch on the ring rather than dropping 90 px to clear them (where
    // the notch would point at the chips). Without `keepClear` the same
    // chrome pushes the card down and the long gap drops the notch.
    const phonePanel = { left: 16, top: 200, width: 380, height: 620 };
    const phoneHalo = { left: 12, top: 192, width: 388, height: 236 };
    const faanChips = { left: 200, top: 490, width: 180, height: 25 };
    const startButton = { left: 30, top: 700, width: 140, height: 44 };
    const sortChips = { left: 240, top: 782, width: 160, height: 24 };
    const avoid = [faanChips, startButton, sortChips];
    const p = placeCaption({
      viewport: phone,
      halo: phoneHalo,
      cardHeight: 284,
      avoid,
      keepClear: phonePanel,
    });
    expect(p.kind).toBe('below');
    expect(p.top).toBe(192 + 236 + CARD_GAP);
    expect(p.gap).toBe(CARD_GAP);
    expect(p.notch).not.toBeNull();
    expect(p.overlapsChrome).toBe(true);
    const without = placeCaption({ viewport: phone, halo: phoneHalo, cardHeight: 284, avoid });
    expect(without.top).toBe(490 + 25 + CHROME_GAP + NOTCH_DEPTH);
    expect(without.gap).toBeGreaterThan(NOTCH_MAX_GAP);
    expect(without.notch).toBeNull();
  });

  test('portrait phone: no side strip, so the card sits below and paints solid', () => {
    const phonePanel = { left: 16, top: 200, width: 380, height: 620 };
    const phoneHalo = { left: 12, top: 192, width: 388, height: 236 };
    const p = placeCaption({
      viewport: phone,
      halo: phoneHalo,
      cardHeight: 330,
      keepClear: phonePanel,
    });
    expect(p.kind).toBe('below');
    expect(p.notch).not.toBeNull();
    expect(p.overlapsChrome).toBe(true);
    expect(inside(p, 330, phone)).toBe(true);
  });
});

describe('placeCaption: landscape bottom strip', () => {
  // The 3D dice panel on a landscape phone: 620 px wide (12 px strips on
  // either side are far below SIDE_CARD_MIN_WIDTH), trimmed above the
  // hand row at y ≈ 298, so neither vertical slot fits a card either.
  const modal = { left: 139, top: 87, width: 637, height: 211 };

  test('a wide modal with no slot and no side strip gets the bottom strip, not the overlap dock', () => {
    const p = placeCaption({ viewport: landscape, halo: modal, cardHeight: 235 });
    expect(p.kind).toBe('strip');
    expect(p.left).toBe(12);
    expect(p.width).toBe(915 - 24);
    // Unmeasured: the estimate keeps the strip inside the safe area…
    expect(p.top).toBe(412 - 12 - STRIP_HEIGHT_ESTIMATE);
    expect(p.notch).toBeNull();
    // …and it never climbs onto the lit modal.
    expect(p.top).toBeGreaterThanOrEqual(modal.top + modal.height);
  });

  test('the measured strip height positions it, the card height never does', () => {
    const p = placeCaption({ viewport: landscape, halo: modal, cardHeight: null, stripHeight: 89 });
    expect(p.kind).toBe('strip');
    expect(p.top).toBe(412 - 12 - 89);
    // A strip-sized *card* height would make the vertical slot look like
    // it fits; the overlay keeps the two measurements apart for exactly
    // this reason, so a card of 89 px here is a caller bug — but the
    // strip height alone must not flip the dock.
    const again = placeCaption({
      viewport: landscape,
      halo: modal,
      cardHeight: 235,
      stripHeight: 89,
    });
    expect(again.kind).toBe('strip');
  });

  test('covers the dimmed hand row and reports it so the strip paints solid', () => {
    const hand = { left: 110, top: 302, width: 700, height: 70 };
    const p = placeCaption({ viewport: landscape, halo: modal, cardHeight: 235, avoid: [hand] });
    expect(p.kind).toBe('strip');
    expect(p.overlapsChrome).toBe(true);
  });

  test('portrait keeps the overlap-bottom fallback', () => {
    const tall = { left: 20, top: 40, width: 372, height: 800 };
    const p = placeCaption({ viewport: phone, halo: tall, cardHeight: 240 });
    expect(p.kind).toBe('below');
  });
});

describe('placeCaption: side dock beside a modal is deterministic', () => {
  // Desktop 3D dice panel taller than either vertical slot allows, with
  // the right seat badge sitting in the right strip at mid-height.
  const modal = { left: 400, top: 200, width: 640, height: 500 };
  const badge = { left: 1140, top: 420, width: 150, height: 60 };

  test('a badge within the halo span is covered whole at the ideal top, found or not', () => {
    const without = placeCaption({ viewport: desktop, halo: modal, cardHeight: 248 });
    const withBadge = placeCaption({
      viewport: desktop,
      halo: modal,
      cardHeight: 248,
      avoid: [badge],
    });
    expect(without.kind).toBe('right');
    expect(withBadge.kind).toBe('right');
    expect(withBadge.top).toBe(without.top);
    expect(withBadge.left).toBe(without.left);
    // The card paints solid over the badge it swallowed.
    expect(withBadge.overlapsChrome).toBe(true);
  });

  test('a badge the card would bisect still moves it', () => {
    const without = placeCaption({ viewport: desktop, halo: modal, cardHeight: 248 });
    const straddling = { left: 1140, top: without.top + 248 - 20, width: 150, height: 60 };
    const p = placeCaption({
      viewport: desktop,
      halo: modal,
      cardHeight: 248,
      avoid: [straddling],
    });
    expect(p.kind).toBe('right');
    const card = { left: p.left, top: p.top, width: p.width, height: 248 };
    const a = intersectionArea(card, straddling);
    expect(a === 0 || a === straddling.width * straddling.height).toBe(true);
  });
});

describe('placeCaption: centred card width on a short viewport', () => {
  test('landscape phone widens the centred card to CENTRE_MAX_WIDTH_SHORT', () => {
    const p = placeCaption({ viewport: landscape, halo: null, cardHeight: 200 });
    expect(p.kind).toBe('center');
    expect(p.width).toBe(CENTRE_MAX_WIDTH_SHORT);
    expect(p.left).toBe(Math.round((915 - CENTRE_MAX_WIDTH_SHORT) / 2));
  });

  test('portrait and desktop keep CARD_MAX_WIDTH', () => {
    expect(placeCaption({ viewport: desktop, halo: null, cardHeight: 200 }).width).toBe(440);
    expect(placeCaption({ viewport: phone, halo: null, cardHeight: 200 }).width).toBe(412 - 24);
  });
});
