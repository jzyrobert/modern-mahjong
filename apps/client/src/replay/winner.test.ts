import type { Seat } from '@mahjong/game-logic';
import { describe, expect, it } from 'vitest';
import type { ReplayHeader } from './types';
import { winnerOf } from './winner';

function headerWithScores(scoreboard: Record<Seat, number>): ReplayHeader {
  // Minimal header — only fields `winnerOf` actually reads. The rest
  // is filled with sensible defaults so the type-check passes; tests
  // never inspect them.
  return {
    id: 'test',
    matchCode: 'TEST',
    joinKind: 'solo',
    startedAt: 0,
    endedAt: 0,
    durationMs: 0,
    localPlayerId: 'p0',
    localSeat: 0,
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

describe('winnerOf', () => {
  it('returns null when every seat is at 0 (every hand drawn)', () => {
    // The regression that motivated this helper: pre-fix, seat 0 was
    // the iteration default and the > comparison never advanced past
    // it, so all-zeros returned `{ seat: 0, score: 0 }` and the UI
    // crowned the local user (always seat 0 in solo).
    expect(winnerOf(headerWithScores({ 0: 0, 1: 0, 2: 0, 3: 0 }))).toBeNull();
  });

  it('returns the seat with the highest positive score', () => {
    expect(winnerOf(headerWithScores({ 0: -3, 1: -2, 2: 8, 3: -3 }))).toEqual({
      seat: 2,
      score: 8,
    });
  });

  it('handles seat 0 winning correctly (not a false positive)', () => {
    expect(winnerOf(headerWithScores({ 0: 5, 1: -2, 2: -1, 3: -2 }))).toEqual({
      seat: 0,
      score: 5,
    });
  });

  it('returns null when two seats tie at the top positive score', () => {
    // Tied wins exist in HK Mahjong in edge cases (offset chuck +
    // self-draw rounding); calling one of them "the winner" in the
    // UI would be a lie.
    expect(winnerOf(headerWithScores({ 0: 4, 1: 4, 2: -4, 3: -4 }))).toBeNull();
  });

  it('returns null when three or more seats tie at the top', () => {
    expect(winnerOf(headerWithScores({ 0: 2, 1: 2, 2: 2, 3: -6 }))).toBeNull();
  });

  it('returns null when the top score is non-positive even if unique', () => {
    // Defensive — shouldn't reach this state in HK Mahjong's zero-sum
    // scoring (any seat with the most points has > 0 unless every
    // hand was drawn, covered by the all-zeros case), but a future
    // mode with absolute scoring shouldn't accidentally crown a
    // "least negative" seat.
    expect(winnerOf(headerWithScores({ 0: -1, 1: -2, 2: -3, 3: -4 }))).toBeNull();
  });

  it('returns null when finalScoreboard is missing entries (treated as 0)', () => {
    // Defensive — a corrupt record with only seat 0 populated should
    // not produce a false winner.
    expect(winnerOf(headerWithScores({} as Record<Seat, number>))).toBeNull();
  });
});
