import { inflateSync } from 'node:zlib';
import { type Rgb, gradientDeltaE, hexToRgb, luminance } from '../src/three/settings/colorMath';
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
    if (await row.isVisible({ timeout: 6_000 }).catch(() => false)) {
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
