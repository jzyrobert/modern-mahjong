import { describe, expect, it } from 'vitest';
import { DEFAULT_RULES, type GameState, type Tile, emptyState, scoreHand } from '../src/index.js';

function suit(suit: 'man' | 'pin' | 'sou', rank: number, copy: 0 | 1 | 2 | 3): Tile {
  return { kind: 'suit', suit, rank: rank as 1, copy };
}
function honor(h: 'E' | 'S' | 'W' | 'N' | 'Z' | 'F' | 'B', copy: 0 | 1 | 2 | 3): Tile {
  return { kind: 'honor', honor: h, copy };
}

function stateWith(hand: Tile[]): GameState {
  return {
    ...emptyState(DEFAULT_RULES),
    hands: { 0: hand, 1: [], 2: [], 3: [] },
    melds: { 0: [], 1: [], 2: [], 3: [] },
  };
}

describe('scoring — full flush (清一色)', () => {
  it('all-pin self-draw scores 7 (flush) + 1 (self-draw) + 1 (concealed) = 9', () => {
    const winningTile = suit('pin', 9, 1);
    // Concealed before winning tile (13 tiles): 1p2p3p 4p5p6p 7p8p 1p1p1p + lone 9p.
    const hand: Tile[] = [
      suit('pin', 1, 0),
      suit('pin', 2, 0),
      suit('pin', 3, 0),
      suit('pin', 4, 0),
      suit('pin', 5, 0),
      suit('pin', 6, 0),
      suit('pin', 7, 0),
      suit('pin', 8, 0),
      suit('pin', 1, 1),
      suit('pin', 1, 2),
      suit('pin', 1, 3),
      suit('pin', 9, 0),
      suit('pin', 9, 2),
    ];
    const state = stateWith(hand);
    const r = scoreHand({ state, winner: 0, winningTile, selfDraw: true });
    expect(r.breakdown.find((b) => b.name === '清一色')?.faan).toBe(7);
    expect(r.breakdown.find((b) => b.name === '自摸')?.faan).toBe(1);
    expect(r.breakdown.find((b) => b.name === '門前清')?.faan).toBe(1);
    expect(r.faan).toBeGreaterThanOrEqual(9);
  });
});

describe('scoring — half flush (混一色)', () => {
  it('one suit + honors only', () => {
    const winningTile = honor('E', 0);
    const hand: Tile[] = [
      suit('man', 1, 0),
      suit('man', 2, 0),
      suit('man', 3, 0),
      suit('man', 4, 0),
      suit('man', 5, 0),
      suit('man', 6, 0),
      suit('man', 7, 0),
      suit('man', 8, 0),
      suit('man', 9, 0),
      honor('E', 1),
      honor('E', 2),
      honor('E', 3),
      honor('S', 0),
    ];
    const state = stateWith(hand);
    const r = scoreHand({ state, winner: 0, winningTile, selfDraw: false });
    expect(r.breakdown.find((b) => b.name === '混一色')?.faan).toBe(3);
  });
});

describe('scoring — all honors (字一色)', () => {
  it('every tile is an honor', () => {
    const winningTile = honor('B', 0);
    const hand: Tile[] = [
      honor('E', 0),
      honor('E', 1),
      honor('E', 2),
      honor('S', 0),
      honor('S', 1),
      honor('S', 2),
      honor('W', 0),
      honor('W', 1),
      honor('W', 2),
      honor('N', 0),
      honor('N', 1),
      honor('N', 2),
      honor('B', 1),
    ];
    const state = stateWith(hand);
    const r = scoreHand({ state, winner: 0, winningTile, selfDraw: false });
    expect(r.breakdown.find((b) => b.name === '字一色')?.faan).toBe(10);
    expect(r.faan).toBeGreaterThanOrEqual(10);
  });
});

describe('scoring — small/large dragons', () => {
  it('all three dragon triplets = 大三元', () => {
    const winningTile = suit('man', 1, 0);
    const hand: Tile[] = [
      honor('Z', 0),
      honor('Z', 1),
      honor('Z', 2),
      honor('F', 0),
      honor('F', 1),
      honor('F', 2),
      honor('B', 0),
      honor('B', 1),
      honor('B', 2),
      suit('man', 1, 1),
      suit('man', 2, 0),
      suit('man', 3, 0),
      suit('man', 1, 2),
    ];
    const state = stateWith(hand);
    const r = scoreHand({ state, winner: 0, winningTile, selfDraw: false });
    expect(r.breakdown.find((b) => b.name === '大三元')?.faan).toBe(8);
  });
});
