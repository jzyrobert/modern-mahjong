import { test } from './_helpers';
import {
  buildSampleReplayAndOpenPlayer,
  replayShotLabel,
  setupReplayPage,
  stepReplayForward,
} from './_helpers-replay';

/**
 * Captures the replay-player screenshot at the mobile-portrait
 * viewport. Sibling specs `replay-screenshot-landscape.spec.ts`
 * and `replay-screenshot-desktop.spec.ts` cover the other two
 * shells — split per-orientation so each spec lands in a different
 * e2e shard (Playwright shards by file).
 */
test.beforeEach(async ({ page }) => {
  await setupReplayPage(page);
});

test('replay screenshots: portrait', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 906 });
  await buildSampleReplayAndOpenPlayer(page);
  // Step a few frames in so the discard pool + a seat hand are
  // populated — frame 0 is just the dealt board.
  await stepReplayForward(page, 8);
  await page.screenshot({
    path: `e2e-output/replay/${replayShotLabel()}/portrait.png`,
    fullPage: false,
  });
});
