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
  for (let attempt = 0; attempt < 4; attempt++) {
    await dismissDice(page, 500);
    await page.getByLabel('Open menu').first().click();
    const row = page.getByTestId('open-settings');
    if (await row.isVisible({ timeout: 3_000 }).catch(() => false)) {
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
    test.setTimeout(60_000);
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
    test.setTimeout(90_000);
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
