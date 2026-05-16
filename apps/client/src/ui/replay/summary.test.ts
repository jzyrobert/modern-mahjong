import type { Seat } from '@mahjong/game-logic';
import { describe, expect, it } from 'vitest';
import type { ReplayHeader } from '../../replay/types';
import { summarise, summaryLine } from './summary';

function header(scoreboard: Record<Seat, number>, localSeat: Seat | 'spectator' = 0): ReplayHeader {
  return {
    id: 'test',
    matchCode: 'TEST',
    joinKind: 'solo',
    startedAt: 0,
    endedAt: 0,
    durationMs: 0,
    localPlayerId: 'p0',
    localSeat,
    localDisplayName: 'You',
    players: { 0: null, 1: null, 2: null, 3: null },
    finalScoreboard: scoreboard,
    handsPlayed: 0,
    engineVersion: 'test',
    rules: {
      faanMin: 0,
      claimWindowMs: 0,
      turnTimeoutMs: 0,
      allowSevenPairs: true,
      allowThirteenOrphans: true,
    },
  };
}

// `summarise` walks the headers chronologically (the input arrives
// most-recent-first from listHeaders, so the function reverses).
// Pass the slice in most-recent-first order to mirror the call site.
function youWon(): ReplayHeader {
  return header({ 0: 8, 1: 0, 2: -4, 3: -4 });
}
function youLost(): ReplayHeader {
  return header({ 0: -3, 1: 6, 2: -3, 3: 0 });
}
function drawn(): ReplayHeader {
  return header({ 0: 0, 1: 0, 2: 0, 3: 0 });
}
function spectated(): ReplayHeader {
  return header({ 0: 8, 1: 0, 2: -4, 3: -4 }, 'spectator');
}

describe('summarise', () => {
  it('counts wins, losses, and draws from mixed history', () => {
    // Chronological: win, win, loss, draw, win → 3 wins / 1 loss / 1 draw,
    // best streak is 2 (the first two wins; the draw breaks the streak so
    // the trailing win restarts at 1, not 3).
    const headers = [youWon(), drawn(), youLost(), youWon(), youWon()];
    expect(summarise(headers)).toEqual({ wins: 3, losses: 1, draws: 1, streak: 2 });
  });

  it('draws break a winning streak (a draw is not a win)', () => {
    // Chronological: win, win, draw, win → streak of 2, not 3.
    const headers = [youWon(), drawn(), youWon(), youWon()];
    expect(summarise(headers)).toEqual({ wins: 3, losses: 0, draws: 1, streak: 2 });
  });

  it('returns zero everything for an all-draw history', () => {
    expect(summarise([drawn(), drawn(), drawn()])).toEqual({
      wins: 0,
      losses: 0,
      draws: 3,
      streak: 0,
    });
  });

  it('skips spectator-localSeat matches entirely', () => {
    // Two spectated matches surrounding one personal win — the
    // spectator entries don't count as wins, losses, or draws.
    const headers = [spectated(), youWon(), spectated()];
    expect(summarise(headers)).toEqual({ wins: 1, losses: 0, draws: 0, streak: 1 });
  });

  it('streak counts consecutive wins across the whole history', () => {
    // Chronological order: 4 wins → streak of 4.
    const headers = [youWon(), youWon(), youWon(), youWon()];
    expect(summarise(headers).streak).toBe(4);
  });
});

describe('summaryLine', () => {
  it('returns the no-replays-yet copy when count is 0', () => {
    expect(summaryLine(0, { wins: 0, losses: 0, draws: 0, streak: 0 })).toBe(
      'No replays saved yet.',
    );
  });

  it('singular "match" for exactly one saved match', () => {
    expect(summaryLine(1, { wins: 1, losses: 0, draws: 0, streak: 1 })).toBe(
      '1 saved match · 1 win',
    );
  });

  it('omits zero-count segments and the streak when below 2', () => {
    // 5 saved, 2 wins, 3 losses, 0 draws, streak 1 → no "draws" segment, no streak.
    expect(summaryLine(5, { wins: 2, losses: 3, draws: 0, streak: 1 })).toBe(
      '5 saved matches · 2 wins, 3 losses',
    );
  });

  it('renders the longest-streak suffix when streak >= 2', () => {
    expect(summaryLine(4, { wins: 3, losses: 1, draws: 0, streak: 3 })).toBe(
      '4 saved matches · 3 wins, 1 loss · longest streak 3',
    );
  });

  it('renders the draws segment between wins and streak when present', () => {
    expect(summaryLine(4, { wins: 2, losses: 1, draws: 1, streak: 2 })).toBe(
      '4 saved matches · 2 wins, 1 loss, 1 draw · longest streak 2',
    );
  });

  it('all-draws history reads as the draw-only segment', () => {
    expect(summaryLine(3, { wins: 0, losses: 0, draws: 3, streak: 0 })).toBe(
      '3 saved matches · 3 draws',
    );
  });

  it('pluralisation: "1 loss" not "1 losss" / "1 draw" not "1 draws"', () => {
    expect(summaryLine(2, { wins: 0, losses: 1, draws: 1, streak: 0 })).toBe(
      '2 saved matches · 1 loss, 1 draw',
    );
  });
});
