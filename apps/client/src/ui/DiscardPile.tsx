import type { Tile as MTile } from '@mahjong/game-logic';
import { tileId } from '@mahjong/game-logic';
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

export function DiscardPile({ tiles, rotate = 0 }: DiscardPileProps) {
  return (
    <div style={PILE_STYLE}>
      {tiles.map((t) => (
        <Tile key={tileId(t)} tile={t} rotate={rotate} />
      ))}
    </div>
  );
}
