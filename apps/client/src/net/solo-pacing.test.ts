import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_BOT_CLAIM_MAX_MS,
  DEFAULT_BOT_CLAIM_MIN_MS,
  DEFAULT_CLAIM_FLOOR_MS,
  botClaimDelayMs,
  claimFloorMs,
} from './solo-transport';

/**
 * Test-override hooks for solo claim pacing. The production defaults
 * (3 s floor + 2-6 s per-bot stagger) exist to give the user time to
 * see their own discard before bots resolve a claim; specs need to
 * suppress them to keep the suite fast and deterministic. These tests
 * pin the override contract so a regression that collapses
 * `claimFloorMs()` to 0 unconditionally — or ignores the override —
 * lands red.
 */

interface PacingGlobals {
  __MAHJONG_TEST_CLAIM_FLOOR_MS__: number | undefined;
  __MAHJONG_TEST_BOT_CLAIM_DELAY_MS__: number | undefined;
}

function pacingGlobals(): PacingGlobals {
  return globalThis as unknown as PacingGlobals;
}

describe('claimFloorMs', () => {
  beforeEach(() => {
    pacingGlobals().__MAHJONG_TEST_CLAIM_FLOOR_MS__ = undefined;
  });
  afterEach(() => {
    pacingGlobals().__MAHJONG_TEST_CLAIM_FLOOR_MS__ = undefined;
  });

  it('returns the production default when no override is set', () => {
    expect(claimFloorMs()).toBe(DEFAULT_CLAIM_FLOOR_MS);
  });

  it('honours a numeric override', () => {
    pacingGlobals().__MAHJONG_TEST_CLAIM_FLOOR_MS__ = 0;
    expect(claimFloorMs()).toBe(0);
    pacingGlobals().__MAHJONG_TEST_CLAIM_FLOOR_MS__ = 500;
    expect(claimFloorMs()).toBe(500);
  });

  it('falls back to the default when the override is non-numeric', () => {
    // Simulate a stale-string override from a buggy test that wrote a
    // value via something other than the documented numeric contract.
    (pacingGlobals() as unknown as Record<string, unknown>).__MAHJONG_TEST_CLAIM_FLOOR_MS__ =
      'not-a-number';
    expect(claimFloorMs()).toBe(DEFAULT_CLAIM_FLOOR_MS);
  });
});

describe('botClaimDelayMs', () => {
  beforeEach(() => {
    pacingGlobals().__MAHJONG_TEST_BOT_CLAIM_DELAY_MS__ = undefined;
  });
  afterEach(() => {
    pacingGlobals().__MAHJONG_TEST_BOT_CLAIM_DELAY_MS__ = undefined;
  });

  it('returns a value in the production range when no override is set', () => {
    // Sample multiple draws — the underlying Math.random() means a
    // single call can land anywhere in `[MIN, MAX)`. The invariant
    // we're enforcing is that every draw stays inside the range, and
    // that the spread covers more than a single point so the
    // production stagger genuinely varies between bots.
    const samples = Array.from({ length: 64 }, () => botClaimDelayMs());
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(DEFAULT_BOT_CLAIM_MIN_MS);
      expect(s).toBeLessThan(DEFAULT_BOT_CLAIM_MAX_MS);
    }
    const min = Math.min(...samples);
    const max = Math.max(...samples);
    // With 64 samples the observed spread should be a meaningful chunk
    // of the 4000 ms window; 500 ms is a low bar that still rules out
    // "every call returns the same value" regressions.
    expect(max - min).toBeGreaterThan(500);
  });

  it('returns the override unchanged when set, killing the jitter', () => {
    pacingGlobals().__MAHJONG_TEST_BOT_CLAIM_DELAY_MS__ = 0;
    for (let i = 0; i < 32; i++) {
      expect(botClaimDelayMs()).toBe(0);
    }
    pacingGlobals().__MAHJONG_TEST_BOT_CLAIM_DELAY_MS__ = 250;
    for (let i = 0; i < 32; i++) {
      expect(botClaimDelayMs()).toBe(250);
    }
  });

  it('falls back to the random range when the override is non-numeric', () => {
    (pacingGlobals() as unknown as Record<string, unknown>).__MAHJONG_TEST_BOT_CLAIM_DELAY_MS__ =
      null;
    const sample = botClaimDelayMs();
    expect(sample).toBeGreaterThanOrEqual(DEFAULT_BOT_CLAIM_MIN_MS);
    expect(sample).toBeLessThan(DEFAULT_BOT_CLAIM_MAX_MS);
  });
});

describe('pacing override constants', () => {
  it('exposes production defaults that align with the design handoff', () => {
    // Pinned so a refactor that mistakenly halves the floor — or
    // narrows the bot-stagger window — lands red instead of silently
    // shrinking the user's read time.
    expect(DEFAULT_CLAIM_FLOOR_MS).toBe(3_000);
    expect(DEFAULT_BOT_CLAIM_MIN_MS).toBe(2_000);
    expect(DEFAULT_BOT_CLAIM_MAX_MS).toBe(6_000);
  });
});
