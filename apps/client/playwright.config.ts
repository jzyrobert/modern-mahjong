import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
  },
  // Serve the Expo Web export (`expo export --platform web` writes to
  // `dist/`). Replaces the legacy `pnpm preview` (Vite). Uses `npx
  // serve` from the runtime so we don't add a new devDep — `serve`
  // is bundled with `npm`/`pnpm` distributions and starts faster
  // than wiring a custom Express handler. CI runs `pnpm --filter
  // @mahjong/client export-web` before Playwright, so `dist/`
  // already exists when this fires.
  webServer: {
    command: 'npx --yes serve dist -l 4173 -s',
    url: 'http://127.0.0.1:4173',
    timeout: 60_000,
    reuseExistingServer: !process.env.CI,
    stdout: 'ignore',
    stderr: 'pipe',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
