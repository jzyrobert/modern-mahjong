import { expect, test } from './_helpers';

/**
 * Solo matches survive a browser reload. Before this fix the
 * in-memory bot loop evaporated on reload and `/match` showed the
 * "No active match" stranded screen. The fix mirrors the live
 * engine state to localStorage on every delta + lobby update
 * (`apps/client/src/state/solo-persist.ts`), pushes `?solo=1` onto
 * the URL whenever a solo transport is active
 * (`apps/client/app/index.tsx`), and rehydrates a fresh in-process
 * bot loop with the persisted snapshot when the route mounts cold
 * (`apps/client/app/match.tsx` → `transport.joinSoloResume`).
 *
 * What we lock in here:
 *   1. The URL flips to `/match?solo=1` once the user is in a solo
 *      match.
 *   2. Reloading mid-hand keeps the same wall count and the same
 *      hand size — i.e. the engine state is not re-dealt.
 *   3. The bot loop continues after reload (a discard from the
 *      user's hand still hands the turn off to the bots).
 */

const TEST_SEED = 5;

test.beforeEach(async ({ page }) => {
  await page.addInitScript((seed) => {
    (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
  }, TEST_SEED);
});

async function readWallCount(page: import('@playwright/test').Page): Promise<number> {
  const text = await page.getByText(/\d+ left/).textContent();
  if (!text) throw new Error('wall count not found');
  const match = text.match(/(\d+)\s*left/);
  if (!match) throw new Error(`unexpected wall-count text: ${text}`);
  return Number(match[1]);
}

test('solo: URL flips to /match?solo=1 once in-match', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page).toHaveURL(/\/match\?.*solo=1/, { timeout: 10_000 });
});

test('solo: reload mid-hand keeps the same engine state (wall count + hand size)', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page).toHaveURL(/\/match\?.*solo=1/, { timeout: 10_000 });
  await expect(page.getByText(/\d+ left/)).toBeVisible({ timeout: 10_000 });

  // Capture a fingerprint of the live state pre-reload.
  const wallBefore = await readWallCount(page);
  const handBefore = await page.getByTestId('own-hand-tile').count();
  expect(handBefore).toBeGreaterThan(0);

  await page.reload();

  // Same URL contract carries through; engine snapshot is rehydrated
  // from localStorage so the wall count + hand size match exactly.
  await expect(page).toHaveURL(/\/match\?.*solo=1/);
  await expect(page.getByText(/\d+ left/)).toBeVisible({ timeout: 10_000 });
  const wallAfter = await readWallCount(page);
  const handAfter = await page.getByTestId('own-hand-tile').count();
  expect(wallAfter).toBe(wallBefore);
  expect(handAfter).toBe(handBefore);
});

test('solo: bot loop resumes after reload — user discard hands turn back off', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.getByTestId('own-hand-tile').first()).toBeVisible({ timeout: 10_000 });

  await page.reload();
  await expect(page.getByTestId('own-hand-tile').first()).toBeVisible({ timeout: 10_000 });

  const initial = await readWallCount(page);
  await page.getByTestId('own-hand-tile').first().click();
  // After the user's discard the bot loop should resume — wall count
  // drops as bots draw on their turns.
  await expect
    .poll(() => readWallCount(page), {
      timeout: 30_000,
      message: 'Bot loop did not advance after reload + user discard',
    })
    .toBeLessThan(initial);
});

test('solo: dismissed dice ceremony stays dismissed after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();

  // Dismiss the opening dice ceremony explicitly (tap-to-dismiss).
  await expect(page.locator('text=Opening rolls').first()).toBeVisible({ timeout: 5_000 });
  await page.locator('text=Tap anywhere to dismiss').click();
  await expect(page.locator('text=Opening rolls').first()).toBeHidden({ timeout: 3_000 });

  // Reload the page. The engine snapshot is restored from
  // localStorage, but the dice ceremony's dismissed-seed must also
  // round-trip — otherwise the overlay re-pops on every reload.
  await page.reload();
  await expect(page.getByTestId('own-hand-tile').first()).toBeVisible({ timeout: 10_000 });
  // Wait long enough that any racey re-trigger would have rendered.
  await page.waitForTimeout(800);
  await expect(page.locator('text=Opening rolls').first()).toBeHidden();
});
