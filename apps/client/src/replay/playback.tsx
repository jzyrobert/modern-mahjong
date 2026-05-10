import type { Event as EngineEvent, GameState, Seat } from '@mahjong/game-logic';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { ReplayBookmark, ReplayHeader, ReplayRecord } from './types';

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

export function PlaybackProvider({ record, children }: PlaybackProviderProps) {
  const [cursor, setCursor] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [speed, setSpeed] = useState<0.5 | 1 | 2 | 4>(1);
  const [pov, setPov] = useState<PlaybackPov>('all');
  const totalFrames = record.frames.length;

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
    for (const b of record.bookmarks) {
      if (b.seq < cur) target = b.seq;
      else break;
    }
    setCursor(target);
  }, [cursor, record.bookmarks]);

  const jumpNextBookmark = useCallback(() => {
    const cur = cursor;
    for (const b of record.bookmarks) {
      if (b.seq > cur) {
        setCursor(b.seq);
        return;
      }
    }
    setCursor(totalFrames - 1);
  }, [cursor, record.bookmarks, totalFrames]);

  // Auto-pause when we reach the end.
  useEffect(() => {
    if (cursor === totalFrames - 1) setIsPlaying(false);
  }, [cursor, totalFrames]);

  // Auto-advance loop. Schedules a single timer per cursor advance so a
  // pause / seek cleanly cancels. `record.frames` is stable for the
  // lifetime of a `<PlaybackProvider>` mount — listing it in deps would
  // be dead weight.
  const frames = record.frames;
  useEffect(() => {
    if (!isPlaying) return;
    if (cursor >= totalFrames - 1) return;
    const cur = frames[cursor];
    const next = frames[cursor + 1];
    if (!cur || !next) return;
    const realGap = Math.max(0, next.ts - cur.ts);
    const cappedGap = Math.min(realGap, MAX_FRAME_GAP_MS);
    const wait = Math.max(50, Math.round(cappedGap / speed));
    const timer = setTimeout(() => setCursor((c) => c + 1), wait);
    return () => clearTimeout(timer);
  }, [cursor, isPlaying, speed, totalFrames, frames]);

  const value = useMemo<PlaybackContextValue>(() => {
    const frame = record.frames[cursor]!;
    return {
      header: record.header,
      bookmarks: record.bookmarks,
      totalFrames,
      cursor,
      state: frame.state,
      events: frame.events,
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
    record.bookmarks,
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

export function usePlayback(): PlaybackContextValue {
  const ctx = useContext(PlaybackContext);
  if (!ctx) {
    throw new Error('usePlayback must be used inside <PlaybackProvider>');
  }
  return ctx;
}
