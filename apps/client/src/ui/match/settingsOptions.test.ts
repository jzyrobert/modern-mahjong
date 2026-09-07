import { describe, expect, test } from 'vitest';
import {
  CHIP_METRICS,
  QUALITY_OPTIONS,
  RENDERER_HINT,
  RENDERER_OPTIONS,
  chipGrid,
  chipMinWidth,
  qualityHint,
  rendererDetail,
} from './settingsOptions';

describe('settings option copy', () => {
  test('renderer + quality option lists cover every setting value once', () => {
    expect(RENDERER_OPTIONS.map((o) => o.value)).toEqual(['auto', '3d', 'classic']);
    expect(QUALITY_OPTIONS.map((o) => o.value)).toEqual(['auto', 'low', 'mid', 'high']);
    expect(new Set(RENDERER_OPTIONS.map((o) => o.label)).size).toBe(RENDERER_OPTIONS.length);
    expect(new Set(QUALITY_OPTIONS.map((o) => o.label)).size).toBe(QUALITY_OPTIONS.length);
  });

  test('renderer hint is the agreed one-liner', () => {
    expect(RENDERER_HINT).toBe('3D needs WebGL2; Classic is the original table.');
  });

  test('renderer detail warns when WebGL2 is missing', () => {
    expect(rendererDetail('auto', true)).toMatch(/3D/);
    expect(rendererDetail('auto', false)).toMatch(/Classic/);
    expect(rendererDetail('3d', false)).toMatch(/WebGL2/);
    expect(rendererDetail('classic', true)).toMatch(/original/i);
  });

  test('every quality tier has a non-empty hint', () => {
    for (const o of QUALITY_OPTIONS) {
      expect(qualityHint(o.value).length).toBeGreaterThan(10);
    }
  });

  test('a session override explains why the pill disagrees with the setting', () => {
    const q = rendererDetail('auto', true, { value: 'classic', source: 'query' });
    expect(q).toContain('Overridden to Classic');
    expect(q).toContain('?renderer=classic');
    const t = rendererDetail('classic', true, { value: '3d', source: 'test' });
    expect(t).toContain('Overridden to 3D');
    expect(t).toContain('test harness');
    // No override → the setting-only copy, unchanged.
    expect(rendererDetail('auto', true, null)).toBe(rendererDetail('auto', true));
  });

  test('chip labels never need more than the pill can hold', () => {
    // Tile-back chips (22 px swatch): the longest label is "Cream".
    const min = chipMinWidth(['Cream', 'Blue', 'Plum', 'Mint'], {
      ...CHIP_METRICS,
      swatchWidth: 22,
    });
    // swatch + paddings + border + 5 chars × 8.5.
    expect(min).toBe(22 + 6 + 10 + 14 + 4 + 5 * 8.5);
    // Every layout the grid returns hands each chip at least that much.
    for (const w of [300, 332, 384, 404, 572, 900]) {
      const { columns, chipWidth } = chipGrid(w, 4, min, 8);
      expect(columns).toBeGreaterThan(0);
      expect(chipWidth).toBeGreaterThanOrEqual(min - 1);
      expect(columns * chipWidth + (columns - 1) * 8).toBeLessThanOrEqual(w);
    }
  });

  test('chip grid keeps rows even and wraps at phone widths', () => {
    const min = chipMinWidth(['Cream', 'Blue', 'Plum', 'Mint'], {
      ...CHIP_METRICS,
      swatchWidth: 22,
    });
    // 360 px phone (332 px content): three would fit, so it drops to 2 × 2.
    expect(chipGrid(332, 4, min, 8).columns).toBe(2);
    // 412 px phone (384 px content): same 2 × 2.
    expect(chipGrid(384, 4, min, 8).columns).toBe(2);
    // Phone landscape sheet (572 px content): one row of four.
    expect(chipGrid(572, 4, min, 8).columns).toBe(4);
    // A count with no even split wider than one column goes ragged.
    expect(chipGrid(332, 5, min, 8).columns).toBe(3);
    // Too narrow for two → one column, never zero.
    expect(chipGrid(120, 4, min, 8)).toEqual({ columns: 1, chipWidth: 120 });
    // Unmeasured row → 0 columns (caller falls back to content sizing).
    expect(chipGrid(0, 4, min, 8).columns).toBe(0);
  });
});
