import { type Page, expect } from '@playwright/test';

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
