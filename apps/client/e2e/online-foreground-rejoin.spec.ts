import { type BrowserContext, expect, test } from '@playwright/test';
import { setVisibility } from './_helpers';
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

    // A backgrounds the tab. With the new no-proactive-close
    // behaviour the WebSocket stays alive, so the server still sees
    // A in seat 0; nothing happens to A's seat.
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

/**
 * Companion to the "short background" spec above: the long-background
 * fallback. If the OS does suspend the WebSocket while the tab is
 * hidden (multi-minute lock, network drop, server kick), the client
 * sees a `closed` status flip — the `onStatus` hook in
 * `transport-context.tsx` nulls the transport, and the AppState
 * foreground handler then re-joins via `findOrAssignSeat`'s
 * playerId-match branch within the server's reconnect-grace window
 * (default 5 min).
 *
 * Drives the same setup as the spec above but force-terminates the
 * WebSocket from JS (the closest browser-side analogue of an OS
 * suspending it) before the foreground tick. Asserts the host's UI
 * recovers — same `Host + Guest` lobby visible after the rejoin
 * round-trip lands.
 */
test('online: hard-disconnect during background recovers via foreground rejoin', async ({
  browser,
}) => {
  const aCtx: BrowserContext = await browser.newContext();
  const bCtx: BrowserContext = await browser.newContext();
  await aCtx.addInitScript(() => {
    localStorage.setItem('mahjong.playerId', 'p-host-2');
    localStorage.setItem('mahjong.displayName', 'Host2');
  });
  await bCtx.addInitScript(() => {
    localStorage.setItem('mahjong.playerId', 'p-guest-2');
    localStorage.setItem('mahjong.displayName', 'Guest2');
  });
  const aPage = await aCtx.newPage();
  const bPage = await bCtx.newPage();
  try {
    await aPage.goto(`/?serverUrl=${encodeURIComponent(serverUrl)}`);
    await aPage.getByLabel('Match code').fill('REJOY');
    await aPage.getByRole('button', { name: 'Join match' }).click();
    await expect(aPage.getByRole('heading', { name: 'Lobby' })).toBeVisible({ timeout: 10_000 });

    await setVisibility(aPage, 'hidden');
    await aPage.waitForTimeout(200);

    // Drop Host's network — the closest browser-level analogue of an
    // OS suspending the socket after a long background. Chromium
    // closes any in-flight WebSocket; the client's `ws.onclose` fires,
    // status flips to `closed`, the `onStatus` hook nulls the
    // transport. Restoring network on `foreground` lets the AppState
    // handler's rejoin path succeed.
    await aCtx.setOffline(true);
    // Give the close to propagate through the React state cycle.
    await aPage.waitForTimeout(500);

    // Guest joins while Host is "fully offline" (closed socket).
    await bPage.goto(`/?serverUrl=${encodeURIComponent(serverUrl)}`);
    await bPage.getByLabel('Match code').fill('REJOY');
    await bPage.getByRole('button', { name: 'Join match' }).click();
    await expect(bPage.getByRole('heading', { name: 'Lobby' })).toBeVisible({ timeout: 10_000 });

    // Host's network comes back AND the tab foregrounds. AppState
    // handler sees `transport === null` (the `onStatus('closed')`
    // hook nulled it when Chromium closed the socket on `setOffline`)
    // and re-joins via `joinOnline(info.code)`. The server reseats
    // Host in seat 0 via `findOrAssignSeat`'s playerId-match branch.
    await aCtx.setOffline(false);
    await setVisibility(aPage, 'visible');

    await expect(aPage.getByText('Host2', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(aPage.getByText('Guest2', { exact: true })).toBeVisible({ timeout: 10_000 });
  } finally {
    await aCtx.close();
    await bCtx.close();
  }
});
