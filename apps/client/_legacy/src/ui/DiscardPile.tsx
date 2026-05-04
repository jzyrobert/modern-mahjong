import type { Tile as MTile } from '@mahjong/game-logic';
import { mulberry32, tileId } from '@mahjong/game-logic';
import { motion } from 'framer-motion';
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
  /**
   * Engine `tileId` of the latest discard, set while `phase === 'awaitingClaims'`.
   * The matching tile in this pile gets a pulsing red halo so claimers can
   * track which tile is on offer across the table.
   */
  latestId?: number | null;
}

const TILE_VARS: CSSProperties = {
  ['--tile-w' as string]: '24px',
  ['--tile-h' as string]: '32px',
};

/** Max +/- jitter in degrees added on top of the seat orientation, so each tile lands at a slightly different angle. */
const MAX_TOSS_DEGREES = 8;

const HALO_ANIMATE = {
  scale: [1, 1.18, 1],
  opacity: [0.7, 0, 0.7],
};
const HALO_TRANSITION = {
  duration: 1.4,
  repeat: Number.POSITIVE_INFINITY,
  ease: 'easeInOut',
} as const;

export function DiscardPile({ tiles, rotate = 0, latestId = null }: DiscardPileProps) {
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
        const isLatest = latestId === id;
        if (isLatest) {
          return (
            <div key={id} style={{ position: 'relative', display: 'inline-block' }}>
              <motion.div
                aria-hidden="true"
                animate={HALO_ANIMATE}
                transition={HALO_TRANSITION}
                style={{
                  position: 'absolute',
                  inset: -2,
                  borderRadius: 8,
                  background: 'oklch(0.65 0.2 28)',
                  pointerEvents: 'none',
                  zIndex: 1,
                }}
              />
              <Tile tile={t} rotate={rotate + tossOffset} />
            </div>
          );
        }
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
