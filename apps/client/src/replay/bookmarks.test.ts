import type { Event as EngineEvent, GameState, Seat, Tile } from '@mahjong/game-logic';
import { emptyState } from '@mahjong/game-logic';
import { describe, expect, it } from 'vitest';
import { deriveBookmarks } from './bookmarks';
import type { ReplayFrame, ReplayPlayerMeta } from './types';

const NO_PLAYERS: Record<Seat, ReplayPlayerMeta | null> = { 0: null, 1: null, 2: null, 3: null };

const PLAYERS: Record<Seat, ReplayPlayerMeta | null> = {
  0: { playerId: 'p0', displayName: 'Alice', isBot: false },
  1: { playerId: 'p1', displayName: 'Bob', isBot: false },
  2: { playerId: 'p2', displayName: 'Carol', isBot: false },
  3: { playerId: 'p3', displayName: 'Dan', isBot: false },
};

const SAMPLE_TILE: Tile = { kind: 'suit', suit: 'man', rank: 1, copy: 0 };

function makeState(over: Partial<GameState> = {}): GameState {
  return { ...emptyState(), ...over };
}

function frame(seq: number, events: EngineEvent[], state: GameState = makeState()): ReplayFrame {
  return { seq, ts: seq * 1000, state, events };
}

describe('deriveBookmarks', () => {
  it('returns an empty array for a no-event frame list', () => {
    expect(deriveBookmarks([frame(0, [])], NO_PLAYERS)).toEqual([]);
  });

  it('emits a hand-start bookmark with the dealer name', () => {
    const events: EngineEvent[] = [{ t: 'handStarted', seed: 42 }];
    const bookmarks = deriveBookmarks([frame(0, events, makeState({ dealer: 1 }))], PLAYERS);
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0]!.kind).toBe('hand-start');
    expect(bookmarks[0]!.label).toContain('Bob');
    expect(bookmarks[0]!.label).toContain('Hand 1');
  });

  it('uses fallback seat labels when no player meta is present', () => {
    const events: EngineEvent[] = [{ t: 'handStarted', seed: 42 }];
    const bookmarks = deriveBookmarks([frame(0, events, makeState({ dealer: 0 }))], NO_PLAYERS);
    expect(bookmarks[0]!.label).toContain('East');
  });

  it('increments the hand index across multiple hand-start events', () => {
    const f1 = frame(0, [{ t: 'handStarted', seed: 1 }], makeState({ dealer: 0 }));
    const f2 = frame(1, [{ t: 'handStarted', seed: 2 }], makeState({ dealer: 1 }));
    const bookmarks = deriveBookmarks([f1, f2], PLAYERS);
    expect(bookmarks).toHaveLength(2);
    expect(bookmarks[0]!.label).toContain('Hand 1');
    expect(bookmarks[1]!.label).toContain('Hand 2');
  });

  it('emits a gang bookmark with the seat and kind', () => {
    const events: EngineEvent[] = [{ t: 'gangDeclared', seat: 2, kind: 'concealed' }];
    const bookmarks = deriveBookmarks([frame(0, events)], PLAYERS);
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0]!.kind).toBe('gang');
    expect(bookmarks[0]!.label).toContain('Carol');
    expect(bookmarks[0]!.label).toContain('concealed gang');
  });

  it('emits a win bookmark with faan + self-draw', () => {
    const won: EngineEvent = {
      t: 'won',
      seat: 0,
      from: 0,
      tile: SAMPLE_TILE,
      selfDraw: true,
      faan: 5,
      breakdown: [],
    };
    const bookmarks = deriveBookmarks([frame(0, [won])], PLAYERS);
    expect(bookmarks[0]!.kind).toBe('win');
    expect(bookmarks[0]!.label).toContain('Alice');
    expect(bookmarks[0]!.label).toContain('5 faan');
    expect(bookmarks[0]!.label).toContain('self-draw');
  });

  it('emits a robbed-gang bookmark when the prior state had pendingPromotedGang', () => {
    const prior = makeState({
      pendingPromotedGang: { seat: 1, tile: SAMPLE_TILE, meldIdx: 0 },
    });
    const f0 = frame(0, [], prior);
    const won: EngineEvent = {
      t: 'won',
      seat: 0,
      from: 1,
      tile: SAMPLE_TILE,
      selfDraw: false,
      faan: 7,
      breakdown: [],
    };
    const f1 = frame(1, [won]);
    const bookmarks = deriveBookmarks([f0, f1], PLAYERS);
    expect(bookmarks).toHaveLength(1);
    expect(bookmarks[0]!.kind).toBe('robbed-gang');
    expect(bookmarks[0]!.label).toContain('Alice');
    expect(bookmarks[0]!.label).toContain('Bob');
    expect(bookmarks[0]!.label).toContain('搶槓');
  });

  it('emits a draw bookmark for drawn-game', () => {
    const events: EngineEvent[] = [{ t: 'drawn-game', reason: 'wall-empty' }];
    const bookmarks = deriveBookmarks([frame(0, events)], PLAYERS);
    expect(bookmarks[0]!.kind).toBe('draw');
    expect(bookmarks[0]!.label).toContain('Wall empty');
  });

  it('points each bookmark at the seq of the frame that produced its event', () => {
    const events1: EngineEvent[] = [{ t: 'handStarted', seed: 1 }];
    const events2: EngineEvent[] = [{ t: 'gangDeclared', seat: 0, kind: 'exposed' }];
    const bookmarks = deriveBookmarks(
      [frame(0, events1), frame(1, []), frame(2, events2)],
      PLAYERS,
    );
    expect(bookmarks.map((b) => b.seq)).toEqual([0, 2]);
  });
});
