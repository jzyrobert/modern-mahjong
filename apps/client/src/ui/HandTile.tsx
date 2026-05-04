import type { Tile as MTile } from '@mahjong/game-logic';
import { tileId } from '@mahjong/game-logic';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
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
 * Single tile in the user's hand row. Phase 5 wires up drag-to-reorder
 * via `react-native-gesture-handler` + `react-native-reanimated` v4.
 *
 * Gesture composition: `LongPress(220ms)` arms a `Pan` that follows
 * the finger horizontally; on release the integer-index delta is
 * computed from `translationX / step` and committed via `onReorder`.
 * A bare tap (no drag) goes through `onTap`.
 *
 * Drag values live on the UI thread — the visual lift / opacity /
 * translation are driven by `useAnimatedStyle` worklets, only the
 * commit at gesture end touches JS via `runOnJS(onReorder)`.
 */
export function HandTile({
  tile,
  index,
  total,
  step,
  draggable,
  onTap,
  onReorder,
  drawnTileId,
  width,
  height,
}: HandTileProps) {
  const tx = useSharedValue(0);
  const lift = useSharedValue(0);
  const pressing = useSharedValue(0);
  const id = tileId(tile);
  const isDrawn = drawnTileId === id;

  const longPress = Gesture.LongPress()
    .minDuration(220)
    .maxDistance(8)
    .enabled(draggable)
    .onStart(() => {
      pressing.value = 1;
      lift.value = withSpring(-12, { damping: 20, stiffness: 220 });
    });

  const pan = Gesture.Pan()
    .activateAfterLongPress(220)
    .enabled(draggable)
    .onUpdate((e) => {
      tx.value = e.translationX;
    })
    .onEnd(() => {
      const delta = Math.round(tx.value / step);
      const target = Math.max(0, Math.min(total - 1, index + delta));
      tx.value = withTiming(0, { duration: 150 });
      lift.value = withTiming(0, { duration: 150 });
      pressing.value = 0;
      if (delta !== 0 && onReorder) runOnJS(onReorder)(target);
    })
    .onFinalize(() => {
      tx.value = withTiming(0, { duration: 150 });
      lift.value = withTiming(0, { duration: 150 });
      pressing.value = 0;
    });

  const tap = Gesture.Tap()
    .maxDuration(220)
    .onEnd(() => {
      if (onTap) runOnJS(onTap)();
    });

  // Long-press → Pan, simultaneously with Tap (Tap is short-press only).
  const composed = Gesture.Race(Gesture.Simultaneous(longPress, pan), tap);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: lift.value }],
    zIndex: pressing.value > 0 ? 50 : 0,
    opacity: pressing.value > 0 ? 0.94 : 1,
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View style={animatedStyle}>
        <Tile tile={tile} raised={isDrawn} width={width} height={height} />
      </Animated.View>
    </GestureDetector>
  );
}
