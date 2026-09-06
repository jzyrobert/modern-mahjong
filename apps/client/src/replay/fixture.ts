import { type Bot, bots } from '@mahjong/bots';
import {
  type Action,
  type Event as EngineEvent,
  type GameState,
  IllegalActionError,
  SEATS,
  type Seat,
  emptyState,
  nextDealer,
  reduce,
  soloRulesFrom,
} from '@mahjong/game-logic';
import { deriveBookmarks } from './bookmarks';
import { ENGINE_VERSION } from './engineVersion';
import { saveRecord } from './storage';
import type { ReplayFrame, ReplayHeader, ReplayPlayerMeta, ReplayRecord } from './types';

/**
 * Deterministic replay records for the screenshot verifier and the 3D
 * replay specs. Plays a whole solo match headlessly — the engine's
 * seeded shuffle + the deterministic `heuristic` / `simple` bots at
 * every seat (the `passive` bot rolls `Math.random`) — and records one
 * frame per action exactly as `recorder.ts` would from the transport's
 * delta stream. No rendering, no timers: a two-hand match builds in a
 * few tens of milliseconds, so a recipe can seed the library and open
 * the player without driving a match on software GL.
 *
 * The record id is a function of the seed (`replay-fixture-<seed>`) so
 * recipes can navigate straight to `/replays/replay-fixture-5`.
 */
export interface ReplayFixtureOptions {
  /** Engine seed for hand 1 (hand n uses `seed + n - 1`). */
  seed?: number;
  /** Hands to play before the record ends (default 2). */
  hands?: number;
  /** Seat recorded as the local player (default 0). */
  localSeat?: Seat;
  /** Wall-clock ms of frame 0 (default: about an hour ago). */
  startedAt?: number;
  /** Milliseconds between consecutive frames (autoplay pacing). */
  frameGapMs?: number;
}

export const FIXTURE_NAMES: readonly string[] = ['Robert', 'Mei Ling', 'Kwok Fai', 'Siu Yin'];
/** Bot kind per seat — every one deterministic. */
const FIXTURE_BOTS: readonly Bot[] = [bots.heuristic, bots.heuristic, bots.simple, bots.heuristic];
/** Hard cap on actions — a stuck loop can never spin forever. */
const MAX_ACTIONS = 4000;
const DEFAULT_FRAME_GAP_MS = 900;

/**
 * Visible-frame cursor the `replay-player-mid` recipe opens the default
 * fixture (seed 5, two hands) on: late in hand 1, with 40 discards on
 * the table and seven exposed melds. `fixture.test.ts` pins it.
 */
export const FIXTURE_MID_FRAME = 99;

export function replayFixtureId(seed: number): string {
  return `replay-fixture-${seed}`;
}

export function buildReplayFixture(opts: ReplayFixtureOptions = {}): ReplayRecord {
  const seed = opts.seed ?? 5;
  const hands = Math.max(1, opts.hands ?? 2);
  const localSeat: Seat = opts.localSeat ?? 0;
  const gap = opts.frameGapMs ?? DEFAULT_FRAME_GAP_MS;

  let state: GameState = emptyState(soloRulesFrom());
  const frames: ReplayFrame[] = [{ seq: 0, ts: 0, state, events: [] }];
  const apply = (action: Action): EngineEvent[] => {
    const next = reduce(state, action);
    state = next.state;
    frames.push({ seq: frames.length, ts: frames.length * gap, state, events: next.events });
    return next.events;
  };
  /** Apply, treating the engine's illegality as "not this action". */
  const tryApply = (action: Action): boolean => {
    try {
      apply(action);
      return true;
    } catch (e) {
      if (e instanceof IllegalActionError) return false;
      throw e;
    }
  };

  apply({ t: 'startHand', seed });
  let handsDone = 0;
  for (let n = 0; n < MAX_ACTIONS && handsDone < hands; n++) {
    if (state.phase === 'turn') {
      const seat = state.turn;
      const bot = FIXTURE_BOTS[seat]!;
      if (!state.hasDrawn) {
        apply({ t: 'draw', seat });
        continue;
      }
      if (tryApply({ t: 'declareWin', seat, selfDraw: true })) continue;
      const tile = bot.pickDiscard({ state, seat });
      apply({ t: 'discard', seat, tile });
      continue;
    }
    if (state.phase === 'awaitingClaims' && state.pendingClaims) {
      const pending = state.pendingClaims;
      let submitted = false;
      for (const seat of SEATS) {
        if (state.phase !== 'awaitingClaims' || !state.pendingClaims) break;
        if (seat === pending.discard.from || state.pendingClaims.submitted[seat]) continue;
        let pick: ReturnType<Bot['pickClaim']>;
        try {
          pick = FIXTURE_BOTS[seat]!.pickClaim({ state, seat });
        } catch (e) {
          if (!(e instanceof IllegalActionError)) throw e;
          pick = { kind: 'pass' };
        }
        if (!tryApply({ t: 'declareClaim', seat, claim: pick })) {
          tryApply({ t: 'declareClaim', seat, claim: { kind: 'pass' } });
        }
        submitted = true;
      }
      // Every seat is in but the window is still open: resolve it.
      if (!submitted && state.phase === 'awaitingClaims') {
        apply({ t: 'resolveClaims', nowMs: Number.MAX_SAFE_INTEGER });
      }
      continue;
    }
    if (state.phase === 'resolved') {
      handsDone++;
      if (handsDone < hands) {
        apply({ t: 'startHand', seed: seed + handsDone, dealer: nextDealer(state) });
      }
      continue;
    }
    break;
  }

  const players: Record<Seat, ReplayPlayerMeta | null> = { 0: null, 1: null, 2: null, 3: null };
  for (const seat of SEATS) {
    players[seat] = {
      playerId: seat === localSeat ? 'fixture-you' : `fixture-bot-${seat}`,
      displayName: FIXTURE_NAMES[seat]!,
      isBot: seat !== localSeat,
    };
  }
  const last = frames[frames.length - 1]!;
  const startedAt = opts.startedAt ?? Date.now() - last.ts - 3_600_000;
  const header: ReplayHeader = {
    id: replayFixtureId(seed),
    matchCode: 'SOLO',
    joinKind: 'solo',
    startedAt,
    endedAt: startedAt + last.ts,
    durationMs: last.ts,
    localPlayerId: 'fixture-you',
    localSeat,
    localDisplayName: FIXTURE_NAMES[localSeat]!,
    players,
    finalScoreboard: { ...last.state.scoreboard },
    handsPlayed: frames.reduce(
      (n, f) => n + f.events.filter((e) => e.t === 'handStarted').length,
      0,
    ),
    engineVersion: ENGINE_VERSION,
    rules: state.rules,
  };
  return { header, frames, bookmarks: deriveBookmarks(frames, players) };
}

/**
 * Test hatch — builds a fixture and saves it to the library, returning
 * its id. The screenshot recipes and `e2e/three-replay.spec.ts` call it
 * from the `/replays` page (`evaluate`) before navigating to the
 * player, the same way `__MAHJONG_TEST_RECORDER__` seeds post-hand UI.
 */
declare global {
  // eslint-disable-next-line no-var
  var __MAHJONG_TEST_REPLAY_FIXTURE__:
    | ((opts?: ReplayFixtureOptions & { quota?: number }) => string)
    | undefined;
}
if (typeof globalThis !== 'undefined') {
  globalThis.__MAHJONG_TEST_REPLAY_FIXTURE__ = (opts = {}) => {
    const record = buildReplayFixture(opts);
    saveRecord(record, opts.quota ?? 50);
    return record.header.id;
  };
}
