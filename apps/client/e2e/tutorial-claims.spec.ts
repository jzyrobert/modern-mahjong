import { expect, test } from './_helpers';

/**
 * End-to-end coverage for the `claims` lesson — the chi
 * walkthrough. Bot 3 is scripted (via the lesson's bot scripts +
 * the existing `__MAHJONG_TEST_BOT_SCRIPTS__` global) to discard
 * 5-pin on its first turn, completing the user's 4p + 6p chi
 * opportunity.
 */

const TEST_SEED = 5;

test.beforeEach(async ({ page }) => {
  await page.addInitScript((seed) => {
    (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
    // Pre-mark basics + safety complete so the lobby card lands
    // directly on claims.
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
        tutorialsCompleted: ['basics', 'safety'],
      }),
    );
  }, TEST_SEED);
});

test.describe('tutorial: claims', () => {
  test('happy path: continue → 5 steps → completion persists', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

    await page.getByLabel('Start Claiming a chi').click();

    // Step 1 — intro.
    await expect(page.getByText('Claiming a tile')).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    // Step 2 — first discard.
    await expect(page.getByText('Take your first turn')).toBeVisible();
    await page.getByTestId('own-hand-tile').first().click();

    // Step 3 — watch the bots play. Between the user's discard and
    // seat 3's scripted 5-pin discard, the lesson sits on the
    // 'Watch the bots play' caption so 'Claim the chi!' can't pop
    // before the chi button exists. At pace=0 (the suite default)
    // the caption flashes too fast to assert via Playwright polling
    // — the chi click below would intercept-fail if the claim
    // caption landed before the claim-bar registered its target,
    // which is the regression this step covers.
    //
    // Step 4 — claim bar shows after bot 3's scripted 5-pin discard.
    // Tap the chi button. `<CallButton>` is a Pressable rendering a
    // Chinese-character + English-label pair without an explicit
    // accessibilityRole, so target the English label text. Note
    // textTransform: uppercase is CSS — the DOM still holds "Chi"
    // (capital C, lowercase rest), not "CHI".
    await expect(page.getByText('Claim the chi!')).toBeVisible({ timeout: 10_000 });
    await page.getByText('Chi', { exact: true }).click();

    // Step 5 — final.
    await expect(page.getByText('Lesson complete!')).toBeVisible();
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
    expect(completed).toContain('claims');
  });
});
