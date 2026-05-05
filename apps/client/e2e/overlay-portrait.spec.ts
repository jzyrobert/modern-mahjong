import { expect, test } from '@playwright/test';

// Regression for full-screen overlays (DiceCeremony, WinCelebration)
// at portrait-mobile widths. Both used a `minWidth: 320` / `minWidth:
// 340` pattern with no surrounding gutter, which made the dialog sit
// edge-to-edge on a 320 px iPhone SE-class viewport (rounded corners
// flush with the screen edge, no breathing room from the scrim).
// They now mirror the `Modal` primitive's `padding: 20` outer scrim
// and use `width: 100%; maxWidth: 420`.
test.describe('Overlay dialogs portrait-mobile', () => {
  test('DiceCeremony keeps a gutter on iPhone SE width', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });

    // Suppress the auto-dismiss timer so the dialog stays on-screen
    // long enough to assert against. The dismiss timer is the only
    // long (>1 s) timer the dice ceremony sets; the fade animations
    // stay live.
    await page.addInitScript(() => {
      const orig = window.setTimeout;
      window.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
        if (typeof ms === 'number' && ms >= 1000) return -1 as unknown as number;
        return orig(fn, ms, ...args);
      }) as typeof window.setTimeout;
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Play vs bots' }).click();
    await page.getByRole('button', { name: 'Start match' }).click();

    const dialog = page.locator('text=Opening rolls').first();
    await dialog.waitFor({ state: 'visible', timeout: 5_000 });

    // Walk up to the cream-paper card. Its computed width must be
    // strictly less than the viewport (gutter visible on both sides).
    const card = dialog.locator(
      'xpath=ancestor::*[contains(@style, "border-radius: 16px") or contains(@style, "border-radius:16px")][1]',
    );
    const box = await card.boundingBox();
    if (!box) throw new Error('No bounding box for DiceCeremony card');
    expect(
      box.width,
      `DiceCeremony card width ${box.width} should leave a gutter inside the 320 px viewport`,
    ).toBeLessThanOrEqual(320 - 16);
    expect(
      box.x,
      `DiceCeremony card x=${box.x} should leave at least 8 px of left gutter`,
    ).toBeGreaterThanOrEqual(8);
    expect(
      box.x + box.width,
      `DiceCeremony card right edge ${box.x + box.width} should leave at least 8 px of right gutter`,
    ).toBeLessThanOrEqual(320 - 8);
  });
});
