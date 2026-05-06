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
 *   - Concealed kong (4 in hand, draw replacement)
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

describe('engine — concealed kong flow', () => {
  it('removes 4 same-face tiles from hand, builds kong meld, draws a replacement', () => {
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
      t: 'declareKongConcealed',
      seat: 0,
      tile: suit('man', 5),
    });
    expect(next.melds[0]).toHaveLength(1);
    expect(next.melds[0][0]?.kind).toBe('kong-concealed');
    // Replacement drawn from dead wall: hand size = 14 - 4 + 1 = 11.
    expect(next.hands[0].length).toBe(11);
    expect(next.deadWall.length).toBe(13);
    assertTileConservation(next);
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
});
