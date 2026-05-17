import { test } from './_helpers';
import {
  buildOneReplay,
  openReplayLibrary,
  replayShotLabel,
  setupReplayPage,
} from './_helpers-replay';

/**
 * Captures the replay-library screenshot at the mobile-portrait
 * viewport. Paired with `replay-library-screenshot-desktop.spec.ts`
 * — split per-orientation so each spec lands in a different e2e
 * shard (Playwright shards by file). Mirrors the per-orientation
 * `replay-screenshot-*.spec.ts` family for the player surface.
 *
 * Builds two saved replays so the date-group header renders
 * `2 matches` instead of falling into the single-row edge case the
 * existing `replay.spec.ts` covers.
 */
test.beforeEach(async ({ page }) => {
  await setupReplayPage(page);
});

test('replay library screenshots: portrait', async ({ page }) => {
  await page.setViewportSize({ width: 412, height: 906 });
  await buildOneReplay(page);
  await buildOneReplay(page);
  await openReplayLibrary(page);
  await page.screenshot({
    path: `e2e-output/replay-library/${replayShotLabel()}/portrait.png`,
    fullPage: false,
  });
});
