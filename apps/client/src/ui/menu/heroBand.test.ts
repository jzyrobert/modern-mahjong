import { beforeEach, describe, expect, test } from 'vitest';
import {
  HERO_GAP_BOTTOM_PX,
  HERO_GAP_TOP_PX,
  getHeroBand,
  heroBandVersion,
  heroBox,
  resetHeroBand,
  setHeroBand,
  subscribeHeroBand,
} from './heroBand';

describe('hero band store', () => {
  beforeEach(() => resetHeroBand());

  test('publishes accepted rects and notifies once per change', () => {
    let calls = 0;
    subscribeHeroBand(() => calls++);
    setHeroBand({ x: 16, y: 136, w: 380, h: 140 });
    expect(getHeroBand()).toEqual({ x: 16, y: 136, w: 380, h: 140 });
    expect(calls).toBe(1);
    // Sub-pixel jitter from a re-measure is not a change.
    setHeroBand({ x: 16.4, y: 136.2, w: 380, h: 140.6 });
    expect(calls).toBe(1);
    expect(heroBandVersion()).toBe(1);
    // A real move is.
    setHeroBand({ x: 16, y: 150, w: 380, h: 140 });
    expect(calls).toBe(2);
    expect(getHeroBand()?.y).toBe(150);
    // Clearing notifies once; clearing again is a no-op.
    setHeroBand(null);
    setHeroBand(null);
    expect(getHeroBand()).toBeNull();
    expect(calls).toBe(3);
  });

  test('ignores empty rects (an unlaid-out slot)', () => {
    setHeroBand({ x: 0, y: 0, w: 0, h: 120 });
    expect(getHeroBand()).toBeNull();
    expect(heroBandVersion()).toBe(0);
  });

  test('heroBox insets the band by the title / card clearances and rejects degenerate bands', () => {
    expect(heroBox({ x: 16, y: 136, w: 380, h: 140 })).toEqual({
      x: 16,
      y: 136 + HERO_GAP_TOP_PX,
      w: 380,
      h: 140 - HERO_GAP_TOP_PX - HERO_GAP_BOTTOM_PX,
    });
    expect(heroBox({ x: 16, y: 136, w: 380, h: 40 })).toBeNull();
    expect(heroBox({ x: 16, y: 136, w: 60, h: 140 })).toBeNull();
    expect(heroBox(null)).toBeNull();
    expect(heroBox(undefined)).toBeNull();
  });
});
