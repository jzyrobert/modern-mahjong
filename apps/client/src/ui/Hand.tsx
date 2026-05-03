import type { Tile as MTile, Suit } from '@mahjong/game-logic';
import { sortHand, tileId } from '@mahjong/game-logic';
import { useMemo } from 'react';
import { Tile } from './Tile.js';
import type { SortMode } from './match/SortPicker.js';

interface HandProps {
  tiles: readonly MTile[];
  faceDown?: boolean | undefined;
  onTileClick?: ((t: MTile) => void) | undefined;
  rotate?: number | undefined;
  /**
   * Sort mode for the user's own hand. Opponent face-down hands ignore this
   * and always render in engine order. Defaults to 'suit'.
   */
  sortMode?: SortMode;
  /**
   * Engine `tileId` of the just-drawn tile (driven by `useGame.drawnTileId`).
   * When this matches a tile in the row, that tile gets a soft gold drop-
   * shadow glow + lift to mark it as the freshly drawn tile.
   */
  drawnTileId?: number | null;
}

export function Hand({
  tiles,
  faceDown,
  onTileClick,
  rotate,
  sortMode = 'suit',
  drawnTileId = null,
}: HandProps) {
  const ordered = useMemo(() => {
    if (faceDown) return [...tiles];
    return orderHand(tiles, sortMode);
  }, [tiles, faceDown, sortMode]);
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'flex-end' }}>
      {ordered.map((t) => {
        const id = tileId(t);
        const isDrawn = !faceDown && drawnTileId === id;
        return (
          <TileWithClick
            key={id}
            tile={t}
            faceDown={faceDown}
            rotate={rotate}
            onTileClick={onTileClick}
            isDrawn={isDrawn}
          />
        );
      })}
    </div>
  );
}

interface TileWithClickProps {
  tile: MTile;
  faceDown?: boolean | undefined;
  rotate?: number | undefined;
  onTileClick?: ((t: MTile) => void) | undefined;
  isDrawn?: boolean;
}

function TileWithClick({ tile, faceDown, rotate, onTileClick, isDrawn }: TileWithClickProps) {
  const handleClick = useMemo(
    () => (onTileClick ? () => onTileClick(tile) : undefined),
    [onTileClick, tile],
  );
  if (isDrawn) {
    return (
      <span
        style={{
          display: 'inline-block',
          // Soft gold drop-shadow ring around the just-drawn tile so it
          // reads as separated from the rest of the hand without forcing
          // a layout split.
          filter:
            'drop-shadow(0 0 8px oklch(0.78 0.16 75 / 0.7)) drop-shadow(0 2px 3px rgba(0,0,0,0.18))',
        }}
      >
        <Tile
          tile={tile}
          faceDown={faceDown}
          rotate={rotate}
          onClick={handleClick}
          raised
          testId={onTileClick ? 'own-hand-tile' : undefined}
        />
      </span>
    );
  }
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

const SUIT_ORDER: Record<Suit, number> = { man: 0, pin: 1, sou: 2 };
const HONOR_ORDER: Record<string, number> = { E: 0, S: 1, W: 2, N: 3, Z: 4, F: 5, B: 6 };

function orderHand(tiles: readonly MTile[], mode: SortMode): MTile[] {
  if (mode === 'manual') return [...tiles];
  if (mode === 'suit') return sortHand(tiles);
  // 'num' — numeric rank first, suit as tiebreak; honors stay grouped at the end.
  return [...tiles].sort((a, b) => {
    if (a.kind === 'suit' && b.kind === 'suit') {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
    }
    if (a.kind === 'suit') return -1;
    if (b.kind === 'suit') return 1;
    return (HONOR_ORDER[a.honor] ?? 99) - (HONOR_ORDER[b.honor] ?? 99);
  });
}
