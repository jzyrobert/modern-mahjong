import { useMemo } from 'react';
import { usePlayback } from '../../replay/playback';
import type { ReplayBookmark } from '../../replay/types';
import { WIND_GLYPH } from '../winds';

// ─── Chapter strip ──────────────────────────────────────────────────

export interface ReplayChapter {
  /** 0..1 range start, used to flex the chapter cell width. */
  from: number;
  /** 0..1 range end. */
  to: number;
  /** Bookmark seq the chapter begins at — what the strip tap seeks to. */
  seq: number;
  /** Hand number (1-based). */
  index: number;
  /** Round-wind glyph for the chapter (currently always the prevailing
   *  wind — most replays sit inside a single round). */
  wind: string;
  /** Two-line label content. */
  label: string;
  /** "Robert won · 5 faan" / "Drawn game" / "IN PROGRESS" / "Pending". */
  result: string;
  /** Cursor sits inside this chapter's range. */
  current: boolean;
  /** Chapter starts after the cursor (not yet reached). */
  pending: boolean;
}

export function useChapters(): readonly ReplayChapter[] {
  const playback = usePlayback();
  return useMemo(() => {
    return deriveChapters(playback.bookmarks, playback.totalFrames, playback.cursor, {
      windGlyph: WIND_GLYPH[playback.state.prevailingWind],
    });
  }, [playback.bookmarks, playback.totalFrames, playback.cursor, playback.state.prevailingWind]);
}

export function deriveChapters(
  bookmarks: readonly ReplayBookmark[],
  totalFrames: number,
  cursor: number,
  opts: { windGlyph: string },
): ReplayChapter[] {
  if (totalFrames <= 0) return [];
  const starts = bookmarks.filter((b) => b.kind === 'hand-start');
  // Synthesise a hand-1 boundary at seq 0 only if the recorder never
  // emitted one — e.g. a record that started mid-hand. Otherwise trust
  // the real bookmarks even if the first sits a frame or two in.
  if (starts.length === 0) {
    starts.push({
      seq: 0,
      kind: 'hand-start',
      label: 'Hand 1',
    });
  }
  const last = Math.max(1, totalFrames - 1);
  return starts.map((b, i) => {
    const next = starts[i + 1];
    const startSeq = b.seq;
    // The visible-seq remap can snap a `won` / `draw` bookmark forward
    // onto the next hand's start frame. Look one frame past the
    // chapter's nominal end so a collapsed end-bookmark still finds
    // the right chapter.
    const endSeq = next ? next.seq - 1 : totalFrames - 1;
    const lookupEndSeq = next ? next.seq : totalFrames - 1;
    const from = startSeq / last;
    const to = (endSeq + 1) / last;
    const ended = findEndBookmark(bookmarks, startSeq, lookupEndSeq);
    const current = cursor >= startSeq && cursor <= endSeq;
    const pending = cursor < startSeq;
    return {
      from: Math.min(1, Math.max(0, from)),
      to: Math.min(1, Math.max(from, to)),
      seq: startSeq,
      index: i + 1,
      wind: opts.windGlyph,
      label: `HAND ${i + 1}`,
      result: chapterResult(ended, current, pending, cursor),
      current,
      pending,
    };
  });
}

function findEndBookmark(
  bookmarks: readonly ReplayBookmark[],
  startSeq: number,
  endSeq: number,
): ReplayBookmark | null {
  for (const b of bookmarks) {
    if (b.seq < startSeq) continue;
    if (b.seq > endSeq) break;
    if (b.kind === 'win' || b.kind === 'robbed-gang' || b.kind === 'draw') return b;
  }
  return null;
}

function chapterResult(
  ended: ReplayBookmark | null,
  current: boolean,
  pending: boolean,
  cursor: number,
): string {
  if (pending) return 'Pending';
  if (ended && cursor >= ended.seq) {
    if (ended.kind === 'draw') return 'Drawn game';
    // Bookmark labels are pre-rendered as "<Name> wins N faan" or the
    // robbed-gang phrasing — keep them as-is for the chapter strip.
    return ended.label;
  }
  if (current) return 'IN PROGRESS';
  // Chapter is in the past but the visible-seq remap snapped its
  // win/draw bookmark onto the next chapter's start frame, so we
  // couldn't find it inside this chapter's range. Show a neutral
  // dash rather than the misleading "Pending" label.
  return '—';
}
