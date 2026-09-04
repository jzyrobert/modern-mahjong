import { defineConfig, devices } from '@playwright/test';

/**
 * Per-shard spec assignments. Playwright's default `--shard=N/M`
 * splits by file in alphabetical order — that put all 5 screenshot
 * specs (replay-library-screenshots × 2 ≈ 42 s, replay-screenshots ×
 * 3 ≈ 41 s) into shard 3, leaving it ~50 s slower than the other
 * three on every CI run. The explicit projects below hand-balance
 * the spec load so each shard lands within ~30 % of the median.
 *
 * Shard membership is by spec filename (relative to `testDir`).
 * Shards 1–3 use `testMatch`; shard 4 uses `testIgnore` covering
 * everything assigned elsewhere, so a newly-added spec falls into
 * shard 4 by default rather than disappearing.
 *
 * The five screenshot specs (`replay-library-screenshot-{portrait,
 * desktop}` ≈ 21 s each, `replay-screenshot-{portrait,landscape,
 * desktop}` ≈ 14 s each) were split out from two umbrella files
 * specifically so each one can land in a different shard. Current
 * distribution: shard-1 has library-portrait, shard-2 has
 * replay-landscape, shard-3 has replay-portrait + replay-desktop,
 * and shard-4 catches library-desktop via its `testIgnore`. Aim for
 * one heavy spec per shard when re-balancing.
 *
 * Re-balance when new heavy specs land. Measure locally with
 *   `pnpm --filter @mahjong/client exec playwright test --project=shard-N`
 * and adjust the lists.
 */
const SHARD_1_SPECS = [
  'claim-bar-options.spec.ts',
  'claim-announcement-toast.spec.ts',
  'claim-missed-toast.spec.ts',
  'discard-hint.spec.ts',
  'discard-sort-survives-remount.spec.ts',
  'lan-browser-join.spec.ts',
  'lobby-accordion-persistence.spec.ts',
  'lobby-browser.spec.ts',
  'lobby-code-copy.spec.ts',
  'lobby-host-button-web.spec.ts',
  'lobby-layout.spec.ts',
  'lobby-match-code-focus.spec.ts',
  'lobby-name-edit.spec.ts',
  'lobby-rule-prefs.spec.ts',
  'manual-sort-drag.spec.ts',
  // 1 of 5 screenshot specs lands here (~21 s).
  'replay-library-screenshot-portrait.spec.ts',
];

const SHARD_2_SPECS = [
  'match-chrome-portrait.spec.ts',
  'match-reload-stranded.spec.ts',
  'menu-sheet.spec.ts',
  'mobile-portrait.spec.ts',
  'online-bots-lobby.spec.ts',
  'online-dice-once.spec.ts',
  'online-foreground-rejoin.spec.ts',
  'online-host-leave.spec.ts',
  'online-multi-player.spec.ts',
  'online-reload-survival.spec.ts',
  'overlay-portrait.spec.ts',
  'replay.spec.ts',
  // 1 of 5 screenshot specs lands here (~14 s).
  'replay-screenshot-landscape.spec.ts',
  'scoring-rules-sheet.spec.ts',
];

const SHARD_3_SPECS = [
  'players-sheet.spec.ts',
  'post-game-save-replay.spec.ts',
  // 2 of 5 screenshot specs land here (~14 s each = ~28 s).
  'replay-screenshot-portrait.spec.ts',
  'replay-screenshot-desktop.spec.ts',
  'shuffle-on-rejoin.spec.ts',
  'solo-match.spec.ts',
  // 3D table smoke (~20 s on SwiftShader).
  'three-table.spec.ts',
  // 3D render layer — settings panel + live preview (~15 s).
  'three-settings.spec.ts',
];

const ASSIGNED_SPECS = [...SHARD_1_SPECS, ...SHARD_2_SPECS, ...SHARD_3_SPECS];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    // Sandboxed dev containers ship a pre-installed Chromium whose
    // build number may not match the one this @playwright/test
    // version wants (`playwright install` is blocked there). Point
    // `PW_CHROMIUM_PATH` at that binary to reuse it; CI leaves the
    // variable unset and uses the browsers it installed itself.
    launchOptions: process.env.PW_CHROMIUM_PATH
      ? { executablePath: process.env.PW_CHROMIUM_PATH }
      : {},
  },
  // Serve the Expo Web export (`expo export --platform web` writes to
  // `dist/`). `serve` is a pinned devDependency so `npx serve`
  // resolves to node_modules/.bin without touching the npm registry —
  // the old `npx --yes serve` fetched it at test time and a registry
  // stall once timed out every e2e shard and the Lighthouse job in the
  // same minute. CI runs `pnpm --filter @mahjong/client export-web`
  // before Playwright, so `dist/` already exists when this fires.
  webServer: {
    command: 'npx serve dist -l 4173 -s',
    url: 'http://127.0.0.1:4173',
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'shard-1',
      use: { ...devices['Desktop Chrome'] },
      testMatch: SHARD_1_SPECS,
    },
    {
      name: 'shard-2',
      use: { ...devices['Desktop Chrome'] },
      testMatch: SHARD_2_SPECS,
    },
    {
      name: 'shard-3',
      use: { ...devices['Desktop Chrome'] },
      testMatch: SHARD_3_SPECS,
    },
    {
      // Catch-all: everything not explicitly assigned above. Includes
      // solo-* (minus solo-match), tile-reference-sheet, and the
      // tutorial-* family. Newly-added specs auto-land here so a
      // missed assignment doesn't silently drop them from CI.
      name: 'shard-4',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: ASSIGNED_SPECS,
    },
  ],
});
