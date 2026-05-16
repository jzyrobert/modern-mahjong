import type { ReplayHeader } from '../../replay/types';
import { winnerOf } from '../../replay/winner';

/**
 * Walk a chronological list of replay headers and report personal
 * win/loss/draw counts plus the longest winning streak.
 *
 * `headers` comes back from `listHeaders()` most-recent-first; the
 * function reverses internally so the streak counter walks in true
 * chronological order. Spectator-localSeat matches are skipped
 * entirely (the user wasn't a participant). Draws (no-winner matches)
 * count toward `draws` and break any in-progress streak, matching how
 * most sports-style trackers handle ties.
 */
export function summarise(headers: readonly ReplayHeader[]): {
  wins: number;
  losses: number;
  draws: number;
  streak: number;
} {
  let wins = 0;
  let losses = 0;
  let draws = 0;
  let bestStreak = 0;
  let currentStreak = 0;
  const chrono = [...headers].reverse();
  for (const h of chrono) {
    if (h.localSeat === 'spectator') continue;
    const winner = winnerOf(h);
    if (winner === null) {
      draws++;
      currentStreak = 0;
    } else if (winner.seat === h.localSeat) {
      wins++;
      currentStreak++;
      if (currentStreak > bestStreak) bestStreak = currentStreak;
    } else {
      losses++;
      currentStreak = 0;
    }
  }
  return { wins, losses, draws, streak: bestStreak };
}

/**
 * Compose the bullet-separated subtitle shown in `ReplayLibrary`'s
 * header. Skips zero-count segments and the streak suffix below 2 so
 * the line never reads "0 wins, 0 losses, 0 draws" or "longest streak 1".
 */
export function summaryLine(
  count: number,
  summary: { wins: number; losses: number; draws: number; streak: number },
): string {
  if (count === 0) return 'No replays saved yet.';
  const matchWord = count === 1 ? 'match' : 'matches';
  const segments: string[] = [];
  if (summary.wins > 0) {
    segments.push(`${summary.wins} win${summary.wins === 1 ? '' : 's'}`);
  }
  if (summary.losses > 0) {
    segments.push(`${summary.losses} loss${summary.losses === 1 ? '' : 'es'}`);
  }
  if (summary.draws > 0) {
    segments.push(`${summary.draws} draw${summary.draws === 1 ? '' : 's'}`);
  }
  const winsLossesPart = segments.length === 0 ? null : segments.join(', ');
  const streakPart = summary.streak >= 2 ? `longest streak ${summary.streak}` : null;
  return [`${count} saved ${matchWord}`, winsLossesPart, streakPart]
    .filter((s): s is string => s !== null)
    .join(' · ');
}
