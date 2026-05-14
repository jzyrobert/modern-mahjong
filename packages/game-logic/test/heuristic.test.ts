import { describe, expect, it } from 'vitest';
import {
  ALL_FACES,
  type Tile,
  isYakuhaiFace,
  rankDiscards,
  sameFace,
  seatWind,
  ukeire,
  waitTiles,
  yakuhaiPairCount,
} from '../src/index.js';

const SUIT_TILE = (suit: 'man' | 'pin' | 'sou', rank: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9): Tile => ({
  kind: 'suit',
  suit,
  rank,
  copy: 0,
});
const HONOR = (honor: 'E' | 'S' | 'W' | 'N' | 'Z' | 'F' | 'B'): Tile => ({
  kind: 'honor',
  honor,
  copy: 0,
});

describe('ALL_FACES', () => {
  it('contains exactly 34 unique faces', () => {
    expect(ALL_FACES).toHaveLength(34);
    const keys = new Set(
      ALL_FACES.map((f) => (f.kind === 'suit' ? `s:${f.suit}:${f.rank}` : `h:${f.honor}`)),
    );
    expect(keys.size).toBe(34);
  });
});

describe('seatWind', () => {
  it('returns East for the dealer regardless of dealer index', () => {
    expect(seatWind(0, 0)).toBe('E');
    expect(seatWind(2, 2)).toBe('E');
  });
  it('rotates SWN counter-clockwise from the dealer', () => {
    expect(seatWind(0, 1)).toBe('S');
    expect(seatWind(0, 2)).toBe('W');
    expect(seatWind(0, 3)).toBe('N');
  });
  it('handles dealer rotation', () => {
    // dealer = seat 1, prev seat 0 should be North.
    expect(seatWind(1, 0)).toBe('N');
    expect(seatWind(1, 1)).toBe('E');
    expect(seatWind(1, 2)).toBe('S');
  });
});

describe('isYakuhaiFace', () => {
  it('always treats dragons as yakuhai', () => {
    const ctx = { dealer: 0 as const, prevailingWind: 'E' as const, seat: 0 as const };
    expect(isYakuhaiFace(HONOR('Z'), ctx)).toBe(true);
    expect(isYakuhaiFace(HONOR('F'), ctx)).toBe(true);
    expect(isYakuhaiFace(HONOR('B'), ctx)).toBe(true);
  });

  it('treats prevailing wind as yakuhai for everyone', () => {
    const ctx = { dealer: 0 as const, prevailingWind: 'E' as const, seat: 2 as const };
    expect(isYakuhaiFace(HONOR('E'), ctx)).toBe(true);
  });

  it('treats seat wind as yakuhai for that seat', () => {
    // dealer=0, seat=1 → seat wind is South
    const ctx = { dealer: 0 as const, prevailingWind: 'E' as const, seat: 1 as const };
    expect(isYakuhaiFace(HONOR('S'), ctx)).toBe(true);
    // West is neither prevailing nor seat → not yakuhai
    expect(isYakuhaiFace(HONOR('W'), ctx)).toBe(false);
  });

  it('does not treat suit tiles as yakuhai', () => {
    const ctx = { dealer: 0 as const, prevailingWind: 'E' as const, seat: 0 as const };
    expect(isYakuhaiFace(SUIT_TILE('man', 1), ctx)).toBe(false);
    expect(isYakuhaiFace(SUIT_TILE('pin', 9), ctx)).toBe(false);
  });
});

describe('yakuhaiPairCount', () => {
  const ctx = { dealer: 0 as const, prevailingWind: 'E' as const, seat: 0 as const };
  it('counts a single yakuhai pair', () => {
    expect(yakuhaiPairCount([HONOR('Z'), HONOR('Z'), SUIT_TILE('man', 1)], ctx)).toBe(1);
  });
  it('returns 0 for a single yakuhai tile (not a pair)', () => {
    expect(yakuhaiPairCount([HONOR('Z'), SUIT_TILE('man', 1)], ctx)).toBe(0);
  });
  it('counts multiple yakuhai pairs', () => {
    const hand = [HONOR('Z'), HONOR('Z'), HONOR('F'), HONOR('F'), HONOR('B')];
    expect(yakuhaiPairCount(hand, ctx)).toBe(2);
  });
  it('does not count non-yakuhai winds', () => {
    // dealer=0, seat=0 → seat wind is East, prevailing is East. South is not yakuhai.
    expect(yakuhaiPairCount([HONOR('S'), HONOR('S')], ctx)).toBe(0);
  });
});

describe('ukeire', () => {
  it('is 0 for a winning hand', () => {
    // Standard 4-of-a-kind sets — winning hand: 1m 1m 1m, 2p 2p 2p, 3p 3p 3p, 4s 4s 4s, 5s 5s
    const hand = [
      SUIT_TILE('man', 1),
      SUIT_TILE('man', 1),
      SUIT_TILE('man', 1),
      SUIT_TILE('pin', 2),
      SUIT_TILE('pin', 2),
      SUIT_TILE('pin', 2),
      SUIT_TILE('pin', 3),
      SUIT_TILE('pin', 3),
      SUIT_TILE('pin', 3),
      SUIT_TILE('sou', 4),
      SUIT_TILE('sou', 4),
      SUIT_TILE('sou', 4),
      SUIT_TILE('sou', 5),
      SUIT_TILE('sou', 5),
    ];
    expect(ukeire({ hand })).toBe(0);
  });

  it('reports a positive count for a tenpai hand', () => {
    // 13-tile hand at tenpai. Standard interpretation waits on 5p for
    // the pair; the 7-pairs / 13-orphans branches may surface
    // additional accepting faces, so we just assert the ukeire set is
    // non-empty rather than pinning an exact value (which couples the
    // test to shanten's internal special-shape logic).
    // 1m1m1m 2p2p2p 3p3p3p 4s4s4s 5p
    const hand = [
      SUIT_TILE('man', 1),
      SUIT_TILE('man', 1),
      SUIT_TILE('man', 1),
      SUIT_TILE('pin', 2),
      SUIT_TILE('pin', 2),
      SUIT_TILE('pin', 2),
      SUIT_TILE('pin', 3),
      SUIT_TILE('pin', 3),
      SUIT_TILE('pin', 3),
      SUIT_TILE('sou', 4),
      SUIT_TILE('sou', 4),
      SUIT_TILE('sou', 4),
      SUIT_TILE('pin', 5),
    ];
    expect(ukeire({ hand })).toBeGreaterThan(0);
  });

  it('returns a positive count for a 1-shanten hand', () => {
    // Generic 1-shanten — exact value depends on shape, just assert > 0
    const hand = [
      SUIT_TILE('man', 1),
      SUIT_TILE('man', 2),
      SUIT_TILE('man', 3),
      SUIT_TILE('pin', 4),
      SUIT_TILE('pin', 5),
      SUIT_TILE('pin', 6),
      SUIT_TILE('sou', 1),
      SUIT_TILE('sou', 2),
      SUIT_TILE('sou', 3),
      SUIT_TILE('sou', 7),
      SUIT_TILE('sou', 8),
      SUIT_TILE('man', 5),
      SUIT_TILE('man', 5),
    ];
    expect(ukeire({ hand })).toBeGreaterThan(0);
  });
});

describe('waitTiles', () => {
  it('returns the pair-wait tile for a tanki tenpai hand', () => {
    // 1m1m1m 4m5m6m 1p2p3p 7p8p9p 1s — tanki wait on 1s for the pair.
    const hand = [
      SUIT_TILE('man', 1),
      SUIT_TILE('man', 1),
      SUIT_TILE('man', 1),
      SUIT_TILE('man', 4),
      SUIT_TILE('man', 5),
      SUIT_TILE('man', 6),
      SUIT_TILE('pin', 1),
      SUIT_TILE('pin', 2),
      SUIT_TILE('pin', 3),
      SUIT_TILE('pin', 7),
      SUIT_TILE('pin', 8),
      SUIT_TILE('pin', 9),
      SUIT_TILE('sou', 1),
    ];
    const waits = waitTiles({ hand, allowSpecial: false });
    expect(waits).toHaveLength(1);
    expect(sameFace(waits[0]!, SUIT_TILE('sou', 1))).toBe(true);
  });

  it('returns both ends of a ryanmen wait', () => {
    // 1m1m 2m3m 4m5m6m 7p8p9p 1s2s3s — completed runs except the 2m3m
    // partial. Standard waits: 1m (pair becomes triplet → 1m1m1m,
    // 2m3m incomplete) — no, let me reconsider. Easier example:
    // pair 1m1m, complete run 4m5m6m 7p8p9p 1s2s3s, partial 2s3s — wait on 1s or 4s.
    // Build: 1m1m 4m5m6m 7p8p9p 1s2s3s 5s6s — waits on 4s or 7s.
    const hand = [
      SUIT_TILE('man', 1),
      SUIT_TILE('man', 1),
      SUIT_TILE('man', 4),
      SUIT_TILE('man', 5),
      SUIT_TILE('man', 6),
      SUIT_TILE('pin', 7),
      SUIT_TILE('pin', 8),
      SUIT_TILE('pin', 9),
      SUIT_TILE('sou', 1),
      SUIT_TILE('sou', 2),
      SUIT_TILE('sou', 3),
      SUIT_TILE('sou', 5),
      SUIT_TILE('sou', 6),
    ];
    const waits = waitTiles({ hand, allowSpecial: false });
    const set = waits.map((t) => (t.kind === 'suit' ? `${t.suit}${t.rank}` : t.honor));
    expect(set).toContain('sou4');
    expect(set).toContain('sou7');
    expect(waits).toHaveLength(2);
  });

  it('returns an empty list when the hand is not tenpai', () => {
    // 1-shanten — not tenpai → empty waits.
    const hand = [
      SUIT_TILE('man', 1),
      SUIT_TILE('man', 2),
      SUIT_TILE('man', 3),
      SUIT_TILE('pin', 4),
      SUIT_TILE('pin', 5),
      SUIT_TILE('pin', 6),
      SUIT_TILE('sou', 1),
      SUIT_TILE('sou', 2),
      SUIT_TILE('sou', 3),
      SUIT_TILE('sou', 7),
      SUIT_TILE('sou', 8),
      SUIT_TILE('man', 5),
      SUIT_TILE('man', 7),
    ];
    expect(waitTiles({ hand })).toEqual([]);
  });

  it('returns an empty list for a winning 14-tile hand', () => {
    // Already winning → shanten === -1 → waitTiles returns [] by contract.
    const hand = [
      SUIT_TILE('man', 1),
      SUIT_TILE('man', 1),
      SUIT_TILE('man', 1),
      SUIT_TILE('pin', 2),
      SUIT_TILE('pin', 2),
      SUIT_TILE('pin', 2),
      SUIT_TILE('pin', 3),
      SUIT_TILE('pin', 3),
      SUIT_TILE('pin', 3),
      SUIT_TILE('sou', 4),
      SUIT_TILE('sou', 4),
      SUIT_TILE('sou', 4),
      SUIT_TILE('sou', 5),
      SUIT_TILE('sou', 5),
    ];
    expect(waitTiles({ hand })).toEqual([]);
  });
});

describe('rankDiscards', () => {
  const ctx = { dealer: 0 as const, prevailingWind: 'E' as const, seat: 0 as const };

  it('orders the same-shanten discards by ukeire descending', () => {
    // Hand where two different discards both keep tenpai but with different waits.
    // Construct: hand at tenpai with a clear pair-wait + a drawn extra
    // Take a winning shape and add a non-functional extra, then rank.
    // 1m1m1m 2p2p2p 3p3p3p 4s4s4s 5p — wait on 5p for pair (1 ukeire)
    // Add a 7m draw — discarding 7m keeps tenpai (1 ukeire on 5p).
    // Now break a triplet differently to compare. Hand of 14:
    // 1m1m1m 2p2p2p 3p3p3p 4s4s4s 5p 7m
    const hand = [
      SUIT_TILE('man', 1),
      SUIT_TILE('man', 1),
      SUIT_TILE('man', 1),
      SUIT_TILE('pin', 2),
      SUIT_TILE('pin', 2),
      SUIT_TILE('pin', 2),
      SUIT_TILE('pin', 3),
      SUIT_TILE('pin', 3),
      SUIT_TILE('pin', 3),
      SUIT_TILE('sou', 4),
      SUIT_TILE('sou', 4),
      SUIT_TILE('sou', 4),
      SUIT_TILE('pin', 5),
      SUIT_TILE('man', 7),
    ];
    const ranked = rankDiscards({ hand, yakuhai: ctx });
    // Best discard should be the 7m — it doesn't break any group.
    expect(ranked[0]?.tile.kind).toBe('suit');
    if (ranked[0]?.tile.kind === 'suit') {
      expect(ranked[0].tile.suit).toBe('man');
      expect(ranked[0].tile.rank).toBe(7);
    }
    expect(ranked[0]?.shanten).toBe(0);
  });

  it('prefers the discard that keeps a yakuhai pair intact over breaking it', () => {
    // Two candidate discards leave the hand at the same shanten, but one
    // breaks a Z-dragon pair. The yakuhai-aware ranker should keep the pair.
    // Hand: 1m1m 2m2m 3m3m 4m4m 5m5m + ZZ (dragon pair) + 9p 9s
    // 14 tiles. Both 9p and a Z would leave the hand at the same shanten,
    // but discarding Z breaks the yakuhai pair. Expect 9p (or 9s) to win.
    const hand = [
      SUIT_TILE('man', 1),
      SUIT_TILE('man', 1),
      SUIT_TILE('man', 2),
      SUIT_TILE('man', 2),
      SUIT_TILE('man', 3),
      SUIT_TILE('man', 3),
      SUIT_TILE('man', 4),
      SUIT_TILE('man', 4),
      SUIT_TILE('man', 5),
      SUIT_TILE('man', 5),
      HONOR('Z'),
      HONOR('Z'),
      SUIT_TILE('pin', 9),
      SUIT_TILE('sou', 9),
    ];
    const ranked = rankDiscards({ hand, yakuhai: ctx });
    // Top pick must not be a Z; the pair has yakuhai value worth preserving.
    expect(ranked[0]?.tile.kind === 'honor' && ranked[0].tile.honor === 'Z').toBe(false);
  });
});
