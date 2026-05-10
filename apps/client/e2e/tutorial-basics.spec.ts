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
  test('happy path: lobby card → 5 steps → completion persists', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

    // Lobby card pre-completion shows "Start tutorial".
    await expect(page.getByRole('button', { name: 'Start tutorial' })).toBeVisible();
    await page.getByRole('button', { name: 'Start tutorial' }).click();

    // Step 1 — welcome (centered, no target).
    await expect(page.getByText('Welcome to mahjong')).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    // Step 2 — your hand (target=own-hand, info-only). Match shell
    // has rendered at this point so the registered target resolves.
    await expect(page.getByText('These are your 14 tiles')).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    // Step 3 — first discard. Tapping any hand tile auto-advances
    // (predicate: discards[0].length >= 1).
    await expect(page.getByText('Pick a tile to discard')).toBeVisible();
    await page.getByTestId('own-hand-tile').first().click();

    // Step 4 ("Now watch the bots") and step 5 ("Lesson complete!").
    // With bot pace = 0 (set by `_helpers`) the bot cycle completes
    // in a few milliseconds, so step 4's caption typically flashes by
    // before Playwright's poll catches it. Skip the intermediate
    // assertion and wait directly for step 5.
    await expect(page.getByText('Lesson complete!')).toBeVisible({ timeout: 30_000 });

    // Step 5 — final. "Done" CTA marks the lesson complete in
    // settings.
    await page.getByRole('button', { name: 'Done' }).click();

    // Overlay tears down.
    await expect(page.getByText('Lesson complete!')).toBeHidden();

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
    await page.getByRole('button', { name: 'Start tutorial' }).click();

    await expect(page.getByText('Welcome to mahjong')).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click(); // step 1 → 2
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

    // The card now points at the next lesson (Reading the table).
    await expect(page.getByRole('button', { name: /Continue: Reading the table/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start tutorial' })).toBeHidden();
  });

  test('once every lesson is complete, the lobby card flips to "Replay basics"', async ({
    page,
  }) => {
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
          tutorialsCompleted: ['basics', 'safety'],
        }),
      );
    });

    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Replay basics' })).toBeVisible();
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
