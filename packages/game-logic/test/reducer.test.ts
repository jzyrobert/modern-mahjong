import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  type GameState,
  IllegalActionError,
  SEATS,
  type Seat,
  type Tile,
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

/**
 * Find a tile in seat 0's hand that some other seat could PENG against
 * (i.e. another seat holds ≥2 copies of the same face). The engine now
 * auto-resolves the claim window the moment every non-discarder seat
 * was pre-passed — so tests that want to observe `awaitingClaims`,
 * exercise the declareClaim → resolveClaims cascade, or simulate a
 * silent peng opportunity need a discard at least one seat could
 * legally act on.
 */
function pickPengableDiscard(s: GameState): { tile: Tile; pengSeat: Seat } {
  for (const tile of s.hands[0]!) {
    for (const seat of SEATS) {
      if (seat === 0) continue;
      const copies = s.hands[seat].filter((t) => sameFace(t, tile)).length;
      if (copies >= 2) return { tile, pengSeat: seat };
    }
  }
  throw new Error('pickPengableDiscard: no peng-eligible discard available for seat 0');
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

describe('reducer — turn deadline', () => {
  it('startHand stamps turnDeadlineMs when the rule is on (DEFAULT_RULES)', () => {
    const before = Date.now();
    const s = startedHand();
    const after = Date.now();
    expect(s.turnDeadlineMs).toBeDefined();
    // Deadline lands somewhere in the [before, after] window plus the
    // 20s default; widen the upper bound by a few ms for slow CI.
    if (s.turnDeadlineMs !== undefined) {
      expect(s.turnDeadlineMs).toBeGreaterThanOrEqual(before + DEFAULT_RULES.turnTimeoutMs);
      expect(s.turnDeadlineMs).toBeLessThanOrEqual(after + DEFAULT_RULES.turnTimeoutMs + 5);
    }
  });

  it('startHand leaves turnDeadlineMs undefined when the rule is disabled', () => {
    const init = emptyState({ ...DEFAULT_RULES, turnTimeoutMs: 0 });
    const { state } = reduce(init, { t: 'startHand', seed: 1, dealer: 0 });
    expect(state.turnDeadlineMs).toBeUndefined();
  });

  it('discard clears turnDeadlineMs for the awaitingClaims phase', () => {
    // Discard a tile some other seat could peng so the window stays
    // open and we can observe the intermediate `awaitingClaims` phase
    // — an all-pre-passed discard now folds the resolve into the same
    // reduce and never parks in `awaitingClaims`.
    const s = startedHand();
    const { tile } = pickPengableDiscard(s);
    const { state: afterDiscard } = reduce(s, { t: 'discard', seat: 0, tile });
    expect(afterDiscard.phase).toBe('awaitingClaims');
    expect(afterDiscard.turnDeadlineMs).toBeUndefined();
  });

  it('all-pass resolution arms a fresh turnDeadlineMs for the next seat', () => {
    // Use a peng-able discard so the engine keeps the claim window
    // open through the declareClaim → resolveClaims cascade. With an
    // unclaimable discard the engine auto-resolves at discard time
    // and `declareClaim`s would throw PHASE.
    let s = startedHand();
    const { tile, pengSeat } = pickPengableDiscard(s);
    s = reduce(s, { t: 'discard', seat: 0, tile }).state;
    for (const seat of SEATS) {
      if (seat === 0 || seat !== pengSeat) continue;
      s = reduce(s, { t: 'declareClaim', seat, claim: { kind: 'pass' } }).state;
    }
    // After the peng-eligible seat passes, allIn becomes true and the
    // engine auto-resolves — but if we deliberately stop before that
    // (i.e. the seat hasn't submitted yet), we'd still need the
    // explicit resolveClaims. With my change, the seat's pass above
    // already folded in the resolve, so just verify the resolved
    // state.
    expect(s.phase).toBe('turn');
    expect(s.turn).toBe(1);
    const before = Date.now();
    // The deadline was stamped during the auto-resolve at the last
    // declareClaim, not at `before` — so just verify the field is
    // present and lands inside the default window relative to `now`.
    expect(s.turnDeadlineMs).toBeDefined();
    expect(s.turnDeadlineMs!).toBeGreaterThanOrEqual(before - 50);
    expect(s.turnDeadlineMs!).toBeLessThanOrEqual(before + DEFAULT_RULES.turnTimeoutMs + 50);
  });
});

describe('reducer — discard / claim', () => {
  it('discard moves a tile from hand to discards and opens claim window', () => {
    const s = startedHand();
    const { tile } = pickPengableDiscard(s);
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
    const { tile, pengSeat } = pickPengableDiscard(s);
    s = reduce(s, { t: 'discard', seat: 0, tile }).state;
    // Only the peng-eligible seat is still pending after pre-pass —
    // its explicit pass closes the window and triggers the
    // auto-resolve in `declareClaim`. Submitting passes for already-
    // pre-passed seats would throw, so just hit the pending one.
    s = reduce(s, { t: 'declareClaim', seat: pengSeat, claim: { kind: 'pass' } }).state;
    expect(s.phase).toBe('turn');
    expect(s.turn).toBe(1);
    expect(s.hasDrawn).toBe(false);
  });

  it('draw + discard cycle conserves tiles', () => {
    let s = startedHand(2);
    const { tile, pengSeat } = pickPengableDiscard(s);
    s = reduce(s, { t: 'discard', seat: 0, tile }).state;
    s = reduce(s, { t: 'declareClaim', seat: pengSeat, claim: { kind: 'pass' } }).state;
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
    const { tile } = pickPengableDiscard(s);
    s = reduce(s, { t: 'discard', seat: 0, tile }).state;
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
    const { tile, pengSeat } = pickPengableDiscard(s);
    s = reduce(s, { t: 'discard', seat: 0, tile }).state;
    expect(s.phase).toBe('awaitingClaims');

    // Find a non-eligible seat (≠ pengSeat) whose hand has < 2
    // matching copies, so legalClaimsFor excludes peng.
    let mark = -1;
    for (const seat of [1, 2, 3] as const) {
      if (seat === pengSeat) continue;
      const matches = s.hands[seat].filter((x) => sameFace(x, tile)).length;
      if (matches < 2) {
        mark = seat;
        break;
      }
    }
    if (mark < 0) throw new Error('test setup: no non-peng seat available');
    expect(() =>
      reduce(s, { t: 'declareClaim', seat: mark as 1 | 2 | 3, claim: { kind: 'peng' } }),
    ).toThrow(IllegalActionError);
  });
});
