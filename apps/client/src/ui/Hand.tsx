import type { Tile as MTile } from '@mahjong/game-logic';
import { sortHand, tileId } from '@mahjong/game-logic';
import { Tile } from './Tile.js';

interface HandProps {
  tiles: readonly MTile[];
  faceDown?: boolean | undefined;
  onTileClick?: ((t: MTile) => void) | undefined;
}

export function Hand({ tiles, faceDown, onTileClick }: HandProps) {
  const sorted = faceDown ? [...tiles] : sortHand(tiles);
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {sorted.map((t) => (
        <Tile
          key={tileId(t)}
          tile={t}
          faceDown={faceDown}
          onClick={onTileClick ? () => onTileClick(t) : undefined}
        />
      ))}
    </div>
  );
}
