import { type GameState, TOTAL_TILES, emptyState, startHand, tileId } from '@mahjong/game-logic';
import { PerspectiveCamera } from 'three';
import { afterEach, describe, expect, test } from 'vitest';
import {
  SPOTLIGHT_MAX,
  SPOTLIGHT_MIN,
  SPOTLIGHT_STATIC,
  Spotlight,
  applySpotlight,
  spotlightPulse,
} from './Spotlight';
import {
  boxCorners,
  clearSpotlightTiles,
  getSpotlightTiles,
  projectToRect,
  setSpotlightTiles,
  spotlightVersion,
  subscribeSpotlightTiles,
  tilesForTarget,
} from './targets';

afterEach(() => clearSpotlightTiles());

describe('spotlight store', () => {
  test('dedupes, sorts, drops out-of-range ids and bumps the version once', () => {
    const v0 = spotlightVersion();
    setSpotlightTiles([5, 3, 5, 200, -1, 3.5]);
    expect(getSpotlightTiles()).toEqual([3, 5]);
    expect(spotlightVersion()).toBe(v0 + 1);
    // Same content → no version bump, no notify.
    let calls = 0;
    const off = subscribeSpotlightTiles(() => calls++);
    setSpotlightTiles([5, 3]);
    expect(spotlightVersion()).toBe(v0 + 1);
    expect(calls).toBe(0);
    setSpotlightTiles([7]);
    expect(calls).toBe(1);
    off();
    setSpotlightTiles([8]);
    expect(calls).toBe(1);
  });

  test('clear empties the list', () => {
    setSpotlightTiles([1, 2]);
    clearSpotlightTiles();
    expect(getSpotlightTiles()).toEqual([]);
  });
});

describe('tilesForTarget', () => {
  const state: GameState = startHand(emptyState(), 5, 0).state;

  test("own-hand → the seat's hand ids; wall-draw → the tile the engine pops next", () => {
    expect(tilesForTarget('own-hand', state, 0)).toEqual(state.hands[0].map(tileId));
    const last = state.wall[state.wall.length - 1];
    expect(last).toBeDefined();
    expect(tilesForTarget('wall-draw', state, 0)).toEqual([tileId(last!)]);
  });

  test('chrome targets and missing state map to no tiles', () => {
    expect(tilesForTarget('menu-pill', state, 0)).toEqual([]);
    expect(tilesForTarget('result-panel', state, 0)).toEqual([]);
    expect(tilesForTarget(undefined, state, 0)).toEqual([]);
    expect(tilesForTarget('own-hand', null, 0)).toEqual([]);
  });
});

describe('spotlightPulse / applySpotlight', () => {
  test('pulse breathes within bounds over a 1.6 s period and is static under reduced motion', () => {
    expect(spotlightPulse(0, false)).toBeCloseTo(SPOTLIGHT_MIN, 5);
    expect(spotlightPulse(800, false)).toBeCloseTo(SPOTLIGHT_MAX, 5);
    expect(spotlightPulse(1600, false)).toBeCloseTo(SPOTLIGHT_MIN, 5);
    for (let t = 0; t < 3200; t += 37) {
      const v = spotlightPulse(t, false);
      expect(v).toBeGreaterThanOrEqual(SPOTLIGHT_MIN - 1e-9);
      expect(v).toBeLessThanOrEqual(SPOTLIGHT_MAX + 1e-9);
    }
    expect(spotlightPulse(123, true)).toBe(SPOTLIGHT_STATIC);
    expect(spotlightPulse(999, true)).toBe(SPOTLIGHT_STATIC);
  });

  test('applySpotlight lights listed tiles, zeroes the rest and reports changes', () => {
    const pool = {
      poses: Array.from({ length: TOTAL_TILES }, () => ({ highlight: 0 })),
      dirty: 0,
      markDirty() {
        this.dirty++;
      },
    };
    expect(applySpotlight(pool, [4, 9], 0.7)).toBe(true);
    expect(pool.poses[4]?.highlight).toBe(0.7);
    expect(pool.poses[9]?.highlight).toBe(0.7);
    expect(pool.poses[5]?.highlight).toBe(0);
    expect(pool.dirty).toBe(1);
    // Identical write → no change, no dirty bump.
    expect(applySpotlight(pool, [4, 9], 0.7)).toBe(false);
    expect(pool.dirty).toBe(1);
    // Removing a tile from the set zeroes it.
    expect(applySpotlight(pool, [4], 0.7)).toBe(true);
    expect(pool.poses[9]?.highlight).toBe(0);
  });

  test('Spotlight driver follows the store and idles when empty', () => {
    const pool = {
      poses: Array.from({ length: TOTAL_TILES }, () => ({ highlight: 0 })),
      markDirty() {},
    };
    const s = new Spotlight(pool, false);
    expect(s.update(0)).toBe(false);
    setSpotlightTiles([12]);
    expect(s.update(800)).toBe(true);
    expect(pool.poses[12]?.highlight).toBeCloseTo(SPOTLIGHT_MAX, 5);
    clearSpotlightTiles();
    expect(s.update(900)).toBe(false);
    expect(pool.poses[12]?.highlight).toBe(0);
    const still = new Spotlight(pool, true);
    setSpotlightTiles([1]);
    expect(still.update(0)).toBe(false);
    expect(pool.poses[1]?.highlight).toBe(SPOTLIGHT_STATIC);
    still.dispose();
    expect(pool.poses[1]?.highlight).toBe(0);
  });
});

describe('projectToRect', () => {
  test('a box in front of the camera projects to a centred rect; behind → null', () => {
    const cam = new PerspectiveCamera(45, 2, 0.1, 100);
    cam.position.set(0, 0, 10);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
    const rect = projectToRect(
      boxCorners({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0.1 }),
      cam,
      800,
      400,
    );
    expect(rect).not.toBeNull();
    expect(rect!.x + rect!.w / 2).toBeCloseTo(400, 3);
    expect(rect!.y + rect!.h / 2).toBeCloseTo(200, 3);
    expect(rect!.w).toBeGreaterThan(10);
    expect(rect!.h).toBeGreaterThan(10);
    expect(projectToRect([{ x: 0, y: 0, z: 200 }], cam, 800, 400)).toBeNull();
  });
});
