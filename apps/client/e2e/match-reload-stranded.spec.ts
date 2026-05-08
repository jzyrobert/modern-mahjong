import { expect, test } from './_helpers';

/**
 * The "stranded" recovery screen now only fires when the URL carries
 * no recovery hint — i.e. someone deep-linked to bare `/match` (or a
 * link they had bookmarked from before the URL contract landed). Solo
 * matches survive reload via `solo-persist.ts`'s localStorage
 * snapshot (covered by `solo-reload-survival.spec.ts`); online + LAN
 * survive via the URL params and server-side `playerId → seat`
 * rebind.
 *
 * What this spec pins down: a bare `/match` navigation with no
 * matching localStorage snapshot lands on "No active match" with a
 * "Back to main menu" button that returns the user to `/`.
 */

test('navigating directly to /match with no session shows the recovery screen', async ({
  page,
}) => {
  await page.goto('/match');
  await expect(page.getByRole('heading', { name: 'No active match' })).toBeVisible({
    timeout: 10_000,
  });
  await page.getByRole('button', { name: 'Back to main menu' }).click();
  await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible({
    timeout: 5_000,
  });
});

test('navigating to /match?solo=1 with no localStorage snapshot still strands', async ({
  page,
}) => {
  // The URL hint says "there should be a solo session to rebuild"
  // but the snapshot key is missing — `joinSoloResume` short-circuits
  // and the user lands on the same recovery screen instead of an
  // empty waiting-room loop.
  await page.goto('/match?solo=1');
  await expect(page.getByRole('heading', { name: 'No active match' })).toBeVisible({
    timeout: 10_000,
  });
});
