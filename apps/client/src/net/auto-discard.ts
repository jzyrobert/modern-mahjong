import type { Event as EngineEvent } from '@mahjong/game-logic';

/**
 * Detect which seats had a turn-timeout auto-discard inside a single
 * `delta` batch from the wire.
 *
 * Signature: a `drew` event immediately followed by a `discarded`
 * event for the same seat — the transport's auto-discard path
 * (`solo-transport.ts` mirror of `MatchSession.forceTurnAutoDiscard`)
 * applies these two actions back-to-back in one batch when the user
 * (or any seat) runs out of time without ever rendering a `HandTile`
 * for the drawn tile.
 *
 * Used by the wire router to suppress `flashDrawAnimation` for these
 * synthetic draws: the user never actually held the tile, the
 * `HandTile.measureInWindow` round-trip can't fire (the tile leaves
 * `state.hands` before any layout pass), and the resulting popup
 * would fly into the fallback geometry over an empty slot. The
 * discard's `playTileClick` is enough audio feedback.
 *
 * Pure function (no zustand reads, no engine reads). Returns the set
 * of seats with an auto-discard signature in this batch.
 */
export function detectAutoDiscardSeats(events: ReadonlyArray<EngineEvent>): ReadonlySet<number> {
  const result = new Set<number>();
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (!ev || ev.t !== 'drew') continue;
    const next = events[i + 1];
    if (next?.t === 'discarded' && next.seat === ev.seat) {
      result.add(ev.seat);
    }
  }
  return result;
}
