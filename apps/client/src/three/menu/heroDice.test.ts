import { afterEach, describe, expect, test } from 'vitest';
import {
  getHeroDice,
  heroDiceVersion,
  publishHeroDice,
  resetHeroDice,
  subscribeHeroDice,
} from './heroDice';

describe('hero dice discs', () => {
  afterEach(() => resetHeroDice());

  test('publishes a copy, bumps the version and notifies on a real change only', () => {
    let calls = 0;
    subscribeHeroDice(() => calls++);
    const a = [
      { x: 10, y: 20, r: 5 },
      { x: 30, y: 20, r: 5 },
    ];
    publishHeroDice(a);
    expect(getHeroDice()).toEqual(a);
    expect(getHeroDice()).not.toBe(a);
    expect(heroDiceVersion()).toBe(1);
    expect(calls).toBe(1);
    // Sub-half-pixel jitter is not a change.
    publishHeroDice([
      { x: 10.3, y: 20.2, r: 5.1 },
      { x: 30, y: 20, r: 5 },
    ]);
    expect(heroDiceVersion()).toBe(1);
    expect(calls).toBe(1);
    // A nudge is.
    publishHeroDice([
      { x: 10, y: 12, r: 5 },
      { x: 30, y: 12, r: 5 },
    ]);
    expect(heroDiceVersion()).toBe(2);
    expect(calls).toBe(2);
    // Dispose clears.
    publishHeroDice([]);
    expect(getHeroDice()).toEqual([]);
    expect(heroDiceVersion()).toBe(3);
  });
});
