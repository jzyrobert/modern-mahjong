import { expect, test } from './_helpers';

/**
 * End-to-end coverage for the `drawn-game` lesson — teach the user
 * what happens when the wall runs out before anyone wins. Covers
 * origin AE4.
 *
 * The lesson pins the wall to 2 tiles via `prepareState` (production
 * mechanism) and the Playwright spec layers the new
 * `__MAHJONG_TEST_WALL_DEPTH__` global hatch on top so the spec also
 * exercises the test-side override path. Seed `5` is reused from
 * `basics` — `__MAHJONG_TUTORIAL_FORCE_PASS__` is on for the duration
 * of the lesson, so bots pass every claim window. Passive bots
 * discard their drawn tile each turn; with wall=2, bot 1 draws
 * (wall→1), bot 2 draws (wall→0), bot 3 attempts a draw and the
 * engine resolves to `lastResult.kind === 'draw'` (see
 * `packages/game-logic/src/actions.ts:226-229`). The user only
 * acts on their initial discard.
 *
 * Two assertions matter here:
 * - Happy path (AE4): pre-mark prior lessons; launch; first own-hand
 *   discard; engine resolves to drawn game; "Lesson complete!"
 *   renders; completion persisted to localStorage.
 * - Wall-depth determinism: the `__MAHJONG_TEST_WALL_DEPTH__` hatch
 *   produces the same `state.wall.length` after the user's first
 *   discard on two consecutive lesson launches.
 */

const TEST_SEED = 5;
const WALL_DEPTH = 2;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ seed, depth }) => {
      const g = globalThis as {
        __MAHJONG_TEST_SEED__?: number;
        __MAHJONG_TEST_WALL_DEPTH__?: number;
      };
      g.__MAHJONG_TEST_SEED__ = seed;
      g.__MAHJONG_TEST_WALL_DEPTH__ = depth;
      // Pin Math.random deterministically so passive bots take the
      // pass branch in their coin-flip claim path. Same pin as the
      // other tutorial specs that walk through bot-played turns.
      Math.random = () => 0.1;
      // Pre-mark every lesson up to and including `hidden-gang`
      // complete so the lobby's "first incomplete" cursor lands on
      // `drawn-game`. The lobby card lists every lesson row
      // regardless, so the click target below works either way —
      // pre-marking keeps the suite semantically consistent with the
      // final curriculum order (drawn-game slots at the end).
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
            'promoted-gang',
            'win',
            'hidden-gang',
          ],
        }),
      );
    },
    { seed: TEST_SEED, depth: WALL_DEPTH },
  );
});

test.describe('tutorial: drawn-game', () => {
  test('happy path: discard → wall drains → drawn-game resolution → complete', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

    await page.getByLabel('Start Drawn game').click();

    // Step 1 — intro caption.
    await expect(page.getByText('Drawn games')).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    // Step 2 — first discard. Any tile works; tap the first own-hand
    // tile to kick the round off.
    await expect(page.getByText('Discard to start')).toBeVisible();
    await page.getByTestId('own-hand-tile').first().click();

    // Step 3 — watch the wall run out. Bots cycle through their
    // passive draws + discards; the engine drains the 2-tile wall
    // and resolves to `lastResult.kind === 'draw'`. The completion
    // caption renders as soon as the predicate fires (no manual
    // advance needed — the watch step's `completedWhen` auto-
    // advances on draw resolution).
    await expect(page.getByText('Lesson complete!')).toBeVisible({ timeout: 15_000 });

    // Engine cross-check: `lastResult` shape matches the contract in
    // `actions.ts:226-229`. Guards against a future engine change
    // that flipped to a different resolution path (e.g. dead-wall
    // semantics) and silently let the lesson complete on a non-draw.
    const result = await page.evaluate(() => {
      const get = (
        globalThis as unknown as {
          __MAHJONG_TEST_GET_STATE__?: () => {
            state: {
              phase: string;
              lastResult?: { kind: string; reason?: string } | undefined;
              wall: unknown[];
            } | null;
          };
        }
      ).__MAHJONG_TEST_GET_STATE__;
      const s = get?.()?.state ?? null;
      if (!s) return null;
      return {
        phase: s.phase,
        kind: s.lastResult?.kind ?? null,
        reason: s.lastResult?.reason ?? null,
        wallLength: s.wall.length,
      };
    });
    expect(result).not.toBeNull();
    expect(result!.phase).toBe('resolved');
    expect(result!.kind).toBe('draw');
    expect(result!.reason).toBe('wall-empty');
    expect(result!.wallLength).toBe(0);

    await page.getByRole('button', { name: 'Done' }).click();

    // Settings round-trip: tutorialsCompleted now includes 'drawn-game'.
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
    expect(completed).toContain('drawn-game');
  });

  test('wall-depth hatch is deterministic across consecutive launches', async ({ page }) => {
    // Launch the lesson twice. After the user's first discard the
    // wall has shrunk by one (passive bots will have started cycling
    // already, so we sample immediately after the discard before
    // bots run). The wall-depth hatch should produce identical
    // post-discard `wall.length` on both runs.

    async function discardAndReadWall() {
      await page.goto('/');
      await page.getByLabel('Start Drawn game').click();
      await expect(page.getByText('Drawn games')).toBeVisible();
      await page.getByRole('button', { name: 'Got it' }).click();
      await expect(page.getByText('Discard to start')).toBeVisible();
      // Snapshot the wall depth immediately after activation — the
      // pre-discard state has the truncated wall fully intact. We
      // read it BEFORE the discard so the bot loop hasn't yet had a
      // chance to drain anything (the test uses bot-pace=0 from
      // `_helpers.ts`, so even a single yield could drop a tile).
      const wallBefore = await page.evaluate(() => {
        const get = (
          globalThis as unknown as {
            __MAHJONG_TEST_GET_STATE__?: () => {
              state: { wall: unknown[] } | null;
            };
          }
        ).__MAHJONG_TEST_GET_STATE__;
        return get?.()?.state?.wall.length ?? null;
      });
      // Tap a tile so the lesson exits the discard step and the
      // resolved-state assertion that follows works on a real
      // engine cycle. We don't assert on the post-discard length
      // because the bot loop fires synchronously with bot-pace=0
      // and the wall drains in the same tick.
      await page.getByTestId('own-hand-tile').first().click();
      return wallBefore;
    }

    const first = await discardAndReadWall();
    // Navigate back to the lobby cleanly so the second launch starts
    // from a fresh transport. The drawn-game lesson finishes
    // automatically with bot-pace=0, so by the time we navigate
    // back the completion prompt is in flight — the lobby home
    // button is wired straight through the prompt.
    await expect(page.getByText('Lesson complete!')).toBeVisible({ timeout: 15_000 });
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByLabel('Back to lobby')).toBeVisible();
    await page.getByLabel('Back to lobby').click();

    const second = await discardAndReadWall();

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(first).toBe(WALL_DEPTH);
    expect(second).toBe(WALL_DEPTH);
    expect(first).toBe(second);
  });
});
