import { expect, test } from './_helpers';

/**
 * The "claim missed" toast surfaces when a server `PHASE` error
 * follows a recent meaningful claim — the hard-fallback race case
 * in multiplayer. Reproducing the actual race deterministically
 * inside an e2e would require coordinating server-side timing
 * (and solo doesn't have a hard fallback), so this spec exercises
 * the rendering pathway directly via the `flashClaimMissed` store
 * action exposed through `__MAHJONG_TEST_GET_STATE__`.
 */
test('claim-missed toast renders and self-dismisses', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();

  // Sanity: lobby → match transitioned (status bar present).
  await expect(page.getByText(/\d+ tiles in wall/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('Claim missed — round already resolved')).toBeHidden();

  // Trigger the toast through the same store action `transport-context`
  // calls on a `PHASE` error.
  await page.evaluate(() => {
    const store = (
      globalThis as {
        __MAHJONG_TEST_GET_STATE__?: () => { flashClaimMissed: () => void };
      }
    ).__MAHJONG_TEST_GET_STATE__?.();
    store?.flashClaimMissed();
  });

  await expect(page.getByText('Claim missed — round already resolved')).toBeVisible({
    timeout: 2_000,
  });

  // Self-dismisses after the toast duration (3.5s + fade tail; allow up to 6s).
  await expect(page.getByText('Claim missed — round already resolved')).toBeHidden({
    timeout: 6_000,
  });
});
