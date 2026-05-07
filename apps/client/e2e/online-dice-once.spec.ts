import { type BrowserContext, expect, test } from '@playwright/test';
import { type TestServerHandle, startTestServer } from './test-server/server.js';

/**
 * Regression: in online matches the dice-ceremony overlay was
 * re-popping after every state delta (discard, draw, etc.).
 *
 * Root cause: the overlay's `useEffect([rolls])` fired any time the
 * `state.openingRolls` reference changed, but `JSON.parse` on every
 * server delta spawns a fresh-but-equal object — so the effect ran
 * once per action even though the underlying hand hadn't changed.
 *
 * Fix: gate dismissal on `state.seed`. Once the user has dismissed
 * the ceremony for a given seed, no subsequent delta in that hand
 * should re-show it.
 */

const MATCH_CODE = 'DICE1';
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

test('opening dice ceremony shows once per hand and stays dismissed across deltas', async ({
  browser,
}) => {
  const contexts = await Promise.all(NAMES.map(() => browser.newContext()));
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
  // Pin opening dice so seat 0 (Alice — the first joiner / host) wins
  // the roll and becomes dealer; mirrors `online-multi-player.spec.ts`.
  await Promise.all(
    contexts.map((ctx) =>
      ctx.addInitScript((seed) => {
        (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
      }, 5),
    ),
  );
  const pages = await Promise.all(contexts.map((ctx) => ctx.newPage()));

  try {
    for (const page of pages) {
      await page.goto(`/?serverUrl=${encodeURIComponent(serverUrl)}`);
      await page.getByLabel('Match code').fill(MATCH_CODE);
      await page.getByRole('button', { name: 'Join match' }).click();
    }
    for (const page of pages) {
      await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible({ timeout: 10_000 });
    }
    await pages[0]!.getByRole('button', { name: 'Start match' }).click();

    // Ceremony shows on every page on hand-start.
    for (const page of pages) {
      await expect(page.locator('text=Opening rolls').first()).toBeVisible({
        timeout: 5_000,
      });
    }

    // Dismiss on Alice's screen by tapping the backdrop.
    await pages[0]!.locator('text=Tap anywhere to dismiss').click();
    await expect(pages[0]!.locator('text=Opening rolls').first()).toBeHidden({
      timeout: 3_000,
    });

    // Alice (dealer, seat 0) discards her first tile. The state delta
    // hits every page; before the fix this re-popped the ceremony.
    await pages[0]!.getByTestId('own-hand-tile').first().click();

    // Check that Alice's screen does NOT re-show the dice. Wait long
    // enough that any racey re-trigger would have rendered.
    await pages[0]!.waitForTimeout(800);
    await expect(pages[0]!.locator('text=Opening rolls').first()).toBeHidden();
  } finally {
    await Promise.all(contexts.map((ctx: BrowserContext) => ctx.close()));
  }
});
