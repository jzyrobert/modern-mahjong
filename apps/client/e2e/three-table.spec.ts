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
  const chipBox = (await page.locator('[data-tutorial-target="turn-countdown"]').boundingBox())!;
  const badgeMid = badgeBox.y + badgeBox.height / 2;
  expect(badgeMid, 'badge shares the turn chip row').toBeGreaterThan(chipBox.y);
  expect(badgeMid, 'badge shares the turn chip row').toBeLessThan(chipBox.y + chipBox.height);
  expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(chipBox.x + 1);
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
    .toBe(JSON.stringify({ hand: before.hand, dead: 13, melds: ['gang-open'] }));
  await expect(page.getByTestId('table-3d')).toBeVisible();
  const perf = await readPerf(page);
  expect(perf.drawCalls).toBeLessThanOrEqual(BUDGET.drawCalls);
  expect(errors, 'console / page errors').toEqual([]);
});
