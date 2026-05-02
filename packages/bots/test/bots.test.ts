import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  emptyState,
  reduce,
  type GameState,
  type Seat,
  assertTileConservation,
  SEATS,
  IllegalActionError,
} from '@mahjong/game-logic';
import { simpleBot, heuristicBot, passiveBot } from '../src/index.js';

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
          if (seat === state.lastDiscard?.from) continue;
          const claim = heuristicBot.pickClaim({ state, seat });
          ({ state } = reduce(state, { t: 'declareClaim', seat, claim }));
        }
        ({ state } = reduce(state, { t: 'resolveClaims', nowMs: Date.now() }));
      }
    }
    expect(state.phase).toBe('resolved');
    expect(safety).toBeLessThan(300);
    assertTileConservation(state);
  });
});
