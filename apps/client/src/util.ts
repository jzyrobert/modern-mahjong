/**
 * 32-bit random seed for kicking off a new hand. Used by the lobby's
 * "Start match" button and the result panel's "Next hand" button.
 *
 * Includes a Playwright test-override hatch: when the runtime sets
 * `globalThis.__MAHJONG_TEST_SEED__`, that value is returned instead.
 * Tests use `addInitScript` to pin the seed before navigation so the
 * dice rolls + dealer pick + tile order are deterministic across runs.
 * Production / dev environments never set the global so the fallback
 * is the regular `Math.random`-driven seed.
 */
export function randomSeed(): number {
  if (typeof globalThis !== 'undefined') {
    const override = (globalThis as { __MAHJONG_TEST_SEED__?: number }).__MAHJONG_TEST_SEED__;
    if (typeof override === 'number') return override;
  }
  return Math.floor(Math.random() * 0xffffffff);
}

/**
 * "Two-letter initials from a display name" — used by `PlayerBadge`'s
 * avatar circle and `PlayersSheet`'s row avatars. Strips whitespace,
 * picks the first two letters of single-word names or the first
 * letters of the first and last word for multi-word names. Empty /
 * whitespace input falls back to `?`.
 */
export function computeInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
