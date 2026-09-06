import { botDisplayName } from '@mahjong/protocol';
import type { BrowserContext } from '@playwright/test';
import { expect, test } from './_helpers';
import { type TestServerHandle, startTestServer } from './test-server/server.js';

/**
 * Online lobby host controls: with the all-seats-filled gate on
 * `startHand` (added in #195), a host who can't gather four humans
 * needs to fill the empty seats with bots from the `LobbySeatControls`
 * picker. This spec drives that loop end-to-end against an in-process
 * test server wrapping the real `MatchSession`:
 *   1. One player joins, sees three open seats and a disabled
 *      "Start match" button (because seats 1-3 are empty).
 *   2. Picker fills each empty seat with a bot. Lobby preview updates
 *      with the new bot names; "Start match" enables.
 *   3. Removing one bot puts the seat back to "Open seat…" and
 *      re-disables "Start match".
 *   4. Re-seat the bot, click "Start match" — the engine deals tiles
 *      and the wall-count HUD appears.
 */

const MATCH_CODE = 'BOTSL';

let server: TestServerHandle;
let serverUrl: string;

test.beforeAll(async () => {
  server = await startTestServer(0);
  serverUrl = `ws://127.0.0.1:${server.port}`;
});

test.afterAll(async () => {
  await server.close();
});

test('host can fill empty seats with bots and start the hand', async ({ browser }) => {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => {
    localStorage.setItem('mahjong.playerId', 'p-host');
    localStorage.setItem('mahjong.displayName', 'Hostling');
  });
  const page = await ctx.newPage();
  try {
    await page.goto(`/?serverUrl=${encodeURIComponent(serverUrl)}`);
    await page.getByLabel('Match code').fill(MATCH_CODE);
    await page.getByRole('button', { name: 'Join match' }).click();
    await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible({ timeout: 10_000 });

    // Three open seats — start button disabled, hint visible.
    const startBtn = page.getByRole('button', { name: 'Start match' });
    await expect(startBtn).toBeDisabled();
    await expect(
      page.getByText('Fill every seat with a player or a bot before starting.', { exact: true }),
    ).toBeVisible();

    // Picker is visible; rows for seats 1, 2, 3.
    await expect(page.getByText('Bot skill', { exact: true })).toBeVisible();
    await page.getByLabel('Set seat 1 to Smart').click();
    await page.getByLabel('Set seat 2 to Standard').click();
    await page.getByLabel('Set seat 3 to Easy').click();

    // Lobby preview reflects the new bot names. Server projects the
    // bot kind back through the lobby broadcast.
    await expect(page.getByText(botDisplayName('heuristic'), { exact: true })).toBeVisible();
    await expect(page.getByText(botDisplayName('simple'), { exact: true })).toBeVisible();
    await expect(page.getByText(botDisplayName('passive'), { exact: true })).toBeVisible();

    // Now every seat is filled; start button enables.
    await expect(startBtn).toBeEnabled();

    // Remove the seat-2 bot — start button re-disables, hint reappears,
    // and LobbyPreview's seat-2 card flips back to the dashed "Open
    // seat…" affordance (the visual that was missing pre-fix and made
    // the click look like it had done nothing).
    await page.getByLabel('Remove bot from seat 2').click();
    await expect(startBtn).toBeDisabled();
    await expect(page.getByText(botDisplayName('simple'), { exact: true })).toBeHidden();
    await expect(page.getByText('Open seat…', { exact: true })).toBeVisible();

    // Re-seat seat 2 with a different kind, then start the hand.
    await page.getByLabel('Set seat 2 to Easy').click();
    await expect(page.getByText(botDisplayName('passive'), { exact: true })).toHaveCount(2);
    await expect(startBtn).toBeEnabled();
    await startBtn.click();

    // Engine has dealt — wall-count HUD appears.
    await expect(page.getByText(/\d+ left/)).toBeVisible({ timeout: 10_000 });
  } finally {
    await ctx.close();
  }
});
