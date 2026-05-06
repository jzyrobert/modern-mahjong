import { expect, test } from './_helpers';

// Pin the dice roll so seat 0 (the user) is dealer outright. Same
// trick as `solo-match.spec.ts` — seed 5 produces sums 10/5/6/8.
// With the user as dealer, they're dealt 14 tiles and hold the
// discard turn immediately (hasDrawn=true), so the hint condition
// (`myTurn && hasDrawn`) is satisfied without any prior bot
// discards.
const TEST_SEED = 5;

test.beforeEach(async ({ page }) => {
  await page.addInitScript((seed) => {
    (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
  }, TEST_SEED);
});

// Discard-hint Settings toggle — when on, the user's hand renders
// a teal halo on the heuristic ranker's recommended discard during
// their post-draw discard turn. The halo overlay is identified by
// `data-testid="hand-tile-recommended"` so this spec doesn't depend
// on the gold + teal colour values.
test.describe('Discard hint', () => {
  test('halo shows up only when the toggle is on', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 906 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Play vs bots' }).click();
    await page.getByRole('button', { name: 'Start match' }).click();
    // Sleep through the dice ceremony auto-dismiss. The user is
    // dealer (seed-pinned), so by the time the ceremony lifts the
    // hand is dealt + hasDrawn=true — discard turn is live.
    await page.waitForTimeout(4500);

    // Toggle off (default) → no halo even though the discard turn is
    // live and `state.hasDrawn` is true.
    await expect(page.getByTestId('hand-tile-recommended')).toHaveCount(0);

    // Open menu → Settings → flip the Discard hint switch.
    await page.getByLabel('Open menu').click();
    await page.getByRole('button', { name: 'Settings' }).click();

    // RN-Web maps `<Switch>` to a checkbox-roled input; in
    // `ToggleRow` the label text and the switch are siblings under
    // the same outer View. Walk up two levels from the label, then
    // click the input within.
    await expect(page.getByText('Discard hint', { exact: true })).toBeVisible({ timeout: 5_000 });
    const hintRow = page.getByText('Discard hint', { exact: true }).locator('../..');
    await hintRow.locator('input[type="checkbox"]').click();

    // Close the modal.
    await page.keyboard.press('Escape');

    // Toggle on → exactly one hand tile renders the halo.
    await expect(page.getByTestId('hand-tile-recommended')).toHaveCount(1, { timeout: 5_000 });
  });
});
