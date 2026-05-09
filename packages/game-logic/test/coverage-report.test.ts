/**
 * Coverage probe for the engine fuzz driver — gated behind
 * `MAHJONG_COVERAGE=1` so the regular `pnpm test` doesn't run it.
 *
 *   MAHJONG_COVERAGE=1 MAHJONG_COVERAGE_HANDS=2000 pnpm --filter @mahjong/game-logic test coverage-report
 *
 * Drives `MAHJONG_COVERAGE_HANDS` random hands using the same legal-
 * action picker that `invariants.test.ts` uses, then prints a breakdown
 * of which game states and action types were exercised. Anything with a
 * 0 count is a coverage hole — either a state the random walker never
 * reaches (rare event) or one the driver doesn't generate (e.g. server-
 * issued auto-resolve actions, multiplayer fairness gates).
 */

import { describe, it } from 'vitest';
import { reduce } from '../src/index.js';
import { mulberry32 } from '../src/rng.js';
import { legalActions, pickAction, startDriver } from './invariants-driver.js';

const COVERAGE_ENABLED = process.env.MAHJONG_COVERAGE === '1';
const COVERAGE_HANDS = Number(process.env.MAHJONG_COVERAGE_HANDS ?? 2000);
const COVERAGE_BASE_SEED = Number(process.env.MAHJONG_COVERAGE_SEED ?? 1);

interface Coverage {
  hands: number;
  steps: number;
  perPhase: Record<string, number>;
  perActionKind: Record<string, number>;
  perClaimKind: Record<string, number>;
  perMeldKind: Record<string, number>;
  hands_with_claim: number;
  hands_with_chi: number;
  hands_with_peng: number;
  hands_with_gang_concealed: number;
  hands_with_gang_promoted: number;
  hands_with_gang_exposed: number;
  hands_with_promoted_gang_robbed: number;
  hands_with_win: number;
  hands_drawn_game: number;
  hands_inconclusive: number;
}

function emptyCoverage(): Coverage {
  return {
    hands: 0,
    steps: 0,
    perPhase: {},
    perActionKind: {},
    perClaimKind: {},
    perMeldKind: {},
    hands_with_claim: 0,
    hands_with_chi: 0,
    hands_with_peng: 0,
    hands_with_gang_concealed: 0,
    hands_with_gang_promoted: 0,
    hands_with_gang_exposed: 0,
    hands_with_promoted_gang_robbed: 0,
    hands_with_win: 0,
    hands_drawn_game: 0,
    hands_inconclusive: 0,
  };
}

function bump<K extends string>(map: Record<K, number>, key: K): void {
  map[key] = (map[key] ?? 0) + 1;
}

function runHand(handSeed: number, choiceSeed: number, dealer: 0 | 1 | 2 | 3, cov: Coverage) {
  let driver = startDriver(handSeed, dealer);
  // The startHand action is fired implicitly inside startDriver — count it
  // explicitly so the action coverage doesn't show a false zero.
  bump(cov.perActionKind, 'startHand');
  const rand = mulberry32(choiceSeed);
  let usedChi = false;
  let usedPeng = false;
  let usedGangConcealed = false;
  let usedGangPromoted = false;
  let usedGangExposed = false;
  let robbedPromoted = false;
  // Outstanding promotion that hasn't yet finalized — used to decide
  // whether a transition out of `pendingPromotedGang` ended in finalize
  // (no rob) or rob (a hu won the window).
  let outstandingPromotion = false;
  while (driver.steps < 600) {
    bump(cov.perPhase, driver.state.phase);
    if (driver.state.phase === 'resolved' || driver.state.phase === 'waiting') break;
    const candidates = legalActions(driver.state);
    if (candidates.length === 0) break;
    const action = pickAction(candidates, rand);
    bump(cov.perActionKind, action.t);
    if (action.t === 'declareClaim') bump(cov.perClaimKind, action.claim.kind);
    if (action.t === 'declareGangConcealed') usedGangConcealed = true;
    if (action.t === 'declareGangPromoted') outstandingPromotion = true;
    if (action.t === 'declareClaim') {
      if (action.claim.kind === 'chi') usedChi = true;
      if (action.claim.kind === 'peng') usedPeng = true;
      if (action.claim.kind === 'gang') usedGangExposed = true;
      if (action.claim.kind === 'hu' && outstandingPromotion) robbedPromoted = true;
    }
    const before = driver.state;
    const next = reduce(before, action).state;
    // Detect promotion-finalize (no rob): we just transitioned out of
    // pendingPromotedGang into a non-resolved phase, OR
    // declareGangPromoted finalized in the same step (no rob window
    // opened in the first place — robbers===0 short-circuit).
    if (
      action.t === 'declareGangPromoted' &&
      !before.pendingPromotedGang &&
      !next.pendingPromotedGang
    ) {
      usedGangPromoted = true;
      outstandingPromotion = false;
    } else if (
      outstandingPromotion &&
      before.pendingPromotedGang &&
      !next.pendingPromotedGang &&
      next.phase !== 'resolved'
    ) {
      usedGangPromoted = true;
      outstandingPromotion = false;
    }
    driver = { state: next, steps: driver.steps + 1, trace: driver.trace };
    cov.steps++;
  }
  cov.hands++;
  for (const seat of [0, 1, 2, 3] as const) {
    for (const m of driver.state.melds[seat]) bump(cov.perMeldKind, m.kind);
  }
  if (usedChi) cov.hands_with_chi++;
  if (usedPeng) cov.hands_with_peng++;
  if (usedGangConcealed) cov.hands_with_gang_concealed++;
  if (usedGangPromoted) cov.hands_with_gang_promoted++;
  if (usedGangExposed) cov.hands_with_gang_exposed++;
  if (robbedPromoted) cov.hands_with_promoted_gang_robbed++;
  if (usedChi || usedPeng || usedGangExposed) cov.hands_with_claim++;
  if (driver.state.phase === 'resolved' && driver.state.lastResult?.kind === 'win') {
    cov.hands_with_win++;
  } else if (driver.state.phase === 'resolved' && driver.state.lastResult?.kind === 'draw') {
    cov.hands_drawn_game++;
  } else {
    cov.hands_inconclusive++;
  }
}

function runReport(numHands: number, baseSeed: number): void {
  const cov = emptyCoverage();
  console.log(`Running ${numHands} fuzz hands (base seed ${baseSeed})…`);
  const t0 = Date.now();
  for (let i = 0; i < numHands; i++) {
    runHand(
      (baseSeed * 1_000_003 + i) >>> 0,
      (baseSeed * 7919 + i * 31) >>> 0,
      (i % 4) as 0 | 1 | 2 | 3,
      cov,
    );
  }
  const elapsed = Date.now() - t0;
  console.log(
    `\nFinished in ${(elapsed / 1000).toFixed(1)}s — ${cov.hands} hands, ${cov.steps} reduce calls\n`,
  );
  const sortedRecord = (r: Record<string, number>) =>
    Object.entries(r)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `  ${k.padEnd(28)} ${v}`)
      .join('\n');
  console.log('Per-phase visits (one per legal-actions call):');
  console.log(sortedRecord(cov.perPhase));
  console.log('\nAction kinds invoked:');
  console.log(sortedRecord(cov.perActionKind));
  console.log('\nClaim kinds invoked:');
  console.log(sortedRecord(cov.perClaimKind));
  console.log('\nMeld kinds in resolved hands:');
  console.log(sortedRecord(cov.perMeldKind));
  console.log('\nHand outcomes:');
  console.log(`  win                          ${cov.hands_with_win}`);
  console.log(`  drawn (wall empty)           ${cov.hands_drawn_game}`);
  console.log(`  inconclusive (step cap)      ${cov.hands_inconclusive}`);
  console.log('\nClaims exercised:');
  console.log(`  chi                          ${cov.hands_with_chi}`);
  console.log(`  peng                         ${cov.hands_with_peng}`);
  console.log(`  gang (exposed, off discard)  ${cov.hands_with_gang_exposed}`);
  console.log(`  gang (concealed, in hand)    ${cov.hands_with_gang_concealed}`);
  console.log(`  gang (promoted from peng)    ${cov.hands_with_gang_promoted}`);
  console.log(`  promoted-gang robbed (搶槓)   ${cov.hands_with_promoted_gang_robbed}`);

  const expectedActions = [
    'startHand',
    'draw',
    'discard',
    'declareClaim',
    'declareGangConcealed',
    'declareGangPromoted',
    'declareWin',
  ];
  const expectedClaims = ['pass', 'chi', 'peng', 'gang', 'hu'];
  const expectedMelds = ['chi', 'peng', 'gang-exposed', 'gang-concealed', 'gang-promoted'];
  console.log('\nCoverage holes (zero-count):');
  const missing: string[] = [];
  for (const a of expectedActions) {
    if (!cov.perActionKind[a]) missing.push(`action:${a}`);
  }
  for (const c of expectedClaims) {
    if (!cov.perClaimKind[c]) missing.push(`claim:${c}`);
  }
  for (const m of expectedMelds) {
    if (!cov.perMeldKind[m]) missing.push(`meld:${m}`);
  }
  console.log(
    missing.length
      ? missing.map((m) => `  ${m}`).join('\n')
      : '  (none — every category exercised)',
  );
}

describe.skipIf(!COVERAGE_ENABLED)('engine — coverage probe', () => {
  it(`prints fuzz-driver coverage over ${COVERAGE_HANDS} hands`, () => {
    runReport(COVERAGE_HANDS, COVERAGE_BASE_SEED);
  }, 600_000);
});
