import { describe, expect, it } from 'vitest';
import {
  exceedsDragThreshold,
  keyboardMoveIndex,
  moveIndex,
  nearestSlotIndex,
  slotsFromRects,
} from './dragReorder';

const rect = (left: number, top: number, w = 40, h = 56) => ({ left, top, width: w, height: h });

describe('slotsFromRects', () => {
  it('orders a single row left to right regardless of input order', () => {
    const { order, centres } = slotsFromRects([
      { id: 7, rect: rect(200, 500) },
      { id: 3, rect: rect(100, 500) },
      { id: 9, rect: rect(300, 501) },
    ]);
    expect(order).toEqual([3, 7, 9]);
    expect(centres.map((c) => c.x)).toEqual([120, 220, 320]);
  });

  it('puts the back (upper) row before the front row for the portrait hand', () => {
    const { order } = slotsFromRects([
      { id: 20, rect: rect(60, 600) },
      { id: 21, rect: rect(110, 600) },
      { id: 10, rect: rect(60, 520) },
      { id: 11, rect: rect(110, 520) },
      { id: 12, rect: rect(160, 522) },
    ]);
    expect(order).toEqual([10, 11, 12, 20, 21]);
  });
});

describe('nearestSlotIndex', () => {
  const centres = [
    { x: 100, y: 100 },
    { x: 150, y: 100 },
    { x: 200, y: 100 },
    { x: 100, y: 180 },
    { x: 150, y: 180 },
  ];
  it('picks the slot whose centre the pointer has crossed', () => {
    expect(nearestSlotIndex(centres, { x: 124, y: 100 })).toBe(0);
    expect(nearestSlotIndex(centres, { x: 126, y: 100 })).toBe(1);
    expect(nearestSlotIndex(centres, { x: 400, y: 90 })).toBe(2);
  });
  it('resolves across rows in 2D, not by x alone', () => {
    expect(nearestSlotIndex(centres, { x: 100, y: 170 })).toBe(3);
    expect(nearestSlotIndex(centres, { x: 200, y: 175 })).toBe(4);
  });
  it('returns -1 with no slots', () => {
    expect(nearestSlotIndex([], { x: 0, y: 0 })).toBe(-1);
  });
});

describe('moveIndex', () => {
  const ids = [1, 2, 3, 4, 5];
  it('moves forward and backward like the classic Hand.onReorder', () => {
    expect(moveIndex(ids, 0, 3)).toEqual([2, 3, 4, 1, 5]);
    expect(moveIndex(ids, 4, 1)).toEqual([1, 5, 2, 3, 4]);
  });
  it('returns the same array for a no-op or out-of-range move', () => {
    expect(moveIndex(ids, 2, 2)).toBe(ids);
    expect(moveIndex(ids, -1, 2)).toBe(ids);
    expect(moveIndex(ids, 1, 5)).toBe(ids);
  });
});

describe('exceedsDragThreshold', () => {
  it('needs more than 6 px of travel by default', () => {
    expect(exceedsDragThreshold(4, 4)).toBe(false);
    expect(exceedsDragThreshold(7, 0)).toBe(true);
    expect(exceedsDragThreshold(0, -7)).toBe(true);
  });
});

describe('keyboardMoveIndex', () => {
  const centres = [
    { x: 100, y: 100 },
    { x: 150, y: 100 },
    { x: 200, y: 100 },
    { x: 125, y: 180 },
    { x: 175, y: 180 },
  ];
  it('steps along the display order and stops at the ends', () => {
    expect(keyboardMoveIndex(centres, 1, 'ArrowLeft')).toBe(0);
    expect(keyboardMoveIndex(centres, 1, 'ArrowRight')).toBe(2);
    expect(keyboardMoveIndex(centres, 0, 'ArrowLeft')).toBeNull();
    expect(keyboardMoveIndex(centres, 4, 'ArrowRight')).toBeNull();
  });
  it('jumps to the nearest slot on the other row', () => {
    expect(keyboardMoveIndex(centres, 0, 'ArrowDown')).toBe(3);
    expect(keyboardMoveIndex(centres, 2, 'ArrowDown')).toBe(4);
    expect(keyboardMoveIndex(centres, 4, 'ArrowUp')).toBe(1);
    expect(keyboardMoveIndex(centres, 0, 'ArrowUp')).toBeNull();
  });
});
