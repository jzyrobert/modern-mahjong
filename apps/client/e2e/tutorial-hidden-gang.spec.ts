import { expect, test } from './_helpers';

/**
 * End-to-end coverage for the `hidden-gang` lesson — the user is
 * dealt four 5-sou tiles at seed=63 and declares a concealed gang
 * on their first action. The "Declare gang" button is rendered by
 * `Match.tsx`'s `concealedGangTile` prop whenever the user holds
 * 4 copies of any face.
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
        // Pre-mark every prior lesson so the lobby card lands on
        // hidden-gang directly.
        tutorialsCompleted: ['basics', 'safety', 'claims', 'win'],
      }),
    );
  });
});

test.describe('tutorial: hidden-gang', () => {
  test('happy path: continue → declare gang → completion persists', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

    await page.getByLabel('Start Concealed gang').click();

    // Step 1 — intro.
    await expect(page.getByText('Concealed gang').first()).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    // Step 2 — declare the gang. The user's 4×5-sou deal makes the
    // "Declare gang" button visible from the first render.
    await expect(page.getByText("You've got four 5-bamboos!")).toBeVisible();
    await page.getByRole('button', { name: 'Declare gang' }).click();

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
    expect(completed).toContain('hidden-gang');
  });
});
