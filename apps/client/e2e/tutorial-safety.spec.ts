import { expect, test } from './_helpers';

/**
 * End-to-end coverage for the `safety` lesson — the "reading the
 * table" walkthrough that follows basics in `LESSON_ORDER`. The
 * framework-level invariants are guarded separately by
 * `tutorial-framework.spec.ts`; basics-level entry-point coverage
 * lives in `tutorial-basics.spec.ts`.
 */

const TEST_SEED = 5;

test.beforeEach(async ({ page }) => {
  await page.addInitScript((seed) => {
    (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
    // Pre-mark basics complete so the lobby card lands directly on
    // safety. Doing the basics walkthrough every test would inflate
    // the suite with ~6s of redundant runtime per run.
    localStorage.setItem(
      'mj.settings.v1',
      JSON.stringify({
        felt: 'sage',
        tileBack: 'cream',
        autoSort: true,
        animations: true,
        sound: false,
        discardHint: false,
        botSkills: ['heuristic', 'simple', 'passive'],
        autoRecordReplays: false,
        replayQuota: 50,
        tutorialsCompleted: ['basics'],
      }),
    );
  }, TEST_SEED);
});

test.describe('tutorial: safety', () => {
  test('happy path: continue from basics → 4 steps → completion persists', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

    // Lobby Tutorial card lists every lesson as a row; basics is
    // pre-marked complete so its row shows the ✓, and "Reading the
    // table" remains tappable as "Start …".
    await page.getByLabel('Start Reading the table').click();

    // Step 1 — intro (centered, no target).
    await expect(page.getByText('Reading the table').first()).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    // Step 2 — own-hand target, tap to discard. Predicate fires on
    // discards[0] >= 1.
    await expect(page.getByText('Take a turn')).toBeVisible();
    await page.getByTestId('own-hand-tile').first().click();

    // Step 3 ("Watch the discards") flashes by quickly with bot
    // pace = 0; assert directly on step 4 ("Tip…") instead.
    await expect(page.getByText('Tip: enable the discard hint')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Got it' }).click();

    // Step 5 — final.
    await expect(page.getByText('Lesson complete!')).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();

    await expect(page.getByText('Lesson complete!')).toBeHidden();

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
    expect(completed).toContain('basics');
    expect(completed).toContain('safety');
  });

  test('skip mid-lesson does not mark complete', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('Start Reading the table').click();
    await expect(page.getByText('Reading the table').first()).toBeVisible();

    await page.getByRole('button', { name: 'Skip lesson' }).click();
    await expect(page.getByText('Reading the table').first()).toBeHidden();

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
    expect(completed ?? []).toContain('basics');
    expect(completed ?? []).not.toContain('safety');
  });
});
