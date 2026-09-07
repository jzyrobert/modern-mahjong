import { describe, expect, test } from 'vitest';
import {
  getRiverInterior,
  publishRiverInterior,
  riverInteriorVersion,
  subscribeRiverInterior,
} from './sceneRects';

describe('sceneRects: river interior', () => {
  test('publishes a copy, bumps the version and notifies once per accepted write', () => {
    let calls = 0;
    const off = subscribeRiverInterior(() => calls++);
    const v0 = riverInteriorVersion();
    const b = { left: 10, top: 20, right: 300, bottom: 400 };
    publishRiverInterior(b);
    expect(getRiverInterior()).toEqual(b);
    expect(getRiverInterior()).not.toBe(b);
    expect(riverInteriorVersion()).toBe(v0 + 1);
    expect(calls).toBe(1);
    // Sub-half-pixel jitter from the camera settling is a no-op.
    publishRiverInterior({ left: 10.2, top: 20.1, right: 299.8, bottom: 400.3 });
    expect(riverInteriorVersion()).toBe(v0 + 1);
    expect(calls).toBe(1);
    publishRiverInterior({ left: 10, top: 20, right: 300, bottom: 420 });
    expect(riverInteriorVersion()).toBe(v0 + 2);
    expect(calls).toBe(2);
    publishRiverInterior(null);
    expect(getRiverInterior()).toBeNull();
    expect(calls).toBe(3);
    publishRiverInterior(null);
    expect(calls).toBe(3);
    off();
    publishRiverInterior(b);
    expect(calls).toBe(3);
    publishRiverInterior(null);
  });
});
