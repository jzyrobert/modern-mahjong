import { defineConfig } from 'vitest/config';

/**
 * Vitest config for the client app. Scoped narrowly to platform-agnostic
 * modules (`src/replay/**`, etc.) that the e2e suite already exercises
 * end-to-end but whose synthetic-stream and quota-prune edge cases are
 * cheaper to pin directly here.
 *
 * `environment: 'jsdom'` provides `localStorage` for the replay
 * storage layer. Native-only deps (e.g. `expo-clipboard`) get mocked
 * per-test rather than aliased away, so the same import paths the
 * production code uses keep working.
 */
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
  },
});
