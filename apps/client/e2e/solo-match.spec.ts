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

async function readWallCount(page: Page): Promise<number> {
  const text = await page.getByText(/Wall:\s*\d+/).innerText();
  const m = text.match(/Wall:\s*(\d+)/);
  return m ? Number.parseInt(m[1]!, 10) : Number.NaN;
}
