import { expect, test } from '@playwright/test';

// On web there's no embedded server runtime to host a LAN match
// from, so the lobby's "Host LAN match" button is hidden — the
// `Platform.OS !== 'web'` guard in `Lobby.tsx`. The "Join LAN
// match" button still renders so a user on a browser can connect
// to a host running on a phone on the same Wi-Fi.
test('lobby hides "Host LAN match" on web but keeps "Join LAN match"', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

  // Host hidden.
  await expect(page.getByRole('button', { name: 'Host LAN match' })).toHaveCount(0);

  // Join still present (scroll into view first since it's below
  // the fold on portrait phone widths).
  const join = page.getByRole('button', { name: 'Join LAN match' });
  await join.scrollIntoViewIfNeeded();
  await expect(join).toBeVisible();
});
