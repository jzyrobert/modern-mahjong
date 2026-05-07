import { type BrowserContext, type Page, expect, test } from '@playwright/test';
import { type TestServerHandle, startTestServer } from './test-server/server.js';

/**
 * Regression: brief screen locks used to disconnect the user from
 * online matches. The AppState `background` branch proactively
 * `transport.close()`'d on every visibility flip, so the server's
 * reconnect-grace timer started from the moment the screen locked.
 * If a guest happened to join while the user was backgrounded, the
 * user's old socket missed the broadcast — to them, "B joined and
 * removed me" — and only a manual rejoin reseated them.
 *
 * The proactive-close behaviour is now dropped: we let the OS
 * naturally suspend long-backgrounded sockets and rely on the
 * `closed` status flip + AppState foreground rejoin to recover.
 * Short locks now keep the WebSocket alive, so the user sees B's
 * arrival via the live broadcast as soon as the screen wakes.
 *
 * Driven by the same `visibilitychange` shim `solo-background-resume`
 * uses; RN-Web's AppState reads `document.visibilityState`.
 */

const MATCH_CODE = 'REJOI';

let server: TestServerHandle;
let serverUrl: string;

test.beforeAll(async () => {
  server = await startTestServer(0);
  serverUrl = `ws://127.0.0.1:${server.port}`;
});

test.afterAll(async () => {
  await server.close();
});

test('online: short background keeps the socket alive — host sees the guest on resume', async ({
  browser,
}) => {
  const aCtx: BrowserContext = await browser.newContext();
  const bCtx: BrowserContext = await browser.newContext();
  await aCtx.addInitScript(() => {
    localStorage.setItem('mahjong.playerId', 'p-host');
    localStorage.setItem('mahjong.displayName', 'Host');
  });
  await bCtx.addInitScript(() => {
    localStorage.setItem('mahjong.playerId', 'p-guest');
    localStorage.setItem('mahjong.displayName', 'Guest');
  });
  const aPage = await aCtx.newPage();
  const bPage = await bCtx.newPage();
  try {
    // A joins, lands on the waiting room with seat 0.
    await aPage.goto(`/?serverUrl=${encodeURIComponent(serverUrl)}`);
    await aPage.getByLabel('Match code').fill(MATCH_CODE);
    await aPage.getByRole('button', { name: 'Join match' }).click();
    await expect(aPage.getByRole('heading', { name: 'Lobby' })).toBeVisible({ timeout: 10_000 });
    await expect(aPage.getByText('Host', { exact: true })).toBeVisible();

    // A backgrounds the tab — server installs an auto-bot stand-in
    // and the client transport closes.
    await setVisibility(aPage, 'hidden');
    await aPage.waitForTimeout(400);

    // B joins while A is backgrounded; lands in seat 1.
    await bPage.goto(`/?serverUrl=${encodeURIComponent(serverUrl)}`);
    await bPage.getByLabel('Match code').fill(MATCH_CODE);
    await bPage.getByRole('button', { name: 'Join match' }).click();
    await expect(bPage.getByRole('heading', { name: 'Lobby' })).toBeVisible({ timeout: 10_000 });
    await expect(bPage.getByText('Guest', { exact: true })).toBeVisible();

    // A foregrounds. With the new behaviour (no proactive close on
    // background), A's WebSocket stayed alive through the brief
    // visibility flip and already received B's join via the
    // broadcast — no rejoin round-trip needed.
    await setVisibility(aPage, 'visible');

    // A's UI now shows both players' names — they're back in the lobby
    // with B alongside.
    await expect(aPage.getByText('Host', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(aPage.getByText('Guest', { exact: true })).toBeVisible({ timeout: 10_000 });
  } finally {
    await aCtx.close();
    await bCtx.close();
  }
});

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
