import type { Event as EngineEvent, GameState, Seat } from '@mahjong/game-logic';
import type { ServerMessage } from '@mahjong/protocol';
import { create } from 'zustand';
import { getDisplayName, getPlayerId, newRandomId } from '../identity';
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
 * Persistence model:
 *
 *  - `saveExplicit()` writes a snapshot at the moment of press. The
 *    on-disk record reflects state at save time, plus everything that
 *    arrives between save and teardown.
 *  - `finalizeMatch()` (auto-record OR savedThisMatch) writes one
 *    last time on tear-down so the library always has the final
 *    scoreboard.
 *
 * We deliberately don't rewrite the on-disk record on every delta —
 * a 4-hand match produces ~300 deltas, each one would re-stringify
 * the entire growing frame list (multi-MB after a few hands), which
 * adds up to seconds of jank on the WebSocket message hot path.
 *
 * If neither trigger fires, the draft is discarded on tear-down — no
 * disk usage from a session the user didn't ask to keep.
 */

interface ActiveDraft {
  header: ReplayHeader;
  frames: ReplayFrame[];
  /** Wall-clock at frame[0]; `frame.ts` is offset from this. */
  startWallClock: number;
}

interface RecorderStore {
  draft: ActiveDraft | null;
  /** True after the user pressed "Save this match" in this match. */
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
    id: newRandomId(),
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
      draft: { header, frames: [frame0], startWallClock },
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
    // Immutable append + new draft object so zustand's Object.is
    // comparison fires for any future selector reading frame data.
    set({ draft: { ...cur, frames: [...cur.frames, frame] } });
  },

  onState: (state) => {
    const cur = get().draft;
    if (!cur || cur.frames.length === 0) return;
    const last = cur.frames[cur.frames.length - 1]!;
    const replaced: ReplayFrame = { ...last, state };
    const frames = [...cur.frames.slice(0, -1), replaced];
    set({ draft: { ...cur, frames } });
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
    set({ draft: { ...cur, header: { ...cur.header, players: seats } } });
  },

  saveExplicit: (quota) => {
    const cur = get().draft;
    if (!cur) return false;
    const ok = saveRecord(finalize(cur), quota);
    set({ savedThisMatch: ok });
    return ok;
  },

  discardThisMatch: () => {
    // The on-disk record stays in the library — the user can still
    // reach it from /replays. "Discard" just flips the in-match flag
    // so finalizeMatch won't auto-rewrite on teardown.
    set({ savedThisMatch: false });
  },

  finalizeMatch: (autoRecord, quota) => {
    const cur = get().draft;
    if (cur && (autoRecord || get().savedThisMatch)) {
      saveRecord(finalize(cur), quota);
    }
    set({ draft: null, savedThisMatch: false });
  },
}));

// Test hook: expose the recorder store on globalThis so e2e specs can
// drive `savedThisMatch` / `draft` directly. Mirrors the
// `__MAHJONG_TEST_BOT_SCRIPTS__` pattern in `solo-transport.ts` — an
// out-of-band escape hatch that lets screenshot / scenario specs set
// up post-hand UI states without playing a full match to a win.
declare global {
  var __MAHJONG_TEST_RECORDER__: typeof useRecorder | undefined;
}
if (typeof globalThis !== 'undefined') {
  globalThis.__MAHJONG_TEST_RECORDER__ = useRecorder;
}
