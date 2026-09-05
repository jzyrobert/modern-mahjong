import { afterEach, describe, expect, test } from 'vitest';
import { publishDriftDebug, resetMenuDebugForTests, setHeroDebugProvider } from './menuDebug';

describe('menu debug seam', () => {
  afterEach(() => resetMenuDebugForTests());

  test('hero rects read in window coordinates from the canvas’s live rect at read time', () => {
    let top = 300;
    setHeroDebugProvider({
      canvasRect: () => ({ x: 16, y: top, w: 380, h: 140 }),
      rack: () => ({ x: 10, y: 20, w: 300, h: 100 }),
      rackGoal: () => ({ x: 11, y: 21, w: 300, h: 100 }),
      diceRects: () => [{ x: 5, y: 6, r: 7 }],
      dice: () => [1, 0.95],
      dicePlaceRuns: () => 2,
      dicePlaceRects: () => 9,
      viewOffsetApplies: () => 3,
      heroBuilds: () => 1,
    });
    const d = globalThis.__MAHJONG_MENU_DEBUG__;
    expect(d?.rack).toEqual({ x: 26, y: 320, w: 300, h: 100 });
    expect(d?.rackGoal).toEqual({ x: 27, y: 321, w: 300, h: 100 });
    expect(d?.band).toEqual({ x: 16, y: 300, w: 380, h: 140 });
    expect(d?.diceRects).toEqual([{ x: 21, y: 306, r: 7 }]);
    expect(d?.viewOffsetApplies).toBe(3);
    // The page scrolls 120 px: the same object now reads the moved rack
    // — nothing had to re-render or re-publish.
    top = 180;
    expect(d?.rack.y).toBe(200);
    expect(d?.band?.y).toBe(180);
    // JSON serialisation (what Playwright's evaluate does) sees the getters.
    expect(JSON.parse(JSON.stringify(d)).rack.y).toBe(200);
  });

  test('drift values merge with the hero getters; either half alone still publishes', () => {
    publishDriftDebug({
      occluders: 3,
      occluderRects: [],
      reseeded: true,
      visible: 14,
      parked: 2,
      fades: [1, 0.5],
      tiles: [],
    });
    expect(globalThis.__MAHJONG_MENU_DEBUG__?.occluders).toBe(3);
    expect(globalThis.__MAHJONG_MENU_DEBUG__?.band).toBeNull();
    expect(globalThis.__MAHJONG_MENU_DEBUG__?.dice).toEqual([]);
    setHeroDebugProvider({
      canvasRect: () => ({ x: 0, y: 0, w: 1, h: 1 }),
      rack: () => ({ x: 0, y: 0, w: 1, h: 1 }),
      rackGoal: () => null,
      diceRects: () => [],
      dice: () => [1, 1],
      dicePlaceRuns: () => 0,
      dicePlaceRects: () => 0,
      viewOffsetApplies: () => 1,
      heroBuilds: () => 1,
    });
    expect(globalThis.__MAHJONG_MENU_DEBUG__?.reseeded).toBe(true);
    expect(globalThis.__MAHJONG_MENU_DEBUG__?.dice).toEqual([1, 1]);
    publishDriftDebug(null);
    expect(globalThis.__MAHJONG_MENU_DEBUG__?.occluders).toBe(0);
    expect(globalThis.__MAHJONG_MENU_DEBUG__?.dice).toEqual([1, 1]);
    setHeroDebugProvider(null);
    expect(globalThis.__MAHJONG_MENU_DEBUG__).toBeUndefined();
  });
});
