import { describe, expect, it } from 'vitest';
import {
  type ClaimRound,
  DEFAULT_RULES,
  type GameState,
  SEATS,
  type Seat,
  type Tile,
  assertTileConservation,
  buildWall,
  chiOptions,
  emptyState,
  hasMeaningfulClaim,
  reduce,
  resolveClaims,
  sameFace,
  tileId,
} from '../src/index.js';

const tile = (rank: 1 | 5 | 9): { kind: 'suit'; suit: 'man'; rank: typeof rank; copy: 0 } => ({
  kind: 'suit',
  suit: 'man',
  rank,
  copy: 0,
});

function round(
  submitted: Partial<Record<Seat, import('../src/index.js').Claim>>,
  from: Seat = 0,
): ClaimRound {
  return {
    discard: { tile: tile(5), from },
    deadlineMs: 9999,
    submitted,
  };
}

describe('claim resolution', () => {
  it('all-pass produces pass', () => {
    const r = resolveClaims(
      round({ 1: { kind: 'pass' }, 2: { kind: 'pass' }, 3: { kind: 'pass' } }),
    );
    expect(r.kind).toBe('pass');
  });

  it('hu beats peng', () => {
    const r = resolveClaims(round({ 1: { kind: 'peng' }, 2: { kind: 'hu' } }));
    expect(r.kind).toBe('win');
    if (r.kind === 'win') {
      expect(r.seat).toBe(2);
      expect(r.claim.kind).toBe('hu');
    }
  });

  it('peng beats chi', () => {
    const r = resolveClaims(
      round({ 1: { kind: 'chi', with: [tile(1), tile(1)] }, 2: { kind: 'peng' } }, 0),
    );
    expect(r.kind).toBe('win');
    if (r.kind === 'win') {
      expect(r.claim.kind).toBe('peng');
    }
  });

  it('chi only legal for next seat', () => {
    // discard from 0; chi declared by seat 2 (not next) — should be ignored.
    const r = resolveClaims(round({ 2: { kind: 'chi', with: [tile(1), tile(1)] } }, 0));
    expect(r.kind).toBe('pass');
  });

  it('two simultaneous hu picks closest CCW', () => {
    // discard from seat 0; seats 1 and 3 both call hu.
    // CCW distance: 1 → 1, 3 → 3. Seat 1 wins.
    const r = resolveClaims(round({ 1: { kind: 'hu' }, 3: { kind: 'hu' } }, 0));
    expect(r.kind).toBe('win');
    if (r.kind === 'win') {
      expect(r.seat).toBe(1);
    }
  });

  it('chiOptions enumerates the legal completions for the discard', () => {
    const m = (rank: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9): Tile => ({
      kind: 'suit',
      suit: 'man',
      rank,
      copy: 0,
    });

    // Discard 5m, hand has 3m,4m,6m,7m: three runs available
    //   3-4-5, 4-5-6, 5-6-7
    expect(chiOptions([m(3), m(4), m(6), m(7)], m(5))).toHaveLength(3);

    // Discard 1m, hand has 2m,3m: only one run (1-2-3)
    expect(chiOptions([m(2), m(3)], m(1))).toHaveLength(1);

    // Discard 9m, hand has 7m,8m: only one run (7-8-9)
    expect(chiOptions([m(7), m(8)], m(9))).toHaveLength(1);

    // Mixed suit: discard 5m vs hand of 3p,4p — no chi (different suit)
    const p = (rank: 3 | 4): Tile => ({ kind: 'suit', suit: 'pin', rank, copy: 0 });
    expect(chiOptions([p(3), p(4)], m(5))).toHaveLength(0);

    // Honor discard never yields chi options.
    const honor: Tile = { kind: 'honor', honor: 'E', copy: 0 };
    expect(chiOptions([m(2), m(3)], honor)).toHaveLength(0);
  });

  it('hasMeaningfulClaim returns false on honor discards for non-pair holders', () => {
    const m = (rank: 1 | 9): Tile => ({ kind: 'suit', suit: 'man', rank, copy: 0 });
    const east: Tile = { kind: 'honor', honor: 'E', copy: 0 };
    const south: Tile = { kind: 'honor', honor: 'S', copy: 0 };
    const state = pseudoAwaitingClaims({
      hand: [m(1), m(9), east],
      lastDiscard: { tile: south, from: 0 },
      seat: 1,
    });
    expect(hasMeaningfulClaim(state, 1, south)).toBe(false);
  });

  it('hasMeaningfulClaim returns true when seat can peng', () => {
    const m = (rank: 5): Tile => ({ kind: 'suit', suit: 'man', rank, copy: 0 });
    const state = pseudoAwaitingClaims({
      hand: [m(5), m(5), { kind: 'honor', honor: 'E', copy: 0 }],
      lastDiscard: { tile: m(5), from: 0 },
      seat: 1,
    });
    expect(hasMeaningfulClaim(state, 1, m(5))).toBe(true);
  });

  it('hasMeaningfulClaim returns false for a shape-winning hand below faanMin', () => {
    // Seat 2's 13-tile hand completes on a 7p with the canonical 1-faan
    // 平和 shape (all sequences, non-yakuhai pair):
    //   1m2m3m 2m3m4m 4p5p6p 7s8s9s + 7p7p (pair completed by discard)
    // We dial the floor up to 3 explicitly — `DEFAULT_RULES` now ships
    // with `faanMin: 0` so every shape-win passes, but this test's
    // whole point is to verify the bar is suppressed when the floor
    // would silently demote the hu via `canFinalizeHu`. Otherwise
    // the user sees CLAIM? with PASS as the only option (a forced
    // no-op). Seat 2 (not next after the discarder at seat 0) so the
    // 5-6-7p chi isn't legal — otherwise the legal-claim branch
    // would short-circuit before the faan check matters.
    const t = (suit: 'man' | 'pin' | 'sou', rank: number, copy = 0): Tile => ({
      kind: 'suit',
      suit,
      rank: rank as 1,
      copy: copy as 0,
    });
    const sevenP = t('pin', 7);
    const baseline = pseudoAwaitingClaims({
      hand: [
        t('man', 1),
        t('man', 2),
        t('man', 3),
        t('man', 2, 1),
        t('man', 3, 1),
        t('man', 4),
        t('pin', 4),
        t('pin', 5),
        t('pin', 6),
        t('sou', 7),
        t('sou', 8),
        t('sou', 9),
        t('pin', 7, 1),
      ],
      lastDiscard: { tile: sevenP, from: 0 },
      seat: 2,
    });
    const state = { ...baseline, rules: { ...baseline.rules, faanMin: 3 as const } };
    expect(hasMeaningfulClaim(state, 2, sevenP)).toBe(false);
  });

  it('hasMeaningfulClaim returns true for a shape-winning hand at or above faanMin', () => {
    // Same skeleton as above but with `faanMin: 1` so the 1-faan win
    // is legal — the bar must surface so the user can declare Win.
    const t = (suit: 'man' | 'pin' | 'sou', rank: number, copy = 0): Tile => ({
      kind: 'suit',
      suit,
      rank: rank as 1,
      copy: copy as 0,
    });
    const sevenP = t('pin', 7);
    const baseline = pseudoAwaitingClaims({
      hand: [
        t('man', 1),
        t('man', 2),
        t('man', 3),
        t('man', 2, 1),
        t('man', 3, 1),
        t('man', 4),
        t('pin', 4),
        t('pin', 5),
        t('pin', 6),
        t('sou', 7),
        t('sou', 8),
        t('sou', 9),
        t('pin', 7, 1),
      ],
      lastDiscard: { tile: sevenP, from: 0 },
      seat: 2,
    });
    const state = { ...baseline, rules: { ...baseline.rules, faanMin: 1 as const } };
    expect(hasMeaningfulClaim(state, 2, sevenP)).toBe(true);
  });

  it('property: highest-priority kind always wins', () => {
    const priority = { hu: 3, peng: 2, gang: 2, chi: 1, pass: 0 } as const;
    const claims: import('../src/index.js').Claim[] = [
      { kind: 'pass' },
      { kind: 'chi', with: [tile(1), tile(1)] },
      { kind: 'peng' },
      { kind: 'gang' },
      { kind: 'hu' },
    ];

    for (let a = 0; a < claims.length; a++) {
      for (let b = 0; b < claims.length; b++) {
        for (let c = 0; c < claims.length; c++) {
          // Use seats 1 (next), 2, 3 against discard from 0.
          const r = resolveClaims(round({ 1: claims[a]!, 2: claims[b]!, 3: claims[c]! }, 0));
          const top = Math.max(
            priority[claims[a]!.kind],
            priority[claims[b]!.kind],
            priority[claims[c]!.kind],
          );
          if (top === 0) {
            expect(r.kind).toBe('pass');
          } else {
            // Chi only for seat 1 (next); skip cases where the only claim is chi from non-next seats.
            const chiFromOnlySource =
              top === 1 &&
              (claims[b]!.kind === 'chi' || claims[c]!.kind === 'chi') &&
              claims[a]!.kind !== 'chi';
            if (chiFromOnlySource) continue;
            expect(r.kind).toBe('win');
          }
        }
      }
    }
  });
});

function pseudoAwaitingClaims({
  hand,
  lastDiscard,
  seat,
}: {
  hand: Tile[];
  lastDiscard: { tile: Tile; from: Seat };
  seat: Seat;
}): GameState {
  // Wall has at least one tile so `scoreHand` doesn't trip the
  // 海底撈月 (last-tile / sea-bottom) bonus. The exact contents
  // don't matter — scoring only inspects `wall.length`.
  const wallFiller = buildWall().slice(0, 1);
  return {
    ...emptyState(DEFAULT_RULES),
    phase: 'awaitingClaims',
    hands: { 0: [], 1: [], 2: [], 3: [], [seat]: hand } as GameState['hands'],
    lastDiscard,
    pendingClaims: { discard: lastDiscard, deadlineMs: 0, submitted: {} },
    wall: wallFiller,
  };
}

/**
 * Engine integration tests for the discard reducer's pre-pass behavior
 * + the auto-resolve gate inside `declareClaim`. The new claim ladder
 * (3s soft floor / 12s hard fallback) lives entirely in
 * `actions.ts:discard`/`declareClaim`; these tests pin the contract
 * the server + client both rely on.
 */
describe('discard reducer — pre-pass + auto-resolve', () => {
  function suit(s: 'man' | 'pin' | 'sou', rank: number): Tile {
    return { kind: 'suit', suit: s, rank: rank as 1, copy: 0 };
  }

  function honor(h: 'E' | 'S' | 'W' | 'N' | 'Z' | 'F' | 'B'): Tile {
    return { kind: 'honor', honor: h, copy: 0 };
  }

  /**
   * Build a contrived `awaitingClaims`-ready state by hand-placing tiles.
   * `seat0Hand` is the 14-tile hand of the about-to-discard seat 0;
   * each other seat gets a hand from `otherHands`.
   */
  function buildState(
    seat0Hand: Tile[],
    otherHands: { 1: Tile[]; 2: Tile[]; 3: Tile[] },
    rules = DEFAULT_RULES,
  ): GameState {
    const pool = [...buildWall()];
    function takeFace(target: Tile): Tile {
      const i = pool.findIndex((t) => sameFace(t, target));
      if (i < 0) throw new Error(`pool exhausted for ${tileId(target)}`);
      return pool.splice(i, 1)[0]!;
    }
    const hand0 = seat0Hand.map(takeFace);
    const hand1 = otherHands[1].map(takeFace);
    const hand2 = otherHands[2].map(takeFace);
    const hand3 = otherHands[3].map(takeFace);
    const remainder = pool;
    const deadWall = remainder.splice(remainder.length - 14, 14);
    const wall = remainder;
    const state: GameState = {
      ...emptyState(rules),
      phase: 'turn',
      turn: 0,
      hasDrawn: true,
      hands: { 0: hand0, 1: hand1, 2: hand2, 3: hand3 },
      wall,
      deadWall,
    };
    assertTileConservation(state);
    return state;
  }

  // Filler that pulls from a fresh slice of the pool each seat — keeps
  // hands disjoint and avoids the 4-copies-per-face cap. Per-seat
  // offsets ensure no accidental peng/chi overlap with seat 1 in the
  // tests that need seat 1 to peng a specific face.
  const SUITS = ['man', 'pin', 'sou'] as const;
  function fillerForSeat(seatIdx: number, n: number): Tile[] {
    return Array.from({ length: n }, (_, i) => {
      const idx = seatIdx * 13 + i;
      const s = SUITS[idx % 3]!;
      const rank = ((Math.floor(idx / 3) % 9) + 1) as 1;
      return suit(s, rank);
    });
  }

  it('pre-passes non-claim seats but leaves a peng-eligible seat pending', () => {
    // Seat 1 holds 2× South (so peng is legal on a South discard).
    // Seats 2/3 hold no South copies and no chi candidates against an
    // honor — pre-pass should pre-fill them, leaving seat 1 pending.
    const south = honor('S');
    const state = buildState([south, ...fillerForSeat(0, 13)], {
      1: [south, south, ...fillerForSeat(1, 11)],
      2: fillerForSeat(2, 13),
      3: fillerForSeat(3, 13),
    });
    const south0 = state.hands[0].find((t) => sameFace(t, south))!;
    const { state: after } = reduce(state, { t: 'discard', seat: 0, tile: south0 });

    expect(after.phase).toBe('awaitingClaims');
    const sub = after.pendingClaims!.submitted;
    // Seat 1 has a meaningful peng claim — left pending.
    expect(sub[1]).toBeUndefined();
    expect(sub[2]?.kind).toBe('pass');
    expect(sub[3]?.kind).toBe('pass');
    // Discarder is never in `submitted`.
    expect(sub[0]).toBeUndefined();
  });

  it('auto-resolves the round when every non-discarder seat is pre-passed (multiplayer)', () => {
    // Seat 0 discards East. Seats 1/2/3 hold no copies of East and no
    // peng/chi candidates against an honor, so the engine pre-passes
    // every non-discarder seat and now folds the resolution into the
    // same reduce — even with the multiplayer fairness gate armed.
    // Without this, every "uninteresting" discard parked the table at
    // `phase: 'awaitingClaims'` for `claimWindowMs` of dead air.
    const east = honor('E');
    const state = buildState([east, ...fillerForSeat(0, 13)], {
      1: fillerForSeat(1, 13),
      2: fillerForSeat(2, 13),
      3: fillerForSeat(3, 13),
    });
    const east0 = state.hands[0].find((t) => sameFace(t, east))!;
    const { state: after, events } = reduce(state, { t: 'discard', seat: 0, tile: east0 });

    expect(after.phase).toBe('turn');
    expect(after.turn).toBe(1);
    expect(after.pendingClaims).toBeUndefined();
    // Both lifecycle events still emit so the GameLog / replay log
    // see "claim window opened → all passed" rather than a blink.
    expect(events.some((e) => e.t === 'claimsOpened')).toBe(true);
    expect(events.some((e) => e.t === 'claimsResolved')).toBe(true);
  });

  it('leaves a peng-eligible seat as pending in `submitted`', () => {
    // Seat 1 holds 2× sou-1 (rare in the filler slices, so this is
    // unique to seat 1). Seat 0 discards a sou-1. Pre-pass should
    // pre-fill seats 2/3 but leave seat 1 pending.
    const south = honor('S');
    const state = buildState([south, ...fillerForSeat(0, 13)], {
      1: [south, south, ...fillerForSeat(1, 11)],
      2: fillerForSeat(2, 13),
      3: fillerForSeat(3, 13),
    });
    const southDiscard = state.hands[0].find((t) => sameFace(t, south))!;
    const { state: after } = reduce(state, { t: 'discard', seat: 0, tile: southDiscard });

    expect(after.pendingClaims!.submitted[1]).toBeUndefined();
    expect(after.pendingClaims!.submitted[2]?.kind).toBe('pass');
    expect(after.pendingClaims!.submitted[3]?.kind).toBe('pass');
  });

  it('populates `softExpiryMs` and `hardDeadlineMs` from rules when set', () => {
    // Use a peng-able discard so the window stays open and
    // `pendingClaims` is observable; an all-pre-passed window now
    // auto-resolves and clears `pendingClaims` before we can inspect
    // it.
    const south = honor('S');
    const state = buildState([south, ...fillerForSeat(0, 13)], {
      1: [south, south, ...fillerForSeat(1, 11)],
      2: fillerForSeat(2, 13),
      3: fillerForSeat(3, 13),
    });
    const south0 = state.hands[0].find((t) => sameFace(t, south))!;
    const { state: after } = reduce(state, { t: 'discard', seat: 0, tile: south0 });
    const c = after.pendingClaims!;
    expect(c.softExpiryMs).toBeDefined();
    expect(c.hardDeadlineMs).toBeDefined();
    expect(c.softExpiryMs!).toBeGreaterThan(c.deadlineMs);
    expect(c.hardDeadlineMs!).toBeGreaterThan(c.softExpiryMs!);
  });

  it('omits `softExpiryMs` and `hardDeadlineMs` when rules opt out (solo)', () => {
    // Use a peng-able discard so the round doesn't auto-resolve via
    // the "all pre-passed in solo" path — we want to inspect
    // `pendingClaims` mid-window.
    const soloRules = {
      ...DEFAULT_RULES,
      claimSoftWindowMs: undefined,
      claimHardWindowMs: undefined,
    };
    const south = honor('S');
    const state = buildState(
      [south, ...fillerForSeat(0, 13)],
      {
        1: [south, south, ...fillerForSeat(1, 11)],
        2: fillerForSeat(2, 13),
        3: fillerForSeat(3, 13),
      },
      soloRules,
    );
    const southDiscard = state.hands[0].find((t) => sameFace(t, south))!;
    const { state: after } = reduce(state, { t: 'discard', seat: 0, tile: southDiscard });
    const c = after.pendingClaims!;
    expect(c.softExpiryMs).toBeUndefined();
    expect(c.hardDeadlineMs).toBeUndefined();
  });

  it('auto-resolves at discard time when every seat is pre-passed (solo)', () => {
    const soloRules = {
      ...DEFAULT_RULES,
      claimSoftWindowMs: undefined,
      claimHardWindowMs: undefined,
    };
    const east = honor('E');
    const state = buildState(
      [east, ...fillerForSeat(0, 13)],
      { 1: fillerForSeat(1, 13), 2: fillerForSeat(2, 13), 3: fillerForSeat(3, 13) },
      soloRules,
    );
    const east0 = state.hands[0].find((t) => sameFace(t, east))!;
    const { state: after } = reduce(state, { t: 'discard', seat: 0, tile: east0 });
    expect(after.phase).toBe('turn');
    expect(after.pendingClaims).toBeUndefined();
  });

  it('declareClaim auto-resolves the moment every seat is submitted, even pre-soft-floor', () => {
    // The soft floor used to gate this — multiplayer would park the
    // table at `phase: 'awaitingClaims'` for the rest of
    // `claimWindowMs` even after every seat had explicitly weighed
    // in. The floor now only gates the *alarm* path (auto-passing a
    // silent human); a complete `submitted` set short-circuits to
    // resolution.
    const south = honor('S');
    const state = buildState([south, ...fillerForSeat(0, 13)], {
      1: [south, south, ...fillerForSeat(1, 11)],
      2: fillerForSeat(2, 13),
      3: fillerForSeat(3, 13),
    });
    const southDiscard = state.hands[0].find((t) => sameFace(t, south))!;
    const { state: discarded } = reduce(state, { t: 'discard', seat: 0, tile: southDiscard });
    // Park the soft floor far in the future so we can prove it's
    // genuinely no longer gating the auto-resolve.
    const futureState = {
      ...discarded,
      pendingClaims: {
        ...discarded.pendingClaims!,
        deadlineMs: Date.now() + 60_000,
      },
    } as GameState;
    const { state: afterClaim } = reduce(futureState, {
      t: 'declareClaim',
      seat: 1,
      claim: { kind: 'pass' },
    });
    expect(afterClaim.phase).toBe('turn');
    expect(afterClaim.turn).toBe(1);
    expect(afterClaim.pendingClaims).toBeUndefined();
  });

  it('declareClaim auto-resolves once past soft floor + all submitted', () => {
    const south = honor('S');
    const state = buildState([south, ...fillerForSeat(0, 13)], {
      1: [south, south, ...fillerForSeat(1, 11)],
      2: fillerForSeat(2, 13),
      3: fillerForSeat(3, 13),
    });
    const southDiscard = state.hands[0].find((t) => sameFace(t, south))!;
    const { state: discarded } = reduce(state, { t: 'discard', seat: 0, tile: southDiscard });
    const pastState = {
      ...discarded,
      pendingClaims: {
        ...discarded.pendingClaims!,
        deadlineMs: Date.now() - 1,
      },
    } as GameState;
    const { state: afterClaim } = reduce(pastState, {
      t: 'declareClaim',
      seat: 1,
      claim: { kind: 'pass' },
    });
    expect(afterClaim.phase).toBe('turn');
    expect(afterClaim.pendingClaims).toBeUndefined();
  });

  it('declareClaim rejects a differing re-submission from the same seat', () => {
    // Peng → pass overwrite would let a seat that already locked in a
    // meaningful claim downgrade themselves to a pass before
    // resolution. The engine guard catches this even if the client's
    // own "hide ClaimBar after submit" gate is bypassed.
    //
    // Construct an `awaitingClaims` state directly with two peng-eligible
    // seats so the round doesn't auto-resolve after seat 1's peng —
    // leaving a window in which we can attempt to overwrite seat 1 and
    // assert it throws while the state is still observable. (Going
    // through the `discard` reducer here would pull conflicting copies
    // of the same face through `fillerForSeat` and exhaust the pool.)
    const fiveM = suit('man', 5);
    const partial = emptyState(DEFAULT_RULES);
    const state: GameState = {
      ...partial,
      phase: 'awaitingClaims',
      hasDrawn: false,
      drewThisTurn: false,
      turn: 0,
      hands: {
        0: [],
        1: [fiveM, fiveM, ...fillerForSeat(1, 11)],
        2: [fiveM, fiveM, ...fillerForSeat(2, 11)],
        3: fillerForSeat(3, 13),
      },
      lastDiscard: { tile: fiveM, from: 0 },
      pendingClaims: {
        discard: { tile: fiveM, from: 0 },
        deadlineMs: Date.now() + 60_000,
        submitted: { 3: { kind: 'pass' } },
      },
    };
    const { state: afterPeng } = reduce(state, {
      t: 'declareClaim',
      seat: 1,
      claim: { kind: 'peng' },
    });
    expect(afterPeng.phase).toBe('awaitingClaims');
    expect(afterPeng.pendingClaims?.submitted[1]).toEqual({ kind: 'peng' });
    expect(() =>
      reduce(afterPeng, { t: 'declareClaim', seat: 1, claim: { kind: 'pass' } }),
    ).toThrow(/already submitted a different claim/);
    // State unchanged after the throw — the original peng is still on
    // file and the round is still parked at awaitingClaims.
    expect(afterPeng.pendingClaims?.submitted[1]).toEqual({ kind: 'peng' });
  });

  it('declareClaim treats a duplicate identical claim as a no-op', () => {
    // The discard reducer pre-fills `submitted[seat] = pass` for
    // seats with no meaningful claim. Tests + deterministic
    // resolution flows occasionally re-submit the same pass
    // explicitly; that needs to stay idempotent rather than throw.
    const south = honor('S');
    const state = buildState([south, ...fillerForSeat(0, 13)], {
      1: [south, south, ...fillerForSeat(1, 11)],
      2: fillerForSeat(2, 13),
      3: fillerForSeat(3, 13),
    });
    const southDiscard = state.hands[0].find((t) => sameFace(t, south))!;
    const { state: discarded } = reduce(state, { t: 'discard', seat: 0, tile: southDiscard });
    // Seats 2 + 3 hold filler, so the reducer pre-passed them.
    expect(discarded.pendingClaims?.submitted[2]).toEqual({ kind: 'pass' });
    expect(() =>
      reduce(discarded, { t: 'declareClaim', seat: 2, claim: { kind: 'pass' } }),
    ).not.toThrow();
    const { state: afterDupe } = reduce(discarded, {
      t: 'declareClaim',
      seat: 2,
      claim: { kind: 'pass' },
    });
    // Idempotent — no auto-resolution from a duplicate pass alone.
    expect(afterDupe.phase).toBe('awaitingClaims');
    expect(afterDupe.pendingClaims?.submitted[2]).toEqual({ kind: 'pass' });
  });

  it('declareClaim auto-resolves immediately in solo (no fairness gate)', () => {
    const soloRules = {
      ...DEFAULT_RULES,
      claimSoftWindowMs: undefined,
      claimHardWindowMs: undefined,
    };
    const south = honor('S');
    const state = buildState(
      [south, ...fillerForSeat(0, 13)],
      {
        1: [south, south, ...fillerForSeat(1, 11)],
        2: fillerForSeat(2, 13),
        3: fillerForSeat(3, 13),
      },
      soloRules,
    );
    const southDiscard = state.hands[0].find((t) => sameFace(t, south))!;
    const { state: discarded } = reduce(state, { t: 'discard', seat: 0, tile: southDiscard });
    const futureState = {
      ...discarded,
      pendingClaims: {
        ...discarded.pendingClaims!,
        deadlineMs: Date.now() + 60_000,
      },
    } as GameState;
    const { state: afterClaim } = reduce(futureState, {
      t: 'declareClaim',
      seat: 1,
      claim: { kind: 'pass' },
    });
    expect(afterClaim.phase).toBe('turn'); // resolved despite future deadline
  });
});

/**
 * `drewThisTurn` flag flows. The field is `true` only when the
 * current `hasDrawn: true` state was reached via a real wall /
 * dead-wall draw — never via a chi or peng claim, where `hasDrawn`
 * is set so the claimer must discard but no tile is actually drawn.
 * `declareWin(selfDraw: true)` consults the flag so chi/peng-completed
 * shapes can't pick up the 自摸 +1 faan bonus.
 */
describe('drewThisTurn flag', () => {
  function suit(s: 'man' | 'pin' | 'sou', rank: number): Tile {
    return { kind: 'suit', suit: s, rank: rank as 1, copy: 0 };
  }

  function build(seat1Hand: Tile[], lastDiscardTile: Tile): GameState {
    const pool = [...buildWall()];
    function takeFace(target: Tile): Tile {
      const i = pool.findIndex((t) => sameFace(t, target));
      if (i < 0) throw new Error(`pool exhausted for ${tileId(target)}`);
      return pool.splice(i, 1)[0]!;
    }
    const seat1 = seat1Hand.map(takeFace);
    // Three fillers so the assertTileConservation invariant holds.
    const seat0 = Array.from({ length: 13 }, () => pool.pop()!);
    const seat2 = Array.from({ length: 13 }, () => pool.pop()!);
    const seat3 = Array.from({ length: 13 }, () => pool.pop()!);
    const deadWall = pool.splice(pool.length - 14, 14);
    const wall = pool;
    return {
      ...emptyState(DEFAULT_RULES),
      phase: 'awaitingClaims',
      hasDrawn: false,
      drewThisTurn: false,
      turn: 0,
      hands: { 0: seat0, 1: seat1, 2: seat2, 3: seat3 },
      wall,
      deadWall,
      lastDiscard: { tile: lastDiscardTile, from: 0 },
      // Pre-pass seats 2 + 3 so seat 1's submission auto-resolves
      // (the discard reducer would do the same pre-pass for any seat
      // with no meaningful claim against this tile).
      pendingClaims: {
        discard: { tile: lastDiscardTile, from: 0 },
        deadlineMs: 0,
        submitted: { 2: { kind: 'pass' }, 3: { kind: 'pass' } },
      },
    };
  }

  it('chi claim leaves drewThisTurn=false (claimer must discard, no draw)', () => {
    const fourM = suit('man', 4);
    const fiveM = suit('man', 5);
    const sixM = suit('man', 6);
    const state = build(
      [fourM, sixM, ...Array.from({ length: 11 }, (_, i) => suit('pin', (i % 9) + 1))],
      fiveM,
    );
    const fourInHand = state.hands[1].find((t) => sameFace(t, fourM))!;
    const sixInHand = state.hands[1].find((t) => sameFace(t, sixM))!;
    const { state: after } = reduce(state, {
      t: 'declareClaim',
      seat: 1,
      claim: { kind: 'chi', with: [fourInHand, sixInHand] },
    });
    expect(after.phase).toBe('turn');
    expect(after.turn).toBe(1);
    expect(after.hasDrawn).toBe(true); // claimer must discard
    expect(after.drewThisTurn).toBe(false); // but no real draw happened
  });

  it('peng claim leaves drewThisTurn=false (same reason)', () => {
    const fiveM = suit('man', 5);
    const state = build(
      [
        { ...fiveM, copy: 0 },
        { ...fiveM, copy: 1 },
        ...Array.from({ length: 11 }, (_, i) => suit('pin', (i % 9) + 1)),
      ],
      { ...fiveM, copy: 2 },
    );
    const { state: after } = reduce(state, {
      t: 'declareClaim',
      seat: 1,
      claim: { kind: 'peng' },
    });
    expect(after.phase).toBe('turn');
    expect(after.hasDrawn).toBe(true);
    expect(after.drewThisTurn).toBe(false);
  });

  it('exposed-gang claim leaves drewThisTurn=true (replacement comes from dead wall)', () => {
    const fiveM = suit('man', 5);
    const state = build(
      [
        { ...fiveM, copy: 0 },
        { ...fiveM, copy: 1 },
        { ...fiveM, copy: 2 },
        ...Array.from({ length: 10 }, (_, i) => suit('pin', (i % 9) + 1)),
      ],
      { ...fiveM, copy: 3 },
    );
    const { state: after } = reduce(state, {
      t: 'declareClaim',
      seat: 1,
      claim: { kind: 'gang' },
    });
    expect(after.phase).toBe('turn');
    expect(after.hasDrawn).toBe(true);
    // Gang-exposed pulls a replacement from the dead wall — counts as
    // a real draw for tsumo purposes (any subsequent win scores
    // 槓上開花).
    expect(after.drewThisTurn).toBe(true);
  });

  it('declareWin(selfDraw=true) rejects a chi/peng-claimed shape with STATE error', () => {
    // Hand-craft the post-chi state shape directly: phase=turn,
    // hasDrawn=true, drewThisTurn=false, with a winning concealed
    // hand. The exact tiles don't matter for the guard — `declareWin`
    // checks `drewThisTurn` before shape/faan/scoring.
    const wallFiller = buildWall().slice(0, 1);
    const minimalWinning: Tile[] = [
      suit('man', 1),
      suit('man', 2),
      suit('man', 3),
      suit('man', 1),
      suit('man', 2),
      suit('man', 3),
      suit('pin', 1),
      suit('pin', 2),
      suit('pin', 3),
      suit('sou', 1),
      suit('sou', 2),
      suit('sou', 3),
      suit('man', 5),
      suit('man', 5),
    ];
    const baseState: GameState = {
      ...emptyState({ ...DEFAULT_RULES, faanMin: 0 }),
      phase: 'turn',
      turn: 1,
      hasDrawn: true,
      drewThisTurn: false, // entered via claim, not draw
      hands: { 0: [], 1: minimalWinning, 2: [], 3: [] },
      wall: wallFiller,
    };
    expect(() => reduce(baseState, { t: 'declareWin', seat: 1, selfDraw: true })).toThrow(
      /self-draw win requires a real draw/,
    );
  });

  it('declareWin(selfDraw=true) accepts the same shape when drewThisTurn=true', () => {
    const wallFiller = buildWall().slice(0, 1);
    const winning: Tile[] = [
      suit('man', 1),
      suit('man', 2),
      suit('man', 3),
      suit('man', 1),
      suit('man', 2),
      suit('man', 3),
      suit('pin', 1),
      suit('pin', 2),
      suit('pin', 3),
      suit('sou', 1),
      suit('sou', 2),
      suit('sou', 3),
      suit('man', 5),
      suit('man', 5),
    ];
    const baseState: GameState = {
      ...emptyState({ ...DEFAULT_RULES, faanMin: 0 }),
      phase: 'turn',
      turn: 1,
      hasDrawn: true,
      drewThisTurn: true,
      hands: { 0: [], 1: winning, 2: [], 3: [] },
      wall: wallFiller,
    };
    const { state: after } = reduce(baseState, { t: 'declareWin', seat: 1, selfDraw: true });
    expect(after.phase).toBe('resolved');
    expect(after.lastResult?.kind).toBe('win');
  });
});

void SEATS; // exported for completeness; tests above don't reference directly
