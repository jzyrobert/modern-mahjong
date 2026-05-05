import { type Page, expect, test } from '@playwright/test';

/**
 * Claim-bar coverage. Pinned to a 360-wide viewport because the bug
 * showed up first on phone-portrait, but the logic is identical on the
 * desktop shell. Uses the test-only `__MAHJONG_TEST_BOT_SCRIPTS__` hook
 * exposed by `apps/client/src/net/solo-transport.ts` to script the
 * next-seat bot's discard so the user lands in `awaitingClaims` against
 * a known tile, then asserts the visible buttons.
 *
 * Two scenarios:
 *   1. **peng available, no win** — bot 1 discards a face we have ≥ 2
 *      copies of in hand. The bar should expose Peng + Pass and **must
 *      not** offer Win. (This is the regression locked in by #114.)
 *   2. **nothing claimable** — bot 1 discards a tile we don't share.
 *      `hasClaimOption` is false, so the bar shouldn't render at all.
 */

// Seed 30 picked specifically because — with the engine's deal order
// (`wall.pop()` after dead-wall split-off, dealer gets the 14th) — the
// user (seat 0, dealer-by-dice) ends up holding 2× sou-7 AND bot 1
// also holds 1× sou-7. That's the minimal precondition for the
// `withTestScript` discard hook to land bot 1's first throw on a face
// the user can peng. Other seeds (5 / 14 / 21 / etc.) all fail at
// least one of: dealer != 0, user pair overlap with bot 1, etc.
const TEST_SEED = 30;

test.use({ viewport: { width: 360, height: 800 } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript((seed) => {
    (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
    // Initialise an empty script object so `withTestScript` always sees
    // a defined target — the test then mutates it via `page.evaluate`
    // once it's read the user's hand.
    (
      globalThis as { __MAHJONG_TEST_BOT_SCRIPTS__?: Record<string, unknown> }
    ).__MAHJONG_TEST_BOT_SCRIPTS__ = { 1: {}, 2: {}, 3: {} };
  }, TEST_SEED);
});

test('peng available: ClaimBar shows Peng + Pass but not Win', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await dismissOpeningRolls(page);
  await expect(page.getByText(/\d+ tiles in wall/)).toBeVisible({ timeout: 10_000 });

  // Read the user's dealt hand and find a face they hold ≥ 2 copies of.
  // Script bot 1 (seat 1, the first opp to discard after the user) to
  // throw that face on its turn, so the user's turn ends in
  // awaitingClaims with peng legal.
  const targetTile = await pickPengTarget(page);
  expect(targetTile, 'no peng-able face in dealt hand').not.toBeNull();

  await page.evaluate((tile) => {
    const scripts = (globalThis as { __MAHJONG_TEST_BOT_SCRIPTS__?: Record<number, unknown> })
      .__MAHJONG_TEST_BOT_SCRIPTS__;
    if (scripts) scripts[1] = { discards: [tile] };
  }, targetTile);

  // User discards anything to hand turn off to bot 1.
  await page.getByTestId('own-hand-tile').first().click();

  // ClaimBar surfaces — peng visible, pass visible, win NOT visible.
  await expect(page.getByText('CLAIM?', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Pung', { exact: true })).toBeVisible();
  await expect(page.getByText('Pass', { exact: true })).toBeVisible();
  await expect(page.getByText('Win', { exact: true })).toBeHidden();
});

test('no claim available: ClaimBar does not render', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();
  await dismissOpeningRolls(page);

  // Pick an honor face the user does NOT hold (safe-by-construction —
  // the user has 14 tiles; at most 7 honor faces exist; we can always
  // find one they don't have).
  const safeTile = await pickNonClaimableTarget(page);
  expect(safeTile, 'expected at least one un-held honor face').not.toBeNull();

  await page.evaluate((tile) => {
    const scripts = (globalThis as { __MAHJONG_TEST_BOT_SCRIPTS__?: Record<number, unknown> })
      .__MAHJONG_TEST_BOT_SCRIPTS__;
    if (scripts) scripts[1] = { discards: [tile] };
  }, safeTile);

  await page.getByTestId('own-hand-tile').first().click();

  // Wait for bot 1 to discard so the engine has actually entered (and
  // possibly left) `awaitingClaims`. If no claim was legal, the engine
  // auto-resolves and the user's turn comes back without a ClaimBar.
  await expect(page.getByTestId('wall-draw-next')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('CLAIM?', { exact: true })).toBeHidden();
});

async function dismissOpeningRolls(page: Page) {
  const dialog = page.getByText('Opening rolls');
  if (await dialog.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await page.mouse.click(180, 400);
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  }
}

interface FaceTile {
  kind: 'suit' | 'honor';
  suit?: 'man' | 'pin' | 'sou';
  rank?: number;
  honor?: string;
}

async function pickPengTarget(page: Page): Promise<FaceTile | null> {
  // Read all four dealt hands and return any face that's both
  //   (a) held ≥ 2× by the user (so peng is legal once it's discarded), and
  //   (b) held ≥ 1× by bot 1 (so the script discard is actually doable —
  //       `withTestScript` falls back to the wrapped bot if the scripted
  //       face isn't in hand).
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
    const userCounts = new Map<string, { tile: FaceTile; n: number }>();
    for (const t of userHand) {
      const k = key(t);
      const cur = userCounts.get(k);
      if (cur) cur.n += 1;
      else userCounts.set(k, { tile: t, n: 1 });
    }
    const botFaces = new Set(botHand.map(key));
    for (const v of userCounts.values()) {
      if (v.n >= 2 && botFaces.has(key(v.tile))) return v.tile;
    }
    return null;
  });
}

async function pickNonClaimableTarget(page: Page): Promise<FaceTile | null> {
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
    const hand = s.state.hands[s.you] ?? [];
    // Honors are easy: pick one (E/S/W/N/Z/F/B) the user doesn't hold.
    // chi only triggers if next-seat-after-discarder, which is the user
    // here, AND only on suit tiles in 2-step range — honors can never
    // be claimed by chi/peng/gong unless the user has copies, so a
    // missing honor is guaranteed-non-claimable.
    const holds = new Set<string>(
      hand.filter((t) => t.kind === 'honor').map((t) => `h:${t.honor}`),
    );
    for (const honor of ['E', 'S', 'W', 'N', 'Z', 'F', 'B']) {
      if (!holds.has(`h:${honor}`)) return { kind: 'honor', honor };
    }
    return null;
  });
}
