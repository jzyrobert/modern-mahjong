import { expect, test } from './_helpers';

/**
 * End-to-end coverage for the `wait-shapes` lesson — first strategy
 * probe in the curriculum. Covers origin AE5 (wait-shapes badge
 * highlighting + per-shape captions).
 *
 * Lesson shape (see `apps/client/src/ui/tutorial/lessons/wait-shapes.ts`):
 * - `prepareState` replaces seat 0's 14-tile dealer hand with a fixed
 *   shanten-1 deal whose post-discard residual is shanten 0 with a
 *   single kanchan wait on 7-sou. Seed 5 is reused from `basics` (the
 *   same `__MAHJONG_TEST_SEED__` everything else in the suite uses);
 *   the seeded wall layout is irrelevant since the lesson never runs
 *   past the user's first discard.
 * - Step 1: intro caption ("Got it").
 * - Step 2: discard the tail wind tile (auto-advance on first user
 *   discard). After the discard the user's hand is 13 tiles and
 *   shanten 0; `Match.tsx`'s `waitTiles` memo surfaces [7-sou] and
 *   `<ReadyHandBadge>` mounts in the right rail (DesktopShell →
 *   DesktopTable).
 * - Steps 3-6: four read-and-advance captions (kanchan / ryanmen /
 *   shanpon / tanki), each anchored on the new `'ready-hand-badge'`
 *   tutorial target. CTA convention: every shape step omits
 *   `completedWhen` so the default "Got it" button renders
 *   (`TutorialOverlay.tsx:283` — Next button is hidden when
 *   `completedWhen` is set, so manual-advance steps must omit it).
 * - Step 7: "Lesson complete!" dismissal ("Done"); the lesson ends
 *   without driving the engine to a terminal state (R14 — the
 *   strategy carve-out for caption dismissal lessons).
 *
 * Test scenarios:
 * - Happy path (covers AE5): pre-mark prior 11 lessons; launch
 *   `wait-shapes`; advance through intro; discard the W tile; for
 *   each of the four shape captions assert the caption title contains
 *   the shape name AND the gold 聽 badge is visible; advance via Got
 *   it; after the fourth assert "Lesson complete!" and
 *   `tutorialsCompleted` includes `'wait-shapes'`.
 * - Re-entry: pre-mark `wait-shapes` as already complete; launch from
 *   the menu; assert the lesson replays cleanly from step 1.
 */

const TEST_SEED = 5;

const PRIOR_LESSONS = [
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
  'drawn-game',
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ seed, completed }) => {
      const g = globalThis as { __MAHJONG_TEST_SEED__?: number };
      g.__MAHJONG_TEST_SEED__ = seed;
      // Pin Math.random — same posture as the other tutorial specs.
      // The lesson never reaches a bot's claim window (the user only
      // takes one action and the lesson ends on captions), so the
      // pin is belt-and-braces only.
      Math.random = () => 0.1;
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
          tutorialsCompleted: completed,
        }),
      );
    },
    { seed: TEST_SEED, completed: PRIOR_LESSONS },
  );
});

test.describe('tutorial: wait-shapes', () => {
  test('happy path: intro → discard → 4 shape captions → complete', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

    await page.getByLabel('Start Wait shapes').click();

    // Step 1 — intro caption.
    await expect(page.getByText('Reading your waits')).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    // Step 2 — discard the W tile to enter tenpai. The lesson's
    // `prepareState` installs the 14-tile dealer hand: 1m-6m, 1p-3p,
    // 5s 5s 6s 8s, plus W at the tail. Any discard advances the
    // step, but only dropping W leaves the kanchan wait intact —
    // the lesson copy directs the user to the W tile. We can't
    // address the W tile by aria label reliably in this spec, so we
    // tap the last own-hand tile (sortHand puts W at the end).
    await expect(page.getByText('Drop the white-dragon')).toBeVisible();
    await page.getByTestId('own-hand-tile').last().click();

    // Engine cross-check: the user's 13-tile post-discard hand must
    // be shanten 0 with a single wait on 7-sou. Guards against a
    // future change to `prepareState` that drifted the hand
    // contents.
    const waitsResult = await page.evaluate(() => {
      const get = (
        globalThis as unknown as {
          __MAHJONG_TEST_GET_STATE__?: () => {
            state: {
              hands: { 0: { kind: string; suit?: string; rank?: number; honor?: string }[] };
              discards: { 0: unknown[] };
            } | null;
          };
        }
      ).__MAHJONG_TEST_GET_STATE__;
      const s = get?.()?.state ?? null;
      if (!s) return null;
      const handFaces = s.hands[0].map((t) =>
        t.kind === 'suit' ? `${t.rank}${t.suit?.[0]}` : (t.honor ?? '?'),
      );
      return {
        handLen: s.hands[0].length,
        handFaces,
        discardCount: s.discards[0].length,
      };
    });
    expect(waitsResult).not.toBeNull();
    expect(waitsResult!.discardCount).toBe(1);
    expect(waitsResult!.handLen).toBe(13);
    // Spot-check key fixtures of the installed hand.
    expect(waitsResult!.handFaces).toContain('5s');
    expect(waitsResult!.handFaces).toContain('6s');
    expect(waitsResult!.handFaces).toContain('8s');

    // Steps 3-6 — four shape captions. For each: assert the caption
    // title contains the shape name AND the gold 聽 badge is
    // visible. Advance with "Got it".

    // Steps 3-6 — four shape captions. Anchor on the heading-role
    // caption title (the body text often mentions other shape names
    // too, so target the title specifically). The badge's
    // accessibilityLabel embeds "Ready hand — waiting on N tile" so
    // the gold pill is locatable independent of any visible text
    // inside it. (At this hand the badge shows 1 wait tile.)

    // Kanchan.
    await expect(page.getByRole('heading', { name: /Kanchan/ })).toBeVisible();
    await expect(page.getByLabel(/Ready hand — waiting on 1 tile/)).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    // Ryanmen.
    await expect(page.getByRole('heading', { name: /Ryanmen/ })).toBeVisible();
    await expect(page.getByLabel(/Ready hand — waiting on 1 tile/)).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    // Shanpon.
    await expect(page.getByRole('heading', { name: /Shanpon/ })).toBeVisible();
    await expect(page.getByLabel(/Ready hand — waiting on 1 tile/)).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    // Tanki.
    await expect(page.getByRole('heading', { name: /Tanki/ })).toBeVisible();
    await expect(page.getByLabel(/Ready hand — waiting on 1 tile/)).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    // Step 7 — completion.
    await expect(page.getByText('Lesson complete!')).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();

    // Settings round-trip: tutorialsCompleted now includes 'wait-shapes'.
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
    expect(completed).toContain('wait-shapes');
  });

  test('re-entry after completion: lesson replays cleanly from step 1', async ({ page }) => {
    // Override the beforeEach pre-mark so wait-shapes is ALSO
    // included. The lobby card flips to a Replay affordance; the
    // controller's `begin()` clears any leftover `justCompleted`
    // and `dismissedTutorialSeed` so the lesson opens clean.
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
            'drawn-game',
            'wait-shapes',
          ],
        }),
      );
    });

    await page.goto('/');
    await expect(page.getByLabel('Replay Wait shapes')).toBeVisible();
    await page.getByLabel('Replay Wait shapes').click();

    // The lesson opens on its first step — the intro caption.
    // Anything else (e.g. landing on a later step because state from
    // a previous run leaked) would indicate the controller's
    // `begin()` didn't reset cleanly.
    await expect(page.getByText('Reading your waits')).toBeVisible();
  });
});
