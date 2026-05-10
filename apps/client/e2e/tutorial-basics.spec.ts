import { expect, test } from './_helpers';

/**
 * End-to-end coverage for the `basics` lesson — the user-facing
 * rollout of the tutorial system. The framework-level invariants
 * (registry, overlay, controller) are guarded separately by
 * `tutorial-framework.spec.ts`; this file walks the canonical user
 * paths through the lesson flow.
 *
 * The lesson seed is `5` (matching `solo-match.spec.ts`), forced
 * onto seat 0 as dealer via `lesson.dealer: 0`. Every run produces
 * the same wall, so the "tap any tile to discard" step always
 * advances on the same engine state shape.
 */

test.describe('tutorial: basics', () => {
  test('happy path: lobby card → 6 steps → completion persists', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

    // Lobby Tutorial card lists every lesson; "Basics: a guided
    // hand" is the first row. Pre-completion the row shows "Start"
    // (vs "Replay"); same accessibility label drives both.
    await expect(page.getByLabel('Start Basics: a guided hand')).toBeVisible();
    await page.getByLabel('Start Basics: a guided hand').click();

    // Step 1 — opening dice intro. Basics is the only lesson that
    // surfaces the dice ceremony; subsequent lessons suppress it.
    await expect(page.getByText('Opening dice')).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    // Step 2 — welcome.
    await expect(page.getByText('Welcome to mahjong')).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    // Step 3 — your hand.
    await expect(page.getByText('These are your 14 tiles')).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    // Step 4 — first discard.
    await expect(page.getByText('Pick a tile to discard')).toBeVisible();
    await page.getByTestId('own-hand-tile').first().click();

    // Steps 5 ("Now watch the bots") flashes by quickly with bot
    // pace = 0; assert directly on step 6 ("Lesson complete!").
    await expect(page.getByText('Lesson complete!')).toBeVisible({ timeout: 30_000 });

    await page.getByRole('button', { name: 'Done' }).click();

    // Overlay tears down.
    await expect(page.getByText('Lesson complete!')).toBeHidden();

    // Regression: once the lesson is over the dice modal must not
    // come back. The tutorial dismissal used to be keyed only by
    // lesson id; after the controller cleared, the open check fell
    // through to the seed gate (which had never been pinned) and the
    // modal re-popped on top of the empty board.
    await expect(page.getByText('Opening rolls')).toBeHidden();
    await expect(page.getByText('Dealer rolls')).toBeHidden();

    // Settings round-trip: tutorialsCompleted now lists 'basics'.
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
  });

  test('skip mid-lesson does not mark complete', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
    await page.getByLabel('Start Basics: a guided hand').click();

    // Step through dice → welcome → your-hand, then skip.
    await expect(page.getByText('Opening dice')).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByText('Welcome to mahjong')).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByText('These are your 14 tiles')).toBeVisible();

    // Skip from step 2.
    await page.getByRole('button', { name: 'Skip lesson' }).click();
    await expect(page.getByText('These are your 14 tiles')).toBeHidden();

    // tutorialsCompleted stays empty.
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
    // The settings key may not exist yet (first run); either way,
    // 'basics' must NOT be in there.
    expect(completed ?? []).not.toContain('basics');
  });

  test('after basics completion, lobby card advances to the next lesson', async ({ page }) => {
    // Pre-mark only basics complete so the next lesson in
    // `LESSON_ORDER` (safety) becomes the card's CTA.
    await page.addInitScript(() => {
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
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

    // Both rows render; basics shows ✓ via its accessibilityLabel
    // ("Replay …"), and "Reading the table" stays "Start …".
    await expect(page.getByLabel('Replay Basics: a guided hand')).toBeVisible();
    await expect(page.getByLabel('Start Reading the table')).toBeVisible();
  });

  test('once every lesson is complete, every row shows the Replay label', async ({ page }) => {
    await page.addInitScript(() => {
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
          tutorialsCompleted: ['basics', 'safety', 'claims', 'win', 'hidden-gang'],
        }),
      );
    });

    await page.goto('/');
    await expect(page.getByLabel('Replay Basics: a guided hand')).toBeVisible();
    await expect(page.getByLabel('Replay Reading the table')).toBeVisible();
    await expect(page.getByLabel('Replay Claiming a chi')).toBeVisible();
    await expect(page.getByLabel('Replay Winning a hand')).toBeVisible();
    await expect(page.getByLabel('Replay Concealed gang')).toBeVisible();
  });

  test('"Tutorial" row appears in the in-match menu once basics is complete', async ({ page }) => {
    await page.addInitScript(() => {
      const w = globalThis as { __MAHJONG_TEST_SEED__?: number };
      w.__MAHJONG_TEST_SEED__ = 5;
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
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Play vs bots' }).click();
    await page.getByRole('button', { name: 'Start match' }).click();
    await page.getByTestId('own-hand-tile').first().waitFor();

    // Menu now shows "Tutorial: <next lesson>" (Safety, since
    // basics is already complete).
    await page.getByLabel('Open menu').first().click();
    await expect(page.getByLabel('Tutorial: Reading the table')).toBeVisible();

    await page.getByLabel('Tutorial: Reading the table').click();
    await expect(page.getByText('Reading the table')).toBeVisible();
  });
});
