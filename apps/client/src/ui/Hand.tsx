import type { Tile as MTile } from '@mahjong/game-logic';
import { sortHand, tileId } from '@mahjong/game-logic';
import { useMemo } from 'react';
import { Tile } from './Tile.js';

interface HandProps {
  tiles: readonly MTile[];
  faceDown?: boolean | undefined;
  onTileClick?: ((t: MTile) => void) | undefined;
  rotate?: number | undefined;
}

export function Hand({ tiles, faceDown, onTileClick, rotate }: HandProps) {
  const ordered = useMemo(() => (faceDown ? [...tiles] : sortHand(tiles)), [tiles, faceDown]);
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      {ordered.map((t) => (
        <TileWithClick
          key={tileId(t)}
          tile={t}
          faceDown={faceDown}
          rotate={rotate}
          onTileClick={onTileClick}
        />
      ))}
    </div>
  );
}

interface TileWithClickProps {
  tile: MTile;
  faceDown?: boolean | undefined;
  rotate?: number | undefined;
  onTileClick?: ((t: MTile) => void) | undefined;
}

function TileWithClick({ tile, faceDown, rotate, onTileClick }: TileWithClickProps) {
  const handleClick = useMemo(
    () => (onTileClick ? () => onTileClick(tile) : undefined),
    [onTileClick, tile],
  );
  return (
    <Tile
      tile={tile}
      faceDown={faceDown}
      rotate={rotate}
      onClick={handleClick}
      testId={onTileClick ? 'own-hand-tile' : undefined}
    />
  );
}
