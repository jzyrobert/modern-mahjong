import type { Seat } from '@mahjong/game-logic';
import type { PlaybackPov } from '../../replay/playback';
import type { Position } from '../match/seatColor';

/** The seat the point of view anchors at the bottom (spectators default to seat 0). */
export function povSeat(pov: PlaybackPov, localSeat: Seat | 'spectator'): Seat {
  return pov !== 'all' ? pov : localSeat !== 'spectator' ? localSeat : 0;
}

// Mirror the live match: bottom-seat-is-you. POV picker overrides the
// anchor; spectator records fall back to seat 0.
const POSITION_CYCLE: readonly Position[] = ['bottom', 'right', 'top', 'left'];
export function positionMapFor(
  pov: PlaybackPov,
  localSeat: Seat | 'spectator',
): Record<Seat, Position> {
  const anchor = povSeat(pov, localSeat);
  return {
    0: POSITION_CYCLE[(0 - anchor + 4) % 4]!,
    1: POSITION_CYCLE[(1 - anchor + 4) % 4]!,
    2: POSITION_CYCLE[(2 - anchor + 4) % 4]!,
    3: POSITION_CYCLE[(3 - anchor + 4) % 4]!,
  };
}
