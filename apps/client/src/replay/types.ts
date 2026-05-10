import type { Event as EngineEvent, GameState, RuleConfig, Seat } from '@mahjong/game-logic';

/**
 * Wire-format types for the replay system. A `ReplayRecord` is the durable
 * unit: a header (metadata) plus a list of frames (one per server delta)
 * plus pre-derived bookmarks (key moments highlighted in the scrubber).
 *
 * Persistence uses one localStorage key per record; the `expo-sqlite/
 * localStorage/install` polyfill on native makes that durable across
 * WebView wipes and reinstalls. See `./storage.ts`.
 *
 * Playback re-walks the recorded states directly without re-running the
 * engine — `frames[i].state` is the post-events snapshot the server sent.
 * That decouples saved replays from future engine refactors.
 */

export type ReplayJoinKind = 'online' | 'solo' | 'lan';

export interface ReplayPlayerMeta {
  playerId: string;
  displayName: string;
  isBot: boolean;
}

export interface ReplayHeader {
  /** Stable id assigned when the record is first created. UUID-ish. */
  id: string;
  /** The match code as the server stamped it (e.g. 'SOLO' for solo). */
  matchCode: string;
  joinKind: ReplayJoinKind;
  /** Wall-clock ms when the first state arrived. */
  startedAt: number;
  /** Wall-clock ms when the recorder finalised the record. */
  endedAt: number;
  durationMs: number;
  /** identity.getPlayerId() captured at record time. */
  localPlayerId: string;
  /** The seat the local player occupied — or 'spectator' if they were watching. */
  localSeat: Seat | 'spectator';
  /** identity.getDisplayName() captured at record time. */
  localDisplayName: string;
  /** Lobby snapshot: who was at each seat. Indexed 0..3. */
  players: Record<Seat, ReplayPlayerMeta | null>;
  /** state.scoreboard at the latest finalised hand. */
  finalScoreboard: Record<Seat, number>;
  /** Number of `handStarted` events seen — i.e. hands actually played. */
  handsPlayed: number;
  /** packages/game-logic version at record time. Used for compatibility checks. */
  engineVersion: string;
  /** Rules in effect at the start of the match. */
  rules: RuleConfig;
}

export interface ReplayFrame {
  /** Monotonic 0-indexed cursor into `frames`. */
  seq: number;
  /** Wall-clock ms since `header.startedAt`. */
  ts: number;
  /** Full engine state AFTER the events were applied. */
  state: GameState;
  /** Events that produced this state from the previous frame. Empty for frame 0. */
  events: EngineEvent[];
}

export type ReplayBookmarkKind = 'hand-start' | 'gang' | 'robbed-gang' | 'win' | 'draw';

export interface ReplayBookmark {
  /** Frame index this bookmark points at. Tap-to-seek lands here. */
  seq: number;
  kind: ReplayBookmarkKind;
  /** Pre-rendered tooltip string — keeps the scrubber render cheap. */
  label: string;
}

export interface ReplayRecord {
  header: ReplayHeader;
  frames: ReplayFrame[];
  bookmarks: ReplayBookmark[];
}

/**
 * The serialised form on disk. Identical to `ReplayRecord` for now; the
 * indirection is a hook for future versions to migrate (e.g. compressing
 * `frames` into a delta-of-deltas blob without changing the in-memory
 * shape).
 */
export interface ReplayEnvelope {
  /** Bumped on schema changes; on mismatch the record is dropped. */
  version: 1;
  record: ReplayRecord;
}
