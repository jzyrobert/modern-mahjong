import type { Event as EngineEvent, GameState, Seat } from '@mahjong/game-logic';
import type { ServerMessage } from '@mahjong/protocol';
import { create } from 'zustand';
import { getDisplayName, getPlayerId } from '../identity';
import { deriveBookmarks } from './bookmarks';
import { ENGINE_VERSION } from './engineVersion';
import { saveRecord } from './storage';
import type {
  ReplayFrame,
  ReplayHeader,
  ReplayJoinKind,
  ReplayPlayerMeta,
  ReplayRecord,
} from './types';

/**
 * Recording layer. Lives as a zustand store so React components can
 * cheaply subscribe to "is there a draft?" and "has the user saved
 * this match?" — the recorder logic itself is imperative (called by
 * the transport layer's message handler tee) but the UI flag changes
 * need to drive re-renders.
 *
 * The draft buffers frames in memory regardless of `autoRecord`. Two
 * persistence triggers:
 *
 *  1. User hits "Save this match" → `saveExplicit()` flips
 *     `savedThisMatch` and writes immediately; subsequent deltas
 *     rewrite the on-disk record so the saved replay always reflects
 *     the latest state.
 *  2. `autoRecord` setting → `finalizeMatch()` writes on tear-down
 *     even if the user never hit save.
 *
 * If neither fires, the draft is discarded on tear-down — no disk
 * usage from a session the user didn't ask to keep.
 */

interface ActiveDraft {
  header: ReplayHeader;
  frames: ReplayFrame[];
  /** Wall-clock at frame[0]; `frame.ts` is offset from this. */
  startWallClock: number;
  /** True after the user explicitly pressed "Save this match" in this match. */
  savedThisMatch: boolean;
}

interface RecorderStore {
  draft: ActiveDraft | null;
  /** Mirrors `draft.savedThisMatch` so the UI can subscribe without a deep selector. */
  savedThisMatch: boolean;

  /** Begin a new draft from the first `state` message of a match. */
  startMatch: (init: {
    state: GameState;
    you: Seat | 'spectator';
    matchCode: string;
    joinKind: ReplayJoinKind;
    rules: GameState['rules'];
  }) => void;

  /** Append a delta frame. Called for every inbound `'delta'` message. */
  onDelta: (events: EngineEvent[], state: GameState) => void;

  /** Replace the latest frame's state. Used for reconnect `'state'` messages. */
  onState: (state: GameState) => void;

  /** Refresh the per-seat player meta from a lobby message. */
  onLobby: (lobby: ServerMessage & { t: 'lobby' }) => void;

  /** User hit "Save this match" — persist the current draft and mark saved. */
  saveExplicit: (quota: number) => boolean;

  /** Discard a previously-saved replay (user changed their mind). */
  discardThisMatch: () => void;

  /** Match teardown — persist if autoRecord OR explicit save, then clear. */
  finalizeMatch: (autoRecord: boolean, quota: number) => void;
}

function emptyHeader(init: {
  state: GameState;
  you: Seat | 'spectator';
  matchCode: string;
  joinKind: ReplayJoinKind;
  rules: GameState['rules'];
}): ReplayHeader {
  const now = Date.now();
  return {
    id: newReplayId(),
    matchCode: init.matchCode,
    joinKind: init.joinKind,
    startedAt: now,
    endedAt: now,
    durationMs: 0,
    localPlayerId: getPlayerId(),
    localSeat: init.you,
    localDisplayName: getDisplayName(),
    players: { 0: null, 1: null, 2: null, 3: null },
    finalScoreboard: { ...init.state.scoreboard },
    handsPlayed: 0,
    engineVersion: ENGINE_VERSION,
    rules: init.rules,
  };
}

/** Same UUID-ish shape as identity.ts's playerId — fine for ids. */
function newReplayId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function finalize(draft: ActiveDraft): ReplayRecord {
  const handsPlayed = draft.frames.reduce(
    (n, f) => n + f.events.filter((e) => e.t === 'handStarted').length,
    0,
  );
  const lastState = draft.frames[draft.frames.length - 1]?.state ?? null;
  const header: ReplayHeader = {
    ...draft.header,
    endedAt: Date.now(),
    durationMs: Date.now() - draft.startWallClock,
    handsPlayed,
    finalScoreboard: lastState ? { ...lastState.scoreboard } : draft.header.finalScoreboard,
  };
  return {
    header,
    frames: draft.frames,
    bookmarks: deriveBookmarks(draft.frames, header.players),
  };
}

export const useRecorder = create<RecorderStore>((set, get) => ({
  draft: null,
  savedThisMatch: false,

  startMatch: (init) => {
    const startWallClock = Date.now();
    const header = emptyHeader(init);
    const frame0: ReplayFrame = {
      seq: 0,
      ts: 0,
      state: init.state,
      events: [],
    };
    set({
      draft: {
        header,
        frames: [frame0],
        startWallClock,
        savedThisMatch: false,
      },
      savedThisMatch: false,
    });
  },

  onDelta: (events, state) => {
    const cur = get().draft;
    if (!cur) return;
    const seq = cur.frames.length;
    const frame: ReplayFrame = {
      seq,
      ts: Date.now() - cur.startWallClock,
      state,
      events,
    };
    cur.frames.push(frame);
    // If the user already pressed "Save this match", keep rewriting the
    // on-disk record so it always reflects the latest state.
    if (cur.savedThisMatch) {
      saveRecord(finalize(cur), QUOTA_HINT);
    }
    set({ draft: cur });
  },

  onState: (state) => {
    const cur = get().draft;
    if (!cur || cur.frames.length === 0) return;
    const last = cur.frames[cur.frames.length - 1]!;
    last.state = state;
    if (cur.savedThisMatch) {
      saveRecord(finalize(cur), QUOTA_HINT);
    }
    set({ draft: cur });
  },

  onLobby: (lobby) => {
    const cur = get().draft;
    if (!cur) return;
    const seats: Record<Seat, ReplayPlayerMeta | null> = { 0: null, 1: null, 2: null, 3: null };
    for (const p of lobby.players) {
      if (p.seat === null) continue;
      seats[p.seat] = {
        playerId: p.playerId,
        displayName: p.displayName,
        isBot: p.isBot,
      };
    }
    cur.header.players = seats;
    if (cur.savedThisMatch) {
      saveRecord(finalize(cur), QUOTA_HINT);
    }
    set({ draft: cur });
  },

  saveExplicit: (quota) => {
    const cur = get().draft;
    if (!cur) return false;
    cur.savedThisMatch = true;
    const ok = saveRecord(finalize(cur), quota);
    set({ draft: cur, savedThisMatch: ok });
    return ok;
  },

  discardThisMatch: () => {
    const cur = get().draft;
    if (!cur) return;
    cur.savedThisMatch = false;
    // Note: we don't delete the on-disk record here — the user can still
    // reach it from the library. "Discard" just clears the in-match
    // toggle so a subsequent delta won't keep rewriting it.
    set({ draft: cur, savedThisMatch: false });
  },

  finalizeMatch: (autoRecord, quota) => {
    const cur = get().draft;
    if (!cur) {
      set({ savedThisMatch: false });
      return;
    }
    if (autoRecord || cur.savedThisMatch) {
      saveRecord(finalize(cur), quota);
    }
    set({ draft: null, savedThisMatch: false });
  },
}));

/**
 * Default quota used by the recorder's eager rewrites mid-match. The
 * settings UI flips `useGame.settings.replayQuota`; the explicit
 * `saveExplicit` and `finalizeMatch` calls thread the live value
 * through. This constant is the conservative fallback for the eager
 * rewrites, which fire on every delta after the user pressed save —
 * we'd rather over-prune than under-cap.
 */
const QUOTA_HINT = 50;
