import { type Tile, tileId } from '@mahjong/game-logic';
import { describe, expect, it } from 'vitest';
import { manualOrderHand, orderHand } from './handSort';

const T_1M: Tile = { kind: 'suit', suit: 'man', rank: 1, copy: 0 };
const T_2M: Tile = { kind: 'suit', suit: 'man', rank: 2, copy: 0 };
const T_3M: Tile = { kind: 'suit', suit: 'man', rank: 3, copy: 0 };
const T_E: Tile = { kind: 'honor', honor: 'E', copy: 0 };

describe('orderHand', () => {
  it('suit mode delegates to the engine sortHand', () => {
    const out = orderHand([T_3M, T_1M, T_2M], 'suit');
    expect(out.map((t) => tileId(t))).toEqual([tileId(T_1M), tileId(T_2M), tileId(T_3M)]);
  });

  it('manual mode returns the input order untouched (no manualOrder available yet)', () => {
    const out = orderHand([T_3M, T_1M, T_2M], 'manual');
    expect(out.map((t) => tileId(t))).toEqual([tileId(T_3M), tileId(T_1M), tileId(T_2M)]);
  });
});

describe('manualOrderHand', () => {
  it('respects the explicit order for tiles whose ids are present', () => {
    const order = [tileId(T_3M), tileId(T_1M), tileId(T_2M)];
    const out = manualOrderHand([T_1M, T_2M, T_3M], order);
    expect(out.map((t) => tileId(t))).toEqual(order);
  });

  it('appends ids missing from the order to the end (drawn-tile path)', () => {
    // The user's manual order names two of the three tiles; the third
    // (T_E, the freshly-drawn honor) doesn't appear in the order yet.
    // It must land AT THE END so `DrawTileOverlay`'s fly target lines
    // up with the rightmost `HandTile` slot.
    const order = [tileId(T_1M), tileId(T_2M)];
    const out = manualOrderHand([T_1M, T_2M, T_E], order);
    expect(out.map((t) => tileId(t))).toEqual([tileId(T_1M), tileId(T_2M), tileId(T_E)]);
  });

  it('keeps multiple unknown ids stable amongst themselves at the end', () => {
    const order = [tileId(T_1M)];
    const out = manualOrderHand([T_E, T_1M, T_2M], order);
    expect(out.map((t) => tileId(t))).toEqual([tileId(T_1M), tileId(T_E), tileId(T_2M)]);
  });
});
