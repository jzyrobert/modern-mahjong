import type { Seat } from '@mahjong/game-logic';
import { SEATS } from '@mahjong/game-logic';
import type { ReplayHeader } from './types';

/**
 * Resolve the match winner from a `ReplayHeader.finalScoreboard`.
 *
 * Returns `null` when there is no clear winner — either every hand of
 * the match ended in a draw (in HK Mahjong's zero-sum scoring the
 * only way every seat lands at 0 is if no hand ever transferred
 * points), or the top score is tied between two or more seats.
 *
 * Pre-extraction, both `ReplayLibrary.tsx` and `MobileLobby.tsx`
 * carried their own copies of this loop and both had the same bug:
 * the seat-0-default + `>` comparison treated an all-zeros scoreboard
 * as "seat 0 won at score 0", which displayed as a phantom win for
 * the local user in solo matches (the user is always seat 0 in solo).
 * Sharing the helper makes the two surfaces structurally agree on
 * what counts as a winner.
 */
export function winnerOf(header: ReplayHeader): { seat: Seat; score: number } | null {
  let bestSeat: Seat | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let topTiedCount = 0;
  for (const seat of SEATS) {
    const score = header.finalScoreboard[seat] ?? 0;
    if (score > bestScore) {
      bestSeat = seat;
      bestScore = score;
      topTiedCount = 1;
    } else if (score === bestScore) {
      topTiedCount++;
    }
  }
  if (bestSeat === null || topTiedCount > 1 || bestScore <= 0) return null;
  return { seat: bestSeat, score: bestScore };
}
