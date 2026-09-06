/**
 * Pure layout rules for the in-match sheets (☰ menu, game log, tile
 * reference, scoring rules, players, scoring breakdown, settings) —
 * where a sheet sits on the viewport and when its body must show a
 * scroll cue. No React / RN imports so vitest drives it directly; the
 * React side is `useSheetPlacement` and `SheetBody`.
 */
export type SheetPlacement = 'bottom' | 'center';

/**
 * Mirrors `Match.tsx`'s shell breakpoint: at or past it the shell is
 * the desktop one and a phone bottom-sheet pasted onto a 1440 × 900
 * canvas reads as a phone UI on a desktop (round-5 settings critic).
 * A landscape phone (915 × 412) is wide but short and keeps the sheet.
 */
export const SHEET_WIDE_MIN_WIDTH = 768;
export const SHEET_WIDE_MIN_HEIGHT = 600;

export function isWideSheetViewport(width: number, height: number): boolean {
  return width >= SHEET_WIDE_MIN_WIDTH && height >= SHEET_WIDE_MIN_HEIGHT;
}

/** Bottom sheet on phones (thumb reach); a centred panel on wide viewports. */
export function sheetPlacementFor(width: number, height: number): SheetPlacement {
  return isWideSheetViewport(width, height) ? 'center' : 'bottom';
}

/**
 * Cap on a sheet's height as a fraction of the viewport. Portrait phones
 * stop at 78 % so the table's top rail and the status pill stay in view
 * above the sheet (round-6 settings critic: the sheet had crept up to
 * 90 %, its top 70 CSS px from the edge on a 700 px phone); a landscape
 * phone is too short to give up more than the centred panel's 10 %, and
 * the centred / side panels keep theirs. A sheet whose content is
 * shorter than the cap is content-sized — the cap is a ceiling.
 */
export const SHEET_MAX_FRAC = 0.9;
export const SHEET_PHONE_MAX_FRAC = 0.78;

export function sheetMaxHeightFrac(width: number, height: number): number {
  if (sheetPlacementFor(width, height) === 'bottom' && height >= SHEET_WIDE_MIN_HEIGHT)
    return SHEET_PHONE_MAX_FRAC;
  return SHEET_MAX_FRAC;
}

/** Height of the fade that marks a scrollable body's fold, CSS px. */
export const SHEET_FADE_PX = 40;
/**
 * The fade's lower part is a near-opaque strip the fold chevron sits
 * in: the body's copy scrolls *under* the strip, never through the
 * glyph. A 40 px ramp over translucent glass left the last row ~60 %
 * visible under the chevron (round-6 settings critic, `settings-skins`
 * / `match-scoring-rules` at phone). Same ≥ 0.94 alpha rule as the
 * sticky bars over the hero rack.
 */
export const SHEET_CUE_STRIP_PX = 16;
export const SHEET_CUE_STRIP_ALPHA = 0.96;

/**
 * CSS gradient for the fold cue over an `r,g,b` sheet fill: transparent
 * at the top, the strip's alpha from `SHEET_FADE_PX − SHEET_CUE_STRIP_PX`
 * down, so the bottom `SHEET_CUE_STRIP_PX` are a flat band.
 */
export function sheetCueGradient(rgb: string): string {
  const stripAt = Math.round(((SHEET_FADE_PX - SHEET_CUE_STRIP_PX) / SHEET_FADE_PX) * 100);
  const solid = `rgba(${rgb},${SHEET_CUE_STRIP_ALPHA})`;
  return `linear-gradient(180deg, rgba(${rgb},0) 0%, ${solid} ${stripAt}%, ${solid} 100%)`;
}

/** Alpha of the fold cue `t` (0..1) of the way down the fade: the ramp
 *  reaches the strip's alpha at the strip and holds it. Native's stepped
 *  fallback samples this. */
export function sheetCueAlphaAt(t: number): number {
  const ramp = (SHEET_FADE_PX - SHEET_CUE_STRIP_PX) / SHEET_FADE_PX;
  return SHEET_CUE_STRIP_ALPHA * Math.min(1, Math.max(0, t) / ramp);
}
/** Content hidden below the fold by less than this shows no cue — a
 *  row's bottom padding is not "more to read". */
export const SHEET_CUE_SLACK_PX = 6;

/** CSS px of body content still below the fold (never negative). */
export function sheetOverflowBelow(layoutH: number, contentH: number, scrollY: number): number {
  if (!(layoutH > 0) || !(contentH > 0)) return 0;
  return Math.max(0, contentH - layoutH - Math.max(0, scrollY));
}

/** Whether the body needs its bottom fade: more than the slack is hidden. */
export function sheetShowsCue(layoutH: number, contentH: number, scrollY: number): boolean {
  return sheetOverflowBelow(layoutH, contentH, scrollY) > SHEET_CUE_SLACK_PX;
}

/** Example-hand tile width bounds and the gap between tiles, CSS px. */
const EXAMPLE_TILE_MAX_W = 24;
const EXAMPLE_TILE_MIN_W = 14;
export const EXAMPLE_TILE_GAP = 4;
/** Gap before the winning tile plus its highlight frame (2 px pad + 1 px border, both sides). */
const EXAMPLE_WIN_EXTRA = 6 + 6;

/**
 * Tile width that lays `count` concealed tiles plus the winning tile on
 * one row of `rowWidth` px (the row's own padding already removed),
 * clamped to 14..24. The row holds `count + 2` flex children (the
 * spacer before the winning tile is one), so `count + 1` gaps sit
 * between them. A 14-tile hand at 24 px needs ~400 px and wrapped
 * 11 + 3 on a 412 px phone (round-5 settings critic); on a 324 px row
 * this lands at 18 px.
 */
export function exampleTileWidth(rowWidth: number, count: number): number {
  if (!(rowWidth > 0)) return EXAMPLE_TILE_MAX_W;
  const n = count + 1;
  const w = Math.floor((rowWidth - EXAMPLE_WIN_EXTRA - EXAMPLE_TILE_GAP * n) / n);
  return Math.max(EXAMPLE_TILE_MIN_W, Math.min(EXAMPLE_TILE_MAX_W, w));
}
