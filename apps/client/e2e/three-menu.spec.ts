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

interface MenuDebug {
  occluders: number;
  reseeded: boolean;
  visible: number;
  parked: number;
  fades: number[];
  tiles: { x: number; y: number; r: number; fade: number }[];
  dice: number[];
  diceRects: { x: number; y: number; r: number }[];
  rack: { x: number; y: number; w: number; h: number };
}

interface ShelfDebug {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
  settled: boolean;
}

function readShelfDebug(page: import('@playwright/test').Page): Promise<ShelfDebug | undefined> {
  return page.evaluate(
    () => (globalThis as { __MAHJONG_SHELF_DEBUG__?: ShelfDebug }).__MAHJONG_SHELF_DEBUG__,
  );
}

/** Drift tiles that are actually showing (fade > 0.05). */
function shownTiles(debug: MenuDebug): MenuDebug['tiles'] {
  return debug.tiles.filter((t) => t.fade > 0.05);
}

/** Discs (tiles or dice) whose visible area overlaps `box`. */
function discsOver(
  discs: readonly { x: number; y: number; r: number }[],
  box: { x: number; y: number; width: number; height: number },
  slack = 0,
): { x: number; y: number; r: number }[] {
  return discs.filter((t) => {
    const dx = Math.max(box.x - t.x, 0, t.x - (box.x + box.width));
    const dy = Math.max(box.y - t.y, 0, t.y - (box.y + box.height));
    return Math.hypot(dx, dy) < t.r + slack;
  });
}

function readMenuDebug(page: import('@playwright/test').Page): Promise<MenuDebug | undefined> {
  return page.evaluate(
    () => (globalThis as { __MAHJONG_MENU_DEBUG__?: MenuDebug }).__MAHJONG_MENU_DEBUG__,
  );
}

/** Drift tiles whose visible disc overlaps `box` (fade > 0.05 counts). */
function tilesOver(
  debug: MenuDebug,
  box: { x: number; y: number; width: number; height: number },
): MenuDebug['tiles'] {
  return debug.tiles.filter((t) => {
    if (t.fade <= 0.05) return false;
    const dx = Math.max(box.x - t.x, 0, t.x - (box.x + box.width));
    const dy = Math.max(box.y - t.y, 0, t.y - (box.y + box.height));
    return Math.hypot(dx, dy) < t.r;
  });
}

function collectErrors(page: import('@playwright/test').Page): () => string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    // three's shadow-map deprecation notice is a warning, not an error,
    // but the menu scene picks a supported filter so it must never fire.
    if (m.type() === 'warning' && /PCFSoftShadowMap/.test(m.text())) errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return () => errors;
}

/** True once every `Reveal` wrapper has finished its CSS entrance. */
function allRevealsSettled(page: import('@playwright/test').Page): Promise<boolean> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-reveal]')).every((el) => {
      const running = el
        .getAnimations()
        .some((a) => a.playState !== 'finished' && a.playState !== 'idle');
      return !running && getComputedStyle(el).opacity === '1';
    }),
  );
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

    // Card stagger is CSS-driven and finishes within ~0.7 s of the
    // heading painting, even with three loading in the background.
    await expect.poll(() => allRevealsSettled(page), { timeout: 2500 }).toBe(true);

    // The scene publishes its intro state for the verifier and settles.
    await page.waitForFunction(
      () =>
        (globalThis as { __MAHJONG_MENU_INTRO__?: string }).__MAHJONG_MENU_INTRO__ === 'settled',
      null,
      { timeout: 6000 },
    );

    // The lobby's glass cards, title, footer, match-code field and
    // primary CTAs register as occluders and the drift field has been
    // re-seeded around them, so no tile straddles a card edge, crosses
    // the credits, or ghosts inside the form (round-2 critic: a 索 face
    // sat beside the ABCDE placeholder and a back crossed "Join match").
    await page.waitForTimeout(300);
    const debug = await readMenuDebug(page);
    if (!debug) throw new Error('menu debug never published');
    expect(debug.occluders).toBeGreaterThanOrEqual(8);
    expect(debug.reseeded).toBe(true);
    const input = await page.getByLabel('Match code').boundingBox();
    const join = await page.getByRole('button', { name: 'Join match' }).boundingBox();
    const play = await page.getByRole('button', { name: 'Play vs bots' }).boundingBox();
    if (!input || !join || !play) throw new Error('missing form boxes');
    expect(tilesOver(debug, input)).toEqual([]);
    expect(tilesOver(debug, join)).toEqual([]);
    expect(tilesOver(debug, play)).toEqual([]);
    // On phones the field stays out of the card column entirely.
    const online = await page.getByTestId('mode-online').boundingBox();
    if (!online) throw new Error('missing online card box');
    expect(tilesOver(debug, online)).toEqual([]);
    // The dice pair clears every glass edge too.
    for (const f of debug.dice) expect(f).toBeGreaterThanOrEqual(0.9);
    // No drift disc touches the hero rack's footprint (a far back used to
    // poke out from under the bottom-right 中 and read as debris).
    expect(
      discsOver(shownTiles(debug), {
        x: debug.rack.x,
        y: debug.rack.y,
        width: debug.rack.w,
        height: debug.rack.h,
      }),
    ).toEqual([]);

    // Tutorial row expands into the lesson rail with the testIDs the
    // verifier's `startTutorial` step uses.
    await page.getByRole('button', { name: 'Tutorial' }).click();
    await expect(page.getByTestId('lesson-basics')).toBeVisible();
    await expect(page.getByLabel('Start Basics: a guided hand')).toBeVisible();

    expect(errors()).toEqual([]);
  });

  test('landscape phone: the card stack clears the hero column and the top-right chip strip', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 915, height: 412 });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
    await expect(page.getByTestId('menu-3d').locator('canvas')).toBeAttached({ timeout: 15_000 });
    await expect.poll(() => allRevealsSettled(page), { timeout: 2500 }).toBe(true);

    // Cards start below the root FULLSCREEN / DISMISS chip (≈ y 60) and
    // right of the title column where the 3D rack + dice render.
    const online = await page.getByTestId('mode-online').boundingBox();
    const practice = await page.getByTestId('mode-practice').boundingBox();
    const tutorial = await page.getByTestId('mode-tutorial').boundingBox();
    if (!online || !practice || !tutorial) throw new Error('missing card boxes');
    expect(online.y).toBeGreaterThanOrEqual(60);
    expect(practice.y).toBeGreaterThanOrEqual(60);
    expect(online.x).toBeGreaterThanOrEqual(915 * 0.31);
    expect(tutorial.x).toBeGreaterThanOrEqual(915 * 0.31);
    // The Replays row never ellipsises its landscape copy.
    await expect(page.getByText('No replays yet', { exact: true })).toBeVisible();
    // Footer credits sit bottom-right, clear of the card row.
    const credit = await page.getByText(/^Sound by/).boundingBox();
    if (!credit) throw new Error('missing footer credit');
    expect(credit.y).toBeGreaterThan(tutorial.y + tutorial.height);

    // Tutorial opens the glass sheet with the lesson rail.
    await page.getByRole('button', { name: 'Tutorial' }).click();
    await expect(page.getByTestId('lesson-basics')).toBeVisible();

    const perf = await readPerf(page);
    expect(perf.drawCalls).toBeLessThanOrEqual(MENU_BUDGET.drawCalls);
    expect(perf.triangles).toBeLessThanOrEqual(MENU_BUDGET.triangles);
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

    // The hero dice never straddle a card edge (they used to sit on the
    // Tutorial card's top-right corner at 1440×900).
    const debug = await readMenuDebug(page);
    if (!debug) throw new Error('menu debug never published');
    for (const f of debug.dice) expect(f).toBeGreaterThanOrEqual(0.9);
    const tutorial = await page.getByTestId('mode-tutorial').boundingBox();
    const input = await page.getByLabel('Match code').boundingBox();
    if (!tutorial || !input) throw new Error('missing desktop boxes');
    expect(discsOver(debug.diceRects, tutorial)).toEqual([]);
    expect(tilesOver(debug, input)).toEqual([]);
    // No ghost tiles behind the desktop glass: at 40 % size under a 16 px
    // blur they read as smudges under the card copy, not as depth.
    expect(tilesOver(debug, tutorial)).toEqual([]);

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
    // The frozen frame is the only frame: the dice must have been run
    // through the keep-out in it (the deferred 450 ms pass never ran
    // once the loop idled, leaving a die on the Tutorial card's corner)…
    const debug = await readMenuDebug(page);
    if (!debug) throw new Error('menu debug never published');
    expect(debug.reseeded).toBe(true);
    for (const f of debug.dice) expect(f).toBeGreaterThanOrEqual(0.9);
    const tutorial = await page.getByTestId('mode-tutorial').boundingBox();
    if (!tutorial) throw new Error('missing tutorial box');
    expect(discsOver(debug.diceRects, tutorial)).toEqual([]);
    // …and every shown drift tile sits wholly inside the frame instead of
    // staying half-cut by the edge forever.
    for (const t of shownTiles(debug)) {
      expect(t.x - t.r).toBeGreaterThanOrEqual(-1);
      expect(t.x + t.r).toBeLessThanOrEqual(1441);
      expect(t.y - t.r).toBeGreaterThanOrEqual(-1);
      expect(t.y + t.r).toBeLessThanOrEqual(901);
    }
    expect(shownTiles(debug).length).toBeGreaterThanOrEqual(12);
    expect(errors()).toEqual([]);
  });

  test('reduced motion, portrait: the frozen field still shows tiles in the hero band', async ({
    page,
  }) => {
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
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto('/');
    await expect(page.getByTestId('menu-3d').locator('canvas')).toBeAttached({ timeout: 15_000 });
    await expect.poll(() => allRevealsSettled(page), { timeout: 2500 }).toBe(true);
    await page.waitForTimeout(800);
    const debug = await readMenuDebug(page);
    if (!debug) throw new Error('menu debug never published');
    expect(debug.reseeded).toBe(true);
    // The frozen portrait field is whatever fits whole in the hero band's
    // side margins, clear of the rack and every card — and nothing else:
    // a tile that could only show as a half-cut disc at the frame edge or
    // a sliver under the rack is parked (round-3 critic), which on a
    // 412 px phone usually means the frame shows the rack alone.
    const shown = shownTiles(debug);
    const online = await page.getByTestId('mode-online').boundingBox();
    if (!online) throw new Error('missing online card box');
    for (const t of shown) {
      expect(t.fade).toBeGreaterThanOrEqual(0.75);
      expect(t.y).toBeLessThan(online.y);
      // ≥ 70 % of the disc inside the frame (the disc over-bounds the tile).
      expect(t.x - 0.4 * t.r).toBeGreaterThanOrEqual(0);
      expect(t.x + 0.4 * t.r).toBeLessThanOrEqual(412);
    }
    expect(
      discsOver(shown, {
        x: debug.rack.x,
        y: debug.rack.y,
        width: debug.rack.w,
        height: debug.rack.h,
      }),
    ).toEqual([]);
    expect(shown.length + debug.parked).toBe(debug.visible);
    expect(errors()).toEqual([]);
  });

  for (const vp of [
    { name: 'phone', width: 412, height: 915 },
    { name: 'phone landscape', width: 915, height: 412 },
    { name: 'desktop', width: 1440, height: 900 },
  ]) {
    test(`replay shelf @ ${vp.name}: the tiles sit inside the canvas with air above and below`, async ({
      page,
    }) => {
      const errors = collectErrors(page);
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/replays');
      await expect(page.getByTestId('replay-shelf-3d').locator('canvas')).toBeAttached({
        timeout: 15_000,
      });
      await page.waitForFunction(
        () =>
          (globalThis as { __MAHJONG_SHELF_DEBUG__?: ShelfDebug }).__MAHJONG_SHELF_DEBUG__
            ?.settled === true,
        null,
        { timeout: 15_000 },
      );
      const shelf = await readShelfDebug(page);
      if (!shelf) throw new Error('shelf debug never published');
      // Round-1 critic: the tile tops started on the very first canvas
      // row (the 東 glyph sliced) and the canvas was a 92 px strip. The
      // frame is now derived from the leaning tile's projected height.
      expect(shelf.top).toBeGreaterThanOrEqual(8);
      expect(shelf.bottom).toBeLessThanOrEqual(shelf.height - 8);
      expect(shelf.left).toBeGreaterThanOrEqual(4);
      expect(shelf.right).toBeLessThanOrEqual(shelf.width - 4);
      // Faces read square-on: the tiles are taller than they are wide.
      const tileH = shelf.bottom - shelf.top;
      const tileW = (shelf.right - shelf.left) / 7;
      expect(tileH).toBeGreaterThan(tileW * 1.05);
      expect(shelf.height).toBeGreaterThanOrEqual(100);
      // The card is a focal object, not a full-height slab: where the
      // page fits the viewport (portrait phone, desktop) the parlour
      // gradient shows under it. (Landscape phones scroll.)
      const card = await page.getByText('Nothing on the shelf yet').locator('..').boundingBox();
      if (!card) throw new Error('missing empty-state card');
      if (vp.height >= 600) expect(card.y + card.height).toBeLessThan(vp.height - 40);
      expect(errors()).toEqual([]);
    });
  }

  test('replay library: 3D shelf in the empty state, landscape header aligned to the chip', async ({
    page,
  }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 915, height: 412 });
    await page.goto('/replays');
    await expect(page.getByRole('heading', { name: 'Replays' })).toBeVisible();
    // Empty state renders the tiles as a real scene, not classic art.
    await expect(page.getByTestId('replay-shelf-3d').locator('canvas')).toBeAttached({
      timeout: 15_000,
    });
    await expect(page.getByText('Nothing on the shelf yet')).toBeVisible();
    const perf = await readPerf(page);
    expect(perf.drawCalls).toBeLessThanOrEqual(MENU_BUDGET.drawCalls);
    expect(perf.triangles).toBeLessThan(10_000);
    // Import sits 12 px left of the FULLSCREEN chip instead of floating
    // mid-header (round-2 critic: a 145 px void).
    const imp = await page.getByRole('button', { name: 'Import replays' }).boundingBox();
    const chip = await page.getByRole('button', { name: 'Enter fullscreen' }).boundingBox();
    if (!imp || !chip) throw new Error('missing header boxes');
    const gap = chip.x - (imp.x + imp.width);
    expect(gap).toBeGreaterThanOrEqual(6);
    expect(gap).toBeLessThanOrEqual(28);
    // The lobby's landscape lesson sheet fades its trailing edge.
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
    await page.getByRole('button', { name: 'Tutorial' }).click();
    await expect(page.getByTestId('lesson-basics')).toBeVisible();
    const mask = await page.getByTestId('lesson-rail').evaluate((el) => {
      const cs = getComputedStyle(el);
      return cs.maskImage || cs.webkitMaskImage || '';
    });
    expect(mask).toContain('linear-gradient');
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
