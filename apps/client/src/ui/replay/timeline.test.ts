import { describe, expect, test } from 'vitest';
import type { ReplayChapter } from './chapters';
import { shortChapterResult } from './chapters';
import { pressX, ratioToX, timelineSegments, xToCursor, xToRatio } from './timeline';

function chapter(from: number, to: number, current: boolean, index = 1): ReplayChapter {
  return {
    from,
    to,
    seq: Math.round(from * 189),
    index,
    wind: '東',
    label: `HAND ${index}`,
    result: current ? 'IN PROGRESS' : 'Pending',
    current,
    pending: !current && from > 0.5,
  };
}

// The seed-5 fixture: hand 1 covers cursors 0..104 of 190, hand 2 the rest.
const TWO_HANDS = [chapter(0, 105 / 189, true, 1), chapter(105 / 189, 1, false, 2)];

describe('timeline mapping', () => {
  test('compact: the current card is twice its share and the playhead follows the card edges', () => {
    const segs = timelineSegments(TWO_HANDS, true);
    expect(segs[0]!.weight).toBeCloseTo((105 / 189) * 2, 6);
    const width = 400;
    const cardsW = width - 3;
    const edge = (segs[0]!.weight / (segs[0]!.weight + segs[1]!.weight)) * cardsW;
    // Cursor 105 (the first frame of hand 2) sits at the start of card 2.
    expect(ratioToX(segs, 105 / 189, width)).toBeCloseTo(edge + 3, 6);
    // Cursor 99 is 94 % through hand 1: 94 % across card 1, not 52 % of the strip.
    const x99 = ratioToX(segs, 99 / 189, width);
    expect(x99 / edge).toBeCloseTo(99 / 105, 6);
    expect(x99).toBeGreaterThan(width * 0.6);
  });

  test('x → ratio is the inverse of ratio → x inside every card', () => {
    for (const compact of [false, true]) {
      const segs = timelineSegments(TWO_HANDS, compact);
      for (const r of [0, 0.1, 0.3, 105 / 189, 0.7, 0.95, 1]) {
        const x = ratioToX(segs, r, 320);
        expect(xToRatio(segs, x, 320)).toBeCloseTo(r, 6);
      }
    }
  });

  test('taps map to finite, clamped, monotonic cursors; the gap snaps to an edge', () => {
    const segs = timelineSegments(TWO_HANDS, true);
    const total = 190;
    const quarter = xToCursor(segs, 100, 400, total);
    const threeQ = xToCursor(segs, 300, 400, total);
    expect(Number.isInteger(quarter)).toBe(true);
    expect(quarter).toBeGreaterThan(0);
    expect(threeQ).toBeGreaterThan(quarter);
    expect(threeQ).toBeLessThanOrEqual(total - 1);
    expect(xToCursor(segs, -50, 400, total)).toBe(0);
    expect(xToCursor(segs, 9999, 400, total)).toBe(total - 1);
    // Garbage in → frame 0, never NaN.
    expect(xToCursor(segs, Number.NaN, 400, total)).toBe(0);
    expect(xToCursor(segs, 100, 0, total)).toBe(0);
    expect(xToCursor([], 200, 400, total)).toBe(Math.round(0.5 * (total - 1)));
    // A tap in the 3 px gap lands on a card edge.
    const cardsW = 397;
    const edge = (segs[0]!.weight / (segs[0]!.weight + segs[1]!.weight)) * cardsW;
    expect(xToRatio(segs, edge + 0.5, 400)).toBeCloseTo(105 / 189, 6);
    expect(xToRatio(segs, edge + 2.5, 400)).toBeCloseTo(105 / 189, 6);
  });

  test('a single chapter maps linearly', () => {
    const segs = timelineSegments([chapter(0, 1, true)], true);
    expect(ratioToX(segs, 0.25, 200)).toBeCloseTo(50, 6);
    expect(xToCursor(segs, 150, 200, 101)).toBe(75);
  });
});

describe('pressX', () => {
  test('native locationX wins', () => {
    expect(pressX({ locationX: 42, offsetX: 7 })).toBe(42);
  });
  test('web: clientX against the element rect, else offsetX, else null', () => {
    expect(pressX({ clientX: 150, offsetX: 7 }, 100)).toBe(50);
    expect(pressX({ pageX: 130 }, 100)).toBe(30);
    expect(pressX({ offsetX: 7 })).toBe(7);
    expect(pressX({ offsetX: 7 }, 100)).toBe(7);
    expect(pressX({})).toBeNull();
    expect(pressX({ locationX: Number.NaN, offsetX: Number.NaN })).toBeNull();
    expect(pressX(null)).toBeNull();
  });
});

describe('shortChapterResult', () => {
  test('compacts the win phrasing and drops the self-draw suffix', () => {
    expect(shortChapterResult('Mei Ling wins 1 faan (self-draw)')).toBe('Mei Ling wins · 1 faan');
    expect(shortChapterResult('Robert wins 5 faan')).toBe('Robert wins · 5 faan');
    expect(shortChapterResult('Drawn game')).toBe('Drawn game');
    expect(shortChapterResult('IN PROGRESS')).toBe('IN PROGRESS');
  });
});
