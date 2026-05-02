import type { Tile as MTile, Seat } from '@mahjong/game-logic';
import { acrossSeat, nextSeat, prevSeat } from '@mahjong/game-logic';
import type { ReactNode } from 'react';
import { DiscardPile } from './DiscardPile.js';
import { Hand } from './Hand.js';

interface TableProps {
  /** The viewer's seat — placed at the bottom. */
  mySeat: Seat;
  hands: Record<Seat, MTile[]>;
  discards: Record<Seat, MTile[]>;
  ownHandClickable?: ((t: MTile) => void) | undefined;
  centerHud?: ReactNode;
}

interface SeatPosition {
  seat: Seat;
  /** CSS Grid (column, row) in the outer 3×3 board grid. */
  outer: [number, number];
  /** CSS Grid position within the inner discards grid. */
  inner: [number, number];
  /** Tile rotation for face-down opponent hands. */
  rotate: number;
  /** Outer-grid alignment hints. */
  align: { justifySelf?: string; alignSelf?: string };
  label: string;
  /** Wrapping rotation transform for the opponent's Hand row. */
  wrapTransform?: string;
}

export function Table({ mySeat, hands, discards, ownHandClickable, centerHud }: TableProps) {
  const positions = layoutFor(mySeat);
  const me = positions[0];
  const opponents = [positions[1], positions[2], positions[3]];

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr auto',
        gridTemplateRows: 'auto 1fr auto',
        gap: 12,
        minHeight: 560,
        padding: 16,
        background: 'radial-gradient(ellipse at center, #1f3b2c 0%, #0e1c14 100%)',
        borderRadius: 12,
        color: '#eee',
      }}
    >
      {opponents.map((p) => (
        <div
          key={p.seat}
          style={{
            gridColumn: p.outer[0],
            gridRow: p.outer[1],
            ...p.align,
          }}
        >
          <SeatLabel label={p.label} />
          <div
            style={
              p.wrapTransform ? { transform: p.wrapTransform, whiteSpace: 'nowrap' } : undefined
            }
          >
            <Hand tiles={hands[p.seat]} faceDown rotate={p.rotate} />
          </div>
        </div>
      ))}

      <div
        style={{
          gridColumn: 2,
          gridRow: 2,
          display: 'grid',
          gridTemplateColumns: 'auto 1fr auto',
          gridTemplateRows: 'auto 1fr auto',
          gap: 8,
          background: '#0d1812aa',
          borderRadius: 10,
          padding: 12,
          minHeight: 220,
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
            fontSize: 12,
            opacity: 0.75,
            textAlign: 'center',
          }}
        >
          {centerHud}
        </div>
      </div>

      <div style={{ gridColumn: me.outer[0], gridRow: me.outer[1], justifySelf: 'center' }}>
        <SeatLabel label={me.label} />
        <Hand tiles={hands[me.seat]} onTileClick={ownHandClickable} />
      </div>
    </div>
  );
}

function layoutFor(mySeat: Seat): [SeatPosition, SeatPosition, SeatPosition, SeatPosition] {
  return [
    {
      seat: mySeat,
      outer: [2, 3],
      inner: [2, 3],
      rotate: 0,
      align: { justifySelf: 'center' },
      label: 'You',
    },
    {
      seat: nextSeat(mySeat),
      outer: [3, 2],
      inner: [3, 2],
      rotate: 90,
      align: { alignSelf: 'center', justifySelf: 'end' },
      label: `Seat ${nextSeat(mySeat)}`,
      wrapTransform: 'rotate(-90deg)',
    },
    {
      seat: acrossSeat(mySeat),
      outer: [2, 1],
      inner: [2, 1],
      rotate: 180,
      align: { justifySelf: 'center' },
      label: `Seat ${acrossSeat(mySeat)} (across)`,
    },
    {
      seat: prevSeat(mySeat),
      outer: [1, 2],
      inner: [1, 2],
      rotate: -90,
      align: { alignSelf: 'center' },
      label: `Seat ${prevSeat(mySeat)}`,
      wrapTransform: 'rotate(90deg)',
    },
  ];
}

function SeatLabel({ label }: { label: string }) {
  return <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 4 }}>{label}</div>;
}
