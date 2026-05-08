import { expect, test } from './_helpers';

/**
 * Solo per-turn timeout enforcement. The user reported that
 * configuring `turnTimeoutMs > 0` in the lobby should still trigger
 * a countdown badge + auto-discard in solo, the same way it does
 * online — solo's in-process bot loop has no Cloudflare alarm, so
 * the transport itself owns the timer.
 *
 * Setup uses the `__MAHJONG_TEST_TURN_TIMEOUT_MS__` global
 * (`apps/client/src/net/solo-transport.ts`) so the deadline can be
 * cut below the lobby's 5s minimum without making the test slow.
 *
 * What we lock in:
 *   1. The active-seat badge surfaces "Ns left" while the timer
 *      runs — proves the engine is stamping `state.turnDeadlineMs`
 *      and the UI is reading it (i.e. solo isn't stripping the rule).
 *   2. The user's hand drops a tile without any input, on the
 *      timer firing. With seed 5 the user starts as dealer holding
 *      14 tiles; after the auto-discard they hold 13.
 */

const TEST_SEED = 5;

test('solo: turn timeout shows the countdown and auto-discards a tile', async ({ page }) => {
  // Cut the timer well below the 5s lobby minimum so the test runs
  // in seconds. Bot pace stays at 0 so other seats process instantly.
  await page.addInitScript(() => {
    (
      globalThis as { __MAHJONG_TEST_TURN_TIMEOUT_MS__?: number }
    ).__MAHJONG_TEST_TURN_TIMEOUT_MS__ = 800;
    (globalThis as { __MAHJONG_TEST_BOT_PACE_MS__?: number }).__MAHJONG_TEST_BOT_PACE_MS__ = 0;
  });
  await page.addInitScript((seed) => {
    (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
  }, TEST_SEED);

  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  // Dealer (user) gets 14 tiles up front and must discard to hand
  // the turn off; this is the moment the turn timer is armed.
  await expect(page.getByTestId('own-hand-tile').nth(13)).toBeVisible({ timeout: 10_000 });
  const initialTiles = await page.getByTestId('own-hand-tile').count();
  expect(initialTiles).toBe(14);

  // Countdown badge surfaces. The seconds-remaining text uses the
  // "Ns left" format from PlayerBadge; assert via regex so we don't
  // race the value transition (e.g. "1s left" vs "0s left").
  await expect(page.getByText(/\d+s left/).first()).toBeVisible({ timeout: 5_000 });

  // Wait past the deadline. The auto-discard fires inside the solo
  // transport when the timer elapses; the user's hand drops to 13.
  await expect
    .poll(() => page.getByTestId('own-hand-tile').count(), {
      timeout: 5_000,
      message: 'User hand never auto-discarded after the turn timer expired',
    })
    .toBeLessThan(initialTiles);
});
