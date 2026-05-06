import { expect, test } from './_helpers';

// Regression for the match shell on portrait-mobile phones. The
// earlier layout placed `GameStatusBar` + `TopBar` inside the
// scrollable body. On a 320 px iPhone SE-class viewport the body
// overflowed and the browser's `overflow-anchor` adjustment scrolled
// the chrome past the top edge whenever the body grew (e.g. on the
// `waiting` → `rolling` phase transition triggered by "Start match").
// The visible symptom was the chrome / settings ⚙ / Leave button
// missing entirely from the visible viewport — i.e. a user couldn't
// reach Settings or leave the match.
//
// The chrome row now lives outside the ScrollView as a pinned
// header. This test locks that in: at 320×568 with the match in
// progress, the ☰ menu pill must still be in the visible viewport
// — it's the user's entry into Settings / Game log / Tile reference
// / Leave on a phone, so reachability is the regression to lock.
test('match chrome stays in viewport on iPhone SE portrait', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();

  // Sleep through the dice ceremony auto-dismiss so the steady-state
  // match chrome is what we measure.
  await page.waitForTimeout(4500);

  const menuButton = page.getByLabel('Open menu');
  await expect(menuButton).toBeVisible();
  const box = await menuButton.boundingBox();
  if (!box) throw new Error('Menu pill has no bounding box');
  expect(
    box.y,
    `Menu pill y=${box.y} should be within the 320×568 viewport (was off-screen above before the chrome was pinned).`,
  ).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(568);
});
