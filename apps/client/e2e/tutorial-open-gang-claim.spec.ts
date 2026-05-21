import { expect, test } from './_helpers';

/**
 * End-to-end coverage for the `open-gang-claim` lesson — claim the
 * fourth copy of a face the user already holds three of. The lesson
 * runs on seed 271, where seat 0's sorted opening hand is
 *   1m 1m 1m 5m 4p 7p 9p 1s 7s E S W Z F
 * (a triple of man-1 at the head, an honour F at the tail) and seat
 * 1 holds the fourth man-1. `setupAfterFirstDiscard` reads seat 0's
 * remaining hand at runtime, picks any triple, finds the first bot
 * (1 → 2 → 3) holding the fourth copy, and scripts that bot's first
 * discard via `__MAHJONG_TEST_BOT_SCRIPTS__`. Shape mirrors
 * `tutorial-peng.spec.ts` closely — the gang button doesn't open a
 * sub-picker, so there's no single-option engineering needed.
 */

const TEST_SEED = 271;

test.beforeEach(async ({ page }) => {
  await page.addInitScript((seed) => {
    (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
    // Pin Math.random deterministically so passive bots take the
    // pass branch in their coin-flip claim path. Same pin as
    // `tutorial-peng.spec.ts` / `tutorial-claims.spec.ts`.
    Math.random = () => 0.1;
    // Pre-mark every lesson up to and including `robbing-kong`
    // complete so the lobby's "first incomplete" cursor lands on
    // `open-gang-claim`. The lobby card lists every lesson row
    // regardless, so the click target below works either way —
    // pre-marking keeps the suite semantically consistent with the
    // curriculum order.
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
        tutorialsCompleted: ['basics', 'ron', 'safety', 'claims', 'peng', 'robbing-kong'],
      }),
    );
  }, TEST_SEED);
});

test.describe('tutorial: open-gang-claim', () => {
  test('happy path: discard → bot discards triple-match → claim gang → complete', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

    await page.getByLabel('Start Claiming an open gang').click();

    // Step 1 — intro caption.
    await expect(page.getByText('Claiming an open gang')).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    // Step 2 — first discard. Honors sort after suits in `tileOrder`,
    // so the last own-hand tile (h-F at this seed) is a singleton —
    // picking it preserves the triple `setupAfterFirstDiscard` is
    // about to gang on.
    await expect(page.getByText('Take your first turn')).toBeVisible();
    await page.getByTestId('own-hand-tile').last().click();

    // Step 3 — watch the bots. The lesson sits on this caption until
    // the engine parks at `awaitingClaims` with a non-user discard
    // whose face matches a triple in seat 0's hand.
    //
    // Step 4 — claim bar shows the Gang button. `<CallButton>` is a
    // Pressable that renders `accessibilityLabel={meta.en}` (= "Gang"
    // for the gang kind). The visible label may render with composite
    // framing (e.g. "Gang · N faan"), so prefer the accessible
    // role+name selector over a text match.
    await expect(page.getByText('Claim the gang!')).toBeVisible({ timeout: 10_000 });

    // Snapshot pre-claim state for the replacement-draw check below.
    const preClaim = await page.evaluate(() => {
      const get = (
        globalThis as unknown as {
          __MAHJONG_TEST_GET_STATE__?: () => { state: { gangReplacementCount: number } | null };
        }
      ).__MAHJONG_TEST_GET_STATE__;
      const s = get?.()?.state ?? null;
      return s ? { gangReplacementCount: s.gangReplacementCount } : null;
    });
    expect(preClaim).not.toBeNull();
    const preCount = preClaim!.gangReplacementCount ?? 0;

    await page.getByRole('button', { name: 'Gang' }).click();

    // Step 5 — completion.
    await expect(page.getByText('Lesson complete!')).toBeVisible();

    // Assert the meld actually landed as `gang-exposed` (not peng) and
    // that the replacement-draw counter incremented — open gangs
    // trigger a draw from the back of the wall, mirroring the
    // `hidden-gang.ts` flow.
    const postClaim = await page.evaluate(() => {
      type MeldLike = { kind: string };
      const get = (
        globalThis as unknown as {
          __MAHJONG_TEST_GET_STATE__?: () => {
            state: {
              melds: Record<number, MeldLike[]>;
              gangReplacementCount: number;
            } | null;
          };
        }
      ).__MAHJONG_TEST_GET_STATE__;
      const s = get?.()?.state ?? null;
      if (!s) return null;
      const seat0Melds = s.melds?.[0] ?? [];
      return {
        meldKinds: seat0Melds.map((m) => m.kind),
        gangReplacementCount: s.gangReplacementCount,
      };
    });
    expect(postClaim).not.toBeNull();
    expect(postClaim!.meldKinds).toContain('gang-exposed');
    expect(postClaim!.gangReplacementCount).toBe(preCount + 1);

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
    expect(completed).toContain('open-gang-claim');
  });
});
