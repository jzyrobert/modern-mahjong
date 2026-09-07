import { inflateSync } from 'node:zlib';
import { type Rgb, gradientDeltaE, hexToRgb, luminance } from '../src/three/settings/colorMath';
import {
  SHEET_CUE_STRIP_ALPHA,
  SHEET_CUE_STRIP_PX,
  SHEET_PHONE_MAX_FRAC,
} from '../src/ui/match/sheetLayout';
import { GLASS_SWITCH } from '../src/ui/match/sheetTheme';
import { TILE_BACK_SKINS } from '../src/ui/match/skins';
import { expect, test } from './_helpers';

/**
 * Settings subsystem (3D render layer): glass panel + live WebGL
 * preview. Runs on the classic shells (pinned by `_helpers`) so the
 * preview is the only canvas on the page and `__MAHJONG_PERF__` is
 * unambiguously its telemetry.
 *
 * Budget (ARCHITECTURE.md §4, settings preview): ≤ 8 draw calls; the
 * verifier's SwiftShader frame time is not gated here.
 */
// `__MAHJONG_PERF__` is declared globally by `src/three/core/perf.ts`
// (same tsconfig program), so page-side reads type-check as-is.

const TEST_SEED = 5;

test.beforeEach(async ({ page }) => {
  await page.addInitScript((seed) => {
    (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
  }, TEST_SEED);
});

async function dismissDice(page: import('@playwright/test').Page, wait = 4_000) {
  // The opening-rolls overlay swallows the first tap — dismiss it so
  // the menu trigger receives the click.
  const hint = page.getByText('Tap anywhere to dismiss', { exact: true });
  if (await hint.isVisible({ timeout: wait }).catch(() => false)) {
    await hint.click().catch(() => {});
    await hint.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
  }
}

async function startSolo(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await page.getByTestId('own-hand-tile').first().waitFor({ timeout: 20_000 });
  await dismissDice(page);
}

async function openSettings(page: import('@playwright/test').Page) {
  // Retry: under heavy CI load the dice overlay can land after the
  // first dismiss attempt and eat the menu tap.
  for (let attempt = 0; attempt < 6; attempt++) {
    await dismissDice(page, 500);
    // Bounded click: if the dice overlay lands mid-tap and intercepts
    // the pointer, fall through to the next attempt instead of eating
    // the whole test timeout.
    const opened = await page
      .getByLabel('Open menu')
      .first()
      .click({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (!opened) continue;
    const row = page.getByTestId('open-settings');
    // `waitFor` (see `openMenuRow`): `isVisible` never waits.
    const shown = await row
      .waitFor({ state: 'visible', timeout: 6_000 })
      .then(() => true)
      .catch(() => false);
    if (shown) {
      await row.click();
      await expect(page.getByTestId('settings-panel')).toBeVisible();
      return;
    }
  }
  throw new Error('settings entry never appeared');
}

async function waitForPerfSample(page: import('@playwright/test').Page, min: number) {
  await page.waitForFunction((n) => (globalThis.__MAHJONG_PERF__?.sample ?? 0) >= n, min, {
    timeout: 15_000,
  });
  const perf = await page.evaluate(() => globalThis.__MAHJONG_PERF__ ?? null);
  if (!perf) throw new Error('perf never published');
  return perf;
}

/**
 * Colour of one CSS pixel, read from a 1×1 clip screenshot. A 1×1 PNG
 * has a single scanline whose filter byte is irrelevant (no left / up
 * neighbours), so the decoded IDAT is `[filter, r, g, b(, a)]`.
 */
async function samplePixel(
  page: import('@playwright/test').Page,
  x: number,
  y: number,
): Promise<Rgb> {
  const png = await page.screenshot({ clip: { x, y, width: 1, height: 1 }, scale: 'css' });
  let off = 8;
  const idat: Buffer[] = [];
  let channels = 3;
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    const type = png.toString('latin1', off + 4, off + 8);
    const data = png.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 1;
    if (type === 'IDAT') idat.push(Buffer.from(data));
    if (type === 'IEND') break;
    off += 12 + len;
  }
  const row = inflateSync(Buffer.concat(idat));
  if (channels === 1) return [row[1] ?? 0, row[1] ?? 0, row[1] ?? 0];
  return [row[1] ?? 0, row[2] ?? 0, row[3] ?? 0];
}

/** Median of the 3×3 samples around (x, y) — robust to a single edge pixel. */
async function sampleArea(
  page: import('@playwright/test').Page,
  x: number,
  y: number,
): Promise<Rgb> {
  const out: Rgb[] = [];
  for (const dx of [-2, 0, 2])
    for (const dy of [-2, 0, 2]) out.push(await samplePixel(page, x + dx, y + dy));
  const med = (i: 0 | 1 | 2) => out.map((c) => c[i]).sort((a, b) => a - b)[4] ?? 0;
  return [med(0), med(1), med(2)];
}

/**
 * Scroll the sheet back to the top (Playwright scrolls far-down chips
 * into view) and wait until the preview's box stops moving (the bottom
 * sheet slides in), so pixel samples line up with the box we measure.
 */
async function settledPreviewBox(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    for (const el of Array.from(document.querySelectorAll('*'))) {
      if (el.scrollTop > 0) el.scrollTop = 0;
    }
  });
  const preview = page.getByTestId('settings-preview-3d');
  let last = await preview.boundingBox();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(150);
    const next = await preview.boundingBox();
    if (last && next && Math.abs(next.y - last.y) < 0.5 && Math.abs(next.x - last.x) < 0.5) {
      return next;
    }
    last = next;
  }
  throw new Error('preview never settled');
}

/**
 * Where the face-down tile's centre lands inside the preview box (the
 * stage is static on the low tier the headless GL reports, so the
 * position is deterministic). Fractions of the preview's width / height.
 */
const BACK_TILE_AT = { x: 0.665, y: 0.4 };

function collectErrors(page: import('@playwright/test').Page) {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));
  return errors;
}

test.describe('3D settings panel', () => {
  test('phone: panel controls, live preview and perf budget', async ({ page }) => {
    // ~40 clip screenshots of colour sampling on SwiftShader.
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 412, height: 915 });
    await startSolo(page);
    await openSettings(page);

    // Live preview canvas is mounted inside the panel.
    const preview = page.getByTestId('settings-preview-3d');
    await expect(preview).toBeVisible();
    await expect(preview.locator('canvas')).toBeVisible();

    // Every control exists as DOM with stable testids / roles.
    for (const id of ['renderer-auto', 'renderer-3d', 'renderer-classic']) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    for (const id of ['quality-auto', 'quality-low', 'quality-mid', 'quality-high']) {
      await expect(page.getByTestId(id)).toBeVisible();
    }
    await expect(page.getByText('3D needs WebGL2; Classic is the original table.')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Felt skin: Jade' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Tile back skin: Plum' })).toBeVisible();
    await expect(page.getByTestId('renderer-auto')).toHaveAttribute('aria-checked', 'true');

    // Behaviour switches (the discard-hint spec depends on this shape).
    for (const label of ['Sound effects', 'Animations', 'Discard hint', 'Auto-record replays']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(
      page.getByTestId('toggle-discard-hint').locator('input[type="checkbox"]'),
    ).toHaveCount(1);

    // Perf within the settings preview budget.
    const perf = await waitForPerfSample(page, 2);
    expect(perf.drawCalls).toBeLessThanOrEqual(8);
    expect(perf.triangles).toBeLessThan(20_000);
    expect(perf.programs).toBeLessThanOrEqual(14);

    // Skin change re-tints live: the store updates and the canvas is
    // the same element (no scene rebuild).
    await preview.locator('canvas').evaluate((c) => c.setAttribute('data-probe', 'same'));
    await page.getByRole('radio', { name: 'Felt skin: Jade' }).click();
    await page.getByRole('radio', { name: 'Tile back skin: Plum' }).click();
    const settings = await page.evaluate(() => {
      const g = globalThis as { __MAHJONG_TEST_GET_STATE__?: () => { settings: unknown } };
      return g.__MAHJONG_TEST_GET_STATE__?.().settings as { felt: string; tileBack: string };
    });
    expect(settings.felt).toBe('jade');
    expect(settings.tileBack).toBe('plum');
    await expect(preview.locator('canvas')).toHaveAttribute('data-probe', 'same');
    await expect(page.getByRole('radio', { name: 'Felt skin: Jade' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // The face-down tile shows the chosen back skin true to the chip:
    // its centre lands within ΔE 5 of the skin's gradient (round 1 was
    // ΔE 11 — washed toward white by the glossy lighting stack).
    await page.waitForFunction(() => globalThis.__MAHJONG_PERF__?.idle === true, null, {
      timeout: 10_000,
    });
    const box = await settledPreviewBox(page);
    const plum = TILE_BACK_SKINS.plum;
    const back = await sampleArea(
      page,
      Math.round(box.x + box.width * BACK_TILE_AT.x),
      Math.round(box.y + box.height * BACK_TILE_AT.y),
    );
    expect(
      gradientDeltaE(back, hexToRgb(plum.top), hexToRgb(plum.bottom)),
      `back rgb(${back.join(',')}) vs plum ${plum.top}→${plum.bottom}`,
    ).toBeLessThan(5);
    // …and at both edges, not just the centre (round-2 critic: the far
    // edge read cooler than the chip).
    for (const fy of [BACK_TILE_AT.y - 0.05, BACK_TILE_AT.y + 0.035]) {
      const edge = await sampleArea(
        page,
        Math.round(box.x + box.width * BACK_TILE_AT.x),
        Math.round(box.y + box.height * fy),
      );
      expect(
        gradientDeltaE(edge, hexToRgb(plum.top), hexToRgb(plum.bottom)),
        `back edge rgb(${edge.join(',')}) at y ${fy} vs plum`,
      ).toBeLessThan(5);
    }

    // Composed stage: parlour void shows beneath the near rail (not wood
    // running into the frame edge) — dark and not brown.
    const below = await sampleArea(
      page,
      Math.round(box.x + box.width / 2),
      Math.round(box.y + box.height - 8),
    );
    expect(luminance(below), `void rgb(${below.join(',')})`).toBeLessThan(0.02);
    expect(below[0]).toBeLessThanOrEqual(below[1] + 4);
    // …and either side of the rail at its widest point (round-2 critic:
    // the rounded corners ran into the frame's left and right edges).
    for (const x of [box.x + 4, box.x + box.width - 5]) {
      const side = await sampleArea(page, Math.round(x), Math.round(box.y + box.height * 0.78));
      expect(luminance(side), `void rgb(${side.join(',')}) at x ${x}`).toBeLessThan(0.02);
    }
    // The LIVE PREVIEW badge floats in the void top-left, 11 px label.
    const badge = page.getByTestId('settings-preview-badge');
    const badgeBox = await badge.boundingBox();
    if (!badgeBox) throw new Error('badge has no box');
    expect(badgeBox.y - box.y).toBeLessThan(20);
    expect(badgeBox.x - box.x).toBeLessThan(20);
    expect(await badge.evaluate((el) => getComputedStyle(el).fontSize)).toBe('11px');
    // …and the far rail's top edge stays ≥ 6 px under the pill along its
    // whole width (round-1 critic: the pill's lower third sat on the wood
    // at the rail's rounded corner). Void, not wood, 5 px below the pill.
    for (const fx of [0.1, 0.5, 0.9]) {
      const under = await sampleArea(
        page,
        Math.round(badgeBox.x + badgeBox.width * fx),
        Math.round(badgeBox.y + badgeBox.height + 5),
      );
      expect(luminance(under), `under badge rgb(${under.join(',')}) at ${fx}`).toBeLessThan(0.02);
      expect(under[0]).toBeLessThanOrEqual(under[1] + 4);
    }
    // The status pill reads "Classic active" here (the legacy fixture
    // pins the classic shells) — either label is the same 11 px pill.
    expect(
      await page.getByText(/^(3D|Classic) active$/).evaluate((el) => getComputedStyle(el).fontSize),
    ).toBe('11px');

    // Renderer control writes through to the store.
    await page.getByTestId('renderer-classic').click();
    const renderer = await page.evaluate(() => {
      const g = globalThis as { __MAHJONG_TEST_GET_STATE__?: () => { settings: unknown } };
      return (g.__MAHJONG_TEST_GET_STATE__?.().settings as { renderer: string }).renderer;
    });
    expect(renderer).toBe('classic');
    await expect(page.getByText('Classic active')).toBeVisible();

    expect(errors).toEqual([]);
  });

  for (const width of [412, 360]) {
    test(`phone ${width}: every skin label sits inside its pill`, async ({ page }) => {
      // Round-1 feedback: "Cream" popped out of its pill on phones — the
      // chips took a fixed share of the row regardless of their label.
      const errors = collectErrors(page);
      await page.setViewportSize({ width, height: width === 360 ? 640 : 915 });
      await startSolo(page);
      await openSettings(page);
      const ids = [
        ...Object.keys(TILE_BACK_SKINS).map((k) => `tileback-${k}`),
        'felt-sage',
        'felt-jade',
        'felt-ocean',
        'felt-rose',
      ];
      const widths = new Map<string, number[]>();
      for (const id of ids) {
        const chip = page.getByTestId(id);
        await chip.scrollIntoViewIfNeeded();
        const box = await chip.boundingBox();
        const label = await chip.locator('div[dir="auto"]').last().boundingBox();
        if (!box || !label) throw new Error(`${id} has no box`);
        // Label fully inside the pill with its 14 px right padding intact
        // (border + padding = 16; allow 2 px of sub-pixel slack).
        expect(label.x, `${id} label left`).toBeGreaterThanOrEqual(box.x);
        expect(label.x + label.width, `${id} label right`).toBeLessThanOrEqual(
          box.x + box.width - 12,
        );
        expect(label.height, `${id} label wraps`).toBeLessThan(24);
        const group = id.split('-')[0] ?? id;
        widths.set(group, [...(widths.get(group) ?? []), Math.round(box.width)]);
      }
      // Every chip in a row is the same width (even grid, no ragged rows).
      for (const [group, ws] of widths) {
        expect(new Set(ws).size, `${group} chip widths ${ws.join(',')}`).toBe(1);
      }
      expect(errors).toEqual([]);
    });
  }

  test('desktop: right-hand sheet, open/close ×5 leaks nothing', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await startSolo(page);

    for (let i = 0; i < 5; i++) {
      await openSettings(page);
      const preview = page.getByTestId('settings-preview-3d');
      await expect(preview.locator('canvas')).toBeVisible();
      if (i === 0) {
        // Docked to the right edge, full height.
        const box = await page.getByTestId('settings-panel').boundingBox();
        if (!box) throw new Error('settings panel has no box');
        expect(box.x + box.width).toBeGreaterThan(1400);
        expect(box.x).toBeGreaterThan(900);
        // dpr-1 desktop: the small canvas supersamples 2× (`minDpr`) so
        // tile edges and glyph strokes don't stair-step.
        const canvas = preview.locator('canvas');
        const [backing, css] = await canvas.evaluate((c: HTMLCanvasElement) => [
          c.width,
          c.getBoundingClientRect().width,
        ]);
        expect(backing).toBeGreaterThanOrEqual(Math.floor(css * 2) - 2);
        // Pointer hover lifts skin chips and segments by 1 px (160 ms).
        const chip = page.getByRole('radio', { name: 'Felt skin: Jade' });
        await chip.hover();
        await expect
          .poll(() => chip.evaluate((el) => getComputedStyle(el).transform), { timeout: 2000 })
          .toContain('-1)');
        const seg = page.getByTestId('quality-high');
        await seg.hover();
        await expect
          .poll(() => seg.evaluate((el) => getComputedStyle(el).transform), { timeout: 2000 })
          .toContain('-1)');
        await page.mouse.move(5, 5);
      }
      await waitForPerfSample(page, 1);
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(preview).toBeHidden({ timeout: 5_000 });
    }
    // The perf global is cleared on dispose — the last preview is gone.
    const perfAfter = await page.evaluate(() => globalThis.__MAHJONG_PERF__ ?? null);
    expect(perfAfter).toBeNull();
    expect(errors).toEqual([]);
  });

  test('phone landscape: letterbox preview keeps both rails in frame', async ({ page }) => {
    test.setTimeout(60_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 915, height: 412 });
    await startSolo(page);
    await openSettings(page);
    const preview = page.getByTestId('settings-preview-3d');
    await expect(preview.locator('canvas')).toBeVisible();
    await waitForPerfSample(page, 2);
    await page.waitForFunction(() => globalThis.__MAHJONG_PERF__?.idle === true, null, {
      timeout: 10_000,
    });
    const box = await settledPreviewBox(page);
    expect(box.width / box.height).toBeGreaterThan(3);
    // Short sheets grow the stage to 170 px (round-2 critic: ~45 % void).
    expect(box.height).toBeGreaterThanOrEqual(168);
    // Void above the far rail and below the near rail — the vertical fov
    // is floored for letterbox canvases instead of cropping the rails.
    const cx = Math.round(box.x + box.width / 2);
    const top = await sampleArea(page, cx, Math.round(box.y + 5));
    const bottom = await sampleArea(page, cx, Math.round(box.y + box.height - 6));
    expect(luminance(top), `top rgb(${top.join(',')})`).toBeLessThan(0.02);
    expect(luminance(bottom), `bottom rgb(${bottom.join(',')})`).toBeLessThan(0.02);
    // …and the felt is still there between them.
    const mid = await sampleArea(
      page,
      Math.round(box.x + box.width * 0.5),
      Math.round(box.y + box.height * 0.62),
    );
    expect(mid[1], `felt rgb(${mid.join(',')})`).toBeGreaterThan(mid[0]);
    expect(errors).toEqual([]);
  });

  test('reduced motion: preview goes render-on-demand idle', async ({ page }) => {
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 412, height: 915 });
    await page.addInitScript(() => {
      try {
        const key = 'mj.settings.v1';
        const cur = JSON.parse(localStorage.getItem(key) || '{}');
        localStorage.setItem(key, JSON.stringify({ ...cur, animations: false }));
      } catch {
        /* private mode */
      }
    });
    await startSolo(page);
    await openSettings(page);
    await expect(page.getByTestId('settings-preview-3d').locator('canvas')).toBeVisible();
    // With animations off nothing sways, so after the first sample the
    // loop must report idle with zero renders in the last second.
    await waitForPerfSample(page, 2);
    await page.waitForFunction(
      () => {
        const p = globalThis.__MAHJONG_PERF__;
        return !!p && p.sample >= 3 && p.idle && p.fps === 0;
      },
      null,
      { timeout: 10_000 },
    );
    const perf = await page.evaluate(() => globalThis.__MAHJONG_PERF__);
    expect(perf?.drawCalls ?? 99).toBeLessThanOrEqual(8);
    expect(errors).toEqual([]);
  });
});

/**
 * In-match sheets under the 3D renderer: `MatchModals` resolves the
 * glass theme from the renderer, so the ☰ menu, game log, tile
 * reference, scoring rules, players roster and scoring breakdown must
 * all render as dark glass (round-1 feedback: they were still paper).
 * The classic pin from `_helpers` is re-pinned to `'3d'` here.
 */
test.describe('3D in-match sheets', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      (globalThis as { __MAHJONG_TEST_RENDERER__?: '3d' | 'classic' }).__MAHJONG_TEST_RENDERER__ =
        '3d';
    });
  });

  const GLASS_ROW = 'rgba(255, 255, 255, 0.06)';
  const GLASS_TEXT = 'rgba(255, 255, 255, 0.92)';

  async function openMenuRow(page: import('@playwright/test').Page, row: string) {
    for (let attempt = 0; attempt < 6; attempt++) {
      await dismissDice(page, 500);
      const opened = await page
        .getByLabel('Open menu')
        .first()
        .click({ timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (!opened) continue;
      const btn = page.getByRole('button', { name: row, exact: true });
      // `waitFor`, not `isVisible` — the latter never waits, and the side
      // panel mounts its rows a frame after the tap; a false negative
      // sent the retry's ☰ tap straight back to close the panel.
      const shown = await btn
        .waitFor({ state: 'visible', timeout: 6_000 })
        .then(() => true)
        .catch(() => false);
      if (shown) {
        await btn.click();
        return;
      }
    }
    throw new Error(`menu row ${row} never appeared`);
  }

  async function closeSheet(page: import('@playwright/test').Page) {
    // The newest dialog: the menu sheet's exit animation can still hold
    // its own Close button while the sheet it opened fades in.
    await page
      .locator('[aria-modal="true"]')
      .last()
      .getByRole('button', { name: 'Close', exact: true })
      .click();
    await expect(page.locator('[aria-modal="true"]')).toHaveCount(0, { timeout: 5_000 });
  }

  test('phone: menu, tile reference, log, scoring rules and players are glass', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 412, height: 915 });
    await startSolo(page);
    await expect(page.getByTestId('table-3d-scene')).toBeVisible({ timeout: 20_000 });

    // ☰ menu: glass rows with inline SVG glyphs (no emoji in the 3D flow).
    await openMenuRow(page, 'Tile reference');
    // (the menu closes as the row opens its sheet; check the row's
    // chrome on the next open below)
    await expect(page.getByText('Characters (Man)')).toBeVisible();
    await expect(page.getByText('萬子', { exact: true })).toBeVisible();
    expect(
      await page
        .getByText('Tile reference', { exact: true })
        .evaluate((el) => getComputedStyle(el).color),
    ).toBe(GLASS_TEXT);
    await closeSheet(page);

    await dismissDice(page, 300);
    await page.getByLabel('Open menu').first().click();
    // Scoped to the open sheet: the HUD gear carries the same testid.
    const row = page.locator('[aria-modal="true"] [data-testid="open-settings"]');
    await expect(row).toBeVisible();
    expect(await row.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(GLASS_ROW);
    expect(await row.locator('svg').count()).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Game log', exact: true }).click();
    await expect(page.getByText('Last actions', { exact: true })).toBeVisible();
    expect(
      await page
        .getByText('Last actions', { exact: true })
        .evaluate((el) => getComputedStyle(el).color),
    ).toBe(GLASS_TEXT);
    await closeSheet(page);

    // Scoring rules: glass accordion — first category open, tapping
    // another swaps the expanded section.
    await openMenuRow(page, 'Scoring rules');
    const first = page.getByTestId('scoring-cat-win-condition');
    await expect(first).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('自摸', { exact: true })).toBeVisible();
    await page.getByTestId('scoring-cat-composition').click();
    await expect(first).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('scoring-cat-composition')).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    await expect(page.getByText('自摸', { exact: true })).toBeHidden();
    await closeSheet(page);

    // Players roster from the status pill.
    await dismissDice(page, 300);
    await page.getByLabel('Open players panel').first().click();
    await expect(page.getByText('Players', { exact: true })).toBeVisible();
    await expect(page.getByText('East · seat 0')).toBeVisible();
    expect(
      await page.getByText('Players', { exact: true }).evaluate((el) => getComputedStyle(el).color),
    ).toBe(GLASS_TEXT);
    await closeSheet(page);

    expect(errors).toEqual([]);
  });

  /** The sheet card (title row's grandparent) as a bounding box. */
  async function sheetCardBox(page: import('@playwright/test').Page, title: string) {
    // Newest dialog only: the ☰ sheet that opened this one can still be
    // fading out with a same-named row button.
    const card = page
      .locator('[aria-modal="true"]')
      .last()
      .getByText(title, { exact: true })
      .locator('..')
      .locator('..');
    const box = await card.boundingBox();
    if (!box) throw new Error(`missing sheet card for ${title}`);
    return box;
  }

  test('desktop: players and game log open as centred glass panels, not phone sheets', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await startSolo(page);
    await expect(page.getByTestId('table-3d-scene')).toBeVisible({ timeout: 20_000 });

    await dismissDice(page, 300);
    await page.getByLabel('Open players panel').first().click();
    await expect(page.getByText('East · seat 0')).toBeVisible();
    // Centred on the canvas with air below it — a bottom sheet pasted
    // onto a 1440 × 900 canvas was the round-5 settings critic's lead.
    let box = await sheetCardBox(page, 'Players');
    expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThanOrEqual(4);
    expect(box.y).toBeGreaterThanOrEqual(40);
    expect(box.y + box.height).toBeLessThanOrEqual(900 - 40);
    expect(box.width).toBeLessThanOrEqual(520);
    await closeSheet(page);

    await openMenuRow(page, 'Game log');
    await expect(page.getByText('Last actions', { exact: true })).toBeVisible();
    box = await sheetCardBox(page, 'Last actions');
    expect(Math.abs(box.x + box.width / 2 - 720)).toBeLessThanOrEqual(4);
    expect(box.y + box.height).toBeLessThanOrEqual(900 - 40);
    await closeSheet(page);
    expect(errors).toEqual([]);
  });

  test('phone landscape: a long sheet body cues its fold and clears the cue at the end', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 915, height: 412 });
    await startSolo(page);
    await expect(page.getByTestId('table-3d-scene')).toBeVisible({ timeout: 20_000 });
    // Still a bottom sheet on a landscape phone (wide, but short).
    await openMenuRow(page, 'Scoring rules');
    await expect(page.getByTestId('scoring-cat-win-condition')).toBeVisible();
    const box = await sheetCardBox(page, 'Scoring rules');
    expect(box.y + box.height).toBeGreaterThanOrEqual(412 - 1);
    // The catalogue overflows the 90 %-height sheet: the fold is marked.
    const cue = page.getByTestId('sheet-scroll-cue');
    await expect(cue).toBeVisible();
    const cueBox = await cue.boundingBox();
    if (!cueBox) throw new Error('missing cue box');
    expect(cueBox.y + cueBox.height).toBeLessThanOrEqual(box.y + box.height);
    // Scrolled to the end, nothing is hidden and the cue goes.
    await page.getByTestId('scoring-rules-body').evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(cue).toHaveCount(0, { timeout: 5_000 });
    await closeSheet(page);
    expect(errors).toEqual([]);
  });

  test('phone: the fold chevron sits on an opaque strip the copy scrolls under, and the sheet stops at 78 %', async ({
    page,
  }) => {
    test.setTimeout(150_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 412, height: 700 });
    await startSolo(page);
    await expect(page.getByTestId('table-3d-scene')).toBeVisible({ timeout: 20_000 });
    await openMenuRow(page, 'Scoring rules');
    await expect(page.getByTestId('scoring-cat-win-condition')).toBeVisible();
    // The catalogue overflows: the sheet is capped at 78 % of the
    // viewport (round-6 settings critic: it had crept up to 90 %), flush
    // with the bottom edge.
    const card = await sheetCardBox(page, 'Scoring rules');
    expect(card.y + card.height).toBeGreaterThanOrEqual(700 - 1.5);
    expect(Math.abs(card.height - 700 * SHEET_PHONE_MAX_FRAC)).toBeLessThanOrEqual(3);
    // The fold cue's lower band is a flat ≥ 0.94-alpha strip of the sheet
    // fill and the chevron lies wholly inside it.
    const cue = page.getByTestId('sheet-scroll-cue');
    await expect(cue).toBeVisible();
    const cueBox = await cue.boundingBox();
    const chevron = await page.getByTestId('sheet-scroll-chevron').boundingBox();
    if (!cueBox || !chevron) throw new Error('missing cue boxes');
    const gradient = await cue.evaluate((el) => getComputedStyle(el).backgroundImage);
    expect(gradient).toContain(`rgba(14, 20, 17, ${SHEET_CUE_STRIP_ALPHA}) 100%`);
    expect(gradient).toContain(`rgba(14, 20, 17, ${SHEET_CUE_STRIP_ALPHA}) 60%`);
    const stripTop = cueBox.y + cueBox.height - SHEET_CUE_STRIP_PX;
    // The 9 px box turns 45°, so its glyph spans ~13 px around its centre.
    const chevronCy = chevron.y + chevron.height / 2;
    expect(chevronCy - 6.5).toBeGreaterThanOrEqual(stripTop - 0.5);
    expect(chevronCy + 6.5).toBeLessThanOrEqual(cueBox.y + cueBox.height + 0.5);
    // Scroll a text row under the strip and read the strip either side of
    // the chevron: the sheet's own dark fill, not the copy (round-6: the
    // 40 px ramp left the last row ~60 % visible under the glyph).
    await page.getByTestId('scoring-rules-body').evaluate((el) => {
      el.scrollTop = 140;
    });
    await page.waitForTimeout(300);
    await expect(cue).toBeVisible();
    for (const dx of [-16, 16]) {
      const px = await sampleArea(
        page,
        Math.round(chevron.x + chevron.width / 2 + dx),
        Math.round(chevronCy),
      );
      expect(Math.max(...px), `strip rgb(${px.join(',')}) at ${dx}`).toBeLessThanOrEqual(48);
    }
    await closeSheet(page);
    // A short body is content-sized — the cap is a ceiling, not a height.
    await dismissDice(page, 300);
    await page.getByLabel('Open players panel').first().click();
    await expect(page.getByText('East · seat 0')).toBeVisible();
    const players = await sheetCardBox(page, 'Players');
    expect(players.height).toBeLessThan(700 * SHEET_PHONE_MAX_FRAC - 40);
    expect(players.y + players.height).toBeGreaterThanOrEqual(700 - 1.5);
    await closeSheet(page);
    expect(errors).toEqual([]);
  });

  test('desktop lobby: the "No turn timer" switch wears the settings sheet\'s gold track and ivory knob', async ({
    page,
  }) => {
    // Round-6 settings critic: the lobby's rules switch was still RN-web's
    // teal knob on the classic coral track while the settings rows had
    // moved to gold / ivory.
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Play vs bots' }).click();
    const input = page.getByLabel('No turn timer (∞)');
    await expect(input).toBeVisible({ timeout: 15_000 });
    // RN-web renders the switch as root > [track, thumb, input].
    const read = () =>
      input.evaluate((el) => {
        const root = el.parentElement;
        if (!root) throw new Error('switch has no root');
        const [track, thumb] = Array.from(root.children).filter((c) => c.tagName === 'DIV');
        if (!track || !thumb) throw new Error('switch has no track / thumb');
        return {
          checked: (el as HTMLInputElement).checked,
          track: getComputedStyle(track).backgroundColor,
          thumb: getComputedStyle(thumb).backgroundColor,
        };
      });
    const toRgb = (hex: string) => {
      const [r, g, b] = hexToRgb(hex);
      return `rgb(${r}, ${g}, ${b})`;
    };
    const rgbaOf = (rgba: string) =>
      rgba
        .replace(/^rgba\(/, '')
        .replace(/\)$/, '')
        .split(',')
        .map((n) => Number(n.trim()));
    const expectGlass = (s: { checked: boolean; track: string; thumb: string }) => {
      expect(s.thumb).toBe(toRgb(s.checked ? GLASS_SWITCH.knobOn : GLASS_SWITCH.knob));
      const want = rgbaOf(s.checked ? GLASS_SWITCH.track : GLASS_SWITCH.trackOff);
      const got = rgbaOf(s.track);
      for (let i = 0; i < 3; i++)
        expect(Math.abs((got[i] ?? 0) - (want[i] ?? 0))).toBeLessThanOrEqual(1);
      expect(Math.abs((got[3] ?? 1) - (want[3] ?? 1))).toBeLessThanOrEqual(0.02);
    };
    // The lobby re-applies the persisted rule prefs on its first paint,
    // and a tap's store round-trip lands a frame after the checkbox
    // flips: read once the knob agrees with the checkbox.
    const settled = async () => {
      let last = await read();
      await expect
        .poll(
          async () => {
            last = await read();
            return last.thumb === toRgb(last.checked ? GLASS_SWITCH.knobOn : GLASS_SWITCH.knob);
          },
          { timeout: 5_000 },
        )
        .toBe(true);
      return last;
    };
    const before = await settled();
    expectGlass(before);
    await input.click();
    await expect.poll(async () => (await read()).checked, { timeout: 5_000 }).toBe(!before.checked);
    const after = await settled();
    expect(after.checked).toBe(!before.checked);
    expectGlass(after);
    expect(errors).toEqual([]);
  });

  test('phone landscape: the breakdown total is pinned under the scrolling patterns', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 915, height: 412 });
    await page.goto('/');
    await page.getByText('Modern Mahjong').first().waitFor();
    await page.evaluate(() => {
      const g = globalThis as { __MAHJONG_TEST_START_TUTORIAL__?: (id: string) => void };
      if (!g.__MAHJONG_TEST_START_TUTORIAL__) throw new Error('no tutorial entry');
      g.__MAHJONG_TEST_START_TUTORIAL__('scoring-intro');
    });
    await page.getByTestId('own-hand-tile').first().waitFor({ timeout: 20_000 });
    await page.getByTestId('tutorial-next').first().click({ timeout: 10_000 });
    await page.getByTestId('winning-hand').waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: 'View breakdown' }).click();
    await expect(page.getByText(/wins? — \d+ faan/)).toBeVisible();
    // TOTAL sits below the scroll region, inside the viewport, however
    // many patterns fired (it used to scroll off the 412 px sheet).
    const total = page.getByTestId('breakdown-total');
    await expect(total).toBeVisible();
    const tBox = await total.boundingBox();
    if (!tBox) throw new Error('missing total box');
    expect(tBox.y + tBox.height).toBeLessThanOrEqual(412);
    const body = await page.getByTestId('breakdown-body').boundingBox();
    if (!body) throw new Error('missing breakdown body box');
    expect(tBox.y).toBeGreaterThanOrEqual(body.y + body.height - 1);
    await closeSheet(page);
    expect(errors).toEqual([]);
  });

  test('result veil opens the scoring breakdown in glass', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = collectErrors(page);
    await page.setViewportSize({ width: 412, height: 915 });
    await page.goto('/');
    await page.getByText('Modern Mahjong').first().waitFor();
    // Same entry the verifier's `match-result` recipe uses: the scoring
    // lesson's first "Got it" stages a rigged win.
    await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="lesson-scoring-intro"]');
      if (btn instanceof HTMLElement) {
        btn.click();
        return;
      }
      const g = globalThis as { __MAHJONG_TEST_START_TUTORIAL__?: (id: string) => void };
      if (!g.__MAHJONG_TEST_START_TUTORIAL__) throw new Error('no tutorial entry');
      g.__MAHJONG_TEST_START_TUTORIAL__('scoring-intro');
    });
    await page.getByTestId('own-hand-tile').first().waitFor({ timeout: 20_000 });
    await page.getByTestId('tutorial-next').first().click({ timeout: 10_000 });
    await page.getByTestId('winning-hand').waitFor({ timeout: 15_000 });
    await page.getByRole('button', { name: 'View breakdown' }).click();
    const title = page.getByText(/wins? — \d+ faan/);
    await expect(title).toBeVisible();
    expect(await title.evaluate((el) => getComputedStyle(el).color)).toBe(GLASS_TEXT);
    await expect(page.getByText('Total', { exact: true })).toBeVisible();
    // Faan deltas read in gold on glass.
    const total = page.getByText(/^\+\d+$/).last();
    expect(await total.evaluate((el) => getComputedStyle(el).color)).toBe('rgb(216, 168, 90)');
    await closeSheet(page);
    expect(errors).toEqual([]);
  });
});
