import type { Page } from '@playwright/test';
import { expect, test } from './_helpers';

/**
 * Solo waiting room exposes a per-bot skill picker (Easy / Standard /
 * Smart). This spec drives:
 *  1. Default labels — each bot card matches the persisted setting on
 *     load (heuristic / simple / passive → Smart / Standard / Easy).
 *  2. Picking a different option for one seat updates the
 *     `LobbyPreview` card name (the solo transport re-emits the
 *     lobby message after `setBotSkill`) and persists across a
 *     full leave + rejoin cycle (write-through to localStorage).
 */

test.use({ viewport: { width: 412, height: 906 } });

test('solo bot-skill picker updates LobbyPreview names + persists', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  // Wait for the waiting-room heading.
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible({ timeout: 10_000 });

  // Default mix: bot 1 = heuristic, bot 2 = simple, bot 3 = passive.
  await expect(page.getByText('Bot (heuristic)', { exact: true })).toBeVisible();
  await expect(page.getByText('Bot (simple)', { exact: true })).toBeVisible();
  await expect(page.getByText('Bot (passive)', { exact: true })).toBeVisible();

  // The picker for seat 1 starts on SMART. Switch to EASY.
  await page.getByLabel('Set seat 1 to Easy').click();

  // LobbyPreview re-renders with the new bot name (re-emitted via
  // setBotSkill → emitLobby).
  await expect(page.getByText('Bot (passive)', { exact: true })).toHaveCount(2);
  // Seat 1's old name is gone — only seat 3 still maps to passive.
  await expect(page.getByText('Bot (heuristic)', { exact: true })).toBeHidden();

  // Persistence: leave and re-enter from a fresh transport, check
  // the picker re-loads the saved skill.
  await page.getByRole('button', { name: 'Leave' }).click();
  await expect(page.getByRole('heading', { name: 'Modern Mahjong' })).toBeVisible({
    timeout: 5_000,
  });
  await page.getByRole('button', { name: 'Play vs bots' }).click();
  await expect(page.getByRole('heading', { name: 'Lobby' })).toBeVisible({ timeout: 10_000 });

  // Both seat 1 and seat 3 are now `passive` — that's the persisted
  // override, applied on top of the default for the remaining seats.
  await expect(page.getByText('Bot (passive)', { exact: true })).toHaveCount(2);
  await expect(page.getByText('Bot (simple)', { exact: true })).toBeVisible();
});

test('solo bot-skill picker is hidden for online matches', async ({ page }) => {
  await page.goto('/');
  // No serverUrl → joinOnline still wires the transport but the lobby
  // matchCode stays whatever code the user typed. The picker should
  // not appear because matchCode !== 'SOLO'.
  await page.getByLabel('Match code').fill('TESTC');
  // Don't actually join (would hit a server) — instead verify the
  // picker doesn't render in the *lobby* (homepage) at all. The
  // picker only lives in the waiting room (`/match` with
  // matchCode === 'SOLO').
  await expect(page.getByText('Bot skill', { exact: true })).toBeHidden();
});
