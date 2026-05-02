import { type Page, expect, test } from '@playwright/test';

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
  // advance the user's turn.)
  const drawTile = page.getByTestId('wall-draw-next');
  await expect(drawTile).toBeVisible({ timeout: 30_000 });
  await drawTile.click();
  await expect(drawTile).toBeHidden();
});

async function readWallCount(page: Page): Promise<number> {
  const text = await page.getByText(/\d+ left/).innerText();
  const m = text.match(/(\d+)\s*left/);
  return m ? Number.parseInt(m[1]!, 10) : Number.NaN;
}
