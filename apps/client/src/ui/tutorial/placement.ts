import type { TargetRect } from './TargetRegistry';

/**
 * Pure caption-placement math for `<TutorialOverlay>`. Kept free of
 * React so the dock decisions are unit-tested (`placement.test.ts`)
 * rather than re-derived from screenshots every time a lesson adds a
 * target.
 *
 * Model: the halo is the target rect padded by `HALO_PAD` and clamped
 * to the safe area. The caption card docks *adjacent* to the halo —
 * above or below it with a pointer notch aimed at the halo's centre —
 * and falls back to a side dock (wide viewports, tall centred targets
 * like the result panel) or an overlapping bottom dock (portrait
 * phones) when neither vertical slot has room. Every branch ends in
 * the same clamp so the whole card, CTA included, stays inside the
 * safe area.
 *
 * Chrome avoidance: callers may pass `avoid` — rects of HUD chrome
 * (the YOUR TURN pill, sort chips, the top status bar, other coach-mark
 * targets). A dock that would cut through one of them is shifted away
 * from the halo (bounded by `MAX_CHROME_SHIFT`) so a control is either
 * fully covered or fully clear, never bisected. When both vertical
 * slots fit, the one that ends up clear of chrome wins; when no slot
 * can be made clear the least-overlapping one is used and
 * `overlapsChrome` is reported so the card can deepen its glass tint.
 */
export interface HaloRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** `strip`: a slim full-width band along the bottom of a landscape
 *  phone, over the dimmed hand row — the fallback for a wide modal
 *  target (the 3D dice panel) that leaves no vertical slot and no side
 *  strip; it never covers the target the way the overlap dock would. */
export type DockKind = 'above' | 'below' | 'left' | 'right' | 'center' | 'strip';

export interface CaptionPlacement {
  kind: DockKind;
  left: number;
  top: number;
  width: number;
  /** Where the notch sits along the card edge facing the halo, in
   *  card-local px (x for above/below, y for left/right). `null` when
   *  the card is centred with no target. */
  notch: number | null;
  /** Distance between the card edge facing the halo and the halo edge
   *  (0 when the card overlaps the halo; `null` for a centred card).
   *  Above `NOTCH_MAX_GAP` the pointer notch is dropped — a notch that
   *  points across a band of unrelated chrome misleads more than it
   *  helps — and, when a wide enough side strip exists, the card
   *  re-docks beside the halo instead. */
  gap: number | null;
  /** True when the card ends up over something it should not — an
   *  `avoid` rect it could not dodge, or the spotlit target itself (the
   *  portrait fallback overlaps the result panel's bottom). The overlay
   *  raises the glass tint so what is underneath cannot read through. */
  overlapsChrome: boolean;
  /** Only for a `strip` stretched past its natural height so it covers
   *  the chrome beneath it whole (the portrait action tray + footer
   *  under the dice card) instead of cutting a chip in two. The overlay
   *  gives the card this height and centres the content in it. */
  height?: number;
}

export interface PlacementInput {
  viewport: { width: number; height: number };
  halo: HaloRect | null;
  /** Live measured card height; `null` before first layout. */
  cardHeight: number | null;
  /** Measured height of the *strip* layout (see `DockKind`), when that
   *  is what the overlay last rendered; `null` otherwise. Kept apart
   *  from `cardHeight` so the strip's ~90 px never feeds the fits
   *  checks and flips the dock back to a card that would not fit. */
  stripHeight?: number | null;
  /** Chrome rects (overlay coordinates) the card should stay clear of. */
  avoid?: readonly HaloRect[];
  /** The whole target when only part of it is spotlit (the result
   *  panel under a score-header focus). A vertical dock that lands on
   *  it hides what the lesson is talking about, so a clean side dock is
   *  preferred when one fits, and a card left over it paints solid. */
  keepClear?: HaloRect | null;
  /** Regions the card must never sit on — the user's hand rows, the
   *  result panel when another element is spotlit. Unlike `avoid`
   *  chrome they cannot be covered whole (a two-row portrait hand is
   *  taller than the chrome scan admits and a card that "covered" it
   *  hid seven tiles); any overlap counts as a bisect, docks may move
   *  up to `MAX_KEEPOUT_SHIFT` to clear them, and a card that still
   *  cannot falls back to the slim strip in the nearest free band. */
  keepOut?: readonly HaloRect[];
}

export const HALO_PAD = 8;
export const HALO_RADIUS = 14;
/** Gap between the halo edge and the card edge (notch lives in it). */
export const CARD_GAP = 14;
/** Gap between the card edge and a chrome rect it was shifted off. */
export const CHROME_GAP = 8;
/** How far a dock may move off its ideal spot to clear chrome. */
export const MAX_CHROME_SHIFT = 140;
/** …and to clear a `keepOut` region: over both rows of a portrait hand
 *  (≈ 180 px) rather than onto one of them. */
export const MAX_KEEPOUT_SHIFT = 260;
export const CARD_MAX_WIDTH = 440;
/** A centred (no-target) card on a short, wide viewport (landscape
 *  phone) may use this much width: the band between the top HUD and the
 *  hand row holds ~3 body lines, so a wider card keeps a three-sentence
 *  intro inside them instead of scrolling. */
export const CENTRE_MAX_WIDTH_SHORT = 600;
/** Viewports shorter than this are "short" (landscape phones). */
export const SHORT_VIEWPORT_MAX_HEIGHT = 600;
/** Height assumed for the bottom strip before it has been measured. */
export const STRIP_HEIGHT_ESTIMATE = 96;
/** Strips narrower than this (portrait phones) stack title, buttons and
 *  a full-width body instead of the landscape body-beside-buttons row. */
export const NARROW_STRIP_MAX_WIDTH = 520;
/** Height assumed for the narrow strip before it has been measured. */
export const NARROW_STRIP_HEIGHT_ESTIMATE = 128;
/** How far past its natural height a strip may stretch to swallow the
 *  chrome under it whole (see `CaptionPlacement.height`). */
export const STRIP_STRETCH_MAX = 48;
export function stripHeightEstimate(viewportWidth: number): number {
  return viewportWidth - safeInset(viewportWidth) * 2 < NARROW_STRIP_MAX_WIDTH
    ? NARROW_STRIP_HEIGHT_ESTIMATE
    : STRIP_HEIGHT_ESTIMATE;
}
/** Height assumed before the card has been measured. Deliberately on
 *  the tall side so the first-frame clamp never pushes the CTA off. */
export const CARD_HEIGHT_ESTIMATE = 240;
export const SIDE_CARD_MIN_WIDTH = 168;
export const SIDE_GAP = 12;
export const NOTCH_INSET = 26;
/** How far the pointer notch protrudes from the card edge. Counted as
 *  part of the card's footprint for chrome avoidance so the tip never
 *  lands on a dimmed control (the wall counter under the own-hand
 *  card on desktop). */
export const NOTCH_DEPTH = 11;
/** Largest card ↔ halo gap that still gets a pointer notch. */
export const NOTCH_MAX_GAP = 48;
/** A side strip must be at least this wide (card width) before a
 *  pushed-away vertical dock is traded for it — narrower side cards
 *  are the compact landscape layout, not an upgrade. */
export const SIDE_REDOCK_MIN_WIDTH = 260;
/** Vertical docks slide sideways to keep at least this much air between
 *  the card's side edge and any chrome beside it (the landscape round
 *  panel's labels) — a card that kisses a neighbour reads as cramped. */
export const SIDE_GUTTER = 20;
/** Overhang past the viewport edge for a halo side that opens onto it
 *  (the target itself runs to the edge). Radius + stroke so neither the
 *  corner arcs nor the stroke are visible on that side. */
export const HALO_OVERHANG = HALO_RADIUS + 4;
/** Least padding between a target edge and the ring before the ring
 *  gives up on that side: with less than this the stroke would sit on
 *  the target's edge, so the side opens (straight scrim edge, no
 *  stroke) instead. */
export const MIN_RING_PAD = 2;
/** Air kept between a closed ring and the viewport edge — room for the
 *  stroke to finish. A landscape claim strip 8 px above the screen edge
 *  gets a closed ring with a 6 px pad rather than side strokes running
 *  off the bottom of the screen. */
export const RING_EDGE_MARGIN = 2;

export function safeInset(viewportWidth: number): number {
  return viewportWidth >= 1024 ? 24 : 12;
}

/**
 * Halo for a target rect: padded by `HALO_PAD` and, when the viewport
 * is known, clamped to the safe area so a target taller than the
 * screen (the result panel on a landscape phone) still gets a finished
 * ring instead of one that runs off the edges.
 */
export function haloFor(
  rect: TargetRect | null,
  viewport?: { width: number; height: number },
): HaloRect | null {
  if (!rect) return null;
  let left = rect.x - HALO_PAD;
  let top = rect.y - HALO_PAD;
  let right = rect.x + rect.w + HALO_PAD;
  let bottom = rect.y + rect.h + HALO_PAD;
  if (viewport) {
    const safe = safeInset(viewport.width);
    const H = viewport.height;
    // Horizontal: clamp to the safe area. Both shells keep ≥ 12 px of
    // horizontal padding inside every target container (the hand row
    // spans the phone edge to edge but its tiles start at x ≈ 21), so a
    // side clamp always lands in padding, never across content.
    left = Math.max(safe, left);
    right = Math.min(viewport.width - safe, right);
    // Vertical: a target with no room for even a `MIN_RING_PAD` ring
    // before the screen edge (hand tiles at the bottom of a phone, a
    // result panel taller than a landscape viewport) runs to that edge.
    // The halo then overhangs so its stroke and corners are clipped away
    // rather than drawn across the target's edge; otherwise the padded
    // halo is kept `RING_EDGE_MARGIN` inside the viewport — a reduced
    // pad, but a closed ring. The safe inset is a card margin, not a
    // ring limit: the desktop claim strip sits inside the 24 px inset
    // with room for a full ring below it, and clamping the ring to the
    // inset used to open its bottom onto the screen edge.
    const edge = RING_EDGE_MARGIN + MIN_RING_PAD;
    top = rect.y < edge ? -HALO_OVERHANG : Math.max(RING_EDGE_MARGIN, top);
    bottom =
      rect.y + rect.h > H - edge ? H + HALO_OVERHANG : Math.min(H - RING_EDGE_MARGIN, bottom);
  } else {
    left = Math.max(0, left);
    top = Math.max(0, top);
  }
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function intersectionArea(a: HaloRect, b: HaloRect): number {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

/** `inner` lies wholly inside `outer` (1 px tolerance). */
export function containedIn(inner: HaloRect, outer: HaloRect): boolean {
  return (
    inner.left >= outer.left - 1 &&
    inner.top >= outer.top - 1 &&
    inner.left + inner.width <= outer.left + outer.width + 1 &&
    inner.top + inner.height <= outer.top + outer.height + 1
  );
}

/** Chrome that mostly sits inside the halo is part of the spotlit
 *  region (tiles, the panel's own buttons) — never shift away from it. */
function outsideHalo(avoid: readonly HaloRect[], halo: HaloRect): HaloRect[] {
  return avoid.filter((r) => {
    const area = r.width * r.height;
    return area <= 0 || intersectionArea(r, halo) < area * 0.5;
  });
}

const never = (): boolean => false;

export function placeCaption({
  viewport,
  halo,
  cardHeight,
  stripHeight = null,
  avoid,
  keepClear = null,
  keepOut = [],
}: PlacementInput): CaptionPlacement {
  const W = viewport.width;
  const H = viewport.height;
  const safe = safeInset(W);
  const h = cardHeight ?? CARD_HEIGHT_ESTIMATE;
  const fullWidth = Math.max(120, Math.min(CARD_MAX_WIDTH, W - safe * 2));
  const maxTop = Math.max(safe, H - h - safe);
  const solidKeepOut = keepOut.filter((r) => r.width > 0 && r.height > 0);

  if (!halo) {
    const centreWidth =
      H < W && H <= SHORT_VIEWPORT_MAX_HEIGHT
        ? Math.max(120, Math.min(CENTRE_MAX_WIDTH_SHORT, W - safe * 2))
        : fullWidth;
    return placeCentred(viewport, centreWidth, h, avoid ?? [], solidKeepOut);
  }

  const chrome = avoid && avoid.length > 0 ? outsideHalo(avoid, halo) : [];
  // A keep-out mostly inside the halo is the spotlit content itself.
  const hard = outsideHalo(solidKeepOut, halo);
  /** Area of `card` lying on a keep-out region. */
  const hardArea = (card: HaloRect): number =>
    hard.reduce((sum, r) => sum + intersectionArea(card, r), 0);
  // Chrome that lies inside `keepClear` is the spotlit target's own
  // dimmed remainder (the result panel's rules chips under a score
  // spotlight). A vertical dock that lands on it paints solid and
  // covers it whole, so it never pushes the card away from the halo —
  // otherwise the card floats 90 px off the ring with the notch aimed
  // at dimmed chips instead of the spotlit header.
  const shiftChrome =
    keepClear === null ? chrome : chrome.filter((r) => !containedIn(r, keepClear));
  const haloBottom = halo.top + halo.height;
  const haloRight = halo.left + halo.width;
  const haloCx = halo.left + halo.width / 2;
  const haloCy = halo.top + halo.height / 2;
  const spaceAbove = halo.top;
  const spaceBelow = H - haloBottom;
  const spaceLeft = halo.left;
  const spaceRight = W - haloRight;

  const need = h + CARD_GAP + safe;
  const fitsAbove = spaceAbove >= need;
  const fitsBelow = spaceBelow >= need;
  // Same tie rule as the classic overlay (PR #348): more room below
  // wins, equal room docks above. `own-hand` at the bottom of the
  // screen → above; the tsumo button in the top chrome → below.
  const preferBelow = spaceBelow > spaceAbove;

  /** Card rect plus the pointer notch's band on the halo-facing edge —
   *  what chrome avoidance scores, so the notch tip clears controls too. */
  const footprint = (kind: DockKind, card: HaloRect): HaloRect => {
    switch (kind) {
      case 'above':
        return { ...card, height: card.height + NOTCH_DEPTH };
      case 'below':
        return { ...card, top: card.top - NOTCH_DEPTH, height: card.height + NOTCH_DEPTH };
      case 'right':
        return { ...card, left: card.left - NOTCH_DEPTH, width: card.width + NOTCH_DEPTH };
      case 'left':
        return { ...card, width: card.width + NOTCH_DEPTH };
      default:
        return card;
    }
  };

  /** Gap between the card's halo-facing edge and the halo. */
  const gapFor = (kind: DockKind, card: HaloRect): number => {
    switch (kind) {
      case 'above':
        return Math.max(0, halo.top - (card.top + card.height));
      case 'below':
        return Math.max(0, card.top - haloBottom);
      case 'right':
        return Math.max(0, card.left - haloRight);
      case 'left':
        return Math.max(0, halo.left - (card.left + card.width));
      default:
        return 0;
    }
  };

  // Tint decision looks at *everything* the card ends up over — chrome
  // it could not dodge and the spotlit target itself (the portrait
  // fallback deliberately overlaps the result panel's bottom, whose
  // buttons would otherwise read through the lighter glass).
  const finish = (
    kind: DockKind,
    rawLeft: number,
    rawTop: number,
    rawWidth: number,
    notch: number | null,
  ): CaptionPlacement => {
    const left = Math.round(rawLeft);
    const top = Math.round(rawTop);
    const width = Math.round(rawWidth);
    const card = { left, top, width, height: h };
    const covers =
      intersectionArea(card, halo) > 0 ||
      (keepClear !== null && intersectionArea(card, keepClear) > 0) ||
      hardArea(card) > 0 ||
      (avoid ?? []).some((r) => intersectionArea(card, r) > 0);
    const gap = gapFor(kind, card);
    // A long gap drops the notch: a pointer across a band of anything
    // (even the dimmed remainder of the spotlit target) reads as aimed
    // at whatever sits in that band, not at the ring.
    const keepNotch = gap <= NOTCH_MAX_GAP;
    return {
      kind,
      left,
      top,
      width,
      notch: !keepNotch ? null : notch === null ? null : Math.round(notch),
      gap,
      overlapsChrome: covers,
    };
  };

  /**
   * Score a footprint against the chrome: `partial` is the area of
   * controls the card would *bisect* (intersecting but not fully
   * covering — the one thing that must never happen), `total` the whole
   * covered area. Candidates compare lexicographically: no bisect first,
   * then least covered, then closest to the ideal dock.
   */
  const score = (
    card: HaloRect,
    list: readonly HaloRect[] = chrome,
    coverable: (r: HaloRect) => boolean = never,
  ): { partial: number; total: number } => {
    // Keep-out regions can never be covered whole: any overlap is a
    // bisect, whatever share of them the card would hide.
    let partial = hardArea(card);
    let total = partial;
    for (const r of list) {
      const a = intersectionArea(card, r);
      if (a <= 0) continue;
      const contained =
        r.left >= card.left - 1 &&
        r.top >= card.top - 1 &&
        r.left + r.width <= card.left + card.width + 1 &&
        r.top + r.height <= card.top + card.height + 1;
      if (!contained) partial += a;
      // A control the card may swallow whole (solid card) costs nothing
      // once it is covered whole — only bisecting it counts.
      if (!(contained && coverable(r))) total += a;
    }
    return { partial, total };
  };

  const scoreAt = (
    kind: DockKind,
    left: number,
    top: number,
    width: number,
    list: readonly HaloRect[] = chrome,
    coverable: (r: HaloRect) => boolean = never,
  ) => score(footprint(kind, { left, top, width, height: h }), list, coverable);

  /** Chrome lying within the halo's vertical span — a seat badge beside
   *  the dice modal, the round panel's labels beside the result panel.
   *  A side dock covers it whole rather than sliding off it: the slide
   *  depended on whether the chrome scan had seen the badge yet, so the
   *  same lesson landed in two compositions run to run. */
  const besideHalo = (r: HaloRect): boolean =>
    r.top >= halo.top - 1 && r.top + r.height <= haloBottom + 1;

  /** Best `top` for a card of `width` at `left`: the ideal dock, or a
   *  spot aligned just past a chrome edge (within the safe area and
   *  `MAX_CHROME_SHIFT`) that stops the card (notch included) from
   *  cutting a control. */
  const bestTop = (
    kind: DockKind,
    left: number,
    width: number,
    ideal: number,
    direction: 'up' | 'down' | 'both',
    chrome: readonly HaloRect[] = shiftChrome,
    coverable: (r: HaloRect) => boolean = never,
  ): number => {
    if (chrome.length === 0 && hard.length === 0) return ideal;
    // Notch band above / below the card, per dock kind.
    const notchAbove = kind === 'below' ? NOTCH_DEPTH : 0;
    const notchBelow = kind === 'above' ? NOTCH_DEPTH : 0;
    const tops = new Set<number>([ideal, safe, maxTop]);
    // Spots just past a keep-out region may lie further from the ideal
    // than chrome dodges allow (above both hand rows on a phone).
    const farTops = new Set<number>();
    for (const r of chrome) {
      if (r.left + r.width <= left || r.left >= left + width) continue;
      tops.add(Math.round(r.top - CHROME_GAP - h - notchBelow));
      tops.add(Math.round(r.top + r.height + CHROME_GAP + notchAbove));
    }
    for (const r of hard) {
      if (r.left + r.width <= left || r.left >= left + width) continue;
      farTops.add(Math.round(r.top - CHROME_GAP - h - notchBelow));
      farTops.add(Math.round(r.top + r.height + CHROME_GAP + notchAbove));
    }
    let best = ideal;
    let bestKey: [number, number, number] | null = null;
    for (const t of [...tops, ...farTops]) {
      if (t < safe || t > maxTop) continue;
      if (direction === 'up' && t > ideal) continue;
      if (direction === 'down' && t < ideal) continue;
      const dist = Math.abs(t - ideal);
      if (dist > (farTops.has(t) ? MAX_KEEPOUT_SHIFT : MAX_CHROME_SHIFT)) continue;
      const { partial, total } = scoreAt(kind, left, t, width, chrome, coverable);
      const key: [number, number, number] = [partial, total, dist];
      if (
        bestKey === null ||
        key[0] < bestKey[0] ||
        (key[0] === bestKey[0] &&
          (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))
      ) {
        best = t;
        bestKey = key;
      }
    }
    return best;
  };

  /** Slide a vertical dock sideways (within the safe area) when a
   *  chrome rect beside it sits closer than `SIDE_GUTTER`. */
  const gutterShift = (left: number, top: number, width: number): number => {
    const maxLeft = Math.max(safe, W - safe - width);
    let shifted = left;
    for (let pass = 0; pass < 2; pass++) {
      for (const r of chrome) {
        if (r.top >= top + h || r.top + r.height <= top) continue;
        const rRight = r.left + r.width;
        const cardRight = shifted + width;
        if (r.left >= cardRight && r.left - cardRight < SIDE_GUTTER) {
          shifted = Math.max(safe, r.left - SIDE_GUTTER - width);
        } else if (rRight <= shifted && shifted - rRight < SIDE_GUTTER) {
          shifted = Math.min(maxLeft, rRight + SIDE_GUTTER);
        }
      }
    }
    return Math.abs(shifted - left) <= SIDE_GUTTER ? shifted : left;
  };

  const vertical = (kind: 'above' | 'below'): CaptionPlacement => {
    const centred = Math.round(
      clamp(haloCx - fullWidth / 2, safe, Math.max(safe, W - safe - fullWidth)),
    );
    const ideal =
      kind === 'above'
        ? clamp(Math.round(halo.top - CARD_GAP - h), safe, maxTop)
        : clamp(Math.round(haloBottom + CARD_GAP), safe, maxTop);
    // The card must clear the *whole* adjacent row (YOUR TURN pill,
    // sort chips) rather than leave its bottom half peeking out.
    const top = bestTop(kind, centred, fullWidth, ideal, kind === 'above' ? 'up' : 'down');
    const left = gutterShift(centred, top, fullWidth);
    return finish(
      kind,
      left,
      top,
      fullWidth,
      clamp(haloCx - left, NOTCH_INSET, fullWidth - NOTCH_INSET),
    );
  };

  /**
   * Side strip dock (wide viewports, tall centred targets like the
   * result panel). Right wins ties so the caption stays clear of the
   * result panel's top-left heading. `null` when neither strip has
   * room for at least `minWidth` of card.
   */
  const side = (minWidth: number): CaptionPlacement | null => {
    // Outer edge of the strip is the safe inset (24 px on desktop), the
    // inner edge the halo gap.
    const sideNeed = minWidth + SIDE_GAP + safe;
    const leftFits = spaceLeft >= sideNeed;
    const rightFits = spaceRight >= sideNeed;
    if (!leftFits && !rightFits) return null;
    // `- 1`: a centred target leaves both strips equal up to layout
    // rounding; right must win that tie deterministically.
    const useRight = rightFits && (!leftFits || spaceRight >= spaceLeft - 1);
    const kind: DockKind = useRight ? 'right' : 'left';
    const strip = useRight ? spaceRight : spaceLeft;
    let width = Math.max(minWidth, Math.min(CARD_MAX_WIDTH, strip - SIDE_GAP - safe));
    let left = clamp(
      useRight ? Math.round(haloRight + SIDE_GAP) : Math.round(halo.left - SIDE_GAP - width),
      safe,
      Math.max(safe, W - safe - width),
    );
    // Slide along the strip away from whichever chrome the card cuts
    // (the top status row, the ☰ pill), bounded like the vertical docks.
    const idealTop = clamp(sideIdealTop(halo, h, H), safe, maxTop);
    let top = bestTop(kind, left, width, idealTop, 'both', chrome, besideHalo);
    // A control straddling the card's inner edge (a chip at the end of
    // the row the halo sits in, even one the target itself half covers)
    // cannot be dodged vertically: pull the edge past it while the card
    // stays wide enough to read, then re-pick the row for the new column.
    const card = { left, top, width, height: h };
    let nudged = false;
    for (const r of avoid ?? []) {
      if (intersectionArea(card, r) <= 0) continue;
      const rRight = r.left + r.width;
      if (useRight && r.left < left && rRight > left) {
        const newLeft = Math.round(rRight + CHROME_GAP);
        const newWidth = left + width - newLeft;
        if (newWidth >= minWidth) {
          width = newWidth;
          left = newLeft;
          nudged = true;
        }
      } else if (!useRight && r.left < left + width && rRight > left + width) {
        const newWidth = Math.round(r.left - CHROME_GAP) - left;
        if (newWidth >= minWidth) {
          width = newWidth;
          nudged = true;
        }
      }
    }
    if (nudged) top = bestTop(kind, left, width, idealTop, 'both', chrome, besideHalo);
    return finish(
      kind,
      left,
      top,
      width,
      clamp(haloCy - top, NOTCH_INSET, Math.max(NOTCH_INSET, h - NOTCH_INSET)),
    );
  };

  /**
   * Slim strip in the tallest vertical band free of the halo and every
   * keep-out region. Within the band the strip sits where it bisects no
   * chrome (the footer is covered whole rather than cut), nearest the
   * band edge that faces the halo.
   */
  const bandStrip = (): CaptionPlacement | null => {
    const hs = stripHeight ?? stripHeightEstimate(W);
    const blocked = [halo, ...hard]
      .map((r) => [r.top, r.top + r.height] as [number, number])
      .sort((a, b) => a[0] - b[0]);
    const bands: Array<[number, number]> = [];
    let cursor = safe;
    for (const [a, b] of blocked) {
      if (a - CHROME_GAP > cursor) bands.push([cursor, a - CHROME_GAP]);
      cursor = Math.max(cursor, b + CHROME_GAP);
    }
    if (H - safe > cursor) bands.push([cursor, H - safe]);
    const fit = bands.filter(([a, b]) => b - a >= hs).sort((p, q) => q[1] - q[0] - (p[1] - p[0]));
    const band = fit[0];
    if (!band) return null;
    const [bandTop, bandBottom] = band;
    const width = Math.max(120, W - safe * 2);
    // The band edge facing the halo: strip up against the ring when the
    // band lies below it, hanging under it when above.
    const facing = bandTop >= haloBottom ? bandTop : bandBottom - hs;
    const tops = new Set<number>([facing, bandTop, bandBottom - hs]);
    for (const r of chrome) {
      if (r.left + r.width <= safe || r.left >= safe + width) continue;
      tops.add(Math.round(r.top - CHROME_GAP - hs));
      tops.add(Math.round(r.top + r.height + CHROME_GAP));
      // Flush over the control, covering it whole (solid card).
      tops.add(Math.max(bandTop, Math.round(r.top - CHROME_GAP)));
    }
    const scoreStrip = (card: HaloRect): [number, number] => {
      let partial = hardArea(card);
      let total = partial;
      for (const r of chrome) {
        const a = intersectionArea(card, r);
        if (a <= 0) continue;
        if (!containedIn(r, card)) partial += a;
        total += a;
      }
      return [partial, total];
    };
    let best: { top: number; height: number } | null = null;
    let bestKey: number[] | null = null;
    for (const t of tops) {
      if (t < bandTop || t + hs > bandBottom) continue;
      // Natural height first; then stretched to the band's far edge when
      // that swallows a control the natural strip would cut (the footer
      // under the portrait action tray).
      const heights = [hs];
      const stretched = bandBottom - t;
      if (stretched > hs && stretched - hs <= STRIP_STRETCH_MAX) heights.push(stretched);
      for (const height of heights) {
        const [partial, total] = scoreStrip({ left: safe, top: t, width, height });
        const key = [partial, total, height === hs ? 0 : 1, Math.abs(t - facing)];
        if (bestKey === null || lexLess(key, bestKey)) {
          best = { top: t, height };
          bestKey = key;
        }
      }
    }
    if (best === null) return null;
    const card = { left: safe, top: best.top, width, height: best.height };
    return {
      kind: 'strip',
      left: safe,
      top: best.top,
      width,
      notch: null,
      gap: best.top >= haloBottom ? best.top - haloBottom : Math.max(0, halo.top - (best.top + hs)),
      overlapsChrome:
        intersectionArea(card, halo) > 0 ||
        (keepClear !== null && intersectionArea(card, keepClear) > 0) ||
        (avoid ?? []).some((r) => intersectionArea(card, r) > 0),
      ...(best.height !== hs ? { height: best.height } : {}),
    };
  };

  if (fitsAbove || fitsBelow) {
    const order: Array<'above' | 'below'> = preferBelow ? ['below', 'above'] : ['above', 'below'];
    const candidates = order
      .filter((kind) => (kind === 'above' ? fitsAbove : fitsBelow))
      .map(vertical);
    // Preferred slot wins unless the other one bisects less chrome (or,
    // failing that, covers less); a card that still sits over chrome
    // reports it so the tint deepens.
    let best: CaptionPlacement | null = null;
    let bestKey: [number, number] | null = null;
    for (const c of candidates) {
      const { partial, total } = scoreAt(c.kind, c.left, c.top, c.width);
      if (
        bestKey === null ||
        partial < bestKey[0] ||
        (partial === bestKey[0] && total < bestKey[1])
      ) {
        best = c;
        bestKey = [partial, total];
      }
    }
    const chosen = best ?? vertical(order[0] ?? 'above');
    // Chrome pushed the card well away from the halo (the own-hand card
    // lifted over the plate / sort-chip / turn-pill row on desktop):
    // a card docked beside the halo, notch aimed at it, reads better
    // than one floating mid-screen — take it when a roomy strip exists
    // and it cuts nothing.
    // Likewise when the vertical dock lands on the rest of a partly
    // spotlit target (the result panel's rules block under a score
    // spotlight): a clean side dock beats a solid card over the panel.
    const onTarget =
      keepClear !== null &&
      intersectionArea(
        { left: chosen.left, top: chosen.top, width: chosen.width, height: h },
        keepClear,
      ) > 0;
    // …and when the vertical dock still bisects a control it could not
    // clear (the 3D river card landing on the hand row under it).
    const bisects = scoreAt(chosen.kind, chosen.left, chosen.top, chosen.width).partial > 0;
    if ((chosen.gap ?? 0) > NOTCH_MAX_GAP || onTarget || bisects) {
      const alt = side(SIDE_REDOCK_MIN_WIDTH);
      // The side card may swallow chrome beside the halo whole (a seat
      // badge level with the modal) but nothing else: on a landscape
      // phone the tsumo card redocked beside the button *over* the last
      // four hand tiles, whichever run happened to cover them whole.
      const altScore = alt
        ? scoreAt(alt.kind, alt.left, alt.top, alt.width, chrome, besideHalo)
        : null;
      // …and it must actually sit beside the halo: a side card slid clear
      // of that chrome until it no longer shares the halo's vertical span
      // is the floating card this redock exists to avoid.
      const besides = alt !== null && alt.top <= haloBottom && alt.top + h >= halo.top;
      if (
        alt &&
        besides &&
        altScore !== null &&
        altScore.partial === 0 &&
        altScore.total === 0 &&
        (keepClear === null ||
          intersectionArea(
            { left: alt.left, top: alt.top, width: alt.width, height: h },
            keepClear,
          ) === 0)
      )
        return alt;
    }
    // Still on a keep-out region (the portrait dice card over the lower
    // hand row): a slim strip in the nearest free band beats a card that
    // hides tiles, even when that band holds the footer (covered whole,
    // solid card).
    if (hardArea({ left: chosen.left, top: chosen.top, width: chosen.width, height: h }) > 0) {
      const band = bandStrip();
      if (band) return band;
    }
    return chosen;
  }

  // Neither vertical slot fits: try a side strip.
  const strip = side(SIDE_CARD_MIN_WIDTH);
  if (strip) return strip;

  // Landscape phone with a wide modal target (the 3D dice panel): no
  // slot fits and the side strips are too narrow to read. A slim
  // full-width band along the bottom, over the dimmed hand row the ring
  // was trimmed above, keeps the whole modal visible — the overlap dock
  // below would sit on three of its four dice pairs.
  if (H < W && H <= SHORT_VIEWPORT_MAX_HEIGHT) {
    const hs = stripHeight ?? stripHeightEstimate(W);
    const top = Math.max(safe, H - safe - hs);
    const width = Math.max(120, W - safe * 2);
    const card = { left: safe, top, width, height: hs };
    const covers =
      intersectionArea(card, halo) > 0 ||
      (keepClear !== null && intersectionArea(card, keepClear) > 0) ||
      (avoid ?? []).some((r) => intersectionArea(card, r) > 0);
    return {
      kind: 'strip',
      left: safe,
      top,
      width,
      notch: null,
      gap: Math.max(0, top - haloBottom),
      overlapsChrome: covers,
    };
  }

  // Tall centred halo on a phone: overlap the bottom of the halo. The
  // pedagogically load-bearing content (winning hand, faan summary)
  // sits at the top of the result panel; the bottom holds buttons the
  // user already knows.
  return finish('below', Math.round((W - fullWidth) / 2), maxTop, fullWidth, null);
}

/** A side dock aligns with the halo edge nearest the screen edge when
 *  the halo sits in the outer thirds of the viewport (the hand row at
 *  the bottom of a desktop table, a score header at the top of a
 *  landscape phone) and centres on it otherwise. A centred card beside
 *  a bottom-edge target would hang half off the felt into the void. */
export function sideIdealTop(halo: HaloRect, cardHeight: number, viewportHeight: number): number {
  const band = viewportHeight / 3;
  const cy = halo.top + halo.height / 2;
  if (cy > viewportHeight - band) return Math.round(halo.top + halo.height - cardHeight);
  if (cy < band) return Math.round(halo.top);
  return Math.round(cy - cardHeight / 2);
}

/** How far a centred (no-target) card may move off dead centre to
 *  clear chrome underneath it. */
export const MAX_CENTRE_SHIFT = 140;
/** Air between a centred card and the chrome it slid off (the hand
 *  row on a landscape phone) — wider than `CHROME_GAP` because there is
 *  no ring here to give the card a visual anchor. */
export const CENTRE_CHROME_GAP = 12;
/** A centred card may drift this far sideways and still read as
 *  centred; beyond it, covering a small control whole (solid card) beats
 *  sliding clear of it. */
export const CENTRE_DRIFT_MAX = 32;

/**
 * No-target card: dead centre unless that lands on chrome. Then the
 * nearest spot (within `MAX_CENTRE_SHIFT` on either axis, inside the
 * safe area) that bisects nothing — and, failing that, covers the least
 * — wins, and `overlapsChrome` reports whatever is still underneath so
 * the card paints solid rather than letting a toggle ghost through.
 */
function placeCentred(
  viewport: { width: number; height: number },
  fullWidth: number,
  h: number,
  chrome: readonly HaloRect[],
  hard: readonly HaloRect[] = [],
): CaptionPlacement {
  const W = viewport.width;
  const H = viewport.height;
  const safe = safeInset(W);
  const maxTop = Math.max(safe, H - h - safe);
  let width = fullWidth;
  const maxLeft = Math.max(safe, W - safe - width);
  const idealLeft = clamp(Math.round((W - width) / 2), safe, maxLeft);
  const idealTop = clamp(Math.round((H - h) / 2), safe, maxTop);
  const finish = (left: number, top: number): CaptionPlacement => {
    const card = { left, top, width, height: h };
    return {
      kind: 'center',
      left,
      top,
      width,
      notch: null,
      gap: null,
      overlapsChrome: [...chrome, ...hard].some((r) => intersectionArea(card, r) > 0),
    };
  };
  if (chrome.length === 0 && hard.length === 0) return finish(idealLeft, idealTop);

  // `near`: chrome the card clears by less than `CENTRE_CHROME_GAP` — a
  // card kissing the hand row is legal but reads as cramped, so a spot
  // with real air wins over a closer one that merely does not touch.
  // Keep-out regions (the result panel behind a lesson-complete card,
  // the hand rows) can never be covered whole: any overlap is a bisect.
  const score = (left: number, top: number): [number, number, number] => {
    let partial = 0;
    let total = 0;
    let near = 0;
    const card = { left, top, width, height: h };
    const padded = {
      left: left - CENTRE_CHROME_GAP,
      top: top - CENTRE_CHROME_GAP,
      width: width + CENTRE_CHROME_GAP * 2,
      height: h + CENTRE_CHROME_GAP * 2,
    };
    for (const r of hard) {
      const a = intersectionArea(card, r);
      if (a <= 0) {
        if (intersectionArea(padded, r) > 0) near += 1;
        continue;
      }
      partial += a;
      total += a;
    }
    for (const r of chrome) {
      const a = intersectionArea(card, r);
      if (a <= 0) {
        if (intersectionArea(padded, r) > 0) near += 1;
        continue;
      }
      total += a;
      const contained =
        r.left >= left - 1 &&
        r.top >= top - 1 &&
        r.left + r.width <= left + width + 1 &&
        r.top + r.height <= top + h + 1;
      if (!contained) partial += a;
    }
    return [partial, total, near];
  };
  const tops = new Set<number>([idealTop]);
  const lefts = new Set<number>([idealLeft]);
  for (const r of chrome) {
    // Clear of the control on either side …
    tops.add(Math.round(r.top - CENTRE_CHROME_GAP - h));
    tops.add(Math.round(r.top + r.height + CENTRE_CHROME_GAP));
    lefts.add(Math.round(r.left - CENTRE_CHROME_GAP - width));
    lefts.add(Math.round(r.left + r.width + CENTRE_CHROME_GAP));
    // … or flush over it, covering it whole (the card paints solid).
    tops.add(Math.round(r.top));
    tops.add(Math.round(r.top + r.height - h));
    lefts.add(Math.round(r.left));
    lefts.add(Math.round(r.left + r.width - width));
  }
  for (const r of hard) {
    tops.add(Math.round(r.top - CENTRE_CHROME_GAP - h));
    tops.add(Math.round(r.top + r.height + CENTRE_CHROME_GAP));
  }
  const usable = (set: Set<number>, ideal: number, lo: number, hi: number) =>
    [...set].filter((v) => v >= lo && v <= hi && Math.abs(v - ideal) <= MAX_CENTRE_SHIFT);
  const topList = usable(tops, idealTop, safe, maxTop);
  const leftList = usable(lefts, idealLeft, safe, maxLeft);
  // Rank: nothing bisected, then *still horizontally centred* (within
  // `CENTRE_DRIFT_MAX` — a card slid 70 px sideways next to the perfectly
  // centred cards of the other lessons reads as misaligned, whereas a
  // vertical shift or a solid card over a small toggle does not), then
  // least covered, then closest to dead centre.
  let best: [number, number] = [idealLeft, idealTop];
  let bestKey: number[] | null = null;
  for (const t of topList) {
    for (const l of leftList) {
      const [partial, total, near] = score(l, t);
      const drifted = Math.abs(l - idealLeft) > CENTRE_DRIFT_MAX ? 1 : 0;
      const dist = Math.hypot(l - idealLeft, t - idealTop);
      const key = [partial, drifted, total, near, dist];
      if (bestKey === null || lexLess(key, bestKey)) {
        best = [l, t];
        bestKey = key;
      }
    }
  }
  if (
    hard.length === 0 ||
    hard.every((r) => intersectionArea({ left: best[0], top: best[1], width, height: h }, r) <= 0)
  )
    return finish(best[0], best[1]);

  // Still on a keep-out region (the lesson-complete card over the result
  // panel on a landscape phone): a narrower card in the widest free
  // column beside it — sized like a side dock, never below
  // `SIDE_REDOCK_MIN_WIDTH` — beats a centred one hiding the panel.
  let column: { left: number; width: number } | null = null;
  for (const r of hard) {
    const rightCol = { left: r.left + r.width + CENTRE_CHROME_GAP, width: 0 };
    rightCol.width = W - safe - rightCol.left;
    const leftCol = { left: safe, width: r.left - CENTRE_CHROME_GAP - safe };
    for (const c of [rightCol, leftCol]) {
      if (c.width >= SIDE_REDOCK_MIN_WIDTH && (column === null || c.width > column.width))
        column = c;
    }
  }
  if (column === null) return finish(best[0], best[1]);
  width = Math.min(fullWidth, column.width);
  const colLeft = column.left === safe ? column.left + column.width - width : column.left;
  let colBest = idealTop;
  let colKey: number[] | null = null;
  for (const t of topList) {
    const [partial, total, near] = score(colLeft, t);
    const key = [partial, total, near, Math.abs(t - idealTop)];
    if (colKey === null || lexLess(key, colKey)) {
      colBest = t;
      colKey = key;
    }
  }
  return finish(colLeft, colBest);
}

function lexLess(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}

/**
 * Vertical room a centred (no-target) card has between the chrome above
 * it (the top HUD row, a seat strip) and a keep-out below it (the hand
 * row): the overlay caps the card's scrolling body to `room − chrome` so
 * the card sits centred in that band instead of sliding sideways to
 * dodge whatever it can no longer fit between. Only chrome overlapping
 * the centred card's column and lying in the upper half of the viewport
 * bounds the top; everything is measured from the viewport, never from
 * the card's own height or position, so the cap cannot feed back into
 * the placement it constrains.
 */
export function centredRoom(
  keepOut: HaloRect,
  avoid: readonly HaloRect[],
  viewport: { width: number; height: number },
  cardWidth: number,
  /** The card's left edge when it is not dead centre — the narrower
   *  column beside a keep-out region (the lesson-complete card beside
   *  the result panel). Measured from the centre the column card
   *  counted the panel's own title as chrome above it and lost a line. */
  cardLeft: number = (viewport.width - cardWidth) / 2,
): number {
  const safe = safeInset(viewport.width);
  const left = cardLeft;
  const right = left + cardWidth;
  let topBound = safe;
  for (const r of avoid) {
    if (r === keepOut || r.width <= 0 || r.height <= 0) continue;
    if (r.left >= right || r.left + r.width <= left) continue;
    const rBottom = r.top + r.height;
    if (rBottom <= viewport.height / 2 && rBottom + CENTRE_CHROME_GAP > topBound)
      topBound = rBottom + CENTRE_CHROME_GAP;
  }
  return Math.max(0, keepOut.top - CENTRE_CHROME_GAP - topBound);
}

/** Largest overhang (px outside the halo) of a control straddling a
 *  ring edge that the halo will grow to enclose. Bigger overlaps are a
 *  neighbouring region, not a label the ring happens to bisect. */
export const STRADDLE_MAX = 24;
/** Air between an enclosed straddler and the ring stroke. */
export const STRADDLE_PAD = 4;

/**
 * Grow the halo so its ring never bisects a small control: any chrome
 * rect from `avoid` that crosses a ring edge by at most `STRADDLE_MAX`
 * px (the wall counter under the dice modal, the discards toggle
 * peeking past it) is pulled inside the ring instead of cut in two.
 * Sides that open onto the viewport edge and the safe insets are
 * respected; the result is stable after at most two passes.
 */
export function encloseStraddlers(
  halo: HaloRect | null,
  avoid: readonly HaloRect[],
  viewport: { width: number; height: number },
): HaloRect | null {
  if (!halo || avoid.length === 0) return halo;
  const safe = safeInset(viewport.width);
  let left = halo.left;
  let top = halo.top;
  let right = halo.left + halo.width;
  let bottom = halo.top + halo.height;
  // Every avoid rect counts here — a chip mostly inside the ring with a
  // sliver outside is exactly the bisect this prevents.
  for (let pass = 0; pass < 2; pass++) {
    let changed = false;
    for (const r of avoid) {
      const rRight = r.left + r.width;
      const rBottom = r.top + r.height;
      // Only a control that is *mostly* inside the ring (its centre lies
      // within it) is a label the ring happens to bisect. One whose
      // centre is outside — a seat badge sitting above the result panel,
      // a chip at the end of a neighbouring row — is a neighbour the ring
      // would wrongly pull in and light up.
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cx <= left || cx >= right || cy <= top || cy >= bottom) continue;
      // Must actually cross into the ring on the other axis too.
      const spansY = r.top < bottom && rBottom > top;
      const spansX = r.left < right && rRight > left;
      if (spansY && r.left < right && rRight > right && rRight - right <= STRADDLE_MAX) {
        right = Math.min(viewport.width - safe, rRight + STRADDLE_PAD);
        changed = true;
      }
      if (spansY && rRight > left && r.left < left && left - r.left <= STRADDLE_MAX) {
        left = Math.max(safe, r.left - STRADDLE_PAD);
        changed = true;
      }
      if (spansX && r.top < bottom && rBottom > bottom && rBottom - bottom <= STRADDLE_MAX) {
        bottom = Math.min(viewport.height - safe, rBottom + STRADDLE_PAD);
        changed = true;
      }
      if (spansX && rBottom > top && r.top < top && top - r.top <= STRADDLE_MAX) {
        top = Math.max(safe, r.top - STRADDLE_PAD);
        changed = true;
      }
    }
    if (!changed) break;
  }
  if (
    left === halo.left &&
    top === halo.top &&
    right === halo.left + halo.width &&
    bottom === halo.top + halo.height
  ) {
    return halo;
  }
  return { left, top, width: right - left, height: bottom - top };
}

/** Which halo sides open onto a trimmed edge (see `trimStraddlers`). */
export interface SideMask {
  top: boolean;
  right: boolean;
  bottom: boolean;
  left: boolean;
}

export const NO_OPEN_SIDES: SideMask = { top: false, right: false, bottom: false, left: false };
/** Share of a halo edge that crossing neighbours must cover before the
 *  edge is trimmed to them — a lone chip is enclosed or cut around,
 *  a row of tiles is a region the ring must not enter. */
export const TRIM_MIN_SPAN = 0.4;
/** At least this share of the halo must survive a trim; otherwise the
 *  neighbour covers most of the target and the ring stays whole. */
export const TRIM_MIN_KEEP = 0.5;

/**
 * Pull a halo edge back to the near side of a *large* neighbour it
 * would otherwise bisect — the own-hand row under the dice modal on a
 * landscape phone. `encloseStraddlers` grows the ring around small
 * chips; anything overhanging by more than `STRADDLE_MAX` and reaching
 * past the halo padding into the target proper is a region, and the
 * ring is cut to the target's portion clear of it instead. The trimmed
 * side is reported as `open`: the scrim edge there is a straight,
 * feathered line and the ring stroke is dropped (the tiles under it are
 * dimmed whole, never half-lit with a gold line across them).
 */
export function trimStraddlers(
  halo: HaloRect | null,
  avoid: readonly HaloRect[],
): { halo: HaloRect | null; open: SideMask } {
  if (!halo || avoid.length === 0) return { halo, open: NO_OPEN_SIDES };
  let left = halo.left;
  let top = halo.top;
  let right = halo.left + halo.width;
  let bottom = halo.top + halo.height;
  const open: SideMask = { ...NO_OPEN_SIDES };
  // Anything that crosses an edge by more than `STRADDLE_MAX` is a
  // neighbour whatever share of it the halo happens to cover — the hand
  // tiles half under the dice modal included.
  const neighbours = avoid.filter((r) => r.width > 0 && r.height > 0);
  /** Total length of the halo edge covered by the crossing rects. */
  const covered = (spans: Array<[number, number]>, lo: number, hi: number): number => {
    const clipped = spans
      .map(([a, b]) => [Math.max(lo, a), Math.min(hi, b)] as [number, number])
      .filter(([a, b]) => b > a)
      .sort((p, q) => p[0] - q[0]);
    let total = 0;
    let curA = Number.NEGATIVE_INFINITY;
    let curB = Number.NEGATIVE_INFINITY;
    for (const [a, b] of clipped) {
      if (a > curB) {
        if (curB > curA) total += curB - curA;
        curA = a;
        curB = b;
      } else if (b > curB) curB = b;
    }
    if (curB > curA) total += curB - curA;
    return total;
  };
  // Bottom
  {
    let cut = Number.POSITIVE_INFINITY;
    const spans: Array<[number, number]> = [];
    for (const r of neighbours) {
      const rBottom = r.top + r.height;
      if (!(r.top < bottom && rBottom > bottom)) continue;
      if (rBottom - bottom <= STRADDLE_MAX) continue;
      if (bottom - r.top <= HALO_PAD) continue;
      spans.push([r.left, r.left + r.width]);
      cut = Math.min(cut, r.top);
    }
    const newBottom = cut - STRADDLE_PAD;
    if (
      spans.length > 0 &&
      covered(spans, left, right) >= TRIM_MIN_SPAN * (right - left) &&
      newBottom - top >= TRIM_MIN_KEEP * (bottom - top)
    ) {
      bottom = newBottom;
      open.bottom = true;
    }
  }
  // Top
  {
    let cut = Number.NEGATIVE_INFINITY;
    const spans: Array<[number, number]> = [];
    for (const r of neighbours) {
      const rBottom = r.top + r.height;
      if (!(r.top < top && rBottom > top)) continue;
      if (top - r.top <= STRADDLE_MAX) continue;
      if (rBottom - top <= HALO_PAD) continue;
      spans.push([r.left, r.left + r.width]);
      cut = Math.max(cut, rBottom);
    }
    const newTop = cut + STRADDLE_PAD;
    if (
      spans.length > 0 &&
      covered(spans, left, right) >= TRIM_MIN_SPAN * (right - left) &&
      bottom - newTop >= TRIM_MIN_KEEP * (bottom - top)
    ) {
      top = newTop;
      open.top = true;
    }
  }
  // Right
  {
    let cut = Number.POSITIVE_INFINITY;
    const spans: Array<[number, number]> = [];
    for (const r of neighbours) {
      const rRight = r.left + r.width;
      if (!(r.left < right && rRight > right)) continue;
      if (rRight - right <= STRADDLE_MAX) continue;
      if (right - r.left <= HALO_PAD) continue;
      spans.push([r.top, r.top + r.height]);
      cut = Math.min(cut, r.left);
    }
    const newRight = cut - STRADDLE_PAD;
    if (
      spans.length > 0 &&
      covered(spans, top, bottom) >= TRIM_MIN_SPAN * (bottom - top) &&
      newRight - left >= TRIM_MIN_KEEP * (right - left)
    ) {
      right = newRight;
      open.right = true;
    }
  }
  // Left
  {
    let cut = Number.NEGATIVE_INFINITY;
    const spans: Array<[number, number]> = [];
    for (const r of neighbours) {
      const rRight = r.left + r.width;
      if (!(r.left < left && rRight > left)) continue;
      if (left - r.left <= STRADDLE_MAX) continue;
      if (rRight - left <= HALO_PAD) continue;
      spans.push([r.top, r.top + r.height]);
      cut = Math.max(cut, rRight);
    }
    const newLeft = cut + STRADDLE_PAD;
    if (
      spans.length > 0 &&
      covered(spans, top, bottom) >= TRIM_MIN_SPAN * (bottom - top) &&
      right - newLeft >= TRIM_MIN_KEEP * (right - left)
    ) {
      left = newLeft;
      open.left = true;
    }
  }
  if (!open.top && !open.bottom && !open.left && !open.right) return { halo, open };
  return { halo: { left, top, width: right - left, height: bottom - top }, open };
}

/** Air between the ring's edge and a control it would otherwise graze —
 *  the 1.5 px stroke is centred on the edge, so 3 px keeps ≥ 2 px of
 *  clear felt between the stroke and the control's border. */
export const GRAZE_PAD = 3;
/** Least padding kept between the ring and the target after a graze pull. */
export const GRAZE_MIN_PAD = 1;

/**
 * Pull a halo edge off any chrome it merely *grazes* — a neighbour that
 * reaches into the ring's padding band (≤ `HALO_PAD` deep) without
 * touching the target itself. `encloseStraddlers` handles controls that
 * are mostly inside the ring and `trimStraddlers` regions that reach
 * into the target; a graze falls between the two (the landscape footer
 * badge and sort pill sitting 5 px under the hand row) and left the
 * stroke drawn across the control's top edge. The edge moves at most
 * `HALO_PAD - GRAZE_MIN_PAD`, so the ring still hugs the target; the
 * side stays closed.
 */
export function clearGrazers(halo: HaloRect | null, avoid: readonly HaloRect[]): HaloRect | null {
  if (!halo || avoid.length === 0) return halo;
  // Conditions test the *original* edges; each edge keeps the tightest
  // pull. Two grazers under the hand row (the footer badge and the sort
  // pill, 2 px apart) used to leave the edge wherever the last one put
  // it — on the pill's border — or skip the tighter one once a looser
  // pull had already moved the edge past its top.
  const oLeft = halo.left;
  const oTop = halo.top;
  const oRight = halo.left + halo.width;
  const oBottom = halo.top + halo.height;
  let left = oLeft;
  let top = oTop;
  let right = oRight;
  let bottom = oBottom;
  const maxPull = HALO_PAD - GRAZE_MIN_PAD;
  for (const r of avoid) {
    if (r.width <= 0 || r.height <= 0) continue;
    const rRight = r.left + r.width;
    const rBottom = r.top + r.height;
    // A control mostly inside the ring is a bisected label (enclosed
    // elsewhere), not a neighbour to back away from.
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx > oLeft && cx < oRight && cy > oTop && cy < oBottom) continue;
    const spansX = r.left < oRight && rRight > oLeft;
    const spansY = r.top < oBottom && rBottom > oTop;
    // Bottom edge: the neighbour's top lies inside the padding band.
    if (spansX && r.top < oBottom && rBottom > oBottom && oBottom - r.top <= HALO_PAD)
      bottom = Math.min(bottom, Math.max(oBottom - maxPull, r.top - GRAZE_PAD));
    if (spansX && rBottom > oTop && r.top < oTop && rBottom - oTop <= HALO_PAD)
      top = Math.max(top, Math.min(oTop + maxPull, rBottom + GRAZE_PAD));
    if (spansY && r.left < oRight && rRight > oRight && oRight - r.left <= HALO_PAD)
      right = Math.min(right, Math.max(oRight - maxPull, r.left - GRAZE_PAD));
    if (spansY && rRight > oLeft && r.left < oLeft && rRight - oLeft <= HALO_PAD)
      left = Math.max(left, Math.min(oLeft + maxPull, rRight + GRAZE_PAD));
  }
  if (left === oLeft && top === oTop && right === oRight && bottom === oBottom) return halo;
  return { left, top, width: right - left, height: bottom - top };
}

/** Smallest spotlight worth keeping after a focus clip. */
const FOCUS_MIN_HEIGHT = 32;

/**
 * Clip a target rect to the band from `from` (the target's content box,
 * trimming a wrapper's outer margin; `null` keeps the target's own top)
 * down to the bottom of a descendant (`through`, same coordinate space)
 * plus `pad`. Used to spotlight only the score header + winning hand of
 * the result panel instead of the whole panel with its rules block and
 * action row. Returns the target unchanged when the descendant is
 * missing, sits outside the target, or would leave too little to ring.
 */
export function focusRect(
  target: TargetRect,
  through: HaloRect | null,
  pad = HALO_PAD,
  from: HaloRect | null = null,
): TargetRect {
  if (!through) return target;
  const top =
    from && from.top > target.y && from.top < target.y + target.h / 2 ? from.top : target.y;
  const bottom = through.top + through.height + pad;
  const h = bottom - top;
  if (through.top < top - 1 || bottom >= target.y + target.h || h < FOCUS_MIN_HEIGHT) return target;
  return { x: target.x, y: top, w: target.w, h };
}

/** Per-side outward feather widths for the spotlight cutout. */
export interface FeatherSides {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const FEATHER_OUT = 14;
/** Outward feather on a side that butts against an opaque neighbour. */
export const FEATHER_TIGHT = 3;
/** A neighbour must share at least this much of a side's span to count
 *  as butting against it (a strip clipping a corner by 4 px does not). */
const MIN_BUTT_SPAN = 12;

/**
 * Shrink the outward feather on any side of the halo where another
 * opaque surface (a registered target, a chrome control) sits inside
 * the feather band — otherwise the soft edge un-dims a bright strip of
 * that neighbour (hand tiles under the dice modal on a landscape phone)
 * for no reason. Sides with nothing nearby keep the full `FEATHER_OUT`.
 */
export function featherFor(halo: HaloRect, neighbours: readonly HaloRect[]): FeatherSides {
  const sides: FeatherSides = {
    top: FEATHER_OUT,
    right: FEATHER_OUT,
    bottom: FEATHER_OUT,
    left: FEATHER_OUT,
  };
  const haloRight = halo.left + halo.width;
  const haloBottom = halo.top + halo.height;
  for (const n of neighbours) {
    if (n.width <= 0 || n.height <= 0) continue;
    // Ignore anything mostly inside the halo — it is the spotlit content.
    if (intersectionArea(n, halo) >= n.width * n.height * 0.5) continue;
    const nRight = n.left + n.width;
    const nBottom = n.top + n.height;
    const spansX = Math.min(nRight, haloRight) - Math.max(n.left, halo.left) >= MIN_BUTT_SPAN;
    const spansY = Math.min(nBottom, haloBottom) - Math.max(n.top, halo.top) >= MIN_BUTT_SPAN;
    if (spansX) {
      if (n.top < haloBottom + FEATHER_OUT && nBottom > haloBottom - HALO_PAD)
        sides.bottom = FEATHER_TIGHT;
      if (nBottom > halo.top - FEATHER_OUT && n.top < halo.top + HALO_PAD)
        sides.top = FEATHER_TIGHT;
    }
    if (spansY) {
      if (n.left < haloRight + FEATHER_OUT && nRight > haloRight - HALO_PAD)
        sides.right = FEATHER_TIGHT;
      if (nRight > halo.left - FEATHER_OUT && n.left < halo.left + HALO_PAD)
        sides.left = FEATHER_TIGHT;
    }
  }
  return sides;
}
