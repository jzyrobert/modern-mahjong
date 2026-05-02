import { type Page, expect, test } from '@playwright/test';

test('solo match: lobby → match, user discards, bots take over', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

  await page.getByRole('button', { name: 'Play vs bots' }).click();

  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible();
  await page.getByRole('button', { name: 'Start match' }).click();

  // Engine has dealt — HUD shows the live wall.
  await expect(page.getByText(/Wall:\s*\d+/)).toBeVisible();
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
  // pulsing draw-tile surfaces in the center HUD. (The old "Draw" button is
  // gone — this is the only way to advance.)
  const drawTile = page.getByRole('button', { name: 'Draw a tile' });
  await expect(drawTile).toBeVisible({ timeout: 30_000 });
  await drawTile.click();
  await expect(drawTile).toBeHidden();
});

async function readWallCount(page: Page): Promise<number> {
  const text = await page.getByText(/Wall:\s*\d+/).innerText();
  const m = text.match(/Wall:\s*(\d+)/);
  return m ? Number.parseInt(m[1]!, 10) : Number.NaN;
}
