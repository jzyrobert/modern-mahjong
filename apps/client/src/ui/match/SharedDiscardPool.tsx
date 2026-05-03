import { type Tile as MTile, tileId } from '@mahjong/game-logic';
import { SEAT_COLOR } from '../../native/theme.js';
import { Tile } from '../Tile.js';

type Position = 'bottom' | 'right' | 'top' | 'left';

interface SharedDiscardPoolProps {
  /** Discards keyed by visual seat position (driven by the user's mySeat). */
  discardsByPosition: Record<Position, readonly MTile[]>;
  /**
   * The most recently discarded tile id, used to highlight the latest
   * tile while the table is in `awaitingClaims` (so claimers can see it
   * across the felt).
   */
  latestId: number | null;
}

/**
 * Combined chronological-ish discard pool used by the mobile shell. Each
 * tile is laid out in a small grid with a per-seat colour underline
 * matching the discarder's `SEAT_COLOR`. Ported from
 * `/tmp/design/design/app-mobile.jsx::SharedDiscardPool`.
 *
 * Note: a true chronological order would require a per-tile sequence
 * number from the engine. The interleaving heuristic here cycles
 * `right → top → left → bottom` per tile-index across the four arrays —
 * matches the design and is "close enough" while the engine doesn't tag
 * discards with an absolute turn number. Real ordering is queued under
 * "Per-tile discard sequence number" in TODO.md → Design port follow-ups.
 */
export function SharedDiscardPool({ discardsByPosition, latestId }: SharedDiscardPoolProps) {
  const pool = buildSharedPool(discardsByPosition);
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
      {pool.slice(-24).map((entry) => {
        const id = tileId(entry.tile);
        const isLatest = id === latestId;
        const seatColor = SEAT_COLOR[entry.position];
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

interface PoolEntry {
  tile: MTile;
  position: Position;
}

const ORDER: Position[] = ['right', 'top', 'left', 'bottom'];

function buildSharedPool(discards: Record<Position, readonly MTile[]>): PoolEntry[] {
  const out: PoolEntry[] = [];
  const max = Math.max(...ORDER.map((p) => discards[p].length));
  for (let i = 0; i < max; i++) {
    for (const position of ORDER) {
      const tile = discards[position][i];
      if (tile) out.push({ tile, position });
    }
  }
  return out;
}
