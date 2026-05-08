import { expect, test } from './_helpers';

/**
 * Regression: leaving a solo match and starting another played the
 * between-hand shuffle ceremony on the new match's first hand.
 *
 * Root cause: `ShuffleOverlay` is mounted in `app/_layout.tsx` —
 * the root layout — so its `lastSeed` ref persists across route
 * changes (the overlay never unmounts). When the user left match 1,
 * `state` was cleared to null but the ref still held the old seed.
 * The next match's first `startHand` pushed a different seed, the
 * effect saw `lastSeed.current !== seed`, and the shuffle fired.
 *
 * Fix: when `state.seed` becomes undefined (state cleared on
 * leave / reset), drop `lastSeed.current` so the next seed is read
 * as a session start, not a between-hand transition.
 */

const TEST_SEED = 5;

test.beforeEach(async ({ page }) => {
  await page.addInitScript((seed) => {
    (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
  }, TEST_SEED);
});

test('solo: leaving and starting a fresh match does not play the shuffle ceremony', async ({
  page,
}) => {
  // Match 1.
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.getByTestId('own-hand-tile').first()).toBeVisible({ timeout: 10_000 });

  // Leave the match — handler is the lobby's `Leave` button on the
  // dealer's pre-discard screen, but we're already past
  // `Start match` so use the in-match menu's `Leave match` row.
  await page.setViewportSize({ width: 412, height: 906 });
  await page.getByLabel('Open menu').click();
  await page.getByRole('button', { name: 'Leave match' }).click();
  await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible({
    timeout: 5_000,
  });

  // Match 2.
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();

  // The shuffle ceremony lifecycle is ~1.7s and the "Shuffling…" text
  // is the load-bearing identifier. If the bug regresses, the
  // overlay would race the dice ceremony on hand-start. Wait long
  // enough for any racey trigger to render and assert the text was
  // never seen.
  let sawShuffle = false;
  for (let i = 0; i < 8; i++) {
    if (
      await page
        .getByText('Shuffling…')
        .isVisible()
        .catch(() => false)
    ) {
      sawShuffle = true;
      break;
    }
    await page.waitForTimeout(150);
  }
  expect(sawShuffle).toBe(false);

  // Sanity check that match 2 actually started (we're not just
  // sitting on the lobby).
  await expect(page.getByTestId('own-hand-tile').first()).toBeVisible({ timeout: 10_000 });
});
