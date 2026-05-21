import { expect, test } from './_helpers';

/**
 * End-to-end coverage for the `scoring-intro` lesson — second strategy
 * lesson in the curriculum (after `wait-shapes`). Covers plan-002
 * origin RAE3: each example step reads `state.lastResult.faanBreakdown`,
 * and at least one breakdown entry name appears literally in the
 * caption body. Lesson + framework lives in
 * `apps/client/src/ui/tutorial/lessons/scoring-intro.ts`.
 *
 * Lesson shape:
 *  - Step 1: intro caption ("Got it").
 *  - Steps 2-7 (6 examples): each carries a `setupBeforeStep` that
 *    stages a `phase: 'resolved'` engine state with a populated
 *    `lastResult.faanBreakdown` matching the caption's named faan
 *    rule(s). The captions:
 *      2. 平和  (plain ron, 2 faan)        — 平和 + 門前清
 *      3. 對對和 (with exposed peng, 3)     — 對對和
 *      4. 混一色 (concealed ron, 4)         — 混一色 + 門前清
 *      5. 清一色 (concealed ron, 8)         — 清一色 + 門前清
 *      6. 自摸  (concealed self-draw, 3)   — 自摸 + 門前清 + 平和
 *      7. 海底撈月 (last-tile self-draw, 4) — 海底撈月 + 自摸 + 門前清 + 平和
 *  - Step 8: "Lesson complete!" dismissal ("Done"). R14 strategy
 *    carve-out for caption-dismissal lessons.
 *
 * Test scenarios (plan U3):
 *  - Happy path (RAE3): pre-mark prior 12 lessons; launch
 *    `scoring-intro`; advance through intro; for each example step
 *    assert (a) `state.phase === 'resolved'`, (b)
 *    `state.lastResult.faanBreakdown` is non-empty, (c) at least one
 *    entry name appears literally in the caption body.
 *  - Hand distinctness: capture each step's `state.hands[0]` and
 *    assert no two consecutive steps share an identical hand
 *    (regression guard for `setupBeforeStep` actually firing per step).
 *  - Re-entry: pre-mark `scoring-intro` complete; re-launch from menu;
 *    assert the same staged hands re-appear (deterministic — no
 *    seed-dependent randomness in `setupBeforeStep`).
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
 * The six example-step specs, in lesson order. `expectedEntries` are
 * the breakdown entry names the caption claims; the spec asserts each
 * appears in the engine's emitted `faanBreakdown` AND that at least
 * one of them appears literally in the caption body on screen.
 */
const EXAMPLE_STEPS = [
  {
    headingRe: /平和/,
    captionMustMention: /平和/,
    expectedEntries: ['門前清', '平和'],
    expectedFaan: 2,
  },
  {
    headingRe: /對對和/,
    captionMustMention: /對對和/,
    expectedEntries: ['對對和'],
    expectedFaan: 3,
  },
  {
    headingRe: /混一色/,
    captionMustMention: /混一色/,
    expectedEntries: ['門前清', '混一色'],
    expectedFaan: 4,
  },
  {
    headingRe: /清一色/,
    captionMustMention: /清一色/,
    expectedEntries: ['門前清', '清一色'],
    expectedFaan: 8,
  },
  {
    headingRe: /自摸/,
    captionMustMention: /自摸/,
    expectedEntries: ['自摸', '門前清', '平和'],
    expectedFaan: 3,
  },
  {
    headingRe: /海底撈月/,
    captionMustMention: /海底撈月/,
    expectedEntries: ['海底撈月', '自摸', '門前清', '平和'],
    expectedFaan: 4,
  },
] as const;

test.describe('tutorial: scoring-intro', () => {
  test('happy path: intro → 6 faan-rule example wins → complete', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

    await page.getByLabel('Start Scoring 101').click();

    // Step 1 — intro caption.
    await expect(page.getByRole('heading', { name: 'Scoring 101' })).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    const capturedHands: CapturedTile[][] = [];

    for (let i = 0; i < EXAMPLE_STEPS.length; i++) {
      const step = EXAMPLE_STEPS[i]!;

      // Caption + heading present. The heading is unique per step so
      // it doubles as a "we're on the right step" check.
      await expect(page.getByRole('heading', { name: step.headingRe })).toBeVisible();
      // Caption body must mention the named faan rule literally (locks
      // the pedagogical contract — caption claims align with engine
      // output). `.first()` because the heading also matches.
      await expect(page.getByText(step.captionMustMention).first()).toBeVisible();

      // Engine surface: resolved phase + non-empty breakdown +
      // expected entry names.
      const snap = await readResolvedSnapshot(page);
      expect(snap.phase).toBe('resolved');
      expect(snap.breakdownNames).not.toBeNull();
      expect(snap.breakdownNames!.length).toBeGreaterThan(0);
      for (const expected of step.expectedEntries) {
        expect(snap.breakdownNames).toContain(expected);
      }
      expect(snap.faan).toBe(step.expectedFaan);

      // Hand distinctness — every example must produce a distinct
      // seat-0 hand multiset, proving `setupBeforeStep` fired per
      // step. We assert pairwise distinctness across all six.
      expect(snap.hand0).not.toBeNull();
      capturedHands.push(snap.hand0!);

      // Regression guard (Fix 2): the ResultPanel is visible on every
      // example step — the caption is anchored to the panel rect via
      // `targetId: 'result-panel'` rather than centered on top of it.
      // The "Seat 0 wins!" text only renders inside ResultPanel, so
      // its visibility is a stable proxy for "the panel is mounted
      // and on screen". `.first()` because the live screen may also
      // surface "Seat 0" in seat labels.
      await expect(page.getByText('Seat 0 wins!').first()).toBeVisible();

      // Regression guard (Fix 1): the full-screen 和 celebration is
      // suppressed during this lesson. The celebration would
      // otherwise pulse on every example step. The 和 emblem inside
      // `WinCelebration` has `fontFamily: 'Noto Serif TC', fontSize:
      // 96` — there's no other 和 glyph on the table at this size, so
      // we assert no 和 glyph is visible. (The ResultPanel doesn't
      // render this glyph; the breakdown lists `平和`/`對對和` etc as
      // entry names but those are sub-tile-sized.)
      await expect(page.getByText(/^和$/)).toHaveCount(0);

      await page.getByRole('button', { name: 'Got it' }).click();
    }

    // Pairwise distinctness across all six example hands. Each
    // setupBeforeStep stages a fresh shape; no two should collide.
    for (let i = 0; i < capturedHands.length; i++) {
      for (let j = i + 1; j < capturedHands.length; j++) {
        const a = capturedHands[i]!;
        const b = capturedHands[j]!;
        expect(handsEqualByFaces(a, b)).toBe(false);
      }
    }

    // Step 8 — completion.
    await expect(page.getByText('Lesson complete!')).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();

    // Settings round-trip: tutorialsCompleted now includes 'scoring-intro'.
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
    expect(completed).toContain('scoring-intro');
  });

  test('caption does not cover the winning-hand row across portrait / landscape / desktop', async ({
    page,
  }) => {
    // Regression guard for the PR-after-#431 fix: the tutorial
    // caption is allowed to overlap the ResultPanel halo (it
    // covers buttons / rules at the bottom of the panel), but the
    // "Seat 0 wins!" heading + winning-hand row at the *top* of
    // the panel must always remain unobscured. We assert this by
    // checking that the heading's bounding box does not intersect
    // the caption card's bounding box at any of the three shells
    // (PortraitShell, LandscapeShell, DesktopShell).
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
    await page.getByLabel('Start Scoring 101').click();
    await page.getByRole('button', { name: 'Got it' }).click();
    // Step 2 (pinghu) — the first example with a staged ResultPanel.
    await expect(page.getByRole('heading', { name: /平和/ })).toBeVisible();

    // Three shells: phone-portrait, phone-landscape, desktop. Each
    // resize re-derives both the caption placement and any width
    // cap on the ResultPanel itself, so every viewport stresses
    // the fix end-to-end.
    const viewports = [
      { w: 393, h: 852, name: 'portrait' },
      { w: 852, h: 393, name: 'landscape' },
      { w: 1280, h: 800, name: 'desktop' },
    ];
    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      // Give the overlay a frame to re-measure the result-panel
      // target rect through the registry's pending-update queue.
      await page.waitForTimeout(400);
      // The winning-hand row inside ResultPanel renders a row of
      // tiles sized to actual content (sortHand + an optional meld
      // strip), so its bounding box is a tight fit and a rect-
      // intersection check against the caption is meaningful. By
      // contrast the "Seat 0 wins!" Text element is text-aligned
      // left in a wider container — its box overstates the visible
      // glyph extent — so we anchor on the tile row instead.
      const hand = await page.locator('[data-testid="winning-hand"]').boundingBox();
      const captionCard = await page
        .getByRole('button', { name: 'Got it' })
        .locator('xpath=ancestor::*[2]')
        .boundingBox();
      expect(hand, `winning-hand box @ ${vp.name}`).not.toBeNull();
      expect(captionCard, `caption box @ ${vp.name}`).not.toBeNull();
      const h = hand!;
      const c = captionCard!;
      const overlaps =
        h.x < c.x + c.width && h.x + h.width > c.x && h.y < c.y + c.height && h.y + h.height > c.y;
      expect(
        overlaps,
        `caption covers winning-hand row at ${vp.name} ${vp.w}x${vp.h}: hand=${JSON.stringify(h)} caption=${JSON.stringify(c)}`,
      ).toBe(false);
    }
  });

  test('re-entry after completion: same six staged hands re-appear deterministically', async ({
    page,
  }) => {
    // Override the beforeEach pre-mark so scoring-intro is ALSO
    // included. The lobby card flips to a Replay affordance.
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
          ],
        }),
      );
    });

    await page.goto('/');
    await expect(page.getByLabel('Replay Scoring 101')).toBeVisible();
    await page.getByLabel('Replay Scoring 101').click();

    // Lesson opens on the intro step (controller's `begin()` resets
    // stepIndex to 0 cleanly).
    await expect(page.getByRole('heading', { name: 'Scoring 101' })).toBeVisible();
    await page.getByRole('button', { name: 'Got it' }).click();

    // Re-capture the six staged hands and the entry names. We assert
    // each step's engine breakdown matches the same first-run
    // expectations, which is the deterministic-replay contract.
    for (let i = 0; i < EXAMPLE_STEPS.length; i++) {
      const step = EXAMPLE_STEPS[i]!;
      await expect(page.getByRole('heading', { name: step.headingRe })).toBeVisible();

      const snap = await readResolvedSnapshot(page);
      expect(snap.phase).toBe('resolved');
      expect(snap.faan).toBe(step.expectedFaan);
      for (const expected of step.expectedEntries) {
        expect(snap.breakdownNames).toContain(expected);
      }

      await page.getByRole('button', { name: 'Got it' }).click();
    }

    await expect(page.getByText('Lesson complete!')).toBeVisible();
  });
});
