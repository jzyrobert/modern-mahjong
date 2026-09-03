import { expect, test } from './_helpers';

/**
 * Three.js menu backdrop (`src/three/menu/`). Pins the 3D renderer,
 * loads the lobby at phone + desktop, and asserts the contract from
 * ARCHITECTURE.md §8: zero console / page errors, `__MAHJONG_PERF__`
 * published within the menu budget (≤ 20 draw calls, ≤ 80 k
 * triangles, ≤ 10 programs), the scene idles / throttles once the
 * intro has settled, and every DOM hit target the legacy lobby specs
 * rely on still exists over the canvas.
 */

interface PerfSnapshot {
  drawCalls: number;
  triangles: number;
  programs: number;
  textures: number;
  fps: number;
  idle: boolean;
  renders: number;
  sample: number;
}

const MENU_BUDGET = { drawCalls: 20, triangles: 80_000, programs: 10, textures: 10 };

function collectErrors(page: import('@playwright/test').Page): () => string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return () => errors;
}

async function readPerf(page: import('@playwright/test').Page): Promise<PerfSnapshot> {
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

// `_helpers` pins `classic` for the legacy suite; init scripts run in
// registration order, so this later assignment wins for these specs.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (globalThis as { __MAHJONG_TEST_RENDERER__?: string }).__MAHJONG_TEST_RENDERER__ = '3d';
  });
});

test.describe('three: menu backdrop', () => {
  test('phone: scene mounts behind the lobby within budget and keeps the DOM contract', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();

    // The 3D backdrop is mounted (lazy) and the canvas is present.
    await expect(page.getByTestId('lobby-backdrop-3d')).toBeAttached();
    await expect(page.getByTestId('menu-3d').locator('canvas')).toBeAttached({ timeout: 15_000 });

    const perf = await readPerf(page);
    expect(perf.drawCalls).toBeLessThanOrEqual(MENU_BUDGET.drawCalls);
    expect(perf.triangles).toBeLessThanOrEqual(MENU_BUDGET.triangles);
    expect(perf.programs).toBeLessThanOrEqual(MENU_BUDGET.programs);
    expect(perf.textures).toBeLessThanOrEqual(MENU_BUDGET.textures);

    // Legacy hit targets over the canvas.
    await expect(page.getByLabel('Match code')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join match' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Play vs bots' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit display name' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Tutorial' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Replays' })).toBeVisible();

    // Tutorial row expands into the lesson rail with the testIDs the
    // verifier's `startTutorial` step uses.
    await page.getByRole('button', { name: 'Tutorial' }).click();
    await expect(page.getByTestId('lesson-basics')).toBeVisible();
    await expect(page.getByLabel('Start Basics: a guided hand')).toBeVisible();

    expect(errors()).toEqual([]);
  });

  test('desktop: after the intro the loop throttles to a slow drift and the pointer wakes it', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
    await expect(page.getByTestId('menu-3d').locator('canvas')).toBeAttached({ timeout: 15_000 });

    // Let the intro settle (~1.5 s), then sample a full second with the
    // pointer still: the drift cadence caps renders well below 60 fps.
    await page.waitForTimeout(2200);
    const before = await readPerf(page);
    await page.waitForFunction(
      (s) =>
        ((globalThis as { __MAHJONG_PERF__?: { sample: number } }).__MAHJONG_PERF__?.sample ?? 0) >
        s,
      before.sample,
      { timeout: 5000 },
    );
    const settled = await readPerf(page);
    expect(settled.fps).toBeLessThanOrEqual(20);
    expect(settled.drawCalls).toBeLessThanOrEqual(MENU_BUDGET.drawCalls);
    expect(settled.triangles).toBeLessThanOrEqual(MENU_BUDGET.triangles);

    // Desktop lobby contract.
    await expect(page.getByRole('button', { name: 'Create new match' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Browse open lobbies' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Join LAN match' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open library' })).toBeVisible();
    await expect(page.getByLabel('Start Basics: a guided hand')).toBeVisible();

    expect(errors()).toEqual([]);
  });

  test('reduced motion: the scene renders once and then idles completely', async ({ page }) => {
    const errors = collectErrors(page);
    await page.addInitScript(() => {
      try {
        const key = 'mj.settings.v1';
        const cur = JSON.parse(localStorage.getItem(key) || '{}');
        localStorage.setItem(key, JSON.stringify({ ...cur, animations: false }));
      } catch {
        /* private mode */
      }
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await expect(page.getByTestId('menu-3d').locator('canvas')).toBeAttached({ timeout: 15_000 });
    await page.waitForTimeout(1500);
    const a = await readPerf(page);
    await page.waitForFunction(
      (s) =>
        ((globalThis as { __MAHJONG_PERF__?: { sample: number } }).__MAHJONG_PERF__?.sample ?? 0) >
        s,
      a.sample,
      { timeout: 5000 },
    );
    const b = await readPerf(page);
    expect(b.idle).toBe(true);
    expect(b.renders).toBe(a.renders);
    expect(errors()).toEqual([]);
  });

  test('classic renderer keeps the restyled lobby without a canvas', async ({ page }) => {
    await page.addInitScript(() => {
      (globalThis as { __MAHJONG_TEST_RENDERER__?: string }).__MAHJONG_TEST_RENDERER__ = 'classic';
    });
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
    await expect(page.getByTestId('lobby-backdrop-classic')).toBeAttached();
    await expect(page.locator('canvas')).toHaveCount(0);
    // The DOM hero fan fills the band the 3D scene would otherwise own.
    await expect(page.getByTestId('hero-fan')).toBeAttached();
  });
});
