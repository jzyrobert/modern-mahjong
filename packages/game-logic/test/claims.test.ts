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

  it('property: highest-priority kind always wins', () => {
    const priority = { hu: 3, peng: 2, gong: 2, chi: 1, pass: 0 } as const;
    const claims: import('../src/index.js').Claim[] = [
      { kind: 'pass' },
      { kind: 'chi', with: [tile(1), tile(1)] },
      { kind: 'peng' },
      { kind: 'gong' },
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
  void seat;
  return {
    ...emptyState(DEFAULT_RULES),
    phase: 'awaitingClaims',
    hands: { 0: [], 1: [], 2: [], 3: [], [seat]: hand } as GameState['hands'],
    lastDiscard,
    pendingClaims: { discard: lastDiscard, deadlineMs: 0, submitted: {} },
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

  it('pre-fills `submitted` with passes for non-discarder seats with no meaningful claim', () => {
    // Seat 0 discards East. Seats 1/2/3 hold no copies of East and no
    // peng/chi candidates against East (it's an honor — chi impossible),
    // so the engine should pre-pass every non-discarder seat.
    const east = honor('E');
    const state = buildState([east, ...fillerForSeat(0, 13)], {
      1: fillerForSeat(1, 13),
      2: fillerForSeat(2, 13),
      3: fillerForSeat(3, 13),
    });
    const east0 = state.hands[0].find((t) => sameFace(t, east))!;
    const { state: after } = reduce(state, { t: 'discard', seat: 0, tile: east0 });

    expect(after.phase).toBe('awaitingClaims');
    const sub = after.pendingClaims!.submitted;
    expect(sub[1]?.kind).toBe('pass');
    expect(sub[2]?.kind).toBe('pass');
    expect(sub[3]?.kind).toBe('pass');
    // Discarder is never in `submitted`.
    expect(sub[0]).toBeUndefined();
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
    const east = honor('E');
    const state = buildState([east, ...fillerForSeat(0, 13)], {
      1: fillerForSeat(1, 13),
      2: fillerForSeat(2, 13),
      3: fillerForSeat(3, 13),
    });
    const east0 = state.hands[0].find((t) => sameFace(t, east))!;
    const { state: after } = reduce(state, { t: 'discard', seat: 0, tile: east0 });
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

  it('does NOT auto-resolve at discard time in multiplayer even when all pre-passed', () => {
    // Multiplayer keeps the soft floor — `pendingClaims` stays
    // populated for the UI cue + server alarm even when nobody can
    // possibly claim.
    const east = honor('E');
    const state = buildState(
      [east, ...fillerForSeat(0, 13)],
      { 1: fillerForSeat(1, 13), 2: fillerForSeat(2, 13), 3: fillerForSeat(3, 13) },
    );
    const east0 = state.hands[0].find((t) => sameFace(t, east))!;
    const { state: after } = reduce(state, { t: 'discard', seat: 0, tile: east0 });
    expect(after.phase).toBe('awaitingClaims');
    const sub = after.pendingClaims!.submitted;
    expect(sub[1]?.kind).toBe('pass');
    expect(sub[2]?.kind).toBe('pass');
    expect(sub[3]?.kind).toBe('pass');
  });

  it('declareClaim does NOT auto-resolve before soft floor in multiplayer', () => {
    const south = honor('S');
    const state = buildState([south, ...fillerForSeat(0, 13)], {
      1: [south, south, ...fillerForSeat(1, 11)],
      2: fillerForSeat(2, 13),
      3: fillerForSeat(3, 13),
    });
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
    expect(afterClaim.phase).toBe('awaitingClaims'); // still pending
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

void SEATS; // exported for completeness; tests above don't reference directly
