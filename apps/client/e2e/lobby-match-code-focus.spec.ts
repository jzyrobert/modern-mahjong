import { expect, test } from './_helpers';

/**
 * On Android Chrome a soft keyboard opening shrinks `window.innerHeight`
 * (visualViewport-as-layout-viewport). On phones where the new height
 * dips below the width, a `width > height` orientation check flips
 * `isLandscape` mid-tap; `<MobileLobby>`'s portrait/landscape conditional
 * then swaps subtrees and unmounts the focused match-code input before
 * the user can type a single character.
 *
 * The fix derives `isLandscape` on web from
 * `matchMedia('(orientation: landscape)')`, which tracks the device's
 * physical screen orientation rather than the (keyboard-sensitive)
 * viewport aspect ratio.
 *
 * This spec reproduces the failure in a synthetic Chromium test by:
 *   1. Pinning `matchMedia('(orientation: …)')` to portrait, so the
 *      override mirrors a real device whose orientation does not flip.
 *      Without this, headless Chromium derives orientation from the
 *      viewport itself and the fix would look identical to the bug.
 *   2. Tapping the match-code input at a phone viewport.
 *   3. Shrinking the viewport to a "keyboard open" size where width
 *      now exceeds height — exactly what the bug needed to trip.
 *   4. Asserting the input is still focused and typing still works.
 */
test.use({ viewport: { width: 412, height: 906 }, hasTouch: true });

test('lobby: match code input survives soft-keyboard viewport shrink', async ({ page }) => {
  // Pin orientation media queries to portrait so the test stays
  // representative of a real device (where the keyboard never rotates
  // the screen) rather than Chromium's viewport-driven default.
  await page.addInitScript(() => {
    const orig = window.matchMedia.bind(window);
    window.matchMedia = (q: string) => {
      if (/orientation:\s*landscape/.test(q)) {
        return {
          matches: false,
          media: q,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        } as MediaQueryList;
      }
      if (/orientation:\s*portrait/.test(q)) {
        return {
          matches: true,
          media: q,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        } as MediaQueryList;
      }
      return orig(q);
    };
  });

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible({
    timeout: 15_000,
  });

  const input = page.getByLabel('Match code');
  await expect(input).toBeVisible();

  // First, tap and confirm focus lands.
  await input.tap();
  await expect
    .poll(async () => page.evaluate(() => document.activeElement?.getAttribute('aria-label')))
    .toBe('Match code');

  // Now shrink the viewport to simulate the soft keyboard opening.
  // Width now exceeds the visible height — under the old dimension-
  // based isLandscape, this would flip the layout and unmount the
  // input. With the fix the match-media check stays pinned to portrait,
  // the layout stays put, and the input keeps its focus.
  await page.setViewportSize({ width: 412, height: 300 });
  await page.waitForTimeout(150);

  await expect
    .poll(async () => page.evaluate(() => document.activeElement?.getAttribute('aria-label')))
    .toBe('Match code');

  await page.keyboard.type('AB');
  await expect(input).toHaveValue('AB');
});
