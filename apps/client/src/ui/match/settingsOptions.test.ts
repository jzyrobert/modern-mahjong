import { describe, expect, test } from 'vitest';
import {
  QUALITY_OPTIONS,
  RENDERER_HINT,
  RENDERER_OPTIONS,
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
});
