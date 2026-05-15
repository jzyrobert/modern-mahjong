import type { Event as EngineEvent, OpeningRolls, Tile } from '@mahjong/game-logic';
import { tileId } from '@mahjong/game-logic';
import { beforeEach, describe, expect, it } from 'vitest';
import { useGame } from './game';

// Re-derivation of LOG_CAPACITY from the module under test — kept
// here so the tests double-check the value rather than coupling to a
// private export. If the constant changes in `./game.ts`, an explicit
// expectation here (`expect(LOG_CAPACITY).toBe(...)`-style) would
// catch it; the size-trim test below depends on the number directly.
const LOG_CAPACITY = 12;

// Tiles + events tagged as their concrete `EngineEvent` shape so the
// store's discriminated-union narrowing in `appendEvents` exercises
// the real paths rather than a `Event[]` cast.
const TILE_1M: Tile = { kind: 'suit', suit: 'man', rank: 1, copy: 0 };
const TILE_2M: Tile = { kind: 'suit', suit: 'man', rank: 2, copy: 0 };
const TILE_3M: Tile = { kind: 'suit', suit: 'man', rank: 3, copy: 0 };

function drewEvent(seat: 0 | 1 | 2 | 3, tile: Tile = TILE_1M): EngineEvent {
  return { t: 'drew', seat, tile };
}

function discardedEvent(seat: 0 | 1 | 2 | 3, tile: Tile = TILE_1M): EngineEvent {
  return { t: 'discarded', seat, tile };
}

const HAND_STARTED: EngineEvent = { t: 'handStarted', seed: 42 };

const OPENED_ROLLS: OpeningRolls = {
  dice: { 0: [3, 4] },
  breakPosition: 7,
  fullRoll: false,
};

// `opened` is a benign non-state-touching event we use to drive the
// log-capacity trim without touching drawnTileId / manualOrder.
const OPENED_EVENT: EngineEvent = { t: 'opened', rolls: OPENED_ROLLS };

beforeEach(() => {
  // Reset only the slices `appendEvents` reads / writes. Partial set
  // — don't pass `replace: true`, that would strip the action methods
  // off the store. (Same pattern as `replay/recorder.test.ts`.)
  useGame.setState({
    log: [],
    drawnTileId: null,
    manualOrder: [],
    you: null,
  });
});

describe('useGame.appendEvents', () => {
  it('is a no-op for an empty events array', () => {
    const before = useGame.getState();
    useGame.getState().appendEvents([]);
    const after = useGame.getState();
    expect(after.log).toBe(before.log);
    expect(after.drawnTileId).toBe(before.drawnTileId);
    expect(after.manualOrder).toBe(before.manualOrder);
  });

  it('numbers events from seq 0 when the log is empty', () => {
    useGame.getState().appendEvents([OPENED_EVENT, drewEvent(0)]);
    const log = useGame.getState().log;
    expect(log.map((e) => e.seq)).toEqual([0, 1]);
  });

  it('continues seq numbering after prior events', () => {
    useGame.getState().appendEvents([OPENED_EVENT]);
    useGame.getState().appendEvents([drewEvent(0), discardedEvent(0)]);
    const log = useGame.getState().log;
    expect(log.map((e) => e.seq)).toEqual([0, 1, 2]);
  });

  it('trims the log to LOG_CAPACITY entries (oldest dropped, seq preserved)', () => {
    // Push 1.5× capacity so the trim runs and the kept slice is the
    // newest LOG_CAPACITY entries.
    const total = LOG_CAPACITY + 6;
    const events: EngineEvent[] = Array.from({ length: total }, () => OPENED_EVENT);
    useGame.getState().appendEvents(events);
    const log = useGame.getState().log;
    expect(log).toHaveLength(LOG_CAPACITY);
    // Oldest 6 should have been dropped; the kept window starts at
    // seq=6 (events emitted from 0..total-1, trimmed to the last 12).
    expect(log[0]!.seq).toBe(total - LOG_CAPACITY);
    expect(log[log.length - 1]!.seq).toBe(total - 1);
  });

  it('on the local seat `drew`, sets drawnTileId and appends to manualOrder', () => {
    useGame.setState({ you: 0 });
    useGame.getState().appendEvents([drewEvent(0, TILE_2M)]);
    const after = useGame.getState();
    expect(after.drawnTileId).toBe(tileId(TILE_2M));
    expect(after.manualOrder).toEqual([tileId(TILE_2M)]);
  });

  it('ignores `drew` events for other seats', () => {
    useGame.setState({ you: 0, manualOrder: [tileId(TILE_3M)] });
    useGame.getState().appendEvents([drewEvent(2, TILE_2M)]);
    const after = useGame.getState();
    expect(after.drawnTileId).toBeNull();
    expect(after.manualOrder).toEqual([tileId(TILE_3M)]);
  });

  it('on the local seat `discarded`, clears drawnTileId and removes from manualOrder', () => {
    useGame.setState({
      you: 0,
      drawnTileId: tileId(TILE_2M),
      manualOrder: [tileId(TILE_3M), tileId(TILE_2M)],
    });
    useGame.getState().appendEvents([discardedEvent(0, TILE_2M)]);
    const after = useGame.getState();
    expect(after.drawnTileId).toBeNull();
    expect(after.manualOrder).toEqual([tileId(TILE_3M)]);
  });

  it('ignores `discarded` events for other seats', () => {
    useGame.setState({
      you: 0,
      drawnTileId: tileId(TILE_2M),
      manualOrder: [tileId(TILE_2M)],
    });
    useGame.getState().appendEvents([discardedEvent(2, TILE_2M)]);
    const after = useGame.getState();
    expect(after.drawnTileId).toBe(tileId(TILE_2M));
    expect(after.manualOrder).toEqual([tileId(TILE_2M)]);
  });

  it('on `handStarted`, resets drawnTileId + manualOrder', () => {
    useGame.setState({
      you: 0,
      drawnTileId: tileId(TILE_2M),
      manualOrder: [tileId(TILE_2M), tileId(TILE_3M)],
    });
    useGame.getState().appendEvents([HAND_STARTED]);
    const after = useGame.getState();
    expect(after.drawnTileId).toBeNull();
    expect(after.manualOrder).toEqual([]);
  });

  it('leaves drawnTileId / manualOrder alone when `you` is null (lobby / pre-join)', () => {
    useGame.setState({
      you: null,
      drawnTileId: tileId(TILE_2M),
      manualOrder: [tileId(TILE_2M)],
    });
    useGame.getState().appendEvents([drewEvent(0, TILE_3M), discardedEvent(0, TILE_2M)]);
    const after = useGame.getState();
    expect(after.drawnTileId).toBe(tileId(TILE_2M));
    expect(after.manualOrder).toEqual([tileId(TILE_2M)]);
  });

  it("leaves drawnTileId / manualOrder alone when `you === 'spectator'`", () => {
    useGame.setState({
      you: 'spectator',
      drawnTileId: null,
      manualOrder: [],
    });
    useGame.getState().appendEvents([drewEvent(0, TILE_2M)]);
    const after = useGame.getState();
    expect(after.drawnTileId).toBeNull();
    expect(after.manualOrder).toEqual([]);
  });

  it('processes a multi-event batch from the local seat in order (drew → discard → drew)', () => {
    useGame.setState({ you: 0 });
    useGame
      .getState()
      .appendEvents([drewEvent(0, TILE_1M), discardedEvent(0, TILE_1M), drewEvent(0, TILE_2M)]);
    const after = useGame.getState();
    // Final draw wins for both fields.
    expect(after.drawnTileId).toBe(tileId(TILE_2M));
    expect(after.manualOrder).toEqual([tileId(TILE_2M)]);
  });

  it('avoids duplicate manualOrder entries when the same face is re-drawn', () => {
    useGame.setState({ you: 0, manualOrder: [tileId(TILE_2M)] });
    // Same face, same copy bit → identical tileId → existing entry
    // stays put rather than being duplicated.
    useGame.getState().appendEvents([drewEvent(0, TILE_2M)]);
    const after = useGame.getState();
    expect(after.manualOrder).toEqual([tileId(TILE_2M)]);
  });
});
