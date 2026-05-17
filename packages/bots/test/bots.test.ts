import {
  DEFAULT_RULES,
  type GameState,
  IllegalActionError,
  SEATS,
  type Seat,
  assertTileConservation,
  emptyState,
  reduce,
} from '@mahjong/game-logic';
import { describe, expect, it, vi } from 'vitest';
import { heuristicBot, passiveBot, simpleBot } from '../src/index.js';

function startedHand(seed: number): GameState {
  const init = emptyState(DEFAULT_RULES);
  return reduce(init, { t: 'startHand', seed, dealer: 0 }).state;
}

describe('bots — basic legality', () => {
  it('simple bot picks a tile from its own hand', () => {
    const s = startedHand(1);
    const tile = simpleBot.pickDiscard({ state: s, seat: 0 });
    expect(s.hands[0].some((t) => t === tile)).toBe(true);
  });

  it('heuristic bot picks a tile that exists in hand', () => {
    const s = startedHand(2);
    const tile = heuristicBot.pickDiscard({ state: s, seat: 0 });
    expect(s.hands[0].some((t) => t === tile)).toBe(true);
  });

  it('passive bot returns the last tile in hand', () => {
    const s = startedHand(3);
    const tile = passiveBot.pickDiscard({ state: s, seat: 0 });
    expect(tile).toBe(s.hands[0][s.hands[0].length - 1]);
  });
});

describe('passive bot — claim coin-flip', () => {
  /**
   * Drive the engine far enough that seat 0 has just discarded a tile
   * that seat 1 holds two copies of (so seat 1's `legalClaimsFor`
   * includes `peng`). We search seeds 1..200 for one where seat 1's
   * starting hand has a pair of any face; the helper returns a state
   * parked at `phase: 'awaitingClaims'` with `lastDiscard` set.
   */
  function stateWithPengableDiscardForSeat1(): GameState {
    for (let seed = 1; seed < 200; seed++) {
      let state = startedHand(seed);
      // Find a face in seat 1's hand with at least 2 copies.
      const hand1 = state.hands[1];
      const counts = new Map<string, number>();
      for (const t of hand1) {
        const key = t.kind === 'suit' ? `${t.suit}-${t.rank}` : `h-${t.honor}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const targetEntry = [...counts.entries()].find(([, n]) => n >= 2);
      if (!targetEntry) continue;
      const [targetKey] = targetEntry;
      // Find a copy of this face on the wall so we can construct a
      // synthetic state where seat 0 discards it (avoids having to
      // wait for natural drawing).
      const wallCopy = state.wall.find((t) => {
        const k = t.kind === 'suit' ? `${t.suit}-${t.rank}` : `h-${t.honor}`;
        return k === targetKey;
      });
      if (!wallCopy) continue;
      // Run a full turn for seat 0: draw + discard the matching tile.
      // The engine doesn't let seat 0 discard a tile it doesn't hold,
      // so the discard target must come from seat 0's hand or the
      // tile they just drew. Use seat 0's heuristic pick to ensure
      // legality, but override only when a draw lands the target
      // face. Cheap fallback: just iterate until seat 0 holds the
      // target.
      let safety = 0;
      while (state.phase === 'turn' && safety < 50) {
        safety++;
        if (!state.hasDrawn) {
          ({ state } = reduce(state, { t: 'draw', seat: state.turn }));
        }
        const seat = state.turn;
        const tileToDiscard = state.hands[seat].find((t) => {
          const k = t.kind === 'suit' ? `${t.suit}-${t.rank}` : `h-${t.honor}`;
          return seat === 0 && k === targetKey;
        });
        if (tileToDiscard) {
          ({ state } = reduce(state, { t: 'discard', seat, tile: tileToDiscard }));
          break;
        }
        // Discard last tile (passive behaviour) and let the loop
        // come back to seat 0 next iteration.
        const fallback = state.hands[seat][state.hands[seat].length - 1]!;
        ({ state } = reduce(state, { t: 'discard', seat, tile: fallback }));
        // If the engine parked in awaitingClaims, just pass everyone
        // through and continue.
        let claimSafety = 0;
        while (state.phase === 'awaitingClaims' && claimSafety < 8) {
          claimSafety++;
          for (const claimSeat of SEATS) {
            if (state.phase !== 'awaitingClaims' || !state.pendingClaims) break;
            if (claimSeat === state.lastDiscard?.from) continue;
            if (state.pendingClaims.submitted[claimSeat] !== undefined) continue;
            ({ state } = reduce(state, {
              t: 'declareClaim',
              seat: claimSeat,
              claim: { kind: 'pass' },
            }));
          }
        }
      }
      if (state.phase === 'awaitingClaims' && state.lastDiscard?.from === 0) {
        const k =
          state.lastDiscard.tile.kind === 'suit'
            ? `${state.lastDiscard.tile.suit}-${state.lastDiscard.tile.rank}`
            : `h-${state.lastDiscard.tile.honor}`;
        if (k === targetKey) return state;
      }
    }
    throw new Error('failed to find seed with pengable seat-1 discard');
  }

  it('returns pass when Math.random < 0.5 (pin to 0.1)', () => {
    const state = stateWithPengableDiscardForSeat1();
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.1);
    try {
      const claim = passiveBot.pickClaim({ state, seat: 1 });
      expect(claim).toEqual({ kind: 'pass' });
    } finally {
      spy.mockRestore();
    }
  });

  it('returns peng when Math.random >= 0.5 and a peng is legal (pin to 0.9)', () => {
    const state = stateWithPengableDiscardForSeat1();
    const spy = vi.spyOn(Math, 'random').mockReturnValue(0.9);
    try {
      const claim = passiveBot.pickClaim({ state, seat: 1 });
      // Seat 1 holds two copies of the discarded face, so peng is the
      // only meaningful claim on the priority chain (no win shape,
      // no fourth copy for gang).
      expect(claim.kind).toBe('peng');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('bots — self-play smoke test', () => {
  /**
   * Run a full hand with all four seats playing the heuristic bot. Expect:
   *   - no thrown exceptions
   *   - tile conservation maintained throughout
   *   - hand resolves either as a draw or a win within the wall
   */
  it('heuristic vs heuristic completes a hand', () => {
    let state = startedHand(123);
    let safety = 0;
    while (state.phase !== 'resolved' && safety < 300) {
      safety++;
      assertTileConservation(state);

      if (state.phase === 'turn') {
        const seat = state.turn;
        if (!state.hasDrawn) {
          if (state.wall.length === 0) {
            // Wall empty — reducer will mark a draw.
            ({ state } = reduce(state, { t: 'draw', seat }));
            continue;
          }
          ({ state } = reduce(state, { t: 'draw', seat }));
        }
        // Try to win first.
        try {
          ({ state } = reduce(state, { t: 'declareWin', seat, selfDraw: true }));
          continue;
        } catch (e) {
          if (!(e instanceof IllegalActionError)) throw e;
        }
        const tile = heuristicBot.pickDiscard({ state, seat });
        ({ state } = reduce(state, { t: 'discard', seat, tile }));
      } else if (state.phase === 'awaitingClaims') {
        for (const seat of SEATS) {
          // The engine now auto-resolves the moment every seat is
          // submitted (no soft-floor gate), so a single declareClaim
          // can flip state to `turn`. Skip seats that are already
          // submitted (pre-passed in the discard reducer) and bail
          // the loop the instant the window closes.
          if (state.phase !== 'awaitingClaims' || !state.pendingClaims) break;
          if (seat === state.lastDiscard?.from) continue;
          if (state.pendingClaims.submitted[seat] !== undefined) continue;
          const claim = heuristicBot.pickClaim({ state, seat });
          ({ state } = reduce(state, { t: 'declareClaim', seat, claim }));
        }
        if (state.phase === 'awaitingClaims') {
          ({ state } = reduce(state, { t: 'resolveClaims', nowMs: Date.now() }));
        }
      }
    }
    expect(state.phase).toBe('resolved');
    expect(safety).toBeLessThan(300);
    assertTileConservation(state);
  });
});
