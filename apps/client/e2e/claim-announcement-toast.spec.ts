import { expect, test } from './_helpers';

/**
 * `ClaimAnnouncementToast` surfaces when an opponent (or the user) lands
 * a chi / peng / gang on the live discard. Reproducing a real bot claim
 * race deterministically inside an e2e is too brittle — claims depend on
 * the bot policy + tile-draw order — so this spec drives the toast
 * directly via the `flashClaimAnnouncement` store action exposed through
 * `__MAHJONG_TEST_GET_STATE__`. Mirrors the `claim-missed-toast` spec.
 *
 * The PR #390 fix seeds `lastSeq` from the current announcement at
 * mount time. Without the fix, a remount after a claim had fired
 * would re-flash the toast on every subsequent store update. The
 * second test covers the live-store contract that the seeding fix
 * depends on (two consecutive announcements both fire).
 *
 * The `addInitScript` below overrides the helper's default 0 ms bot
 * pace with a very long delay so background bot turns don't fire
 * their own real `claimAnnouncement` events while we're asserting on
 * the manual ones — that was the flake source. The match still
 * starts (the host control + the user's first turn don't depend on
 * bot pacing).
 */

interface TestStore {
  flashClaimAnnouncement: (a: { seat: number; kind: 'chi' | 'peng' | 'gang' }) => void;
}

async function setupQuietMatch(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    (globalThis as { __MAHJONG_TEST_BOT_PACE_MS__?: number }).__MAHJONG_TEST_BOT_PACE_MS__ = 60_000;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
}

test('claim-announcement toast renders for a peng and self-dismisses', async ({ page }) => {
  await setupQuietMatch(page);

  // Sanity: lobby → match transitioned.
  await expect(page.getByText(/\d+ tiles/)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText('PENG')).toBeHidden();

  await page.evaluate(() => {
    const store = (
      globalThis as { __MAHJONG_TEST_GET_STATE__?: () => TestStore }
    ).__MAHJONG_TEST_GET_STATE__?.();
    store?.flashClaimAnnouncement({ seat: 1, kind: 'peng' });
  });

  // The toast contains both the EN label and a "called" suffix; assert
  // on the EN label since the seat name varies by lobby state.
  await expect(page.getByText('PENG')).toBeVisible({ timeout: 2_000 });

  // Self-dismisses after TOAST_DURATION_MS (2.2s + fade tail; allow up to 5s).
  await expect(page.getByText('PENG')).toBeHidden({ timeout: 5_000 });
});

test('back-to-back claim announcements both render (seq dedup uses live store)', async ({
  page,
}) => {
  await setupQuietMatch(page);
  await expect(page.getByText(/\d+ tiles/)).toBeVisible({ timeout: 10_000 });

  // First claim — PENG.
  await page.evaluate(() => {
    const store = (
      globalThis as { __MAHJONG_TEST_GET_STATE__?: () => TestStore }
    ).__MAHJONG_TEST_GET_STATE__?.();
    store?.flashClaimAnnouncement({ seat: 1, kind: 'peng' });
  });
  await expect(page.getByText('PENG')).toBeVisible({ timeout: 2_000 });
  await expect(page.getByText('PENG')).toBeHidden({ timeout: 5_000 });

  // Second claim — CHI. The toast component re-pins on the new
  // announcement; the lastSeq dedup must allow the seq=2 announcement
  // through because lastSeq holds seq=1 from the prior flash.
  await page.evaluate(() => {
    const store = (
      globalThis as { __MAHJONG_TEST_GET_STATE__?: () => TestStore }
    ).__MAHJONG_TEST_GET_STATE__?.();
    store?.flashClaimAnnouncement({ seat: 2, kind: 'chi' });
  });
  await expect(page.getByText('CHI')).toBeVisible({ timeout: 2_000 });
});
