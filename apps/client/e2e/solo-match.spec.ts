import type { Page } from '@playwright/test';
import { expect, test, waitForUserDrawCue } from './_helpers';

// Pin the lobby's `randomSeed()` to a value where the engine's opening
// dice roll lands seat 0 (the user) as dealer outright (sums: 10/5/6/8).
// Without this, dealer selection is non-deterministic and the test's
// "user has 14 tiles + must discard" precondition no longer holds.
const TEST_SEED = 5;

test.beforeEach(async ({ page }) => {
  await page.addInitScript((seed) => {
    (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
  }, TEST_SEED);
});

test('solo match: lobby → match, user discards, bots take over', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

  await page.getByRole('button', { name: 'Play vs bots' }).click();

  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
  await page.getByRole('button', { name: 'Start match' }).click();

  // Engine has dealt — HUD shows the live wall.
  await expect(page.getByText(/\d+ left/)).toBeVisible();
  const initial = await readWallCount(page);
  expect(initial).toBeGreaterThan(0);

  // The dealer (user, seat 0) is dealt 14 tiles, holding the turn until they
  // discard. Click any tile to hand the turn off to the bots, then verify
  // they actually play (wall count drops further).
  await page.getByTestId('own-hand-tile').first().click();

  await expect
    .poll(() => readWallCount(page), {
      timeout: 30_000,
      message: 'Wall count never decreased after user discard — bots may be stuck',
    })
    .toBeLessThan(initial);
});

test('after the first round-trip, the highlighted draw-tile pulls a new tile', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();

  // Hand turn off to bots.
  await page.getByTestId('own-hand-tile').first().click();

  // Once the turn comes back, the engine flips `hasDrawn` to false and the
  // wall's next tile surfaces as the highlighted draw target inside the
  // center HUD. (The old "Draw" button is gone — this is the only way to
  // advance the user's turn.) Solo's claim window is now infinite, so
  // we auto-pass any incidental claim opportunities on the way back.
  const drawTile = page.getByTestId('wall-draw-next');
  await waitForUserDrawCue(page, 30_000);
  await drawTile.click();
  await expect(drawTile).toBeHidden();

  // The freshly-drawn tile flows through DrawTileOverlay: HandTile renders
  // its slot at opacity 0 while the popup animates, then the overlay's
  // finish callback fires `clearDrawAnimation()` and the slot fades back
  // to opacity 1. The overlay must be mounted by whichever shell is
  // active for this to land — if it isn't (e.g. DesktopShell missed the
  // mount), `drawAnimation` stays set and the drawn slot is stuck
  // invisible forever. Total overlay duration is ~1160ms; allow a wide
  // margin so flake from animation scheduling doesn't false-fail.
  await expect
    .poll(
      async () =>
        page.getByTestId('own-hand-tile').evaluateAll((nodes) =>
          nodes.every((n) => {
            const op = Number.parseFloat(window.getComputedStyle(n).opacity);
            return Number.isFinite(op) && op > 0.5;
          }),
        ),
      { timeout: 4_000, message: 'A drawn hand tile stayed invisible — DrawTileOverlay never cleared drawAnimation' },
    )
    .toBe(true);
});

async function readWallCount(page: Page): Promise<number> {
  const text = await page.getByText(/\d+ left/).innerText();
  const m = text.match(/(\d+)\s*left/);
  return m ? Number.parseInt(m[1]!, 10) : Number.NaN;
}
