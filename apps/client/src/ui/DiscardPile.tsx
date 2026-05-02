import type { Tile as MTile } from '@mahjong/game-logic';
import { mulberry32, tileId } from '@mahjong/game-logic';
import type { CSSProperties } from 'react';
import { Tile } from './Tile.js';

interface DiscardPileProps {
  tiles: readonly MTile[];
  /**
   * Seat-relative rotation in degrees:
   * - `0`  user (bottom): row, tiles upright.
   * - `180` across (top): row-reverse, tiles upside-down.
   * - `-90` right: column, tiles' tops point left → upright from their seat.
   * - `90`  left: column-reverse, tiles' tops point right → upright from their seat.
   */
  rotate?: number;
}

const TILE_VARS: CSSProperties = {
  ['--tile-w' as string]: '24px',
  ['--tile-h' as string]: '32px',
};

/** Max +/- jitter in degrees added on top of the seat orientation, so each tile lands at a slightly different angle. */
const MAX_TOSS_DEGREES = 8;

export function DiscardPile({ tiles, rotate = 0 }: DiscardPileProps) {
  const flexDirection = flowFor(rotate);
  const isVertical = rotate === 90 || rotate === -90;
  return (
    <div
      style={{
        ...TILE_VARS,
        display: 'flex',
        flexDirection,
        flexWrap: 'wrap',
        gap: 2,
        // Cap horizontal piles by width and vertical piles by height so a
        // long discard run wraps into a second row/column instead of
        // sprawling across the table.
        ...(isVertical ? { maxHeight: 160 } : { maxWidth: 180 }),
      }}
    >
      {tiles.map((t) => {
        const id = tileId(t);
        const tossOffset = (mulberry32(id)() - 0.5) * 2 * MAX_TOSS_DEGREES;
        return <Tile key={id} tile={t} rotate={rotate + tossOffset} />;
      })}
    </div>
  );
}

function flowFor(rotate: number): CSSProperties['flexDirection'] {
  if (rotate === 180) return 'row-reverse';
  if (rotate === 90) return 'column-reverse';
  if (rotate === -90) return 'column';
  return 'row';
}
