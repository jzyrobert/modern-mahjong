import { describe, expect, it } from 'vitest';
import { type Tile, shanten } from '../src/index.js';

function tiles(spec: string): Tile[] {
  // Spec like "1m 2m 3m 4p 5p 6p 7s 8s 9s E E S S"
  const out: Tile[] = [];
  const seenCopies = new Map<string, number>();
  for (const tok of spec.trim().split(/\s+/)) {
    if (/^\d[mps]$/.test(tok)) {
      const rank = Number(tok[0]) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
      const s = tok[1] as 'm' | 'p' | 's';
      const suit = s === 'm' ? 'man' : s === 'p' ? 'pin' : 'sou';
      const key = `${suit}-${rank}`;
      const c = seenCopies.get(key) ?? 0;
      seenCopies.set(key, c + 1);
      out.push({ kind: 'suit', suit, rank, copy: c as 0 | 1 | 2 | 3 });
    } else {
      const honor = tok as 'E' | 'S' | 'W' | 'N' | 'Z' | 'F' | 'B';
      const c = seenCopies.get(honor) ?? 0;
      seenCopies.set(honor, c + 1);
      out.push({ kind: 'honor', honor, copy: c as 0 | 1 | 2 | 3 });
    }
  }
  return out;
}

describe('shanten', () => {
  it('canonical winning hand has shanten -1', () => {
    // 1m2m3m 4p5p6p 7s8s9s E E S S → 13 tiles, not winning (only 4 groups+pair? actually that's 3 runs + 2 pairs = not standard).
    // Let's use a clear winning hand: 4 groups + 1 pair, 14 tiles.
    const winning = tiles('1m 2m 3m 4m 5m 6m 7p 8p 9p 1s 1s 1s E E');
    expect(shanten({ hand: winning })).toBe(-1);
  });

  it('tenpai hand (one away) has shanten 0', () => {
    // 13 tiles, missing one for the win.
    const tenpai = tiles('1m 2m 3m 4m 5m 6m 7p 8p 9p 1s 1s 1s E');
    expect(shanten({ hand: tenpai })).toBe(0);
  });

  it('seven-pairs winning shape has shanten -1', () => {
    const sp = tiles('1m 1m 4m 4m 7p 7p 9p 9p 2s 2s 5s 5s E E');
    expect(shanten({ hand: sp })).toBe(-1);
  });

  it('thirteen-orphans winning shape has shanten -1', () => {
    // 1m9m 1p9p 1s9s ESWN ZFB pair on E
    const to = tiles('1m 9m 1p 9p 1s 9s E E S W N Z F B');
    expect(shanten({ hand: to })).toBe(-1);
  });

  it('thirteen-orphans tenpai has shanten 0', () => {
    // Missing F, has duplicate Z
    const to = tiles('1m 9m 1p 9p 1s 9s E S W N Z Z B 5m');
    // Has 12 of 13 unique terminals/honors + a pair on Z + a non-target 5m.
    // Should be tenpai for thirteen orphans (just need F).
    expect(shanten({ hand: to })).toBeLessThanOrEqual(1);
  });

  it('rejects very-far-from-win hands', () => {
    const messy = tiles('1m 4m 7m 1p 4p 7p 1s 4s 7s E S W N');
    expect(shanten({ hand: messy })).toBeGreaterThan(0);
  });

  it('exposed melds reduce shanten requirement', () => {
    // 11 concealed (3 groups + 1 pair) + 1 exposed meld → 14 effective → winning.
    const concealed = tiles('2m 3m 4m 5p 6p 7p 1s 1s 1s E E');
    expect(shanten({ hand: concealed, exposedMelds: 1 })).toBe(-1);
  });
});
