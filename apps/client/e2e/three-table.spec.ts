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
  // `isVisible` does not wait; give the modal a moment to mount first.
  await hint.waitFor({ timeout: 6000 }).catch(() => {});
  if (await hint.isVisible().catch(() => false)) {
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

// SwiftShader renders the table at a few fps, so actionability waits
// and bot turns take real wall-clock time on CI shards.
test.setTimeout(60_000);

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

test('the opening rolls wear the glass language and the lobby keeps a scene', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click({ timeout: 20_000 });
  // Pre-game lobby: glass waiting room over the waiting table (walls
  // built, same TableScene the match mounts).
  await expect(page.getByTestId('lobby-3d')).toBeVisible();
  await expect(page.getByTestId('lobby-3d-backdrop')).toBeAttached();
  // Generous: the lobby scene builds the face atlas on the CPU and a
  // loaded CI shard renders it at a frame or two per second.
  await expect(page.getByTestId('lobby-table-3d')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Start match' }).click({ timeout: 30_000 });
  // Every match opens with the dice modal; under the 3D renderer it is
  // the dark-glass panel (micro-label, ivory dice), never the paper card.
  const glass = page.getByTestId('dice-ceremony-glass');
  await expect(glass).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('dice-ceremony-paper')).toHaveCount(0);
  await expect(glass.getByText('Opening rolls')).toBeVisible();
  await expect(glass.getByText('Tap anywhere to dismiss', { exact: true })).toBeVisible();
  await dismissDice(page);
  await expect(page.getByTestId('own-hand-tile').first()).toBeVisible({ timeout: 20_000 });
  expect(errors, 'console / page errors').toEqual([]);
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
  // Desktop footer: the sort control is pinned to the right so the
  // claim strip can take the centre slot under the hand.
  const vp = page.viewportSize()!;
  if (vp.width >= 768 && vp.height >= 600) {
    const sort = (await page.getByRole('button', { name: 'Sort by Suit' }).boundingBox())!;
    expect(sort.x).toBeGreaterThan(vp.width * 0.6);
    expect(sort.y + sort.height).toBeGreaterThan(box!.y + box!.height);
  }

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

test('phone portrait holds the hand near the camera at ≥ 44 px per tile', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  const errors: string[] = [];
  await startSolo(page, errors);
  await page.waitForTimeout(1800);
  await expect(page.getByTestId('table-3d')).toHaveAttribute(
    'data-viewport-class',
    'phone-portrait',
  );
  // Every own-hand hit-target is at least 44 CSS px wide and the 14
  // tiles occupy two rows (the held hand splits 7 + 7).
  const tiles = page.getByTestId('own-hand-tile');
  await expect(tiles).toHaveCount(14);
  const boxes = await tiles.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }),
  );
  for (const b of boxes) {
    expect(b.width).toBeGreaterThanOrEqual(44);
    expect(b.height).toBeGreaterThanOrEqual(44);
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.left + b.width).toBeLessThanOrEqual(412);
  }
  const rows = new Set(boxes.map((b) => Math.round(b.top / 20)));
  expect(rows.size).toBe(2);
  // Seat strip under the chrome carries the three opponents.
  const strip = page.getByTestId('seat-strip');
  await expect(strip).toBeVisible();
  const stripBox = (await strip.boundingBox())!;
  expect(stripBox.y).toBeLessThan(120);
  // The hand sits below the table band: the strip and the hand never overlap.
  expect(Math.min(...boxes.map((b) => b.top))).toBeGreaterThan(stripBox.y + stripBox.height);
  // The action tray sits between the hand and the footer: the turn chip
  // (it is the user's turn — dealer) reads "Your turn · discard" below
  // every hand tile and above the sort control; the chrome pill carries
  // no turn chip on portrait.
  const chip = page.getByTestId('turn-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText(/your turn · discard/i);
  const chipBox = (await chip.boundingBox())!;
  const handBottom = Math.max(...boxes.map((b) => b.top + b.height));
  expect(chipBox.y).toBeGreaterThanOrEqual(handBottom);
  const sortBox = (await page.getByRole('button', { name: 'Sort by Suit' }).boundingBox())!;
  expect(chipBox.y + chipBox.height).toBeLessThanOrEqual(sortBox.y);
  expect(chipBox.height).toBeGreaterThanOrEqual(36);
  await expect(page.getByLabel('Open players panel').getByText(/discard/i)).toHaveCount(0);
  // The tray's resting readout under the turn chip: before the first
  // discard it names the dealer who opens (the user, seed 5) and the
  // prevailing wind; it never overlaps the chip or the footer.
  const tableChip = page.getByTestId('table-chip');
  await expect(tableChip).toBeVisible();
  await expect(tableChip).toHaveAttribute('aria-label', /You open · 東 round/);
  const tableChipBox = (await tableChip.boundingBox())!;
  expect(tableChipBox.y).toBeGreaterThanOrEqual(chipBox.y + chipBox.height);
  expect(tableChipBox.y + tableChipBox.height).toBeLessThanOrEqual(sortBox.y);

  // River zoom: tapping the discards region eases the camera into the
  // river block; the hand stays put (same hit-target rects, within a
  // few px) and the exit pill brings the full table back.
  const table = page.getByTestId('table-3d');
  await expect(table).toHaveAttribute('data-river-zoom', 'false');
  const region = page.getByTestId('shared-discards-region');
  await expect(region).toHaveAccessibleName('Zoom into the discards');
  await region.click();
  await expect(table).toHaveAttribute('data-river-zoom', 'true');
  // The exit control lives in the chrome row (never over the table) and
  // the seat strip becomes the full-bleed header the far wall hides
  // behind while zoomed.
  const exit = page.getByTestId('river-zoom-exit');
  await expect(exit).toBeVisible();
  const exitBox = (await exit.boundingBox())!;
  expect(exitBox.y + exitBox.height).toBeLessThanOrEqual(60);
  expect(exitBox.width).toBeGreaterThanOrEqual(44);
  await expect(strip).toHaveAttribute('data-zoom-bar', 'true');
  const barBox = (await strip.boundingBox())!;
  expect(barBox.x).toBeLessThanOrEqual(1);
  expect(barBox.width).toBeGreaterThanOrEqual(410);
  await page.waitForTimeout(1500);
  const zoomedBoxes = await tiles.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top };
    }),
  );
  for (let i = 0; i < boxes.length; i++) {
    expect(Math.abs(zoomedBoxes[i]!.left - boxes[i]!.left)).toBeLessThan(6);
    expect(Math.abs(zoomedBoxes[i]!.top - boxes[i]!.top)).toBeLessThan(6);
  }
  await page.getByTestId('river-zoom-exit').click();
  await expect(table).toHaveAttribute('data-river-zoom', 'false');
  await expect(strip).toHaveAttribute('data-zoom-bar', 'false');

  const perf = await readPerf(page);
  expect(perf.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
  expect(errors, 'console / page errors').toEqual([]);
});

test('phone landscape keeps ≥ 44 px hand tiles above the footer with glass chrome', async ({
  page,
}) => {
  await page.setViewportSize({ width: 915, height: 412 });
  const errors: string[] = [];
  await startSolo(page, errors);
  await page.waitForTimeout(1800);
  await expect(page.getByTestId('table-3d')).toHaveAttribute(
    'data-viewport-class',
    'phone-landscape',
  );
  const tiles = page.getByTestId('own-hand-tile');
  await expect(tiles).toHaveCount(14);
  const boxes = await tiles.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }),
  );
  for (const b of boxes) {
    expect(b.width).toBeGreaterThanOrEqual(44);
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.left + b.width).toBeLessThanOrEqual(915);
    // One row along the bottom, ending at (or a few px into) the footer.
    expect(b.top + b.height).toBeLessThanOrEqual(412 - 12 - 44 + 12);
    expect(b.top + b.height).toBeGreaterThan(300);
  }
  expect(new Set(boxes.map((b) => Math.round(b.top / 20))).size).toBe(1);
  // The dense footer pills sit in the rail gap *below* the hand, never
  // over the end tiles, and the 40 px chrome row clears the far wall.
  const sortBox = (await page.getByRole('button', { name: 'Sort by Suit' }).boundingBox())!;
  // The user's badge is the lowest seat badge on screen.
  const badgeTop = await page.evaluate(() =>
    Math.max(
      ...Array.from(document.querySelectorAll('[aria-label*=" seat, "]')).map(
        (el) => el.getBoundingClientRect().top,
      ),
    ),
  );
  const footerTop = Math.min(sortBox.y, badgeTop);
  for (const b of boxes) expect(b.top + b.height).toBeLessThanOrEqual(footerTop + 0.5);
  const menuBox = (await page.getByRole('button', { name: 'Open menu' }).boundingBox())!;
  expect(menuBox.height).toBeLessThanOrEqual(40);
  expect(menuBox.y + menuBox.height).toBeLessThanOrEqual(52);
  // The root fullscreen offer is present (landscape phone) and the
  // chrome row keeps the direct Settings control.
  await expect(page.getByRole('button', { name: 'Enter fullscreen' })).toBeVisible();
  await expect(page.getByTestId('open-settings')).toBeVisible();
  // The low camera looks over the side walls' top edges: the side seats'
  // rows (racks at |x| = HAND_Z on the other presets) step 0.65 further
  // out so a flat meld beside them is never hidden by the wall, while
  // the far seat's rack stays put.
  const rows = await page.evaluate(() => {
    const dbg = (
      globalThis as {
        __MAHJONG_TABLE_3D_DEBUG__?: () => {
          tiles: { zone: string | null; x: number; z: number }[];
        } | null;
      }
    ).__MAHJONG_TABLE_3D_DEBUG__?.();
    const racks = dbg?.tiles.filter((t) => t.zone === 'oppHand') ?? [];
    return {
      side: racks.filter((t) => Math.abs(t.x) > Math.abs(t.z)).map((t) => Math.abs(t.x)),
      far: racks.filter((t) => Math.abs(t.z) > Math.abs(t.x)).map((t) => -t.z),
    };
  });
  expect(rows.side.length).toBe(26);
  expect(rows.far.length).toBe(13);
  for (const x of rows.side) expect(x).toBeCloseTo(10.55 + 0.65, 1);
  for (const z of rows.far) expect(z).toBeCloseTo(10.55, 1);
  const perf = await readPerf(page);
  expect(perf.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
  expect(perf.triangles).toBeLessThanOrEqual(BUDGET.triangles);
  expect(errors, 'console / page errors').toEqual([]);
});

/**
 * A phone in a browser: 1080×1830 device px of viewport once the address
 * bar and system bars take their share, ≈ 412×700 CSS px (the 412×915
 * tall case is the installed / fullscreen one). Round-5 feedback: the
 * table used to zoom out into a 280 px square with void columns either
 * side; now the camera pitches down and the HUD under the hand gives
 * ground so the whole table fills the width above a two-row hand.
 */
for (const [w, h] of [
  [412, 700],
  [360, 640],
] as const) {
  test(`phone in a browser (${w}×${h}) fits the table edge to edge above a two-row hand`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: w, height: h });
    const errors: string[] = [];
    await startSolo(page, errors);
    await page.waitForTimeout(1800);
    await expect(page.getByTestId('table-3d')).toHaveAttribute(
      'data-viewport-class',
      'phone-portrait',
    );
    const tiles = page.getByTestId('own-hand-tile');
    await expect(tiles).toHaveCount(14);
    const boxes = await tiles.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      }),
    );
    // ≥ 44 px wide (so ≥ 40 px tall), two rows, inside the viewport.
    for (const b of boxes) {
      expect(b.width).toBeGreaterThanOrEqual(44);
      expect(b.height).toBeGreaterThanOrEqual(40);
      expect(b.left).toBeGreaterThanOrEqual(0);
      expect(b.left + b.width).toBeLessThanOrEqual(w);
    }
    expect(new Set(boxes.map((b) => Math.round(b.top / 20))).size).toBe(2);
    const handTop = Math.min(...boxes.map((b) => b.top));
    const handBottom = Math.max(...boxes.map((b) => b.top + b.height));
    // The strip, the hand, the tray and the footer stack without overlap.
    const strip = (await page.getByTestId('seat-strip').boundingBox())!;
    expect(handTop).toBeGreaterThan(strip.y + strip.height);
    const tray = (await page.getByTestId('action-tray').boundingBox())!;
    expect(tray.y).toBeGreaterThanOrEqual(handBottom - 1);
    expect(tray.height).toBeGreaterThanOrEqual(80);
    const sort = (await page.getByRole('button', { name: 'Sort by Suit' }).boundingBox())!;
    expect(sort.y).toBeGreaterThanOrEqual(tray.y + tray.height);
    expect(sort.y + sort.height).toBeLessThanOrEqual(h);
    // The table band between the strip and the hand is at least 230 px
    // tall — the camera pitched down rather than shrinking the table
    // (the tall-phone fallback left a 280 px square in a 470 px band).
    expect(handTop - (strip.y + strip.height)).toBeGreaterThanOrEqual(230);
    expect(errors, 'console / page errors').toEqual([]);
  });
}

test('phone in a browser: the opening rolls card sits in the band above the hand', async ({
  page,
}) => {
  await page.setViewportSize({ width: 412, height: 700 });
  await page.addInitScript(() => {
    (globalThis as { __MAHJONG_TEST_HOLD_DICE__?: boolean }).__MAHJONG_TEST_HOLD_DICE__ = true;
  });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Start match' }).click({ timeout: 30_000 });
  const glass = page.getByTestId('dice-ceremony-glass');
  await expect(glass).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('table-3d')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('own-hand-tile').first()).toBeAttached();
  await page.waitForTimeout(600);
  const box = (await glass.boundingBox())!;
  const strip = (await page.getByTestId('seat-strip').boundingBox())!;
  const handTop = await page.getByTestId('own-hand-tile').evaluateAll((els) => {
    const tops = els
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.height > 0)
      .map((r) => r.top);
    return tops.length ? Math.min(...tops) : Number.POSITIVE_INFINITY;
  });
  // Dense card (2×2, 40 px dice, inline totals): under the seat strip
  // and above the hand's first row — round-5: the 434 px regular card
  // ran from the chrome to over the hand.
  expect(box.y).toBeGreaterThanOrEqual(strip.y + strip.height);
  expect(box.y + box.height).toBeLessThanOrEqual(handTop);
  expect(box.height).toBeLessThanOrEqual(260);
  await expect(page.getByTestId('dice-seat')).toHaveCount(4);
  expect(errors, 'console / page errors').toEqual([]);
});

test('phone landscape lobby: three columns above a felt band, bot skill controls whole', async ({
  page,
}) => {
  await page.setViewportSize({ width: 915, height: 412 });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click({ timeout: 20_000 });
  await expect(page.getByTestId('lobby-3d')).toBeVisible();
  const panel = page.getByTestId('lobby-merged-panel');
  await expect(panel).toBeVisible();
  const panelBox = (await panel.boundingBox())!;
  // The panel stops ≥ 44 px above the bottom edge (felt / near wall band).
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(412 - 44);
  // Bot skill lives in its own column beside Rules, every segmented
  // control fully inside the panel — none clipped at the fold.
  const bots = page.getByTestId('lobby-merged-bots');
  await expect(bots).toBeVisible();
  const botsBox = (await bots.boundingBox())!;
  const rules = (await page.getByText('Rules', { exact: true }).first().boundingBox())!;
  expect(botsBox.x).toBeGreaterThan(rules.x + 40);
  const controls = page.locator('fieldset[aria-label$="bot skill"]');
  await expect(controls).toHaveCount(3);
  const boxes = await controls.evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    }),
  );
  for (const b of boxes) {
    expect(b.top).toBeGreaterThanOrEqual(panelBox.y);
    expect(b.bottom).toBeLessThanOrEqual(panelBox.y + panelBox.height + 0.5);
    expect(b.right).toBeLessThanOrEqual(915);
  }
  // Nothing overflowed, so no scroll cue fade is shown.
  await expect(page.getByTestId('lobby-panel-fade')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Start match' })).toBeVisible();
  expect(errors, 'console / page errors').toEqual([]);
});

test('landscape river zoom stays through the own turn with the hand rail and draw pill', async ({
  page,
}) => {
  await page.setViewportSize({ width: 915, height: 412 });
  const errors: string[] = [];
  await startSolo(page, errors);
  await page.waitForTimeout(1500);
  const table = page.getByTestId('table-3d');
  const zoomBtn = page.getByRole('button', { name: 'Zoom into the discards' });
  // The user is dealer (seed 5): their turn to discard — the zoom is
  // offered all the same (the hatch matters most when picking a discard).
  await expect(zoomBtn).toBeVisible();
  await expect(table).toHaveAttribute('data-river-zoom', 'false');
  const tiles = page.getByTestId('own-hand-tile');
  const restingTops = await tiles.evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().top),
  );
  await zoomBtn.click();
  await expect(table).toHaveAttribute('data-river-zoom', 'true');
  // The ✕ lives in the chrome row over the full-bleed zoom header; the
  // 3D hand row has left the frame below the footer (its hit-targets
  // follow it off-screen) and the footer's rail shows the 14 tiles as
  // thumbnails instead — no draw pill, the tile is already drawn.
  const exit = page.getByTestId('river-zoom-exit');
  await expect(exit).toBeVisible();
  const exitBox = (await exit.boundingBox())!;
  expect(exitBox.y + exitBox.height).toBeLessThanOrEqual(52);
  const header = page.getByTestId('zoom-header');
  await expect(header).toBeAttached();
  const headerBox = (await header.boundingBox())!;
  expect(headerBox.x).toBeLessThanOrEqual(1);
  expect(headerBox.width).toBeGreaterThanOrEqual(913);
  expect(headerBox.y + headerBox.height).toBeGreaterThanOrEqual(exitBox.y + exitBox.height);
  const rail = page.getByTestId('hand-rail');
  await expect(rail).toBeVisible();
  await expect(page.getByTestId('hand-rail-tile')).toHaveCount(14);
  await expect(page.getByTestId('wall-draw-next')).toHaveCount(0);
  const railBox = (await rail.boundingBox())!;
  expect(railBox.y).toBeGreaterThan(360);
  expect(railBox.height).toBeLessThanOrEqual(42);
  await expect(page.getByRole('button', { name: 'Sort by Suit' })).toHaveCount(0);
  await page.waitForTimeout(1500);
  const zoomedTops = await tiles.evaluateAll((els) =>
    els.map((el) => el.getBoundingClientRect().top),
  );
  expect(Math.min(...zoomedTops)).toBeGreaterThan(412 - 1);
  expect(Math.max(...restingTops)).toBeLessThan(412);
  // The side seats' rows leave the layout while zoomed; the rivers stay.
  const zones = await page.evaluate(() => {
    const dbg = (
      globalThis as {
        __MAHJONG_TABLE_3D_DEBUG__?: () => {
          tiles: { zone: string | null; x: number; z: number }[];
        } | null;
      }
    ).__MAHJONG_TABLE_3D_DEBUG__?.();
    const racks = dbg?.tiles.filter((t) => t.zone === 'oppHand') ?? [];
    return {
      side: racks.filter((t) => Math.abs(t.x) > Math.abs(t.z)).length,
      far: racks.filter((t) => Math.abs(t.z) > Math.abs(t.x)).length,
    };
  });
  expect(zones.side).toBe(0);
  expect(zones.far).toBe(13);
  // Tapping the rail brings the table back (it never discards).
  await page.getByRole('button', { name: 'Show the hand' }).click();
  await expect(table).toHaveAttribute('data-river-zoom', 'false');
  await expect(tiles).toHaveCount(14);

  // Discard; the bots play out (zero pacing) and the user's draw cue
  // comes round. Zooming now keeps the zoom (no auto-exit on the own
  // turn) and the rail carries the draw control under the classic id.
  await tiles.first().click();
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
  await expect(page.getByTestId('wall-draw-next')).toBeVisible();
  await zoomBtn.click();
  await expect(table).toHaveAttribute('data-river-zoom', 'true');
  await expect(page.getByTestId('hand-rail-tile')).toHaveCount(13);
  const pill = page.getByTestId('wall-draw-next');
  await expect(pill).toBeVisible();
  await expect(pill).toHaveAccessibleName('Draw next tile');
  await expect(page.locator('[data-testid="wall-draw-next"]')).toHaveCount(1);
  const pillBox = (await pill.boundingBox())!;
  expect(pillBox.y).toBeGreaterThan(360);
  await pill.click();
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
  await expect(table).toHaveAttribute('data-river-zoom', 'true');
  await expect(page.getByTestId('hand-rail-tile')).toHaveCount(14);
  await expect(page.getByTestId('wall-draw-next')).toHaveCount(0);
  await exit.click();
  await expect(table).toHaveAttribute('data-river-zoom', 'false');
  const perf = await readPerf(page);
  expect(perf.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
  expect(errors, 'console / page errors').toEqual([]);
});

test('landscape opening rolls sit in one row clear of the chrome', async ({ page }) => {
  await page.setViewportSize({ width: 915, height: 412 });
  await page.addInitScript(() => {
    (globalThis as { __MAHJONG_TEST_HOLD_DICE__?: boolean }).__MAHJONG_TEST_HOLD_DICE__ = true;
  });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Start match' }).click({ timeout: 30_000 });
  const glass = page.getByTestId('dice-ceremony-glass');
  await expect(glass).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('table-3d')).toBeVisible({ timeout: 20_000 });
  // The four seats' dice share one row (no 2×2 wrap) …
  const seats = page.getByTestId('dice-seat');
  await expect(seats).toHaveCount(4);
  const tops = await seats.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
  for (const t of tops) expect(Math.abs(t - tops[0]!)).toBeLessThan(1.5);
  // … so the compact card (≤ 160 px tall) clears the 46 px chrome row
  // (☰ / status pill / far badge) and stops ≥ 12 px above the hand row's
  // top edge instead of cutting across the tiles.
  const box = (await glass.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(52);
  expect(box.height).toBeLessThanOrEqual(160);
  expect(box.width).toBeGreaterThan(480);
  await expect(page.getByTestId('own-hand-tile').first()).toBeAttached();
  // Hidden hit-targets (tiles still in flight) report an empty box — skip them.
  const handTop = await page.getByTestId('own-hand-tile').evaluateAll((els) => {
    const tops = els
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.height > 0)
      .map((r) => r.top);
    return tops.length ? Math.min(...tops) : Number.POSITIVE_INFINITY;
  });
  expect(box.y + box.height).toBeLessThanOrEqual(handTop - 12);
  // The dismiss hint is its own exact text node (recipes tap it).
  await expect(glass.getByText('Tap anywhere to dismiss', { exact: true })).toBeVisible();
  // Dense landscape badges mark the dealer with the 莊 chip, not a dot.
  const chips = page.locator('[aria-label="Dealer"]');
  await expect(chips.first()).toBeVisible();
  await expect(chips.first()).toHaveText('莊');
  expect(errors, 'console / page errors').toEqual([]);
});

test('the match re-attaches the lobby table renderer instead of compiling a new one', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click({ timeout: 20_000 });
  const lobbyCanvas = page.getByTestId('lobby-table-3d').locator('canvas');
  await expect(lobbyCanvas).toBeAttached({ timeout: 30_000 });
  // Mark the lobby's canvas; the match must inherit the very same
  // element (pooled WebGL context + compiled programs), so the opening
  // rolls never wait on a fresh scene build.
  await lobbyCanvas.evaluate((c) => c.setAttribute('data-probe', 'pooled'));
  await page.getByRole('button', { name: 'Start match' }).click({ timeout: 30_000 });
  const tableCanvas = page.getByTestId('table-3d-scene').locator('canvas');
  await expect(tableCanvas).toBeAttached({ timeout: 20_000 });
  await expect(tableCanvas).toHaveAttribute('data-probe', 'pooled');
  await expect(page.locator('canvas')).toHaveCount(1);
  await dismissDice(page);
  await expect(page.getByTestId('own-hand-tile').first()).toBeVisible({ timeout: 20_000 });
  expect(errors, 'console / page errors').toEqual([]);
});

test('landscape claim window moves the strip into the footer, off the near wall', async ({
  page,
}) => {
  await page.setViewportSize({ width: 915, height: 412 });
  await page.addInitScript(() => {
    const g = globalThis as {
      __MAHJONG_TEST_SEED__?: number;
      __MAHJONG_TEST_BOT_SCRIPTS__?: Record<number, { discards?: unknown[] }>;
    };
    g.__MAHJONG_TEST_SEED__ = 30;
    g.__MAHJONG_TEST_BOT_SCRIPTS__ = { 1: {}, 2: {}, 3: {} };
  });
  const errors: string[] = [];
  await startSolo(page, errors);
  await page.waitForTimeout(1600);
  // Seed 30: the user (dealer) holds a pair bot 1 also holds one of.
  // Script bot 1 to discard it and discard something else ourselves.
  await page.evaluate(() => {
    type T = { kind: string; suit?: string; rank?: number; honor?: string };
    const g = globalThis as {
      __MAHJONG_TEST_GET_STATE__?: () => { state: { hands: Record<number, T[]> }; you: number };
      __MAHJONG_TEST_BOT_SCRIPTS__?: Record<number, { discards?: T[] }>;
    };
    const s = g.__MAHJONG_TEST_GET_STATE__!();
    const key = (t: T) => (t.kind === 'suit' ? `s:${t.suit}:${t.rank}` : `h:${t.honor}`);
    const mine = s.state.hands[s.you]!;
    const counts = new Map<string, number>();
    for (const t of mine) counts.set(key(t), (counts.get(key(t)) ?? 0) + 1);
    const botFaces = new Set(s.state.hands[1]!.map(key));
    const target = mine.find((t) => (counts.get(key(t)) ?? 0) >= 2 && botFaces.has(key(t)))!;
    g.__MAHJONG_TEST_BOT_SCRIPTS__![1] = { discards: [target] };
    const names: Record<string, string> = {
      E: 'East wind',
      S: 'South wind',
      W: 'West wind',
      N: 'North wind',
      Z: 'Red dragon',
      F: 'Green dragon',
      B: 'White dragon',
    };
    const name = (t: T) => (t.kind === 'suit' ? `${t.rank} ${t.suit}` : names[t.honor!]!);
    const avoid = name(target);
    const btn = Array.from(
      document.querySelectorAll<HTMLElement>('[data-testid="own-hand-tile"]'),
    ).find((b) => !(b.getAttribute('aria-label') || '').startsWith(avoid))!;
    btn.click();
  });
  const bar = page.getByTestId('claim-bar');
  await expect(bar).toBeVisible({ timeout: 20_000 });
  const barBox = (await bar.boundingBox())!;
  const handBottom = await page
    .getByTestId('own-hand-tile')
    .evaluateAll((els) => Math.max(...els.map((el) => el.getBoundingClientRect().bottom)));
  // The strip sits in the 37 px footer row under the hand — never on the
  // near wall's backs above it, and ≥ 6 px below the tiles' bottom edge
  // so they do not read as standing on the panel — and replaces the sort
  // control there.
  expect(barBox.y).toBeGreaterThanOrEqual(handBottom + 6);
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(412 - 3);
  expect(barBox.height).toBeLessThanOrEqual(40);
  await expect(page.getByRole('button', { name: 'Sort by Suit' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Peng' })).toBeVisible();
  expect(errors, 'console / page errors').toEqual([]);
});

test('the discard flight stretches under the slow-motion seam and carries the gold pulse', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const g = globalThis as {
      __MAHJONG_TEST_MOTION_SLOWMO__?: number;
      __MAHJONG_TEST_BOT_PACE_MS__?: number;
    };
    g.__MAHJONG_TEST_MOTION_SLOWMO__ = 8;
    g.__MAHJONG_TEST_BOT_PACE_MS__ = 8000;
  });
  const errors: string[] = [];
  await startSolo(page, errors);
  await page.waitForTimeout(1500);
  const tileId = Number(
    await page.getByTestId('own-hand-tile').nth(3).getAttribute('data-tile-id'),
  );
  await page.getByTestId('own-hand-tile').nth(3).click();
  // The tapped tile leaves the hand on a stretched discard arc (520 ms ×
  // 8) — the `match-discard-flight` recipe relies on catching it mid-air.
  await expect
    .poll(
      () =>
        page.evaluate((id) => {
          const dbg = (
            globalThis as {
              __MAHJONG_TABLE_3D_DEBUG__?: () => {
                tiles: {
                  id: number;
                  zone: string | null;
                  flight: { kind: string; ms: number } | null;
                }[];
              } | null;
            }
          ).__MAHJONG_TABLE_3D_DEBUG__?.();
          const t = dbg?.tiles.find((x) => x.id === id);
          return t ? `${t.zone}:${t.flight?.kind ?? 'none'}:${t.flight?.ms ?? 0}` : 'missing';
        }, tileId),
      { timeout: 5_000 },
    )
    .toBe('discard:discard:4160');
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
