import { expect, test } from '@playwright/test';

// Locks in the 📖 tile-reference bottom sheet wired up from the
// match `TopBar`. The sheet is the first user-facing surface that
// uses the `Modal` primitive's `placement="bottom"` mode, so this
// also doubles as a regression for that placement: the dialog has
// to anchor flush with the viewport's bottom edge (or close to it)
// at narrow heights, not float in the middle.
test.describe('Tile reference sheet', () => {
  test('opens from the TopBar 📖 button on portrait phone widths', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 906 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Play vs bots' }).click();
    await page.getByRole('button', { name: 'Start match' }).click();
    // Sleep through the dice ceremony auto-dismiss.
    await page.waitForTimeout(4500);

    const open = page.getByLabel('Open tile reference');
    await expect(open).toBeVisible();
    await open.click();

    const heading = page.getByText('Tile reference', { exact: true });
    await expect(heading).toBeVisible();

    // Sheet anchors to the bottom of the viewport. Heading sits at
    // the top of the sheet card; its y-coordinate has to be in the
    // bottom half of the 906 px viewport (roughly y > 350 once the
    // sheet's content is laid out). A regression that flipped
    // `placement` back to `'center'` would put the heading near the
    // top instead.
    const headingBox = await heading.boundingBox();
    if (!headingBox) throw new Error('Heading has no bounding box');
    expect(
      headingBox.y,
      `Heading y=${headingBox.y} should sit in the bottom half of the 906px viewport (placement="bottom").`,
    ).toBeGreaterThan(350);

    // The reference content ("Characters · 萬子 (Man)") is reachable
    // through the sheet's inner ScrollView.
    await expect(page.getByText('Characters · 萬子 (Man)').first()).toBeVisible();

    // Click the × in the title row to dismiss.
    await page.getByLabel('Close').click();
    await expect(heading).toBeHidden({ timeout: 5_000 });
  });
});
