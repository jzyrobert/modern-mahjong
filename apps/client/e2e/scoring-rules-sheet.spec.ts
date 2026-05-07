import { expect, test } from './_helpers';

// Locks in the scoring-rules bottom sheet reached via the ☰ menu's
// "Scoring rules" row. The sheet documents every fan pattern the
// engine knows about with an example hand under each one — the
// content is sourced from `@mahjong/game-logic`'s SCORING_RULES
// catalog, so this test guards both the menu wiring and the
// catalog being non-empty / rendering at all.
test.describe('Scoring rules sheet', () => {
  test('opens via the ☰ menu and lists known patterns with example hands', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 906 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Play vs bots' }).click();
    await page.getByRole('button', { name: 'Start match' }).click();
    // Sleep through the dice ceremony auto-dismiss.
    await page.waitForTimeout(4500);

    await page.getByLabel('Open menu').click();
    await expect(page.getByText('Menu', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Scoring rules' }).click();

    // Wait for the menu sheet to retract before locating the new sheet's
    // own heading (the menu row's "Scoring rules" text lingers briefly).
    await expect(page.getByText('Menu', { exact: true })).toBeHidden({ timeout: 5_000 });
    const heading = page.getByText('Scoring rules', { exact: true }).first();
    await expect(heading).toBeVisible();

    // A few canonical pattern names and their fan badges are reachable
    // through the sheet's ScrollView. Picking one from each category to
    // exercise the rendering across the catalog.
    await expect(page.getByText('自摸').first()).toBeVisible();
    await expect(page.getByText('清一色').first()).toBeVisible();
    await expect(page.getByText('十三幺').first()).toBeVisible();
    await expect(page.getByText('搶槓').first()).toBeVisible();

    // Category headings render — the catalog groups by mode-of-win,
    // composition, honors, shape, blessing.
    await expect(page.getByText('How you won').first()).toBeVisible();

    // Close via the × in the title row.
    await page.getByLabel('Close').click();
    await expect(heading).toBeHidden({ timeout: 5_000 });
  });
});
