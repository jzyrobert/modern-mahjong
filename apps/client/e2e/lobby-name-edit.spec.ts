import { expect, test } from '@playwright/test';

/**
 * The mobile lobby's identity-pill EDIT badge is a `Pressable` that
 * focuses the display-name `TextInput`; when the input is focused
 * the same control flips to DONE and blurs the input on press.
 *
 * The naive implementation (toggle based on a React-state `nameFocused`
 * captured in the press closure) breaks on web because mousedown on
 * the pill — which renders as a real `<button>` via
 * `accessibilityRole` — shifts focus off the input *before* `onPress`
 * fires. React then re-renders with the post-blur state, and the new
 * closure sees `nameFocused=false` and re-focuses the input — making
 * DONE look like a no-op. The fix captures the pre-click focus state
 * in `onPressIn` (which runs during pointerdown, before the focus
 * shift) and acts on the snapshot, not the closure variable.
 */
test('mobile lobby: EDIT focuses the name input, DONE blurs it', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 906 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

  const editButton = page.getByRole('button', { name: 'Edit display name' });
  // `getByLabel('Display name')` substring-matches the DONE button
  // (aria-label "Done editing display name"); pin to the textbox role
  // to keep the locator unambiguous through the focused/idle states.
  const nameInput = page.getByRole('textbox', { name: 'Display name' });

  await expect(editButton).toBeVisible();
  await editButton.click();
  await expect(nameInput).toBeFocused();

  const doneButton = page.getByRole('button', { name: 'Done editing display name' });
  await expect(doneButton).toBeVisible();
  await doneButton.click();
  await expect(nameInput).not.toBeFocused();
  await expect(editButton).toBeVisible();
});
