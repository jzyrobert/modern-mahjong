import { type Page, expect, test } from '@playwright/test';

/**
 * Three.js replay player (`src/three/replay/` + `src/ui/replay/Glass*`).
 * Pins the 3D renderer, seeds the library with the deterministic fixture
 * (`__MAHJONG_TEST_REPLAY_FIXTURE__`, `src/replay/fixture.ts`) and asserts
 * ARCHITECTURE.md §8's invariants on the player: a WebGL table inside the
 * in-game budget (§4), zero console / page errors, glass chrome with no
 * paper surface, and the scrubber / point-of-view controls driving the
 * frame. The filled library and its glass delete confirmation are
 * covered too. Runs on SwiftShader in CI, so it gates on draw calls /
 * triangles / programs, never on fps.
 */
const BUDGET = { drawCalls: 40, triangles: 150_000, programs: 12 };
const FIXTURE = 'replay-fixture-5';
/** Visible frames in the seed-5 two-hand fixture (`fixture.test.ts` pins the record). */
const TOTAL_FRAMES = 190;

interface PerfSnapshot {
  drawCalls: number;
  triangles: number;
  programs: number;
  sample: number;
}

interface DebugSnapshot {
  flights: number;
  tiles: { id: number; zone: string | null }[];
  /** What the latest `sync` did (see `ReplayTable3D`). */
  lastSync: { snapped: boolean; flights: number } | null;
}

/** Paper / classic surface colours that must not appear under the 3D flow. */
const PAPER_BACKGROUNDS = [
  'rgb(241, 234, 220)',
  'rgb(255, 255, 255)',
  'rgb(251, 248, 240)',
  'rgba(255, 255, 255, 0.94)',
  'rgba(255, 255, 255, 0.92)',
  'rgba(251, 248, 240, 0.94)',
];

test.setTimeout(90_000);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    (globalThis as { __MAHJONG_TEST_RENDERER__?: '3d' | 'classic' }).__MAHJONG_TEST_RENDERER__ =
      '3d';
    // Wipe leftover replays once per context — init scripts re-run on
    // every navigation, and the seeded fixture must survive the `goto`
    // that follows it.
    try {
      if (!sessionStorage.getItem('mj.e2e.replays-cleared')) {
        const keys: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k?.startsWith('mj.replay.v1.')) keys.push(k);
        }
        for (const k of keys) localStorage.removeItem(k);
        sessionStorage.setItem('mj.e2e.replays-cleared', '1');
      }
    } catch {
      /* private mode */
    }
  });
});

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

/** Save the two fixture matches from the library page (where the hatch lives). */
async function seedLibrary(page: Page) {
  await page.goto('/replays');
  await expect(page.getByRole('heading', { name: 'Replays' })).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => {
    const build = (
      globalThis as {
        __MAHJONG_TEST_REPLAY_FIXTURE__?: (o: Record<string, unknown>) => string;
      }
    ).__MAHJONG_TEST_REPLAY_FIXTURE__;
    if (!build) throw new Error('replay fixture hatch missing');
    build({ seed: 5, hands: 2 });
    build({ seed: 11, hands: 1, startedAt: Date.now() - 3 * 86_400_000 });
  });
}

async function debug(page: Page): Promise<DebugSnapshot | null> {
  return page.evaluate(
    () =>
      (
        globalThis as { __MAHJONG_REPLAY_3D_DEBUG__?: () => DebugSnapshot | null }
      ).__MAHJONG_REPLAY_3D_DEBUG__?.() ?? null,
  );
}

/** Every tile of the frame has landed. */
async function waitSettled(page: Page) {
  await expect.poll(async () => (await debug(page))?.flights ?? -1, { timeout: 30_000 }).toBe(0);
}

async function openPlayer(page: Page, query = '') {
  await page.goto(`/replays/${FIXTURE}${query}`);
  const player = page.getByTestId('replay-player');
  await expect(player).toBeVisible({ timeout: 20_000 });
  await expect(player).toHaveAttribute('data-theme', 'glass');
  // Generous: the scene builds the face atlas on the CPU and a loaded CI
  // shard renders it at a frame or two per second.
  await expect(page.locator('[data-testid="replay-table-3d"] canvas')).toBeAttached({
    timeout: 30_000,
  });
  await expect(page.getByTestId('scene-veil')).toHaveCount(0, { timeout: 30_000 });
  await waitSettled(page);
}

async function readPerf(page: Page): Promise<PerfSnapshot> {
  await page.waitForFunction(
    () =>
      ((globalThis as { __MAHJONG_PERF__?: { sample: number } }).__MAHJONG_PERF__?.sample ?? 0) >=
      2,
    null,
    { timeout: 20_000 },
  );
  return page.evaluate(
    () => (globalThis as { __MAHJONG_PERF__?: PerfSnapshot }).__MAHJONG_PERF__ as PerfSnapshot,
  );
}

function expectBudget(perf: PerfSnapshot) {
  expect(perf.drawCalls, 'draw calls').toBeLessThanOrEqual(BUDGET.drawCalls);
  expect(perf.triangles, 'triangles').toBeLessThanOrEqual(BUDGET.triangles);
  expect(perf.programs, 'programs').toBeLessThanOrEqual(BUDGET.programs);
}

/** Elements under `rootTestId` painted in a paper / classic background. */
async function paperSurfaces(page: Page, rootTestId: string): Promise<string[]> {
  return page.evaluate(
    ([id, paper]) => {
      const root = document.querySelector(`[data-testid="${id}"]`);
      if (!root) return ['<no root>'];
      const bad: string[] = [];
      const set = new Set(paper);
      for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
        const bg = getComputedStyle(el).backgroundColor;
        if (set.has(bg))
          bad.push(`${el.tagName} ${(el as HTMLElement).dataset.testid ?? ''} ${bg}`);
      }
      return bad;
    },
    [rootTestId, PAPER_BACKGROUNDS] as const,
  );
}

test('phone: the 3D table mounts within budget under glass chrome', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 700 });
  const errors = collectErrors(page);
  await seedLibrary(page);
  await openPlayer(page, '?frame=100');

  await expect(page.getByTestId('replay-player')).toHaveAttribute(
    'data-viewport',
    'phone-portrait',
  );
  await expect(page.getByTestId('replay-status-pill')).toBeVisible();
  await expect(page.getByTestId('replay-seat-strip').locator('[aria-label]')).toHaveCount(3);
  await expect(page.getByTestId('replay-dock')).toBeVisible();
  await expect(page.getByLabel('Replay timeline')).toBeVisible();
  await expect(page.getByTestId('replay-frame-counter')).toHaveText(`100/${TOTAL_FRAMES}`);
  // The frame's tiles are on the table: a full river late in hand 1.
  const snap = (await debug(page))!;
  expect(snap.tiles.filter((t) => t.zone === 'discard').length).toBeGreaterThanOrEqual(36);
  expect(snap.tiles.filter((t) => t.zone === 'meld').length).toBeGreaterThan(0);

  expect(await paperSurfaces(page, 'replay-route-glass')).toEqual([]);
  expectBudget(await readPerf(page));
  expect(errors, 'console / page errors').toEqual([]);
});

test('desktop: scrubbing springs the tiles and the point of view re-seats the camera', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const errors = collectErrors(page);
  await seedLibrary(page);
  await openPlayer(page, '?frame=100');

  const player = page.getByTestId('replay-player');
  await expect(player).toHaveAttribute('data-viewport', 'desktop');
  await expect(page.getByTestId('replay-events')).toBeVisible();
  await expect(page.getByTestId('replay-footer')).toBeVisible();
  await expect(page.getByTestId('replay-frame-counter')).toHaveText(`100/${TOTAL_FRAMES}`);

  // Step forward: the cursor advances and the sync put the moved tile in
  // flight (a spring, never a snap) — read from the sync record, not
  // the live poses, so a slow shard can't outrun the tween.
  await page.getByLabel('Step forward').click();
  await expect(player).toHaveAttribute('data-cursor', '100');
  await expect(page.getByTestId('replay-frame-counter')).toHaveText(`101/${TOTAL_FRAMES}`);
  const stepped = (await debug(page))!.lastSync!;
  expect(stepped.snapped).toBe(false);
  expect(stepped.flights).toBeGreaterThan(0);
  await waitSettled(page);

  // Point of view: the camera sits behind seat 2 (西) and the far seat's
  // badge is now the local player's.
  await page.getByLabel('POV W').click();
  await expect(player).toHaveAttribute('data-pov', '2');
  await waitSettled(page);
  await expect(page.getByTestId('replay-you-badge')).toContainText('Kwok Fai');
  const hand = (await debug(page))!.tiles.filter((t) => t.zone === 'hand').length;
  expect(hand).toBeGreaterThanOrEqual(1);
  expect(hand).toBeLessThanOrEqual(14);

  // Chapter tap seeks; the end frame reveals every hand.
  await page.goto(`/replays/${FIXTURE}?frame=end`);
  await expect(page.getByTestId('replay-frame-counter')).toHaveText(
    `${TOTAL_FRAMES}/${TOTAL_FRAMES}`,
    { timeout: 20_000 },
  );
  await waitSettled(page);
  await expect(page.getByLabel('Step forward')).toBeDisabled();

  expect(await paperSurfaces(page, 'replay-route-glass')).toEqual([]);
  expectBudget(await readPerf(page));
  expect(errors, 'console / page errors').toEqual([]);
});

test('landscape: the chrome cluster keeps clear of the fullscreen prompt', async ({ page }) => {
  await page.setViewportSize({ width: 915, height: 412 });
  const errors = collectErrors(page);
  await seedLibrary(page);
  await openPlayer(page, '?frame=100');
  await expect(page.getByTestId('replay-player')).toHaveAttribute(
    'data-viewport',
    'phone-landscape',
  );
  await expect(page.getByTestId('replay-footer')).toBeVisible();
  const del = await page.getByTestId('replay-delete').boundingBox();
  expect(del).not.toBeNull();
  // The root FullscreenPrompt owns the top-right 124 px pill + margins.
  expect(del!.x + del!.width).toBeLessThanOrEqual(915 - 124 - 8);
  expectBudget(await readPerf(page));
  expect(errors, 'console / page errors').toEqual([]);
});

test('reduced motion: a step snaps the frame instead of tweening', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 700 });
  const errors = collectErrors(page);
  await seedLibrary(page);
  await page.evaluate(() => {
    (
      globalThis as {
        __MAHJONG_TEST_GET_STATE__?: () => {
          setSettings: (p: Record<string, unknown>) => void;
        };
      }
    )
      .__MAHJONG_TEST_GET_STATE__?.()
      .setSettings({ animations: false });
  });
  await openPlayer(page, '?frame=100');
  await page.getByLabel('Step forward').click();
  await expect(page.getByTestId('replay-frame-counter')).toHaveText(`101/${TOTAL_FRAMES}`);
  const stepped = (await debug(page))!.lastSync!;
  expect(stepped.snapped).toBe(true);
  expect(stepped.flights).toBe(0);
  expect(errors, 'console / page errors').toEqual([]);
});

test('library: filled rows are glass and delete confirms in a glass sheet', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 700 });
  const errors = collectErrors(page);
  await seedLibrary(page);
  await page.goto('/replays');
  const rows = page.getByRole('button', { name: /^Open replay from / });
  await expect(rows).toHaveCount(2, { timeout: 20_000 });
  const bg = await rows.first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe('rgba(14, 20, 17, 0.62)');
  await expect(page.getByText('SOLO', { exact: true }).first()).toBeVisible();

  await page.getByRole('button', { name: 'Delete replay' }).first().click();
  await expect(page.getByText('Delete replay?')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByText('Delete replay?')).toHaveCount(0);
  await expect(rows).toHaveCount(2);
  await page.getByRole('button', { name: 'Delete replay' }).first().click();
  await page.getByRole('button', { name: /^Delete$/ }).click();
  await expect(rows).toHaveCount(1);

  // Not-found fallback: glass card on the void, never cream.
  await page.goto('/replays/does-not-exist');
  await expect(page.getByRole('heading', { name: 'Replay not found' })).toBeVisible({
    timeout: 20_000,
  });
  expect(await paperSurfaces(page, 'replay-not-found')).toEqual([]);
  await page.getByRole('button', { name: 'Back to library' }).click();
  await expect(page.getByRole('heading', { name: 'Replays' })).toBeVisible();
  expect(errors, 'console / page errors').toEqual([]);
});
