import { describe, expect, it } from 'vitest';
import {
  buildWall,
  sameFace,
  sameTile,
  shuffle,
  tileFromId,
  tileId,
  tileLabel,
  TOTAL_TILES,
} from '../src/index.js';

describe('tile model', () => {
  it('builds exactly 136 tiles', () => {
    const wall = buildWall();
    expect(wall.length).toBe(TOTAL_TILES);
  });

  it('every tile has a unique id', () => {
    const wall = buildWall();
    const ids = new Set(wall.map(tileId));
    expect(ids.size).toBe(136);
    for (const id of ids) {
      expect(id).toBeGreaterThanOrEqual(0);
      expect(id).toBeLessThan(136);
    }
  });

  it('tileId / tileFromId roundtrip', () => {
    for (const t of buildWall()) {
      expect(sameTile(tileFromId(tileId(t)), t)).toBe(true);
    }
  });

  it('sameFace ignores copy index but distinguishes face', () => {
    const w = buildWall();
    const fiveMan = w.find((t) => t.kind === 'suit' && t.suit === 'man' && t.rank === 5)!;
    const fiveManAgain = w.find(
      (t) => t.kind === 'suit' && t.suit === 'man' && t.rank === 5 && t.copy !== fiveMan.copy,
    )!;
    const sixMan = w.find((t) => t.kind === 'suit' && t.suit === 'man' && t.rank === 6)!;
    expect(sameFace(fiveMan, fiveManAgain)).toBe(true);
    expect(sameFace(fiveMan, sixMan)).toBe(false);
  });

  it('shuffle is deterministic by seed', () => {
    const a = shuffle(buildWall(), 42);
    const b = shuffle(buildWall(), 42);
    const c = shuffle(buildWall(), 43);
    expect(a.map(tileId)).toEqual(b.map(tileId));
    expect(a.map(tileId)).not.toEqual(c.map(tileId));
  });

  it('tileLabel renders sensibly', () => {
    expect(tileLabel({ kind: 'suit', suit: 'man', rank: 5, copy: 0 })).toBe('5m');
    expect(tileLabel({ kind: 'suit', suit: 'pin', rank: 9, copy: 2 })).toBe('9p');
    expect(tileLabel({ kind: 'honor', honor: 'E', copy: 0 })).toBe('E');
  });
});
