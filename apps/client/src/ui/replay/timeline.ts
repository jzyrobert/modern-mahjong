import type { ReplayChapter } from './chapters';

/**
 * Timeline geometry shared by the glass scrubber's chapter cards, its
 * gold playhead and its tap-to-seek. The cards are flexed by their
 * share of the record (the current one wider on compact strips), so a
 * cursor ratio does not map linearly onto strip pixels — the playhead
 * and the tap have to use the same piecewise, per-card mapping the card
 * widths do, or a tap lands frames away from the card edge it hit.
 */
export interface TimelineSegment {
  /** Cursor-ratio range this card covers, 0..1 (`from` ≤ `to`). */
  from: number;
  to: number;
  /** Flex weight (share of the strip minus gaps). */
  weight: number;
}

/** Card gap on the strip, CSS px. */
export const TIMELINE_GAP = 3;

/** Flex weight per card: its share of the record, doubled for the current card on compact strips. */
export function timelineSegments(
  chapters: readonly ReplayChapter[],
  compact: boolean,
): TimelineSegment[] {
  return chapters.map((c) => ({
    from: c.from,
    to: c.to,
    weight: Math.max(0.001, c.to - c.from) * (compact && c.current ? 2 : 1),
  }));
}

function totalWeight(segments: readonly TimelineSegment[]): number {
  return segments.reduce((n, s) => n + s.weight, 0);
}

/** Cursor ratio (0..1) → x on a `width` px strip whose cards are separated by `gap` px. */
export function ratioToX(
  segments: readonly TimelineSegment[],
  ratio: number,
  width: number,
  gap: number = TIMELINE_GAP,
): number {
  const r = clamp01(ratio);
  if (segments.length === 0 || width <= 0) return r * Math.max(0, width);
  const cardsW = Math.max(0, width - gap * (segments.length - 1));
  const total = totalWeight(segments);
  let x = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    const w = (s.weight / total) * cardsW;
    const last = i === segments.length - 1;
    // A ratio on the seam between two cards belongs to the later one
    // (a chapter's first frame draws at its card's left edge).
    if (r < s.to || last) {
      const span = Math.max(1e-9, s.to - s.from);
      const t = clamp01((r - s.from) / span);
      return x + t * w;
    }
    x += w + gap;
  }
  return width;
}

/** x on the strip → cursor ratio (0..1); a tap in a gap snaps to the nearer card edge. */
export function xToRatio(
  segments: readonly TimelineSegment[],
  x: number,
  width: number,
  gap: number = TIMELINE_GAP,
): number {
  if (width <= 0) return 0;
  const px = Math.max(0, Math.min(width, x));
  if (segments.length === 0) return px / width;
  const cardsW = Math.max(0, width - gap * (segments.length - 1));
  const total = totalWeight(segments);
  let left = 0;
  for (let i = 0; i < segments.length; i++) {
    const s = segments[i]!;
    const w = (s.weight / total) * cardsW;
    const last = i === segments.length - 1;
    if (px <= left + w || last) {
      const t = w > 0 ? clamp01((px - left) / w) : 0;
      return s.from + t * (s.to - s.from);
    }
    // In the gap after this card: snap to whichever edge is nearer.
    if (px < left + w + gap)
      return px - (left + w) < gap / 2 ? s.to : (segments[i + 1]?.from ?? s.to);
    left += w + gap;
  }
  return 1;
}

/**
 * Tap x → visible-frame cursor: always a finite integer inside
 * `[0, totalFrames - 1]` (a `NaN` from a missing pointer coordinate
 * must never reach the playback store).
 */
export function xToCursor(
  segments: readonly TimelineSegment[],
  x: number,
  width: number,
  totalFrames: number,
  gap: number = TIMELINE_GAP,
): number {
  const last = Math.max(0, totalFrames - 1);
  if (!Number.isFinite(x) || !Number.isFinite(width) || width <= 0 || last === 0) return 0;
  const ratio = xToRatio(segments, x, width, gap);
  const cursor = Math.round(clamp01(ratio) * last);
  return Number.isFinite(cursor) ? Math.max(0, Math.min(last, cursor)) : 0;
}

/**
 * Horizontal press position inside the pressed element, CSS px, from an
 * RN `nativeEvent`. Native gives `locationX`; RN-web hands the DOM
 * `MouseEvent` / `PointerEvent` through, which has no `locationX` —
 * there the element's rect (via `pageX` / `clientX`) or `offsetX` is
 * used instead. `null` when nothing usable is present (the caller then
 * leaves the cursor alone).
 */
export function pressX(nativeEvent: unknown, elementLeft: number | null = null): number | null {
  const ne = (nativeEvent ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const location = num(ne.locationX);
  if (location !== null) return location;
  if (elementLeft !== null) {
    const client = num(ne.clientX) ?? num(ne.pageX);
    if (client !== null) return client - elementLeft;
  }
  return num(ne.offsetX);
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
}
