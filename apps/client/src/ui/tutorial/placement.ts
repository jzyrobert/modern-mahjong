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

export type DockKind = 'above' | 'below' | 'left' | 'right' | 'center';

export interface CaptionPlacement {
  kind: DockKind;
  left: number;
  top: number;
  width: number;
  /** Where the notch sits along the card edge facing the halo, in
   *  card-local px (x for above/below, y for left/right). `null` when
   *  the card is centred with no target. */
  notch: number | null;
  /** True when the card still intersects an `avoid` rect after every
   *  shift the layout allowed. The overlay raises the glass tint so
   *  dimmed chrome underneath cannot read through. */
  overlapsChrome: boolean;
}

export interface PlacementInput {
  viewport: { width: number; height: number };
  halo: HaloRect | null;
  /** Live measured card height; `null` before first layout. */
  cardHeight: number | null;
  /** Chrome rects (overlay coordinates) the card should stay clear of. */
  avoid?: readonly HaloRect[];
}

export const HALO_PAD = 8;
export const HALO_RADIUS = 14;
/** Gap between the halo edge and the card edge (notch lives in it). */
export const CARD_GAP = 14;
/** Gap between the card edge and a chrome rect it was shifted off. */
export const CHROME_GAP = 8;
/** How far a dock may move off its ideal spot to clear chrome. */
export const MAX_CHROME_SHIFT = 140;
export const CARD_MAX_WIDTH = 440;
/** Height assumed before the card has been measured. Deliberately on
 *  the tall side so the first-frame clamp never pushes the CTA off. */
export const CARD_HEIGHT_ESTIMATE = 240;
export const SIDE_CARD_MIN_WIDTH = 168;
export const SIDE_GAP = 12;
export const NOTCH_INSET = 26;

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
    left = Math.max(safe, left);
    top = Math.max(safe, top);
    right = Math.min(viewport.width - safe, right);
    bottom = Math.min(viewport.height - safe, bottom);
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

/** Chrome that mostly sits inside the halo is part of the spotlit
 *  region (tiles, the panel's own buttons) — never shift away from it. */
function outsideHalo(avoid: readonly HaloRect[], halo: HaloRect): HaloRect[] {
  return avoid.filter((r) => {
    const area = r.width * r.height;
    return area <= 0 || intersectionArea(r, halo) < area * 0.5;
  });
}

export function placeCaption({
  viewport,
  halo,
  cardHeight,
  avoid,
}: PlacementInput): CaptionPlacement {
  const W = viewport.width;
  const H = viewport.height;
  const safe = safeInset(W);
  const h = cardHeight ?? CARD_HEIGHT_ESTIMATE;
  const fullWidth = Math.max(120, Math.min(CARD_MAX_WIDTH, W - safe * 2));
  const maxTop = Math.max(safe, H - h - safe);

  if (!halo) {
    return {
      kind: 'center',
      left: Math.round((W - fullWidth) / 2),
      top: clamp(Math.round((H - h) / 2), safe, maxTop),
      width: fullWidth,
      notch: null,
      overlapsChrome: false,
    };
  }

  const chrome = avoid && avoid.length > 0 ? outsideHalo(avoid, halo) : [];
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

  const finish = (
    kind: DockKind,
    left: number,
    top: number,
    width: number,
    notch: number | null,
  ): CaptionPlacement => ({
    kind,
    left,
    top,
    width,
    notch,
    overlapsChrome: chrome.some((r) => intersectionArea({ left, top, width, height: h }, r) > 0),
  });

  /**
   * Score a card rect against the chrome: `partial` is the area of
   * controls the card would *bisect* (intersecting but not fully
   * covering — the one thing that must never happen), `total` the whole
   * covered area. Candidates compare lexicographically: no bisect first,
   * then least covered, then closest to the ideal dock.
   */
  const score = (card: HaloRect): { partial: number; total: number } => {
    let partial = 0;
    let total = 0;
    for (const r of chrome) {
      const a = intersectionArea(card, r);
      if (a <= 0) continue;
      total += a;
      const contained =
        r.left >= card.left - 1 &&
        r.top >= card.top - 1 &&
        r.left + r.width <= card.left + card.width + 1 &&
        r.top + r.height <= card.top + card.height + 1;
      if (!contained) partial += a;
    }
    return { partial, total };
  };

  /** Best `top` for a card of `width` at `left`: the ideal dock, or a
   *  spot aligned just past a chrome edge (within the safe area and
   *  `MAX_CHROME_SHIFT`) that stops the card from cutting a control. */
  const bestTop = (
    left: number,
    width: number,
    ideal: number,
    direction: 'up' | 'down' | 'both',
  ): number => {
    if (chrome.length === 0) return ideal;
    const tops = new Set<number>([ideal, safe, maxTop]);
    for (const r of chrome) {
      if (r.left + r.width <= left || r.left >= left + width) continue;
      tops.add(Math.round(r.top - CHROME_GAP - h));
      tops.add(Math.round(r.top + r.height + CHROME_GAP));
    }
    let best = ideal;
    let bestKey: [number, number, number] | null = null;
    for (const t of tops) {
      if (t < safe || t > maxTop) continue;
      if (direction === 'up' && t > ideal) continue;
      if (direction === 'down' && t < ideal) continue;
      const dist = Math.abs(t - ideal);
      if (dist > MAX_CHROME_SHIFT) continue;
      const { partial, total } = score({ left, top: t, width, height: h });
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

  const vertical = (kind: 'above' | 'below'): CaptionPlacement => {
    const left = Math.round(
      clamp(haloCx - fullWidth / 2, safe, Math.max(safe, W - safe - fullWidth)),
    );
    const ideal =
      kind === 'above'
        ? clamp(Math.round(halo.top - CARD_GAP - h), safe, maxTop)
        : clamp(Math.round(haloBottom + CARD_GAP), safe, maxTop);
    // The card must clear the *whole* adjacent row (YOUR TURN pill,
    // sort chips) rather than leave its bottom half peeking out.
    const top = bestTop(left, fullWidth, ideal, kind === 'above' ? 'up' : 'down');
    return finish(
      kind,
      left,
      top,
      fullWidth,
      clamp(haloCx - left, NOTCH_INSET, fullWidth - NOTCH_INSET),
    );
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
      const { partial, total } = score({ left: c.left, top: c.top, width: c.width, height: h });
      if (
        bestKey === null ||
        partial < bestKey[0] ||
        (partial === bestKey[0] && total < bestKey[1])
      ) {
        best = c;
        bestKey = [partial, total];
      }
    }
    return best ?? vertical(order[0] ?? 'above');
  }

  // Neither vertical slot fits: try a side strip. Right wins ties so
  // the caption stays clear of the result panel's top-left heading.
  const sideNeed = SIDE_CARD_MIN_WIDTH + SIDE_GAP * 2;
  const leftFits = spaceLeft >= sideNeed;
  const rightFits = spaceRight >= sideNeed;
  if (leftFits || rightFits) {
    const useRight = rightFits && (!leftFits || spaceRight >= spaceLeft);
    const strip = useRight ? spaceRight : spaceLeft;
    let width = Math.max(SIDE_CARD_MIN_WIDTH, Math.min(CARD_MAX_WIDTH, strip - SIDE_GAP * 2));
    let left = clamp(
      useRight ? Math.round(haloRight + SIDE_GAP) : Math.round(halo.left - SIDE_GAP - width),
      safe,
      Math.max(safe, W - safe - width),
    );
    // Slide along the strip away from whichever chrome the card cuts
    // (the top status row, the ☰ pill), bounded like the vertical docks.
    const idealTop = clamp(Math.round(haloCy - h / 2), safe, maxTop);
    let top = bestTop(left, width, idealTop, 'both');
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
        if (newWidth >= SIDE_CARD_MIN_WIDTH) {
          width = newWidth;
          left = newLeft;
          nudged = true;
        }
      } else if (!useRight && r.left < left + width && rRight > left + width) {
        const newWidth = Math.round(r.left - CHROME_GAP) - left;
        if (newWidth >= SIDE_CARD_MIN_WIDTH) {
          width = newWidth;
          nudged = true;
        }
      }
    }
    if (nudged) top = bestTop(left, width, idealTop, 'both');
    return finish(
      useRight ? 'right' : 'left',
      left,
      top,
      width,
      clamp(haloCy - top, NOTCH_INSET, Math.max(NOTCH_INSET, h - NOTCH_INSET)),
    );
  }

  // Tall centred halo on a phone: overlap the bottom of the halo. The
  // pedagogically load-bearing content (winning hand, faan summary)
  // sits at the top of the result panel; the bottom holds buttons the
  // user already knows.
  return finish('below', Math.round((W - fullWidth) / 2), maxTop, fullWidth, null);
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
