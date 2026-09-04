import { describe, expect, test } from 'vitest';
import { FELT_SKINS, TILE_BACK_SKINS } from '../../ui/match/skins';
import {
  blendOver,
  contrastRatio,
  deltaE,
  gradientDeltaE,
  hexToRgb,
  nearestDeltaE,
  rgbToLab,
} from './colorMath';

describe('colorMath', () => {
  test('hex parsing handles long and short forms', () => {
    expect(hexToRgb('#7fa9c1')).toEqual([127, 169, 193]);
    expect(hexToRgb('fff')).toEqual([255, 255, 255]);
  });

  test('Lab of white / black / mid grey', () => {
    expect(rgbToLab([255, 255, 255])[0]).toBeCloseTo(100, 0);
    expect(rgbToLab([0, 0, 0])[0]).toBeCloseTo(0, 0);
    const [, a, b] = rgbToLab([128, 128, 128]);
    expect(Math.abs(a)).toBeLessThan(0.5);
    expect(Math.abs(b)).toBeLessThan(0.5);
  });

  test('ΔE is zero for identical colours and grows with distance', () => {
    const blue = hexToRgb(TILE_BACK_SKINS.blue.top);
    expect(deltaE(blue, blue)).toBe(0);
    // Round 1's washed-out preview back vs the skin's top stop.
    expect(deltaE([163, 190, 202], blue)).toBeGreaterThan(8);
    // A one-step nudge is well under a just-noticeable difference.
    expect(deltaE([128, 169, 193], blue)).toBeLessThan(1);
  });

  test('nearestDeltaE picks the closer of a skin’s two stops', () => {
    const plum = TILE_BACK_SKINS.plum;
    const stops = [hexToRgb(plum.top), hexToRgb(plum.bottom)];
    expect(nearestDeltaE(hexToRgb(plum.bottom), stops)).toBe(0);
    expect(nearestDeltaE(hexToRgb(plum.top), stops)).toBe(0);
  });

  test('gradientDeltaE is zero anywhere along the gradient and bounded by the stops', () => {
    const plum = TILE_BACK_SKINS.plum;
    const top = hexToRgb(plum.top);
    const bottom = hexToRgb(plum.bottom);
    const mid: [number, number, number] = [
      (top[0] + bottom[0]) / 2,
      (top[1] + bottom[1]) / 2,
      (top[2] + bottom[2]) / 2,
    ];
    expect(gradientDeltaE(mid, top, bottom)).toBeLessThan(0.2);
    expect(gradientDeltaE(top, top, bottom)).toBe(0);
    // A pixel 30 % of the way down the gradient is far from both stops
    // (> 5) yet on the gradient itself.
    const inBetween: [number, number, number] = [175, 114, 173];
    expect(nearestDeltaE(inBetween, [top, bottom])).toBeGreaterThan(4);
    expect(gradientDeltaE(inBetween, top, bottom)).toBeLessThan(1.5);
    // Never below the point-wise minimum.
    expect(gradientDeltaE([255, 255, 255], top, bottom)).toBeGreaterThan(20);
  });

  test('muted panel text clears 4.5:1 on the glass sheet over every felt', () => {
    // Worst case: the sheet composited over the brightest felt top stop.
    const glassAlpha = 0.76;
    const glass: [number, number, number] = [14, 20, 17];
    for (const skin of Object.values(FELT_SKINS)) {
      const sheet = blendOver(glass, glassAlpha, hexToRgb(skin.top));
      const muted = blendOver([255, 255, 255], 0.58, sheet);
      expect(contrastRatio(muted, sheet)).toBeGreaterThan(4.5);
    }
  });
});
