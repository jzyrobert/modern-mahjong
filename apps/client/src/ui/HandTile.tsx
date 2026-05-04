import type { Tile as MTile } from '@mahjong/game-logic';
import { tileId } from '@mahjong/game-logic';
import { useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, View } from 'react-native';
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

const LONG_PRESS_MS = 220;
const TAP_MOVE_THRESHOLD = 6;

/**
 * Hand tile with tap-to-discard + long-press-to-drag-and-reorder.
 *
 * Implementation uses RN core's `PanResponder` + `Animated.Value` only
 * (no `react-native-gesture-handler` / `react-native-reanimated`) so it
 * keeps working in Expo Go after those packages were stripped in
 * 532f87f. Behaviour:
 *
 *   1. Touch starts → arm a 220ms timer.
 *   2. If the user releases before the timer fires *and* hasn't moved
 *      more than 6px, that's a tap → fire `onTap`.
 *   3. If the timer fires (finger still down), enter drag mode: bump
 *      `scale` + `translateY` so the tile visibly lifts.
 *   4. While in drag mode, `translateX` follows the finger.
 *   5. On release in drag mode, round `dx / step` to a target index,
 *      clamp to [0, total-1], snap back, fire `onReorder(toIndex)`.
 *   6. If `draggable` is false, gestures fall through to the tap path
 *      only (no long-press lift).
 */
export function HandTile({
  tile,
  total,
  step,
  draggable,
  index,
  onTap,
  onReorder,
  drawnTileId,
  width,
  height,
}: HandTileProps) {
  const id = tileId(tile);
  const isDrawn = drawnTileId === id;
  const [dragging, setDragging] = useState(false);
  const translateX = useRef(new Animated.Value(0)).current;
  const liftAnim = useRef(new Animated.Value(0)).current; // 0 = at-rest, 1 = lifted

  // Refs so the PanResponder closures see the latest values. Re-creating
  // the responder on every render breaks the active gesture mid-drag.
  const draggableRef = useRef(draggable);
  const onTapRef = useRef(onTap);
  const onReorderRef = useRef(onReorder);
  const indexRef = useRef(index);
  const totalRef = useRef(total);
  const stepRef = useRef(step);
  useEffect(() => {
    draggableRef.current = draggable;
    onTapRef.current = onTap;
    onReorderRef.current = onReorder;
    indexRef.current = index;
    totalRef.current = total;
    stepRef.current = step;
  });

  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const movedRef = useRef(false);
  const draggingRef = useRef(false);

  const cancelLongPress = () => {
    if (longPressTimer.current !== null) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const enterDrag = () => {
    draggingRef.current = true;
    setDragging(true);
    Animated.spring(liftAnim, { toValue: 1, useNativeDriver: true, friction: 7 }).start();
  };

  const exitDrag = (toIndex: number | null) => {
    Animated.parallel([
      Animated.spring(liftAnim, { toValue: 0, useNativeDriver: true, friction: 7 }),
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 7 }),
    ]).start();
    draggingRef.current = false;
    setDragging(false);
    if (toIndex !== null && toIndex !== indexRef.current) {
      onReorderRef.current?.(toIndex);
    }
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => false,
      onMoveShouldSetPanResponder: () => draggingRef.current,
      onMoveShouldSetPanResponderCapture: () => draggingRef.current,
      onPanResponderTerminationRequest: () => !draggingRef.current,

      onPanResponderGrant: () => {
        movedRef.current = false;
        if (draggableRef.current) {
          longPressTimer.current = setTimeout(enterDrag, LONG_PRESS_MS);
        }
      },

      onPanResponderMove: (_e, g) => {
        if (Math.abs(g.dx) + Math.abs(g.dy) > TAP_MOVE_THRESHOLD) {
          movedRef.current = true;
          // Movement past threshold before long-press fires = treat as
          // not-a-tap and not-yet-drag. Cancel the timer so we don't
          // accidentally drop into drag mode after the user has already
          // committed to a swipe.
          if (!draggingRef.current) cancelLongPress();
        }
        if (draggingRef.current) {
          translateX.setValue(g.dx);
        }
      },

      onPanResponderRelease: (_e, g) => {
        cancelLongPress();
        if (draggingRef.current) {
          const delta = Math.round(g.dx / Math.max(1, stepRef.current));
          const toIndex = Math.max(0, Math.min(totalRef.current - 1, indexRef.current + delta));
          exitDrag(toIndex);
        } else if (!movedRef.current && onTapRef.current) {
          onTapRef.current();
        }
      },

      onPanResponderTerminate: () => {
        cancelLongPress();
        if (draggingRef.current) exitDrag(null);
      },
    }),
  ).current;

  // Lift transform — translateY -8px + scale 1.06 when fully lifted.
  // Driven entirely on the native thread (useNativeDriver: true) so the
  // JS thread stays free for engine-side state updates while you drag.
  const liftedY = liftAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });
  const liftedScale = liftAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });

  return (
    <Animated.View
      {...responder.panHandlers}
      // The clickable surface lives on this outer Animated.View (the
      // PanResponder catches the tap and routes through `onTapRef`).
      // The inner Tile has no `onPress`, so its `testID` would be
      // silently dropped — pin the testID here instead so Playwright
      // can target it via `getByTestId('own-hand-tile').click()`.
      testID={onTap ? 'own-hand-tile' : undefined}
      style={{
        transform: [{ translateX }, { translateY: liftedY }, { scale: liftedScale }],
        zIndex: dragging ? 10 : 0,
      }}
    >
      <View>
        <Tile
          tile={tile}
          flipId={`tile-${id}`}
          raised={isDrawn || dragging}
          width={width}
          height={height}
        />
      </View>
    </Animated.View>
  );
}
