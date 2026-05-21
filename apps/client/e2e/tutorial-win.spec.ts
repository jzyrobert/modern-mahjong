import { expect, test } from './_helpers';

/**
 * End-to-end coverage for the `win` lesson — the user is dealt a
 * pre-winning 14-tile hand at seed=174502 and declares tsumo
 * immediately. Tutorials run with `faanMin: 0` (set in
 * `joinSoloTutorial`), so this faan-0 winning shape is legal.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'mj.settings.v1',
      JSON.stringify({
        felt: 'sage',
        tileBack: 'cream',
        animations: true,
        sound: false,
        discardHint: false,
        botSkills: ['heuristic', 'simple', 'passive'],
        autoRecordReplays: false,
        replayQuota: 50,
        // Pre-mark every lesson up to win as complete so the lobby
        // card lands directly on win.
        tutorialsCompleted: ['basics', 'ron', 'safety', 'claims', 'peng'],
      }),
    );
  });
});

test.describe('tutorial: win', () => {
  test('happy path: continue → declare tsumo → completion persists', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

    await page.getByLabel('Start Winning a hand').click();

    // Step 1 — intro.
    await expect(page.getByText('Winning a hand')).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    // Step 2 — declare tsumo. The dealer's natural deal at this
    // seed is a complete 4-melds + pair shape, so the
    // "Declare win (tsumo, …)" button is present from the first
    // render. The label includes the projected faan in brackets, so
    // match by prefix rather than exact text.
    await expect(page.getByText("You're already winning!")).toBeVisible();
    await page.getByRole('button', { name: /^Declare win \(tsumo/ }).click();

    // Step 3 — final.
    await expect(page.getByText('Lesson complete!')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Done' }).click();

    const completed = await page.evaluate(() => {
      const raw = localStorage.getItem('mj.settings.v1');
      if (!raw) return null;
      try {
        const s = JSON.parse(raw) as { tutorialsCompleted?: string[] };
        return s.tutorialsCompleted ?? null;
      } catch {
        return null;
      }
    });
    expect(completed).toContain('win');
  });
});
