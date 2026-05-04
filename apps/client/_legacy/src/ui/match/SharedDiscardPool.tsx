import { type Tile as MTile, type Seat, tileId } from '@mahjong/game-logic';
import { SEAT_COLOR } from '../../native/theme.js';
import { Tile } from '../Tile.js';

type Position = 'bottom' | 'right' | 'top' | 'left';

interface SharedDiscardPoolProps {
  /**
   * Chronological discard log from `state.discardOrder` — each entry tags
   * the tile with the seat that pitched it. The mobile pool renders these
   * in true turn order with a per-seat underline keyed off `SEAT_COLOR`.
   */
  discardOrder: readonly { tile: MTile; from: Seat }[];
  /** Translates engine seat (0-3) to visual position relative to the user. */
  seatToPosition: Record<Seat, Position>;
  /**
   * The most recently discarded tile id, used to highlight the latest tile
   * while the table is in `awaitingClaims` (so claimers can see it across
   * the felt).
   */
  latestId: number | null;
}

/**
 * Combined chronological discard pool used by the mobile shell. Reads the
 * engine's `state.discardOrder` log so tiles render in true turn order
 * (not the previous interleaving heuristic). Ported from
 * `/tmp/design/design/app-mobile.jsx::SharedDiscardPool`.
 */
export function SharedDiscardPool({
  discardOrder,
  seatToPosition,
  latestId,
}: SharedDiscardPoolProps) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(8, 22px)',
        gap: 3,
        padding: 8,
        borderRadius: 12,
        background: 'oklch(0.95 0.03 145 / 0.55)',
        border: '1px solid oklch(0.8 0.04 145 / 0.6)',
        boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.06)',
        maxWidth: 220,
        justifyContent: 'center',
      }}
    >
      {discardOrder.slice(-24).map((entry) => {
        const id = tileId(entry.tile);
        const isLatest = id === latestId;
        const position = seatToPosition[entry.from];
        const seatColor = SEAT_COLOR[position];
        return (
          <div
            key={id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 2,
              filter: isLatest
                ? 'drop-shadow(0 0 6px oklch(0.7 0.18 30 / 0.85))'
                : 'drop-shadow(0 1px 1.5px rgba(0,0,0,0.18))',
              ['--tile-w' as string]: '20px',
              ['--tile-h' as string]: '26px',
            }}
          >
            <Tile tile={entry.tile} />
            <span
              style={{
                width: 14,
                height: 2,
                borderRadius: 1,
                background: seatColor,
                opacity: isLatest ? 1 : 0.85,
                boxShadow: isLatest ? `0 0 4px ${seatColor}` : 'none',
              }}
            />
          </div>
        );
      })}
    </div>
  );
}
