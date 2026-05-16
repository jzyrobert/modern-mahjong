import { expect, test } from './_helpers';

/**
 * Lobby rule-prefs persistence (introduced in #372): the host-side
 * `useEffect` in `LobbyView` re-applies the user's last-chosen
 * `faanMin` + `turnTimeoutMs` from `settings.lobbyRulePrefs` on first
 * mount, so the lobby boots with the user's preferred values rather
 * than the engine's hard-coded `DEFAULT_RULES`.
 *
 * Two paths matter:
 *  1. **Drift detected** — the persisted prefs differ from
 *     `DEFAULT_RULES`, the engine state still looks fresh, and the
 *     effect dispatches `setRules`. The engine ends up with the
 *     persisted faanMin in `state.rules`.
 *  2. **Test-hatch preservation** — if anything has already moved
 *     `state.rules` off `DEFAULT_RULES` (in particular the
 *     `__MAHJONG_TEST_TURN_TIMEOUT_MS__` solo-transport hatch used by
 *     `solo-turn-timeout.spec.ts`), `looksFresh` returns false and
 *     the effect leaves state alone. Without this guard a host with
 *     persisted prefs would silently overwrite the test override.
 *
 * Both paths are verified by reading the live engine state via
 * `__MAHJONG_TEST_GET_STATE__` after the lobby mounts — RulePanel's
 * accessibility state isn't propagated to the DOM by
 * react-native-web 0.21 (only `role` + `aria-label` survive), so
 * Playwright's `toBeChecked()` would return spurious results.
 */

test.use({ viewport: { width: 412, height: 906 } });

interface LiveRulesStore {
  state?: { rules?: { faanMin?: number; turnTimeoutMs?: number } };
}

async function readLiveRules(
  page: import('@playwright/test').Page,
): Promise<{ faanMin: number; turnTimeoutMs: number }> {
  // Poll because the lobby's host-side useEffect that may dispatch
  // setRules runs after the first commit, and the engine round-trip
  // is async on the solo transport.
  return await expect
    .poll(
      async () =>
        await page.evaluate(() => {
          const get = (globalThis as { __MAHJONG_TEST_GET_STATE__?: () => LiveRulesStore })
            .__MAHJONG_TEST_GET_STATE__;
          const rules = get?.().state?.rules;
          if (!rules || typeof rules.faanMin !== 'number') return null;
          return { faanMin: rules.faanMin, turnTimeoutMs: rules.turnTimeoutMs ?? 0 };
        }),
      { timeout: 5_000 },
    )
    .toBeTruthy()
    .then(
      async () =>
        (await page.evaluate(() => {
          const get = (globalThis as { __MAHJONG_TEST_GET_STATE__?: () => LiveRulesStore })
            .__MAHJONG_TEST_GET_STATE__;
          const rules = get?.().state?.rules ?? { faanMin: -1, turnTimeoutMs: -1 };
          return { faanMin: rules.faanMin ?? -1, turnTimeoutMs: rules.turnTimeoutMs ?? 0 };
        })) as { faanMin: number; turnTimeoutMs: number },
    );
}

test('lobby applies persisted lobbyRulePrefs on first mount', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'mj.settings.v1',
      JSON.stringify({
        // Pinned to a non-default faanMin so the drift branch fires.
        // turnTimeoutMs left at 0 (the default) — the spec covers
        // faanMin specifically so a regression in either field still
        // visibly fails on the engine-state assertion.
        lobbyRulePrefs: { faanMin: 3, turnTimeoutMs: 0 },
      }),
    );
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible({ timeout: 10_000 });

  // The persisted faanMin: 3 must arrive in the engine via the
  // LobbyView useEffect's setRules dispatch — not the engine's
  // hard-coded default of 0.
  await expect
    .poll(
      async () =>
        await page.evaluate(() => {
          const get = (globalThis as { __MAHJONG_TEST_GET_STATE__?: () => LiveRulesStore })
            .__MAHJONG_TEST_GET_STATE__;
          return get?.().state?.rules?.faanMin ?? null;
        }),
      { timeout: 5_000 },
    )
    .toBe(3);
});

test('lobby leaves rules alone when __MAHJONG_TEST_TURN_TIMEOUT_MS__ has armed a non-default timer', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'mj.settings.v1',
      JSON.stringify({
        // Persisted prefs that WOULD apply if the looksFresh guard
        // weren't gating the dispatch. The hatch below moves
        // turnTimeoutMs off-default, so the guard must skip the
        // whole pref-apply (including the unrelated faanMin field).
        lobbyRulePrefs: { faanMin: 3, turnTimeoutMs: 0 },
      }),
    );
    // The solo-transport hatch the existing solo-turn-timeout spec
    // uses. Arms a fast turn timer at engine boot.
    (
      globalThis as unknown as { __MAHJONG_TEST_TURN_TIMEOUT_MS__: number }
    ).__MAHJONG_TEST_TURN_TIMEOUT_MS__ = 800;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible({ timeout: 10_000 });

  // Hand the engine a beat to settle, then read live rules. The
  // hatch armed turnTimeoutMs: 800 at boot, so looksFresh is false
  // and the pref-apply skips entirely — including the unrelated
  // faanMin field. Engine faanMin must be 0 (the engine default),
  // NOT the persisted 3.
  const rules = await readLiveRules(page);
  expect(rules.faanMin).toBe(0);
  expect(rules.turnTimeoutMs).toBe(800);
});
