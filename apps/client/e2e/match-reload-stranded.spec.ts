import { expect, test } from '@playwright/test';

/**
 * Reloading the page while inside an offline (solo / practice) match
 * leaves the client without a usable engine state — solo transports are
 * just an in-memory bot loop, so they evaporate on a fresh page load.
 * Before this fix, `/match` would render "Waiting for the game to
 * start…" indefinitely with no recovery affordance. This spec pins
 * down the new behaviour: a "No active match" screen with a "Back to
 * main menu" button that returns the user to `/`.
 */

const TEST_SEED = 5;

test.beforeEach(async ({ page }) => {
  await page.addInitScript((seed) => {
    (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
  }, TEST_SEED);
});

test('reloading inside a solo match shows a recovery screen + back button', async ({ page }) => {
  // Get into a live solo match so we know `/match` is the active route.
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  // Wait for a tile in the dealer's hand to confirm the engine has dealt.
  await expect(page.getByTestId('own-hand-tile').first()).toBeVisible({ timeout: 10_000 });

  // Reload — the in-memory solo transport dies. URL stays at /match.
  await page.reload();

  // The recovery UI shows up.
  await expect(page.getByRole('heading', { name: 'No active match' })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText(/practice and LAN matches don't survive a reload/i)).toBeVisible();

  // Pressing "Back to main menu" returns to the lobby.
  await page.getByRole('button', { name: 'Back to main menu' }).click();
  await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible({
    timeout: 5_000,
  });
});

test('navigating directly to /match with no session shows the same recovery', async ({ page }) => {
  await page.goto('/match');
  await expect(page.getByRole('heading', { name: 'No active match' })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole('button', { name: 'Back to main menu' }).click();
  await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible({
    timeout: 5_000,
  });
});
