import { type BrowserContext, expect, test } from '@playwright/test';
import { type TestServerHandle, startTestServer } from './test-server/server.js';

/**
 * Reload-survival flow: a player who's already in an online match
 * should land back at their seat after a browser reload, without
 * having to re-navigate from the lobby. The contract is "URL is the
 * source of truth": every successful online join produces a
 * `/match?code=ABCDE` URL, so a reload re-runs the match route's
 * auto-rejoin effect against the same code. The server's
 * `playerId → seat` rebind (PR #211) takes care of the server side.
 *
 * Two scenarios pinned here:
 *   1. Reload the host's tab — they should re-bind to seat 0 (host)
 *      and the lobby should still list both players.
 *   2. Reload the guest's tab — they should re-bind to seat 1 and
 *      see the same lobby state.
 */

const MATCH_CODE = 'RLOAD';
const PLAYER_IDS = ['p-host', 'p-guest'] as const;
const NAMES = ['HostPlayer', 'GuestPlayer'] as const;

let server: TestServerHandle;
let serverUrl: string;

test.beforeAll(async () => {
  server = await startTestServer(0);
  serverUrl = `ws://127.0.0.1:${server.port}`;
});

test.afterAll(async () => {
  await server.close();
});

async function seedContext(ctx: BrowserContext, idx: number) {
  await ctx.addInitScript(
    ([id, name]) => {
      localStorage.setItem('mahjong.playerId', id);
      localStorage.setItem('mahjong.displayName', name);
    },
    [PLAYER_IDS[idx]!, NAMES[idx]!] as const,
  );
}

test('online: host reload re-rebinds to the same seat', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  await seedContext(hostCtx, 0);
  await seedContext(guestCtx, 1);
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  try {
    // Host joins first → auto-assigned host.
    await host.goto(`/?serverUrl=${encodeURIComponent(serverUrl)}`);
    await host.getByLabel('Match code').fill(MATCH_CODE);
    await host.getByRole('button', { name: 'Join match' }).click();

    await guest.goto(`/?serverUrl=${encodeURIComponent(serverUrl)}`);
    await guest.getByLabel('Match code').fill(MATCH_CODE);
    await guest.getByRole('button', { name: 'Join match' }).click();

    // Both pages settle on the lobby — wait for the match heading,
    // then verify the URL on the host carries `?code=RLOAD`.
    await expect(host.getByRole('heading', { name: 'Lobby' })).toBeVisible({ timeout: 10_000 });
    await expect(host).toHaveURL(/\/match\?.*code=RLOAD/);
    for (const name of NAMES) {
      await expect(host.getByText(name, { exact: true })).toBeVisible({ timeout: 10_000 });
    }

    // Reload the host's tab. The match route's auto-rejoin effect should
    // see `?code=RLOAD`, fire `joinOnline('RLOAD')`, and the server
    // should re-bind seat 0 to this connection by `playerId`.
    await host.goto(`/match?code=${MATCH_CODE}&serverUrl=${encodeURIComponent(serverUrl)}`);

    await expect(host.getByRole('heading', { name: 'Lobby' })).toBeVisible({ timeout: 10_000 });
    // Both players still in the lobby preview after the reload — the
    // host hasn't been treated as a brand-new joiner taking a fresh seat.
    for (const name of NAMES) {
      await expect(host.getByText(name, { exact: true })).toBeVisible({ timeout: 10_000 });
    }
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});

test('online: guest reload preserves their seat too', async ({ browser }) => {
  const hostCtx = await browser.newContext();
  const guestCtx = await browser.newContext();
  await seedContext(hostCtx, 0);
  await seedContext(guestCtx, 1);
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  try {
    await host.goto(`/?serverUrl=${encodeURIComponent(serverUrl)}`);
    await host.getByLabel('Match code').fill(MATCH_CODE);
    await host.getByRole('button', { name: 'Join match' }).click();

    await guest.goto(`/?serverUrl=${encodeURIComponent(serverUrl)}`);
    await guest.getByLabel('Match code').fill(MATCH_CODE);
    await guest.getByRole('button', { name: 'Join match' }).click();

    await expect(guest.getByRole('heading', { name: 'Lobby' })).toBeVisible({ timeout: 10_000 });
    await expect(guest).toHaveURL(/\/match\?.*code=RLOAD/);

    // Reload the guest. They should re-bind to seat 1.
    await guest.goto(`/match?code=${MATCH_CODE}&serverUrl=${encodeURIComponent(serverUrl)}`);
    await expect(guest.getByRole('heading', { name: 'Lobby' })).toBeVisible({ timeout: 10_000 });
    for (const name of NAMES) {
      await expect(guest.getByText(name, { exact: true })).toBeVisible({ timeout: 10_000 });
    }
  } finally {
    await hostCtx.close();
    await guestCtx.close();
  }
});
