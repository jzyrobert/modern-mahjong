import type { Page } from '@playwright/test';
import { expect, test } from './_helpers';

/**
 * Solo matches run entirely in-process — no server-side session to
 * snapshot/restore. The previous AppState handler close()'d the
 * transport on every backgrounding, then `joinSolo()` on resume
 * created a FRESH `emptyState` match, throwing away the user's
 * in-progress hand. With "no turn timer" rules a solo player could
 * step away mid-turn and come back to a stranded "Waiting for the
 * game to start…" screen.
 *
 * Drive the AppState lifecycle by dispatching `visibilitychange` on
 * the document — RN-Web's AppState shim reads `document.visibilityState`
 * and listens to that event. Verify the engine state survives the
 * simulated background/foreground round-trip.
 */

const TEST_SEED = 5;

test.use({ viewport: { width: 412, height: 906 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript((seed) => {
    (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
  }, TEST_SEED);
});

test('solo: backgrounding the tab mid-hand preserves the engine state', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await dismissOpeningRolls(page);
  await expect(page.getByText(/\d+ tiles/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('own-hand-tile').first()).toBeVisible({ timeout: 10_000 });

  const wallBefore = await readWallCount(page);
  const handBefore = await page.getByTestId('own-hand-tile').count();

  // Simulate Android Chrome / iOS Safari backgrounding the tab. RN-Web's
  // AppState reads `document.visibilityState` + listens for
  // `visibilitychange`; spoof both.
  await setVisibility(page, 'hidden');
  await page.waitForTimeout(300);
  await setVisibility(page, 'visible');
  await page.waitForTimeout(500);

  // The wall count + hand count must match exactly — same engine state
  // we left. A regression to the close-and-rejoin path would deal a
  // fresh hand (different wall count, dealer + 13 hand-tile reset).
  await expect(page.getByText(/\d+ tiles/)).toBeVisible();
  expect(await readWallCount(page)).toBe(wallBefore);
  expect(await page.getByTestId('own-hand-tile').count()).toBe(handBefore);

  // And the user can still discard — i.e. the transport's message
  // listeners + the responder + the action send-path all survived.
  await page.getByTestId('own-hand-tile').first().click();
  await expect.poll(() => readWallCount(page), { timeout: 10_000 }).toBeLessThan(wallBefore);
});

async function dismissOpeningRolls(page: Page) {
  const dialog = page.getByText('Opening rolls');
  if (await dialog.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await page.mouse.click(206, 400);
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  }
}

async function setVisibility(page: Page, state: 'hidden' | 'visible') {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => s,
    });
    Object.defineProperty(document, 'hidden', {
      configurable: true,
      get: () => s === 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}

async function readWallCount(page: Page): Promise<number> {
  const text = await page.getByText(/\d+ tiles/).innerText();
  const m = text.match(/(\d+)\s*tiles/);
  return m ? Number.parseInt(m[1]!, 10) : Number.NaN;
}
