import { expect, test } from './_helpers';

/**
 * End-to-end coverage for the `ron` lesson — winning off an
 * opponent's discard. The lesson runs on seed 16355, where seat 0's
 * 14-tile opening hand (sorted: 1m 4m 5m 6m 2p 3p 4p 5p 5p 5p 4s 5s
 * 6s HW) is at shanten 1; dropping the HW (West wind) tile at the
 * end of the hand leaves seat 0 waiting on 1m, which seat 1 holds
 * in their opening hand. `setupAfterFirstDiscard` reads the user's
 * remaining hand at runtime and scripts the matching bot's first
 * discard via `__MAHJONG_TEST_BOT_SCRIPTS__`.
 */

const TEST_SEED = 16355;

test.beforeEach(async ({ page }) => {
  await page.addInitScript((seed) => {
    (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
    // Pin Math.random deterministically so passive bots take the
    // pass branch in their coin-flip claim path — without this, an
    // intermediate bot could `peng` on the user's HW discard before
    // seat 1's scripted 1m throw lands, flipping the engine into a
    // different turn order and hanging the lesson on the watch
    // step. The same pin is used in `tutorial-claims.spec.ts`.
    Math.random = () => 0.1;
    // Pre-mark only `basics` complete — `ron` slots second in
    // LESSON_ORDER (after basics, before safety), so the lobby card
    // lands directly on the ron lesson when the only prior lesson
    // is done. Shape matches `tutorial-claims.spec.ts:13-33`.
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
  }, TEST_SEED);
});

test.describe('tutorial: ron', () => {
  test('happy path: discard HW → bot discards wait → claim hu → complete', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

    await page.getByLabel('Start Winning off a discard').click();

    // Step 1 — intro caption.
    await expect(page.getByText('Winning off a discard')).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    // Step 2 — discard HW. Honors sort after suits in `tileOrder`,
    // so the West wind sits last in the rendered own-hand row.
    // `setupAfterFirstDiscard` reads the resulting 13-tile hand and
    // scripts seat 1's first discard to the matching wait tile (1m).
    await expect(page.getByText('Set up your wait')).toBeVisible();
    await page.getByTestId('own-hand-tile').last().click();

    // Step 3 — watch bots. The lesson sits on this caption until the
    // engine parks at `awaitingClaims` with a non-user discard the
    // user can ron on. At pace=0 (the suite default), the watch
    // caption flashes too quickly to assert directly — the claim
    // caption assertion below is the load-bearing check.
    //
    // Step 4 — claim bar shows the Win button. `<ClaimAction>` for
    // hu renders an accessibilityRole="button" Pressable with
    // accessibilityLabel="Win" (see `ClaimBar.tsx`); the button's
    // visible text is "Win · 0 faan" when faan is present, so prefer
    // the accessible role+name selector over an exact-text match.
    await expect(page.getByText('Claim the win!')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Win' }).click();

    // Step 5 — completion.
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
    expect(completed).toContain('ron');
  });
});
