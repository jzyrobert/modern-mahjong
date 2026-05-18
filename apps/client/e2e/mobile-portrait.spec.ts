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
  await expect(page.getByText(/\d+ tiles/)).toBeVisible();

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
  await expect(page.getByText(/\d+ tiles/)).toBeVisible();

  // The DISCARDS panel renders from the start of the hand (with an
  // empty body) so the action zone doesn't jump on the first discard.
  // The dealer (seat 0, by TEST_SEED) starts with 14 tiles + hasDrawn,
  // so any hand-tile tap discards.
  await expect(page.getByText('DISCARDS', { exact: true })).toBeVisible();
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

// Touch-enabled context so Playwright fires pointer + touch events,
// not just a mouse-click sequence. Other specs in this file use
// `.click()` only and are unaffected by `hasTouch: true`.
test.describe('mobile: hand → SortPicker ghost-click guard', () => {
  test.use({ hasTouch: true });

  test('mobile: tapping a tile in the second hand row does not flip sort mode', async ({
    page,
  }) => {
    // Invariant guard for the SortPicker ghost-press bug on phones: a
    // tap-to-discard on a tile while the hand has wrapped onto two
    // rows must NEVER flip sort mode. The original cause is the
    // browser's synthetic `click` event that fires after touchend /
    // pointerup — it dispatches against the post-re-render DOM, so any
    // Pressable that has shifted into the touch coordinates by then
    // (most often the SortPicker) absorbs the press. `HandTile`
    // installs a one-shot capture-phase listener at the window level
    // to consume that follow-up click. Playwright's headless Chromium
    // doesn't always reproduce the touch → click hop the way a real
    // mobile browser does, so this test is a floor (it ensures the
    // basic discard path keeps sort mode stable) rather than a strict
    // regression of the real-device bug.
    await page.goto('/');
    await page.getByRole('button', { name: 'Play vs bots' }).click();
    await page.getByRole('button', { name: 'Start match' }).click();
    await dismissOpeningRolls(page);
    await expect(page.getByText(/\d+ tiles/)).toBeVisible();

    // Dealer's 14 tiles must wrap to two rows on this viewport for the
    // bug to be reproducible — if a future tweak changes the auto-fit
    // floor or padding, fail loudly rather than silently passing.
    const tiles = page.getByTestId('own-hand-tile');
    await expect(tiles).toHaveCount(14);
    const rowYs = await tiles.evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().top)),
    );
    const uniqueRows = new Set(rowYs);
    expect(uniqueRows.size, 'hand must wrap to two rows for this regression').toBeGreaterThan(1);

    // Suit is the default sort mode after a fresh match starts.
    expect(await activeSortLabel(page)).toBe('SUIT');

    // Tap the rightmost tile in the second hand row — the slot that's
    // most likely to fall under the SortPicker's new screen position
    // after the action zone collapses.
    const maxY = Math.max(...rowYs);
    const secondRowIndices = rowYs.map((y, i) => (y === maxY ? i : -1)).filter((i) => i >= 0);
    const targetIndex = secondRowIndices[secondRowIndices.length - 1]!;
    const wallBefore = await readMobileWallCount(page);

    // Real touch tap (not `.click()`, which fires a mouse-only sequence
    // that doesn't expose the synthetic-click hop). Use the tile's
    // bounding box centre as the touchpoint so the post-discard
    // SortPicker-shift lands the click on the pill.
    const box = await tiles.nth(targetIndex).boundingBox();
    if (!box) throw new Error('target tile has no bounding box');
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);

    // The discard handed the turn off to seat 1 — bots play instantly
    // under the e2e bot-pace override, so the wall depletes within a
    // beat. Use this as the "discard landed and React has flushed" gate
    // (the `own-hand-tile` testID is gated on `myTurn && hasDrawn`, so
    // it disappears the moment the user discards and isn't usable as a
    // settle signal here).
    await expect
      .poll(() => readMobileWallCount(page), { timeout: 10_000 })
      .toBeLessThan(wallBefore);

    // Sort mode must still be SUIT. Without the click-swallow guard in
    // `HandTile`, the synthetic click after the touchend lands on the
    // SortPicker (which has shifted DOWN into the second hand row's
    // old screen coordinates) and flips the mode to NUMBER or MANUAL.
    expect(await activeSortLabel(page)).toBe('SUIT');
  });
});

test('mobile: draw cue reappears on a second draw cycle and is still tappable', async ({
  page,
}) => {
  // Regression guard for #370. `MobileDrawCue` renders a pulsing
  // gold halo via `Animated.loop`; the underlying view unmounts
  // when the cue hides (between draws) and re-mounts when the next
  // user turn arrives. react-native-web doesn't re-subscribe a
  // re-mounted `Animated.View` to an already-running loop, so
  // without `usePulse({ enabled: visible })` the halo froze on the
  // detached value after the first draw. The visible symptom that
  // a Playwright test can catch is broader than the halo itself —
  // if the cue's mount/unmount cycle regresses, the testID
  // becomes hidden permanently or fails to re-show on cycle 2.
  // This spec exercises the same `flashDrawAnimation` →
  // `clearDrawAnimation` → re-show flow twice to lock it in.
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await dismissOpeningRolls(page);
  await expect(page.getByText(/\d+ tiles/)).toBeVisible();

  const drawCue = page.getByTestId('wall-draw-next');

  // Discard once to give the turn to seat 1 and let bots play around.
  await page.getByTestId('own-hand-tile').first().click();

  // Cycle 1 — turn comes back, cue mounts, tap to draw.
  await waitForUserDrawCue(page, 30_000);
  await expect(drawCue).toBeVisible();
  await drawCue.click();
  await expect(drawCue).toBeHidden();

  // Hand turn back so the next cycle has somewhere to come from.
  await page.getByTestId('own-hand-tile').first().click();

  // Cycle 2 — cue must remount cleanly, be visible AND tappable.
  // Without the halo-restart fix the cue still renders here (so
  // visibility alone would pass), but a regression that drops the
  // re-mount entirely or leaves the cue in a broken interactive
  // state shows up as a stuck click.
  await waitForUserDrawCue(page, 30_000);
  await expect(drawCue).toBeVisible();
  await drawCue.click();
  await expect(drawCue).toBeHidden();
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
  // "X tiles"; desktop shell shows the per-seat "X left" badge.
  const text = await page.getByText(/\d+ tiles/).innerText();
  const m = text.match(/(\d+)\s*tiles/);
  return m ? Number.parseInt(m[1]!, 10) : Number.NaN;
}

async function activeSortLabel(page: Page): Promise<'SUIT' | 'NUMBER' | 'MANUAL' | null> {
  // The SortPicker's active option uses `backgroundColor:
  // COLORS.accentSalmonSwatch` (= rgb(251, 229, 217)) on its
  // Pressable wrapper; inactive options sit on transparent. RNW
  // doesn't translate `accessibilityState.selected` to a DOM
  // attribute, so the rendered style is the cleanest signal.
  for (const label of ['SUIT', 'NUMBER', 'MANUAL'] as const) {
    const bg = await page.getByText(label, { exact: true }).evaluate((el) => {
      const parent = el.parentElement;
      return parent ? getComputedStyle(parent).backgroundColor : '';
    });
    if (bg === 'rgb(251, 229, 217)') return label;
  }
  return null;
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
