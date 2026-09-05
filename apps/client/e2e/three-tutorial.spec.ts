import { expect, test } from '@playwright/test';

/**
 * Tutorial coach-marks over the Three.js table (ARCHITECTURE.md §8).
 * Pins the 3D renderer, launches the `basics` lesson through the
 * verifier's test hook, and asserts:
 *   - zero console / page errors while the overlay sits over the canvas;
 *   - the coach-mark DOM the classic specs rely on is present and
 *     styled by the new overlay (`tutorial-next` CTA, `tutorial-halo`
 *     ring, `Skip lesson`), and the CTA advances the lesson;
 *   - the halo tracks a registered target rect once the lesson reaches
 *     the `own-hand` step (the 3D shell's `own-hand-tile` hit targets
 *     are wrapped in the same `<TutorialTarget>` the classic shells use);
 *   - `__MAHJONG_PERF__` published and stayed inside the tutorial budget.
 *
 * Runs on SwiftShader in CI, so fps is not asserted — only the CPU-side,
 * device-independent metrics (draw calls, triangles, programs).
 */

const BUDGET = { drawCalls: 48, triangles: 160_000, programs: 14 };

declare global {
  // Published by `TutorialOverlay` (see `publishLayout`).
  var __MAHJONG_TEST_TUTORIAL_LAYOUT__:
    | {
        placement: {
          kind: string;
          notch: number | null;
          gap: number | null;
          overlapsChrome: boolean;
        };
        feather?: { top: number; right: number; bottom: number; left: number };
        open?: { top: boolean; right: boolean; bottom: boolean; left: boolean };
        halo: { left: number; top: number; width: number; height: number } | null;
        solid: boolean;
      }
    | undefined;
  // Published by `three/core/spotlight`.
  var __MAHJONG_TEST_SPOTLIGHT__: (() => readonly number[]) | undefined;
  // Published by `three/core/sceneRects`.
  var __MAHJONG_TEST_CAMERA_MOTION__:
    | (() => { live: boolean; lastLiveAt: number; ticks: number })
    | undefined;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const g = globalThis as {
      __MAHJONG_TEST_RENDERER__?: 'classic' | '3d';
      __MAHJONG_TEST_SEED__?: number;
      __MAHJONG_TEST_BOT_PACE_MS__?: number;
      __MAHJONG_TEST_BOT_CLAIM_DELAY_MS__?: number;
    };
    g.__MAHJONG_TEST_RENDERER__ = '3d';
    g.__MAHJONG_TEST_SEED__ = 5;
    g.__MAHJONG_TEST_BOT_PACE_MS__ = 0;
    g.__MAHJONG_TEST_BOT_CLAIM_DELAY_MS__ = 0;
  });
});

// Three lesson steps plus a 15 s enclosure poll: on a software rasteriser
// with sibling workers the default 30 s budget is the binding limit.
test.setTimeout(90_000);

test('3D tutorial: coach-marks render over the canvas with zero errors and perf in budget', async ({
  page,
}) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => pageErrors.push(String(e)));

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

  await page.evaluate(() => {
    const g = globalThis as { __MAHJONG_TEST_START_TUTORIAL__?: (id: string) => void };
    if (!g.__MAHJONG_TEST_START_TUTORIAL__) throw new Error('tutorial hook missing');
    g.__MAHJONG_TEST_START_TUTORIAL__('basics');
  });

  // Step 1 — dice ceremony, targeted caption. The first card waits for
  // the camera rig to settle (up to 3.5 s), on top of a software
  // rasteriser's first paint.
  await expect(page.getByText('Opening dice')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('table-3d')).toBeVisible();
  const cta = page.getByTestId('tutorial-next');
  await expect(cta).toBeVisible();
  await expect(cta).toHaveText('Got it');
  await expect(page.getByRole('button', { name: 'Skip lesson' })).toBeVisible();
  await expect(page.getByText('Lesson 1/14')).toBeVisible();
  await expect(page.getByTestId('tutorial-halo')).toBeVisible();

  // The CTA sits fully inside the viewport (placement clamp).
  const vp = page.viewportSize();
  const box = await cta.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp!.height);

  // Step 2 — welcome (no target → centred card, no halo).
  await cta.click();
  await expect(page.getByText('Welcome to mahjong')).toBeVisible();
  await expect(page.getByTestId('tutorial-halo')).toHaveCount(0);

  // Step 3 — own-hand: the halo appears again once the 3D shell has a
  // registered `own-hand` rect; the CTA is still on screen.
  await page.getByTestId('tutorial-next').click();
  await expect(page.getByText('These are your 14 tiles')).toBeVisible();
  await expect(page.getByTestId('own-hand-tile').first()).toBeAttached();
  await expect(page.getByTestId('tutorial-step-label')).toHaveText(/step 3 of 6/i);
  const cta3 = await page.getByTestId('tutorial-next').boundingBox();
  expect(cta3).not.toBeNull();
  expect(cta3!.y + cta3!.height).toBeLessThanOrEqual(vp!.height);

  // The ring tracks the *real* projected hand: every hit-target sits
  // inside the halo once the camera has settled and the halo has eased.
  const halo = page.getByTestId('tutorial-halo');
  await expect(halo).toBeVisible();
  await expect
    .poll(
      async () => {
        const h = await halo.boundingBox();
        if (!h) return 'no halo';
        const tiles = await page.getByTestId('own-hand-tile').all();
        const boxes = await Promise.all(tiles.map((t) => t.boundingBox()));
        const outside = boxes.filter((b) => b && !contains(h, b));
        if (outside.length === 0 && boxes.length === 14) return 'enclosed';
        const o = outside[0];
        return `${outside.length}/${boxes.length} out; halo ${[h.x, h.y, h.width, h.height].map(Math.round)} first ${o ? [o.x, o.y, o.width, o.height].map(Math.round) : '-'}`;
      },
      // The camera eases in and the hit targets re-project every frame;
      // on a software rasteriser with sibling workers the deal itself can
      // still be flying tiles in for a long while.
      { timeout: 40_000 },
    )
    .toBe('enclosed');
  // …and the world-space accent lights those same 14 tiles.
  const lit = await page.evaluate(() => globalThis.__MAHJONG_TEST_SPOTLIGHT__?.() ?? []);
  expect(lit).toHaveLength(14);
  const handIds = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="own-hand-tile"]'))
      .map((el) => Number(el.getAttribute('data-tile-id')))
      .sort((a, b) => a - b),
  );
  expect([...lit]).toEqual(handIds);

  // Perf: the scene published a snapshot and stayed in budget.
  await page.waitForFunction(() => (globalThis.__MAHJONG_PERF__?.sample ?? 0) >= 1, null, {
    timeout: 10_000,
  });
  const perf = await page.evaluate(() => globalThis.__MAHJONG_PERF__ ?? null);
  expect(perf).not.toBeNull();
  expect(perf!.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
  expect(perf!.triangles).toBeLessThanOrEqual(BUDGET.triangles);
  expect(perf!.programs).toBeLessThanOrEqual(BUDGET.programs);

  expect(consoleErrors, consoleErrors.join('\n')).toEqual([]);
  expect(pageErrors, pageErrors.join('\n')).toEqual([]);
});

/**
 * Classic-renderer coach-mark layout rules the round-2 critic pinned:
 * the caption card never bisects HUD chrome (it lifts clear of the
 * YOUR TURN pill + sort chips on the own-hand step), the CTA keeps the
 * 44 px floor even in the compact side dock, the halo ring stays inside
 * the safe area when the target is taller than a landscape phone, and
 * the FullscreenPrompt stays hidden while a lesson is showing.
 */
const CARD_XPATH = 'xpath=ancestor::*[contains(@style,"border-radius: 16px")][1]';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
const intersects = (a: Box, b: Box) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
const contains = (outer: Box, inner: Box) =>
  inner.x >= outer.x - 1 &&
  inner.y >= outer.y - 1 &&
  inner.x + inner.width <= outer.x + outer.width + 1 &&
  inner.y + inner.height <= outer.y + outer.height + 1;

test.describe('3D coach-marks: landscape dice step', () => {
  test.use({ viewport: { width: 915, height: 412 }, isMobile: true, hasTouch: true });

  test('the ring never crosses the hand tiles under the dice modal', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
    await page.evaluate(() => {
      (
        globalThis as { __MAHJONG_TEST_START_TUTORIAL__?: (id: string) => void }
      ).__MAHJONG_TEST_START_TUTORIAL__?.('basics');
    });
    await expect(page.getByText('Opening dice')).toBeVisible();
    await expect(page.getByTestId('tutorial-halo')).toBeVisible();
    await expect(page.getByTestId('own-hand-tile').first()).toBeAttached();
    // Chrome discovery is asynchronous: the ring must *end up* clear of
    // every tile (trimmed to the modal's portion above the hand row).
    await expect
      .poll(
        async () => {
          const halo = await page.getByTestId('tutorial-halo').boundingBox();
          if (!halo) return 'no halo';
          const tiles = await page.getByTestId('own-hand-tile').all();
          const boxes = await Promise.all(tiles.map((t) => t.boundingBox()));
          const cut = boxes.filter((b) => b && intersects(halo, b));
          return cut.length === 0 ? 'clear' : `cuts ${cut.length}`;
        },
        // The deal may still be flying tiles under the modal on a starved
        // rasteriser; the ring only has to end up clear.
        { timeout: 30_000 },
      )
      .toBe('clear');
    const layout = await page.evaluate(() => globalThis.__MAHJONG_TEST_TUTORIAL_LAYOUT__);
    // When the modal reaches into the hand row the bottom side is the
    // trimmed, open one (straight scrim edge, no stroke). The compact
    // landscape card (round 3) stops ≥ 12 px above the settled tiles, in
    // which case the ring closes normally — either way it never cuts a
    // tile. The deal may still be flying tiles in, so wait for the hand
    // row's top edge to settle before measuring it.
    const modal = (await page.getByTestId('dice-ceremony-glass').boundingBox()) as Box;
    // Hidden hit-targets (a tile still in flight has no rect yet) report
    // an empty box at the origin — skip them.
    const readHandTop = () =>
      page.getByTestId('own-hand-tile').evaluateAll((els) => {
        const tops = els
          .map((el) => el.getBoundingClientRect())
          .filter((r) => r.height > 0)
          .map((r) => r.top);
        return tops.length ? Math.min(...tops) : Number.POSITIVE_INFINITY;
      });
    let handTop = await readHandTop();
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(400);
      const next = await readHandTop();
      const settled = Math.abs(next - handTop) < 1;
      handTop = next;
      if (settled) break;
    }
    if (layout?.open?.bottom) {
      expect(layout?.feather?.bottom).toBe(3);
    } else {
      expect(modal.y + modal.height).toBeLessThanOrEqual(handTop - 12);
    }
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});

test.describe('classic coach-marks: chrome avoidance (phone)', () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (globalThis as { __MAHJONG_TEST_RENDERER__?: string }).__MAHJONG_TEST_RENDERER__ = 'classic';
    });
  });

  test('own-hand card lifts clear of the action row instead of cutting through it', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
    await page.evaluate(() => {
      (
        globalThis as { __MAHJONG_TEST_START_TUTORIAL__?: (id: string) => void }
      ).__MAHJONG_TEST_START_TUTORIAL__?.('basics');
    });
    await expect(page.getByText('Opening dice')).toBeVisible();
    await page.getByTestId('tutorial-next').click();
    await expect(page.getByText('Welcome to mahjong')).toBeVisible();
    await page.getByTestId('tutorial-next').click();
    await expect(page.getByText('These are your 14 tiles')).toBeVisible();
    await expect(page.getByTestId('tutorial-halo')).toBeVisible();

    const cta = page.getByTestId('tutorial-next');
    const card = cta.locator(CARD_XPATH);
    // The sort chips (`Sort by Suit` …) and the YOUR TURN pill are the
    // action row directly above the hand.
    const chips = await page.getByRole('button', { name: /^Sort by / }).all();
    const pills = await page.getByText(/YOUR TURN/).all();
    expect(chips.length).toBeGreaterThan(0);
    expect(pills.length).toBeGreaterThan(0);
    // Chrome discovery + the settle debounce are asynchronous; the card
    // must *end up* clear of every control in the row.
    await expect
      .poll(
        async () => {
          const cardBox = await card.boundingBox();
          if (!cardBox) return 'no card';
          const others = await Promise.all([...chips, ...pills].map((l) => l.boundingBox()));
          const cut = others.filter((b) => b && intersects(cardBox, b));
          return cut.length === 0 ? 'clear' : `cuts ${cut.length}`;
        },
        { timeout: 5_000 },
      )
      .toBe('clear');
    // The card still sits above the hand, notch side down.
    const cardBox = (await card.boundingBox()) as Box;
    const haloBox = (await page.getByTestId('tutorial-halo').boundingBox()) as Box;
    expect(cardBox.y + cardBox.height).toBeLessThan(haloBox.y);
    const ctaBox = (await cta.boundingBox()) as Box;
    expect(ctaBox.height).toBeGreaterThanOrEqual(44);
    // The gold ring's aura and the pulse lean away from the action row
    // (tight top feather). The hand runs close to the bottom edge: with
    // no room for even a slim ring there the halo opens onto the edge;
    // with a few px of room it closes at the edge margin instead.
    const layout = await page.evaluate(() => globalThis.__MAHJONG_TEST_TUTORIAL_LAYOUT__);
    expect(layout?.placement.kind).toBe('above');
    expect(layout?.placement.overlapsChrome).toBe(false);
    expect(layout?.feather?.top).toBe(3);
    const hand = (await page.locator('[data-tutorial-target="own-hand"]').boundingBox()) as Box;
    if (hand.y + hand.height > 915 - 4)
      expect(haloBox.y + haloBox.height).toBeGreaterThanOrEqual(915 + 14);
    else expect(haloBox.y + haloBox.height).toBe(915 - 2);
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });

  test('portrait result-panel: score header + hand spotlit, solid card docked below', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
    await page.evaluate(() => {
      (
        globalThis as { __MAHJONG_TEST_START_TUTORIAL__?: (id: string) => void }
      ).__MAHJONG_TEST_START_TUTORIAL__?.('scoring-intro');
    });
    await expect(page.getByText('Scoring 101')).toBeVisible();
    await page.getByTestId('tutorial-next').click();
    await expect(page.getByRole('heading', { name: /平和/ })).toBeVisible();
    await expect(page.getByTestId('tutorial-halo')).toBeVisible();
    // The spotlight is the focus band (header, faan line, winning hand,
    // View breakdown) — not the whole panel — so the card docks *below*
    // it with a notch, over the dimmed rules block, and paints solid.
    await expect
      .poll(async () => {
        const l = await page.evaluate(() => globalThis.__MAHJONG_TEST_TUTORIAL_LAYOUT__);
        return l ? `${l.placement.kind}:${l.solid}:${l.placement.notch !== null}` : 'none';
      })
      .toBe('below:true:true');
    // Snug: the card docks CARD_GAP under the ring and covers the dimmed
    // rules chips itself, instead of floating 90 px below with the notch
    // aimed at them (round-4 critic, issue 2).
    const snug = await page.evaluate(() => globalThis.__MAHJONG_TEST_TUTORIAL_LAYOUT__);
    expect(snug?.placement.gap).toBeLessThanOrEqual(14.5);
    const halo = (await page.getByTestId('tutorial-halo').boundingBox()) as Box;
    const hand = (await page.getByTestId('winning-hand').boundingBox()) as Box;
    const breakdown = (await page
      .getByRole('button', { name: 'View breakdown' })
      .boundingBox()) as Box;
    const rules = (await page.getByText('Minimum faan').boundingBox()) as Box;
    expect(contains(halo, hand)).toBe(true);
    expect(contains(halo, breakdown)).toBe(true);
    expect(rules.y).toBeGreaterThan(halo.y + halo.height);
    const cta = page.getByTestId('tutorial-next');
    const card = cta.locator(CARD_XPATH);
    expect(((await card.boundingBox()) as Box).y).toBeGreaterThan(halo.y + halo.height);
    // Solid card: no backdrop-filter, fully opaque background.
    const style = await card.evaluate((el) => {
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, filter: cs.backdropFilter || 'none' };
    });
    expect(style.filter).toBe('none');
    expect(style.bg).toMatch(/^rgb\(/);
    const ctaBox = (await cta.boundingBox()) as Box;
    expect(ctaBox.y + ctaBox.height).toBeLessThanOrEqual(915);
  });
});

test.describe('classic coach-marks: desktop own-hand side dock', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (globalThis as { __MAHJONG_TEST_RENDERER__?: string }).__MAHJONG_TEST_RENDERER__ = 'classic';
    });
  });

  test('card docks beside the hand with a notch instead of floating over the wall counter', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
    await page.evaluate(() => {
      (
        globalThis as { __MAHJONG_TEST_START_TUTORIAL__?: (id: string) => void }
      ).__MAHJONG_TEST_START_TUTORIAL__?.('basics');
    });
    await expect(page.getByText('Opening dice')).toBeVisible();
    await page.getByTestId('tutorial-next').click();
    await expect(page.getByText('Welcome to mahjong')).toBeVisible();
    await page.getByTestId('tutorial-next').click();
    await expect(page.getByText('These are your 14 tiles')).toBeVisible();
    await expect(page.getByTestId('tutorial-halo')).toBeVisible();

    // Chrome discovery is asynchronous: the dock must *settle* on a side.
    await expect
      .poll(async () => {
        const l = await page.evaluate(() => globalThis.__MAHJONG_TEST_TUTORIAL_LAYOUT__);
        return l?.placement.kind ?? 'none';
      })
      .toMatch(/^(left|right)$/);
    const layout = await page.evaluate(() => globalThis.__MAHJONG_TEST_TUTORIAL_LAYOUT__);
    expect(layout?.placement.notch).not.toBeNull();
    // SIDE_GAP is 12; the card edge is rounded to a whole pixel while
    // the halo edge is not, so allow the rounding half-pixel.
    expect(layout?.placement.gap).toBeLessThanOrEqual(12.5);
    expect(layout?.placement.overlapsChrome).toBe(false);

    const cta = page.getByTestId('tutorial-next');
    const card = (await cta.locator(CARD_XPATH).boundingBox()) as Box;
    const halo = (await page.getByTestId('tutorial-halo').boundingBox()) as Box;
    // Beside the halo, inside the 24 px desktop inset, clear of the
    // wall counter and the action row.
    expect(card.x >= halo.x + halo.width || card.x + card.width <= halo.x).toBe(true);
    expect(card.x).toBeGreaterThanOrEqual(24);
    expect(card.x + card.width).toBeLessThanOrEqual(1440 - 24);
    expect(card.y + card.height).toBeLessThanOrEqual(900 - 24);
    const counter = page.getByText(/^\d+ left$/);
    const chips = await page.getByRole('button', { name: /^Sort by / }).all();
    const others = await Promise.all([counter, ...chips].map((l) => l.boundingBox()));
    for (const b of others) if (b) expect(intersects(card, b)).toBe(false);
    // Every button keeps the 44 px floor.
    for (const name of ['Skip lesson', 'Restart lesson']) {
      const b = (await page.getByRole('button', { name }).boundingBox()) as Box;
      expect(b.height, name).toBeGreaterThanOrEqual(44);
    }
  });
});

test.describe('classic coach-marks: desktop dice step', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (globalThis as { __MAHJONG_TEST_RENDERER__?: string }).__MAHJONG_TEST_RENDERER__ = 'classic';
    });
  });

  test('the ring encloses the wall counter instead of bisecting it', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
    await page.evaluate(() => {
      (
        globalThis as { __MAHJONG_TEST_START_TUTORIAL__?: (id: string) => void }
      ).__MAHJONG_TEST_START_TUTORIAL__?.('basics');
    });
    await expect(page.getByText('Opening dice')).toBeVisible();
    await expect(page.getByTestId('tutorial-halo')).toBeVisible();
    const counter = page.getByText(/^\d+ left$/);
    await expect(counter).toBeVisible();
    // The dice modal's bottom edge lands on the counter; chrome discovery
    // is asynchronous, so the ring must *end up* around it.
    await expect
      .poll(async () => {
        const halo = await page.getByTestId('tutorial-halo').boundingBox();
        const c = await counter.boundingBox();
        if (!halo || !c) return 'no boxes';
        if (contains(halo, c)) return 'enclosed';
        return intersects(halo, c) ? 'bisected' : 'clear';
      })
      .not.toBe('bisected');
    // The card keeps its praised composition: docked above the dice with a notch.
    const layout = await page.evaluate(() => globalThis.__MAHJONG_TEST_TUTORIAL_LAYOUT__);
    expect(layout?.placement.kind).toBe('above');
    expect(layout?.placement.notch).not.toBeNull();
  });
});

test.describe('classic coach-marks: landscape side dock', () => {
  test.use({ viewport: { width: 915, height: 412 }, isMobile: true, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (globalThis as { __MAHJONG_TEST_RENDERER__?: string }).__MAHJONG_TEST_RENDERER__ = 'classic';
    });
  });

  test('dice step: the ring is trimmed above the hand row instead of bisecting it', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
    await page.evaluate(() => {
      (
        globalThis as { __MAHJONG_TEST_START_TUTORIAL__?: (id: string) => void }
      ).__MAHJONG_TEST_START_TUTORIAL__?.('basics');
    });
    await expect(page.getByText('Opening dice')).toBeVisible();
    await expect(page.getByTestId('tutorial-halo')).toBeVisible();
    await expect(page.getByTestId('own-hand-tile').first()).toBeVisible();
    await expect
      .poll(
        async () => {
          const halo = await page.getByTestId('tutorial-halo').boundingBox();
          if (!halo) return 'no halo';
          const boxes = await Promise.all(
            (await page.getByTestId('own-hand-tile').all()).map((t) => t.boundingBox()),
          );
          const cut = boxes.filter((b) => b && intersects(halo, b));
          return cut.length === 0 ? 'clear' : `cuts ${cut.length}`;
        },
        // The deal may still be flying tiles under the modal on a starved
        // rasteriser; the ring only has to end up clear.
        { timeout: 30_000 },
      )
      .toBe('clear');
    const layout = await page.evaluate(() => globalThis.__MAHJONG_TEST_TUTORIAL_LAYOUT__);
    expect(layout?.open?.bottom).toBe(true);
    // The dice card still shows its rolls above the cut.
    const dice = (await page.getByTestId('dice-ceremony-paper').boundingBox()) as Box;
    const halo = (await page.getByTestId('tutorial-halo').boundingBox()) as Box;
    expect(halo.y + halo.height).toBeGreaterThan(dice.y + dice.height * 0.5);
  });

  test('halo clamps to the safe area, CTA keeps 44 px, fullscreen prompt hides', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
    await page.evaluate(() => {
      (
        globalThis as { __MAHJONG_TEST_START_TUTORIAL__?: (id: string) => void }
      ).__MAHJONG_TEST_START_TUTORIAL__?.('scoring-intro');
    });
    await expect(page.getByText('Scoring 101')).toBeVisible();
    await page.getByTestId('tutorial-next').click();
    await expect(page.getByRole('heading', { name: /平和/ })).toBeVisible();
    await expect(page.getByTestId('tutorial-halo')).toBeVisible();

    const fullscreen = page.getByRole('button', { name: 'Enter fullscreen' });
    await expect(fullscreen).toHaveCount(0);

    // The panel is taller than the viewport, but the spotlight is only
    // its score header + winning hand (the focus band), so the ring sits
    // fully inside the safe area and never crosses the hand tiles or
    // the action row (round-4 critic, issue 3). The focus band is read
    // from the DOM asynchronously, so the ring must *end up* clear.
    await expect
      .poll(
        async () => {
          const h = await page.getByTestId('tutorial-halo').boundingBox();
          if (!h) return 'no halo';
          const boxes = await Promise.all(
            (await page.getByTestId('own-hand-tile').all()).map((t) => t.boundingBox()),
          );
          return boxes.some((b) => b && intersects(h, b)) ? 'cuts tiles' : 'clear';
        },
        { timeout: 8_000 },
      )
      .toBe('clear');
    const halo = (await page.getByTestId('tutorial-halo').boundingBox()) as Box;
    expect(halo.x).toBeGreaterThanOrEqual(12);
    expect(halo.x + halo.width).toBeLessThanOrEqual(915 - 12);
    expect(halo.y).toBeGreaterThanOrEqual(12);
    expect(halo.y + halo.height).toBeLessThanOrEqual(412 - 12);
    const hand = (await page.getByTestId('winning-hand').boundingBox()) as Box;
    expect(contains(halo, hand)).toBe(true);
    // (The hand tiles are covered by the poll above — a one-shot loop here
    // would race the FlipBag deal flight, which carries tiles through the
    // panel's screen area for a few hundred ms.)
    // The seat strip above the panel is a neighbour, not part of the
    // lesson target: the ring hugs the panel and leaves the '西 Bao …
    // Bot (Easy)' entries dimmed (round-4 critic, issue 3).
    // (Centre rule: a badge whose centre is outside the ring is never
    // enclosed; the ring's own 8 px pad may still graze its text box.)
    for (const seat of await page.getByText(/Bot \(Easy\)/).all()) {
      const b = await seat.boundingBox();
      if (b) {
        expect(contains(halo, b)).toBe(false);
        expect(b.y + b.height / 2).toBeLessThan(halo.y);
      }
    }
    const layout = await page.evaluate(() => globalThis.__MAHJONG_TEST_TUTORIAL_LAYOUT__);
    expect(layout?.placement.kind).toMatch(/^(left|right)$/);

    const cta = page.getByTestId('tutorial-next');
    const ctaBox = (await cta.boundingBox()) as Box;
    expect(ctaBox.height).toBeGreaterThanOrEqual(44);
    expect(ctaBox.y + ctaBox.height).toBeLessThanOrEqual(412);
    // The side card lives in the strip beside the panel, never over it.
    const card = (await cta.locator(CARD_XPATH).boundingBox()) as Box;
    expect(card.x >= halo.x + halo.width || card.x + card.width <= halo.x).toBe(true);

    // Leaving the lesson gives the landscape fullscreen offer back.
    await page.getByRole('button', { name: 'Skip lesson' }).click();
    await expect(page.getByTestId('tutorial-next')).toHaveCount(0);
    await expect(fullscreen).toBeVisible();
  });

  test('a centred (no-target) card slides clear of the discards toggle and the hand', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
    await page.evaluate(() => {
      (
        globalThis as { __MAHJONG_TEST_START_TUTORIAL__?: (id: string) => void }
      ).__MAHJONG_TEST_START_TUTORIAL__?.('scoring-intro');
    });
    await expect(page.getByText('Scoring 101')).toBeVisible();
    await expect(page.getByTestId('tutorial-halo')).toHaveCount(0);
    const card = page.getByTestId('tutorial-next').locator(CARD_XPATH);
    const toggles = await page.getByText(/^(Order|Player)$/).all();
    const tiles = await page.getByTestId('own-hand-tile').all();
    expect(toggles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeGreaterThan(0);
    // The hand row stays clear (≥ 12 px of air); the toggle is either
    // clear or swallowed whole by a solid card — never bisected — and the
    // card stays horizontally centred rather than sliding 70 px off to
    // dodge a small control (round-4 critic, issue 4).
    await expect
      .poll(
        async () => {
          const c = await card.boundingBox();
          if (!c) return 'no card';
          const tileBoxes = await Promise.all(tiles.map((l) => l.boundingBox()));
          const cutTiles = tileBoxes.filter((b) => b && intersects(c, b));
          const toggleBoxes = await Promise.all(toggles.map((l) => l.boundingBox()));
          const bisected = toggleBoxes.filter((b) => b && intersects(c, b) && !contains(c, b));
          const layout = await page.evaluate(() => globalThis.__MAHJONG_TEST_TUTORIAL_LAYOUT__);
          return cutTiles.length === 0 && bisected.length === 0
            ? `clear:${layout?.placement.kind}`
            : `cuts ${cutTiles.length}+${bisected.length}`;
        },
        { timeout: 5_000 },
      )
      .toBe('clear:center');
    const c = (await card.boundingBox()) as Box;
    expect(c.x).toBeGreaterThanOrEqual(12);
    expect(c.y).toBeGreaterThanOrEqual(12);
    expect(c.x + c.width).toBeLessThanOrEqual(915 - 12);
    expect(c.y + c.height).toBeLessThanOrEqual(412 - 12);
    expect(Math.abs(c.x + c.width / 2 - 915 / 2)).toBeLessThanOrEqual(33);
    let handTop = Number.POSITIVE_INFINITY;
    for (const t of tiles) {
      const b = await t.boundingBox();
      if (b) handTop = Math.min(handTop, b.y);
    }
    expect(c.y + c.height + 12).toBeLessThanOrEqual(handTop + 0.5);
  });
});

/**
 * Readiness under CPU pressure (round-2 critic, issue 4). With three
 * software-GL Chromiums in parallel the first coach-mark sat behind a
 * full-screen dim with no ring and no card for over a second, and the
 * CTA was not clickable for eight. The overlay now registers target
 * rects and measures the card synchronously on web, paints the card at
 * once and animates opacity only, so the hole, the card and a working
 * CTA all land within `READY_BUDGET_MS` of the scrim — asserted here
 * under a 4× CDP CPU throttle on top of SwiftShader.
 */
test.describe('3D coach-marks: readiness under CPU throttling', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  const READY_BUDGET_MS = 1500;
  // The first card also waits for the camera rig (≤ 3.5 s); under a 4x
  // throttle on an already loaded machine the whole flow needs headroom.
  test.setTimeout(90_000);

  test('scrim hole, card and clickable CTA land together under a 4x CPU throttle', async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (e) => pageErrors.push(String(e)));
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
    await page.evaluate(() => {
      (
        globalThis as { __MAHJONG_TEST_START_TUTORIAL__?: (id: string) => void }
      ).__MAHJONG_TEST_START_TUTORIAL__?.('basics');
    });

    // In-page sampler: the first frame with the scrim, the first with the
    // ring (the hole is cut), and the first with a CTA that is laid out
    // and at least half opaque (the entrance fades from 0.55, not 0).
    const t = await page.evaluate(async () => {
      const q = (id: string) =>
        document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
      const opacityOf = (el: HTMLElement): number => {
        let o = 1;
        let n: HTMLElement | null = el;
        for (let i = 0; i < 8 && n; i++, n = n.parentElement)
          o = Math.min(o, Number(getComputedStyle(n).opacity));
        return o;
      };
      const start = performance.now();
      let scrimAt: number | null = null;
      let ringAt: number | null = null;
      let ctaAt: number | null = null;
      while (performance.now() - start < 30_000) {
        const now = performance.now();
        if (scrimAt === null && q('tutorial-scrim')) scrimAt = now;
        if (ringAt === null && q('tutorial-halo')) ringAt = now;
        if (ctaAt === null) {
          const c = q('tutorial-next');
          const r = c?.getBoundingClientRect();
          if (c && r && r.width > 0 && r.height > 0 && opacityOf(c) >= 0.5) ctaAt = now;
        }
        if (scrimAt !== null && ringAt !== null && ctaAt !== null) break;
        await new Promise((r) => setTimeout(r, 16));
      }
      return { scrimAt, ringAt, ctaAt };
    });
    expect(t.scrimAt, 'scrim never appeared').not.toBeNull();
    expect(t.ringAt, 'ring never appeared').not.toBeNull();
    expect(t.ctaAt, 'CTA never appeared').not.toBeNull();
    const ringLag = t.ringAt! - t.scrimAt!;
    const ctaLag = t.ctaAt! - t.scrimAt!;
    expect(ringLag, `hole cut ${Math.round(ringLag)} ms after the scrim`).toBeLessThanOrEqual(
      READY_BUDGET_MS,
    );
    expect(ctaLag, `card up ${Math.round(ctaLag)} ms after the scrim`).toBeLessThanOrEqual(
      READY_BUDGET_MS,
    );

    // The CTA is clickable at once — the entrance fade never gates
    // pointer events, so a hit test at its centre resolves to the button
    // itself (not the scrim, not a fading wrapper) and a tap there
    // advances the lesson. A raw pointer click, as a user's tap would be:
    // Playwright's actionability wait needs two settled animation frames,
    // which the 3D scene's first (throttled) frames can hold up for
    // longer than the budget without the button being any less tappable.
    const cta = page.getByTestId('tutorial-next');
    const box = await cta.boundingBox();
    expect(box).not.toBeNull();
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    const hit = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return el?.closest('[data-testid="tutorial-next"]') ? 'cta' : (el?.tagName ?? 'nothing');
      },
      [cx, cy] as const,
    );
    expect(hit, 'hit test at the CTA centre').toBe('cta');
    await page.mouse.click(cx, cy);
    await expect(page.getByText('Welcome to mahjong')).toBeVisible({ timeout: 5_000 });
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
  });
});

/**
 * The claim-strip ring (user feedback: "the highlight around the actions
 * pill is not correct"). The `claims` lesson parks on seat 3's scripted
 * chi-completion discard; the `claim-bar` target must ring the visible
 * CHI / PASS strip — hugging it within the halo padding on every side,
 * never a flex wrapper or a zero-size stand-in — and the lesson must reach
 * the step without a React error (a landscape phone used to crash with
 * "maximum update depth" on the own-hand step before it).
 */
const RING_SLACK = 12;
/** Client rects of the own-hand hit targets, read in one evaluate — a
 *  locator per tile would wait on any hit target the shell re-creates
 *  mid-assertion. */
const ownHandTileBoxes = (page: import('@playwright/test').Page): Promise<Box[]> =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-testid="own-hand-tile"]'))
      .map((el) => el.getBoundingClientRect())
      .filter((b) => b.width > 0 && b.height > 0)
      .map((b) => ({ x: b.left, y: b.top, width: b.width, height: b.height })),
  );
const clampToViewport = (b: Box, vp: { width: number; height: number }): Box => {
  const x = Math.max(0, b.x);
  const y = Math.max(0, b.y);
  return {
    x,
    y,
    width: Math.min(vp.width, b.x + b.width) - x,
    height: Math.min(vp.height, b.y + b.height) - y,
  };
};
for (const [label, use] of [
  ['phone', { viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true }],
  ['landscape', { viewport: { width: 915, height: 412 }, isMobile: true, hasTouch: true }],
  ['desktop', { viewport: { width: 1440, height: 900 } }],
] as const) {
  test.describe(`3D coach-marks: claim strip ring (${label})`, () => {
    test.use(use);
    // Driving a lesson to its claim window on a software rasteriser with
    // sibling workers takes 15-25 s on its own.
    test.setTimeout(90_000);
    test('the ring hugs the CHI / PASS strip and the lesson reaches it error-free', async ({
      page,
    }) => {
      const pageErrors: string[] = [];
      page.on('pageerror', (e) => pageErrors.push(String(e)));
      await page.addInitScript(() => {
        (
          globalThis as { __MAHJONG_TUTORIAL_FORCE_PASS__?: boolean }
        ).__MAHJONG_TUTORIAL_FORCE_PASS__ = true;
      });
      await page.goto('/');
      await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
      await page.evaluate(() => {
        const g = globalThis as { __MAHJONG_TEST_START_TUTORIAL__?: (id: string) => void };
        g.__MAHJONG_TEST_START_TUTORIAL__?.('claims');
      });
      await expect(page.getByText('Claiming a tile')).toBeVisible({ timeout: 15_000 });
      await page.getByTestId('tutorial-next').click();
      await expect(page.getByText('Take your first turn')).toBeVisible();
      await page.getByTestId('own-hand-tile').first().click();
      await expect(page.getByText('Claim the chi!')).toBeVisible({ timeout: 20_000 });

      const strip = page.getByTestId('claim-bar');
      await expect(strip).toBeVisible();
      const chi = page.getByRole('button', { name: 'Chi' });
      await expect(chi).toBeVisible();
      const halo = page.getByTestId('tutorial-halo');
      // No lag: the ring moves with the card, on the render that swaps
      // the step — not on the next animation frame, which a starved
      // renderer can hold back for a second while the ring still sits
      // on the previous step's target (the hand row, the river).
      const first = await page.evaluate(() => {
        const h = document.querySelector('[data-testid="tutorial-halo"]')?.getBoundingClientRect();
        const s = document.querySelector('[data-testid="claim-bar"]')?.getBoundingClientRect();
        if (!h || !s) return null;
        return { haloCy: h.top + h.height / 2, stripTop: s.top, stripBottom: s.bottom };
      });
      expect(first).not.toBeNull();
      expect(first!.haloCy).toBeGreaterThan(first!.stripTop - 12);
      expect(first!.haloCy).toBeLessThan(first!.stripBottom + 12);
      await expect
        .poll(
          async () => {
            const raw = await halo.boundingBox();
            const s = await strip.boundingBox();
            const c = await chi.boundingBox();
            if (!raw || !s || !c) return 'missing';
            // A strip flush with the bottom safe line opens the ring on
            // that side (the halo overhangs the viewport); the visible
            // ring is the viewport-clamped box.
            const h = clampToViewport(raw, page.viewportSize()!);
            if (!contains(h, s) || !contains(h, c))
              return `not enclosed ${JSON.stringify({ h, s })}`;
            const slack = [
              s.x - h.x,
              s.y - h.y,
              h.x + h.width - (s.x + s.width),
              h.y + h.height - (s.y + s.height),
            ];
            return slack.every((v) => v <= RING_SLACK)
              ? 'hugging'
              : `loose ${slack.map(Math.round)}`;
          },
          // The strip's own entrance (an 8 px slide) is the only motion
          // left to settle; SwiftShader paints it within a couple of frames.
          { timeout: 2_500 },
        )
        .toBe('hugging');
      // Exactly one live registration feeds the ring: one strip in the DOM.
      await expect(strip).toHaveCount(1);
      // The card never sits on a hand tile: on a portrait phone the hand
      // is two rows and the card docks above both, not over the upper one.
      const cardBox = await page.getByTestId('tutorial-card').boundingBox();
      expect(cardBox).not.toBeNull();
      for (const b of await ownHandTileBoxes(page))
        expect(
          intersects(cardBox!, b),
          `card ${JSON.stringify(cardBox)} over tile ${JSON.stringify(b)}`,
        ).toBe(false);
      expect(pageErrors, pageErrors.join('\n')).toEqual([]);
    });
  });
}

/**
 * A lesson's first card waits for the camera: the desktop table eases in
 * after mount, and the opening coach-mark used to be captured over a
 * table caught mid-dolly. The card may only appear once the rig reports
 * itself at rest.
 */
test.describe('3D coach-marks: first card waits for the camera to settle', () => {
  test.use({ viewport: { width: 1440, height: 900 } });
  test.setTimeout(60_000);
  test('the opening card appears with the rig at rest', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
    const startedAt = Date.now();
    await page.evaluate(() => {
      const g = globalThis as { __MAHJONG_TEST_START_TUTORIAL__?: (id: string) => void };
      g.__MAHJONG_TEST_START_TUTORIAL__?.('basics');
    });
    await expect(page.getByTestId('table-3d')).toBeVisible({ timeout: 15_000 });
    const cta = page.getByTestId('tutorial-next');
    await expect(cta).toBeVisible({ timeout: 15_000 });
    expect(Date.now() - startedAt).toBeGreaterThan(0);
    // The rig is at rest the instant the card is up — the scene now
    // snaps to the preset for the host's real size at build, so there is
    // no lobby → table dolly for the gate to wait out — and stays at
    // rest: the hand row does not move under the card afterwards.
    const handBox = async () => {
      const boxes = await ownHandTileBoxes(page);
      if (boxes.length === 0) return null;
      return {
        x: Math.min(...boxes.map((b) => b.x)),
        y: Math.min(...boxes.map((b) => b.y)),
        r: Math.max(...boxes.map((b) => b.x + b.width)),
        b: Math.max(...boxes.map((b) => b.y + b.height)),
      };
    };
    const motion = await page.evaluate(() => globalThis.__MAHJONG_TEST_CAMERA_MOTION__?.() ?? null);
    expect(motion).not.toBeNull();
    expect(motion!.live).toBe(false);
    const before = await handBox();
    expect(before).not.toBeNull();
    for (let i = 0; i < 4; i++) {
      await page.waitForTimeout(400);
      const m = await page.evaluate(() => globalThis.__MAHJONG_TEST_CAMERA_MOTION__?.() ?? null);
      expect(m?.live, `rig live ${i * 400 + 400} ms after the card`).toBe(false);
    }
    const after = await handBox();
    expect(after).not.toBeNull();
    for (const k of ['x', 'y', 'r', 'b'] as const)
      expect(Math.abs(after![k] - before![k]), `hand ${k} moved after the card`).toBeLessThan(2);
  });
});

/**
 * The tsumo button's ring on a phone: the button sits in the portrait
 * action tray (a 96 px layout slot); the chrome scan must not count the
 * slot as a control, or the ring grows to the slot instead of the button.
 */
test.describe('3D coach-marks: tsumo button ring (phone)', () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  test.setTimeout(60_000);
  test('the ring hugs the Declare win button', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
    await page.evaluate(() => {
      const g = globalThis as { __MAHJONG_TEST_START_TUTORIAL__?: (id: string) => void };
      g.__MAHJONG_TEST_START_TUTORIAL__?.('win');
    });
    await expect(page.getByText('Winning a hand')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('tutorial-next').click();
    await expect(page.getByText("You're already winning!")).toBeVisible();
    const button = page.getByRole('button', { name: /^Declare win \(tsumo/ });
    await expect(button).toBeVisible();
    const halo = page.getByTestId('tutorial-halo');
    await expect
      .poll(
        async () => {
          const h = await halo.boundingBox();
          const b = await button.boundingBox();
          if (!h || !b) return 'missing';
          if (!contains(h, b)) return 'not enclosed';
          const slack = [
            b.x - h.x,
            b.y - h.y,
            h.x + h.width - (b.x + b.width),
            h.y + h.height - (b.y + b.height),
          ];
          return slack.every((v) => v <= RING_SLACK) ? 'hugging' : `loose ${slack.map(Math.round)}`;
        },
        { timeout: 15_000 },
      )
      .toBe('hugging');
    // "Your hand is complete" — the card must leave both hand rows visible.
    const cardBox = await page.getByTestId('tutorial-card').boundingBox();
    expect(cardBox).not.toBeNull();
    for (const b of await ownHandTileBoxes(page))
      expect(intersects(cardBox!, b), `card over tile ${JSON.stringify(b)}`).toBe(false);
  });
});

/**
 * The dice step on a portrait phone: the modal fills the middle of the
 * screen and the two-row hand sits under it, so no card fits beside or
 * below the modal. The overlay falls back to the slim strip in the band
 * under the hand (over the footer, covered whole) rather than a card
 * over the lower row of tiles.
 */
test.describe('3D coach-marks: portrait dice step keeps off the hand', () => {
  test.use({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  test.setTimeout(60_000);
  test('the strip sits under both hand rows and the modal stays whole', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
    await page.evaluate(() => {
      const g = globalThis as { __MAHJONG_TEST_START_TUTORIAL__?: (id: string) => void };
      g.__MAHJONG_TEST_START_TUTORIAL__?.('basics');
    });
    await expect(page.getByText('Opening dice')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('own-hand-tile').first()).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => globalThis_layoutKind(page), { timeout: 5_000 }).toBe('strip');
    const cardBox = await page.getByTestId('tutorial-card').boundingBox();
    expect(cardBox).not.toBeNull();
    const modal = await page.locator('[data-testid^="dice-ceremony-"]').boundingBox();
    expect(modal).not.toBeNull();
    expect(intersects(cardBox!, modal!)).toBe(false);
    for (const b of await ownHandTileBoxes(page))
      expect(intersects(cardBox!, b), `card over tile ${JSON.stringify(b)}`).toBe(false);
    // The CTA is on screen and clickable from the strip.
    const cta = page.getByTestId('tutorial-next');
    await expect(cta).toBeVisible();
    const ctaBox = await cta.boundingBox();
    expect(ctaBox!.y + ctaBox!.height).toBeLessThanOrEqual(915);
    // Every HUD control under the strip (turn chip, table chip, footer
    // badge, sort pills) is either clear of it or covered whole — the
    // strip stretches over the band rather than cutting a chip in two.
    const bisected = await page.evaluate((card) => {
      const out: string[] = [];
      for (const el of Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid], [role="button"]'),
      )) {
        if (el.closest('[data-tutorial-overlay]')) continue;
        // A paint-less slot holding other controls (the action tray) is
        // layout, not chrome — the same rule the overlay's scan applies.
        const cs = getComputedStyle(el);
        if (
          el.childElementCount > 0 &&
          el.querySelector('[data-testid], [role="button"]') !== null &&
          (cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent') &&
          Number.parseFloat(cs.borderTopWidth) === 0
        )
          continue;
        const b = el.getBoundingClientRect();
        if (b.width < 8 || b.height < 8 || b.height > 100) continue;
        const ix = Math.max(0, Math.min(card.x + card.width, b.right) - Math.max(card.x, b.left));
        const iy = Math.max(0, Math.min(card.y + card.height, b.bottom) - Math.max(card.y, b.top));
        if (ix * iy === 0) continue;
        const whole = ix * iy >= b.width * b.height - 1;
        if (!whole)
          out.push(
            `${el.getAttribute('data-testid') ?? el.getAttribute('aria-label')} ${Math.round(b.top)}-${Math.round(b.bottom)}`,
          );
      }
      return out;
    }, cardBox!);
    expect(bisected, `strip ${JSON.stringify(cardBox)} bisects ${bisected.join(', ')}`).toEqual([]);
  });
});

const globalThis_layoutKind = (page: import('@playwright/test').Page) =>
  page.evaluate(() => globalThis.__MAHJONG_TEST_TUTORIAL_LAYOUT__?.placement.kind ?? 'none');

/**
 * Lesson-complete card on a landscape phone with the Drawn game result
 * panel up: the panel is not the step's target, so the centred card must
 * not sit over it — it docks into the free column beside the panel.
 */
test.describe('3D coach-marks: landscape lesson-complete card keeps off the result panel', () => {
  test.use({ viewport: { width: 915, height: 412 }, isMobile: true, hasTouch: true });
  test.setTimeout(90_000);
  test('the card docks beside the Drawn game panel', async ({ page }) => {
    await page.addInitScript(() => {
      (globalThis as { __MAHJONG_TEST_BOT_PACE_MS__?: number }).__MAHJONG_TEST_BOT_PACE_MS__ = 200;
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
    await page.evaluate(() => {
      const g = globalThis as { __MAHJONG_TEST_START_TUTORIAL__?: (id: string) => void };
      g.__MAHJONG_TEST_START_TUTORIAL__?.('drawn-game');
    });
    await expect(page.getByText('Drawn games')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('tutorial-next').click();
    await expect(page.getByText('Discard to start')).toBeVisible();
    await page.getByTestId('own-hand-tile').first().click();
    await expect(page.getByText('Lesson complete!')).toBeVisible({ timeout: 30_000 });
    const panel = page.locator('[data-tutorial-target="result-panel"]');
    await expect(panel).toHaveCount(1);
    const panelBox = await panel.boundingBox();
    expect(panelBox).not.toBeNull();
    await expect
      .poll(
        async () => {
          const card = await page.getByTestId('tutorial-card').boundingBox();
          if (!card) return 'missing';
          return intersects(card, panelBox!) ? `over panel ${JSON.stringify(card)}` : 'clear';
        },
        { timeout: 3_000 },
      )
      .toBe('clear');
    const card = await page.getByTestId('tutorial-card').boundingBox();
    expect(card!.width).toBeLessThanOrEqual(440);
    expect(card!.x + card!.width).toBeLessThanOrEqual(915 - 12 + 1);
  });
});
