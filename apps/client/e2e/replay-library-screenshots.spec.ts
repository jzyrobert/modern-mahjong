import { clearReplayStorage, expect, test } from './_helpers';

/**
 * Captures replay-library screenshots at mobile-portrait and
 * desktop viewports so PRs touching the library page can attach
 * before/after comparisons. Mirrors `replay-screenshots.spec.ts` —
 * output PNGs land under
 * `e2e-output/replay-library/{label}/{view}.png`. `label` is the
 * `REPLAY_SHOT_LABEL` env var (default `current`).
 *
 * Builds two saved replays so the date-group header renders with
 * `2 matches` instead of falling into the single-row edge case the
 * existing spec covers.
 */

const TEST_SEED = 5;
const LABEL = process.env.REPLAY_SHOT_LABEL ?? 'current';
const SHOT_DIR = `e2e-output/replay-library/${LABEL}`;

test.beforeEach(async ({ page }) => {
  await clearReplayStorage(page);
  await page.addInitScript((seed) => {
    (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
  }, TEST_SEED);
});

async function buildOneReplay(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();

  // Drive a few rounds so the saved record has multiple frames.
  for (let i = 0; i < 3; i++) {
    const ownTile = page.getByTestId('own-hand-tile').first();
    if (await ownTile.isVisible().catch(() => false)) {
      await ownTile.click().catch(() => {});
    }
    await page.waitForTimeout(2_500);
  }

  await page.getByLabel('Open menu').click();
  await page.getByRole('button', { name: /^Save this match$/ }).click();
  await expect(page.getByRole('button', { name: /^Saved · tap to discard$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Leave match' }).click();
  await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible({
    timeout: 10_000,
  });
}

async function openLibrary(page: import('@playwright/test').Page): Promise<void> {
  // Phone-class viewports (412×906) route to `MobileLobby`, which
  // demotes Replays from an "Open library" CTA to a tappable
  // SecondaryRow ("Replays"). Match either so portrait + desktop
  // both work.
  await page.getByRole('button', { name: /^(Open library|Replays)$/ }).click();
  await expect(page.getByRole('heading', { name: 'Replays' })).toBeVisible();
}

test('replay library screenshots: portrait', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 906 });
  await buildOneReplay(page);
  await buildOneReplay(page);
  await openLibrary(page);
  await page.screenshot({ path: `${SHOT_DIR}/portrait.png`, fullPage: false });
});

test('replay library screenshots: desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await buildOneReplay(page);
  await buildOneReplay(page);
  await openLibrary(page);
  await page.screenshot({ path: `${SHOT_DIR}/desktop.png`, fullPage: false });
});
