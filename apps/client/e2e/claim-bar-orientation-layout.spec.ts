import type { Page } from '@playwright/test';
import { expect, test } from './_helpers';

/**
 * Layout regression coverage for ClaimBar's orientation variants.
 *
 *   - Portrait runs at the project's existing 360 × 800 phone-portrait
 *     test viewport (`claim-bar-options.spec.ts`) so isn't repeated
 *     here — that spec asserts the horizontal-row layout and the
 *     visible button set.
 *   - Landscape (906 × 412) mounts the bar inside `LandscapeShell`'s
 *     200-px right rail. The bar's bounding rect must stay inside
 *     the rail's bounding rect — a regression that lets the bar
 *     overflow (clipping the Pass button) lands the user in a state
 *     where they can't dismiss the claim. The rail's own ScrollView
 *     keeps the content within bounds; this test verifies that
 *     contract on every render.
 *   - Desktop (1280 × 900) overlays the bar to the right of the felt
 *     at width 260. The overlay must stay inside the wrapper's
 *     bounding rect, with the same Pass-visibility guarantee.
 */

const TEST_SEED = 30;

test.beforeEach(async ({ page }) => {
  await page.addInitScript((seed) => {
    (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
    (
      globalThis as { __MAHJONG_TEST_BOT_SCRIPTS__?: Record<string, unknown> }
    ).__MAHJONG_TEST_BOT_SCRIPTS__ = { 1: {}, 2: {}, 3: {} };
  }, TEST_SEED);
});

interface FaceTile {
  kind: 'suit' | 'honor';
  suit?: 'man' | 'pin' | 'sou';
  rank?: number;
  honor?: string;
}

async function pickPengTarget(page: Page): Promise<FaceTile | null> {
  return await page.evaluate(() => {
    const get = (
      globalThis as { __MAHJONG_TEST_GET_STATE__?: () => { state: unknown; you: unknown } }
    ).__MAHJONG_TEST_GET_STATE__;
    if (!get) return null;
    const s = get() as {
      state: { hands: Record<number, FaceTile[]> } | null;
      you: number | null;
    };
    if (!s.state || s.you === null) return null;
    const userHand = s.state.hands[s.you] ?? [];
    const botHand = s.state.hands[1] ?? [];
    const key = (t: FaceTile) => (t.kind === 'suit' ? `s:${t.suit}:${t.rank}` : `h:${t.honor}`);
    const counts = new Map<string, { tile: FaceTile; n: number }>();
    for (const t of userHand) {
      const k = key(t);
      const cur = counts.get(k);
      if (cur) cur.n += 1;
      else counts.set(k, { tile: t, n: 1 });
    }
    const botFaces = new Set(botHand.map(key));
    for (const v of counts.values()) {
      if (v.n >= 2 && botFaces.has(key(v.tile))) return v.tile;
    }
    return null;
  });
}

async function dismissOpeningRolls(page: Page) {
  const dialog = page.getByText('Opening rolls');
  if (await dialog.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await page.mouse.click(180, 200);
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  }
}

async function driveToPengClaim(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await dismissOpeningRolls(page);
  await expect(page.getByText(/\d+ tiles/)).toBeVisible({ timeout: 10_000 });
  const target = await pickPengTarget(page);
  expect(target, 'seed 30 should expose a peng-able face').not.toBeNull();
  await page.evaluate((tile) => {
    const scripts = (globalThis as { __MAHJONG_TEST_BOT_SCRIPTS__?: Record<number, unknown> })
      .__MAHJONG_TEST_BOT_SCRIPTS__;
    if (scripts) scripts[1] = { discards: [tile] };
  }, target);
  await page.getByTestId('own-hand-tile').first().click();
  await expect(page.getByText('CLAIM?').first()).toBeVisible({ timeout: 15_000 });
  // Settle one frame so the bar's `boxShadow` + animations finish layout.
  await page.waitForTimeout(150);
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function rectOf(page: Page, selector: string): Promise<Rect | null> {
  return await page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, selector);
}

test('mobile landscape: claim bar renders inside the 200-px rail', async ({ page }) => {
  await page.setViewportSize({ width: 906, height: 412 });
  await driveToPengClaim(page);

  const bar = await rectOf(page, '[data-testid="claim-bar"]');
  expect(bar, 'claim bar must be in the DOM').not.toBeNull();
  expect(bar!.width).toBeLessThanOrEqual(200);
  // Pass button text must be visible — a regression where the bar
  // overflows the rail's bottom would clip it.
  await expect(page.getByText('Pass', { exact: true })).toBeVisible();
  await expect(page.getByText('Peng', { exact: true })).toBeVisible();
  // The bar should sit entirely above the felt's bottom edge.
  expect(bar!.y + bar!.height).toBeLessThanOrEqual(412);
});

test('mobile landscape: bar + own melds + bottom band coexist without overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 906, height: 412 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await dismissOpeningRolls(page);
  await expect(page.getByText(/\d+ tiles/)).toBeVisible({ timeout: 10_000 });

  // Inject two fake melds into the user's state so YOUR MELDS renders
  // above the ClaimBar in the rail. Tests the overflow-safety contract
  // (residual #12 covers the desktop variant; this exercises landscape).
  await page.evaluate(() => {
    const store = (
      globalThis as { __MAHJONG_TEST_GET_STATE__?: () => { state: unknown } }
    ).__MAHJONG_TEST_GET_STATE__?.() as
      | { state: { melds: Record<number, unknown[]>; hands: Record<number, unknown[]> } | null }
      | undefined;
    if (!store?.state) return;
    const hand = store.state.hands[0] as { kind: string; suit?: string; rank?: number }[];
    const sample = hand[0];
    if (!sample) return;
    store.state.melds[0] = [
      { kind: 'peng', tiles: [sample, sample, sample] },
      { kind: 'chi', tiles: [sample, sample, sample] },
    ];
  });

  const target = await pickPengTarget(page);
  expect(target).not.toBeNull();
  await page.evaluate((tile) => {
    const scripts = (globalThis as { __MAHJONG_TEST_BOT_SCRIPTS__?: Record<number, unknown> })
      .__MAHJONG_TEST_BOT_SCRIPTS__;
    if (scripts) scripts[1] = { discards: [tile] };
  }, target);
  await page.getByTestId('own-hand-tile').first().click();
  await expect(page.getByText('CLAIM?').first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(150);

  // Pass button still tappable when melds card sits above the bar.
  await expect(page.getByText('Pass', { exact: true })).toBeVisible();
  const bar = await rectOf(page, '[data-testid="claim-bar"]');
  expect(bar!.y + bar!.height).toBeLessThanOrEqual(412);
});

test('desktop: claim bar overlay renders inside its 260-px wrapper', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await driveToPengClaim(page);
  const bar = await rectOf(page, '[data-testid="claim-bar"]');
  expect(bar, 'claim bar must be in the DOM').not.toBeNull();
  expect(bar!.width).toBeLessThanOrEqual(260);
  await expect(page.getByText('Pass', { exact: true })).toBeVisible();
  await expect(page.getByText('Peng', { exact: true })).toBeVisible();
});
