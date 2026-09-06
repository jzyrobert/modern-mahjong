import { type Page, test as base, expect } from '@playwright/test';

/**
 * Init script shared by every page the suite opens. Pins the classic
 * renderer + zero bot pacing. Exported so specs that hand-roll a
 * `chromium.launch()` (lan-browser-join) can apply it to their own
 * contexts too.
 */
export function legacyInitScript(): void {
  const g = globalThis as {
    __MAHJONG_TEST_BOT_PACE_MS__?: number;
    __MAHJONG_TEST_BOT_CLAIM_DELAY_MS__?: number;
    __MAHJONG_TEST_RENDERER__?: 'classic' | '3d';
  };
  // The legacy suite asserts on the classic RN shells' DOM. Pin the
  // renderer so the Three.js layer (`src/three/`) — the web default —
  // doesn't swap the table out from under these specs. 3D-specific
  // coverage lives in `three-*.spec.ts` and pins `'3d'` itself.
  g.__MAHJONG_TEST_RENDERER__ = 'classic';
  g.__MAHJONG_TEST_BOT_PACE_MS__ = 0;
  // Zero the per-bot claim submission delay so e2e specs don't
  // accumulate real wall-time waiting for bot claim staggers.
  // Specs that need to assert pacing can override this inside
  // the test body.
  g.__MAHJONG_TEST_BOT_CLAIM_DELAY_MS__ = 0;
}

export const test = base.extend({
  // Wrap `browser.newContext` so the multi-context online specs
  // (`online-*`, `lobby-browser`) inherit the same init script as the
  // default `page` fixture — a second player's tab must also land on
  // the classic shells.
  browser: async ({ browser }, use) => {
    const original = browser.newContext.bind(browser);
    browser.newContext = async (options) => {
      const ctx = await original(options);
      await ctx.addInitScript(legacyInitScript);
      return ctx;
    };
    await use(browser);
    browser.newContext = original;
  },
  page: async ({ page }, use) => {
    await page.addInitScript(legacyInitScript);
    await use(page);
  },
});

export { expect };

/**
 * Wipe any leftover replay records from `localStorage` on next
 * navigation. `localStorage` is shared across specs within the same
 * browser context, so specs that assert on the post-save record count
 * have to reset first. Calls `addInitScript`, so it must run before
 * the spec's first `page.goto(...)`.
 */
export async function clearReplayStorage(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try {
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('mj.replay.v1.')) keys.push(k);
      }
      for (const k of keys) localStorage.removeItem(k);
    } catch {
      /* private mode — no-op */
    }
  });
}

/**
 * Spoof the document's `visibilityState` + `hidden` and dispatch
 * `visibilitychange` so RN-Web's AppState shim flips. Specs use this
 * to simulate Android Chrome / iOS Safari backgrounding the tab.
 */
export async function setVisibility(page: Page, state: 'hidden' | 'visible'): Promise<void> {
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

/**
 * Wait for the user's draw-cue (`wall-draw-next`) to appear, dismissing
 * any incidental ClaimBar windows along the way by clicking `Pass`.
 *
 * Solo mode no longer auto-passes the user when claims are open (the
 * old wall-clock alarm was removed in favour of an "infinite" claim
 * timeout — see `apps/client/src/net/solo-transport.ts`). Tests that
 * just want to advance back to the user's draw therefore have to act
 * on the user's behalf when bots happen to discard a face the user
 * could legally peng / chi / win.
 *
 * Polls every 500ms until either:
 *   - `wall-draw-next` is visible (user's turn to draw → return), or
 *   - the overall `timeoutMs` elapses (throws via the final `expect`).
 *
 * If `CLAIM?` is on screen at any iteration, clicks `Pass` first.
 */
export async function waitForUserDrawCue(page: Page, timeoutMs = 30_000): Promise<void> {
  const drawCue = page.getByTestId('wall-draw-next');
  const pass = page.getByText('Pass', { exact: true }).first();
  const claimHeader = page.getByText('CLAIM?', { exact: true });
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await drawCue.isVisible().catch(() => false)) return;
    if (await claimHeader.isVisible().catch(() => false)) {
      await pass.click({ timeout: 2_000 }).catch(() => {});
      continue;
    }
    await page.waitForTimeout(500);
  }
  await expect(drawCue).toBeVisible({ timeout: 1 });
}
