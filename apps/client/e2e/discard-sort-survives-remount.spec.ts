import { expect, test } from './_helpers';

/**
 * PR #390 lifted `SharedDiscardPool`'s `sortMode` from local
 * `useState` into the `useGame.discardSortMode` zustand slice so the
 * user's `'player'` pick wouldn't snap back to `'order'` when the
 * pool component remounted mid-match. The unit-test added in #390
 * reads the store directly with no component lifecycle — it locks
 * the store contract but doesn't exercise an actual remount.
 *
 * This spec drives a real remount via an orientation flip. On a
 * phone-class viewport `MobileShell.tsx` renders either
 * `<LandscapeShell>` or `<PortraitShell>` based on
 * `viewportWidth > viewportHeight`. `SharedDiscardPool` is mounted
 * only inside `PortraitShell`, so flipping portrait → landscape →
 * portrait unmounts the pool and remounts a fresh instance. With the
 * pre-#390 bug, the second mount's local `useState('order')` would
 * win; with the fix, the zustand selector returns `'player'`.
 */

const PORTRAIT = { width: 393, height: 852 };
const LANDSCAPE = { width: 852, height: 393 };

interface TestStore {
  setDiscardSortMode: (mode: 'order' | 'player') => void;
  discardSortMode: 'order' | 'player';
}

test('SharedDiscardPool sort mode survives a real PortraitShell remount', async ({ page }) => {
  await page.setViewportSize(PORTRAIT);
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.getByText(/\d+ tiles/)).toBeVisible({ timeout: 10_000 });

  // The toggle is part of `SharedDiscardPool`'s header — rendered
  // even before the first discard, with `accessibilityRole="button"`
  // and the label "Sort discards by player" / "Sort discards by order".
  const orderButton = page.getByRole('button', { name: 'Sort discards by order' });
  const playerButton = page.getByRole('button', { name: 'Sort discards by player' });
  await expect(orderButton).toBeVisible();
  await expect(playerButton).toBeVisible();

  // Default is 'order'.
  await expect(orderButton).toHaveAttribute('aria-pressed', 'true');
  await expect(playerButton).toHaveAttribute('aria-pressed', 'false');

  // Flip to 'player'.
  await playerButton.click();
  await expect(playerButton).toHaveAttribute('aria-pressed', 'true');
  await expect(orderButton).toHaveAttribute('aria-pressed', 'false');

  // Confirm the store reflects the pick — this is the value the
  // remounted component must read on its next mount.
  const beforeFlip = await page.evaluate(() => {
    const store = (
      globalThis as { __MAHJONG_TEST_GET_STATE__?: () => TestStore }
    ).__MAHJONG_TEST_GET_STATE__?.();
    return store?.discardSortMode;
  });
  expect(beforeFlip).toBe('player');

  // Flip to landscape — `MobileShell` swaps PortraitShell for
  // LandscapeShell, which dismounts `SharedDiscardPool` entirely.
  await page.setViewportSize(LANDSCAPE);
  await expect(playerButton).toBeHidden({ timeout: 2_000 });

  // Flip back to portrait — fresh PortraitShell instance, fresh
  // `SharedDiscardPool` mount.
  await page.setViewportSize(PORTRAIT);
  await expect(playerButton).toBeVisible({ timeout: 2_000 });

  // The critical assertion: the remounted toggle still reads
  // `'player'`. Pre-#390 this would snap back to `'order'`.
  await expect(playerButton).toHaveAttribute('aria-pressed', 'true');
  await expect(orderButton).toHaveAttribute('aria-pressed', 'false');

  // And the store agrees.
  const afterFlip = await page.evaluate(() => {
    const store = (
      globalThis as { __MAHJONG_TEST_GET_STATE__?: () => TestStore }
    ).__MAHJONG_TEST_GET_STATE__?.();
    return store?.discardSortMode;
  });
  expect(afterFlip).toBe('player');
});
