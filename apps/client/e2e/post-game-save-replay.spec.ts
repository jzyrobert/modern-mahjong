import type { Page } from '@playwright/test';
import { clearReplayStorage, expect, test, waitForUserDrawCue } from './_helpers';

/**
 * Coverage for the Save-replay pill anchored top-right of the
 * post-hand `ResultPanel`. The pill is the only access point to the
 * recorder's `saveExplicit` flow once a hand ends on mobile — the
 * `☰` menu's "Save this match" row lives behind the dim overlay the
 * ResultPanel renders on top of the felt, so the pill needs to
 * actually fire `saveExplicit` and persist to localStorage.
 *
 * The save-toggles-SAVED test drives a solo match to first-discard,
 * waits for the bot round-trip so the engine loop is quiescent on
 * the user's draw cue, then injects `state.lastResult` directly via
 * `__MAHJONG_TEST_GET_STATE__` so the ResultPanel renders. Reaching
 * a real `lastResult` would require depleting the 70-tile wall or
 * scripting a tsumo win, both far longer than necessary for the
 * pill's behaviour itself.
 */

const TEST_SEED = 5;

test.beforeEach(async ({ page }) => {
  await clearReplayStorage(page);
  await page.addInitScript((seed) => {
    (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
  }, TEST_SEED);
});

async function reachPostHandPopup(page: Page): Promise<void> {
  await page.setViewportSize({ width: 412, height: 906 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  // Discard once so the draft has a frame, then wait for the bot
  // round-trip — injecting `lastResult` mid-loop races with each bot
  // delta clearing it back to null.
  await page.getByTestId('own-hand-tile').first().click();
  await waitForUserDrawCue(page, 30_000);

  await page.evaluate(() => {
    const store = (
      globalThis as {
        __MAHJONG_TEST_GET_STATE__?: () => {
          state: unknown;
          setState: (s: unknown) => void;
        };
      }
    ).__MAHJONG_TEST_GET_STATE__?.();
    if (!store?.state) throw new Error('engine state not ready');
    const cur = store.state as Record<string, unknown>;
    store.setState({
      ...cur,
      phase: 'resolved',
      lastResult: { kind: 'draw', reason: 'wall-empty' },
    });
  });
  // Drawn-game banner is unique to the resolved-panel render — the
  // win-only branches don't render in a draw.
  await expect(page.getByText('Drawn game (wall empty)')).toBeVisible();
}

test('post-hand SAVE button: tapping it persists the replay and toggles to SAVED', async ({
  page,
}) => {
  await reachPostHandPopup(page);

  const saveButton = page.getByRole('button', { name: 'Save replay' });
  await expect(saveButton).toBeVisible();
  await saveButton.click();

  await expect(page.getByRole('button', { name: 'Replay saved — tap to discard' })).toBeVisible();

  const replayCount = await page.evaluate(() => {
    let n = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith('mj.replay.v1.')) n++;
    }
    return n;
  });
  expect(replayCount).toBeGreaterThan(0);

  // The on-disk record stays in the library; tapping again only
  // clears the in-match `savedThisMatch` flag so finalize won't
  // re-write on teardown.
  await page.getByRole('button', { name: 'Replay saved — tap to discard' }).click();
  await expect(page.getByRole('button', { name: 'Save replay' })).toBeVisible();
});

test('post-hand SAVE button: hidden when auto-record is on', async ({ page }) => {
  // The button's gate fires before any `draft` / `lastResult` check
  // — auto-record alone is enough to hide it, so this test skips
  // the full match setup the persist test needs.
  await page.addInitScript(() => {
    const existing = (() => {
      try {
        return JSON.parse(localStorage.getItem('mj.settings.v1') ?? '{}') as Record<
          string,
          unknown
        >;
      } catch {
        return {};
      }
    })();
    localStorage.setItem(
      'mj.settings.v1',
      JSON.stringify({ ...existing, autoRecordReplays: true }),
    );
  });
  await page.setViewportSize({ width: 412, height: 906 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await page.getByTestId('own-hand-tile').first().click();
  await waitForUserDrawCue(page, 30_000);
  await page.evaluate(() => {
    const store = (
      globalThis as {
        __MAHJONG_TEST_GET_STATE__?: () => {
          state: unknown;
          setState: (s: unknown) => void;
        };
      }
    ).__MAHJONG_TEST_GET_STATE__?.();
    if (!store?.state) return;
    const cur = store.state as Record<string, unknown>;
    store.setState({
      ...cur,
      phase: 'resolved',
      lastResult: { kind: 'draw', reason: 'wall-empty' },
    });
  });
  await expect(page.getByText('Drawn game (wall empty)')).toBeVisible();

  await expect(page.getByRole('button', { name: 'Save replay' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Replay saved — tap to discard' })).toBeHidden();
});
