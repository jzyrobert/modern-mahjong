import { type BrowserContext, expect, test } from '@playwright/test';
import { type TestServerHandle, startTestServer } from './test-server/server.js';

/**
 * Multi-player online flow exercised end-to-end against an in-process
 * WebSocket server that wraps the real `MatchSession` class. Each
 * Playwright browser context represents a different player; they all
 * connect to the same `?serverUrl=ws://127.0.0.1:<port>` test server,
 * type the same match code, and the test asserts the live `LobbyPreview`
 * fills, the host can start the hand, and all four contexts agree the
 * wall has been dealt.
 */

const MATCH_CODE = 'TESTC';
const NAMES = ['Alice', 'Bob', 'Charlie', 'Diana'] as const;
const PLAYER_IDS = ['p-alice', 'p-bob', 'p-charlie', 'p-diana'] as const;

let server: TestServerHandle;
let serverUrl: string;

test.beforeAll(async () => {
  server = await startTestServer(0);
  serverUrl = `ws://127.0.0.1:${server.port}`;
});

test.afterAll(async () => {
  await server.close();
});

test('online match: 4 players join via match code, host starts hand', async ({ browser }) => {
  // Open four isolated browser contexts so each gets a fresh localStorage
  // (independent player identity).
  const contexts = await Promise.all(NAMES.map(() => browser.newContext()));
  // Seed each context with a stable identity before the first navigation
  // so the test isn't fighting the random-name generator in identity.ts.
  await Promise.all(
    contexts.map((ctx, i) =>
      ctx.addInitScript(
        ([id, name]) => {
          localStorage.setItem('mahjong.playerId', id);
          localStorage.setItem('mahjong.displayName', name);
        },
        [PLAYER_IDS[i]!, NAMES[i]!] as const,
      ),
    ),
  );
  // Pin the host's `randomSeed()` to a value where seat 0 (Alice — the
  // first to connect, so the host) wins the opening dice roll outright
  // (sums: 10/5/6/8 with seed 5). Without this, dealer is dice-random
  // and the "Alice clicks own-hand-tile" → "Bob sees draw cue" assertion
  // won't hold when a non-Alice seat is dealer.
  await Promise.all(
    contexts.map((ctx) =>
      ctx.addInitScript((seed) => {
        (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
      }, 5),
    ),
  );
  const pages = await Promise.all(contexts.map((ctx) => ctx.newPage()));

  try {
    // Each player navigates to the lobby pointed at the test server, types
    // the shared match code, and clicks "Join match". The first to hello
    // is auto-assigned host by MatchSession.onHello.
    for (const page of pages) {
      await page.goto(`/?serverUrl=${encodeURIComponent(serverUrl)}`);
      await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
      await page.getByLabel('Match code').fill(MATCH_CODE);
      await page.getByRole('button', { name: 'Join match' }).click();
    }

    // Each page should land on the waiting-room view with the LobbyPreview
    // listing all four players. Wait on the heading first to let the
    // server round-trip settle, then assert every player's name renders
    // in every page's preview.
    for (const page of pages) {
      await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible({ timeout: 10_000 });
      for (const name of NAMES) {
        await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 10_000 });
      }
    }

    // The host (Alice — first to connect) is the only context whose Start
    // match button is enabled. Confirm guests' button is disabled, then
    // host starts the hand.
    for (let i = 1; i < pages.length; i++) {
      await expect(pages[i]!.getByRole('button', { name: 'Start match' })).toBeDisabled();
    }
    await pages[0]!.getByRole('button', { name: 'Start match' }).click();

    // Engine has dealt — every page's HUD should show the live wall count.
    for (const page of pages) {
      await expect(page.getByText(/\d+ left/)).toBeVisible({ timeout: 10_000 });
    }

    // Cross-player turn handoff: the host (seat 0, dealer) is dealt 14 and
    // must discard. After the discard the wall count is unchanged on the
    // host's screen but seat 1 (Bob) becomes the active turn. Wait for
    // Bob's draw cue to appear, proving the server propagated the state
    // delta to a second context.
    await pages[0]!.getByTestId('own-hand-tile').first().click();
    await expect(pages[1]!.getByTestId('wall-draw-next')).toBeVisible({ timeout: 15_000 });
  } finally {
    await Promise.all(contexts.map((ctx: BrowserContext) => ctx.close()));
  }
});
