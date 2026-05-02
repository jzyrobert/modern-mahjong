import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  type GameState,
  IllegalActionError,
  assertTileConservation,
  emptyState,
  reduce,
} from '../src/index.js';

function startedHand(seed = 1): GameState {
  const init = emptyState(DEFAULT_RULES);
  const { state } = reduce(init, { t: 'startHand', seed, dealer: 0 });
  return state;
}

describe('reducer — startHand', () => {
  it('deals 13 to each non-dealer and 14 to dealer', () => {
    const s = startedHand();
    expect(s.hands[0].length).toBe(14);
    expect(s.hands[1].length).toBe(13);
    expect(s.hands[2].length).toBe(13);
    expect(s.hands[3].length).toBe(13);
    expect(s.deadWall.length).toBe(14);
    expect(s.wall.length).toBe(136 - 14 - 14 - 13 * 3);
    expect(s.phase).toBe('turn');
    expect(s.turn).toBe(0);
    expect(s.hasDrawn).toBe(true); // dealer doesn't draw on first turn
  });

  it('preserves the 136-tile invariant at start', () => {
    const s = startedHand();
    expect(() => assertTileConservation(s)).not.toThrow();
  });

  it('is deterministic for a fixed seed', () => {
    const a = startedHand(7);
    const b = startedHand(7);
    expect(a.hands[0]).toEqual(b.hands[0]);
    expect(a.wall).toEqual(b.wall);
  });
});

describe('reducer — discard / claim', () => {
  it('discard moves a tile from hand to discards and opens claim window', () => {
    const s = startedHand();
    const tile = s.hands[0][0]!;
    const { state: s1, events } = reduce(s, { t: 'discard', seat: 0, tile });
    expect(s1.phase).toBe('awaitingClaims');
    expect(s1.lastDiscard?.tile).toEqual(tile);
    expect(s1.discards[0].length).toBe(1);
    expect(s1.hands[0].length).toBe(13);
    expect(events.some((e) => e.t === 'discarded')).toBe(true);
    expect(events.some((e) => e.t === 'claimsOpened')).toBe(true);
    assertTileConservation(s1);
  });

  it('rejects discard out of turn', () => {
    const s = startedHand();
    const tile = s.hands[1][0]!;
    expect(() => reduce(s, { t: 'discard', seat: 1, tile })).toThrow(IllegalActionError);
  });

  it('all-pass advances turn to next seat for a draw', () => {
    let s = startedHand();
    const tile = s.hands[0][0]!;
    s = reduce(s, { t: 'discard', seat: 0, tile }).state;
    s = reduce(s, { t: 'declareClaim', seat: 1, claim: { kind: 'pass' } }).state;
    s = reduce(s, { t: 'declareClaim', seat: 2, claim: { kind: 'pass' } }).state;
    s = reduce(s, { t: 'declareClaim', seat: 3, claim: { kind: 'pass' } }).state;
    s = reduce(s, { t: 'resolveClaims', nowMs: Date.now() }).state;
    expect(s.phase).toBe('turn');
    expect(s.turn).toBe(1);
    expect(s.hasDrawn).toBe(false);
  });

  it('draw + discard cycle conserves tiles', () => {
    let s = startedHand(2);
    s = reduce(s, { t: 'discard', seat: 0, tile: s.hands[0][0]! }).state;
    s = reduce(s, { t: 'declareClaim', seat: 1, claim: { kind: 'pass' } }).state;
    s = reduce(s, { t: 'declareClaim', seat: 2, claim: { kind: 'pass' } }).state;
    s = reduce(s, { t: 'declareClaim', seat: 3, claim: { kind: 'pass' } }).state;
    s = reduce(s, { t: 'resolveClaims', nowMs: Date.now() }).state;
    s = reduce(s, { t: 'draw', seat: 1 }).state;
    expect(s.hasDrawn).toBe(true);
    expect(s.hands[1].length).toBe(14);
    assertTileConservation(s);
  });
});
