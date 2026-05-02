import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES,
  type GameState,
  IllegalActionError,
  emptyState,
  nextDealer,
  reduce,
} from '../src/index.js';

describe('engine — setRules', () => {
  it('updates rules from waiting phase and emits rulesChanged event', () => {
    const init = emptyState(DEFAULT_RULES);
    const { state, events } = reduce(init, { t: 'setRules', rules: { faanMin: 5 } });
    expect(state.rules.faanMin).toBe(5);
    expect(state.rules.allowSevenPairs).toBe(DEFAULT_RULES.allowSevenPairs);
    expect(events.some((e) => e.t === 'rulesChanged')).toBe(true);
  });

  it('rejects rule changes mid-hand', () => {
    const start = reduce(emptyState(DEFAULT_RULES), { t: 'startHand', seed: 1, dealer: 0 }).state;
    expect(() => reduce(start, { t: 'setRules', rules: { faanMin: 0 } })).toThrow(
      IllegalActionError,
    );
  });

  it('allows rule changes from resolved phase', () => {
    const resolved: GameState = {
      ...emptyState(DEFAULT_RULES),
      phase: 'resolved',
    };
    const { state } = reduce(resolved, { t: 'setRules', rules: { faanMin: 1 } });
    expect(state.rules.faanMin).toBe(1);
  });
});

describe('engine — nextDealer', () => {
  it('keeps dealer if no result yet', () => {
    const s = emptyState(DEFAULT_RULES);
    expect(nextDealer({ ...s, dealer: 1 })).toBe(1);
  });

  it('keeps dealer when dealer wins', () => {
    const s = emptyState(DEFAULT_RULES);
    const state: GameState = {
      ...s,
      dealer: 2,
      lastResult: {
        kind: 'win',
        winner: 2,
        from: 2,
        tile: { kind: 'honor', honor: 'E', copy: 0 },
        selfDraw: true,
        faan: 3,
        reasons: [],
      },
    };
    expect(nextDealer(state)).toBe(2);
  });

  it('rotates CCW when non-dealer wins', () => {
    const s = emptyState(DEFAULT_RULES);
    const state: GameState = {
      ...s,
      dealer: 0,
      lastResult: {
        kind: 'win',
        winner: 2,
        from: 0,
        tile: { kind: 'honor', honor: 'E', copy: 0 },
        selfDraw: false,
        faan: 3,
        reasons: [],
      },
    };
    expect(nextDealer(state)).toBe(1);
  });

  it('keeps dealer on draw', () => {
    const s = emptyState(DEFAULT_RULES);
    const state: GameState = {
      ...s,
      dealer: 3,
      lastResult: { kind: 'draw', reason: 'wall-empty' },
    };
    expect(nextDealer(state)).toBe(3);
  });
});
