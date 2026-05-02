import type { Tile as MTile } from '@mahjong/game-logic';
import { mulberry32, tileId } from '@mahjong/game-logic';
import type { CSSProperties } from 'react';
import { Tile } from './Tile.js';

interface DiscardPileProps {
  tiles: readonly MTile[];
  rotate?: number;
}

const PILE_STYLE: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 2,
  maxWidth: 180,
  ['--tile-w' as string]: '24px',
  ['--tile-h' as string]: '32px',
};

/** Max +/- jitter in degrees added on top of the seat orientation, so each tile lands at a slightly different angle. */
const MAX_TOSS_DEGREES = 8;

export function DiscardPile({ tiles, rotate = 0 }: DiscardPileProps) {
  return (
    <div style={PILE_STYLE}>
      {tiles.map((t) => {
        const id = tileId(t);
        const tossOffset = (mulberry32(id)() - 0.5) * 2 * MAX_TOSS_DEGREES;
        return <Tile key={id} tile={t} rotate={rotate + tossOffset} />;
      })}
    </div>
  );
}
