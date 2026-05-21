import { expect, test } from './_helpers';

/**
 * End-to-end coverage for the `promoted-gang` lesson — promote an
 * existing peng meld to a gang by drawing the fourth copy on a later
 * turn and tapping the new "Promote gang" button.
 *
 * The lesson runs on seed 6755, where seat 0's sorted opening hand
 *   3m 6m 7m 2p 3p 7p 7p 9p 4s 8s E W N F
 * has a 7-pin pair, an honour singleton F at the tail, and seat 1
 * holds the third 7-pin. `setupAfterFirstDiscard` scripts seat 1's
 * first discard as the third 7-pin so the user can peng on the next
 * claim window. After the peng + a second own-turn discard (N — the
 * post-peng tail singleton), the bots play out their natural turns
 * (passive bots discard the drawn tile each), and the user's next
 * natural wall draw is the fourth 7-pin. The lesson then anchors on
 * the new `promote-gang` tutorial target and waits for the
 * `gang-promoted` meld kind to land.
 *
 * Two assertions matter here:
 * - Happy path: peng → post-peng discard → promote → "Lesson
 *   complete!" + `gang-promoted` meld in `state.melds[0]`.
 * - Robbing-kong-not-fired guard (per plan U6): at seed 6755 no
 *   opponent is shanten-0 on 7-pin, so `declareGangPromoted` takes
 *   the no-robbers fast path and never opens a rob window. We
 *   sample `state.phase` between the promotion and the completion
 *   step to confirm the engine stayed in `phase: 'turn'`.
 */

const TEST_SEED = 6755;

test.beforeEach(async ({ page }) => {
  await page.addInitScript((seed) => {
    (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
    // Pin Math.random deterministically so passive bots take the
    // pass branch in their coin-flip claim path. Same pin as the
    // peng / open-gang-claim specs.
    Math.random = () => 0.1;
    // Pre-mark every lesson up to and including `open-gang-claim`
    // complete so the lobby's "first incomplete" cursor lands on
    // `promoted-gang`. The lobby card lists every lesson row
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
        tutorialsCompleted: [
          'basics',
          'ron',
          'safety',
          'claims',
          'peng',
          'robbing-kong',
          'open-gang-claim',
        ],
      }),
    );
  }, TEST_SEED);
});

test.describe('tutorial: promoted-gang', () => {
  test('happy path: peng → post-peng discard → promote → complete (no rob window)', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

    await page.getByLabel('Start Promoting a gang').click();

    // Step 1 — intro caption.
    await expect(page.getByText('Promoting a gang')).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    // Step 2 — first discard. Honours sort after suits in `tileOrder`,
    // so the last own-hand tile (h-F at this seed) is a singleton —
    // picking it preserves the 7-pin pair that
    // `setupAfterFirstDiscard` will peng on.
    await expect(page.getByText('Take your first turn')).toBeVisible();
    await page.getByTestId('own-hand-tile').last().click();

    // Step 3 — watch the bots. Lesson sits on this caption until the
    // engine parks at `awaitingClaims` with a non-user discard whose
    // face matches a pair in seat 0's hand (seat 1's 7-pin).
    //
    // Step 4 — claim bar shows the Peng button.
    await expect(page.getByText('Claim the peng')).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Peng' }).click();

    // Step 5 — post-peng discard. The peng pulled the user out of
    // turn order, so they're now on `phase: 'turn'` without having
    // drawn. Tap the last own-hand tile (N) again — the tail-
    // singleton is the safe choice.
    await expect(page.getByText('Take your post-peng turn')).toBeVisible();
    await page.getByTestId('own-hand-tile').last().click();

    // Step 6 — draw. Bots take their next turns (passive bots
    // discard their drawn tile each); none of those discards is
    // user-claimable at this seed, so the engine pre-passes seat 0
    // and the user lands back on their own turn needing to draw.
    // Tap the wall-draw cue to pop the fourth 7-pin into hand.
    await expect(page.getByRole('heading', { name: 'Tutorial step: Draw your next' })).toBeVisible({
      timeout: 10_000,
    });
    await page.getByTestId('wall-draw-next').click();

    // Step 7 — promote. With the fourth copy in hand, the new
    // `<TutorialTarget id="promote-gang">` mounts alongside the
    // "Promote gang" button.
    await expect(page.getByText('Promote your peng to a gang!')).toBeVisible();

    // Snapshot state immediately before the promotion fires — we
    // want to confirm the rob window never opens (engine stayed in
    // `phase: 'turn'` end-to-end through the promotion).
    const prePromote = await page.evaluate(() => {
      const get = (
        globalThis as unknown as {
          __MAHJONG_TEST_GET_STATE__?: () => {
            state: { phase: string; gangReplacementCount: number } | null;
          };
        }
      ).__MAHJONG_TEST_GET_STATE__;
      const s = get?.()?.state ?? null;
      return s ? { phase: s.phase, gangReplacementCount: s.gangReplacementCount } : null;
    });
    expect(prePromote).not.toBeNull();
    expect(prePromote!.phase).toBe('turn');

    await page.getByRole('button', { name: 'Promote gang' }).click();

    // Step 7 — completion.
    await expect(page.getByText('Lesson complete!')).toBeVisible();

    // Assert the meld actually flipped to `gang-promoted` (not just
    // an exposed gang), the replacement-draw counter incremented,
    // AND — critically — the engine never entered `awaitingClaims`
    // for a rob window (per plan U6: "Robbing-kong-not-fired
    // guard"). The completion caption could only render after the
    // promote-step's `completedWhen` fired (which only matches
    // `gang-promoted`), but we double-check the phase here too
    // because a rob window that fired-and-passed would have flipped
    // through `awaitingClaims.robWindow` mid-sequence.
    const postPromote = await page.evaluate(() => {
      type MeldLike = { kind: string };
      const get = (
        globalThis as unknown as {
          __MAHJONG_TEST_GET_STATE__?: () => {
            state: {
              phase: string;
              melds: Record<number, MeldLike[]>;
              gangReplacementCount: number;
              pendingPromotedGang?: unknown;
              pendingClaims?: unknown;
            } | null;
          };
        }
      ).__MAHJONG_TEST_GET_STATE__;
      const s = get?.()?.state ?? null;
      if (!s) return null;
      const seat0Melds = s.melds?.[0] ?? [];
      return {
        phase: s.phase,
        meldKinds: seat0Melds.map((m) => m.kind),
        gangReplacementCount: s.gangReplacementCount,
        pendingPromotedGang: s.pendingPromotedGang ?? null,
        pendingClaims: s.pendingClaims ?? null,
      };
    });
    expect(postPromote).not.toBeNull();
    expect(postPromote!.meldKinds).toContain('gang-promoted');
    expect(postPromote!.gangReplacementCount).toBe((prePromote!.gangReplacementCount ?? 0) + 1);
    // No rob window fired — engine resolved cleanly on the
    // no-robbers fast path. `pendingPromotedGang` should be cleared
    // (or never set) and the engine should be back in `phase:
    // 'turn'` waiting for the user's next discard.
    expect(postPromote!.phase).toBe('turn');
    expect(postPromote!.pendingPromotedGang).toBeNull();

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
    expect(completed).toContain('promoted-gang');
  });
});
