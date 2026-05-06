import type { Page } from '@playwright/test';
import { expect, test, waitForUserDrawCue } from './_helpers';

/**
 * Mobile-portrait coverage. The default `solo-match.spec.ts` runs on the
 * desktop shell (`DesktopTable`) at the project's 1280-wide viewport.
 * This file pins a phone-sized viewport so the mobile shell — vertical
 * stack with `OppHandStrip` rows + `SharedDiscardPool` + `Hand` — also
 * gets exercised end-to-end. It covers the on-felt UX a phone user
 * actually hits: sort-picker toggle, tap-to-discard, and the
 * draw-cue → discard turn cycle.
 */

const TEST_SEED = 5; // dealer = seat 0 (the user)

test.use({ viewport: { width: 360, height: 800 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript((seed) => {
    (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
  }, TEST_SEED);
});

test('mobile: sort picker toggles between SUIT / NUMBER / MANUAL', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await dismissOpeningRolls(page);

  // Hand is dealt — sort picker is on screen.
  await expect(page.getByText(/\d+ tiles in wall/)).toBeVisible();

  // SortPicker buttons are Pressables, not native <button>s, so locate
  // them by visible text.
  const suit = page.getByText('SUIT', { exact: true });
  const number = page.getByText('NUMBER', { exact: true });
  const manual = page.getByText('MANUAL', { exact: true });
  await expect(suit).toBeVisible();
  await expect(number).toBeVisible();
  await expect(manual).toBeVisible();

  // Toggling `NUMBER` should re-order the hand (the rendered tile order
  // changes, even though counts don't). The simplest assertion is that
  // the click is registered: by reading the hand's first tile DOM
  // identity before vs. after.
  const handFirstBefore = await firstHandTileSignature(page);
  await number.click();
  // Suit-mode and number-mode usually disagree on at least one tile in
  // a real 14-tile hand, so the first-tile signature should change.
  await expect
    .poll(async () => firstHandTileSignature(page), { timeout: 5_000 })
    .not.toBe(handFirstBefore);
});

test('mobile: tap-to-discard sends the tile to the shared discard pool', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await dismissOpeningRolls(page);
  await expect(page.getByText(/\d+ tiles in wall/)).toBeVisible();

  // The dealer (seat 0, by TEST_SEED) starts with 14 tiles + hasDrawn,
  // so any hand-tile tap discards. The DISCARDS panel only renders once
  // a tile has been thrown.
  await expect(page.getByText('DISCARDS', { exact: true })).toBeHidden();
  await page.getByTestId('own-hand-tile').first().click();
  await expect(page.getByText('DISCARDS', { exact: true })).toBeVisible({ timeout: 10_000 });
});

test('mobile: draw-cue → tap-to-discard cycle hands turn back to bots', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await dismissOpeningRolls(page);

  // First discard hands the turn to seat 1.
  const wallStart = await readMobileWallCount(page);
  await page.getByTestId('own-hand-tile').first().click();

  // Bots play — wall depletes — turn comes back. The mobile shell shows
  // a `<DrawCue>` component below the hand; legacy testID was
  // `wall-draw-next`. After tapping it, `hasDrawn=true` and the cue
  // disappears, freeing the user to discard again. Solo's claim
  // window is now infinite, so we auto-pass any incidental claim
  // opportunities on the way back to the user's turn.
  const drawCue = page.getByTestId('wall-draw-next');
  await waitForUserDrawCue(page, 30_000);
  await drawCue.click();
  await expect(drawCue).toBeHidden();

  // After draw → discard, the turn should leave seat 0 again, and the
  // wall should drain further as bots play their own draws.
  await page.getByTestId('own-hand-tile').first().click();
  await expect
    .poll(() => readMobileWallCount(page), {
      timeout: 30_000,
      message: 'Wall did not deplete after second user discard cycle',
    })
    .toBeLessThan(wallStart);
});

async function dismissOpeningRolls(page: Page) {
  // The DiceCeremony auto-dismisses after ~3.5s, but tapping the
  // backdrop is faster + matches what a real user does. Tolerate the
  // case where the modal already auto-dismissed by the time we look.
  const dialog = page.getByText('Opening rolls');
  if (await dialog.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await page.mouse.click(180, 400);
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  }
}

async function readMobileWallCount(page: Page): Promise<number> {
  // Mobile shell shows the wall count in `GameStatusBar` as
  // "X tiles in wall"; desktop shell shows the per-seat "X left" badge.
  const text = await page.getByText(/\d+ tiles in wall/).innerText();
  const m = text.match(/(\d+)\s*tiles in wall/);
  return m ? Number.parseInt(m[1]!, 10) : Number.NaN;
}

async function firstHandTileSignature(page: Page): Promise<string> {
  // Each hand tile has a unique accessibility label encoding the face
  // (e.g. "Bamboo 5", "East wind"). The label sits on the inner `Tile`
  // <View>, while `own-hand-tile` testID is on the outer Animated.View
  // wrapper — so descend into the first hand tile's child to read it.
  const first = page.getByTestId('own-hand-tile').first();
  const labeled = first.locator('[aria-label]').first();
  return (await labeled.getAttribute('aria-label')) ?? '';
}
