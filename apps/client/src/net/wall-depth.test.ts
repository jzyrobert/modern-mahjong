import { emptyState, soloRulesFrom, startHand } from '@mahjong/game-logic';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyTestWallDepth } from './solo-transport';

/**
 * Unit coverage for the `__MAHJONG_TEST_WALL_DEPTH__` global hatch.
 *
 * The hatch is consumed by `joinSoloTutorial` in
 * `transport-context.tsx` (via the `applyTestWallDepth` helper)
 * specifically so the `drawn-game` lesson can pin the wall to a small
 * value and exhaust it in a few turns. A natural wall drain takes
 * ~17 minutes of bot turns at production pacing, which is not a
 * lesson-shaped experience.
 *
 * These tests pin the contract the lesson depends on:
 *   - With the global set to a small N, a freshly-dealt tutorial state
 *     has `wall.length === N`.
 *   - The truncation keeps the top of the stack — `drawTile` pops the
 *     last entry, so the next `N` draws produce the same tiles as a
 *     non-truncated run for the same seed.
 *   - The hatch is symmetric across two consecutive applications
 *     (no hidden global state mutation between calls).
 *   - Unset / non-numeric / out-of-range overrides leave the wall
 *     untouched.
 *
 * The tutorial teardown clears the global in
 * `transport-context.tsx::teardown`; the symmetric `beforeEach` /
 * `afterEach` here mirror that contract so a flake in one case can't
 * leak depth into another.
 */

interface WallDepthGlobals {
  __MAHJONG_TEST_WALL_DEPTH__: number | undefined;
}

function depthGlobals(): WallDepthGlobals {
  return globalThis as unknown as WallDepthGlobals;
}

function buildTutorialState(seed: number) {
  return startHand(emptyState(soloRulesFrom()), seed, 0).state;
}

describe('applyTestWallDepth', () => {
  beforeEach(() => {
    depthGlobals().__MAHJONG_TEST_WALL_DEPTH__ = undefined;
  });
  afterEach(() => {
    depthGlobals().__MAHJONG_TEST_WALL_DEPTH__ = undefined;
  });

  it('truncates the wall to the requested depth when the global is set', () => {
    depthGlobals().__MAHJONG_TEST_WALL_DEPTH__ = 5;
    const base = buildTutorialState(5);
    expect(base.wall.length).toBeGreaterThan(5);
    const truncated = applyTestWallDepth(base);
    expect(truncated.wall.length).toBe(5);
  });

  it('keeps the top-of-stack — next draws match the untruncated wall', () => {
    const base = buildTutorialState(5);
    // `drawTile` pops the last entry; the next N draws are the last
    // N tiles of the original wall in reverse.
    const expectedNextDraws = base.wall.slice(-3);
    depthGlobals().__MAHJONG_TEST_WALL_DEPTH__ = 3;
    const truncated = applyTestWallDepth(base);
    expect(truncated.wall).toEqual(expectedNextDraws);
  });

  it('produces the same wall length on two consecutive applications', () => {
    depthGlobals().__MAHJONG_TEST_WALL_DEPTH__ = 5;
    const a = applyTestWallDepth(buildTutorialState(5));
    const b = applyTestWallDepth(buildTutorialState(5));
    expect(a.wall.length).toBe(5);
    expect(b.wall.length).toBe(5);
    // Deterministic startHand → same wall slice both times.
    expect(a.wall).toEqual(b.wall);
  });

  it('returns the state unchanged when the global is unset', () => {
    const base = buildTutorialState(5);
    const truncated = applyTestWallDepth(base);
    expect(truncated).toBe(base);
    expect(truncated.wall.length).toBe(base.wall.length);
  });

  it('returns the state unchanged when the depth exceeds the live wall', () => {
    depthGlobals().__MAHJONG_TEST_WALL_DEPTH__ = 9_999;
    const base = buildTutorialState(5);
    const truncated = applyTestWallDepth(base);
    expect(truncated).toBe(base);
    expect(truncated.wall.length).toBe(base.wall.length);
  });

  it('returns the state unchanged for a non-numeric override', () => {
    (depthGlobals() as unknown as Record<string, unknown>).__MAHJONG_TEST_WALL_DEPTH__ = null;
    const base = buildTutorialState(5);
    const truncated = applyTestWallDepth(base);
    expect(truncated).toBe(base);
  });

  it('returns the state unchanged for a negative depth', () => {
    depthGlobals().__MAHJONG_TEST_WALL_DEPTH__ = -1;
    const base = buildTutorialState(5);
    const truncated = applyTestWallDepth(base);
    expect(truncated).toBe(base);
  });
});
