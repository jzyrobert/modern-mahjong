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
});
