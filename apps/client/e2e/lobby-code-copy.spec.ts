import { type BrowserContext, expect, test } from '@playwright/test';
import { type TestServerHandle, startTestServer } from './test-server/server.js';

/**
 * Tap the match-code badge in the waiting-room `LobbyPreview` →
 * code lands on the clipboard, badge briefly flips to a green
 * `COPIED` state. Uses an in-process MatchSession server so the
 * page actually reaches the waiting room (a real online match
 * code is required for the badge to render).
 */

const MATCH_CODE = 'COPIE';

let server: TestServerHandle;
let serverUrl: string;

test.beforeAll(async () => {
  server = await startTestServer(0);
  serverUrl = `ws://127.0.0.1:${server.port}`;
});

test.afterAll(async () => {
  await server.close();
});

test('tapping the match-code badge copies it + flashes COPIED', async ({ browser }) => {
  // Grant clipboard read/write so the test can assert the value.
  const ctx: BrowserContext = await browser.newContext({
    permissions: ['clipboard-read', 'clipboard-write'],
  });
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

    const copyBtn = page.getByRole('button', { name: `Copy match code ${MATCH_CODE}` });
    await expect(copyBtn).toBeVisible();
    await copyBtn.click();

    // Pill flips to COPIED + clipboard holds the value.
    await expect(page.getByText('COPIED', { exact: true })).toBeVisible();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toBe(MATCH_CODE);

    // 1.5s auto-dismiss: the COPY label returns.
    await expect(page.getByText('COPY', { exact: true })).toBeVisible({ timeout: 3_000 });
  } finally {
    await ctx.close();
  }
});
