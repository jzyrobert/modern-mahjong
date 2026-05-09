import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  type GameState,
  type Tile,
  assertTileConservation,
  buildWall,
  emptyState,
  reduce,
  sameFace,
  tileId,
} from '../src/index.js';

/**
 * Targeted "happy path" flow tests for the more complex action paths:
 *   - Concealed gang (4 in hand, draw replacement)
 *   - Win on discard (claim hu after another seat's discard)
 *
 * To stay deterministic without falling into duplicate-tile-copy traps, we
 * build a "tile pool" of all 136 tiles and pull face-matching copies from
 * it as needed; whatever's left becomes the wall.
 */

class TilePool {
  private pool: Tile[] = buildWall();

  /** Pull one copy of the given face. Throws if no copies remain. */
  takeFace(target: Tile): Tile {
    const i = this.pool.findIndex((t) => sameFace(t, target));
    if (i < 0) throw new Error(`no copies left of ${tileId(target)}`);
    return this.pool.splice(i, 1)[0]!;
  }

  takeMany(targets: Tile[]): Tile[] {
    return targets.map((t) => this.takeFace(t));
  }

  /** Take N arbitrary leftover tiles from the pool. */
  takeAny(n: number): Tile[] {
    return this.pool.splice(0, n);
  }

  remaining(): Tile[] {
    return this.pool;
  }

  size(): number {
    return this.pool.length;
  }
}

function suit(s: 'man' | 'pin' | 'sou', rank: number): Tile {
  return { kind: 'suit', suit: s, rank: rank as 1, copy: 0 };
}
function honor(h: 'E' | 'S' | 'W' | 'N' | 'Z' | 'F' | 'B'): Tile {
  return { kind: 'honor', honor: h, copy: 0 };
}

function blankState(): GameState {
  return emptyState({ ...DEFAULT_RULES, faanMin: 0 });
}

describe('engine — concealed gang flow', () => {
  it('removes 4 same-face tiles from hand, builds gang meld, draws a replacement', () => {
    const pool = new TilePool();
    const fourFives = pool.takeMany([
      suit('man', 5),
      suit('man', 5),
      suit('man', 5),
      suit('man', 5),
    ]);
    const filler0 = pool.takeMany([
      suit('pin', 1),
      suit('pin', 2),
      suit('pin', 3),
      suit('pin', 4),
      suit('pin', 5),
      suit('pin', 6),
      suit('pin', 7),
      suit('pin', 8),
      suit('pin', 9),
      honor('E'),
    ]);
    const hand0 = [...fourFives, ...filler0];
    const hand1 = pool.takeAny(13);
    const hand2 = pool.takeAny(13);
    const hand3 = pool.takeAny(13);
    const remainder = pool.remaining();
    const deadWall = remainder.splice(remainder.length - 14, 14);
    const wall = remainder;

    const state: GameState = {
      ...blankState(),
      phase: 'turn',
      turn: 0,
      hasDrawn: true,
      hands: { 0: hand0, 1: hand1, 2: hand2, 3: hand3 },
      wall,
      deadWall,
    };
    assertTileConservation(state);

    const { state: next } = reduce(state, {
      t: 'declareGangConcealed',
      seat: 0,
      tile: suit('man', 5),
    });
    expect(next.melds[0]).toHaveLength(1);
    expect(next.melds[0][0]?.kind).toBe('gang-concealed');
    // Replacement drawn from dead wall: hand size = 14 - 4 + 1 = 11.
    expect(next.hands[0].length).toBe(11);
    expect(next.deadWall.length).toBe(13);
    assertTileConservation(next);
  });
});

describe('engine — exposed gang (claimed from discard) flow', () => {
  it('pulls a replacement from the dead wall and bumps gangReplacementCount', () => {
    // Seat 1 holds three 5m; seat 0 will discard 5m. After seat 1
    // claims the gang, their hand should be 13 - 3 + 1 (replacement)
    // = 11 concealed tiles, with the gang-exposed meld plus
    // gangReplacementCount=1 so 槓上開花 scores on a self-draw win
    // off the replacement.
    const pool = new TilePool();
    const seat1Hand = pool.takeMany([
      suit('man', 5),
      suit('man', 5),
      suit('man', 5),
      // 10 filler tiles to round seat 1 out to 13.
      suit('pin', 1),
      suit('pin', 2),
      suit('pin', 3),
      suit('pin', 4),
      suit('pin', 6),
      suit('pin', 7),
      suit('pin', 8),
      suit('pin', 9),
      honor('S'),
      honor('W'),
    ]);
    // Seat 0 will discard a 5m. They start with 14 (just-drawn).
    const seat0Hand = [pool.takeFace(suit('man', 5)), ...pool.takeAny(13)];
    const seat2 = pool.takeAny(13);
    const seat3 = pool.takeAny(13);
    const remainder = pool.remaining();
    const deadWall = remainder.splice(remainder.length - 14, 14);
    const wall = remainder;

    // Drop the fairness gate so the auto-resolve fires the moment
    // seat 1 (the only non-discarder with a meaningful claim) submits.
    const { claimSoftWindowMs: _omitSoft, claimHardWindowMs: _omitHard, ...rules } = DEFAULT_RULES;
    void _omitSoft;
    void _omitHard;

    const state: GameState = {
      ...emptyState({ ...rules, faanMin: 0 }),
      phase: 'turn',
      turn: 0,
      hasDrawn: true,
      hands: { 0: seat0Hand, 1: seat1Hand, 2: seat2, 3: seat3 },
      wall,
      deadWall,
    };
    assertTileConservation(state);

    const startDeadWall = state.deadWall.length;

    // Seat 0 discards 5m, opening the claim window.
    let s = reduce(state, { t: 'discard', seat: 0, tile: seat0Hand[0]! }).state;
    expect(s.phase).toBe('awaitingClaims');

    // Pre-pass seats 2 and 3 explicitly. The discard reducer's
    // pre-pass uses `hasMeaningfulClaim` (which considers hu via
    // shanten), and a randomly-drawn hand can occasionally land on a
    // shape that qualifies — making the test non-deterministic
    // unless we submit passes ourselves.
    s = reduce(s, { t: 'declareClaim', seat: 2, claim: { kind: 'pass' } }).state;
    s = reduce(s, { t: 'declareClaim', seat: 3, claim: { kind: 'pass' } }).state;

    // Seat 1 claims the gang. With the fairness gate dropped and all
    // other seats in, this auto-resolves into the new turn.
    const afterClaim = reduce(s, {
      t: 'declareClaim',
      seat: 1,
      claim: { kind: 'gang' },
    }).state;

    expect(afterClaim.phase).toBe('turn');
    expect(afterClaim.turn).toBe(1);
    expect(afterClaim.hasDrawn).toBe(true); // discards next, doesn't draw again
    expect(afterClaim.melds[1]).toHaveLength(1);
    expect(afterClaim.melds[1][0]?.kind).toBe('gang-exposed');
    // Replacement drawn from dead wall: 13 - 3 + 1 = 11 concealed.
    expect(afterClaim.hands[1].length).toBe(11);
    expect(afterClaim.deadWall.length).toBe(startDeadWall - 1);
    // 槓上開花 chain starts at 1 — a self-draw win off the very next
    // turn-end would score the kong-replacement bonus.
    expect(afterClaim.gangReplacementCount).toBe(1);
    assertTileConservation(afterClaim);
  });
});

describe('engine — win-on-discard flow', () => {
  it("claims hu after another seat's discard and resolves into a winning state", () => {
    // Seat 1 hand (13 tiles) is one E away from a standard win:
    //   1m2m3m 4m5m6m 7p8p9p 1s1s1s + lone E
    const pool = new TilePool();
    const seat1Hand = pool.takeMany([
      suit('man', 1),
      suit('man', 2),
      suit('man', 3),
      suit('man', 4),
      suit('man', 5),
      suit('man', 6),
      suit('pin', 7),
      suit('pin', 8),
      suit('pin', 9),
      suit('sou', 1),
      suit('sou', 1),
      suit('sou', 1),
      honor('E'),
    ]);
    // Seat 0 holds (and will discard) an E.
    const seat0Hand = [pool.takeFace(honor('E')), ...pool.takeAny(13)];
    const seat2 = pool.takeAny(13);
    const seat3 = pool.takeAny(13);
    const remainder = pool.remaining();
    const deadWall = remainder.splice(remainder.length - 14, 14);
    const wall = remainder;

    const state: GameState = {
      ...blankState(),
      phase: 'turn',
      turn: 0,
      hasDrawn: true,
      hands: { 0: seat0Hand, 1: seat1Hand, 2: seat2, 3: seat3 },
      wall,
      deadWall,
    };
    assertTileConservation(state);

    const eastInHand0 = seat0Hand[0]!;
    const after = reduce(state, { t: 'discard', seat: 0, tile: eastInHand0 });
    expect(after.state.phase).toBe('awaitingClaims');

    const won = reduce(after.state, { t: 'declareWin', seat: 1, selfDraw: false }).state;
    expect(won.phase).toBe('resolved');
    if (won.lastResult?.kind === 'win') {
      expect(won.lastResult.winner).toBe(1);
      expect(won.lastResult.from).toBe(0);
      expect(won.lastResult.selfDraw).toBe(false);
    } else {
      throw new Error('expected a win');
    }
  });

  it("declareClaim {kind:'hu'} resolves into a winning state in the same step (regression)", () => {
    // Same setup as the test above, but exercises the path the UI
    // actually uses — `declareClaim {kind:'hu'}` rather than going
    // straight to `declareWin`. The previous engine left the state at
    // phase: 'turn' with the winner as turn-holder and waited for a
    // follow-up `declareWin` that no caller (UI / server / solo /
    // bot driver) ever issued, so the ClaimBar's "Win" button looked
    // like it did nothing. `resolveAndApply` now finalizes the win in
    // the same step.
    const pool = new TilePool();
    const seat1Hand = pool.takeMany([
      suit('man', 1),
      suit('man', 2),
      suit('man', 3),
      suit('man', 4),
      suit('man', 5),
      suit('man', 6),
      suit('pin', 7),
      suit('pin', 8),
      suit('pin', 9),
      suit('sou', 1),
      suit('sou', 1),
      suit('sou', 1),
      honor('E'),
    ]);
    const seat0Hand = [pool.takeFace(honor('E')), ...pool.takeAny(13)];
    const seat2 = pool.takeAny(13);
    const seat3 = pool.takeAny(13);
    const remainder = pool.remaining();
    const deadWall = remainder.splice(remainder.length - 14, 14);
    const wall = remainder;

    // Drop the hard fairness gate so the auto-resolve fires the moment
    // every non-discarder seat is in `submitted`. Mirrors solo's rule
    // patch in `apps/client/src/net/solo-transport.ts`. Without this,
    // `declareClaim` waits for either the soft floor or an explicit
    // `resolveClaims` action, neither of which is part of what we're
    // testing here.
    const { claimSoftWindowMs: _omitSoft, claimHardWindowMs: _omitHard, ...rules } = DEFAULT_RULES;
    void _omitSoft;
    void _omitHard;

    const state: GameState = {
      ...emptyState({ ...rules, faanMin: 0 }),
      phase: 'turn',
      turn: 0,
      hasDrawn: true,
      hands: { 0: seat0Hand, 1: seat1Hand, 2: seat2, 3: seat3 },
      wall,
      deadWall,
    };
    assertTileConservation(state);

    const eastInHand0 = seat0Hand[0]!;
    const after = reduce(state, { t: 'discard', seat: 0, tile: eastInHand0 });
    expect(after.state.phase).toBe('awaitingClaims');

    const won = reduce(after.state, {
      t: 'declareClaim',
      seat: 1,
      claim: { kind: 'hu' },
    }).state;
    expect(won.phase).toBe('resolved');
    if (won.lastResult?.kind === 'win') {
      expect(won.lastResult.winner).toBe(1);
      expect(won.lastResult.from).toBe(0);
      expect(won.lastResult.selfDraw).toBe(false);
    } else {
      throw new Error(`expected a win, got phase=${won.phase}`);
    }
  });

  it('demotes a faan-below-min hu submission to a pass instead of crashing the engine', () => {
    // Seat 1 hand (13 tiles) is one 7p away from a structurally
    // winning shape that scores only 1 faan (just 平和 — all sequences,
    // non-yakuhai pair):
    //   1m2m3m 4p5p6p 7s8s9s 2m3m4m + lone 7p
    // 1 faan is below the default `faanMin: 3`, so the engine's
    // `canFinalizeHu` pre-filter inside `resolveAndApply` should
    // demote the hu submission to a pass — silently — rather than
    // letting `applyClaim` + `declareWin` chain throw FAAN. Pre-#157
    // the engine also accepted the bad hu but didn't follow up;
    // post-#157 the chained `declareWin` would throw without this
    // pre-filter. The test pins the demotion behaviour so a future
    // refactor of `canFinalizeHu` doesn't accidentally restart the
    // crash.
    const pool = new TilePool();
    const seat1Hand = pool.takeMany([
      suit('man', 1),
      suit('man', 2),
      suit('man', 3),
      suit('pin', 4),
      suit('pin', 5),
      suit('pin', 6),
      suit('sou', 7),
      suit('sou', 8),
      suit('sou', 9),
      suit('man', 2),
      suit('man', 3),
      suit('man', 4),
      suit('pin', 7),
    ]);
    // Seat 0 holds and will discard a 7p.
    const seat0Hand = [pool.takeFace(suit('pin', 7)), ...pool.takeAny(13)];
    // Pull the remaining two 7p copies out of the random pool so
    // seats 2 / 3 can't end up with a peng on the discarded 7p — that
    // would un-pre-pass them and the auto-resolve wouldn't fire on
    // the seat-1 declareClaim alone.
    const extraSevenP = [pool.takeFace(suit('pin', 7)), pool.takeFace(suit('pin', 7))];
    const seat2 = pool.takeAny(13);
    const seat3 = pool.takeAny(13);
    const remainder = pool.remaining();
    const deadWall = remainder.splice(remainder.length - 14, 14);
    const wall = [...remainder, ...extraSevenP];

    // Strip the soft + hard claim windows (mirrors solo's rule patch
    // in `apps/client/src/net/solo-transport.ts`) so resolveAndApply
    // fires the moment every non-discarder seat is in `submitted`.
    // `faanMin` keeps the default value of 3 so the demotion path
    // actually runs.
    const { claimSoftWindowMs: _omitSoft, claimHardWindowMs: _omitHard, ...rules } = DEFAULT_RULES;
    void _omitSoft;
    void _omitHard;
    expect(rules.faanMin).toBe(3);

    const state: GameState = {
      ...emptyState(rules),
      phase: 'turn',
      // Dealer = seat 2 so that seat 0's pending discard isn't the
      // dealer's *first* discard — without this, the 地糊 (Blessing
      // of Earth, +13 faan) detector added in the engine-driven fan
      // PR would push the would-be 1-faan ron well above the 3 faan
      // floor and the demotion path under test would never run.
      dealer: 2,
      turn: 0,
      hasDrawn: true,
      hands: { 0: seat0Hand, 1: seat1Hand, 2: seat2, 3: seat3 },
      wall,
      deadWall,
    };
    assertTileConservation(state);

    const sevenP = seat0Hand[0]!;
    const after = reduce(state, { t: 'discard', seat: 0, tile: sevenP });
    expect(after.state.phase).toBe('awaitingClaims');

    // declareClaim hu — the engine demotes it to a pass and the round
    // resolves to `kind: 'pass'`. Phase advances to seat 1's turn for
    // a draw (next seat counter-clockwise from the discarder).
    const { state: next, events } = reduce(after.state, {
      t: 'declareClaim',
      seat: 1,
      claim: { kind: 'hu' },
    });
    expect(next.phase).toBe('turn');
    expect(next.turn).toBe(1);
    expect(next.hasDrawn).toBe(false);
    expect(next.lastResult).toBeUndefined();
    expect(next.pendingClaims).toBeUndefined();

    // The `claimsResolved` event should reflect the demoted resolution.
    const resolved = events.find((e) => e.t === 'claimsResolved');
    expect(resolved).toBeDefined();
    if (resolved && resolved.t === 'claimsResolved') {
      expect(resolved.result.kind).toBe('pass');
    }
  });
});

/**
 * 搶槓 (Robbing the Kong) coverage. The engine wraps `declareGangPromoted`
 * in a claim window where `hu` is the only legal claim — opponents one
 * tile from a win can rob the promotion tile before it lands in the
 * gang. Three paths to exercise:
 *
 *   1. No eligible robbers — engine skips the window entirely and
 *      finalizes the gang in the same reduce step.
 *   2. Rob fires — opponent declares hu, gang is cancelled (peng stays a
 *      peng), promotion tile is removed from the gang seat's hand, win
 *      finalizes with +1 fan for 搶槓.
 *   3. All-pass — eligible robbers declare pass, gang finalizes after
 *      the window, gangReplacementCount bumps to 1.
 */
describe('engine — promoted gang (搶槓) flow', () => {
  // Seat 0 has an exposed peng of 5p (3 of 4 copies) and the 4th 5p in
  // hand; declaring promote turns the meld into gang-promoted. Seat 1
  // is set up one 5p away from a chi-completion win in different
  // tests; seats 2 / 3 are random fillers that can't hold 5p (all 4
  // copies are spoken for by seat 0).
  //
  // Solo-style rules (no hard/soft deadline) so the auto-resolve fast
  // path inside `declareClaim` fires on the robber's submission
  // without us having to advance Date.now or issue an explicit
  // `resolveClaims` action — both of which would muddy what these
  // tests are pinning down.
  function soloRulesState(): GameState {
    const { claimSoftWindowMs: _omitSoft, claimHardWindowMs: _omitHard, ...rules } = DEFAULT_RULES;
    void _omitSoft;
    void _omitHard;
    return emptyState({ ...rules, faanMin: 0 });
  }
  function setupRobScenario(opts: { seat1Robbing: boolean }) {
    const pool = new TilePool();
    const pengTiles = pool.takeMany([suit('pin', 5), suit('pin', 5), suit('pin', 5)]);
    const hand0 = pool.takeMany([
      suit('pin', 5), // the 4th 5p — will be promoted
      suit('man', 1),
      suit('man', 2),
      suit('man', 3),
      suit('man', 4),
      suit('man', 5),
      suit('man', 6),
      suit('man', 7),
      suit('man', 8),
      suit('man', 9),
      honor('E'),
    ]);
    const hand1 = opts.seat1Robbing
      ? pool.takeMany([
          // Waiting on 5p for the 4p-5p-6p chi:
          suit('pin', 4),
          suit('pin', 6),
          // Plus 4 sets + pair already locked in (without using 5p):
          suit('man', 1),
          suit('man', 1),
          suit('man', 1),
          honor('S'),
          honor('S'),
          suit('sou', 7),
          suit('sou', 8),
          suit('sou', 9),
          suit('pin', 1),
          suit('pin', 2),
          suit('pin', 3),
        ])
      : pool.takeAny(13);
    const hand2 = pool.takeAny(13);
    const hand3 = pool.takeAny(13);
    const remainder = pool.remaining();
    const deadWall = remainder.splice(remainder.length - 14, 14);
    const wall = remainder;

    const state: GameState = {
      ...soloRulesState(),
      phase: 'turn',
      turn: 0,
      hasDrawn: true,
      hands: { 0: hand0, 1: hand1, 2: hand2, 3: hand3 },
      melds: {
        0: [{ kind: 'peng', tiles: pengTiles, from: 1 }],
        1: [],
        2: [],
        3: [],
      },
      wall,
      deadWall,
    };
    assertTileConservation(state);
    return state;
  }

  it('finalizes the gang in one step when no opponent can rob', () => {
    const state = setupRobScenario({ seat1Robbing: false });
    const startDeadWall = state.deadWall.length;
    const { state: next, events } = reduce(state, {
      t: 'declareGangPromoted',
      seat: 0,
      tile: suit('pin', 5),
    });

    // No claim window opened — phase stays on the seat's turn.
    expect(next.phase).toBe('turn');
    expect(next.turn).toBe(0);
    expect(next.pendingClaims).toBeUndefined();
    expect(next.pendingPromotedGang).toBeUndefined();
    // Gang finalized: peng → gang-promoted, replacement drawn, count++.
    expect(next.melds[0]).toHaveLength(1);
    expect(next.melds[0][0]?.kind).toBe('gang-promoted');
    expect(next.deadWall.length).toBe(startDeadWall - 1);
    expect(next.gangReplacementCount).toBe(1);
    // Single gangDeclared event, no claimsOpened/claimsResolved.
    expect(events.map((e) => e.t)).toEqual(['gangDeclared']);
    assertTileConservation(next);
  });

  it('opens a rob window when an opponent waits on the promotion tile, then robs it on hu', () => {
    const state = setupRobScenario({ seat1Robbing: true });
    const { state: opened, events: openEvents } = reduce(state, {
      t: 'declareGangPromoted',
      seat: 0,
      tile: suit('pin', 5),
    });

    // Window opened: phase awaitingClaims, pendingPromotedGang set,
    // lastDiscard records the promotion tile from the gang seat.
    expect(opened.phase).toBe('awaitingClaims');
    expect(opened.pendingPromotedGang?.seat).toBe(0);
    expect(opened.lastDiscard?.from).toBe(0);
    expect(opened.lastDiscard?.tile.kind).toBe('suit');
    // The gangDeclared event is *not* emitted yet — the gang hasn't
    // actually completed.
    expect(openEvents.map((e) => e.t)).toContain('claimsOpened');
    expect(openEvents.map((e) => e.t)).not.toContain('gangDeclared');
    // Seats 2 / 3 (and potentially 1, depending on shape) are
    // pre-passed where they can't rob; seat 1 is the robber and is
    // not pre-passed.
    expect(opened.pendingClaims?.submitted[1]).toBeUndefined();

    // Seat 1 robs by declaring hu. setupRobScenario already used
    // solo-style rules so the auto-resolve fast path fires the
    // moment the only un-pre-passed seat (1) submits.
    const { state: won, events: winEvents } = reduce(opened, {
      t: 'declareClaim',
      seat: 1,
      claim: { kind: 'hu' },
    });
    expect(won.phase).toBe('resolved');
    expect(won.pendingPromotedGang).toBeUndefined();
    if (won.lastResult?.kind !== 'win') throw new Error('expected a win');
    expect(won.lastResult.winner).toBe(1);
    expect(won.lastResult.from).toBe(0);
    expect(won.lastResult.selfDraw).toBe(false);
    // Breakdown contains 搶槓 with +1 fan.
    const robEntry = won.lastResult.breakdown.find((b) => b.name === '搶槓');
    expect(robEntry).toBeDefined();
    expect(robEntry?.faan).toBe(1);
    // The gang did NOT actually finalize: seat 0's meld stays a peng
    // and the promotion tile was removed from their hand.
    expect(won.melds[0][0]?.kind).toBe('peng');
    expect(won.hands[0].some((t) => t.kind === 'suit' && t.suit === 'pin' && t.rank === 5)).toBe(
      false,
    );
    // No replacement was drawn from the dead wall — the gang fell through.
    expect(won.deadWall.length).toBe(state.deadWall.length);
    expect(won.gangReplacementCount).toBe(0);
    expect(winEvents.map((e) => e.t)).toContain('claimsResolved');
    expect(winEvents.map((e) => e.t)).toContain('won');
  });

  it('finalizes the gang when every robber-eligible seat passes', () => {
    const state = setupRobScenario({ seat1Robbing: true });
    const startDeadWall = state.deadWall.length;
    const { state: opened } = reduce(state, {
      t: 'declareGangPromoted',
      seat: 0,
      tile: suit('pin', 5),
    });
    expect(opened.pendingPromotedGang).toBeDefined();

    const { state: next, events } = reduce(opened, {
      t: 'declareClaim',
      seat: 1,
      claim: { kind: 'pass' },
    });

    // Gang finalized post-window: meld promoted, replacement drawn,
    // count++.
    expect(next.phase).toBe('turn');
    expect(next.turn).toBe(0);
    expect(next.pendingPromotedGang).toBeUndefined();
    expect(next.pendingClaims).toBeUndefined();
    expect(next.melds[0][0]?.kind).toBe('gang-promoted');
    expect(next.deadWall.length).toBe(startDeadWall - 1);
    expect(next.gangReplacementCount).toBe(1);
    // claimsResolved + gangDeclared both emitted on the finalize.
    const eventTypes = events.map((e) => e.t);
    expect(eventTypes).toContain('claimsResolved');
    expect(eventTypes).toContain('gangDeclared');
    assertTileConservation(next);
  });
});

describe('engine — chi meld order', () => {
  it('sorts chi tiles by rank regardless of which slot the discard fits', () => {
    // Seat 0 discards 5p. Seat 1 holds 4p + 6p, so claiming chi
    // produces a 4-5-6 run with 5p slotting in as the middle tile.
    // Pre-fix the meld stored `[discard, a, b]` which rendered as
    // [5p, 4p, 6p]; the engine now sorts it to [4p, 5p, 6p].
    const pool = new TilePool();
    const seat0Hand = [
      pool.takeFace(suit('pin', 5)),
      ...pool.takeMany([
        suit('man', 1),
        suit('man', 2),
        suit('man', 3),
        suit('man', 4),
        suit('man', 5),
        suit('man', 6),
        suit('man', 7),
        suit('man', 8),
        suit('man', 9),
        honor('E'),
        honor('S'),
        honor('W'),
        honor('N'),
      ]),
    ];
    const seat1Hand = pool.takeMany([
      suit('pin', 4),
      suit('pin', 6),
      suit('sou', 1),
      suit('sou', 2),
      suit('sou', 3),
      suit('sou', 4),
      suit('sou', 5),
      suit('sou', 6),
      suit('sou', 7),
      suit('sou', 8),
      suit('sou', 9),
      honor('Z'),
      honor('F'),
    ]);
    const seat2 = pool.takeAny(13);
    const seat3 = pool.takeAny(13);
    const remainder = pool.remaining();
    const deadWall = remainder.splice(remainder.length - 14, 14);
    const wall = remainder;

    const { claimSoftWindowMs: _omitSoft, claimHardWindowMs: _omitHard, ...rules } = DEFAULT_RULES;
    void _omitSoft;
    void _omitHard;
    const state: GameState = {
      ...emptyState(rules),
      phase: 'turn',
      turn: 0,
      hasDrawn: true,
      hands: { 0: seat0Hand, 1: seat1Hand, 2: seat2, 3: seat3 },
      wall,
      deadWall,
    };

    const fivePin = seat0Hand[0]!;
    const after = reduce(state, { t: 'discard', seat: 0, tile: fivePin });
    const { state: claimed } = reduce(after.state, {
      t: 'declareClaim',
      seat: 1,
      claim: { kind: 'chi', with: [seat1Hand[0]!, seat1Hand[1]!] },
    });
    const meld = claimed.melds[1][0];
    expect(meld?.kind).toBe('chi');
    const ranks = (meld?.tiles ?? []).map((t) => (t.kind === 'suit' ? t.rank : 0));
    expect(ranks).toEqual([4, 5, 6]);
  });
});

describe('engine — winning tile lands in winner hand on ron', () => {
  it("moves the winning tile from the discarder's pile into the winner's concealed hand", () => {
    // Mirrors the existing win-on-discard test but asserts the
    // post-state shape rather than just the lastResult. With the fix
    // the winner's hand goes from 13 → 14 tiles and the discarder's
    // pile drops the winning tile (it was claimed, like chi/peng/gang
    // pop the just-claimed tile).
    const pool = new TilePool();
    const seat1Hand = pool.takeMany([
      suit('man', 1),
      suit('man', 2),
      suit('man', 3),
      suit('man', 4),
      suit('man', 5),
      suit('man', 6),
      suit('pin', 7),
      suit('pin', 8),
      suit('pin', 9),
      suit('sou', 1),
      suit('sou', 1),
      suit('sou', 1),
      honor('E'),
    ]);
    const seat0Hand = [pool.takeFace(honor('E')), ...pool.takeAny(13)];
    const seat2 = pool.takeAny(13);
    const seat3 = pool.takeAny(13);
    const remainder = pool.remaining();
    const deadWall = remainder.splice(remainder.length - 14, 14);
    const wall = remainder;

    const state: GameState = {
      ...blankState(),
      phase: 'turn',
      turn: 0,
      hasDrawn: true,
      hands: { 0: seat0Hand, 1: seat1Hand, 2: seat2, 3: seat3 },
      wall,
      deadWall,
    };

    const eastInHand0 = seat0Hand[0]!;
    const after = reduce(state, { t: 'discard', seat: 0, tile: eastInHand0 });
    const won = reduce(after.state, { t: 'declareWin', seat: 1, selfDraw: false }).state;
    expect(won.phase).toBe('resolved');
    // Winner's hand is now 14 tiles (the East was added).
    expect(won.hands[1].length).toBe(14);
    expect(won.hands[1].some((t) => t.kind === 'honor' && t.honor === 'E')).toBe(true);
    // Discarder's pile no longer has the East.
    expect(won.discards[0].some((t) => t.kind === 'honor' && t.honor === 'E')).toBe(false);
    // Tile conservation still holds — the winning tile moved, didn't duplicate.
    assertTileConservation(won);
  });
});
