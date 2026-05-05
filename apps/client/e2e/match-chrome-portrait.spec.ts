import { expect, test } from '@playwright/test';

// Regression for the match shell on portrait-mobile phones. The
// earlier layout placed `GameStatusBar` + `TopBar` inside the
// scrollable body. On a 320 px iPhone SE-class viewport the body
// overflowed and the browser's `overflow-anchor` adjustment scrolled
// the chrome past the top edge whenever the body grew (e.g. on the
// `waiting` → `rolling` phase transition triggered by "Start match").
// The visible symptom was the LIVE pill / settings ⚙ / Leave button
// missing entirely from the visible viewport — i.e. a user couldn't
// reach Settings or leave the match.
//
// The chrome row now lives outside the ScrollView as a pinned
// header. This test locks that in: at 320×568 with the match in
// progress, the LIVE pill must still be in the visible viewport.
test('match chrome stays in viewport on iPhone SE portrait', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();

  // Sleep through the dice ceremony auto-dismiss so the steady-state
  // match chrome is what we measure.
  await page.waitForTimeout(4500);

  const liveLabel = page.locator('text=LIVE').first();
  await expect(liveLabel).toBeVisible();
  const box = await liveLabel.boundingBox();
  if (!box) throw new Error('LIVE pill has no bounding box');
  expect(
    box.y,
    `LIVE pill y=${box.y} should be within the 320×568 viewport (was off-screen above before the chrome was pinned).`,
  ).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(568);

  // The Leave button (rightmost in the TopBar) and the settings ⚙
  // icon also have to be reachable from the pinned chrome — they're
  // the user's only way out of a hand on mobile.
  await expect(page.getByText('Leave', { exact: true }).first()).toBeVisible();
  await expect(page.getByLabel('Open settings')).toBeVisible();
});
