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

  test('after completion the lobby card collapses to "Replay tutorial"', async ({ page }) => {
    // Pre-mark completion via localStorage so we can assert the
    // post-completion lobby UI without re-running the full lesson.
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

    // Card now exposes the Replay CTA instead of Start.
    await expect(page.getByRole('button', { name: 'Replay tutorial' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start tutorial' })).toBeHidden();
  });

  test('"Replay tutorial" appears in the in-match menu once basics is complete', async ({
    page,
  }) => {
    // Pre-mark basics complete so the menu row appears. The lobby
    // and the in-match menu both gate on
    // `settings.tutorialsCompleted.includes('basics')`. Also pin the
    // seed so the lobby's dice ceremony lands deterministically (the
    // existing solo-match.spec.ts uses the same seed).
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
    // Join a regular practice match (NOT the tutorial card). The
    // "Replay tutorial" row should still appear because basics has
    // been completed before. Lobby waiting room → Start match →
    // match shell with menu pill reachable.
    await page.getByRole('button', { name: 'Play vs bots' }).click();
    await page.getByRole('button', { name: 'Start match' }).click();

    // Wait for the match shell to render.
    await page.getByTestId('own-hand-tile').first().waitFor();

    // Open ☰ menu and verify the "Replay tutorial" row is present.
    // Multiple buttons map to "Open menu" via `accessibilityLabel`
    // (DesktopShell's TopBar pill + the menu sheet's close button
    // also routed through the modal); pick the first match — that's
    // the chrome-row pill in both shells.
    await page.getByLabel('Open menu').first().click();
    await expect(page.getByLabel('Replay tutorial')).toBeVisible();

    // Tapping it kicks off a fresh tutorial run, dropping the
    // welcome overlay over whatever was on screen.
    await page.getByLabel('Replay tutorial').click();
    await expect(page.getByText('Welcome to mahjong')).toBeVisible();
  });
});
