import * as fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type Action,
  DEFAULT_RULES,
  type GameState,
  IllegalActionError,
  SEATS,
  applyAction,
  assertTileConservation,
  buildWall,
  emptyState,
  reduce,
  shuffle,
  tileId,
} from '../src/index.js';

/**
 * Property tests: invariants the engine must hold under random sequences
 * of actions. These are intentionally not full game traces — they exercise
 * the reducer's response to legal and illegal inputs without requiring an
 * end-to-end winning sequence.
 */

describe('engine — invariants under random play', () => {
  it('shuffle is a permutation of the canonical wall', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
        const orig = buildWall()
          .map(tileId)
          .sort((a, b) => a - b);
        const shuffled = shuffle(buildWall(), seed)
          .map(tileId)
          .sort((a, b) => a - b);
        return orig.every((v, i) => v === shuffled[i]);
      }),
      { numRuns: 32 },
    );
  });

  it('startHand always produces 14+13+13+13 and 136 tiles total', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 0xffffffff }), (seed) => {
        const init = emptyState(DEFAULT_RULES);
        const { state } = reduce(init, { t: 'startHand', seed, dealer: 0 });
        if (state.hands[0].length !== 14) return false;
        for (const s of [1, 2, 3] as const) {
          if (state.hands[s].length !== 13) return false;
        }
        try {
          assertTileConservation(state);
        } catch {
          return false;
        }
        return true;
      }),
      { numRuns: 32 },
    );
  });

  it('any sequence of arbitrary actions either is rejected or preserves 136 tiles', () => {
    // Random sequence of (mostly invalid) actions. The engine should reject
    // everything illegal and accept only valid steps. Whatever happens,
    // tile conservation must hold throughout.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 1, maxLength: 50 }),
        (seed, actionKinds) => {
          const init = emptyState(DEFAULT_RULES);
          let state: GameState = reduce(init, { t: 'startHand', seed, dealer: 0 }).state;
          for (const kind of actionKinds) {
            const action = pickAction(state, kind);
            try {
              const next = reduce(state, action).state;
              assertTileConservation(next);
              state = next;
            } catch (e) {
              // IllegalActionError is fine — state should not have changed.
              if (!(e instanceof IllegalActionError)) throw e;
            }
          }
          return true;
        },
      ),
      { numRuns: 24 },
    );
  });
});

function pickAction(state: GameState, kind: number): Action {
  const seat = state.turn;
  switch (kind) {
    case 0:
      return { t: 'draw', seat };
    case 1: {
      const tile = state.hands[seat][0];
      if (!tile) return { t: 'draw', seat };
      return { t: 'discard', seat, tile };
    }
    case 2:
      return {
        t: 'declareClaim',
        seat: ((seat + 1) % 4) as 0 | 1 | 2 | 3,
        claim: { kind: 'pass' },
      };
    case 3:
      return { t: 'resolveClaims', nowMs: Date.now() };
    default: {
      // declareWin attempt — usually fails (insufficient/illegal shape).
      return { t: 'declareWin', seat, selfDraw: true };
    }
  }
}

describe('engine — illegal actions never mutate state', () => {
  it('rejected actions leave state pointer-equal', () => {
    const init = emptyState(DEFAULT_RULES);
    const start = reduce(init, { t: 'startHand', seed: 1, dealer: 0 }).state;

    // Out-of-turn discard
    let threw = false;
    try {
      reduce(start, { t: 'discard', seat: 1, tile: start.hands[1][0]! });
    } catch (e) {
      if (e instanceof IllegalActionError) threw = true;
    }
    expect(threw).toBe(true);
    // The state we read from is the same `start` object: reduce never mutated.
    expect(start.hands[1].length).toBe(13);
    assertTileConservation(start);
    void SEATS;
  });
});

/**
 * Parity test: the public XState-backed `reduce` and the legacy
 * imperative `applyAction` should produce byte-identical `{state,
 * events}` for any sequence. Both delegate to the same per-action
 * helpers (the machine's `assign` actions call `setRules` / `startHand`
 * / etc. directly), so divergence here would indicate either an
 * accidental bug in the wrapper (e.g. duplicate `assign` runs from a
 * misfiring `always` rule) or drift between the two entry points.
 */
describe('engine — XState reduce parity with applyAction', () => {
  // Several engine helpers (`discard`, `declareClaim`,
  // `declareGangPromoted`, `resolveAndApply`) call `Date.now()`
  // internally to stamp claim-window deadlines. The XState wrapper has
  // slightly more overhead than direct `applyAction`, so back-to-back
  // calls in this property test can otherwise drift by 1ms and
  // produce false-positive parity mismatches. Lock the clock so both
  // paths see identical timestamps.
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('matches event + state output across random action sequences', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.array(fc.integer({ min: 0, max: 4 }), { minLength: 1, maxLength: 30 }),
        (seed, actionKinds) => {
          const init = emptyState(DEFAULT_RULES);
          let xstateState: GameState = reduce(init, { t: 'startHand', seed, dealer: 0 }).state;
          let legacyState: GameState = applyAction(init, { t: 'startHand', seed, dealer: 0 }).state;
          expect(JSON.stringify(xstateState)).toBe(JSON.stringify(legacyState));
          for (const kind of actionKinds) {
            const action = pickAction(xstateState, kind);
            const xstateRes = safeRun(xstateState, action, reduce);
            const legacyRes = safeRun(legacyState, action, applyAction);
            expect(xstateRes.kind, `action ${JSON.stringify(action)}`).toBe(legacyRes.kind);
            if (xstateRes.kind === 'ok' && legacyRes.kind === 'ok') {
              expect(xstateRes.state, `state mismatch on ${JSON.stringify(action)}`).toEqual(
                legacyRes.state,
              );
              expect(xstateRes.events, `events mismatch on ${JSON.stringify(action)}`).toEqual(
                legacyRes.events,
              );
              xstateState = xstateRes.state;
              legacyState = legacyRes.state;
            }
          }
        },
      ),
      { numRuns: 24 },
    );
  });
});

type RunResult =
  | { kind: 'ok'; state: GameState; events: ReturnType<typeof reduce>['events'] }
  | { kind: 'illegal' };

function safeRun(state: GameState, action: Action, fn: typeof reduce): RunResult {
  try {
    const out = fn(state, action);
    return { kind: 'ok', state: out.state, events: out.events };
  } catch (e) {
    if (e instanceof IllegalActionError) return { kind: 'illegal' };
    throw e;
  }
}
