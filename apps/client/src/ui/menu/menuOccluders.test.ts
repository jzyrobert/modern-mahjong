import { afterEach, describe, expect, test } from 'vitest';
import {
  OCCLUDER_BAND_PX,
  type OccluderRect,
  getOccluders,
  occluderFactor,
  occluderVersion,
  rectSignedDistance,
  removeOccluder,
  resetOccluders,
  setOccluder,
  subscribeOccluders,
} from './menuOccluders';

const card: OccluderRect = { x: 100, y: 100, w: 200, h: 100, kind: 'glass' };
const footer: OccluderRect = { x: 0, y: 400, w: 400, h: 30, kind: 'solid' };

describe('menu occluders', () => {
  afterEach(() => resetOccluders());

  test('signed distance is negative inside, positive outside, zero on the edge', () => {
    expect(rectSignedDistance(200, 150, card)).toBe(-50);
    expect(rectSignedDistance(100, 150, card)).toBe(0);
    expect(rectSignedDistance(50, 150, card)).toBe(50);
    expect(rectSignedDistance(50, 50, card)).toBeCloseTo(Math.hypot(50, 50), 9);
  });

  test('glass: clear deep inside and far outside, zero while straddling the edge', () => {
    const r = 10;
    expect(occluderFactor(200, 150, r, [card])).toBe(1);
    expect(occluderFactor(200, 20, r, [card])).toBe(1);
    // Centre on the edge / within a tile radius of it → fully faded.
    expect(occluderFactor(100, 150, r, [card])).toBe(0);
    expect(occluderFactor(108, 150, r, [card])).toBe(0);
    // Ramps linearly over the band past the radius.
    expect(occluderFactor(100 - r - OCCLUDER_BAND_PX / 2, 150, r, [card])).toBeCloseTo(0.5, 9);
    expect(occluderFactor(100 - r - OCCLUDER_BAND_PX, 150, r, [card])).toBe(1);
  });

  test('two stacked glass cards empty the gap between them', () => {
    const below: OccluderRect = { ...card, y: 212 };
    // 12 px gap at y 200..212 — anywhere in it is within the band of an edge.
    for (const y of [201, 206, 211]) expect(occluderFactor(200, y, 6, [card, below])).toBe(0);
    // Deep inside either card is still clear.
    expect(occluderFactor(200, 150, 6, [card, below])).toBe(1);
    expect(occluderFactor(200, 262, 6, [card, below])).toBe(1);
  });

  test('solid: faded anywhere inside plus the band, clear beyond it', () => {
    expect(occluderFactor(200, 415, 8, [footer])).toBe(0);
    expect(occluderFactor(200, 400 - 8 - OCCLUDER_BAND_PX / 2, 8, [footer])).toBeCloseTo(0.5, 9);
    expect(occluderFactor(200, 300, 8, [footer])).toBe(1);
  });

  test('factor is the minimum over every rect and short-circuits at zero', () => {
    expect(occluderFactor(100, 415, 8, [card, footer])).toBe(0);
    expect(occluderFactor(200, 150, 8, [card, footer])).toBe(1);
    expect(occluderFactor(500, 500, 8, [])).toBe(1);
  });

  test('registry dedupes identical rects and notifies subscribers on change', () => {
    let fired = 0;
    const unsub = subscribeOccluders(() => fired++);
    const v0 = occluderVersion();
    setOccluder('a', card);
    setOccluder('a', { ...card });
    expect(fired).toBe(1);
    expect(occluderVersion()).toBe(v0 + 1);
    setOccluder('a', { ...card, y: 120 });
    expect(fired).toBe(2);
    expect(getOccluders()).toHaveLength(1);
    removeOccluder('a');
    removeOccluder('a');
    expect(fired).toBe(3);
    expect(getOccluders()).toEqual([]);
    unsub();
    setOccluder('b', footer);
    expect(fired).toBe(3);
  });

  test('glassInterior caps a disc fully inside a glass rect, leaves edges and solids alone', () => {
    // Deep inside the card: capped.
    expect(occluderFactor(200, 150, 6, [card], OCCLUDER_BAND_PX, 0.4)).toBe(0.4);
    expect(occluderFactor(200, 150, 6, [card], OCCLUDER_BAND_PX, 0)).toBe(0);
    // Straddling the edge still fades to nothing; the ramp never
    // exceeds the cap on the inside.
    expect(occluderFactor(100, 150, 6, [card], OCCLUDER_BAND_PX, 0.4)).toBe(0);
    expect(occluderFactor(100 + 6 + 6, 150, 6, [card], OCCLUDER_BAND_PX, 0.4)).toBeCloseTo(0.25, 9);
    // Outside the card the cap does not apply.
    expect(occluderFactor(20, 150, 6, [card], OCCLUDER_BAND_PX, 0.4)).toBe(1);
    // Solid rects are unaffected by the cap (already zero inside).
    expect(occluderFactor(200, 415, 8, [footer], OCCLUDER_BAND_PX, 0.4)).toBe(0);
  });
});
