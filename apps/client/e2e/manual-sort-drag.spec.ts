import type { Page } from '@playwright/test';
import { expect, test } from './_helpers';

/**
 * Manual sort mode lets the user drag a tile to a new index in their
 * own hand. The handler lives on `HandTile`'s PanResponder: a long-press
 * timer used to be the only path into drag mode, which on touch screens
 * was unreachable because finger jitter cancelled the timer before
 * 220 ms elapsed. After the fix, any movement past `TAP_MOVE_THRESHOLD`
 * on a draggable tile enters drag mode immediately. This spec walks the
 * mobile flow: Manual → grab tile 0 → drag past one tile width → release
 * → assert the first slot now holds what used to be tile 1.
 */

const TEST_SEED = 5;

test.use({ viewport: { width: 412, height: 906 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript((seed) => {
    (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
  }, TEST_SEED);
});

test('mobile manual sort: drag the first tile across one slot reorders the hand', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await dismissOpeningRolls(page);
  await expect(page.getByText(/\d+ tiles in wall/)).toBeVisible({ timeout: 10_000 });

  // Switch to MANUAL sort so the engine's auto-sort doesn't immediately
  // re-sort the hand back after we drop a tile.
  await page.getByText('MANUAL', { exact: true }).click();

  const before = await readHandSignatures(page);
  expect(before.length).toBeGreaterThan(2);

  // Drag tile 0 → past tile 1 → release. We use absolute mouse coords
  // because RN-Web's PanResponder maps onto pointer events, which
  // Playwright's `mouse.down/move/up` drives end-to-end.
  const tiles = page.getByTestId('own-hand-tile');
  const first = await tiles.first().boundingBox();
  const second = await tiles.nth(1).boundingBox();
  if (!first || !second) throw new Error('hand tile bounding boxes missing');

  // Source: centre of tile 0. Target: centre of tile 2 (jumps tile 1).
  const third = await tiles.nth(2).boundingBox();
  if (!third) throw new Error('third tile bounding box missing');
  const startX = first.x + first.width / 2;
  const startY = first.y + first.height / 2;
  const endX = third.x + third.width / 2;
  const endY = third.y + third.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // Several intermediate steps so the PanResponder Move handler fires
  // multiple times and crosses TAP_MOVE_THRESHOLD before the up event.
  await page.mouse.move(startX + 12, startY, { steps: 4 });
  await page.mouse.move(endX, endY, { steps: 12 });
  await page.mouse.up();

  // Sort mode is still MANUAL so the new order persists.
  const after = await readHandSignatures(page);
  expect(after.length).toBe(before.length);
  // The signatures themselves are the same set — just reordered. Assert
  // the FIRST slot now holds something different from before.
  expect(after[0]).not.toBe(before[0]);
});

async function dismissOpeningRolls(page: Page) {
  const dialog = page.getByText('Opening rolls');
  if (await dialog.isVisible({ timeout: 2_000 }).catch(() => false)) {
    // Click viewport centre — the legacy hard-coded (206, 400) was
    // tied to the 412 px mobile viewport; a desktop run with viewport
    // 1280 × 800 needs a centre that scales with the actual size.
    const size = page.viewportSize() ?? { width: 412, height: 906 };
    await page.mouse.click(Math.round(size.width / 2), Math.round(size.height / 2));
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  }
}

async function readHandSignatures(page: Page): Promise<string[]> {
  const tiles = page.getByTestId('own-hand-tile');
  const count = await tiles.count();
  const sigs: string[] = [];
  for (let i = 0; i < count; i++) {
    const inner = tiles.nth(i).locator('[aria-label]').first();
    const label = (await inner.getAttribute('aria-label')) ?? '';
    sigs.push(label);
  }
  return sigs;
}

// Desktop variant + outside-the-discard-window regression. The earlier
// gate folded "can drag" and "can tap-to-discard" into a single
// `interactive` flag in `Hand.tsx` that required `onTileClick` to be
// truthy — which `Match.tsx` only sets during the user's discard
// window (`myTurn && hasDrawn`). Result: on the desktop shell users
// couldn't reorganise their hand at all unless they happened to be
// mid-discard, and the `own-hand-tile` testID went missing whenever
// they weren't. This test sets a desktop viewport (≥ 768 × 600 →
// `<DesktopShell>` wins the layout switch in Match.tsx), discards
// once to leave the discard window, then drags in manual mode and
// asserts the order changed.
test.describe('desktop, outside discard window', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test('manual sort still reorders the hand after the discard window closes', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Play vs bots' }).click();
    await page.getByRole('button', { name: 'Start match' }).click();
    await dismissOpeningRolls(page);
    await expect(page.getByText(/\d+ tiles in wall/)).toBeVisible({ timeout: 10_000 });

    // Discard once so we're past our turn — the bots take over and
    // the user's `onTileClick` becomes undefined for the rest of the
    // claim window + bot turns. Pre-fix this dropped the
    // `own-hand-tile` testID and disabled drag entirely.
    await page.getByTestId('own-hand-tile').first().click();

    // Switch to MANUAL and immediately try to reorder. Don't wait for
    // bots to come back round — the whole point is that drag should
    // work while bots are playing.
    await page.getByText('MANUAL', { exact: true }).click();

    const before = await readHandSignatures(page);
    expect(before.length).toBeGreaterThan(2);

    const tiles = page.getByTestId('own-hand-tile');
    const first = await tiles.first().boundingBox();
    const third = await tiles.nth(2).boundingBox();
    if (!first || !third) throw new Error('hand tile bounding boxes missing');

    const startX = first.x + first.width / 2;
    const startY = first.y + first.height / 2;
    const endX = third.x + third.width / 2;
    const endY = third.y + third.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 12, startY, { steps: 4 });
    await page.mouse.move(endX, endY, { steps: 12 });
    await page.mouse.up();

    const after = await readHandSignatures(page);
    expect(after.length).toBe(before.length);
    expect(after[0]).not.toBe(before[0]);
  });
});

// Cross-row drag regression. On narrow phones (320 × 568 iPhone SE),
// the 14-tile dealer hand wraps onto two rows — the parent's flex-wrap
// fits ~7 tiles per row at the auto-fit minimum width. Pre-fix the
// drag math computed the target index from `g.dx` only and ignored
// `g.dy`, so dragging tile 0 down to row 1 actually placed it
// somewhere along row 0 (the user perceived it as "you can only drag
// along the same row"). The visual translateY also stayed pinned to
// the lift offset, so the tile didn't follow the finger vertically
// either. The fix combines `dragY` with the lift via Animated.add and
// uses (deltaCol, deltaRow) + tilesPerRow to compute the target
// index. This test drops tile 0 in row 1 and asserts the tile that
// used to be at index 0 actually ends up in the second row.
test.describe('narrow viewport, multi-row hand', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test('cross-row manual sort drag lands on the right slot', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Play vs bots' }).click();
    await page.getByRole('button', { name: 'Start match' }).click();
    await dismissOpeningRolls(page);
    await expect(page.getByText(/\d+ tiles in wall/)).toBeVisible({ timeout: 10_000 });

    await page.getByText('MANUAL', { exact: true }).click();

    const before = await readHandSignatures(page);
    expect(before.length).toBeGreaterThan(7); // at least one full row + one

    const tiles = page.getByTestId('own-hand-tile');

    // Confirm the layout actually wraps. Pull every tile's y and group
    // — if the hand fits on one row this test isn't testing what we
    // think it is, fail loudly.
    const ys: number[] = [];
    for (let i = 0; i < before.length; i++) {
      const box = await tiles.nth(i).boundingBox();
      if (box) ys.push(Math.round(box.y));
    }
    const distinctRows = new Set(ys);
    expect(distinctRows.size).toBeGreaterThan(1);

    const firstRowY = Math.min(...ys);
    const secondRowY = [...distinctRows].sort((a, b) => a - b)[1] as number;

    // Source: tile 0 (row 0, col 0). Target: a position firmly in
    // row 1 — pick the index that's at row 1, col 2 visually (so
    // we're crossing both axes, not just dropping straight down).
    const firstRowIndices = ys.map((y, i) => (y === firstRowY ? i : -1)).filter((i) => i >= 0);
    const secondRowIndices = ys.map((y, i) => (y === secondRowY ? i : -1)).filter((i) => i >= 0);
    expect(firstRowIndices.length).toBeGreaterThan(2);
    expect(secondRowIndices.length).toBeGreaterThan(2);

    // The reorder we're forcing: index 0 → index `targetIdx` (in row 1).
    // Pick the target as the 3rd tile in row 1 so we shift by 2 cols
    // AND 1 row.
    const targetIdx = secondRowIndices[2] as number;
    const sourceLabel = before[0];

    const sourceBox = await tiles.first().boundingBox();
    const targetBox = await tiles.nth(targetIdx).boundingBox();
    if (!sourceBox || !targetBox) throw new Error('tile bounding boxes missing');

    const startX = sourceBox.x + sourceBox.width / 2;
    const startY = sourceBox.y + sourceBox.height / 2;
    const endX = targetBox.x + targetBox.width / 2;
    const endY = targetBox.y + targetBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 12, startY, { steps: 4 });
    await page.mouse.move(endX, endY, { steps: 16 });
    await page.mouse.up();

    const after = await readHandSignatures(page);
    expect(after.length).toBe(before.length);

    // After the drag the source label should sit in row 1 of the
    // post-drag hand — i.e., at an index past the first row's tile
    // count (row 0 capacity stays the same, the source just lands
    // somewhere in row 1). Pre-fix it stayed in row 0 because g.dy
    // was ignored, so the new index would have been < perRow. We
    // assert against `firstRowIndices.length` rather than measuring
    // bounding-box y because the post-release spring takes a few
    // hundred ms to settle and Playwright's `boundingBox()` reads the
    // partially-transformed position; the engine's reorder ID is the
    // load-bearing signal regardless.
    const perRow = firstRowIndices.length;
    const newIdx = after.indexOf(sourceLabel ?? '');
    expect(newIdx).toBeGreaterThanOrEqual(perRow);
    void secondRowY;
  });
});
