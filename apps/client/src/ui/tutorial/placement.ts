import type { TargetRect } from './TargetRegistry';

/**
 * Pure caption-placement math for `<TutorialOverlay>`. Kept free of
 * React so the dock decisions are unit-tested (`placement.test.ts`)
 * rather than re-derived from screenshots every time a lesson adds a
 * target.
 *
 * Model: the halo is the target rect padded by `HALO_PAD`. The caption
 * card docks *adjacent* to the halo — above or below it with a pointer
 * notch aimed at the halo's centre — and falls back to a side dock
 * (wide viewports, tall centred targets like the result panel) or an
 * overlapping bottom dock (portrait phones) when neither vertical slot
 * has room. Every branch ends in the same clamp so the whole card,
 * CTA included, stays inside the safe area.
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
}

export interface PlacementInput {
  viewport: { width: number; height: number };
  halo: HaloRect | null;
  /** Live measured card height; `null` before first layout. */
  cardHeight: number | null;
}

export const HALO_PAD = 8;
export const HALO_RADIUS = 14;
/** Gap between the halo edge and the card edge (notch lives in it). */
export const CARD_GAP = 14;
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

export function haloFor(rect: TargetRect | null): HaloRect | null {
  if (!rect) return null;
  return {
    left: Math.max(0, rect.x - HALO_PAD),
    top: Math.max(0, rect.y - HALO_PAD),
    width: rect.w + HALO_PAD * 2,
    height: rect.h + HALO_PAD * 2,
  };
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function placeCaption({ viewport, halo, cardHeight }: PlacementInput): CaptionPlacement {
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
    };
  }

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

  const vertical = (kind: 'above' | 'below'): CaptionPlacement => {
    const left = Math.round(
      clamp(haloCx - fullWidth / 2, safe, Math.max(safe, W - safe - fullWidth)),
    );
    const top =
      kind === 'above'
        ? clamp(Math.round(halo.top - CARD_GAP - h), safe, maxTop)
        : clamp(Math.round(haloBottom + CARD_GAP), safe, maxTop);
    return {
      kind,
      left,
      top,
      width: fullWidth,
      notch: clamp(haloCx - left, NOTCH_INSET, fullWidth - NOTCH_INSET),
    };
  };

  if (preferBelow && fitsBelow) return vertical('below');
  if (!preferBelow && fitsAbove) return vertical('above');
  if (fitsBelow) return vertical('below');
  if (fitsAbove) return vertical('above');

  // Neither vertical slot fits: try a side strip. Right wins ties so
  // the caption stays clear of the result panel's top-left heading.
  const sideNeed = SIDE_CARD_MIN_WIDTH + SIDE_GAP * 2;
  const leftFits = spaceLeft >= sideNeed;
  const rightFits = spaceRight >= sideNeed;
  if (leftFits || rightFits) {
    const useRight = rightFits && (!leftFits || spaceRight >= spaceLeft);
    const strip = useRight ? spaceRight : spaceLeft;
    const width = Math.max(SIDE_CARD_MIN_WIDTH, Math.min(CARD_MAX_WIDTH, strip - SIDE_GAP * 2));
    const left = useRight
      ? Math.round(haloRight + SIDE_GAP)
      : Math.round(halo.left - SIDE_GAP - width);
    const top = clamp(Math.round(haloCy - h / 2), safe, maxTop);
    return {
      kind: useRight ? 'right' : 'left',
      left: clamp(left, safe, Math.max(safe, W - safe - width)),
      top,
      width,
      notch: clamp(haloCy - top, NOTCH_INSET, Math.max(NOTCH_INSET, h - NOTCH_INSET)),
    };
  }

  // Tall centred halo on a phone: overlap the bottom of the halo. The
  // pedagogically load-bearing content (winning hand, faan summary)
  // sits at the top of the result panel; the bottom holds buttons the
  // user already knows.
  const left = Math.round((W - fullWidth) / 2);
  return {
    kind: 'below',
    left,
    top: maxTop,
    width: fullWidth,
    notch: null,
  };
}
