import * as fc from 'fast-check';
import { describe, it } from 'vitest';
import {
  type Action,
  type GameState,
  IllegalActionError,
  type Tile,
  reduce,
} from '../src/index.js';
import { mulberry32 } from '../src/rng.js';
import {
  MAX_STEPS,
  checkInvariants,
  legalActions,
  pickAction,
  snapshotEqual,
  startDriver,
} from './invariants-driver.js';

/**
 * Property tests over the engine reducer.
 *
 * The driver simulates a hand by repeatedly picking a *legal* action and
 * applying it, asserting all invariants hold after every accepted step.
 * Solo-style rules (no fairness gate) are used so claim windows resolve
 * synchronously — the fuzzer stays in scope of "what the engine does
 * deterministically given a sequence of legal calls" rather than racing
 * server clocks.
 *
 * The 10 invariants are listed in `invariants-driver.ts → checkInvariants`.
 * For a long opt-in fuzz campaign, see `fuzz-campaign.test.ts`.
 */

describe('engine — invariants under random legal play', () => {
  it('all 10 invariants hold across a fuzz campaign', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: 0, max: 3 }),
        fc.integer({ min: 5, max: MAX_STEPS }),
        (handSeed, choiceSeed, dealer, maxSteps) => {
          let driver = startDriver(handSeed, dealer as 0 | 1 | 2 | 3);
          const v0 = checkInvariants(driver.state);
          if (v0) {
            throw new Error(
              `initial state violated ${v0.invariant}: ${v0.detail}\nseed=${handSeed} dealer=${dealer}`,
            );
          }
          const rand = mulberry32(choiceSeed);
          while (driver.steps < maxSteps) {
            if (
              driver.state.phase === 'resolved' ||
              driver.state.phase === 'waiting' ||
              driver.state.phase === 'dealing'
            ) {
              break;
            }
            const candidates = legalActions(driver.state);
            if (candidates.length === 0) break;
            const action = pickAction(candidates, rand);
            try {
              const next = reduce(driver.state, action).state;
              driver = {
                state: next,
                steps: driver.steps + 1,
                trace: [...driver.trace, action],
              };
              const v = checkInvariants(next);
              if (v) {
                throw new Error(
                  `${v.invariant}: ${v.detail}\n` +
                    `seeds=(${handSeed},${choiceSeed}) dealer=${dealer} step=${driver.steps}\n` +
                    `last action=${JSON.stringify(action)}`,
                );
              }
            } catch (e) {
              if (e instanceof IllegalActionError) {
                throw new Error(
                  `driver picked illegal action ${JSON.stringify(action)}: ${e.message}`,
                );
              }
              throw e;
            }
          }
          return true;
        },
      ),
      { numRuns: 200 },
    );
  });

  it('illegal actions never mutate state (snapshot equality)', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: 0, max: 60 }),
        (handSeed, choiceSeed, prewarm) => {
          let driver = startDriver(handSeed, 0);
          const rand = mulberry32(choiceSeed);
          for (let i = 0; i < prewarm; i++) {
            if (driver.state.phase !== 'turn' && driver.state.phase !== 'awaitingClaims') break;
            const candidates = legalActions(driver.state);
            if (candidates.length === 0) break;
            const next = reduce(driver.state, pickAction(candidates, rand)).state;
            driver = { state: next, steps: driver.steps + 1, trace: driver.trace };
          }
          const before = driver.state;
          const beforeSnap = JSON.parse(JSON.stringify(before)) as GameState;
          const garbage: Action[] = [
            { t: 'discard', seat: 1, tile: { kind: 'honor', honor: 'Z', copy: 0 } as Tile },
            { t: 'draw', seat: 2 },
            {
              t: 'declareGangConcealed',
              seat: 0,
              tile: { kind: 'suit', suit: 'sou', rank: 9, copy: 0 },
            },
            { t: 'declareWin', seat: 0, selfDraw: true },
            { t: 'declareClaim', seat: 1, claim: { kind: 'pass' } },
          ];
          for (const action of garbage) {
            try {
              reduce(before, action);
            } catch (e) {
              if (!(e instanceof IllegalActionError)) throw e;
            }
            if (!snapshotEqual(before, beforeSnap)) {
              throw new Error(
                `illegal action ${JSON.stringify(action)} mutated state\nseeds=(${handSeed},${choiceSeed}) prewarm=${prewarm}`,
              );
            }
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('JSON round-trip preserves engine state', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: 0, max: 80 }),
        (handSeed, choiceSeed, prewarm) => {
          let driver = startDriver(handSeed, 0);
          const rand = mulberry32(choiceSeed);
          for (let i = 0; i < prewarm; i++) {
            if (driver.state.phase !== 'turn' && driver.state.phase !== 'awaitingClaims') break;
            const candidates = legalActions(driver.state);
            if (candidates.length === 0) break;
            const next = reduce(driver.state, pickAction(candidates, rand)).state;
            driver = { state: next, steps: driver.steps + 1, trace: driver.trace };
          }
          const a = driver.state;
          const b = JSON.parse(JSON.stringify(a)) as GameState;
          if (JSON.stringify(a) !== JSON.stringify(b)) {
            throw new Error(`JSON round-trip differs at seed=${handSeed}`);
          }
          const v = checkInvariants(b);
          if (v) {
            throw new Error(`post-roundtrip invariant ${v.invariant}: ${v.detail}`);
          }
          return true;
        },
      ),
      { numRuns: 80 },
    );
  });

  it('wall length is non-increasing across any accepted reduce', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: 0, max: 0xffffffff }),
        (handSeed, choiceSeed) => {
          let driver = startDriver(handSeed, 0);
          const rand = mulberry32(choiceSeed);
          while (driver.steps < 200) {
            if (driver.state.phase !== 'turn' && driver.state.phase !== 'awaitingClaims') break;
            const candidates = legalActions(driver.state);
            if (candidates.length === 0) break;
            const action = pickAction(candidates, rand);
            const prevWall = driver.state.wall.length;
            const next = reduce(driver.state, action).state;
            if (next.wall.length > prevWall) {
              throw new Error(
                `wall grew from ${prevWall} to ${next.wall.length} after ${JSON.stringify(action)}`,
              );
            }
            driver = { state: next, steps: driver.steps + 1, trace: driver.trace };
          }
          return true;
        },
      ),
      { numRuns: 80 },
    );
  });
});
