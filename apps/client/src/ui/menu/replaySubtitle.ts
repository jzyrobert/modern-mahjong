import type { ReplayHeader } from '../../replay/types';
import { winnerOf } from '../../replay/winner';

/**
 * Aggregate the user's personal wins + longest win streak for the
 * mobile lobby's Replays subtitle. Distinct from
 * `ReplayLibrary`'s `summarise` (which also tracks losses + draws) —
 * the mobile lobby surface is space-constrained and only renders
 * "N saved · M wins [· longest streak K]".
 *
 * Draws break the streak the same way losses do, but they don't
 * increment `wins`.
 */
export function summariseReplays(headers: readonly ReplayHeader[]): {
  wins: number;
  streak: number;
} {
  let wins = 0;
  let currentStreak = 0;
  let bestStreak = 0;
  const chrono = [...headers].reverse();
  for (const h of chrono) {
    if (h.localSeat === 'spectator') continue;
    const winner = winnerOf(h);
    if (winner !== null && winner.seat === h.localSeat) {
      wins++;
      currentStreak++;
      if (currentStreak > bestStreak) bestStreak = currentStreak;
    } else {
      currentStreak = 0;
    }
  }
  return { wins, streak: bestStreak };
}

/** Bullet-separated subtitle, with the streak suffix shown only when
 *  it's at least 2 and the layout has the horizontal room (portrait). */
export function replaySubtitleFor(
  count: number,
  wins: number,
  streak: number,
  isLandscape: boolean,
): string {
  if (count === 0) return 'No saved matches yet';
  if (isLandscape) return `${count} saved · ${wins} wins`;
  const parts = [`${count} saved`, `${wins} wins`];
  if (streak >= 2) parts.push(`longest streak ${streak}`);
  return parts.join(' · ');
}
