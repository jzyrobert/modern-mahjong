import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  type GameState,
  SEATS,
  emptyState,
  reduce,
  rollDice,
} from '../src/index.js';

describe('engine — opening dice rolls', () => {
  it('first hand of a session rolls dice for all four seats', () => {
    const init = emptyState(DEFAULT_RULES);
    const { state } = reduce(init, { t: 'startHand', seed: 1234, dealer: 0 });
    expect(state.openingRolls).toBeDefined();
    expect(state.openingRolls!.fullRoll).toBe(true);
    for (const s of SEATS) {
      expect(state.openingRolls!.dice[s]).toBeDefined();
      const [a, b] = state.openingRolls!.dice[s]!;
      expect(a).toBeGreaterThanOrEqual(1);
      expect(a).toBeLessThanOrEqual(6);
      expect(b).toBeGreaterThanOrEqual(1);
      expect(b).toBeLessThanOrEqual(6);
    }
  });

  it('subsequent hand after a win rolls dice only for the previous winner', () => {
    const init = emptyState(DEFAULT_RULES);
    const winner = 2;
    const seeded: GameState = {
      ...reduce(init, { t: 'startHand', seed: 100, dealer: 0 }).state,
      phase: 'resolved',
      lastResult: {
        kind: 'win',
        winner,
        from: 0,
        tile: { kind: 'honor', honor: 'E', copy: 0 },
        selfDraw: false,
        faan: 3,
        breakdown: [],
      },
    };
    const { state } = reduce(seeded, { t: 'startHand', seed: 200, dealer: 0 });
    expect(state.openingRolls!.fullRoll).toBe(false);
    expect(state.openingRolls!.dice[winner]).toBeDefined();
    for (const s of SEATS) {
      if (s === winner) continue;
      expect(state.openingRolls!.dice[s]).toBeUndefined();
    }
  });

  it('drawn hand triggers a full re-roll for the next hand', () => {
    const init = emptyState(DEFAULT_RULES);
    const seeded: GameState = {
      ...reduce(init, { t: 'startHand', seed: 1, dealer: 0 }).state,
      phase: 'resolved',
      lastResult: { kind: 'draw', reason: 'wall-empty' },
    };
    const { state } = reduce(seeded, { t: 'startHand', seed: 2, dealer: 0 });
    expect(state.openingRolls!.fullRoll).toBe(true);
  });

  it('rollDice is deterministic and within d6 range', () => {
    for (let s = 0; s < 200; s++) {
      const [a, b] = rollDice(12345, s);
      expect(a).toBeGreaterThanOrEqual(1);
      expect(a).toBeLessThanOrEqual(6);
      expect(b).toBeGreaterThanOrEqual(1);
      expect(b).toBeLessThanOrEqual(6);
      expect(rollDice(12345, s)).toEqual([a, b]);
    }
  });

  it('emits an "opened" event alongside "handStarted"', () => {
    const init = emptyState(DEFAULT_RULES);
    const { events } = reduce(init, { t: 'startHand', seed: 99, dealer: 0 });
    expect(events.some((e) => e.t === 'handStarted')).toBe(true);
    expect(events.some((e) => e.t === 'opened')).toBe(true);
  });

  it('omitting `dealer` on first hand picks the seat with the highest dice sum', () => {
    // Try a wide spread of seeds and confirm the resolved dealer is
    // always the one whose opening roll has the largest sum (ties break
    // toward the lowest seat index, matching the engine's tie rule).
    const init = emptyState(DEFAULT_RULES);
    for (const seed of [1, 17, 42, 100, 1234, 99999, 0xdeadbeef]) {
      const { state } = reduce(init, { t: 'startHand', seed });
      const sums = SEATS.map((s) => {
        const pair = state.openingRolls!.dice[s]!;
        return { seat: s, sum: pair[0] + pair[1] };
      });
      const expected = sums.reduce((best, cur) => (cur.sum > best.sum ? cur : best)).seat;
      expect(state.dealer).toBe(expected);
      expect(state.turn).toBe(expected);
    }
  });

  it('omitting `dealer` on a re-roll hand inherits the previous dealer', () => {
    // Partial-roll hands (post-win) only roll for the winner — the
    // engine has nothing to compare across seats, so it falls back to
    // the inherited `state.dealer` instead of guessing.
    const init = emptyState(DEFAULT_RULES);
    const winner = 2;
    const seeded: GameState = {
      ...reduce(init, { t: 'startHand', seed: 100, dealer: 1 }).state,
      phase: 'resolved',
      lastResult: {
        kind: 'win',
        winner,
        from: 0,
        tile: { kind: 'honor', honor: 'E', copy: 0 },
        selfDraw: false,
        faan: 3,
        breakdown: [],
      },
    };
    const { state } = reduce(seeded, { t: 'startHand', seed: 200 });
    expect(state.openingRolls!.fullRoll).toBe(false);
    // Inherited dealer = the seat that was dealer on the previous hand.
    expect(state.dealer).toBe(1);
  });

  it('explicit `dealer` always wins over the dice', () => {
    const init = emptyState(DEFAULT_RULES);
    const { state } = reduce(init, { t: 'startHand', seed: 1234, dealer: 3 });
    expect(state.dealer).toBe(3);
    expect(state.turn).toBe(3);
  });
});
