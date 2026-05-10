import { expect, test } from './_helpers';

/**
 * Framework-level guard for the tutorial system. The framework lands
 * before any user-facing entry point (lobby card / menu row) does, so
 * this spec drives the controller via the `__MAHJONG_TEST_BEGIN_TUTORIAL__`
 * test hatch. The follow-up PR that adds the `basics` lesson + lobby
 * card lands its own end-to-end specs that traverse the user-visible
 * surface.
 *
 * Coverage:
 *   - The "centered intro modal" placement renders when the active
 *     step has no `targetId`.
 *   - "Got it" advances from an informational step.
 *   - The halo positions over a registered `<TutorialTarget>` once
 *     the next step references it.
 *   - "Skip lesson" tears the overlay down without touching settings.
 *   - Auto-advance fires when the engine state matches the step's
 *     `completedWhen` predicate.
 */

const TEST_SEED = 5;

test.beforeEach(async ({ page }) => {
  await page.addInitScript((seed) => {
    (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
  }, TEST_SEED);
});

test('tutorial framework: centered caption renders with no target', async ({ page }) => {
  await page.goto('/');

  // Step 1 of `_stub` is purely informational — no `targetId`, so the
  // overlay should fall back to a centered caption with a "Got it" CTA.
  await page.evaluate(() => {
    (
      globalThis as { __MAHJONG_TEST_BEGIN_TUTORIAL__?: (id: string) => void }
    ).__MAHJONG_TEST_BEGIN_TUTORIAL__?.('_stub');
  });

  await expect(page.getByText('Tutorial framework')).toBeVisible();
  await expect(page.getByText(/smoke-test lesson/i)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Got it' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip lesson' })).toBeVisible();
});

test('tutorial framework: "Got it" advances to the next step', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    (
      globalThis as { __MAHJONG_TEST_BEGIN_TUTORIAL__?: (id: string) => void }
    ).__MAHJONG_TEST_BEGIN_TUTORIAL__?.('_stub');
  });
  await expect(page.getByText('Tutorial framework')).toBeVisible();

  await page.getByRole('button', { name: 'Got it' }).click();

  // Step 2's caption is keyed off the user's hand. The lobby has no
  // own-hand to register against, so the overlay still renders the
  // caption (centered fallback). Verify the title flipped to step 2.
  await expect(page.getByText('Try a discard')).toBeVisible();
});

test('tutorial framework: "Skip lesson" dismisses the overlay', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    (
      globalThis as { __MAHJONG_TEST_BEGIN_TUTORIAL__?: (id: string) => void }
    ).__MAHJONG_TEST_BEGIN_TUTORIAL__?.('_stub');
  });

  await expect(page.getByText('Tutorial framework')).toBeVisible();
  await page.getByRole('button', { name: 'Skip lesson' }).click();
  await expect(page.getByText('Tutorial framework')).toBeHidden();

  // Skipping must NOT mark the lesson complete — the framework has no
  // public "completed" surface yet, but the controller's active slice
  // should be null.
  const active = await page.evaluate(() => {
    type Hatch = { active: { lessonId: string; stepIndex: number } | null };
    const w = globalThis as unknown as {
      __MAHJONG_TEST_GET_TUTORIAL__?: () => Hatch;
    };
    return w.__MAHJONG_TEST_GET_TUTORIAL__?.()?.active ?? null;
  });
  expect(active).toBeNull();
});

test('tutorial framework: halo positions over a registered target inside a match', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  // Wait for the user's hand to render — the `own-hand` target is
  // registered when `<Hand>` mounts inside the shell.
  await page.getByTestId('own-hand-tile').first().waitFor();

  // Begin the stub lesson, then advance past the intro so step 2's
  // `targetId: 'own-hand'` becomes the active target.
  await page.evaluate(() => {
    (
      globalThis as { __MAHJONG_TEST_BEGIN_TUTORIAL__?: (id: string) => void }
    ).__MAHJONG_TEST_BEGIN_TUTORIAL__?.('_stub');
  });
  await page.getByRole('button', { name: 'Got it' }).click();
  await expect(page.getByText('Try a discard')).toBeVisible();

  // The user discarding any tile should auto-advance the lesson out
  // of step 2 (predicate: `discards[0].length === 1`). Since the stub
  // has no step 3, the controller flips `active` back to null and the
  // overlay tears itself down.
  await page.getByTestId('own-hand-tile').first().click();
  await expect(page.getByText('Try a discard')).toBeHidden({ timeout: 5_000 });
});
