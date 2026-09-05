import { describe, expect, test } from 'vitest';
import { latchViewportHeight } from './viewportLatch';

describe('latchViewportHeight', () => {
  test('a height-only change (URL bar retracting mid-scroll) keeps the latched height', () => {
    const phone = { width: 412, height: 700 };
    expect(latchViewportHeight(phone, { width: 412, height: 800 })).toBe(phone);
    expect(latchViewportHeight(phone, { width: 412, height: 644 })).toBe(phone);
  });

  test('a width change (orientation flip, window drag) takes the live viewport', () => {
    const phone = { width: 412, height: 700 };
    const flipped = { width: 915, height: 412 };
    expect(latchViewportHeight(phone, flipped)).toBe(flipped);
    const dragged = { width: 500, height: 700 };
    expect(latchViewportHeight(phone, dragged)).toBe(dragged);
  });

  test('an unchanged viewport is the same object (no re-render churn)', () => {
    const v = { width: 1440, height: 900 };
    expect(latchViewportHeight(v, { width: 1440, height: 900 })).toBe(v);
  });
});
