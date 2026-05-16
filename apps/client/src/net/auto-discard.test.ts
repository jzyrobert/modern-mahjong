import type { Event as EngineEvent, Tile } from '@mahjong/game-logic';
import { describe, expect, it } from 'vitest';
import { detectAutoDiscardSeats } from './auto-discard';

const TILE_1M: Tile = { kind: 'suit', suit: 'man', rank: 1, copy: 0 };
const TILE_2M: Tile = { kind: 'suit', suit: 'man', rank: 2, copy: 0 };

function drew(seat: 0 | 1 | 2 | 3, tile: Tile = TILE_1M): EngineEvent {
  return { t: 'drew', seat, tile };
}
function discarded(seat: 0 | 1 | 2 | 3, tile: Tile = TILE_1M): EngineEvent {
  return { t: 'discarded', seat, tile };
}
const OPENED: EngineEvent = {
  t: 'opened',
  rolls: { dice: { 0: [3, 4] }, breakPosition: 7, fullRoll: false },
};

describe('detectAutoDiscardSeats', () => {
  it('returns an empty set for an empty batch', () => {
    expect(detectAutoDiscardSeats([])).toEqual(new Set());
  });

  it('returns an empty set when no draws happened in the batch', () => {
    expect(detectAutoDiscardSeats([discarded(0), OPENED])).toEqual(new Set());
  });

  it('flags a seat whose drew is immediately followed by their own discarded', () => {
    // The canonical auto-discard signature: the transport applied
    // `draw` then `discard` synchronously for seat 0 in the same
    // batch because the user ran out of time before ever drawing.
    expect(detectAutoDiscardSeats([drew(0, TILE_1M), discarded(0, TILE_1M)])).toEqual(new Set([0]));
  });

  it('does NOT flag a normal user draw (drew alone, discard arrives in a later delta)', () => {
    // A real user draw — the discard happens in a separate delta
    // once the user taps a tile. This batch should not suppress
    // `flashDrawAnimation`.
    expect(detectAutoDiscardSeats([drew(0)])).toEqual(new Set());
  });

  it('does NOT flag when the discarded seat differs from the drew seat', () => {
    // Out-of-band ordering that shouldn't realistically happen but
    // we don't want to false-positive on adjacent unrelated events.
    expect(detectAutoDiscardSeats([drew(0, TILE_1M), discarded(2, TILE_2M)])).toEqual(new Set());
  });

  it('does NOT flag when a non-discarded event sits between drew and discarded', () => {
    // E.g. an interleaved `opened` would mean the discard isn't part
    // of the same auto-discard atom — leave the popup intact.
    expect(detectAutoDiscardSeats([drew(0), OPENED, discarded(0)])).toEqual(new Set());
  });

  it('handles multiple auto-discards in one batch (different seats)', () => {
    // Theoretical — multiple seats auto-discarded in a tight window
    // and the engine batched their events. Each pair is independently
    // detectable.
    expect(
      detectAutoDiscardSeats([
        drew(0, TILE_1M),
        discarded(0, TILE_1M),
        drew(2, TILE_2M),
        discarded(2, TILE_2M),
      ]),
    ).toEqual(new Set([0, 2]));
  });

  it('correctly pairs the immediately-following discarded with each drew', () => {
    // Defensive: even with extra events around the pair, the
    // adjacency check (i, i+1) is what matters.
    expect(
      detectAutoDiscardSeats([
        OPENED,
        drew(0, TILE_1M),
        discarded(0, TILE_1M),
        OPENED, // unrelated event after — doesn't break the flag.
      ]),
    ).toEqual(new Set([0]));
  });
});
