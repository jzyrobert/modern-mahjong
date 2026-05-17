import { test } from './_helpers';
import {
  buildSampleReplayAndOpenPlayer,
  replayShotLabel,
  setupReplayPage,
  stepReplayForward,
} from './_helpers-replay';

/**
 * Captures the replay-player screenshot at the desktop viewport.
 * Sibling per-orientation spec; see
 * `replay-screenshot-portrait.spec.ts` for the rationale.
 */
test.beforeEach(async ({ page }) => {
  await setupReplayPage(page);
});

test('replay screenshots: desktop', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await buildSampleReplayAndOpenPlayer(page);
  await stepReplayForward(page, 8);
  await page.screenshot({
    path: `e2e-output/replay/${replayShotLabel()}/desktop.png`,
    fullPage: false,
  });
});
