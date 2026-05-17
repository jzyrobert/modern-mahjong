import { expect, test } from './_helpers';

/**
 * Regression lock for Match.tsx's meld-aware tenpai gate:
 *
 *   const showReadyWaits =
 *     !!state && seat !== null &&
 *     state.hands[seat].length + 3 * state.melds[seat].length === 13;
 *
 * The pre-fix gate read `state.hands[seat].length === 13`, which went
 * false the instant the user exposed a peng (hand drops to 10, meld
 * count goes to 1). The new sum keeps the READY badge mounted for
 * users who are tenpai with one or more exposed melds — the more
 * common path in HK mahjong.
 *
 * This spec drives a contrived "user has 1 peng + a tenpai concealed
 * shape" state via the `__MAHJONG_TEST_GET_STATE__` setState hatch
 * (the same trick `post-game-save-replay.spec.ts` and
 * `claim-bar-orientation-layout.spec.ts` use to bypass the natural
 * 14-tile dealt-shape), then asserts:
 *
 *   1. After the meld is injected and the hand reduced to 10 tiles in
 *      a tenpai shape, the READY badge is visible. Locks the gate's
 *      `+ 3 * melds.length` term.
 *
 *   2. The badge stays visible during a phase the original gate would
 *      have suppressed (we set `turn: 1` so it's an opponent's seat,
 *      not the user's). The gate has to be length/shape-based, not
 *      phase-gated.
 *
 * A revert to `hand.length === 13` lands red on assertion #1 (10 + 0
 * !== 13). A revert that re-introduces a phase guard (e.g. "only
 * show during the user's own turn") lands red on assertion #2.
 *
 * Going via `setState` instead of a real peng path keeps the spec
 * fully deterministic — there's no dealt-hand-shape dependency on
 * the engine seed, and no need to script bots to throw a face the
 * user happens to be tenpai-on-the-peng-completing-pair for.
 */

const PORTRAIT = { width: 393, height: 852 };

test('READY badge stays visible when the user is tenpai with an exposed peng', async ({ page }) => {
  await page.setViewportSize(PORTRAIT);
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.getByText(/\d+ tiles/)).toBeVisible({ timeout: 10_000 });

  // Inject a "1 peng + 10-tile tenpai concealed shape" into seat 0.
  // Concealed shape: 234m / 567m / 789m / 5p — three complete chis
  // plus a lone 5p tanki (pair) wait. With the peng of East as the
  // 4th meld, this hand is shanten 0 waiting on 5p only.
  //
  // We also pin `turn: 1` so the assertion exercises the
  // "badge visible during an opponent's turn" path — the original
  // pre-fix code's `hand.length === 13` predicate was satisfied
  // *only* between the user's discard and their next draw, so any
  // phase-gated regression that crept back in would now have to
  // also pass this seat check to be ignored.
  await page.evaluate(() => {
    const store = (
      globalThis as {
        __MAHJONG_TEST_GET_STATE__?: () => {
          state: unknown;
          setState: (s: unknown) => void;
        };
      }
    ).__MAHJONG_TEST_GET_STATE__?.();
    if (!store?.state) throw new Error('engine state not ready');
    const cur = store.state as Record<string, unknown>;
    const hands = { ...(cur.hands as Record<number, unknown[]>) };
    const melds = { ...(cur.melds as Record<number, unknown[]>) };

    const m = (suit: 'man' | 'pin' | 'sou', rank: number) => ({
      kind: 'suit' as const,
      suit,
      rank,
    });
    const east = { kind: 'honor' as const, honor: 'E' };

    hands[0] = [
      m('man', 2),
      m('man', 3),
      m('man', 4),
      m('man', 5),
      m('man', 6),
      m('man', 7),
      m('man', 7),
      m('man', 8),
      m('man', 9),
      m('pin', 5),
    ];
    melds[0] = [{ kind: 'peng', tiles: [east, east, east] }];

    store.setState({
      ...cur,
      hands,
      melds,
      // Force opponent-turn so the spec also covers the
      // phase/turn-agnostic guarantee of the new gate.
      phase: 'turn',
      turn: 1,
      hasDrawn: false,
    });
  });

  // The READY badge text + glyph are the contract this test locks.
  // ReadyHandBadge renders 'READY' + the 聽 glyph as separate <Text>
  // nodes; either is sufficient to prove it mounted.
  await expect(page.getByText('READY', { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText('聽', { exact: true })).toBeVisible();

  // Sanity-check the live state: the user genuinely satisfies the
  // meld-aware gate. Without this, a future refactor that hides the
  // badge for an unrelated reason could mask the contract we care
  // about.
  const gateSatisfied = await page.evaluate(() => {
    const get = (
      globalThis as {
        __MAHJONG_TEST_GET_STATE__?: () => {
          state: { hands: Record<number, unknown[]>; melds: Record<number, unknown[]> } | null;
          you: number | null;
        };
      }
    ).__MAHJONG_TEST_GET_STATE__;
    const s = get?.();
    if (!s?.state || s.you === null) return null;
    const hand = s.state.hands[s.you] ?? [];
    const melds = s.state.melds[s.you] ?? [];
    return hand.length + 3 * melds.length;
  });
  expect(gateSatisfied, 'effective hand-size sum must equal 13').toBe(13);
});

test('READY badge mounts even with no melds (pure 13-tile concealed tenpai)', async ({ page }) => {
  // Companion case — locks the unchanged behaviour for the 0-meld
  // path so a refactor that swaps in a buggy `+ 3 * meldCount` term
  // (e.g. off-by-one on tile-count, or peng-only counting) lands red
  // on the no-meld path too.
  await page.setViewportSize(PORTRAIT);
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await expect(page.getByText(/\d+ tiles/)).toBeVisible({ timeout: 10_000 });

  await page.evaluate(() => {
    const store = (
      globalThis as {
        __MAHJONG_TEST_GET_STATE__?: () => {
          state: unknown;
          setState: (s: unknown) => void;
        };
      }
    ).__MAHJONG_TEST_GET_STATE__?.();
    if (!store?.state) throw new Error('engine state not ready');
    const cur = store.state as Record<string, unknown>;
    const hands = { ...(cur.hands as Record<number, unknown[]>) };
    const melds = { ...(cur.melds as Record<number, unknown[]>) };

    const m = (suit: 'man' | 'pin' | 'sou', rank: number) => ({
      kind: 'suit' as const,
      suit,
      rank,
    });

    // 13-tile tanki tenpai: 234m / 567m / 789m / 234p / 5p.
    hands[0] = [
      m('man', 2),
      m('man', 3),
      m('man', 4),
      m('man', 5),
      m('man', 6),
      m('man', 7),
      m('man', 7),
      m('man', 8),
      m('man', 9),
      m('pin', 2),
      m('pin', 3),
      m('pin', 4),
      m('pin', 5),
    ];
    melds[0] = [];

    store.setState({
      ...cur,
      hands,
      melds,
      phase: 'turn',
      turn: 1,
      hasDrawn: false,
    });
  });

  await expect(page.getByText('READY', { exact: true })).toBeVisible({ timeout: 5_000 });
});
