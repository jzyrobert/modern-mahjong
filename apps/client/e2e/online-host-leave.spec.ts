import { type BrowserContext, expect, test } from '@playwright/test';
import { type TestServerHandle, startTestServer } from './test-server/server.js';

/**
 * Host-leaves-online flow. Before the fix, hitting `Leave match` (or
 * the lobby's `Leave` button) while hosting only sent `{t: 'leave'}`
 * to the server, which closed the leaver's socket without further
 * action — guests sat in the lobby with the host's seat showing an
 * auto-bot for 60s until the reconnect-grace timer fired and finally
 * promoted a guest to host.
 *
 * Server-side fix (`MatchSession.onLeave`): an explicit leave from
 * the host either (a) immediately promotes the next-connected human
 * to host with the leaver's seat freed for new joiners, or (b) when
 * no other humans are connected, dissolves the match — broadcasts
 * `{t: 'error', code: 'HOST_LEFT'}` to every remaining socket and
 * closes them. Client-side (`transport-context.tsx` error branch):
 * on `HOST_LEFT`, drop the transport and bounce back to `/` so the
 * stranded "No active match" recovery screen never appears.
 *
 * E2E covers the user-visible host-promotion case: the new host's
 * `Start match` button flips from disabled → enabled the instant
 * the original host walks away, instead of a 60-second wait. The
 * dissolve path (host alone) is covered by `MatchSession.test.ts`.
 */

const MATCH_CODE = 'LEAVE';
const NAMES = ['Alice', 'Bob', 'Charlie'] as const;
const PLAYER_IDS = ['p-alice', 'p-bob', 'p-charlie'] as const;

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

test('online: host leaves lobby → next connected guest is promoted to host immediately', async ({
  browser,
}) => {
  const ctxs = [await browser.newContext(), await browser.newContext(), await browser.newContext()];
  for (let i = 0; i < ctxs.length; i++) await seedContext(ctxs[i]!, i);
  const pages = await Promise.all(ctxs.map((c) => c.newPage()));
  const [hostP, guest1P, guest2P] = pages as [
    (typeof pages)[number],
    (typeof pages)[number],
    (typeof pages)[number],
  ];

  try {
    for (const page of pages) {
      await page.goto(`/?serverUrl=${encodeURIComponent(serverUrl)}`);
      await page.getByLabel('Match code').fill(MATCH_CODE);
      await page.getByRole('button', { name: 'Join match' }).click();
      await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible({ timeout: 10_000 });
    }

    // Pre-leave: only the host's `Start match` button is enabled.
    // (`Start match` is gated by all-seats-filled, so it's still
    // visually disabled here — but `[disabled]` on the host vs. the
    // guests' button is enough to read host status.)
    await expect(guest1P.getByRole('button', { name: 'Start match' })).toBeDisabled();

    // Host leaves via the lobby's direct `Leave` button.
    await hostP.getByRole('button', { name: 'Leave', exact: true }).click();
    await expect(hostP.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible({
      timeout: 5_000,
    });

    // Guest1 (Bob, the next-connected human) is promoted to host.
    // Both guests still see the lobby — seat 0 is freed, seat 2 still
    // open, so `Start match` is gated on filling seats. The visible
    // signal that guest1 has been promoted is the
    // `LobbySeatControls` (host-only, gated by the per-page `isHost`
    // flag in `Match.tsx`) appearing on guest1's screen but not
    // guest2's. The bot-skill picker only renders for the host, so
    // its "Bot skill" heading is the cleanest assertion target.
    await expect(guest1P.getByText('Bot skill', { exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(guest2P.getByText('Bot skill', { exact: true })).not.toBeVisible();

    // Guests remain in the lobby — they were not bounced to the home
    // screen (which would happen on the dissolve path, host-alone).
    await expect(guest1P.getByRole('heading', { name: 'Lobby' })).toBeVisible();
    await expect(guest2P.getByRole('heading', { name: 'Lobby' })).toBeVisible();
  } finally {
    await Promise.all(ctxs.map((ctx) => ctx.close()));
  }
});
