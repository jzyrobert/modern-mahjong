import type { Seat } from '@mahjong/game-logic';
import { describe, expect, it } from 'vitest';
import type { ReplayHeader } from '../../replay/types';
import { replaySubtitleFor, summariseReplays } from './replaySubtitle';

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

describe('summariseReplays', () => {
  it('zero replays → zero wins, zero streak', () => {
    expect(summariseReplays([])).toEqual({ wins: 0, streak: 0 });
  });

  it('counts only personal wins; ignores losses and spectator entries', () => {
    const headers = [youWon(), youLost(), spectated(), youWon()];
    expect(summariseReplays(headers)).toEqual({ wins: 2, streak: 1 });
  });

  it('draws break the win streak (a draw is not a win)', () => {
    // Chronological: win, win, draw, win → best streak is 2.
    const headers = [youWon(), drawn(), youWon(), youWon()];
    expect(summariseReplays(headers)).toEqual({ wins: 3, streak: 2 });
  });

  it('returns the longest streak across the history, not the most recent', () => {
    // Chronological: win, win, win, loss, win → best is 3.
    const headers = [youWon(), youLost(), youWon(), youWon(), youWon()];
    expect(summariseReplays(headers)).toEqual({ wins: 4, streak: 3 });
  });
});

describe('replaySubtitleFor', () => {
  it('returns the empty-state copy when count is 0', () => {
    expect(replaySubtitleFor(0, 0, 0, false)).toBe('No saved matches yet');
  });

  it('omits the streak below 2 in portrait', () => {
    expect(replaySubtitleFor(5, 3, 1, false)).toBe('5 saved · 3 wins');
  });

  it('renders the streak segment when >= 2 in portrait', () => {
    expect(replaySubtitleFor(5, 3, 3, false)).toBe('5 saved · 3 wins · longest streak 3');
  });

  it('omits the streak entirely in landscape, even when >= 2', () => {
    // Landscape variant is space-constrained — never shows the streak.
    expect(replaySubtitleFor(5, 3, 3, true)).toBe('5 saved · 3 wins');
  });
});
