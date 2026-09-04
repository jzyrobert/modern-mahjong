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
}

export interface PlacementInput {
  viewport: { width: number; height: number };
  halo: HaloRect | null;
  /** Live measured card height; `null` before first layout. */
  cardHeight: number | null;
  /** Chrome rects (overlay coordinates) the card should stay clear of. */
  avoid?: readonly HaloRect[];
  /** The whole target when only part of it is spotlit (the result
   *  panel under a score-header focus). A vertical dock that lands on
   *  it hides what the lesson is talking about, so a clean side dock is
   *  preferred when one fits, and a card left over it paints solid. */
  keepClear?: HaloRect | null;
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
/** A target edge closer than this to the safe line leaves no room for a
 *  visible ring gap; the ring opens on that side instead of being drawn
 *  across the target's edge. */
const MIN_RING_PAD = 4;

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
    // Vertical: a target whose edge reaches the safe line runs to the
    // screen edge (hand tiles at the bottom of a phone, a result panel
    // taller than a landscape viewport). The halo then overhangs so its
    // stroke and corners are clipped away rather than drawn across the
    // target's edge; otherwise the padded halo is clamped like the sides.
    top = rect.y <= safe + MIN_RING_PAD ? -HALO_OVERHANG : Math.max(safe, top);
    bottom =
      rect.y + rect.h >= H - safe - MIN_RING_PAD ? H + HALO_OVERHANG : Math.min(H - safe, bottom);
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
  keepClear = null,
}: PlacementInput): CaptionPlacement {
  const W = viewport.width;
  const H = viewport.height;
  const safe = safeInset(W);
  const h = cardHeight ?? CARD_HEIGHT_ESTIMATE;
  const fullWidth = Math.max(120, Math.min(CARD_MAX_WIDTH, W - safe * 2));
  const maxTop = Math.max(safe, H - h - safe);

  if (!halo) return placeCentred(viewport, fullWidth, h, avoid ?? []);

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

  /** True when the strip between the card and the halo lies (≥ 80 %)
   *  inside `keepClear`. */
  const gapOverKeepClear = (kind: DockKind, card: HaloRect, gap: number): boolean => {
    if (keepClear === null || gap <= 0) return false;
    let strip: HaloRect;
    switch (kind) {
      case 'above':
        strip = { left: card.left, top: card.top + card.height, width: card.width, height: gap };
        break;
      case 'below':
        strip = { left: card.left, top: haloBottom, width: card.width, height: gap };
        break;
      case 'right':
        strip = { left: haloRight, top: card.top, width: gap, height: card.height };
        break;
      case 'left':
        strip = { left: card.left + card.width, top: card.top, width: gap, height: card.height };
        break;
      default:
        return false;
    }
    return intersectionArea(strip, keepClear) >= strip.width * strip.height * 0.8;
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
      (avoid ?? []).some((r) => intersectionArea(card, r) > 0);
    const gap = gapFor(kind, card);
    // A long gap normally drops the notch (it would point across
    // unrelated chrome) — unless the gap is the dimmed remainder of the
    // very target being spotlit, where the pointer still reads true.
    const keepNotch = gap <= NOTCH_MAX_GAP || gapOverKeepClear(kind, card, gap);
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

  const scoreAt = (kind: DockKind, left: number, top: number, width: number) =>
    score(footprint(kind, { left, top, width, height: h }));

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
  ): number => {
    if (chrome.length === 0) return ideal;
    // Notch band above / below the card, per dock kind.
    const notchAbove = kind === 'below' ? NOTCH_DEPTH : 0;
    const notchBelow = kind === 'above' ? NOTCH_DEPTH : 0;
    const tops = new Set<number>([ideal, safe, maxTop]);
    for (const r of chrome) {
      if (r.left + r.width <= left || r.left >= left + width) continue;
      tops.add(Math.round(r.top - CHROME_GAP - h - notchBelow));
      tops.add(Math.round(r.top + r.height + CHROME_GAP + notchAbove));
    }
    let best = ideal;
    let bestKey: [number, number, number] | null = null;
    for (const t of tops) {
      if (t < safe || t > maxTop) continue;
      if (direction === 'up' && t > ideal) continue;
      if (direction === 'down' && t < ideal) continue;
      const dist = Math.abs(t - ideal);
      if (dist > MAX_CHROME_SHIFT) continue;
      const { partial, total } = scoreAt(kind, left, t, width);
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
    let top = bestTop(kind, left, width, idealTop, 'both');
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
    if (nudged) top = bestTop(kind, left, width, idealTop, 'both');
    return finish(
      kind,
      left,
      top,
      width,
      clamp(haloCy - top, NOTCH_INSET, Math.max(NOTCH_INSET, h - NOTCH_INSET)),
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
    if ((chosen.gap ?? 0) > NOTCH_MAX_GAP || onTarget) {
      const alt = side(SIDE_REDOCK_MIN_WIDTH);
      if (
        alt &&
        scoreAt(alt.kind, alt.left, alt.top, alt.width).partial === 0 &&
        (keepClear === null ||
          intersectionArea(
            { left: alt.left, top: alt.top, width: alt.width, height: h },
            keepClear,
          ) === 0)
      )
        return alt;
    }
    return chosen;
  }

  // Neither vertical slot fits: try a side strip.
  const strip = side(SIDE_CARD_MIN_WIDTH);
  if (strip) return strip;

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

/**
 * No-target card: dead centre unless that lands on chrome. Then the
 * nearest spot (within `MAX_CENTRE_SHIFT` on either axis, inside the
 * safe area) that bisects nothing — and, failing that, covers the least
 * — wins, and `overlapsChrome` reports whatever is still underneath so
 * the card paints solid rather than letting a toggle ghost through.
 */
function placeCentred(
  viewport: { width: number; height: number },
  width: number,
  h: number,
  chrome: readonly HaloRect[],
): CaptionPlacement {
  const W = viewport.width;
  const H = viewport.height;
  const safe = safeInset(W);
  const maxTop = Math.max(safe, H - h - safe);
  const maxLeft = Math.max(safe, W - safe - width);
  const idealLeft = clamp(Math.round((W - width) / 2), safe, maxLeft);
  const idealTop = clamp(Math.round((H - h) / 2), safe, maxTop);
  const finish = (left: number, top: number): CaptionPlacement => ({
    kind: 'center',
    left,
    top,
    width,
    notch: null,
    gap: null,
    overlapsChrome: chrome.some((r) => intersectionArea({ left, top, width, height: h }, r) > 0),
  });
  if (chrome.length === 0) return finish(idealLeft, idealTop);

  const score = (left: number, top: number): [number, number] => {
    let partial = 0;
    let total = 0;
    const card = { left, top, width, height: h };
    for (const r of chrome) {
      const a = intersectionArea(card, r);
      if (a <= 0) continue;
      total += a;
      const contained =
        r.left >= left - 1 &&
        r.top >= top - 1 &&
        r.left + r.width <= left + width + 1 &&
        r.top + r.height <= top + h + 1;
      if (!contained) partial += a;
    }
    return [partial, total];
  };
  const tops = new Set<number>([idealTop]);
  const lefts = new Set<number>([idealLeft]);
  for (const r of chrome) {
    tops.add(Math.round(r.top - CHROME_GAP - h));
    tops.add(Math.round(r.top + r.height + CHROME_GAP));
    lefts.add(Math.round(r.left - CHROME_GAP - width));
    lefts.add(Math.round(r.left + r.width + CHROME_GAP));
  }
  const usable = (set: Set<number>, ideal: number, lo: number, hi: number) =>
    [...set].filter((v) => v >= lo && v <= hi && Math.abs(v - ideal) <= MAX_CENTRE_SHIFT);
  const topList = usable(tops, idealTop, safe, maxTop);
  const leftList = usable(lefts, idealLeft, safe, maxLeft);
  let best: [number, number] = [idealLeft, idealTop];
  let bestKey: [number, number, number] | null = null;
  for (const t of topList) {
    for (const l of leftList) {
      const [partial, total] = score(l, t);
      const dist = Math.hypot(l - idealLeft, t - idealTop);
      const key: [number, number, number] = [partial, total, dist];
      if (
        bestKey === null ||
        key[0] < bestKey[0] ||
        (key[0] === bestKey[0] &&
          (key[1] < bestKey[1] || (key[1] === bestKey[1] && key[2] < bestKey[2])))
      ) {
        best = [l, t];
        bestKey = key;
      }
    }
  }
  return finish(best[0], best[1]);
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
