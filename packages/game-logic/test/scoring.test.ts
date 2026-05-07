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
  it('one suit, no honors, not nine-gates shape — 7 (flush) + 1 (self-draw) + 1 (concealed)', () => {
    const winningTile = suit('man', 9, 0);
    // 1m1m1m 2m3m4m 5m6m7m 8m8m8m + 9m9m. Single suit, no honors, but
    // rank 9 has only 2 copies so the nine-gates shape doesn't match —
    // a vanilla 清一色.
    const hand: Tile[] = [
      suit('man', 1, 0),
      suit('man', 1, 1),
      suit('man', 1, 2),
      suit('man', 2, 0),
      suit('man', 3, 0),
      suit('man', 4, 0),
      suit('man', 5, 0),
      suit('man', 6, 0),
      suit('man', 7, 0),
      suit('man', 8, 0),
      suit('man', 8, 1),
      suit('man', 8, 2),
      suit('man', 9, 1),
    ];
    const state = stateWith(hand);
    const r = scoreHand({ state, winner: 0, winningTile, selfDraw: true });
    expect(r.breakdown.find((b) => b.name === '清一色')?.faan).toBe(7);
    expect(r.breakdown.find((b) => b.name === '九蓮寶燈')).toBeUndefined();
    expect(r.breakdown.find((b) => b.name === '自摸')?.faan).toBe(1);
    expect(r.breakdown.find((b) => b.name === '門前清')?.faan).toBe(1);
  });
});

describe('scoring — nine gates (九蓮寶燈)', () => {
  it('pure 1112345678999 + 14th tile of same suit replaces full flush', () => {
    const winningTile = suit('pin', 9, 1);
    // 1p1p1p1p 2p 3p 4p 5p 6p 7p 8p 9p9p (13) + 9p (winning) = 14.
    // counts = [4, 1, 1, 1, 1, 1, 1, 1, 3] — satisfies the
    // 1112345678999 base (≥3 ones, ≥3 nines, ≥1 of each 2-8).
    const hand: Tile[] = [
      suit('pin', 1, 0),
      suit('pin', 1, 1),
      suit('pin', 1, 2),
      suit('pin', 1, 3),
      suit('pin', 2, 0),
      suit('pin', 3, 0),
      suit('pin', 4, 0),
      suit('pin', 5, 0),
      suit('pin', 6, 0),
      suit('pin', 7, 0),
      suit('pin', 8, 0),
      suit('pin', 9, 0),
      suit('pin', 9, 2),
    ];
    const state = stateWith(hand);
    const r = scoreHand({ state, winner: 0, winningTile, selfDraw: true });
    expect(r.breakdown.find((b) => b.name === '九蓮寶燈')?.faan).toBe(13);
    expect(r.breakdown.find((b) => b.name === '清一色')).toBeUndefined();
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

describe('scoring — thirteen orphans (十三幺)', () => {
  it('one of each terminal + one of each honor, with one paired = 13', () => {
    const winningTile = honor('B', 1);
    // Pair on 紅中(B). One of each terminal + each honor for the rest.
    const hand: Tile[] = [
      suit('man', 1, 0),
      suit('man', 9, 0),
      suit('pin', 1, 0),
      suit('pin', 9, 0),
      suit('sou', 1, 0),
      suit('sou', 9, 0),
      honor('E', 0),
      honor('S', 0),
      honor('W', 0),
      honor('N', 0),
      honor('Z', 0),
      honor('F', 0),
      honor('B', 0),
    ];
    const state = stateWith(hand);
    const r = scoreHand({ state, winner: 0, winningTile, selfDraw: false });
    expect(r.breakdown.find((b) => b.name === '十三幺')?.faan).toBe(13);
  });
});

describe('scoring — seven pairs (七對子)', () => {
  it('seven distinct pairs in a fully-concealed hand = 4', () => {
    const winningTile = suit('sou', 7, 1);
    const hand: Tile[] = [
      suit('man', 2, 0),
      suit('man', 2, 1),
      suit('man', 5, 0),
      suit('man', 5, 1),
      suit('pin', 3, 0),
      suit('pin', 3, 1),
      suit('pin', 6, 0),
      suit('pin', 6, 1),
      suit('sou', 4, 0),
      suit('sou', 4, 1),
      suit('sou', 7, 0),
      honor('E', 0),
      honor('E', 1),
    ];
    const state = stateWith(hand);
    const r = scoreHand({ state, winner: 0, winningTile, selfDraw: false });
    expect(r.breakdown.find((b) => b.name === '七對子')?.faan).toBe(4);
  });
});

describe('scoring — terminals (清么九 / 混么九)', () => {
  it('only 1s and 9s, no honors → 清么九 (13), no 對對和', () => {
    const winningTile = suit('sou', 9, 0);
    // 1m1m1m 9m9m9m 1p1p1p 9p9p9p + 9s9s. All terminals, all triplets.
    const hand: Tile[] = [
      suit('man', 1, 0),
      suit('man', 1, 1),
      suit('man', 1, 2),
      suit('man', 9, 0),
      suit('man', 9, 1),
      suit('man', 9, 2),
      suit('pin', 1, 0),
      suit('pin', 1, 1),
      suit('pin', 1, 2),
      suit('pin', 9, 0),
      suit('pin', 9, 1),
      suit('pin', 9, 2),
      suit('sou', 9, 1),
    ];
    const state = stateWith(hand);
    const r = scoreHand({ state, winner: 0, winningTile, selfDraw: false });
    expect(r.breakdown.find((b) => b.name === '清么九')?.faan).toBe(13);
    expect(r.breakdown.find((b) => b.name === '對對和')).toBeUndefined();
    expect(r.breakdown.find((b) => b.name === '混么九')).toBeUndefined();
  });

  it('1s/9s with honors → 混么九 (4) replacing 對對和', () => {
    const winningTile = honor('S', 0);
    // 1m1m1m 9m9m9m 1p1p1p E E E + S S. Mixed terminals + honors.
    const hand: Tile[] = [
      suit('man', 1, 0),
      suit('man', 1, 1),
      suit('man', 1, 2),
      suit('man', 9, 0),
      suit('man', 9, 1),
      suit('man', 9, 2),
      suit('pin', 1, 0),
      suit('pin', 1, 1),
      suit('pin', 1, 2),
      honor('E', 0),
      honor('E', 1),
      honor('E', 2),
      honor('S', 1),
    ];
    const state = stateWith(hand);
    const r = scoreHand({ state, winner: 0, winningTile, selfDraw: false });
    expect(r.breakdown.find((b) => b.name === '混么九')?.faan).toBe(4);
    expect(r.breakdown.find((b) => b.name === '對對和')).toBeUndefined();
    expect(r.breakdown.find((b) => b.name === '清么九')).toBeUndefined();
  });
});

describe('scoring — round/seat wind stacking', () => {
  it('triplet of the round wind that also matches seat wind counts twice', () => {
    const winningTile = suit('man', 1, 0);
    // Dealer (seat 0) is round-East. Triplet of East should
    // satisfy both 圈風 and 門風 → 2 fan total.
    const hand: Tile[] = [
      honor('E', 0),
      honor('E', 1),
      honor('E', 2),
      suit('pin', 2, 0),
      suit('pin', 3, 0),
      suit('pin', 4, 0),
      suit('sou', 5, 0),
      suit('sou', 6, 0),
      suit('sou', 7, 0),
      suit('man', 1, 1),
      suit('man', 1, 2),
      suit('man', 2, 0),
      suit('man', 3, 0),
    ];
    const state = stateWith(hand);
    const r = scoreHand({ state, winner: 0, winningTile, selfDraw: false });
    const round = r.breakdown.find((b) => b.name.startsWith('圈風'));
    const seat = r.breakdown.find((b) => b.name.startsWith('門風'));
    expect(round?.faan).toBe(1);
    expect(seat?.faan).toBe(1);
  });
});

describe('scoring — all concealed triplets (四暗刻)', () => {
  it('four concealed triplets + pair on self-draw → 8 fan, replaces 對對和', () => {
    const winningTile = suit('man', 5, 0);
    // 1m1m1m 9m9m9m 5p5p5p 3s3s3s + 5m5m. All triplets, all concealed.
    const hand: Tile[] = [
      suit('man', 1, 0),
      suit('man', 1, 1),
      suit('man', 1, 2),
      suit('man', 9, 0),
      suit('man', 9, 1),
      suit('man', 9, 2),
      suit('pin', 5, 0),
      suit('pin', 5, 1),
      suit('pin', 5, 2),
      suit('sou', 3, 0),
      suit('sou', 3, 1),
      suit('sou', 3, 2),
      suit('man', 5, 1),
    ];
    const state = stateWith(hand);
    const r = scoreHand({ state, winner: 0, winningTile, selfDraw: true });
    expect(r.breakdown.find((b) => b.name === '四暗刻')?.faan).toBe(8);
    expect(r.breakdown.find((b) => b.name === '對對和')).toBeUndefined();
  });

  it('ron on a triplet-completer is only 對對和, not 四暗刻', () => {
    const winningTile = suit('man', 5, 0);
    // Same shape as above but the winning tile completes the
    // 5m triplet rather than the pair — convention treats that
    // triplet as exposed, so we get 三暗刻 (not yet scored) and
    // 對對和 (3) instead of 四暗刻.
    const hand: Tile[] = [
      suit('man', 1, 0),
      suit('man', 1, 1),
      suit('man', 1, 2),
      suit('man', 9, 0),
      suit('man', 9, 1),
      suit('man', 9, 2),
      suit('pin', 5, 0),
      suit('pin', 5, 1),
      suit('pin', 5, 2),
      suit('sou', 3, 0),
      suit('sou', 3, 1),
      suit('man', 5, 1),
      suit('man', 5, 2),
    ];
    const state = stateWith(hand);
    const r = scoreHand({ state, winner: 0, winningTile, selfDraw: false });
    expect(r.breakdown.find((b) => b.name === '四暗刻')).toBeUndefined();
    expect(r.breakdown.find((b) => b.name === '對對和')?.faan).toBe(3);
  });
});

describe('scoring — all gangs (四槓子)', () => {
  it('four exposed gangs + pair = 13, replaces 對對和', () => {
    const winningTile = suit('man', 5, 0);
    const gangs = [
      {
        kind: 'gang-exposed' as const,
        tiles: [suit('man', 1, 0), suit('man', 1, 1), suit('man', 1, 2), suit('man', 1, 3)],
        from: 1 as const,
      },
      {
        kind: 'gang-concealed' as const,
        tiles: [suit('pin', 9, 0), suit('pin', 9, 1), suit('pin', 9, 2), suit('pin', 9, 3)],
      },
      {
        kind: 'gang-promoted' as const,
        tiles: [suit('sou', 4, 0), suit('sou', 4, 1), suit('sou', 4, 2), suit('sou', 4, 3)],
        from: 2 as const,
      },
      {
        kind: 'gang-exposed' as const,
        tiles: [honor('E', 0), honor('E', 1), honor('E', 2), honor('E', 3)],
        from: 3 as const,
      },
    ];
    const state: GameState = {
      ...emptyState(DEFAULT_RULES),
      hands: { 0: [suit('man', 5, 1)], 1: [], 2: [], 3: [] },
      melds: { 0: gangs, 1: [], 2: [], 3: [] },
    };
    const r = scoreHand({ state, winner: 0, winningTile, selfDraw: true });
    expect(r.breakdown.find((b) => b.name === '四槓子')?.faan).toBe(13);
    expect(r.breakdown.find((b) => b.name === '對對和')).toBeUndefined();
  });
});

describe('scoring — concealed hand (門前清) on a discard win', () => {
  it('ron with no exposed melds still scores 門前清', () => {
    const winningTile = suit('man', 1, 0);
    const hand: Tile[] = [
      suit('man', 1, 1),
      suit('man', 1, 2),
      suit('man', 2, 0),
      suit('man', 3, 0),
      suit('man', 4, 0),
      suit('pin', 5, 0),
      suit('pin', 6, 0),
      suit('pin', 7, 0),
      suit('sou', 2, 0),
      suit('sou', 3, 0),
      suit('sou', 4, 0),
      honor('S', 0),
      honor('S', 1),
    ];
    const state = stateWith(hand);
    const r = scoreHand({ state, winner: 0, winningTile, selfDraw: false });
    expect(r.breakdown.find((b) => b.name === '門前清')?.faan).toBe(1);
  });
});

describe('scoring — last tile (海底撈月)', () => {
  it('self-draw on the last live wall tile scores 1', () => {
    const winningTile = suit('man', 5, 0);
    const hand: Tile[] = [
      suit('man', 1, 0),
      suit('man', 1, 1),
      suit('man', 1, 2),
      suit('man', 9, 0),
      suit('man', 9, 1),
      suit('man', 9, 2),
      suit('pin', 5, 0),
      suit('pin', 5, 1),
      suit('pin', 5, 2),
      suit('sou', 3, 0),
      suit('sou', 3, 1),
      suit('sou', 3, 2),
      suit('man', 5, 1),
    ];
    const state: GameState = { ...stateWith(hand), wall: [] };
    const r = scoreHand({ state, winner: 0, winningTile, selfDraw: true });
    expect(r.breakdown.find((b) => b.name === '海底撈月')?.faan).toBe(1);
  });

  it('does not fire when the win came off a gang replacement (槓上開花 covers it)', () => {
    const winningTile = suit('man', 5, 0);
    const hand: Tile[] = [
      suit('man', 1, 0),
      suit('man', 1, 1),
      suit('man', 1, 2),
      suit('man', 9, 0),
      suit('man', 9, 1),
      suit('man', 9, 2),
      suit('pin', 5, 0),
      suit('pin', 5, 1),
      suit('pin', 5, 2),
      suit('sou', 3, 0),
      suit('sou', 3, 1),
      suit('sou', 3, 2),
      suit('man', 5, 1),
    ];
    const state: GameState = { ...stateWith(hand), wall: [], gangReplacementCount: 1 };
    const r = scoreHand({ state, winner: 0, winningTile, selfDraw: true });
    expect(r.breakdown.find((b) => b.name === '海底撈月')).toBeUndefined();
    expect(r.breakdown.find((b) => b.name === '槓上開花')?.faan).toBe(2);
  });
});

describe('scoring — kong replacement (槓上開花 / 槓上槓)', () => {
  it('first gang replacement → 槓上開花 (2)', () => {
    const winningTile = suit('man', 5, 0);
    const hand: Tile[] = [
      suit('man', 1, 0),
      suit('pin', 2, 0),
      suit('pin', 3, 0),
      suit('pin', 4, 0),
      suit('sou', 5, 0),
      suit('sou', 6, 0),
      suit('sou', 7, 0),
      suit('sou', 8, 0),
      suit('sou', 9, 0),
      honor('E', 0),
      honor('E', 1),
      suit('man', 1, 1),
      suit('man', 1, 2),
    ];
    const state: GameState = { ...stateWith(hand), gangReplacementCount: 1 };
    const r = scoreHand({ state, winner: 0, winningTile, selfDraw: true });
    expect(r.breakdown.find((b) => b.name === '槓上開花')?.faan).toBe(2);
  });

  it('chained second gang replacement → 槓上槓 (9)', () => {
    const winningTile = suit('man', 5, 0);
    const hand: Tile[] = [
      suit('man', 1, 0),
      suit('pin', 2, 0),
      suit('pin', 3, 0),
      suit('pin', 4, 0),
      suit('sou', 5, 0),
      suit('sou', 6, 0),
      suit('sou', 7, 0),
      suit('sou', 8, 0),
      suit('sou', 9, 0),
      honor('E', 0),
      honor('E', 1),
      suit('man', 1, 1),
      suit('man', 1, 2),
    ];
    const state: GameState = { ...stateWith(hand), gangReplacementCount: 2 };
    const r = scoreHand({ state, winner: 0, winningTile, selfDraw: true });
    expect(r.breakdown.find((b) => b.name === '槓上槓')?.faan).toBe(9);
    expect(r.breakdown.find((b) => b.name === '槓上開花')).toBeUndefined();
  });
});

describe('scoring — robbing the kong (搶槓)', () => {
  it('adds +1 fan when robbingKong is set on a ron win', () => {
    const winningTile = suit('man', 5, 0);
    const hand: Tile[] = [
      suit('man', 1, 0),
      suit('pin', 2, 0),
      suit('pin', 3, 0),
      suit('pin', 4, 0),
      suit('sou', 5, 0),
      suit('sou', 6, 0),
      suit('sou', 7, 0),
      suit('sou', 8, 0),
      suit('sou', 9, 0),
      honor('E', 0),
      honor('E', 1),
      suit('man', 1, 1),
      suit('man', 1, 2),
    ];
    const state = stateWith(hand);
    const r = scoreHand({
      state,
      winner: 0,
      winningTile,
      selfDraw: false,
      robbingKong: true,
    });
    expect(r.breakdown.find((b) => b.name === '搶槓')?.faan).toBe(1);
  });

  it('omits the fan when robbingKong is unset (default ron)', () => {
    const winningTile = suit('man', 5, 0);
    const hand: Tile[] = [
      suit('man', 1, 0),
      suit('pin', 2, 0),
      suit('pin', 3, 0),
      suit('pin', 4, 0),
      suit('sou', 5, 0),
      suit('sou', 6, 0),
      suit('sou', 7, 0),
      suit('sou', 8, 0),
      suit('sou', 9, 0),
      honor('E', 0),
      honor('E', 1),
      suit('man', 1, 1),
      suit('man', 1, 2),
    ];
    const state = stateWith(hand);
    const r = scoreHand({ state, winner: 0, winningTile, selfDraw: false });
    expect(r.breakdown.find((b) => b.name === '搶槓')).toBeUndefined();
  });
});

describe('scoring — blessings (天/地/人糊)', () => {
  it('天糊: dealer self-draw on opening 14-tile hand → 13', () => {
    const winningTile = suit('man', 5, 0);
    const hand: Tile[] = [
      suit('man', 1, 0),
      suit('man', 2, 0),
      suit('man', 3, 0),
      suit('pin', 4, 0),
      suit('pin', 5, 0),
      suit('pin', 6, 0),
      suit('sou', 7, 0),
      suit('sou', 8, 0),
      suit('sou', 9, 0),
      suit('man', 5, 1),
      suit('man', 5, 2),
      honor('E', 0),
      honor('E', 1),
    ];
    // dealer = 0 (default), no discards anywhere, no melds.
    const state = stateWith(hand);
    const r = scoreHand({ state, winner: 0, winningTile, selfDraw: true });
    expect(r.breakdown.find((b) => b.name === '天糊')?.faan).toBe(13);
  });

  it("地糊: non-dealer rons on dealer's first discard → 13", () => {
    const winningTile = suit('man', 5, 0);
    const hand: Tile[] = [
      suit('man', 1, 0),
      suit('man', 2, 0),
      suit('man', 3, 0),
      suit('pin', 4, 0),
      suit('pin', 5, 0),
      suit('pin', 6, 0),
      suit('sou', 7, 0),
      suit('sou', 8, 0),
      suit('sou', 9, 0),
      suit('man', 5, 1),
      suit('man', 5, 2),
      honor('E', 0),
      honor('E', 1),
    ];
    const state: GameState = {
      ...stateWith(hand),
      // dealer = 0, dealer has discarded the winning tile, others empty.
      discards: { 0: [winningTile], 1: [], 2: [], 3: [] },
    };
    const r = scoreHand({ state, winner: 1, winningTile, selfDraw: false });
    expect(r.breakdown.find((b) => b.name === '地糊')?.faan).toBe(13);
  });

  it('人糊: non-dealer wins on first own self-draw → 13', () => {
    const winningTile = suit('man', 5, 0);
    const hand: Tile[] = [
      suit('man', 1, 0),
      suit('man', 2, 0),
      suit('man', 3, 0),
      suit('pin', 4, 0),
      suit('pin', 5, 0),
      suit('pin', 6, 0),
      suit('sou', 7, 0),
      suit('sou', 8, 0),
      suit('sou', 9, 0),
      suit('man', 5, 1),
      suit('man', 5, 2),
      honor('E', 0),
      honor('E', 1),
    ];
    const state: GameState = {
      ...stateWith(hand),
      // Dealer has discarded once; non-dealer (seat 1) has not
      // discarded at all yet, no melds anywhere.
      discards: { 0: [suit('pin', 9, 3)], 1: [], 2: [], 3: [] },
    };
    const r = scoreHand({ state, winner: 1, winningTile, selfDraw: true });
    expect(r.breakdown.find((b) => b.name === '人糊')?.faan).toBe(13);
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
    const dragons = r.breakdown.find((b) => b.name === '大三元');
    expect(dragons?.faan).toBe(8);
    // Tile composition should include all 9 dragon tiles (3 each of Z/F/B).
    expect(dragons?.tiles).toHaveLength(9);
    expect(dragons?.tiles.filter((t) => t.kind === 'honor' && t.honor === 'Z')).toHaveLength(3);
    expect(dragons?.tiles.filter((t) => t.kind === 'honor' && t.honor === 'F')).toHaveLength(3);
    expect(dragons?.tiles.filter((t) => t.kind === 'honor' && t.honor === 'B')).toHaveLength(3);
  });
});
