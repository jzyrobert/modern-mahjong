import { expect, test } from './_helpers';

/**
 * End-to-end coverage for the `robbing-kong` lesson — declaring hu
 * to rob an opponent's promoted gang. The lesson runs on seed
 * 25701 with a per-lesson `prepareState` hook that injects a
 * pre-built peng meld of 3-pin into seat 1 + places the 4th 3-pin
 * in seat 1's hand. After the user discards the last sorted tile
 * (the F White-dragon) they're at shanten-0 wait 3-pin; the bot
 * pacing loop's new `promotions` branch fires `declareGangPromoted`
 * on seat 1's first own-turn; the engine opens the rob window and
 * the user taps Win.
 *
 * The lesson uses `faanMin: 3` — a plain ron on 3-pin scores
 * `門前清 + 平和 = 2 faan` (below the floor), but the rob earns
 * `搶槓 + 門前清 + 平和 = 3 faan` exactly. The engine's
 * `hasMeaningfulClaim` / `canScoredHu` gate filters out any
 * intermediate ron the user might accidentally trigger, and the
 * spec asserts the breakdown contains 搶槓 to guard the rob path.
 */

const TEST_SEED = 25701;

test.beforeEach(async ({ page }) => {
  await page.addInitScript((seed) => {
    (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
    // Pin Math.random deterministically so passive bots take the
    // pass branch in their coin-flip claim path — same pin as the
    // other tutorial specs.
    Math.random = () => 0.1;
    // Pre-mark every prior lesson complete so the lobby's "first
    // incomplete" cursor lands on `robbing-kong`. Mirrors the
    // pre-mark shape from `tutorial-peng.spec.ts` extended by the
    // new lesson's slot in LESSON_ORDER.
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
        tutorialsCompleted: ['basics', 'ron', 'safety', 'claims', 'peng'],
      }),
    );
  }, TEST_SEED);
});

test.describe('tutorial: robbing-kong', () => {
  test('happy path: discard F → bot promotes peng → rob the kong → complete', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

    await page.getByLabel('Start Robbing the kong').click();

    // Step 1 — intro caption.
    await expect(page.getByText('Robbing the kong (搶槓)')).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    // Step 2 — discard F (the last sorted tile of the 14-tile hand).
    // The user's hand reads `6m 7m 8m 2p 4p 5p 5p 7p 8p 9p 4s 5s 6s F`
    // after `prepareState`; tapping the last own-hand-tile drops F.
    await expect(page.getByText('Take your first turn')).toBeVisible();
    await page.getByTestId('own-hand-tile').last().click();

    // Step 3 — watch seat 1 draw. The lesson sits on this caption
    // until `state.pendingPromotedGang` is set; at pace=0 (the
    // suite default) it flashes through quickly, so we rely on the
    // claim caption assertion below as the load-bearing wait.
    //
    // Step 4 — rob window opens; the gold Win button surfaces.
    // `<ClaimAction>` renders accessibilityLabel="Win" (per
    // `ClaimBar.tsx`), so prefer the accessible role+name selector.
    await expect(page.getByText('Rob the kong!')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Win' }).click();

    // Step 5 — completion.
    await expect(page.getByText('Lesson complete!')).toBeVisible();

    // Engine-surface guard: the win's breakdown must include the
    // 搶槓 entry — that's the load-bearing assertion that the lesson
    // actually exercised the rob path (rather than e.g. a stale
    // tsumo or chained discard). Pull state via the test hatch
    // before the Done button dismisses the lesson.
    const breakdownNames = await page.evaluate(() => {
      const w = globalThis as {
        __MAHJONG_TEST_GET_STATE__?: () => { state: { lastResult: unknown } | null };
      };
      const live = w.__MAHJONG_TEST_GET_STATE__?.();
      const result = live?.state?.lastResult as
        | { kind: string; selfDraw: boolean; breakdown: { name: string }[] }
        | undefined;
      return result?.breakdown.map((b) => b.name) ?? null;
    });
    expect(breakdownNames).toContain('搶槓');
    expect(breakdownNames).toContain('門前清');
    expect(breakdownNames).toContain('平和');

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
    expect(completed).toContain('robbing-kong');
  });
});
