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

    // Lesson's "Lesson complete!" caption tears down — the post-
    // completion prompt that takes its place uses "Nice work!" as
    // its title (see CompletionPrompt in TutorialOverlay.tsx).
    await expect(page.getByText('Lesson complete!')).toBeHidden();
    await expect(page.getByText('Nice work!')).toBeVisible();
    // With only basics complete, the prompt offers the *next*
    // curriculum entry ("Winning off a discard" — the ron lesson)
    // plus the always-on "Continue playing" / "Back to lobby"
    // affordances.
    await expect(page.getByLabel('Start next lesson: Winning off a discard')).toBeVisible();
    await expect(page.getByLabel('Continue playing')).toBeVisible();
    await expect(page.getByLabel('Back to lobby')).toBeVisible();

    // Dismiss the prompt — "Continue playing" leaves the user in
    // the just-finished tutorial's match without starting a new one.
    await page.getByLabel('Continue playing').click();
    await expect(page.getByText('Nice work!')).toBeHidden();

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

  test('post-completion prompt: "Next lesson" launches the following lesson', async ({ page }) => {
    // Pre-mark basics + ron complete so we can run safety end-to-end
    // and confirm the prompt's "Next lesson" CTA jumps to claims
    // (the entry after safety in LESSON_ORDER). Walking ron in this
    // test would couple it to the ron lesson's seed engineering;
    // tutorial-ron.spec.ts already covers that path.
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
          tutorialsCompleted: ['basics', 'ron'],
        }),
      );
    });

    await page.goto('/');
    await page.getByLabel('Start Reading the table').click();

    // Walk through safety to the final step. The flow matches
    // tutorial-safety.spec.ts — kept inline here so this test
    // exercises the lobby → lesson → prompt → next-lesson loop
    // without coupling to that file.
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByText('Take a turn')).toBeVisible();
    await page.getByTestId('own-hand-tile').first().click();
    await expect(page.getByText('Tip: enable the discard hint')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByText('Lesson complete!')).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();

    // Prompt offers "claims" (Claiming a chi) as the next lesson.
    await expect(page.getByLabel('Start next lesson: Claiming a chi')).toBeVisible();
    await page.getByLabel('Start next lesson: Claiming a chi').click();

    // Claims lesson begins — its intro step renders.
    await expect(page.getByText('Claiming a tile')).toBeVisible();
  });

  test('replay after completion re-opens the dice modal', async ({ page }) => {
    // Bug regression: the in-lesson dice dismissal pinned an
    // in-memory `dismissedSeed` to suppress the modal re-popping
    // post-lesson. That pin survived `begin('basics')` on replay
    // because the reset ran in a `useEffect` that fires after commit
    // — too late for the first render's `open` predicate, so the
    // modal stayed hidden on the second run.
    await page.goto('/');
    await page.getByLabel('Start Basics: a guided hand').click();

    // Walk through the full lesson once.
    await expect(page.getByText('Opening dice')).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByText('Welcome to mahjong')).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByText('These are your 14 tiles')).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();
    await expect(page.getByText('Pick a tile to discard')).toBeVisible();
    await page.getByTestId('own-hand-tile').first().click();
    await expect(page.getByText('Lesson complete!')).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Done' }).click();

    // Return to the lobby via the post-completion prompt's "Back to
    // lobby" affordance (a soft `router.replace('/')` — see
    // `CompletionPrompt.onLeaveToLobby` in TutorialOverlay.tsx).
    // Crucially NOT `page.goto('/')`: a hard reload would unmount
    // DiceCeremony (root layout) and wipe the stale local state the
    // regression depends on.
    await expect(page.getByLabel('Back to lobby')).toBeVisible();
    await page.getByLabel('Back to lobby').click();
    await expect(page.getByLabel('Replay Basics: a guided hand')).toBeVisible();
    await page.getByLabel('Replay Basics: a guided hand').click();

    // The dice modal must re-open on replay. Pre-fix, the stale
    // in-memory `dismissedSeed` (5, pinned during the first run)
    // matched the lesson seed and gated the modal closed.
    await expect(page.getByText('Opening rolls')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText('Opening dice')).toBeVisible();
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
      // Pre-mark basics + ron so the next-lesson cursor advances to
      // safety. The "Tutorial" menu row tracks whichever lesson the
      // user hasn't done yet; the ron row would otherwise show here
      // and the safety-targeted assertions below would fail.
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
          tutorialsCompleted: ['basics', 'ron'],
        }),
      );
    });

    await page.goto('/');
    await page.getByRole('button', { name: 'Play vs bots' }).click();
    await page.getByRole('button', { name: 'Start match' }).click();
    await page.getByTestId('own-hand-tile').first().waitFor();

    // Menu now shows "Tutorial: <next lesson>" (Reading the table,
    // since basics + ron are already complete).
    await page.getByLabel('Open menu').first().click();
    await expect(page.getByLabel('Tutorial: Reading the table')).toBeVisible();

    await page.getByLabel('Tutorial: Reading the table').click();
    await expect(page.getByText('Reading the table')).toBeVisible();
  });
});
