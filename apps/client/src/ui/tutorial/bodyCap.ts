/**
 * Pure sizing maths for the coach card's body copy (`<TutorialOverlay>`).
 *
 * The body is the part of the card the learner reads, so it gets
 * whatever vertical room the placement really has — the band between
 * the chrome above the card and the hand row / ring / band edge below —
 * less the card's own chrome (header, title, action row, padding).
 * When the whole step text fits in that room it shows whole, with no
 * scroll and no cue; when it does not, as many whole lines as fit sit
 * above a chevron gutter, and the frame around the body tightens first
 * so lines come before decoration (round-3 feedback: a 412 px phone
 * showed two lines and a scroll under a 26 px title and 18 px padding).
 *
 * Everything here is a function of the room, which the overlay derives
 * from geometry alone (halo, chrome rects, keep-outs, viewport) — never
 * from the card's own height — so the cap can never feed back into the
 * placement it constrains.
 */

/** Gutter under a capped, scrollable body that holds the "more below"
 *  chevron — its own row, never painted over the last visible line. */
export const BODY_CUE_H = 12;

/** Fewest lines a scrolling body shows above the cue. The cap never
 *  drops under this many lines plus the gutter; a room that cannot hold
 *  them leaves the card to the placement's fallbacks (side dock, strip)
 *  rather than clipping the copy to a sentence fragment. */
export const MIN_SCROLL_LINES = 3;

/** Air kept between a strip grown to its band and the band's far edge,
 *  on top of the band's own `CHROME_GAP` — so the strip sits ≥ 12 px
 *  off the hand and the fit check (`band ≥ strip`) keeps slack for
 *  sub-pixel layout rounding instead of flipping the dock. */
export const STRIP_BREATHING = 4;

/**
 * Body height (px) the room leaves once the card's chrome is taken
 * off, floored at `minLines` plus the cue gutter. Unsnapped: `fitBody`
 * snaps to whole lines once the content height is known, so a room
 * that holds exactly four lines shows four rather than three plus a
 * cue nobody needs.
 */
export function bodyCap(
  room: number,
  chrome: number,
  lineHeight: number,
  minLines: number = MIN_SCROLL_LINES,
): number {
  const floor = minLines * lineHeight + BODY_CUE_H;
  if (!Number.isFinite(room)) return Number.POSITIVE_INFINITY;
  return Math.max(floor, room - chrome);
}

export interface BodyFit {
  /** The text is taller than the cap: scroll inside, chevron below. */
  overflow: boolean;
  /** Height of the scroll area (whole lines when overflowing). */
  height: number;
  /** Visible lines. */
  lines: number;
}

/**
 * How a body of `contentHeight` sits under `cap`: whole when it fits
 * (no gutter reserved), otherwise the most whole lines that fit above
 * the cue gutter — never fewer than two, so a sentence is never cut to
 * one line even when the cap is (defensively) tiny.
 */
export function fitBody(contentHeight: number, cap: number, lineHeight: number): BodyFit {
  if (contentHeight <= cap + 1) {
    return {
      overflow: false,
      height: contentHeight,
      lines: Math.round(contentHeight / lineHeight),
    };
  }
  const lines = Math.max(2, Math.floor((cap - BODY_CUE_H) / lineHeight));
  return { overflow: true, height: lines * lineHeight, lines };
}

/**
 * Card frames. `regular`: 18 px padding, 10 px gaps, 26 px title line,
 * stacked header under 380 px. `dense`: 12 px padding, 6 px gaps, 22 px
 * title line, single-row header — the frame landscape phones always
 * use, and the one a portrait phone drops to when the regular frame
 * would not show the whole step text.
 */
export type CardFrame = 'regular' | 'dense';

/** Chrome the dense frame saves against the regular one: padding
 *  2 × (18 − 12), three gaps × (10 − 6), the title line (26 − 22) and the
 *  action row's 2 px top margin. */
export const DENSE_SAVINGS = 12 + 12 + 4 + 2;
/** …plus the header's second row (dots under the labels) when the
 *  regular header stacks (card narrower than `STACKED_HEADER_MAX_WIDTH`). */
export const STACKED_HEADER_SAVINGS = 12;
/** Regular cards narrower than this stack their header. */
export const STACKED_HEADER_MAX_WIDTH = 380;

/** Rooms under this are scarce whatever the step says: the regular
 *  frame's chrome on a phone-width card (≈ 153 px, single-row header)
 *  plus four lines and the cue gutter (96 px) do not fit, so the card
 *  goes dense before the text is even measured — no regular-to-dense
 *  flip on the first paint, and every step of a lesson wears the same
 *  frame on that device. */
export const SCARCE_ROOM = 250;

/** Margin a dense card needs before it goes back to regular. The
 *  regular chrome is only *estimated* from a dense measurement
 *  (`DENSE_SAVINGS`, exact for the frames as styled — 153 vs 123 px on
 *  a 388 px card, 165 vs 123 stacked), so a little slack keeps a card
 *  on the boundary from flipping regular → measure → dense → estimate
 *  → regular; the overlay also allows one return per step as a hard
 *  stop should a wrapping title put the estimate off. */
export const FRAME_HYSTERESIS = 8;

export interface FrameInput {
  /** Vertical room the card has (see `bodyCap`); `Infinity` when unbounded. */
  room: number;
  /** Measured chrome (everything but the body) of the frame currently
   *  rendered (`current`); `null` until measured. */
  chrome: number | null;
  current: CardFrame;
  /** Card width — decides whether the regular header stacks. */
  width: number;
  /** Natural height of the body text at this width; `null` until measured. */
  contentHeight: number | null;
}

/**
 * Frame for the card: dense when the room is scarce (`SCARCE_ROOM`) or
 * the regular frame's chrome would not leave the whole text in the
 * room, else regular. A dense card only returns to regular once the
 * regular frame would fit with `FRAME_HYSTERESIS` to spare.
 */
export function chooseFrame({
  room,
  chrome,
  current,
  width,
  contentHeight,
}: FrameInput): CardFrame {
  if (room < SCARCE_ROOM) return 'dense';
  if (chrome === null || contentHeight === null || !Number.isFinite(room)) return current;
  const savings = DENSE_SAVINGS + (width < STACKED_HEADER_MAX_WIDTH ? STACKED_HEADER_SAVINGS : 0);
  const regularChrome = current === 'regular' ? chrome : chrome + savings;
  const slack = current === 'dense' ? FRAME_HYSTERESIS : 0;
  return room - regularChrome >= contentHeight + slack ? 'regular' : 'dense';
}
