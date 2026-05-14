import {
  type Event as EngineEvent,
  type GameState,
  SEATS,
  type Seat,
  hasMeaningfulClaim,
} from '@mahjong/game-logic';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReplayBookmark, ReplayFrame, ReplayHeader, ReplayRecord } from './types';

/**
 * Replay playback state — owns the cursor, autoplay, speed, and POV
 * toggle. The playback layer is purely view-side: stepping the cursor
 * just picks a different recorded frame from the record's `frames`
 * list. No engine re-execution.
 *
 * Autoplay uses real wall-clock pacing derived from the per-frame
 * `ts`s, but caps inter-frame gaps so the player isn't stuck waiting
 * through a 90-second think time. The cap halves at 2×, quarters at
 * 4×.
 *
 * "Visible" frames: the on-wire frame list contains a lot of
 * uninteresting state ticks (a `claimsOpened` immediately followed
 * by an `All passed` resolve where nobody could legally call, or a
 * recorder waiting-state stall between hands). We compute a filtered
 * `visibleFrames` projection so the cursor, scrubber, and bookmarks
 * all operate on the noise-trimmed sequence. The full `record.frames`
 * is still walked so each visible frame's `events` list reflects every
 * concrete event the engine emitted; we only suppress the
 * `claimsOpened`/`All passed` lines themselves when nobody at the
 * table had a meaningful action against the discard.
 */

export type PlaybackPov = Seat | 'all';

interface PlaybackContextValue {
  header: ReplayHeader;
  bookmarks: readonly ReplayBookmark[];
  totalFrames: number;
  cursor: number;
  state: GameState;
  events: readonly EngineEvent[];
  isPlaying: boolean;
  speed: 0.5 | 1 | 2 | 4;
  pov: PlaybackPov;
  goto: (idx: number) => void;
  step: (delta: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  setSpeed: (rate: 0.5 | 1 | 2 | 4) => void;
  setPov: (pov: PlaybackPov) => void;
  /** Jump to the previous bookmark (or frame 0). */
  jumpPrevBookmark: () => void;
  /** Jump to the next bookmark (or last frame). */
  jumpNextBookmark: () => void;
}

const PlaybackContext = createContext<PlaybackContextValue | null>(null);

const MAX_FRAME_GAP_MS = 800;

interface PlaybackProviderProps {
  record: ReplayRecord;
  children: ReactNode;
}

/**
 * Whether any non-discarder seat had something to do against the
 * tile the engine just put on the discard pool. If false, the entire
 * `claimsOpened` → `All passed` round-trip is dead air the user has
 * no business watching.
 */
function anyMeaningfulClaimInState(state: GameState): boolean {
  if (state.phase !== 'awaitingClaims' || !state.lastDiscard) return false;
  const tile = state.lastDiscard.tile;
  for (const seat of SEATS) {
    if (seat === state.lastDiscard.from) continue;
    if (hasMeaningfulClaim(state, seat, tile)) return true;
  }
  return false;
}

/**
 * Project the raw frame list onto the indices a viewer should actually
 * see. Always keep frame 0. Otherwise keep a frame if any of its
 * events describe a tangible action (draw / discard / gang / win /
 * hand-start / rules / drawn game), a contested claim window, or a
 * claim that landed on a non-pass. Drop empty/`waiting`-only frames
 * and dead claim windows.
 */
function computeVisibleSeqs(frames: readonly ReplayFrame[]): readonly number[] {
  if (frames.length === 0) return [];
  const out: number[] = [0];
  for (let i = 1; i < frames.length; i++) {
    const f = frames[i]!;
    if (isVisibleFrame(f, frames[i - 1])) out.push(i);
  }
  return out;
}

function isVisibleFrame(frame: ReplayFrame, prev: ReplayFrame | undefined): boolean {
  if (frame.events.length === 0) return false;
  for (const e of frame.events) {
    switch (e.t) {
      case 'handStarted':
      case 'opened':
      case 'rulesChanged':
      case 'drew':
      case 'discarded':
      case 'gangDeclared':
      case 'won':
      case 'drawn-game':
        return true;
      case 'claimsOpened':
        if (anyMeaningfulClaimInState(frame.state)) return true;
        break;
      case 'claimsResolved':
        if (e.result.kind !== 'pass') return true;
        // An "all passed" resolve is only worth surfacing when at
        // least one seat *could* have called — i.e. when the prior
        // frame's state had a meaningful option. That prior frame is
        // the `claimsOpened` one; its state is `awaitingClaims`.
        if (prev && anyMeaningfulClaimInState(prev.state)) return true;
        break;
    }
  }
  return false;
}

/**
 * Map a raw bookmark.seq onto its visible-cursor index. If the
 * underlying frame got skipped, snap forward to the next visible
 * frame (or back to the last one for an end-of-list bookmark).
 */
function bookmarkVisibleIndex(seq: number, visibleSeqs: readonly number[]): number {
  if (visibleSeqs.length === 0) return 0;
  for (let i = 0; i < visibleSeqs.length; i++) {
    if (visibleSeqs[i]! >= seq) return i;
  }
  return visibleSeqs.length - 1;
}

export function PlaybackProvider({ record, children }: PlaybackProviderProps) {
  const [cursor, setCursor] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2 | 4>(1);
  const [pov, setPov] = useState<PlaybackPov>('all');

  // Visible-frame projection: index into `record.frames`, in order.
  // `cursor` always indexes into this list (length === totalFrames).
  const visibleSeqs = useMemo(() => computeVisibleSeqs(record.frames), [record.frames]);
  const totalFrames = visibleSeqs.length;

  // Bookmarks remapped onto the visible space so the scrubber pips
  // line up with where the user will actually land when they tap.
  const visibleBookmarks = useMemo<readonly ReplayBookmark[]>(() => {
    return record.bookmarks.map((b) => ({
      ...b,
      seq: bookmarkVisibleIndex(b.seq, visibleSeqs),
    }));
  }, [record.bookmarks, visibleSeqs]);

  const goto = useCallback(
    (idx: number) => {
      const clamped = Math.max(0, Math.min(totalFrames - 1, idx));
      setCursor(clamped);
    },
    [totalFrames],
  );

  const step = useCallback(
    (delta: number) => {
      setCursor((c) => Math.max(0, Math.min(totalFrames - 1, c + delta)));
    },
    [totalFrames],
  );

  const play = useCallback(() => setIsPlaying(true), []);
  const pause = useCallback(() => setIsPlaying(false), []);
  const togglePlay = useCallback(() => setIsPlaying((p) => !p), []);

  const jumpPrevBookmark = useCallback(() => {
    const cur = cursor;
    let target = 0;
    for (const b of visibleBookmarks) {
      if (b.seq < cur) target = b.seq;
      else break;
    }
    setCursor(target);
  }, [cursor, visibleBookmarks]);

  const jumpNextBookmark = useCallback(() => {
    const cur = cursor;
    for (const b of visibleBookmarks) {
      if (b.seq > cur) {
        setCursor(b.seq);
        return;
      }
    }
    setCursor(totalFrames - 1);
  }, [cursor, visibleBookmarks, totalFrames]);

  // Auto-pause when we reach the end.
  useEffect(() => {
    if (cursor === totalFrames - 1) setIsPlaying(false);
  }, [cursor, totalFrames]);

  // Auto-advance loop. Uses the wall-clock gap between the two
  // *underlying* frames pointed at by adjacent visible cursors so
  // skipping a chunk of dead claim-window frames doesn't compress the
  // remaining draw/discard tempo.
  const frames = record.frames;
  useEffect(() => {
    if (!isPlaying) return;
    if (cursor >= totalFrames - 1) return;
    const curSeq = visibleSeqs[cursor];
    const nextSeq = visibleSeqs[cursor + 1];
    if (curSeq === undefined || nextSeq === undefined) return;
    const cur = frames[curSeq];
    const next = frames[nextSeq];
    if (!cur || !next) return;
    const realGap = Math.max(0, next.ts - cur.ts);
    const cappedGap = Math.min(realGap, MAX_FRAME_GAP_MS);
    const wait = Math.max(50, Math.round(cappedGap / speed));
    const timer = setTimeout(() => setCursor((c) => c + 1), wait);
    return () => clearTimeout(timer);
  }, [cursor, isPlaying, speed, totalFrames, frames, visibleSeqs]);

  // Clamp cursor if visible-frame count shrinks below it. Defensive —
  // `record.frames` is stable for the provider's lifetime today, but
  // future hot-reload / live-recording use cases shouldn't be able to
  // dangle the cursor past the end.
  useEffect(() => {
    if (cursor > totalFrames - 1) setCursor(Math.max(0, totalFrames - 1));
  }, [cursor, totalFrames]);

  const value = useMemo<PlaybackContextValue>(() => {
    const rawSeq = visibleSeqs[cursor] ?? 0;
    const frame = record.frames[rawSeq]!;
    return {
      header: record.header,
      bookmarks: visibleBookmarks,
      totalFrames,
      cursor,
      state: frame.state,
      events: filterEvents(frame.events, frame, record.frames[rawSeq - 1]),
      isPlaying,
      speed,
      pov,
      goto,
      step,
      play,
      pause,
      togglePlay,
      setSpeed,
      setPov,
      jumpPrevBookmark,
      jumpNextBookmark,
    };
  }, [
    record.frames,
    record.header,
    visibleBookmarks,
    visibleSeqs,
    cursor,
    totalFrames,
    isPlaying,
    speed,
    pov,
    goto,
    step,
    play,
    pause,
    togglePlay,
    jumpPrevBookmark,
    jumpNextBookmark,
  ]);

  return <PlaybackContext.Provider value={value}>{children}</PlaybackContext.Provider>;
}

/**
 * Drop the `claimsOpened` / `All passed` lines from a frame's event
 * log whenever the underlying claim window had nothing to offer. The
 * frame itself may still be visible (it usually pairs with an
 * adjacent draw/discard) — we just don't want to clutter the event
 * strip with the dead-air narration.
 */
function filterEvents(
  events: readonly EngineEvent[],
  frame: ReplayFrame,
  prev: ReplayFrame | undefined,
): readonly EngineEvent[] {
  if (events.length === 0) return events;
  return events.filter((e) => {
    if (e.t === 'claimsOpened') return anyMeaningfulClaimInState(frame.state);
    if (e.t === 'claimsResolved' && e.result.kind === 'pass') {
      return prev ? anyMeaningfulClaimInState(prev.state) : false;
    }
    return true;
  });
}

export function usePlayback(): PlaybackContextValue {
  const ctx = useContext(PlaybackContext);
  if (!ctx) {
    throw new Error('usePlayback must be used inside <PlaybackProvider>');
  }
  return ctx;
}
