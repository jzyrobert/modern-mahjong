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

/**
 * The deal has landed: no tile is in flight (`TableDebugSnapshot.flights`)
 * and the hit-target rects have had a beat to settle. Replaces the fixed
 * 1.5–1.8 s sleeps that a loaded shard outran (round-6: the landscape
 * specs read rects with the dispense still in the air).
 */
async function waitForDealSettled(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const dbg = (
            globalThis as { __MAHJONG_TABLE_3D_DEBUG__?: () => { flights: number } | null }
          ).__MAHJONG_TABLE_3D_DEBUG__?.();
          return dbg ? dbg.flights : -1;
        }),
      { timeout: 20_000 },
    )
    .toBe(0);
  await page.waitForTimeout(300);
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
  // Hold the modal open: it auto-dismisses after 3.5 s (`DISMISS_MS`), and
  // on a loaded shard the glass could vanish between its visibility wait
  // and the text assertions (round-7: 'Opening rolls' not found while the
  // hand was already dealt). The tap below still dismisses it.
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
  await expect(glass.getByText('Opening rolls')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('dice-ceremony-paper')).toHaveCount(0);
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
  // claim strip can take the centre slot under the hand; while it is
  // the user's move that slot carries the turn chip ("your turn ·
  // discard" — seed 5 deals the user as dealer), centred under the
  // hand, and the status pill accounts for the dead wall beside the
  // live count.
  const vp = page.viewportSize()!;
  if (vp.width >= 768 && vp.height >= 600) {
    const sort = (await page.getByRole('button', { name: 'Sort by Suit' }).boundingBox())!;
    expect(sort.x).toBeGreaterThan(vp.width * 0.6);
    expect(sort.y + sort.height).toBeGreaterThan(box!.y + box!.height);
    const chip = page.getByTestId('turn-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText(/discard/i);
    const cb = (await chip.boundingBox())!;
    expect(Math.abs(cb.x + cb.width / 2 - vp.width / 2)).toBeLessThan(40);
    expect(cb.y).toBeGreaterThan(box!.y + box!.height);
    await expect(page.getByText(/14 dead/i)).toBeVisible();
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

/** Hand tile ids in DOM order (the buttons re-key into display order). */
function domHandOrder(page: Page): Promise<number[]> {
  return page
    .getByTestId('own-hand-tile')
    .evaluateAll((els) => els.map((el) => Number(el.getAttribute('data-tile-id'))));
}

/** Hand tile ids by projected position: rows top to bottom, left to right. */
function screenHandOrder(page: Page): Promise<number[]> {
  return page.getByTestId('own-hand-tile').evaluateAll((els) => {
    const items = els.map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: Number(el.getAttribute('data-tile-id')),
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        h: r.height,
      };
    });
    items.sort((a, b) => a.y - b.y);
    const rows: (typeof items)[] = [];
    for (const it of items) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(it.y - row[0]!.y) <= row[0]!.h / 2) row.push(it);
      else rows.push([it]);
    }
    return rows.flatMap((row) => row.sort((a, b) => a.x - b.x).map((it) => it.id));
  });
}

/**
 * Order polls: a drag renders a full frame per pointer step and the
 * springs keep the loop busy for ~0.5 s after the release, so on a
 * loaded SwiftShader shard a single DOM read can queue for seconds.
 */
const POLL = { timeout: 15_000 };

function moved(ids: readonly number[], from: number, to: number): number[] {
  const next = ids.slice();
  const [m] = next.splice(from, 1);
  next.splice(to, 0, m!);
  return next;
}

/** Press on the `from`-th hand tile and carry it to the `to`-th tile's centre. */
async function dragHandTile(page: Page, from: number, to: number) {
  const tiles = page.getByTestId('own-hand-tile');
  const a = (await tiles.nth(from).boundingBox())!;
  const b = (await tiles.nth(to).boundingBox())!;
  const x0 = a.x + a.width / 2;
  const y0 = a.y + a.height / 2;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x0 + 8, y0, { steps: 2 });
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 - 10, { steps: 12 });
  await page.mouse.up();
}

function ownDiscardCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const s = (
      globalThis as {
        __MAHJONG_TEST_GET_STATE__?: () => { state: { discards: Record<number, unknown[]> } };
      }
    ).__MAHJONG_TEST_GET_STATE__?.();
    return s?.state.discards[0]?.length ?? -1;
  });
}

test('dragging a hand tile reorders it (switching to MANUAL) and a plain tap still discards', async ({
  page,
}) => {
  // Two drags, a keyboard move and a discard, each waiting on a spring
  // settle: a loaded CI shard needs the slow budget.
  test.slow();
  const errors: string[] = [];
  await startSolo(page, errors);
  await page.waitForTimeout(1500);
  const manual = page.getByRole('button', { name: 'Sort by Manual' });
  await expect(manual).toHaveAttribute('aria-pressed', 'false');
  const before = await domHandOrder(page);
  expect(before).toHaveLength(14);
  expect(await screenHandOrder(page)).toEqual(before);

  // Carry the first tile onto the fourth slot: the drag flips the sort
  // segment to MANUAL, the row re-flows behind it and nothing is discarded.
  await dragHandTile(page, 0, 3);
  await expect(manual).toHaveAttribute('aria-pressed', 'true');
  const expected = moved(before, 0, 3);
  await expect.poll(() => domHandOrder(page), POLL).toEqual(expected);
  await expect.poll(() => screenHandOrder(page), POLL).toEqual(expected);
  expect(await ownDiscardCount(page)).toBe(0);

  // Keyboard fallback: Shift+ArrowLeft walks the focused tile one slot back.
  await page.getByTestId('own-hand-tile').nth(3).focus();
  await page.keyboard.press('Shift+ArrowLeft');
  await expect.poll(() => domHandOrder(page), POLL).toEqual(moved(expected, 3, 2));

  // A plain tap on the (now second) tile is still a discard (the hand
  // drops to 13; a bot may claim the tile, so the river is not asserted).
  await page.getByTestId('own-hand-tile').nth(1).click();
  await expect(page.getByTestId('own-hand-tile')).toHaveCount(13, { timeout: 10_000 });
  expect(errors, 'console / page errors').toEqual([]);
});

test('phone portrait drag reorders within and across the two held rows', async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 412, height: 700 });
  const errors: string[] = [];
  await startSolo(page, errors);
  await page.waitForTimeout(1800);
  await page.getByRole('button', { name: 'Sort by Manual' }).click();
  const before = await domHandOrder(page);
  expect(before).toHaveLength(14);
  expect(await screenHandOrder(page)).toEqual(before);

  // Same row: slot 0 → slot 3 (both on the back row of 7).
  await dragHandTile(page, 0, 3);
  const afterRow = moved(before, 0, 3);
  await expect.poll(() => domHandOrder(page), POLL).toEqual(afterRow);
  await expect.poll(() => screenHandOrder(page), POLL).toEqual(afterRow);

  // Across rows: slot 0 (back row) → slot 10 (front row) resolves by the
  // nearest slot centre in 2D, not by x alone.
  await dragHandTile(page, 0, 10);
  const afterCross = moved(afterRow, 0, 10);
  await expect.poll(() => domHandOrder(page), POLL).toEqual(afterCross);
  await expect.poll(() => screenHandOrder(page), POLL).toEqual(afterCross);
  expect(await ownDiscardCount(page)).toBe(0);

  await page.getByTestId('own-hand-tile').first().click();
  await expect(page.getByTestId('own-hand-tile')).toHaveCount(13, { timeout: 10_000 });
  expect(errors, 'console / page errors').toEqual([]);
});

test('phone portrait holds the hand near the camera at ≥ 44 px per tile', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  const errors: string[] = [];
  await startSolo(page, errors);
  await waitForDealSettled(page);
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
  await waitForDealSettled(page);
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
    await waitForDealSettled(page);
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
    // The pitched camera parks the far rail right under the strip, so
    // portrait toasts take the strip's row (badges step aside) instead
    // of landing on the far rack + wall; the tall phone keeps the rail.
    await expect(page.getByTestId('table-3d')).toHaveAttribute('data-toast-slot', 'strip');
    await expect(page.getByTestId('seat-strip')).toHaveAttribute('data-cleared', 'false');
    expect(errors, 'console / page errors').toEqual([]);
  });
}

test('the tall phone keeps the far-rail toast slot', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  const errors: string[] = [];
  await startSolo(page, errors);
  await waitForDealSettled(page);
  await expect(page.getByTestId('table-3d')).toHaveAttribute('data-toast-slot', 'rail');
  expect(errors, 'console / page errors').toEqual([]);
});

/**
 * Portrait pre-game lobby on a phone in a browser: one scrolling panel
 * (Seats · Bot skill · collapsed Rules) over a felt band that shows the
 * waiting table's near wall, Start / Leave always on screen, the page
 * itself never scrolling (round-6: stacked cards pushed Start below the
 * fold and hid every table pixel at 360×640).
 */
for (const [w, h] of [
  [412, 700],
  [360, 640],
] as const) {
  test(`portrait lobby (${w}×${h}): panel above a felt band, Start match on screen`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: w, height: h });
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/');
    await page.getByRole('button', { name: 'Play vs bots' }).click({ timeout: 20_000 });
    await expect(page.getByTestId('lobby-3d')).toBeVisible();
    const panel = page.getByTestId('lobby-portrait-panel');
    await expect(panel).toBeVisible();
    const start = page.getByRole('button', { name: 'Start match' });
    await expect(start).toBeVisible();
    const startBox = (await start.boundingBox())!;
    const panelBox = (await panel.boundingBox())!;
    // Panel, then the Start row, then ≥ 56 px of felt / near wall.
    expect(startBox.y).toBeGreaterThanOrEqual(panelBox.y + panelBox.height);
    expect(startBox.y + startBox.height).toBeLessThanOrEqual(h - 56);
    expect(startBox.height).toBeGreaterThanOrEqual(44);
    // The expanded Rules card would overflow the capped panel here, so
    // the rules collapse to their summary; Bot skill rows are whole
    // inside the panel or scroll under the fade cue — never clipped by
    // the page.
    await expect(page.getByText(/Min \d faan/)).toBeVisible();
    await expect(page.getByRole('radiogroup', { name: 'Minimum faan' })).toHaveCount(0);
    const scroll = page.getByTestId('lobby-portrait-scroll');
    const overflow = await scroll.evaluate((el) => el.scrollHeight - el.clientHeight > 2);
    await expect(page.getByTestId('lobby-panel-fade')).toHaveCount(overflow ? 1 : 0);
    const pageScrolls = await page.evaluate(
      () => (document.scrollingElement?.scrollHeight ?? 0) > window.innerHeight + 1,
    );
    expect(pageScrolls).toBe(false);
    await expect(page.getByTestId('lobby-table-3d')).toBeVisible({ timeout: 30_000 });
    expect(errors, 'console / page errors').toEqual([]);
  });
}

/**
 * The tall 412×915 phone has the room for the whole Rules card inside the
 * capped panel, so it renders expanded (min-faan chips, timer toggle)
 * above the Start row and the felt band — round-7: it collapsed to the
 * summary row over ~300 px of table.
 */
test('portrait lobby (412×915): the Rules card stays expanded above the felt band', async ({
  page,
}) => {
  await page.setViewportSize({ width: 412, height: 915 });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click({ timeout: 20_000 });
  const panel = page.getByTestId('lobby-portrait-panel');
  await expect(panel).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Minimum faan' })).toBeVisible();
  await expect(page.getByText(/Min \d faan ·/)).toHaveCount(0);
  await expect(page.getByTestId('lobby-panel-fade')).toHaveCount(0);
  const start = page.getByRole('button', { name: 'Start match' });
  const startBox = (await start.boundingBox())!;
  const panelBox = (await panel.boundingBox())!;
  expect(startBox.y).toBeGreaterThanOrEqual(panelBox.y + panelBox.height);
  expect(startBox.y + startBox.height).toBeLessThanOrEqual(915 - 56);
  const scroll = page.getByTestId('lobby-portrait-scroll');
  expect(await scroll.evaluate((el) => el.scrollHeight - el.clientHeight > 2)).toBe(false);
  expect(errors, 'console / page errors').toEqual([]);
});

/**
 * The basics lesson's opening-dice step on a phone in a browser: the
 * dense dice card and the lesson card need the whole band under the
 * seat strip, so the held hand (with its tray + footer) parks below the
 * viewport and springs back when the step advances (round-6: the card
 * sat on the dimmed hand).
 */
test('phone in a browser: the dice lesson step parks the hand under the lesson card', async ({
  page,
}) => {
  await page.setViewportSize({ width: 412, height: 700 });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
  await page.evaluate(() => {
    (
      globalThis as { __MAHJONG_TEST_START_TUTORIAL__?: (id: string) => void }
    ).__MAHJONG_TEST_START_TUTORIAL__?.('basics');
  });
  const dice = page.getByTestId('dice-ceremony-glass');
  await expect(dice).toBeVisible({ timeout: 20_000 });
  const table = page.getByTestId('table-3d');
  await expect(table).toHaveAttribute('data-hand-parked', 'true');
  await expect(page.getByTestId('action-tray')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sort by Suit' })).toBeHidden();
  const cta = page.getByTestId('tutorial-next');
  await expect(cta).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600);
  const diceBox = (await dice.boundingBox())!;
  const ctaBox = (await cta.boundingBox())!;
  const strip = (await page.getByTestId('seat-strip').boundingBox())!;
  // Dice card under the strip, lesson card (its CTA) below the dice card
  // and inside the viewport; no hand tile on screen. The pair is centred
  // in the band: the slack above the dice card matches the slack under
  // the caption (its CTA sits ~18 px above the card's bottom edge) to
  // within a notch, instead of the stack pinning to the strip over ~120
  // px of bare scrim (round-7).
  const stripBottom = strip.y + strip.height;
  expect(diceBox.y).toBeGreaterThanOrEqual(stripBottom + 40);
  expect(ctaBox.y).toBeGreaterThan(diceBox.y + diceBox.height);
  expect(ctaBox.y + ctaBox.height).toBeLessThanOrEqual(700 - 30);
  const above = diceBox.y - stripBottom;
  const below = 700 - (ctaBox.y + ctaBox.height + 18);
  expect(Math.abs(above - below)).toBeLessThanOrEqual(30);
  const tileTops = await page.getByTestId('own-hand-tile').evaluateAll((els) =>
    els
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.height > 0)
      .map((r) => r.top),
  );
  for (const t of tileTops) expect(t).toBeGreaterThanOrEqual(700);
  // Advancing the step brings the hand (and its footer) back.
  await cta.click();
  await expect(table).toHaveAttribute('data-hand-parked', 'false');
  await expect(page.getByRole('button', { name: 'Sort by Suit' })).toBeVisible();
  await expect
    .poll(
      () =>
        page
          .getByTestId('own-hand-tile')
          .evaluateAll((els) =>
            Math.min(
              ...els.map((el) => el.getBoundingClientRect().top).filter((t) => Number.isFinite(t)),
            ),
          ),
      { timeout: 10_000 },
    )
    .toBeLessThan(600);
  expect(errors, 'console / page errors').toEqual([]);
});

/**
 * Scoring lesson on a 360×640 phone: the result card pins to the top
 * (`resultPanelPinsTop`) so the caption docks below the spotlit header +
 * winning hand instead of covering the panel from its overlap fallback.
 */
test('360×640 scoring step: result card pinned top, caption below the winning hand', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 640 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible();
  await page.evaluate(() => {
    (
      globalThis as { __MAHJONG_TEST_START_TUTORIAL__?: (id: string) => void }
    ).__MAHJONG_TEST_START_TUTORIAL__?.('scoring-intro');
  });
  await expect(page.getByText('Scoring 101')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('tutorial-next').click();
  await expect(page.getByRole('heading', { name: /平和/ })).toBeVisible({ timeout: 15_000 });
  const veilCard = page.getByTestId('result-veil-card');
  await expect(veilCard).toHaveAttribute('data-pin', 'top');
  const veilBox = (await veilCard.boundingBox())!;
  expect(veilBox.y).toBeLessThanOrEqual(24);
  const hand = (await page.getByTestId('winning-hand').boundingBox())!;
  const cta = page.getByTestId('tutorial-next');
  await expect(cta).toBeVisible();
  const ctaBox = (await cta.boundingBox())!;
  // The lesson card docks snugly *below* the spotlit band (header +
  // winning hand + View breakdown), so it starts under the hand and
  // stays wholly on screen.
  await expect
    .poll(async () => {
      const l = await page.evaluate(() => globalThis.__MAHJONG_TEST_TUTORIAL_LAYOUT__);
      return l ? `${l.placement.kind}:${(l.placement.gap ?? 99) <= 14.5}` : 'none';
    })
    .toBe('below:true');
  expect(ctaBox.y).toBeGreaterThan(hand.y + hand.height);
  expect(ctaBox.y + ctaBox.height).toBeLessThanOrEqual(640);
  expect(errors, 'page errors').toEqual([]);
});

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
  // Hold the opening-rolls modal open once the match starts: it
  // auto-dismisses after 3.5 s, and under shard load the final
  // `dice-ceremony-glass` wait below could otherwise poll after the glass
  // had already gone (1-in-2 red on a loaded host).
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
  await expect(page.getByTestId('lobby-3d')).toBeVisible();
  const panel = page.getByTestId('lobby-merged-panel');
  await expect(panel).toBeVisible();
  const panelBox = (await panel.boundingBox())!;
  // The panel stops ≥ 44 px above the bottom edge (felt / near wall band)
  // and starts under the root fullscreen prompt's DISMISS pill (y ≤ 62).
  expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(412 - 44);
  expect(panelBox.y).toBeGreaterThanOrEqual(64);
  const dismiss = (await page
    .getByRole('button', { name: 'Dismiss fullscreen prompt' })
    .boundingBox())!;
  expect(dismiss.y + dismiss.height).toBeLessThanOrEqual(panelBox.y);
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
  const start = page.getByRole('button', { name: 'Start match' });
  await expect(start).toBeVisible();
  // The button is a real click target (nothing of the panel intercepts it).
  await start.click({ timeout: 20_000 });
  await expect(page.getByTestId('dice-ceremony-glass')).toBeVisible({ timeout: 20_000 });
  expect(errors, 'console / page errors').toEqual([]);
});

test('landscape river zoom stays through the own turn with the hand rail and draw pill', async ({
  page,
}) => {
  await page.setViewportSize({ width: 915, height: 412 });
  const errors: string[] = [];
  await startSolo(page, errors);
  await waitForDealSettled(page);
  const table = page.getByTestId('table-3d');
  const zoomBtn = page.getByRole('button', { name: 'Zoom into the discards' });
  // The user is dealer (seed 5): their turn to discard — the zoom is
  // offered all the same (the hatch matters most when picking a discard).
  await expect(zoomBtn).toBeVisible({ timeout: 15_000 });
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
  // Generous: on a loaded shard the footer's re-render can trail the
  // zoom attribute by seconds.
  const rail = page.getByTestId('hand-rail');
  await expect(rail).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('hand-rail-tile')).toHaveCount(14, { timeout: 15_000 });
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
  await waitForDealSettled(page);
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
  const tileId = Number(
    await page.getByTestId('own-hand-tile').nth(3).getAttribute('data-tile-id'),
  );
  // Wait for the deal to land and the loop to go idle with the tapped
  // tile settled in the hand (no flight) — a fixed pause let a loaded
  // shard click while the dispense was still in the air and the poll then
  // saw the tile still in zone `hand` after 8 s.
  await page.waitForFunction(
    (id) => {
      const g = globalThis as {
        __MAHJONG_PERF__?: { idle?: boolean };
        __MAHJONG_TABLE_3D_DEBUG__?: () => {
          tiles: { id: number; zone: string | null; flight: unknown | null }[];
        } | null;
      };
      const t = g.__MAHJONG_TABLE_3D_DEBUG__?.()?.tiles.find((x) => x.id === id);
      return g.__MAHJONG_PERF__?.idle === true && t?.zone === 'hand' && t.flight === null;
    },
    tileId,
    { timeout: 20_000 },
  );
  // The tapped tile leaves the hand on a stretched discard arc (520 ms ×
  // 8) — the `match-discard-flight` recipe relies on catching it mid-air.
  // The poll runs alongside the click: on a loaded SwiftShader shard the
  // click's actionability wait alone can eat most of the 4.2 s flight,
  // and the poll must be watching before the tile takes off.
  const flight = expect
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
      { timeout: 8_000, intervals: [50, 100, 100, 200] },
    )
    .toBe('discard:discard:4160');
  await Promise.all([flight, page.getByTestId('own-hand-tile').nth(3).dispatchEvent('click')]);
  expect(errors, 'console / page errors').toEqual([]);
});

test('a win stamps the glass result card and the next hand shuffles without the classic overlays', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    // Headless Chromium has no audio sink: the shuffle sound's play()
    // promise is rejected when the ceremony's stop fades it out. That is
    // the media element, not the table.
    if (m.type() === 'error' && !/play\(\) request was interrupted/.test(m.text()))
      errors.push(m.text());
  });
  page.on('pageerror', (e) => {
    if (!/play\(\) request was interrupted/.test(String(e))) errors.push(String(e));
  });
  // Hold the shuffle ceremony for 6 s (the app runs 1.7 s) so the flag
  // and the pill can be read on a SwiftShader shard that paints a frame
  // or two per second.
  await page.addInitScript(() => {
    (globalThis as { __MAHJONG_TEST_SHUFFLE_MS__?: number }).__MAHJONG_TEST_SHUFFLE_MS__ = 6000;
  });
  await page.goto('/');
  // The `win` lesson deals a complete hand: declaring tsumo resolves it.
  // The launcher hook is installed by the transport provider after
  // hydration, so wait for it rather than firing on `load`.
  await page.waitForFunction(
    () =>
      typeof (globalThis as { __MAHJONG_TEST_START_TUTORIAL__?: unknown })
        .__MAHJONG_TEST_START_TUTORIAL__ === 'function',
    null,
    { timeout: 20_000 },
  );
  await page.evaluate(() => {
    (
      globalThis as { __MAHJONG_TEST_START_TUTORIAL__?: (id: string) => void }
    ).__MAHJONG_TEST_START_TUTORIAL__?.('win');
  });
  await expect(page.getByTestId('own-hand-tile').first()).toBeVisible({ timeout: 20_000 });
  // Dispatched clicks: the coach-mark CTA and the declare button sit over
  // a canvas that paints at a frame or two per second on a loaded
  // SwiftShader shard, so Playwright's stability wait can outlast the test.
  const next = page.getByTestId('tutorial-next').first();
  await next.waitFor({ timeout: 15_000 });
  await next.dispatchEvent('click');
  const declare = page.getByRole('button', { name: /Declare win/ });
  await declare.waitFor({ timeout: 20_000 });
  await declare.dispatchEvent('click');
  // 3D renderer: the gold 和 seal on the glass card is the celebration;
  // the classic cream "WINNER" card stays gated off.
  await expect(page.getByTestId('win-stamp')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('result-veil-card')).toBeVisible();
  await expect(page.getByText('WINNER', { exact: true })).toHaveCount(0);
  // The seal owns the card's top-right corner: no control may sit under
  // it (round-FB3 feedback: the SAVE pill was stamped over).
  await page.waitForTimeout(700);
  const seal = (await page.getByTestId('win-stamp').boundingBox())!;
  const controls = await page
    .getByTestId('result-veil-card')
    .getByRole('button')
    .evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height, name: el.textContent };
      }),
    );
  expect(controls.length).toBeGreaterThan(0);
  for (const c of controls) expect(overlaps(c, seal), `${c.name} under the 和 seal`).toBe(false);
  await expect(page.getByText('Tap anywhere to dismiss', { exact: true })).toHaveCount(0);
  // Finish the lesson and start the next hand: the between-hand shuffle
  // is the glass 洗牌 pill over the table, never the cream token ring.
  const done = page.getByRole('button', { name: 'Done' });
  await done.waitFor({ timeout: 15_000 });
  await done.dispatchEvent('click');
  await page.evaluate(() => {
    (globalThis as { __MAHJONG_TEST_GET_TUTORIAL__?: () => { dismissCompletion: () => void } })
      .__MAHJONG_TEST_GET_TUTORIAL__?.()
      .dismissCompletion();
  });
  const startNext = page.getByRole('button', { name: 'Start next hand' });
  await startNext.waitFor({ timeout: 15_000 });
  await startNext.dispatchEvent('click');
  await expect(page.getByTestId('shuffle-pill')).toBeVisible({ timeout: 10_000 });
  // The store flag drives the table's slow dispense while the pill is up.
  const shuffling = await page.evaluate(
    () =>
      (
        globalThis as { __MAHJONG_TEST_GET_STATE__?: () => { shuffling?: boolean } }
      ).__MAHJONG_TEST_GET_STATE__?.().shuffling,
  );
  expect(shuffling).toBe(true);
  await expect(page.getByText('Shuffling…')).toHaveCount(0);
  await expect(page.getByTestId('shuffle-pill')).toBeHidden({ timeout: 15_000 });
  expect(errors, 'console / page errors').toEqual([]);
});

interface HintRect {
  left: number;
  top: number;
  width: number;
  height: number;
}
interface HintDebug {
  tileId: number;
  faceRect: HintRect | null;
  markerRect: HintRect | null;
}

/** The discard hint as the scene renders it (`TableDebugSnapshot.hint`). */
function readHint(page: Page): Promise<HintDebug | null> {
  return page.evaluate(
    () =>
      (
        globalThis as { __MAHJONG_TABLE_3D_DEBUG__?: () => { hint: HintDebug | null } | null }
      ).__MAHJONG_TABLE_3D_DEBUG__?.()?.hint ?? null,
  );
}

/** Every edge of the frame's stroke within `tol` px of the tile's printed face. */
function hugs(h: HintDebug | null, tol = 4): h is HintDebug & { markerRect: HintRect } {
  if (!h?.faceRect || !h.markerRect) return false;
  const f = h.faceRect;
  const m = h.markerRect;
  return (
    Math.abs(m.left - f.left) <= tol &&
    Math.abs(m.top - f.top) <= tol &&
    Math.abs(m.left + m.width - (f.left + f.width)) <= tol &&
    Math.abs(m.top + m.height - (f.top + f.height)) <= tol
  );
}

for (const vp of [
  { name: 'phone', width: 412, height: 700 },
  { name: 'desktop', width: 1440, height: 900 },
]) {
  test(`the discard-hint frame hugs the hinted tile face on ${vp.name} and follows it through a drag`, async ({
    page,
  }) => {
    test.slow();
    await page.setViewportSize({ width: vp.width, height: vp.height });
    // Settings live in localStorage before boot (the shot verifier seeds
    // them the same way).
    await page.addInitScript(() => {
      try {
        const key = 'mj.settings.v1';
        const cur = JSON.parse(localStorage.getItem(key) || '{}');
        localStorage.setItem(key, JSON.stringify({ ...cur, discardHint: true }));
      } catch {}
    });
    const errors: string[] = [];
    await startSolo(page, errors);
    await waitForDealSettled(page);
    // The hint is scene geometry (`TableScene.hintFrame`); the HUD keeps
    // only a zero-visual marker under the shared testid.
    const marker = page.getByTestId('hand-tile-recommended');
    await expect(marker).toHaveCount(1, { timeout: 15_000 });
    await expect(marker).toHaveCSS('border-style', 'none');
    // The frame fades in once the hinted tile has landed, then hugs the
    // printed face — not the taller box the tap target projects.
    await expect.poll(() => readHint(page).then((h) => hugs(h)), POLL).toBe(true);
    const before = await readHint(page);
    if (!hugs(before)) throw new Error('hint frame missing');
    const canvas = (await page.getByTestId('table-3d').locator('canvas').first().boundingBox())!;
    const button = (await page
      .locator(`[data-testid="own-hand-tile"][data-tile-id="${before.tileId}"]`)
      .boundingBox())!;
    // …and sits inside that tile's tap target (canvas px → page px).
    const m = before.markerRect;
    expect(canvas.x + m.left).toBeGreaterThanOrEqual(button.x - 4);
    expect(canvas.x + m.left + m.width).toBeLessThanOrEqual(button.x + button.width + 4);
    expect(canvas.y + m.top).toBeGreaterThanOrEqual(button.y - 4);
    expect(canvas.y + m.top + m.height).toBeLessThanOrEqual(button.y + button.height + 4);

    // Carry the hinted tile five slots along (across the held rows on
    // the phone): the frame rides the tile's pose, so it hugs the face
    // at the new slot without a re-projection lag.
    const order = await domHandOrder(page);
    const from = order.indexOf(before.tileId);
    expect(from).toBeGreaterThanOrEqual(0);
    const to = from < 7 ? from + 5 : from - 5;
    await dragHandTile(page, from, to);
    await expect.poll(() => domHandOrder(page), POLL).toEqual(moved(order, from, to));
    await expect
      .poll(
        () =>
          readHint(page).then(
            (h) =>
              h?.tileId === before.tileId &&
              hugs(h) &&
              Math.abs(h.markerRect.left - before.markerRect.left) > 10,
          ),
        POLL,
      )
      .toBe(true);

    // Perf: the frame's material shares the cue halo's compiled program,
    // so once the discard round-trips to the draw cue (the halo's first
    // frame on this table) nothing new compiles — and the hint is gone
    // while the user has yet to draw.
    const withHint = await readPerf(page);
    await page
      .locator(`[data-testid="own-hand-tile"][data-tile-id="${before.tileId}"]`)
      .dispatchEvent('click');
    await expect(page.getByTestId('wall-draw-next')).toBeVisible({ timeout: 45_000 });
    await expect.poll(() => readHint(page), POLL).toBeNull();
    await page.waitForTimeout(600);
    expect((await readPerf(page)).programs).toBe(withHint.programs);
    expect(errors, 'console / page errors').toEqual([]);
  });
}

test('the glass result card keeps the save-replay chip in the action row, not the seal corner', async ({
  page,
}) => {
  await page.setViewportSize({ width: 412, height: 700 });
  const errors: string[] = [];
  await startSolo(page, errors);
  await waitForDealSettled(page);
  // One discard so the recorder's draft has a frame, then wait for the
  // bots' round-trip (the user's draw cue) before injecting the result —
  // mid-loop the next bot delta would clear `lastResult` again.
  await page.getByTestId('own-hand-tile').first().dispatchEvent('click');
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
  await page.evaluate(() => {
    const store = (
      globalThis as {
        __MAHJONG_TEST_GET_STATE__?: () => { state: unknown; setState: (s: unknown) => void };
      }
    ).__MAHJONG_TEST_GET_STATE__?.();
    if (!store?.state) throw new Error('engine state not ready');
    const cur = store.state as Record<string, unknown>;
    store.setState({
      ...cur,
      phase: 'resolved',
      lastResult: { kind: 'draw', reason: 'wall-empty' },
    });
  });
  const card = page.getByTestId('result-veil-card');
  await expect(card).toBeVisible({ timeout: 15_000 });
  const save = page.getByRole('button', { name: 'Save replay' });
  await expect(save).toBeVisible({ timeout: 10_000 });
  const cardBox = (await card.boundingBox())!;
  const saveBox = (await save.boundingBox())!;
  const heading = (await page.getByText('Drawn game', { exact: true }).boundingBox())!;
  // In the flow under the heading, on the card's left — never the
  // absolute top-right corner the 和 seal takes on a win.
  expect(saveBox.y).toBeGreaterThanOrEqual(heading.y + heading.height);
  expect(saveBox.x).toBeLessThan(cardBox.x + cardBox.width / 2);
  expect(saveBox.height).toBeGreaterThanOrEqual(44);
  await save.dispatchEvent('click');
  await expect(page.getByRole('button', { name: 'Replay saved — tap to discard' })).toBeVisible();
  expect(errors, 'console / page errors').toEqual([]);
});

test('phone hand row: tile faces and glyph ink stay even across the row (no specular wash)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 412, height: 700 });
  const errors: string[] = [];
  await startSolo(page, errors);
  await waitForDealSettled(page);
  await page.waitForTimeout(600);
  // Near (front) row of the two-row held hand: the tiles the steep phone
  // camera looks at almost face-on, where the key light's specular lobe
  // used to wash the right-hand faces and grey their ink (round-FB3
  // feedback: "the hand tiles fade in colour towards the right").
  const boxes = await handTileBoxes(page);
  const rowY = Math.max(...boxes.map((b) => b.y));
  const near = boxes.filter((b) => Math.abs(b.y - rowY) < 8).sort((a, b) => a.x - b.x);
  expect(near.length).toBeGreaterThanOrEqual(5);
  const shot = await page.screenshot({ fullPage: false });
  const dpr = 2.625;
  const stats = await page.evaluate(
    async ({ png, rects, scale }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${png}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('no 2d context');
      ctx.drawImage(img, 0, 0);
      return rects.map((r) => {
        // Inner face: skip the bevel and the ring/lift margins.
        const x = Math.round((r.x + r.width * 0.2) * scale);
        const w = Math.round(r.width * 0.6 * scale);
        const y = Math.round((r.y + r.height * 0.25) * scale);
        const h = Math.round(r.height * 0.55 * scale);
        const d = ctx.getImageData(x, y, w, h).data;
        const lum: number[] = [];
        for (let i = 0; i < d.length; i += 4)
          lum.push(0.2126 * (d[i] ?? 0) + 0.7152 * (d[i + 1] ?? 0) + 0.0722 * (d[i + 2] ?? 0));
        lum.sort((a, b) => a - b);
        return {
          face: lum[Math.floor(lum.length * 0.85)] ?? 0,
          ink: lum[Math.floor(lum.length * 0.05)] ?? 0,
        };
      });
    },
    { png: shot.toString('base64'), rects: near, scale: dpr },
  );
  const faces = stats.map((s) => s.face);
  expect(
    Math.max(...faces) - Math.min(...faces),
    `face luminance ${faces.join(' ')}`,
  ).toBeLessThanOrEqual(12);
  // Ink darkness depends on the glyph colour (bamboo green vs. black
  // winds), so compare the darkest three tiles — the black-ink ones — to
  // each other: a specular wash lifts the right-most well above the rest.
  const inks = stats.map((s) => s.ink).sort((a, b) => a - b);
  expect((inks[2] ?? 0) - (inks[0] ?? 0), `ink luminance ${inks.join(' ')}`).toBeLessThanOrEqual(
    28,
  );
  expect(errors, 'console / page errors').toEqual([]);
});

type Box = { x: number; y: number; width: number; height: number };
const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Bounding boxes of the user's projected hand tiles (CSS px). */
async function handTileBoxes(page: Page): Promise<Box[]> {
  return page.getByTestId('own-hand-tile').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    }),
  );
}

/**
 * Start the `win` lesson (a complete 14-tile hand) and skip it, leaving
 * a solo match where the user has the declare-win CTA up and is one
 * discard away from tenpai.
 */
async function startWinHandSkipped(page: Page) {
  await page.goto('/');
  await page.waitForFunction(
    () =>
      typeof (globalThis as { __MAHJONG_TEST_START_TUTORIAL__?: unknown })
        .__MAHJONG_TEST_START_TUTORIAL__ === 'function',
    null,
    { timeout: 20_000 },
  );
  await page.evaluate(() => {
    (
      globalThis as { __MAHJONG_TEST_START_TUTORIAL__?: (id: string) => void }
    ).__MAHJONG_TEST_START_TUTORIAL__?.('win');
  });
  await expect(page.getByTestId('own-hand-tile').first()).toBeVisible({ timeout: 20_000 });
  const skip = page.getByRole('button', { name: 'Skip lesson' });
  await skip.waitFor({ timeout: 15_000 });
  await skip.dispatchEvent('click');
  await expect(page.getByTestId('tutorial-next')).toHaveCount(0);
}

test('desktop footer controls never sit on the hand row: CTA, tenpai badge, one turn target', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    (
      globalThis as { __MAHJONG_TEST_BOT_SCRIPTS__?: Record<number, object> }
    ).__MAHJONG_TEST_BOT_SCRIPTS__ = { 1: {}, 2: {}, 3: {} };
  });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await startWinHandSkipped(page);
  await page.waitForTimeout(900);
  // The declare CTA rides the footer row beside the turn chip — one row
  // under the hand, clear of every tile (round-FB1 critic #2: the CTA
  // row stacked above the chip climbed onto the tiles' bottom edge).
  const declare = page.getByRole('button', { name: /Declare win/ });
  await expect(declare).toBeVisible({ timeout: 15_000 });
  let tiles = await handTileBoxes(page);
  const declareBox = (await declare.boundingBox())!;
  expect(
    tiles.some((t) => overlaps(t, declareBox)),
    'declare CTA over a hand tile',
  ).toBe(false);
  expect(declareBox.y).toBeGreaterThanOrEqual(Math.max(...tiles.map((t) => t.y + t.height)) + 4);
  // The turn chip under the hand carries the `turn-countdown` target on
  // its own — the status pill's segment stands down, so the lesson
  // registry never sees two rects for one id.
  await expect(page.locator('[data-tutorial-target="turn-countdown"]')).toHaveCount(1);
  // The chip only exists while it is the user's turn (the bots below are
  // scripted to do nothing, so the discard hands the turn away for good):
  // take its row now and compare the badge against it after the discard.
  const chipBox = (await page.locator('[data-tutorial-target="turn-countdown"]').boundingBox())!;
  // Discard one tile: tenpai. The 聽 badge heads the footer's centre row
  // — under the hand, beside the turn chip — never the hand band and no
  // longer the far-left corner (round-FB2 critic #9).
  await page.getByTestId('own-hand-tile').first().dispatchEvent('click');
  const badge = page.getByTestId('ready-hand-badge');
  await expect(badge).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(600);
  tiles = await handTileBoxes(page);
  const badgeBox = (await badge.boundingBox())!;
  expect(
    tiles.some((t) => overlaps(t, badgeBox)),
    'tenpai badge over a hand tile',
  ).toBe(false);
  expect(badgeBox.y).toBeGreaterThanOrEqual(Math.max(...tiles.map((t) => t.y + t.height)) + 4);
  expect(badgeBox.y + badgeBox.height).toBeLessThanOrEqual(900 - 4);
  const handLeft = Math.min(...tiles.map((t) => t.x));
  const handRight = Math.max(...tiles.map((t) => t.x + t.width));
  expect(badgeBox.x + badgeBox.width / 2, 'badge centre under the hand').toBeGreaterThan(handLeft);
  expect(badgeBox.x + badgeBox.width / 2, 'badge centre under the hand').toBeLessThan(handRight);
  const badgeMid = badgeBox.y + badgeBox.height / 2;
  expect(badgeMid, 'badge shares the turn chip row').toBeGreaterThan(chipBox.y);
  expect(badgeMid, 'badge shares the turn chip row').toBeLessThan(chipBox.y + chipBox.height);
  // The discard hands the turn away and the lesson's scripted bot feeds
  // a chi, so the claim strip takes the slot from the chip. The badge
  // still heads that row: left of every claim button, same band.
  const strip = page.getByTestId('claim-float');
  await expect(strip.getByRole('button', { name: 'Pass' })).toBeVisible();
  const claimButtons = await strip
    .getByRole('button')
    .evaluateAll((els) =>
      els
        .map((el) => el.getBoundingClientRect())
        .map((r) => ({ x: r.left, y: r.top, h: r.height })),
    );
  expect(claimButtons.length).toBeGreaterThan(0);
  const stripLeft = Math.min(...claimButtons.map((b) => b.x));
  expect(badgeBox.x + badgeBox.width, 'badge heads the claim row').toBeLessThanOrEqual(
    stripLeft + 1,
  );
  for (const b of claimButtons) {
    expect(badgeMid, 'badge shares the claim row').toBeGreaterThan(b.y);
    expect(badgeMid, 'badge shares the claim row').toBeLessThan(b.y + b.h);
  }
  expect(badgeBox.height).toBeGreaterThanOrEqual(56);
  expect(errors, 'console / page errors').toEqual([]);
});

test('desktop claim strip stays in the void band under the hand', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
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
  await page.waitForTimeout(400);
  const tiles = await handTileBoxes(page);
  const barBox = (await bar.boundingBox())!;
  // The large strip (≤ 84 px) grows up from the 14 px footer pad and
  // stops ≥ 6 px short of the tiles' bottom edge.
  expect(
    tiles.some((t) => overlaps(t, barBox)),
    'claim strip over a hand tile',
  ).toBe(false);
  expect(barBox.y).toBeGreaterThanOrEqual(Math.max(...tiles.map((t) => t.y + t.height)) + 6);
  expect(barBox.height).toBeLessThanOrEqual(84);
  expect(barBox.y + barBox.height).toBeLessThanOrEqual(900 - 10);
  await expect(page.getByRole('button', { name: 'Peng' })).toBeVisible();
  expect(errors, 'console / page errors').toEqual([]);
});

test('phone portrait keeps the tenpai badge on screen through a claim window', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 915 });
  await page.addInitScript(() => {
    (
      globalThis as { __MAHJONG_TEST_BOT_SCRIPTS__?: Record<number, object> }
    ).__MAHJONG_TEST_BOT_SCRIPTS__ = { 1: {}, 2: {}, 3: {} };
  });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await startWinHandSkipped(page);
  await page.waitForTimeout(900);
  await page.getByTestId('own-hand-tile').first().dispatchEvent('click');
  const badge = page.getByTestId('ready-hand-badge');
  await expect(badge).toBeVisible({ timeout: 15_000 });
  // Script seat 1 to throw a face the user holds two of: the claim strip
  // takes the action tray, and the compact 聽 badge moves into the footer
  // row in the sort control's place (round-FB1 critic #5).
  await page.evaluate(() => {
    type T = { kind: string; suit?: string; rank?: number; honor?: string };
    const g = globalThis as {
      __MAHJONG_TEST_GET_STATE__?: () => { state: { hands: Record<number, T[]> }; you: number };
      __MAHJONG_TEST_BOT_SCRIPTS__?: Record<number, { discards?: T[] }>;
    };
    const s = g.__MAHJONG_TEST_GET_STATE__!();
    const key = (t: T) => (t.kind === 'suit' ? `s:${t.suit}:${t.rank}` : `h:${t.honor}`);
    const counts = new Map<string, number>();
    for (const t of s.state.hands[s.you]!) counts.set(key(t), (counts.get(key(t)) ?? 0) + 1);
    for (const seat of [1, 2, 3]) {
      const target = s.state.hands[seat]!.find((t) => (counts.get(key(t)) ?? 0) >= 2);
      if (!target) continue;
      g.__MAHJONG_TEST_BOT_SCRIPTS__ = {
        ...(g.__MAHJONG_TEST_BOT_SCRIPTS__ ?? {}),
        [seat]: { discards: [target] },
      };
      return;
    }
    throw new Error('no bot holds a face the user can peng');
  });
  const bar = page.getByTestId('claim-bar');
  await expect(bar).toBeVisible({ timeout: 20_000 });
  await expect(badge).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sort by Suit' })).toHaveCount(0);
  const badgeBox = (await badge.boundingBox())!;
  const barBox = (await bar.boundingBox())!;
  const tiles = await handTileBoxes(page);
  expect(overlaps(badgeBox, barBox), 'badge over the claim strip').toBe(false);
  expect(
    tiles.some((t) => overlaps(t, badgeBox)),
    'badge over a hand tile',
  ).toBe(false);
  expect(badgeBox.y + badgeBox.height).toBeLessThanOrEqual(915 - 4);
  expect(badgeBox.height).toBeLessThanOrEqual(46);
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

/** Rightmost own-hand hit-target (the honour singleton the lessons ask for). */
async function clickLastOwnTile(page: Page) {
  const tiles = page.getByTestId('own-hand-tile');
  await tiles.first().waitFor({ timeout: 20_000 });
  await tiles.last().dispatchEvent('click');
}

type EngineProbe = {
  state: {
    hands: Record<number, unknown[]>;
    deadWall: unknown[];
    melds: Record<number, { kind: string }[]>;
  };
};

test('phone landscape promoted-gang lesson reaches the promotion and draws the replacement from the dead wall', async ({
  page,
}) => {
  // Round-FB2 blocker: at 812–915 × 375–412 the lesson crashed (React
  // #185) before the CTA. The 3D table must carry the lesson through the
  // promotion: the fourth tile joins the meld, one tile leaves the dead
  // wall and lands in the hand, and nothing errors along the way.
  await page.setViewportSize({ width: 915, height: 412 });
  await page.addInitScript(() => {
    (globalThis as { __MAHJONG_TEST_BOT_PACE_MS__?: number }).__MAHJONG_TEST_BOT_PACE_MS__ = 200;
  });
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await page.waitForFunction(
    () =>
      typeof (globalThis as { __MAHJONG_TEST_START_TUTORIAL__?: unknown })
        .__MAHJONG_TEST_START_TUTORIAL__ === 'function',
    null,
    { timeout: 20_000 },
  );
  await page.evaluate(() => {
    (
      globalThis as { __MAHJONG_TEST_START_TUTORIAL__?: (id: string) => void }
    ).__MAHJONG_TEST_START_TUTORIAL__?.('promoted-gang');
  });
  await expect(page.getByTestId('own-hand-tile').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(900);
  await page.getByTestId('tutorial-next').first().dispatchEvent('click');
  await page.waitForTimeout(500);
  await clickLastOwnTile(page);
  await expect(page.getByTestId('claim-bar')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Peng' }).dispatchEvent('click');
  await expect(page.getByTestId('claim-bar')).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(900);
  await clickLastOwnTile(page);
  await expect(page.getByTestId('wall-draw-next')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('wall-draw-next').dispatchEvent('click');
  const promote = page.getByRole('button', { name: 'Promote gang' });
  await expect(promote).toBeVisible({ timeout: 15_000 });
  const probe = () =>
    page.evaluate(() => {
      const s = (globalThis as { __MAHJONG_TEST_GET_STATE__?: () => EngineProbe })
        .__MAHJONG_TEST_GET_STATE__!();
      return {
        hand: s.state.hands[0]!.length,
        dead: s.state.deadWall.length,
        melds: s.state.melds[0]!.map((m) => m.kind),
      };
    });
  const before = await probe();
  expect(before.dead).toBe(14);
  expect(before.melds).toEqual(['peng']);
  await promote.dispatchEvent('click');
  // The engine shifts `deadWall[0]` into the hand: the promoted tile
  // leaves the hand, the replacement arrives — the count holds while the
  // dead wall is one shorter and the meld is an open gang.
  await expect
    .poll(async () => JSON.stringify(await probe()), { timeout: 10_000 })
    .toBe(JSON.stringify({ hand: before.hand, dead: 13, melds: ['gang-promoted'] }));
  await expect(page.getByTestId('table-3d')).toBeVisible();
  const perf = await readPerf(page);
  expect(perf.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
  expect(errors, 'console / page errors').toEqual([]);
});

/**
 * Drive a solo match (seed 41, the user is dealer) to two claimed melds:
 * a peng fed by bot 1 and a single-shape chi fed by bot 3 (the seat
 * before the user — the only one a chi can come from), then discard so
 * the concealed hand is down to 7 tiles. Mirrors `scripts/shot-states.mjs`
 * `match-two-melds`. Bots are forced to pass so a coin-flip peng on the
 * user's discard cannot reorder the turns.
 */
async function driveTwoMelds(page: Page) {
  const claimBar = page.getByTestId('claim-bar');
  // Read the deal, script the two feeds and discard a tile that keeps
  // both the pair and the run in hand.
  await page.evaluate(() => {
    type T = { kind: string; suit?: string; rank?: number; honor?: string };
    const g = globalThis as {
      __MAHJONG_TEST_GET_STATE__?: () => { state: { hands: Record<number, T[]> }; you: number };
      __MAHJONG_TEST_BOT_SCRIPTS__?: Record<number, { discards?: T[] }>;
      __E2E_AVOID__?: string[];
    };
    const s = g.__MAHJONG_TEST_GET_STATE__!();
    const key = (t: T) => (t.kind === 'suit' ? `s:${t.suit}:${t.rank}` : `h:${t.honor}`);
    const mine = s.state.hands[s.you]!;
    const counts = new Map<string, number>();
    for (const t of mine) counts.set(key(t), (counts.get(key(t)) ?? 0) + 1);
    const bot1 = new Set(s.state.hands[1]!.map(key));
    const bot3 = new Set(s.state.hands[3]!.map(key));
    const peng = mine.find((t) => counts.get(key(t)) === 2 && bot1.has(key(t)))!;
    let chi: { suit: string; keep: number[]; tile: T } | null = null;
    for (const suit of ['man', 'pin', 'sou']) {
      const has = (r: number) => counts.get(`s:${suit}:${r}`) ?? 0;
      for (let r = 1; r <= 8 && !chi; r++) {
        if (has(r) !== 1 || has(r + 1) !== 1) continue;
        for (const x of [r - 1, r + 2]) {
          if (x < 1 || x > 9 || has(x) > 0 || !bot3.has(`s:${suit}:${x}`)) continue;
          const near = [x - 2, x - 1, x + 1, x + 2].filter((q) => q >= 1 && q <= 9 && has(q) > 0);
          if (near.length === 2) {
            chi = { suit, keep: [r, r + 1], tile: { kind: 'suit', suit, rank: x } };
            break;
          }
        }
      }
    }
    if (!chi) throw new Error('seed 41: no single-shape chi bot 3 can feed');
    g.__MAHJONG_TEST_BOT_SCRIPTS__![1] = { discards: [peng] };
    g.__MAHJONG_TEST_BOT_SCRIPTS__![3] = { discards: [chi.tile] };
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
    g.__E2E_AVOID__ = [name(peng), ...chi.keep.map((r) => `${r} ${chi!.suit}`)];
  });
  const discardKeeping = () =>
    page.evaluate(() => {
      const avoid = (globalThis as { __E2E_AVOID__?: string[] }).__E2E_AVOID__ ?? [];
      const btn = Array.from(
        document.querySelectorAll<HTMLElement>('[data-testid="own-hand-tile"]'),
      ).find((b) => !avoid.some((a) => (b.getAttribute('aria-label') || '').startsWith(a)))!;
      btn.click();
    });
  await discardKeeping();
  await expect(claimBar).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'Peng', exact: true }).click();
  await expect(claimBar).toBeHidden({ timeout: 10_000 });
  await page.waitForTimeout(400);
  await discardKeeping();
  await expect(page.getByRole('button', { name: 'Chi', exact: true })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Chi', exact: true }).click();
  await expect(claimBar).toBeHidden({ timeout: 10_000 });
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const g = globalThis as {
            __MAHJONG_TEST_GET_STATE__?: () => {
              state: {
                hands: Record<number, unknown[]>;
                melds: Record<number, { kind: string }[]>;
              };
            };
          };
          const s = g.__MAHJONG_TEST_GET_STATE__!().state;
          return `${s.melds[0]!.map((m) => m.kind).join('+')}:${s.hands[0]!.length}`;
        }),
      { timeout: 10_000 },
    )
    .toBe('peng+chi:8');
  await page.waitForTimeout(400);
  // Discard to 7 concealed tiles.
  await page.getByTestId('own-hand-tile').first().click();
}

/** Wait for the user's draw cue, passing any incidental claim window on the way. */
async function waitForDrawCuePassing(page: Page, timeoutMs = 30_000) {
  const cue = page.getByTestId('wall-draw-next').first();
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cue.isVisible().catch(() => false)) return;
    const pass = page.getByRole('button', { name: 'Pass', exact: true }).first();
    if (await pass.isVisible().catch(() => false))
      await pass.click({ timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(250);
  }
  await expect(cue).toBeVisible({ timeout: 1 });
}

/**
 * Round-4 feedback: with two melds out the hand is 7 tiles, 8 once the
 * next tile is drawn — and the held hand kept up to 8 on one row while
 * the frame is sized for 7 (six at pitch + the drawn tile with its gap),
 * so the row overflowed both edges and the outer tiles were only half
 * visible. The split is now decided from the hand with the drawn slot
 * reserved: 7 → 4 + 3, 8 → 4 + 4, every tile inside the viewport, and
 * the row count does not flip between the discard and the next draw.
 */
for (const [w, h] of [
  [412, 700],
  [360, 640],
] as const) {
  test(`phone in a browser (${w}×${h}): a 7-tile hand splits into two rows and the drawn tile stays on screen`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: w, height: h });
    await page.addInitScript(() => {
      const g = globalThis as {
        __MAHJONG_TEST_SEED__?: number;
        __MAHJONG_TEST_BOT_SCRIPTS__?: Record<number, object>;
        __MAHJONG_TUTORIAL_FORCE_PASS__?: boolean;
      };
      g.__MAHJONG_TEST_SEED__ = 41;
      g.__MAHJONG_TEST_BOT_SCRIPTS__ = { 1: {}, 2: {}, 3: {} };
      g.__MAHJONG_TUTORIAL_FORCE_PASS__ = true;
    });
    const errors: string[] = [];
    await startSolo(page, errors);
    await waitForDealSettled(page);
    await driveTwoMelds(page);
    const tiles = page.getByTestId('own-hand-tile');
    await expect(tiles).toHaveCount(7);
    await waitForDealSettled(page);
    // Row sizes, back row first: tiles whose tops are within half a tile
    // height (20 px) of each other share a row — a fixed 20 px bucket
    // split one row across a boundary at 360 px wide.
    const rowsOf = (boxes: Box[]) => {
      const rows: number[][] = [];
      for (const y of boxes.map((b) => b.y).sort((a, b) => a - b)) {
        const row = rows[rows.length - 1];
        if (row && y - row[0]! < 20) row.push(y);
        else rows.push([y]);
      }
      return rows.map((r) => r.length);
    };
    const inside = (boxes: Box[]) => {
      for (const b of boxes) {
        expect(b.width).toBeGreaterThanOrEqual(44);
        expect(b.x).toBeGreaterThanOrEqual(0);
        expect(b.x + b.width).toBeLessThanOrEqual(w);
        expect(b.y).toBeGreaterThanOrEqual(0);
        expect(b.y + b.height).toBeLessThanOrEqual(h);
      }
    };
    const seven = await handTileBoxes(page);
    inside(seven);
    expect(rowsOf(seven), '7 tiles: two rows (4 + 3)').toEqual([4, 3]);
    // Draw: 8 tiles, still two rows (4 + 4), the drawn tile on screen.
    await waitForDrawCuePassing(page);
    await page.getByTestId('wall-draw-next').first().click();
    await expect(tiles).toHaveCount(8);
    await waitForDealSettled(page);
    const eight = await handTileBoxes(page);
    inside(eight);
    expect(rowsOf(eight), '8 tiles: two rows (4 + 4)').toEqual([4, 4]);
    await expect(
      page.locator('[data-testid="own-hand-tile"][aria-label*="just drawn"]'),
    ).toHaveCount(1);
    expect(errors, 'console / page errors').toEqual([]);
  });
}
