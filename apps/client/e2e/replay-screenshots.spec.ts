import { clearReplayStorage, expect, test } from './_helpers';

/**
 * Captures replay-screen screenshots at mobile-portrait and
 * mobile-landscape viewports so PRs touching the replay player can
 * attach before/after comparisons. Output PNGs land under
 * `e2e-output/replay/{label}/{view}.png` — `label` is read from the
 * `REPLAY_SHOT_LABEL` env var (default `current`) so a CI step can
 * run this twice (once on `main`, once on the PR head) and stash the
 * pair side-by-side.
 *
 * Uses the same `__MAHJONG_TEST_SEED__=5` pin the other solo specs
 * use so the replay frames are deterministic.
 */

const TEST_SEED = 5;
const LABEL = process.env.REPLAY_SHOT_LABEL ?? 'current';
const SHOT_DIR = `e2e-output/replay/${LABEL}`;

test.beforeEach(async ({ page }) => {
  await clearReplayStorage(page);
  await page.addInitScript((seed) => {
    (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
  }, TEST_SEED);
});

async function buildSampleReplay(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();

  // Drive a few rounds so the replay contains draws, discards, and
  // (probably) at least one claim window so the event-strip filter
  // has something to suppress.
  for (let i = 0; i < 3; i++) {
    const ownTile = page.getByTestId('own-hand-tile').first();
    if (await ownTile.isVisible().catch(() => false)) {
      await ownTile.click().catch(() => {});
    }
    await page.waitForTimeout(2_500);
  }

  // Save the match so we have a record to open from the library.
  await page.getByLabel('Open menu').click();
  await page.getByRole('button', { name: /^Save this match$/ }).click();
  await expect(page.getByRole('button', { name: /^Saved · tap to discard$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Leave match' }).click();
  await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible({
    timeout: 10_000,
  });

  // Phone-class viewports (412×906 portrait, 906×412 landscape)
  // route to `MobileLobby`, which renders Replays as a tappable
  // SecondaryRow ("Replays") instead of an "Open library" button.
  // Desktop keeps the button; this OR locator works at both sizes.
  await page.getByRole('button', { name: /^(Open library|Replays)$/ }).click();
  await expect(page.getByRole('heading', { name: 'Replays' })).toBeVisible();
  await page.getByText('SOLO', { exact: true }).first().click();
  await expect(page.getByLabel('Replay timeline')).toBeVisible();
}

test('replay screenshots: portrait', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 906 });
  await buildSampleReplay(page);

  // Step a few frames in so the discard pool + a seat hand are
  // populated — frame 0 is just the dealt board.
  for (let i = 0; i < 8; i++) {
    await page.getByLabel('Step forward').click();
    await page.waitForTimeout(50);
  }

  await page.screenshot({ path: `${SHOT_DIR}/portrait.png`, fullPage: false });
});

test('replay screenshots: landscape', async ({ page }) => {
  await page.setViewportSize({ width: 906, height: 412 });
  await buildSampleReplay(page);

  for (let i = 0; i < 8; i++) {
    await page.getByLabel('Step forward').click();
    await page.waitForTimeout(50);
  }

  await page.screenshot({ path: `${SHOT_DIR}/landscape.png`, fullPage: false });
});

test('replay screenshots: desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await buildSampleReplay(page);

  for (let i = 0; i < 8; i++) {
    await page.getByLabel('Step forward').click();
    await page.waitForTimeout(50);
  }

  await page.screenshot({ path: `${SHOT_DIR}/desktop.png`, fullPage: false });
});
