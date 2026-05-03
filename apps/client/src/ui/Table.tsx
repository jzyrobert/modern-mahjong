import {
  type Tile as MTile,
  type Seat,
  WINDS,
  type Wind,
  acrossSeat,
  nextSeat,
  prevSeat,
} from '@mahjong/game-logic';
import type { ReactNode } from 'react';
import type { LobbyState } from '../state/game.js';
import { DiscardPile } from './DiscardPile.js';
import { Hand } from './Hand.js';
import { Wall } from './Wall.js';
import { MeldStrip } from './match/MeldStrip.js';
import { PlayerBadge } from './match/PlayerBadge.js';
import { type SortMode, SortPicker } from './match/SortPicker.js';

interface TableProps {
  /** The viewer's seat — placed at the bottom. */
  mySeat: Seat;
  /** Dealer seat from the engine — drives seat-wind rotation. */
  dealer: Seat;
  /** Seat whose turn it currently is (for the active-turn glow). */
  turn: Seat;
  /** Cumulative scores per seat (`state.scoreboard`). */
  scoreboard: Record<Seat, number>;
  hands: Record<Seat, MTile[]>;
  discards: Record<Seat, MTile[]>;
  /** Live wall split per seat (engine `state.wall` distributed by index modulo 4). */
  wallSlices: Record<Seat, readonly MTile[]>;
  /** Lobby snapshot — drives PlayerBadge name + initials. */
  lobby: LobbyState | null;
  ownHandClickable?: ((t: MTile) => void) | undefined;
  /**
   * When set, the user's wall has a pulsing first tile that triggers this
   * callback on click — replaces the older floating draw-tile.
   */
  onDrawNext?: (() => void) | undefined;
  /** Sort mode for the user's hand. */
  sortMode: SortMode;
  onSortModeChange: (mode: SortMode) => void;
  centerHud?: ReactNode;
}

interface SeatPosition {
  seat: Seat;
  position: 'bottom' | 'right' | 'top' | 'left';
  /** CSS Grid (column, row) in the outer 3×3 board grid. */
  outer: [number, number];
  /** CSS Grid position within the inner discards grid. */
  inner: [number, number];
  /** Tile rotation for face-down opponent hands. */
  rotate: number;
  /** Outer-grid alignment hints. */
  align: { justifySelf?: string; alignSelf?: string };
  /** Wrapping rotation transform for the opponent's Hand row. */
  wrapTransform?: string;
}

export function Table({
  mySeat,
  dealer,
  turn,
  scoreboard,
  hands,
  discards,
  wallSlices,
  lobby,
  ownHandClickable,
  onDrawNext,
  sortMode,
  onSortModeChange,
  centerHud,
}: TableProps) {
  const positions = layoutFor(mySeat);
  const me = positions[0];
  const opponents = [positions[1], positions[2], positions[3]];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gridTemplateRows: 'auto 1fr auto',
        gap: 'clamp(4px, 1vmin, 12px)',
        // Scale the table to whatever vertical space is available — on a
        // landscape phone (~360px tall) this collapses to ~360px instead of
        // forcing a fixed 560 that overflows the viewport.
        minHeight: 'min(620px, 80vh)',
        padding: 'clamp(6px, 1.4vmin, 16px)',
        // Sage felt with a cream inner ring and gold outer hairline — ported
        // from /tmp/design/design/app.jsx's central felt frame.
        background: `radial-gradient(ellipse at 50% 40%,
          oklch(0.5 0.06 145) 0%,
          oklch(0.4 0.06 145) 55%,
          oklch(0.32 0.06 150) 100%)`,
        boxShadow: `
          inset 0 0 0 5px oklch(0.3 0.06 150),
          inset 0 0 0 10px oklch(0.78 0.14 80 / 0.45),
          inset 0 0 60px rgba(0,0,0,0.18),
          0 12px 32px -8px rgba(40,30,20,0.3)
        `,
        borderRadius: 24,
        color: 'oklch(0.95 0.02 85)',
      }}
    >
      {opponents.map((p) => {
        const seatWind = seatWindFor(dealer, p.seat);
        const handTile = (
          <Hand tiles={hands[p.seat]} faceDown rotate={p.wrapTransform ? 0 : p.rotate} />
        );
        const wallTile = <Wall tiles={wallSlices[p.seat]} rows={1} showCount={false} />;
        const meldStrip = <MeldStrip orientation={p.position === 'top' ? 'horiz' : 'vert'} />;
        return (
          <div
            key={p.seat}
            style={{
              gridColumn: p.outer[0],
              gridRow: p.outer[1],
              ...p.align,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <PlayerBadge
              seat={p.seat}
              position={p.position}
              seatWind={seatWind}
              lobby={lobby}
              score={scoreboard[p.seat]}
              isActive={turn === p.seat}
            />
            <div
              style={
                p.wrapTransform ? { transform: p.wrapTransform, whiteSpace: 'nowrap' } : undefined
              }
            >
              <div
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}
              >
                {p.wrapTransform ? wallTile : handTile}
                {p.wrapTransform ? handTile : wallTile}
              </div>
            </div>
            {meldStrip}
          </div>
        );
      })}

      <div
        style={{
          gridColumn: 2,
          gridRow: 2,
          display: 'grid',
          gridTemplateColumns: 'auto 1fr auto',
          gridTemplateRows: 'auto 1fr auto',
          gap: 'clamp(4px, 0.8vmin, 8px)',
          padding: 'clamp(6px, 1.2vmin, 12px)',
          minHeight: 'min(220px, 38vh)',
        }}
      >
        {positions.map((p) => (
          <div
            key={p.seat}
            style={{
              gridColumn: p.inner[0],
              gridRow: p.inner[1],
              ...p.align,
            }}
          >
            <DiscardPile tiles={discards[p.seat]} rotate={p.rotate} />
          </div>
        ))}
        <div
          style={{
            gridColumn: 2,
            gridRow: 2,
            alignSelf: 'center',
            justifySelf: 'center',
            textAlign: 'center',
          }}
        >
          {centerHud}
        </div>
      </div>

      <div
        style={{
          gridColumn: me.outer[0],
          gridRow: me.outer[1],
          justifySelf: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <Wall tiles={wallSlices[me.seat]} rows={1} onDrawNext={onDrawNext} />
        <PlayerBadge
          seat={me.seat}
          position="bottom"
          seatWind={seatWindFor(dealer, me.seat)}
          lobby={lobby}
          score={scoreboard[me.seat]}
          isActive={turn === me.seat}
        />
        <SortPicker mode={sortMode} onChange={onSortModeChange} />
        <Hand tiles={hands[me.seat]} onTileClick={ownHandClickable} sortMode={sortMode} />
      </div>
    </div>
  );
}

/**
 * Seat wind derives from dealer position: dealer is East, then S/W/N going
 * counter-clockwise around the table. Same `nextSeat` ordering the engine
 * uses for turn rotation.
 */
function seatWindFor(dealer: Seat, seat: Seat): Wind {
  const offset = (seat - dealer + 4) % 4;
  return WINDS[offset]!;
}

function layoutFor(mySeat: Seat): [SeatPosition, SeatPosition, SeatPosition, SeatPosition] {
  return [
    {
      seat: mySeat,
      position: 'bottom',
      outer: [2, 3],
      inner: [2, 3],
      rotate: 0,
      align: { justifySelf: 'center' },
    },
    {
      seat: nextSeat(mySeat),
      position: 'right',
      outer: [3, 2],
      inner: [3, 2],
      // Right seat: top of each tile must point LEFT (toward center) so
      // the seat reads them upright. CSS rotate is clockwise, so -90.
      rotate: -90,
      align: { alignSelf: 'center', justifySelf: 'end' },
      wrapTransform: 'rotate(-90deg)',
    },
    {
      seat: acrossSeat(mySeat),
      position: 'top',
      outer: [2, 1],
      inner: [2, 1],
      rotate: 180,
      align: { justifySelf: 'center' },
    },
    {
      seat: prevSeat(mySeat),
      position: 'left',
      outer: [1, 2],
      inner: [1, 2],
      // Left seat: top of each tile must point RIGHT (toward center).
      rotate: 90,
      align: { alignSelf: 'center' },
      wrapTransform: 'rotate(90deg)',
    },
  ];
}
