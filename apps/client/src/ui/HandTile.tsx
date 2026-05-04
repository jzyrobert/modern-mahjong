import type { Tile as MTile } from '@mahjong/game-logic';
import { tileId } from '@mahjong/game-logic';
import { Pressable, View } from 'react-native';
import { Tile } from './Tile';

interface HandTileProps {
  tile: MTile;
  /** Index in the row — sets the drag pivot. */
  index: number;
  /** Total tiles in the row, for clamping. */
  total: number;
  /** Effective horizontal step between tiles (tile width + gap). */
  step: number;
  /** Manual reorder is only enabled in manual sort mode. */
  draggable: boolean;
  /** Called on tap (e.g. discard) when not dragging. */
  onTap?: (() => void) | undefined;
  /** Called on drag end with the integer index delta. */
  onReorder?: ((toIndex: number) => void) | undefined;
  /** Engine `tileId` of the freshly-drawn tile (gold-glow + lift). */
  drawnTileId?: number | null;
  width: number;
  height: number;
}

/**
 * Phase 5 stub. The full reanimated + gesture-handler drag-to-reorder
 * implementation triggered an Expo Go TurboModule init error on
 * Android (`installTurboModule` arg-count mismatch). Reverted to a
 * plain Pressable for now; drag-to-reorder will return once we move
 * to a custom dev client build (Phase 8 territory).
 */
export function HandTile({
  tile,
  total: _total,
  step: _step,
  draggable: _draggable,
  index: _index,
  onTap,
  onReorder: _onReorder,
  drawnTileId,
  width,
  height,
}: HandTileProps) {
  const id = tileId(tile);
  const isDrawn = drawnTileId === id;
  return (
    <View>
      <Tile
        tile={tile}
        raised={isDrawn}
        width={width}
        height={height}
        {...(onTap !== undefined && { onPress: onTap })}
        testID={onTap ? 'own-hand-tile' : undefined}
      />
    </View>
  );
}
