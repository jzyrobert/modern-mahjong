import { expect, test } from './_helpers';

/**
 * End-to-end coverage for the `peng` lesson — claim the third copy
 * of a face the user already holds a pair of. The lesson runs on
 * seed 140, where seat 0's opening hand is
 *   1s 2s 3m 4s 5s 5s 6s 6s 7p 9p HB HE HF HN
 * (two pairs: 5s and 6s) and seat 1 holds a 6s.
 * `setupAfterFirstDiscard` reads seat 0's remaining hand at
 * runtime, picks a pair, finds the first bot (1 → 2 → 3) that
 * holds the third copy, and scripts that bot's first discard via
 * `__MAHJONG_TEST_BOT_SCRIPTS__`. Shape mirrors
 * `tutorial-claims.spec.ts` closely — the peng button never opens
 * a sub-picker, so there's no single-option engineering needed.
 */

const TEST_SEED = 140;

test.beforeEach(async ({ page }) => {
  await page.addInitScript((seed) => {
    (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
    // Pin Math.random deterministically so passive bots take the
    // pass branch in their coin-flip claim path — without this, an
    // intermediate bot could `peng` on a discard before the lesson's
    // scripted bot reaches its scheduled discard, flipping the
    // engine into a different turn order and hanging the lesson on
    // the watch step. Same pin as `tutorial-claims.spec.ts`.
    Math.random = () => 0.1;
    // Pre-mark every lesson up to and including `claims` complete
    // so the lobby's "first incomplete" cursor lands on `peng`. The
    // lobby card lists every lesson row regardless, so the click
    // target below works either way — pre-marking keeps the suite
    // semantically consistent with the curriculum order.
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
        tutorialsCompleted: ['basics', 'ron', 'safety', 'claims'],
      }),
    );
  }, TEST_SEED);
});

test.describe('tutorial: peng', () => {
  test('happy path: discard → bot discards pair-match → claim peng → complete', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

    await page.getByLabel('Start Claiming a peng').click();

    // Step 1 — intro caption.
    await expect(page.getByText('Claiming a peng')).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    // Step 2 — first discard. Honors sort after suits in `tileOrder`,
    // so the last own-hand-tile is most likely a singleton honour
    // tile rather than part of a pair — picking it preserves the
    // pairs that `setupAfterFirstDiscard` is about to peng on.
    await expect(page.getByText('Take your first turn')).toBeVisible();
    await page.getByTestId('own-hand-tile').last().click();

    // Step 3 — watch the bots. The lesson sits on this caption
    // until the engine parks at `awaitingClaims` with a non-user
    // discard whose face matches a pair in seat 0's hand. At pace=0
    // the watch caption flashes too fast to assert directly — the
    // claim caption assertion below is the load-bearing check.
    //
    // Step 4 — claim bar shows the Peng button. `<CallButton>` is a
    // Pressable that renders `accessibilityLabel={meta.en}` (=
    // "Peng" for the peng kind). The visible label may render with
    // composite framing (e.g. with meld preview tiles below it), so
    // prefer the accessible role+name selector over a text match.
    await expect(page.getByText('Claim the peng!')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Peng' }).click();

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
    expect(completed).toContain('peng');
  });
});
