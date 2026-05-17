import { test } from './_helpers';
import {
  buildOneReplay,
  openReplayLibrary,
  replayShotLabel,
  setupReplayPage,
} from './_helpers-replay';

/**
 * Captures the replay-library screenshot at the desktop viewport.
 * Paired with `replay-library-screenshot-portrait.spec.ts`. Split
 * per-orientation so each spec lands in a different e2e shard
 * (Playwright shards by file).
 */
test.beforeEach(async ({ page }) => {
  await setupReplayPage(page);
});

test('replay library screenshots: desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 900 });
  await buildOneReplay(page);
  await buildOneReplay(page);
  await openReplayLibrary(page);
  await page.screenshot({
    path: `e2e-output/replay-library/${replayShotLabel()}/desktop.png`,
    fullPage: false,
  });
});
