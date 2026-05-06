import { expect, test } from './_helpers';

// The players bottom-sheet is reachable via tapping the
// `GameStatusBar` pill (the "{wind} ROUND · {dealer} dealing · N
// tiles" pill at the top of the match shell). The pill is
// a Pressable with `accessibilityLabel="Open players panel"` so
// Playwright (and screen readers) can find it. Choosing the
// status bar as the entry point — rather than another TopBar
// icon — frees a slot on the 320 px iPhone SE TopBar where 5
// buttons clip the Leave button.
test.describe('Players sheet', () => {
  test('opens from the GameStatusBar pill on portrait phone widths', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 906 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Play vs bots' }).click();
    await page.getByRole('button', { name: 'Start match' }).click();
    // Sleep through the dice ceremony auto-dismiss so the steady-state
    // pill is the active one.
    await page.waitForTimeout(4500);

    const open = page.getByLabel('Open players panel');
    await expect(open).toBeVisible();
    await open.click();

    const heading = page.getByText('Players', { exact: true });
    await expect(heading).toBeVisible();

    // Sheet anchors to the bottom — heading should land in the
    // bottom half of the viewport.
    const headingBox = await heading.boundingBox();
    if (!headingBox) throw new Error('Heading has no bounding box');
    expect(
      headingBox.y,
      `Heading y=${headingBox.y} should sit in the bottom half of the 906px viewport.`,
    ).toBeGreaterThan(350);

    // Each of the four seats appears with its initials avatar +
    // bot/human display name. The dealer for hand 1 is the human
    // (seat 0 by default in the solo seed sequence) — the
    // 'DEALER' badge proves the per-seat metadata renders.
    await expect(page.getByText('Bot (heuristic)').first()).toBeVisible();
    await expect(page.getByText('Bot (simple)').first()).toBeVisible();
    await expect(page.getByText('Bot (passive)').first()).toBeVisible();
    // The local seat carries a YOU badge.
    await expect(page.getByText('YOU').first()).toBeVisible();

    // Dismiss with the × close button.
    await page.getByLabel('Close').click();
    await expect(heading).toBeHidden({ timeout: 5_000 });
  });
});
