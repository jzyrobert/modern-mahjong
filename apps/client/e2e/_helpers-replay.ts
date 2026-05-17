import type { Page } from '@playwright/test';
import { clearReplayStorage, expect } from './_helpers';

/** Deterministic seed shared between every replay-* screenshot spec
 *  so the frames they capture are byte-stable across reruns. */
export const REPLAY_SEED = 5;

/** Default label for the screenshot output directory. CI / local
 *  runs can override via `REPLAY_SHOT_LABEL` to stash before/after
 *  pairs side-by-side. */
export function replayShotLabel(): string {
  return process.env.REPLAY_SHOT_LABEL ?? 'current';
}

/** Per-test setup shared by every screenshot spec: wipes the replay
 *  library so previous runs don't leak in, then pins the engine RNG
 *  seed so deal + draw order is deterministic. */
export async function setupReplayPage(page: Page): Promise<void> {
  await clearReplayStorage(page);
  await page.addInitScript((seed) => {
    (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__ = seed;
  }, REPLAY_SEED);
}

/** Drives a solo match for a few rounds and saves the resulting
 *  replay, then leaves back to the main menu. Caller is responsible
 *  for the viewport and any post-save navigation (e.g. opening the
 *  library or stepping through the replay). */
export async function buildOneReplay(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await page.getByRole('button', { name: 'Start match' }).click();

  // Drive a few rounds so the saved record has multiple frames.
  for (let i = 0; i < 3; i++) {
    const ownTile = page.getByTestId('own-hand-tile').first();
    if (await ownTile.isVisible().catch(() => false)) {
      await ownTile.click().catch(() => {});
    }
    await page.waitForTimeout(2_500);
  }

  await page.getByLabel('Open menu').click();
  await page.getByRole('button', { name: /^Save this match$/ }).click();
  await expect(page.getByRole('button', { name: /^Saved · tap to discard$/ })).toBeVisible();
  await page.getByRole('button', { name: 'Leave match' }).click();
  await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible({
    timeout: 10_000,
  });
}

/** Opens the replay library from the main menu. Phone-class
 *  viewports route to `MobileLobby` (Replays as a SecondaryRow);
 *  desktop keeps the "Open library" CTA. The OR locator works at
 *  both sizes. */
export async function openReplayLibrary(page: Page): Promise<void> {
  await page.getByRole('button', { name: /^(Open library|Replays)$/ }).click();
  await expect(page.getByRole('heading', { name: 'Replays' })).toBeVisible();
}

/** Builds a single replay then opens it in the player so the
 *  scrubber is visible. Used by `replay-screenshot-*` specs that
 *  want to capture mid-replay frames; library-listing specs use
 *  `buildOneReplay` + `openReplayLibrary` directly. */
export async function buildSampleReplayAndOpenPlayer(page: Page): Promise<void> {
  await buildOneReplay(page);
  await openReplayLibrary(page);
  await page.getByText('SOLO', { exact: true }).first().click();
  await expect(page.getByLabel('Replay timeline')).toBeVisible();
}

/** Steps the replay player forward by `frames` ticks. 50 ms between
 *  clicks gives the renderer time to apply each delta before the
 *  next click queues. */
export async function stepReplayForward(page: Page, frames: number): Promise<void> {
  for (let i = 0; i < frames; i++) {
    await page.getByLabel('Step forward').click();
    await page.waitForTimeout(50);
  }
}
