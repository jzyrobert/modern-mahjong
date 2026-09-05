import type { Event as EngineEvent, Seat, Tile } from '@mahjong/game-logic';
import { tileLabel } from '@mahjong/game-logic';
import { COLORS } from '../colors';

/** Event log copy + classification shared by the paper and glass players. */
export function eventIndexHint(_event: EngineEvent): string {
  return '';
}

export type EventKindBucket = 'gang' | 'claim' | 'draw' | 'discard' | 'other';
export const EVENT_BORDER: Record<EventKindBucket, string> = {
  gang: '#a64ad9',
  claim: COLORS.gold,
  draw: COLORS.success,
  discard: COLORS.creamLow,
  other: COLORS.creamLow,
};

export function eventKind(e: EngineEvent): EventKindBucket {
  switch (e.t) {
    case 'gangDeclared':
      return 'gang';
    case 'claimsOpened':
    case 'claimsResolved':
      return 'claim';
    case 'drew':
      return 'draw';
    case 'discarded':
      return 'discard';
    default:
      return 'other';
  }
}

export function describeEvent(e: EngineEvent): string {
  switch (e.t) {
    case 'handStarted':
      return `Hand started (seed ${e.seed})`;
    case 'opened':
      return e.rolls.fullRoll ? 'Opening rolls — all four seats rolled' : 'Winner re-rolled';
    case 'rulesChanged':
      return 'Rules updated';
    case 'drew':
      return `Seat ${e.seat} drew a tile`;
    case 'discarded':
      return `Seat ${e.seat} discarded ${tileLabel(e.tile)}`;
    case 'claimsOpened':
      return 'Claim window open';
    case 'claimsResolved':
      if (e.result.kind === 'pass') return 'All passed';
      return `Seat ${e.result.seat} called ${e.result.claim.kind}`;
    case 'gangDeclared':
      return `Seat ${e.seat} declared ${e.kind} gang`;
    case 'won':
      return `Seat ${e.seat} won ${e.faan} faan${e.selfDraw ? ' (self-draw)' : ''}`;
    case 'drawn-game':
      return 'Drawn game — wall empty';
    default:
      return JSON.stringify(e);
  }
}

/** Spoken tile name — "5 pin", "East wind", "Red dragon" (the glass player's copy). */
export function readableTile(t: Tile): string {
  if (t.kind === 'suit') return `${t.rank} ${t.suit}`;
  switch (t.honor) {
    case 'E':
      return 'East wind';
    case 'S':
      return 'South wind';
    case 'W':
      return 'West wind';
    case 'N':
      return 'North wind';
    case 'Z':
      return 'Red dragon';
    case 'F':
      return 'Green dragon';
    default:
      return 'White dragon';
  }
}

/**
 * `describeEvent` with the players' names and spoken tile names — the
 * glass player's ticker and events rail ("Siu Yin discarded 2 sou").
 * The paper player keeps the seat-numbered form above.
 */
export function describeEventNamed(e: EngineEvent, nameFor: (seat: Seat) => string): string {
  switch (e.t) {
    case 'drew':
      return `${nameFor(e.seat)} drew a tile`;
    case 'discarded':
      return `${nameFor(e.seat)} discarded ${readableTile(e.tile)}`;
    case 'claimsResolved':
      if (e.result.kind === 'pass') return 'All passed';
      return `${nameFor(e.result.seat)} called ${e.result.claim.kind}`;
    case 'gangDeclared':
      return `${nameFor(e.seat)} declared ${e.kind} gang`;
    case 'won':
      return `${nameFor(e.seat)} won ${e.faan} faan${e.selfDraw ? ' (self-draw)' : ''}`;
    default:
      return describeEvent(e);
  }
}
