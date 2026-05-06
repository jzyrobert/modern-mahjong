import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  type GameState,
  IllegalActionError,
  assertTileConservation,
  emptyState,
  reduce,
  sameFace,
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

  it('rejects chi from a seat that is not the next seat after the discarder', () => {
    // chi is only legal for the seat immediately counter-clockwise
    // from the discarder. Seat 0 discards → only seat 1 can chi.
    // Pre-fix the engine accepted the action and `resolveClaims`
    // silently filtered it out (returning kind:'pass'), which gave
    // a buggy / malicious client no feedback. Validating in
    // declareClaim turns the silent no-op into a typed error.
    let s = startedHand();
    const t = s.hands[0][0]!;
    s = reduce(s, { t: 'discard', seat: 0, tile: t }).state;
    expect(s.phase).toBe('awaitingClaims');

    // Pull two arbitrary suit tiles from seat 2's hand for the chi
    // `with` slot — the engine should reject the action on seat
    // eligibility before it even looks at the chi tiles, so any
    // pair works.
    const placeholder = s.hands[2].filter((x) => x.kind === 'suit').slice(0, 2);
    if (placeholder.length < 2) throw new Error('test setup: seat 2 has no suit tiles');
    expect(() =>
      reduce(s, {
        t: 'declareClaim',
        seat: 2,
        claim: { kind: 'chi', with: [placeholder[0]!, placeholder[1]!] },
      }),
    ).toThrow(IllegalActionError);
  });

  it('rejects peng from a seat that does not have two matching tiles', () => {
    // peng requires two same-face copies in the seat's hand. Without
    // that, the legalClaimsFor gate excludes peng, so submitting it
    // throws CLAIM. Pre-fix this would have been silently swallowed
    // (resolveClaims ignored peng claims that didn't match anywhere).
    let s = startedHand();
    const t = s.hands[0][0]!;
    s = reduce(s, { t: 'discard', seat: 0, tile: t }).state;
    expect(s.phase).toBe('awaitingClaims');

    // Find a seat whose hand DOESN'T contain two copies of the
    // discarded face. With seed 1 + dealer 0, at least one of seats
    // 1/2/3 has fewer than 2 matching copies in their initial 13.
    let mark = -1;
    for (const seat of [1, 2, 3] as const) {
      const matches = s.hands[seat].filter((x) => sameFace(x, t)).length;
      if (matches < 2) {
        mark = seat;
        break;
      }
    }
    if (mark < 0) throw new Error('test setup: every seat already has a peng on tile 0');
    expect(() =>
      reduce(s, { t: 'declareClaim', seat: mark as 1 | 2 | 3, claim: { kind: 'peng' } }),
    ).toThrow(IllegalActionError);
  });
});
