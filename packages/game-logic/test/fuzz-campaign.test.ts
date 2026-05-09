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
  checkInvariants,
  legalActions,
  pickAction,
  snapshotEqual,
  startDriver,
} from './invariants-driver.js';

/**
 * Long-running fuzz campaign — gated behind `MAHJONG_FUZZ=1` so CI runs
 * the cheap invariant tests in `invariants.test.ts` and only this file
 * eats real wall-clock budget when the operator opts in.
 *
 * Usage:
 *   MAHJONG_FUZZ=1 MAHJONG_FUZZ_MS=1800000 pnpm --filter @mahjong/game-logic test fuzz-campaign
 *
 * Defaults to 30 minutes split equally across the 3 properties below.
 * Each property uses `numRuns: Infinity` + `interruptAfterTimeLimit` so
 * fast-check generates cases nonstop until the budget elapses.
 */

const FUZZ_ENABLED = process.env.MAHJONG_FUZZ === '1';
const FUZZ_BUDGET_MS = Number(process.env.MAHJONG_FUZZ_MS ?? 1_800_000);
const FUZZ_PROP_COUNT = 3;
const FUZZ_PER_PROPERTY_MS = Math.floor(FUZZ_BUDGET_MS / FUZZ_PROP_COUNT);
const HARD_TIMEOUT = FUZZ_PER_PROPERTY_MS + 60_000;

describe.skipIf(!FUZZ_ENABLED)('engine — fuzz campaign (opt-in)', () => {
  it(
    `invariants under deep random play (~${Math.round(FUZZ_PER_PROPERTY_MS / 1000)}s budget)`,
    () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 0xffffffff }),
          fc.integer({ min: 0, max: 0xffffffff }),
          fc.integer({ min: 0, max: 3 }),
          fc.integer({ min: 5, max: 600 }),
          (handSeed, choiceSeed, dealer, maxSteps) => {
            let driver = startDriver(handSeed, dealer as 0 | 1 | 2 | 3);
            const v0 = checkInvariants(driver.state);
            if (v0) {
              throw new Error(
                `initial: ${v0.invariant} — ${v0.detail}\nseed=${handSeed} dealer=${dealer}`,
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
                    `${v.invariant} — ${v.detail}\n` +
                      `seeds=(${handSeed},${choiceSeed}) dealer=${dealer} step=${driver.steps}\n` +
                      `last action=${JSON.stringify(action)}`,
                  );
                }
              } catch (e) {
                if (e instanceof IllegalActionError) {
                  throw new Error(`driver picked illegal ${JSON.stringify(action)}: ${e.message}`);
                }
                throw e;
              }
            }
            return true;
          },
        ),
        {
          numRuns: Number.POSITIVE_INFINITY,
          interruptAfterTimeLimit: FUZZ_PER_PROPERTY_MS,
          markInterruptAsFailure: false,
        },
      );
    },
    HARD_TIMEOUT,
  );

  it(
    `illegal actions never mutate state (~${Math.round(FUZZ_PER_PROPERTY_MS / 1000)}s budget)`,
    () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 0xffffffff }),
          fc.integer({ min: 0, max: 0xffffffff }),
          fc.integer({ min: 0, max: 200 }),
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
              { t: 'declareClaim', seat: 0, claim: { kind: 'peng' } },
              {
                t: 'declareGangPromoted',
                seat: 3,
                tile: { kind: 'suit', suit: 'man', rank: 5, copy: 0 },
              },
              { t: 'discard', seat: 0, tile: { kind: 'honor', honor: 'F', copy: 3 } as Tile },
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
        {
          numRuns: Number.POSITIVE_INFINITY,
          interruptAfterTimeLimit: FUZZ_PER_PROPERTY_MS,
          markInterruptAsFailure: false,
        },
      );
    },
    HARD_TIMEOUT,
  );

  it(
    `JSON round-trip preserves state (~${Math.round(FUZZ_PER_PROPERTY_MS / 1000)}s budget)`,
    () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 0xffffffff }),
          fc.integer({ min: 0, max: 0xffffffff }),
          fc.integer({ min: 0, max: 300 }),
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
        {
          numRuns: Number.POSITIVE_INFINITY,
          interruptAfterTimeLimit: FUZZ_PER_PROPERTY_MS,
          markInterruptAsFailure: false,
        },
      );
    },
    HARD_TIMEOUT,
  );
});
