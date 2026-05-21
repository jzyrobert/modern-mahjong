import { expect, test } from './_helpers';

/**
 * End-to-end coverage for the `yaku-gallery` lesson — third strategy
 * lesson in the curriculum (after `scoring-intro`). Covers plan-002
 * origin RAE4: each example step reads `state.lastResult.faanBreakdown`,
 * the breakdown contains a name semantically matching the caption's
 * named yaku, and the lesson covers >= 5 distinct yaku across the full
 * step set. Lesson + framework lives in
 * `apps/client/src/ui/tutorial/lessons/yaku-gallery.ts`.
 *
 * Lesson shape:
 *  - Step 1: intro caption ("Got it").
 *  - Steps 2-8 (7 yaku examples): each carries a `setupBeforeStep` that
 *    stages a `phase: 'resolved'` engine state with a populated
 *    `lastResult.faanBreakdown` matching the caption's named yaku.
 *    Order + expected breakdown headline entries:
 *      2. 七對子   — 七對子 + 門前清                    (5 faan)
 *      3. 混么九   — 混么九 (one exposed peng)         (4 faan)
 *      4. 大三元   — 大三元 + 對對和 + 三元牌 ZFB + 門前清 (15 faan)
 *      5. 字一色   — 字一色 + 小四喜 + 三元牌 Z (exposed) (17 faan)
 *      6. 四暗刻   — 四暗刻 + 門前清                    (9 faan)
 *      7. 九蓮寶燈 — 九蓮寶燈 + 門前清                  (14 faan)
 *      8. 十三幺   — 十三幺 + 混么九 + 門前清            (18 faan)
 *  - Step 9: "Lesson complete!" dismissal ("Done"). R14 strategy
 *    carve-out for caption-dismissal lessons.
 *
 * Test scenarios (plan U4):
 *  - Happy path (RAE4): pre-mark prior 13 lessons (through scoring-intro);
 *    launch `yaku-gallery`; advance through intro; for each example step
 *    assert (a) `state.phase === 'resolved'`, (b)
 *    `state.lastResult.faanBreakdown` contains a name matching the
 *    caption's named yaku, (c) at least one entry name appears literally
 *    in the caption body, (d) `>= 5` distinct yaku across the full set.
 *  - Yaku-disambiguation: the caption's named yaku appears in
 *    `faanBreakdown` for every step.
 *  - Hand distinctness: capture each step's `state.hands[0]` and assert
 *    no two consecutive steps share an identical hand.
 *  - Re-entry: pre-mark `yaku-gallery` complete; re-launch; assert the
 *    same staged hands re-appear (deterministic).
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
  'wait-shapes',
  'scoring-intro',
];

interface CapturedTile {
  kind: string;
  suit?: string;
  rank?: number;
  honor?: string;
  copy?: number;
}

interface CapturedResult {
  phase: string;
  hand0: CapturedTile[] | null;
  breakdownNames: string[] | null;
  faan: number | null;
}

/**
 * Read the live engine mirror via `__MAHJONG_TEST_GET_STATE__`. Returns
 * the slice the spec needs to assert against: phase, seat-0 hand, and
 * the faanBreakdown entry names from `lastResult`.
 */
async function readResolvedSnapshot(
  page: import('@playwright/test').Page,
): Promise<CapturedResult> {
  return await page.evaluate(() => {
    const get = (
      globalThis as unknown as {
        __MAHJONG_TEST_GET_STATE__?: () => {
          state: {
            phase: string;
            hands: { 0: CapturedTile[] };
            lastResult?: {
              kind: string;
              faan: number;
              breakdown: { name: string }[];
            };
          } | null;
        };
      }
    ).__MAHJONG_TEST_GET_STATE__;
    const s = get?.()?.state ?? null;
    if (!s) return { phase: 'none', hand0: null, breakdownNames: null, faan: null };
    const r = s.lastResult;
    return {
      phase: s.phase,
      hand0: s.hands[0],
      breakdownNames: r?.kind === 'win' ? r.breakdown.map((b) => b.name) : null,
      faan: r?.kind === 'win' ? r.faan : null,
    };
  });
}

function faceKey(t: CapturedTile): string {
  return t.kind === 'suit' ? `${t.suit}-${t.rank}` : `H-${t.honor ?? '?'}`;
}

function handFaces(hand: CapturedTile[]): string[] {
  return hand.map(faceKey).sort();
}

function handsEqualByFaces(a: CapturedTile[], b: CapturedTile[]): boolean {
  if (a.length !== b.length) return false;
  const fa = handFaces(a);
  const fb = handFaces(b);
  return fa.every((v, i) => v === fb[i]);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ seed, completed }) => {
      const g = globalThis as { __MAHJONG_TEST_SEED__?: number };
      g.__MAHJONG_TEST_SEED__ = seed;
      // Pin Math.random — same posture as the other tutorial specs.
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

/**
 * The seven example-step specs in lesson order. `expectedEntries` are
 * the breakdown entry names the caption claims; the spec asserts each
 * appears in the engine's emitted `faanBreakdown`. `captionMustMention`
 * locks the pedagogical contract — the caption body must literally
 * contain the yaku name a reader is supposed to learn.
 */
const EXAMPLE_STEPS = [
  {
    headingRe: /七對子/,
    captionMustMention: /七對子/,
    expectedEntries: ['七對子', '門前清'],
    headlineYaku: '七對子',
    expectedFaan: 5,
  },
  {
    headingRe: /混么九/,
    captionMustMention: /混么九/,
    expectedEntries: ['混么九'],
    headlineYaku: '混么九',
    expectedFaan: 4,
  },
  {
    headingRe: /大三元/,
    captionMustMention: /大三元/,
    expectedEntries: ['大三元', '對對和', '門前清', '三元牌 Z', '三元牌 F', '三元牌 B'],
    headlineYaku: '大三元',
    expectedFaan: 15,
  },
  {
    headingRe: /字一色/,
    captionMustMention: /字一色/,
    expectedEntries: ['字一色', '小四喜', '三元牌 Z'],
    headlineYaku: '字一色',
    expectedFaan: 17,
  },
  {
    headingRe: /四暗刻/,
    captionMustMention: /四暗刻/,
    expectedEntries: ['四暗刻', '門前清'],
    headlineYaku: '四暗刻',
    expectedFaan: 9,
  },
  {
    headingRe: /九蓮寶燈/,
    captionMustMention: /九蓮寶燈/,
    expectedEntries: ['九蓮寶燈', '門前清'],
    headlineYaku: '九蓮寶燈',
    expectedFaan: 14,
  },
  {
    headingRe: /十三幺/,
    captionMustMention: /十三幺/,
    expectedEntries: ['十三幺', '混么九', '門前清'],
    headlineYaku: '十三幺',
    expectedFaan: 18,
  },
] as const;

test.describe('tutorial: yaku-gallery', () => {
  test('happy path: intro → 7 yaku examples → complete', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

    await page.getByLabel('Start Yaku gallery').click();

    // Step 1 — intro caption.
    await expect(page.getByRole('heading', { name: 'Yaku gallery' })).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    const capturedHands: CapturedTile[][] = [];
    const headlineYakuSeen = new Set<string>();

    for (let i = 0; i < EXAMPLE_STEPS.length; i++) {
      const step = EXAMPLE_STEPS[i]!;

      // Caption + heading present. The heading is unique per step so
      // it doubles as a "we're on the right step" check.
      await expect(page.getByRole('heading', { name: step.headingRe })).toBeVisible();
      // Caption body must mention the named yaku literally — pedagogical
      // contract. `.first()` because the heading also matches.
      await expect(page.getByText(step.captionMustMention).first()).toBeVisible();

      // Engine surface: resolved phase + non-empty breakdown +
      // expected entry names.
      const snap = await readResolvedSnapshot(page);
      expect(snap.phase).toBe('resolved');
      expect(snap.breakdownNames).not.toBeNull();
      expect(snap.breakdownNames!.length).toBeGreaterThan(0);
      // Yaku-disambiguation check: caption's named yaku appears in the
      // breakdown.
      expect(snap.breakdownNames).toContain(step.headlineYaku);
      headlineYakuSeen.add(step.headlineYaku);
      for (const expected of step.expectedEntries) {
        expect(snap.breakdownNames).toContain(expected);
      }
      expect(snap.faan).toBe(step.expectedFaan);

      // Hand distinctness — every example must produce a distinct
      // seat-0 hand multiset, proving `setupBeforeStep` fired per step.
      expect(snap.hand0).not.toBeNull();
      capturedHands.push(snap.hand0!);

      // Regression guard (Fix 2): ResultPanel is visible on every
      // example step. The caption is anchored to the panel via
      // `targetId: 'result-panel'` rather than centered on top of it.
      // "Seat 0 wins!" only renders inside ResultPanel; visibility is
      // a stable mount-and-on-screen proxy.
      await expect(page.getByText('Seat 0 wins!').first()).toBeVisible();

      // Regression guard (Fix 1): the full-screen 和 celebration is
      // suppressed during this lesson. The celebration would
      // otherwise pulse on every example step. No 和 glyph is
      // rendered at celebration-tile size anywhere else on the table.
      await expect(page.getByText(/^和$/)).toHaveCount(0);

      await page.getByRole('button', { name: 'Got it' }).click();
    }

    // RAE4 quantifier: >= 5 distinct yaku across the full step set.
    expect(headlineYakuSeen.size).toBeGreaterThanOrEqual(5);

    // Pairwise distinctness across all example hands. Every
    // setupBeforeStep stages a fresh shape; no two should collide.
    for (let i = 0; i < capturedHands.length; i++) {
      for (let j = i + 1; j < capturedHands.length; j++) {
        const a = capturedHands[i]!;
        const b = capturedHands[j]!;
        expect(handsEqualByFaces(a, b)).toBe(false);
      }
    }

    // Final step — completion.
    await expect(page.getByText('Lesson complete!')).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();

    // Settings round-trip: tutorialsCompleted now includes 'yaku-gallery'.
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
    expect(completed).toContain('yaku-gallery');
  });

  test('caption CTA stays inside the viewport across portrait / landscape / desktop', async ({
    page,
  }) => {
    // Regression guard for the "Got it" CTA clipping bug fixed in
    // the PR after #432: the side-dock placement on landscape (and
    // the bottom-dock placement on portrait) was computed against
    // a 160 px placeholder while the real card runs taller — the
    // CTA fell off the bottom of the viewport. The yaku-gallery
    // lesson reuses the same `result-panel` targeted captions as
    // scoring-intro, so the same placement clamp applies. The
    // hard invariant is that the entire CTA button rect stays
    // inside the viewport so the user can always advance.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
    await page.getByLabel('Start Yaku gallery').click();
    await page.getByRole('button', { name: 'Got it' }).click();
    // Step 2 — first example, seven-pairs.
    await expect(page.getByRole('heading', { name: /七對子/ })).toBeVisible();

    const viewports = [
      { w: 393, h: 852, name: 'portrait' },
      { w: 852, h: 393, name: 'landscape' },
      { w: 1280, h: 800, name: 'desktop' },
    ];
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      // Frame for overlay re-measure (target rect + caption-height
      // invalidation effects).
      await page.waitForTimeout(400);
      const cta = await page.getByRole('button', { name: 'Got it' }).boundingBox();
      expect(cta, `cta box @ ${vp.name}`).not.toBeNull();
      const b = cta!;
      expect(
        b.y >= 0 && b.x >= 0 && b.x + b.width <= vp.w && b.y + b.height <= vp.h,
        `CTA "Got it" clipped at ${vp.name} ${vp.w}x${vp.h}: cta=${JSON.stringify(b)}`,
      ).toBe(true);
    }
  });

  test('re-entry after completion: same seven staged hands re-appear deterministically', async ({
    page,
  }) => {
    // Override the beforeEach pre-mark so yaku-gallery is ALSO included.
    // The lobby card flips to a Replay affordance.
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
            'scoring-intro',
            'yaku-gallery',
          ],
        }),
      );
    });

    await page.goto('/');
    await expect(page.getByLabel('Replay Yaku gallery')).toBeVisible();
    await page.getByLabel('Replay Yaku gallery').click();

    // Lesson opens on the intro step (controller's `begin()` resets
    // stepIndex to 0 cleanly).
    await expect(page.getByRole('heading', { name: 'Yaku gallery' })).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    // Re-capture each staged hand and confirm the engine's breakdown
    // matches the first-run expectations — the deterministic-replay
    // contract.
    for (let i = 0; i < EXAMPLE_STEPS.length; i++) {
      const step = EXAMPLE_STEPS[i]!;
      await expect(page.getByRole('heading', { name: step.headingRe })).toBeVisible();

      const snap = await readResolvedSnapshot(page);
      expect(snap.phase).toBe('resolved');
      expect(snap.faan).toBe(step.expectedFaan);
      expect(snap.breakdownNames).toContain(step.headlineYaku);

      await page.getByRole('button', { name: 'Got it' }).click();
    }

    await expect(page.getByText('Lesson complete!')).toBeVisible();
  });
});
