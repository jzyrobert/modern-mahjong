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
        solid: boolean;
      }
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

  // Step 1 — dice ceremony, targeted caption.
  await expect(page.getByText('Opening dice')).toBeVisible();
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
  const cta3 = await page.getByTestId('tutorial-next').boundingBox();
  expect(cta3).not.toBeNull();
  expect(cta3!.y + cta3!.height).toBeLessThanOrEqual(vp!.height);

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
    // (tight top feather), and the hand halo opens onto the bottom edge
    // since the tiles run to it.
    const layout = await page.evaluate(() => globalThis.__MAHJONG_TEST_TUTORIAL_LAYOUT__);
    expect(layout?.placement.kind).toBe('above');
    expect(layout?.placement.overlapsChrome).toBe(false);
    expect(layout?.feather?.top).toBe(3);
    expect(haloBox.y + haloBox.height).toBeGreaterThanOrEqual(915 + 14);
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
    // the action row (round-4 critic, issue 3).
    const halo = (await page.getByTestId('tutorial-halo').boundingBox()) as Box;
    expect(halo.x).toBeGreaterThanOrEqual(12);
    expect(halo.x + halo.width).toBeLessThanOrEqual(915 - 12);
    expect(halo.y).toBeGreaterThanOrEqual(12);
    expect(halo.y + halo.height).toBeLessThanOrEqual(412 - 12);
    const hand = (await page.getByTestId('winning-hand').boundingBox()) as Box;
    expect(contains(halo, hand)).toBe(true);
    for (const tile of await page.getByTestId('own-hand-tile').all()) {
      const b = await tile.boundingBox();
      if (b) expect(intersects(halo, b)).toBe(false);
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
    await expect
      .poll(
        async () => {
          const c = await card.boundingBox();
          if (!c) return 'no card';
          const boxes = await Promise.all([...toggles, ...tiles].map((l) => l.boundingBox()));
          const cut = boxes.filter((b) => b && intersects(c, b));
          const layout = await page.evaluate(() => globalThis.__MAHJONG_TEST_TUTORIAL_LAYOUT__);
          return cut.length === 0 ? `clear:${layout?.placement.kind}` : `cuts ${cut.length}`;
        },
        { timeout: 5_000 },
      )
      .toBe('clear:center');
    const c = (await card.boundingBox()) as Box;
    expect(c.x).toBeGreaterThanOrEqual(12);
    expect(c.y).toBeGreaterThanOrEqual(12);
    expect(c.x + c.width).toBeLessThanOrEqual(915 - 12);
    expect(c.y + c.height).toBeLessThanOrEqual(412 - 12);
  });
});
