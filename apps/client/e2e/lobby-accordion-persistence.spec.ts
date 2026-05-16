import { expect, test } from './_helpers';

/**
 * The phone-class `LobbyAccordion` persists which sections the user
 * has left open into `settings.lobbyAccordionOpen` (alongside
 * `lobbyRulePrefs`), so leaving + re-entering the lobby restores the
 * user's last layout instead of resetting to first-paint defaults.
 *
 * The default-open state is `['bots']`; this spec drives the user
 * through toggling Rules open + Bots closed, leaves, returns, and
 * asserts both edits survived the round-trip.
 */
test.use({ viewport: { width: 412, height: 906 } });

test('lobby: accordion open/closed state persists across leave+return', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible({ timeout: 10_000 });

  // First paint: Bots open (default), Rules closed.
  await expect(page.getByRole('button', { name: 'Collapse Bots' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Expand Rules' })).toBeVisible();

  // Toggle: open Rules, close Bots.
  await page.getByRole('button', { name: 'Expand Rules' }).click();
  await page.getByRole('button', { name: 'Collapse Bots' }).click();
  await expect(page.getByRole('button', { name: 'Expand Bots' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse Rules' })).toBeVisible();

  // Round-trip through the menu.
  await page.getByRole('button', { name: 'Leave' }).click();
  await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible({
    timeout: 5_000,
  });
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible({ timeout: 10_000 });

  // Both toggles must have survived: Bots closed, Rules open.
  await expect(page.getByRole('button', { name: 'Expand Bots' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Collapse Rules' })).toBeVisible();
});
