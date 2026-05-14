import type { Event as EngineEvent, GameState, Seat, Tile } from '@mahjong/game-logic';
import { emptyState } from '@mahjong/game-logic';
import type { ServerMessage } from '@mahjong/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useRecorder } from './recorder';
import { listHeaders, loadRecord } from './storage';

const SAMPLE_TILE: Tile = { kind: 'suit', suit: 'man', rank: 1, copy: 0 };

function makeState(over: Partial<GameState> = {}): GameState {
  return { ...emptyState(), ...over };
}

function init() {
  return {
    state: makeState(),
    you: 0 as Seat | 'spectator',
    matchCode: 'AAAA',
    joinKind: 'solo' as const,
    rules: emptyState().rules,
  };
}

beforeEach(() => {
  localStorage.clear();
  // Partial set — don't pass `replace: true`, that would strip the
  // action methods off the store.
  useRecorder.setState({ draft: null, savedThisMatch: false });
});

afterEach(() => {
  localStorage.clear();
});

describe('replay recorder', () => {
  it('startMatch creates a frame-0 draft with the initial state', () => {
    useRecorder.getState().startMatch(init());
    const draft = useRecorder.getState().draft;
    expect(draft).not.toBeNull();
    expect(draft!.frames).toHaveLength(1);
    expect(draft!.frames[0]!.seq).toBe(0);
    expect(draft!.frames[0]!.events).toEqual([]);
  });

  it('onDelta appends frames with monotonic seq + post-event state', () => {
    useRecorder.getState().startMatch(init());
    const events: EngineEvent[] = [{ t: 'drew', seat: 0, tile: SAMPLE_TILE }];
    useRecorder.getState().onDelta(events, makeState({ turn: 1 }));
    useRecorder.getState().onDelta([], makeState({ turn: 2 }));
    const draft = useRecorder.getState().draft;
    expect(draft!.frames.map((f) => f.seq)).toEqual([0, 1, 2]);
    expect(draft!.frames[1]!.events).toEqual(events);
    expect(draft!.frames[2]!.state.turn).toBe(2);
  });

  it('onDelta is a no-op when there is no active draft', () => {
    useRecorder.getState().onDelta([], makeState());
    expect(useRecorder.getState().draft).toBeNull();
  });

  it('onState replaces the latest frame state without growing the frame count', () => {
    useRecorder.getState().startMatch(init());
    useRecorder.getState().onDelta([], makeState({ turn: 1 }));
    useRecorder.getState().onState(makeState({ turn: 3 }));
    const draft = useRecorder.getState().draft;
    expect(draft!.frames).toHaveLength(2);
    expect(draft!.frames[1]!.state.turn).toBe(3);
  });

  it('onLobby refreshes per-seat player meta on the header', () => {
    useRecorder.getState().startMatch(init());
    const lobby: ServerMessage & { t: 'lobby' } = {
      t: 'lobby',
      players: [
        {
          seat: 0,
          playerId: 'p0',
          displayName: 'Alice',
          isBot: false,
          connected: true,
        },
        {
          seat: 2,
          playerId: 'p2',
          displayName: 'Carol-bot',
          isBot: true,
          connected: true,
        },
      ],
      host: 'p0',
      rules: emptyState().rules,
    };
    useRecorder.getState().onLobby(lobby);
    const players = useRecorder.getState().draft!.header.players;
    expect(players[0]?.displayName).toBe('Alice');
    expect(players[1]).toBeNull();
    expect(players[2]?.isBot).toBe(true);
  });

  it('saveExplicit persists the current draft and flips savedThisMatch', () => {
    useRecorder.getState().startMatch(init());
    useRecorder.getState().onDelta([], makeState({ turn: 1 }));
    const ok = useRecorder.getState().saveExplicit(50);
    expect(ok).toBe(true);
    expect(useRecorder.getState().savedThisMatch).toBe(true);
    const headers = listHeaders();
    expect(headers).toHaveLength(1);
    const saved = loadRecord(headers[0]!.id);
    expect(saved?.frames).toHaveLength(2);
  });

  it('saveExplicit returns false with no active draft', () => {
    const ok = useRecorder.getState().saveExplicit(50);
    expect(ok).toBe(false);
    expect(listHeaders()).toEqual([]);
  });

  it('discardThisMatch flips savedThisMatch off but leaves the disk record alone', () => {
    useRecorder.getState().startMatch(init());
    useRecorder.getState().saveExplicit(50);
    expect(listHeaders()).toHaveLength(1);
    useRecorder.getState().discardThisMatch();
    expect(useRecorder.getState().savedThisMatch).toBe(false);
    expect(listHeaders()).toHaveLength(1);
  });

  it('finalizeMatch writes when autoRecord=true even without an explicit save', () => {
    useRecorder.getState().startMatch(init());
    useRecorder.getState().onDelta([], makeState({ turn: 1 }));
    useRecorder.getState().finalizeMatch(true, 50);
    expect(useRecorder.getState().draft).toBeNull();
    expect(listHeaders()).toHaveLength(1);
  });

  it('finalizeMatch writes when savedThisMatch=true even with autoRecord=false', () => {
    useRecorder.getState().startMatch(init());
    useRecorder.getState().saveExplicit(50);
    useRecorder.getState().onDelta([], makeState({ turn: 2 }));
    useRecorder.getState().finalizeMatch(false, 50);
    expect(useRecorder.getState().draft).toBeNull();
    // The header should reflect the post-save frame count (2 frames).
    const headers = listHeaders();
    const saved = loadRecord(headers[0]!.id);
    expect(saved?.frames).toHaveLength(2);
  });

  it('finalizeMatch discards an unsaved + non-autoRecord draft', () => {
    useRecorder.getState().startMatch(init());
    useRecorder.getState().onDelta([], makeState());
    useRecorder.getState().finalizeMatch(false, 50);
    expect(useRecorder.getState().draft).toBeNull();
    expect(listHeaders()).toEqual([]);
  });

  it('finalize derives handsPlayed from handStarted events across frames', () => {
    useRecorder.getState().startMatch(init());
    useRecorder.getState().onDelta([{ t: 'handStarted', seed: 1 }], makeState());
    useRecorder.getState().onDelta([], makeState());
    useRecorder.getState().onDelta([{ t: 'handStarted', seed: 2 }], makeState());
    useRecorder.getState().finalizeMatch(true, 50);
    const headers = listHeaders();
    expect(headers[0]!.handsPlayed).toBe(2);
  });
});
