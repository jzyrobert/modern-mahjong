import {
  type Seat,
  type Wind,
  acrossSeat,
  nextSeat,
  prevSeat,
  seatWindFor,
} from '@mahjong/game-logic';
import type { Position } from './seatColor';

/**
 * Placement of a seat on the visible match table — pairs the engine's
 * `Seat` index with the perimeter `Position` (always-bottom for the
 * user, opponents rotate counter-clockwise) and the dealer-relative
 * wind glyph the seat is currently flagged with.
 */
export interface SeatPlacement {
  seat: Seat;
  position: Position;
  seatWind: Wind;
}

/**
 * Translate (mySeat, dealer) into the four-seat table layout: the
 * user's seat sits at the bottom; the next, across, and previous
 * seats wrap counter-clockwise to right / top / left. Each placement
 * carries the seat's dealer-relative wind glyph from
 * `seatWindFor`. Used by the desktop perimeter felt
 * (`DesktopTable`) and by the lobby waiting-room (`Match`)
 * — extracted here so the two callers can't drift.
 */
export function layoutFor(mySeat: Seat, dealer: Seat): SeatPlacement[] {
  return [
    { seat: mySeat, position: 'bottom', seatWind: seatWindFor(dealer, mySeat) },
    {
      seat: nextSeat(mySeat),
      position: 'right',
      seatWind: seatWindFor(dealer, nextSeat(mySeat)),
    },
    {
      seat: acrossSeat(mySeat),
      position: 'top',
      seatWind: seatWindFor(dealer, acrossSeat(mySeat)),
    },
    {
      seat: prevSeat(mySeat),
      position: 'left',
      seatWind: seatWindFor(dealer, prevSeat(mySeat)),
    },
  ];
}
