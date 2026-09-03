import { type Page, expect, test } from '@playwright/test';

/**
 * Three.js in-game table (`src/three/table/`). Pins the 3D renderer,
 * drives a solo match to the user's first turn and asserts the
 * invariants ARCHITECTURE.md §8 lists: no console / page errors, the
 * perf snapshot inside the in-game budget (§4), and the DOM hit-targets
 * the legacy suite relies on (`own-hand-tile`, `wall-draw-next`) still
 * driving the engine. Runs on SwiftShader in CI, so it gates on the
 * device-independent numbers (draw calls / triangles / programs), never
 * on fps.
 */
const BUDGET = { drawCalls: 40, triangles: 150_000, programs: 12 };

interface PerfSnapshot {
  drawCalls: number;
  triangles: number;
  programs: number;
  sample: number;
  quality: string;
}

/**
 * The opening-rolls ceremony auto-dismisses after a beat; clicking its
 * hint text races that (the element detaches mid-click and Playwright
 * retries until the test times out), so tap the viewport instead and
 * wait for the overlay to go.
 */
async function dismissDice(page: Page) {
  const hint = page.getByText('Tap anywhere to dismiss', { exact: true });
  if (await hint.isVisible({ timeout: 4000 }).catch(() => false)) {
    const vp = page.viewportSize() ?? { width: 1280, height: 720 };
    await page.mouse.click(vp.width / 2, vp.height / 2);
    await expect(hint).toBeHidden({ timeout: 10_000 });
  }
}

async function startSolo(page: Page, errors: string[]) {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Start match' }).click({ timeout: 20_000 });
  await dismissDice(page);
  await expect(page.getByTestId('table-3d')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('own-hand-tile').first()).toBeVisible({ timeout: 20_000 });
}

async function readPerf(page: Page): Promise<PerfSnapshot> {
  await page.waitForFunction(
    () =>
      ((globalThis as { __MAHJONG_PERF__?: { sample: number } }).__MAHJONG_PERF__?.sample ?? 0) >=
      2,
    null,
    { timeout: 15_000 },
  );
  return page.evaluate(
    () => (globalThis as { __MAHJONG_PERF__?: PerfSnapshot }).__MAHJONG_PERF__ as PerfSnapshot,
  );
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const g = globalThis as {
      __MAHJONG_TEST_RENDERER__?: '3d' | 'classic';
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

test('3D table mounts within budget with the classic hit-targets', async ({ page }) => {
  const errors: string[] = [];
  await startSolo(page, errors);

  // Seed 5 deals the user as dealer with 14 tiles — one projected
  // button per concealed tile, each with an accessible tile name.
  const tiles = page.getByTestId('own-hand-tile');
  await expect(tiles).toHaveCount(14);
  const label = await tiles.first().getAttribute('aria-label');
  expect(label).toMatch(/(man|pin|sou|wind|dragon)/);
  const box = await tiles.first().boundingBox();
  expect(box, 'hit-target has a projected rect').not.toBeNull();
  expect(box!.height).toBeGreaterThanOrEqual(44);

  // HUD chrome the tutorial + menu specs anchor to.
  await expect(page.getByTestId('open-settings')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeVisible();
  await expect(page.getByText(/\d+ left/i)).toBeVisible();

  const perf = await readPerf(page);
  expect(perf.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
  expect(perf.triangles).toBeLessThanOrEqual(BUDGET.triangles);
  expect(perf.programs).toBeLessThanOrEqual(BUDGET.programs);
  expect(errors, 'console / page errors').toEqual([]);
});

test('tapping a hand tile discards it and the wall cue draws', async ({ page }) => {
  const errors: string[] = [];
  await startSolo(page, errors);
  const before = await page.evaluate(() => {
    const s = (
      globalThis as {
        __MAHJONG_TEST_GET_STATE__?: () => { state: { discards: Record<number, unknown[]> } };
      }
    ).__MAHJONG_TEST_GET_STATE__?.();
    return s?.state.discards[0]?.length ?? -1;
  });
  expect(before).toBe(0);

  // Let the dispense settle so the hit-target rects are stable.
  await page.waitForTimeout(1500);
  await page.getByTestId('own-hand-tile').first().click();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const s = (
            globalThis as {
              __MAHJONG_TEST_GET_STATE__?: () => {
                state: { discards: Record<number, unknown[]> };
              };
            }
          ).__MAHJONG_TEST_GET_STATE__?.();
          return s?.state.discards[0]?.length ?? -1;
        }),
      { timeout: 10_000 },
    )
    .toBe(1);

  // Bots play out (zero pacing), then the user's draw cue appears on
  // the next wall tile; clicking it dispatches `{ t: 'draw' }`.
  const start = Date.now();
  while (Date.now() - start < 30_000) {
    if (
      await page
        .getByTestId('wall-draw-next')
        .isVisible()
        .catch(() => false)
    )
      break;
    if (
      await page
        .getByText('CLAIM?', { exact: true })
        .isVisible()
        .catch(() => false)
    ) {
      await page
        .getByText('Pass', { exact: true })
        .first()
        .click({ timeout: 2000 })
        .catch(() => {});
    }
    await page.waitForTimeout(200);
  }
  const cue = page.getByTestId('wall-draw-next');
  await expect(cue).toBeVisible();
  await expect(cue).toHaveAccessibleName('Draw next tile');
  await cue.click();
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const s = (
            globalThis as {
              __MAHJONG_TEST_GET_STATE__?: () => { state: { hasDrawn: boolean; turn: number } };
            }
          ).__MAHJONG_TEST_GET_STATE__?.();
          return s ? `${s.state.turn}:${s.state.hasDrawn}` : '';
        }),
      { timeout: 10_000 },
    )
    .toBe('0:true');
  await expect(page.getByTestId('own-hand-tile')).toHaveCount(14);
  expect(errors, 'console / page errors').toEqual([]);
});

test('debug tile sheet renders every face with no errors', async ({ page }) => {
  await page.addInitScript(() => {
    (globalThis as { __MAHJONG_DEBUG_TILE_SHEET__?: boolean }).__MAHJONG_DEBUG_TILE_SHEET__ = true;
  });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Start match' }).click({ timeout: 20_000 });
  await dismissDice(page);
  await expect(page.getByTestId('table-3d-scene')).toBeVisible({ timeout: 20_000 });
  const snapshot = await page.evaluate(() => {
    const dbg = (
      globalThis as {
        __MAHJONG_TABLE_3D_DEBUG__?: () => { tiles: { zone: string | null; id: number }[] } | null;
      }
    ).__MAHJONG_TABLE_3D_DEBUG__?.();
    return dbg?.tiles.filter((t) => t.zone === 'sheet').map((t) => t.id >> 2) ?? [];
  });
  expect(new Set(snapshot).size).toBe(34);
  const perf = await readPerf(page);
  expect(perf.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
  expect(errors).toEqual([]);
});
