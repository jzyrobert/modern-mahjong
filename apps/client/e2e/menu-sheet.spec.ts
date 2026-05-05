import { expect, test } from '@playwright/test';

// The match `TopBar` collapses Settings / Game log / Tile
// reference / Leave into a single ☰ menu button so the row fits
// on a 320 px iPhone SE without flex-wrap clipping. Tapping ☰
// opens the menu bottom sheet; the four entries are reachable as
// tappable rows. This test locks in the menu's existence + each
// entry's role / accessibility-label.
test.describe('Match menu sheet', () => {
  test('☰ menu surfaces Settings, Game log, Tile reference, Leave', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 906 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Play vs bots' }).click();
    await page.getByRole('button', { name: 'Start match' }).click();
    // Sleep through the dice ceremony auto-dismiss.
    await page.waitForTimeout(4500);

    const open = page.getByLabel('Open menu');
    await expect(open).toBeVisible();
    await open.click();

    const heading = page.getByText('Menu', { exact: true });
    await expect(heading).toBeVisible();
    // Sheet anchors to the bottom of the viewport.
    const headingBox = await heading.boundingBox();
    if (!headingBox) throw new Error('Menu heading has no bounding box');
    expect(headingBox.y).toBeGreaterThan(350);

    // The four expected entries are present + tappable.
    for (const label of ['Settings', 'Game log', 'Tile reference', 'Leave match']) {
      await expect(page.getByRole('button', { name: label })).toBeVisible();
    }

    // Emote row is included in the mobile menu (the persistent
    // ChatBar that lives on the desktop felt is folded in here for
    // phone viewports, since that row of buttons doesn't fit
    // alongside hand + opp strips).
    for (const emote of ['👍', '😎', '🎉', '🤔', '😅', '🔥']) {
      await expect(page.getByLabel(`Send ${emote}`)).toBeVisible();
    }

    // Tapping a row closes the menu and opens the downstream
    // surface. Verify with Settings.
    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(heading).toBeHidden({ timeout: 5_000 });
    await expect(page.getByText('Settings', { exact: true }).first()).toBeVisible();
  });

  test('tapping an emote in the menu closes the sheet', async ({ page }) => {
    // Solo transport doesn't loop chat back to the client (no server
    // to broadcast through), so we can only assert the
    // sheet-closure half of the contract here. The wire side is
    // covered indirectly by online-multi-player.spec.ts where the
    // in-process MatchSession does fan chat out.
    await page.setViewportSize({ width: 412, height: 906 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Play vs bots' }).click();
    await page.getByRole('button', { name: 'Start match' }).click();
    await page.waitForTimeout(4500);

    await page.getByLabel('Open menu').click();
    await expect(page.getByText('Menu', { exact: true })).toBeVisible();
    await page.getByLabel('Send 👍').click();

    // Sheet closes immediately on tap (mirrors the other menu rows).
    await expect(page.getByText('Menu', { exact: true })).toBeHidden({ timeout: 5_000 });
  });
});
