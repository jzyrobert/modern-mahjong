import { expect, test } from './_helpers';
import { type TestServerHandle, startTestServer } from './test-server/server.js';

/**
 * End-to-end coverage for the lobby browser feature:
 *   1. Two browser contexts each host a separate online match against
 *      the in-process MatchSession-backed test server.
 *   2. A third context opens the lobby browser modal and asserts both
 *      rooms appear with the correct host names + codes.
 *   3. The third context clicks Watch on one of them and asserts the
 *      SpectatorView renders (WATCHING badge + Stop watching button).
 *
 * The test server now serves both WS (existing match-room upgrades)
 * and HTTP `GET /lobbies` on the same port; `fetchLobbyList` rewrites
 * `ws://` → `http://` so the production client path works unmodified
 * against the test fixture.
 */

let server: TestServerHandle;
let serverUrl: string;

test.beforeAll(async () => {
  server = await startTestServer(0);
  serverUrl = `ws://127.0.0.1:${server.port}`;
});

test.afterAll(async () => {
  await server.close();
});

test('lobby browser: lists active rooms and supports Watch into a spectator view', async ({
  browser,
}) => {
  test.setTimeout(90_000);
  const hostA = await browser.newContext();
  const hostB = await browser.newContext();
  const viewer = await browser.newContext();
  const contexts = [hostA, hostB, viewer];
  const seed = [
    ['p-alice', 'Alice'],
    ['p-bob', 'Bob'],
    ['p-viewer', 'Viewer'],
  ] as const;
  await Promise.all(
    contexts.map((ctx, i) =>
      ctx.addInitScript(
        ([id, name]) => {
          localStorage.setItem('mahjong.playerId', id);
          localStorage.setItem('mahjong.displayName', name);
        },
        [seed[i]![0], seed[i]![1]] as const,
      ),
    ),
  );

  const pageA = await hostA.newPage();
  const pageB = await hostB.newPage();
  const pageV = await viewer.newPage();

  try {
    // Host A creates match AAAAA.
    await pageA.goto(`/?serverUrl=${encodeURIComponent(serverUrl)}`);
    await pageA.getByLabel('Match code').fill('AAAAA');
    await pageA.getByRole('button', { name: 'Join match' }).click();
    await expect(pageA.getByRole('heading', { name: 'Lobby' })).toBeVisible({ timeout: 15_000 });

    // Host B creates match BBBBB.
    await pageB.goto(`/?serverUrl=${encodeURIComponent(serverUrl)}`);
    await pageB.getByLabel('Match code').fill('BBBBB');
    await pageB.getByRole('button', { name: 'Join match' }).click();
    await expect(pageB.getByRole('heading', { name: 'Lobby' })).toBeVisible({ timeout: 15_000 });

    // Viewer opens the menu and the lobby browser modal.
    await pageV.goto(`/?serverUrl=${encodeURIComponent(serverUrl)}`);
    await expect(pageV.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible({
      timeout: 15_000,
    });
    await pageV.getByRole('button', { name: 'Browse open lobbies' }).click();
    // The Modal title is a plain Text node, not a heading-role element.
    // Use the modal's accessible Close button as the "modal mounted"
    // signal instead — it has an accessibilityLabel="Close" set by
    // Modal.tsx that's unique to the bottom-sheet.
    await expect(pageV.getByLabel('Close')).toBeVisible({ timeout: 5_000 });

    // Both rooms appear in the picker. Match by code; the host name
    // sits in the same row so we can assert it independently.
    await expect(pageV.getByText('#AAAAA')).toBeVisible({ timeout: 10_000 });
    await expect(pageV.getByText('#BBBBB')).toBeVisible();
    await expect(pageV.getByText('Alice', { exact: true })).toBeVisible();
    await expect(pageV.getByText('Bob', { exact: true })).toBeVisible();

    // Click Watch on Alice's row. Both rows have a Watch button, so
    // we anchor on the row containing #AAAAA first.
    const aliceRow = pageV
      .locator('div')
      .filter({ has: pageV.getByText('#AAAAA') })
      .filter({ has: pageV.getByRole('button', { name: 'Watch' }) })
      .last();
    await aliceRow.getByRole('button', { name: 'Watch' }).click();

    // SpectatorView mounted — "Stop watching" and WATCHING badge are
    // unique to that surface.
    await expect(pageV.getByRole('button', { name: 'Stop watching' })).toBeVisible({
      timeout: 10_000,
    });
    await expect(pageV.getByText('WATCHING', { exact: true })).toBeVisible();
  } finally {
    await Promise.all(contexts.map((ctx) => ctx.close()));
  }
});
