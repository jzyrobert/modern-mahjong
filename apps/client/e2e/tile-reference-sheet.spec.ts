import { expect, test } from '@playwright/test';

// Locks in the tile-reference bottom sheet, now reached via the
// ☰ menu sheet on the match `TopBar` (Tile reference row). The
// sheet uses the `Modal` primitive's `placement="bottom"` mode;
// the dedicated placement test lives in `players-sheet.spec.ts`
// because the players sheet content fits the placement-y
// assertion cleanly across viewports — the longer reference
// content collides with the assertion threshold.
test.describe('Tile reference sheet', () => {
  test('opens via the ☰ menu on portrait phone widths', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 906 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Play vs bots' }).click();
    await page.getByRole('button', { name: 'Start match' }).click();
    // Sleep through the dice ceremony auto-dismiss.
    await page.waitForTimeout(4500);

    await page.getByLabel('Open menu').click();
    await expect(page.getByText('Menu', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Tile reference' }).click();

    // The menu row's "Tile reference" text stays in the DOM
    // briefly during the slide-out animation, so wait for the
    // menu heading to disappear before locating the new sheet's
    // own heading.
    await expect(page.getByText('Menu', { exact: true })).toBeHidden({ timeout: 5_000 });
    const heading = page.getByText('Tile reference', { exact: true }).first();
    await expect(heading).toBeVisible();

    // The reference content ("Characters · 萬子 (Man)") is reachable
    // through the sheet's inner ScrollView.
    await expect(page.getByText('Characters · 萬子 (Man)').first()).toBeVisible();

    // Click the × in the title row to dismiss.
    await page.getByLabel('Close').click();
    await expect(heading).toBeHidden({ timeout: 5_000 });
  });
});
