import { describe, expect, it } from 'vitest';
import {
  EXAMPLE_TILE_GAP,
  SHEET_CUE_SLACK_PX,
  exampleTileWidth,
  isWideSheetViewport,
  sheetOverflowBelow,
  sheetPlacementFor,
  sheetShowsCue,
} from './sheetLayout';

describe('sheetPlacementFor', () => {
  it('centres the sheet on desktop-class viewports', () => {
    expect(sheetPlacementFor(1440, 900)).toBe('center');
    expect(sheetPlacementFor(834, 1194)).toBe('center');
    expect(isWideSheetViewport(768, 600)).toBe(true);
  });

  it('keeps the bottom sheet on phones, landscape included', () => {
    expect(sheetPlacementFor(412, 915)).toBe('bottom');
    expect(sheetPlacementFor(360, 640)).toBe('bottom');
    // Wide but short: a landscape phone is still a phone.
    expect(sheetPlacementFor(915, 412)).toBe('bottom');
    expect(sheetPlacementFor(767, 900)).toBe('bottom');
  });
});

describe('sheet scroll cue', () => {
  it('measures what is still hidden below the fold', () => {
    expect(sheetOverflowBelow(300, 500, 0)).toBe(200);
    expect(sheetOverflowBelow(300, 500, 120)).toBe(80);
    expect(sheetOverflowBelow(300, 500, 200)).toBe(0);
    // Over-scroll (iOS bounce) never goes negative.
    expect(sheetOverflowBelow(300, 500, 260)).toBe(0);
    expect(sheetOverflowBelow(300, 500, -40)).toBe(200);
  });

  it('is silent before the body has measured and when the content fits', () => {
    expect(sheetOverflowBelow(0, 500, 0)).toBe(0);
    expect(sheetOverflowBelow(300, 0, 0)).toBe(0);
    expect(sheetShowsCue(300, 300, 0)).toBe(false);
    expect(sheetShowsCue(300, 250, 0)).toBe(false);
  });

  it('shows the cue only past the padding slack and clears at the end', () => {
    expect(sheetShowsCue(300, 300 + SHEET_CUE_SLACK_PX, 0)).toBe(false);
    expect(sheetShowsCue(300, 300 + SHEET_CUE_SLACK_PX + 1, 0)).toBe(true);
    expect(sheetShowsCue(300, 900, 0)).toBe(true);
    expect(sheetShowsCue(300, 900, 596)).toBe(false);
  });
});

describe('exampleTileWidth', () => {
  it('keeps a 14-tile hand on one row of a phone sheet', () => {
    // 412 px phone: sheet 14 + card 10 + rule 12 + felt 8 padding a side.
    const row = 412 - 2 * (14 + 10 + 12 + 8);
    const w = exampleTileWidth(row, 13);
    expect(w).toBe(18);
    // 13 tiles + spacer + winning tile: 14 gaps, 12 px of spacer + frame.
    expect(14 * w + 14 * EXAMPLE_TILE_GAP + 12).toBeLessThanOrEqual(row);
    // The 360 px phone: still one row.
    const small = 360 - 2 * (14 + 10 + 12 + 8);
    const ws = exampleTileWidth(small, 13);
    expect(14 * ws + 14 * EXAMPLE_TILE_GAP + 12).toBeLessThanOrEqual(small);
  });

  it('caps at the classic 24 px on wide rows and never drops under 14', () => {
    expect(exampleTileWidth(600, 13)).toBe(24);
    expect(exampleTileWidth(120, 13)).toBe(14);
    // Before the row has measured: the classic size.
    expect(exampleTileWidth(0, 13)).toBe(24);
  });
});
