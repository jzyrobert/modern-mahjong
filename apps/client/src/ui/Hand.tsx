import type { Tile as MTile, Suit } from '@mahjong/game-logic';
import { sortHand, tileId } from '@mahjong/game-logic';
import { useMemo } from 'react';
import { View } from 'react-native';
import { Tile } from './Tile';
import type { SortMode } from './match/SortPicker';

interface HandProps {
  tiles: readonly MTile[];
  faceDown?: boolean | undefined;
  onTileClick?: ((t: MTile) => void) | undefined;
  rotate?: number | undefined;
  /** Sort mode for the user's own hand. */
  sortMode?: SortMode;
  /** Engine `tileId` of the freshly-drawn tile — gets a soft glow + lift. */
  drawnTileId?: number | null;
  /** Tile width (defaults via Tile). */
  tileWidth?: number;
  tileHeight?: number;
}

/**
 * Native port of `_legacy/src/ui/Hand.tsx`. Renders the tile row
 * sorted by mode. Drag-to-reorder is deferred to Phase 5;
 * Phase 4 treats `sortMode === 'manual'` the same as `'suit'` (engine
 * order can't be edited until the gesture handler is wired).
 */
export function Hand({
  tiles,
  faceDown,
  onTileClick,
  rotate,
  sortMode = 'suit',
  drawnTileId = null,
  tileWidth,
  tileHeight,
}: HandProps) {
  const ordered = useMemo(() => {
    if (faceDown) return [...tiles];
    return orderHand(tiles, sortMode);
  }, [tiles, faceDown, sortMode]);

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, alignItems: 'flex-end' }}>
      {ordered.map((t) => {
        const id = tileId(t);
        const isDrawn = !faceDown && drawnTileId === id;
        return (
          <Tile
            key={id}
            tile={t}
            faceDown={faceDown}
            rotate={rotate}
            raised={isDrawn}
            onPress={onTileClick ? () => onTileClick(t) : undefined}
            testID={onTileClick ? 'own-hand-tile' : undefined}
            {...(tileWidth !== undefined && { width: tileWidth })}
            {...(tileHeight !== undefined && { height: tileHeight })}
          />
        );
      })}
    </View>
  );
}

const SUIT_ORDER: Record<Suit, number> = { man: 0, pin: 1, sou: 2 };
const HONOR_ORDER: Record<string, number> = { E: 0, S: 1, W: 2, N: 3, Z: 4, F: 5, B: 6 };

function orderHand(tiles: readonly MTile[], mode: SortMode): MTile[] {
  if (mode === 'manual') return [...tiles];
  if (mode === 'suit') return sortHand(tiles);
  // 'num' — numeric rank first, suit as tiebreak; honors stay grouped at end.
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
