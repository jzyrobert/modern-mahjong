import type { Tile as MTile } from '@mahjong/game-logic';
import { tileId } from '@mahjong/game-logic';
import { useContext, useEffect, useRef, useState } from 'react';
import { Animated, Easing, PanResponder, View } from 'react-native';
import { FlipBagContext } from './FlipBag';
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
  /** True iff this is the heuristic ranker's recommended discard. Adds
   *  a slow teal pulse halo so the user can pick it out at a glance.
   *  Distinct hue from the drawn tile's gold halo so the two states
   *  can co-exist (the just-drawn tile is *often* the right discard
   *  but not always, and showing both signals is cleaner than
   *  collapsing them into one). */
  recommended?: boolean;
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
  recommended = false,
  width,
  height,
}: HandTileProps) {
  const id = tileId(tile);
  const isDrawn = drawnTileId === id;
  const [dragging, setDragging] = useState(false);
  const translateX = useRef(new Animated.Value(0)).current;
  const liftAnim = useRef(new Animated.Value(0)).current; // 0 = at-rest, 1 = lifted
  const hintPulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!recommended) {
      hintPulse.stopAnimation();
      hintPulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(hintPulse, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
        Animated.timing(hintPulse, {
          toValue: 0,
          duration: 800,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [recommended, hintPulse]);

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

  // FlipBag is shared with `<FlipView>` (which the inner `<Tile>`
  // wraps when `flipId` is set). On release we update the cache for
  // this `flipId` so the post-swap layout pass animates from the
  // finger position rather than the stale pre-drag entry — see the
  // comment in `exitDrag` below for the full reasoning.
  const flipBag = useContext(FlipBagContext);

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

  const exitDrag = (gdx: number, toIndex: number | null) => {
    Animated.spring(liftAnim, { toValue: 0, useNativeDriver: true, friction: 7 }).start();
    draggingRef.current = false;
    setDragging(false);

    const fromIndex = indexRef.current;
    const willReorder = toIndex !== null && toIndex !== fromIndex;
    if (!willReorder) {
      // Snap back: no reorder fires, the tile simply springs from
      // `gdx` back to its original slot.
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 7 }).start();
      return;
    }

    // Reorder path — coordinate with `<FlipView>` so the visual stays
    // continuous across the layout swap. Three coordinated steps:
    //
    //   1. Update the FlipBag cache for this `flipId` so it reflects
    //      where the user's finger ended up rather than the pre-drag
    //      slot. We don't need to measure — `<FlipView>` already cached
    //      the tile's pre-drag screen rect on its last onLayout, and
    //      the gesture only moved the visual horizontally by `gdx`.
    //      So `cached.x + gdx` is the finger-release screen X.
    //   2. Pre-bias `translateX` to `gdx - slotShift` BEFORE firing
    //      `onReorder`. On the next native commit (when the parent
    //      re-renders the tile into its new flex slot), the tile's
    //      screen position becomes `newSlotX + (gdx - slotShift)` =
    //      `oldSlotX + gdx` = finger. So the visual position stays put
    //      across the swap, while the FlipBag entry now matches.
    //   3. Spring `translateX → 0` so the tile slides from the finger
    //      into the new slot. With the cache aligned, `<FlipView>`'s
    //      post-swap onLayout sees its measured rect at the same
    //      position the cache says, the FLIP-delta is 0, so the
    //      outer spring is the only animation that runs.
    //
    // `slotShift` is in horizontal-step units; for the common same-row
    // reorder the parent's flex slot really does move by that many
    // pixels, which keeps the math exact. Cross-row drags (rare —
    // gesture is horizontal-only) end up with a small FlipView FLIP
    // on top, but the cache realignment still suppresses the "tile
    // pops back to the original slot" snap that the stale pre-drag
    // entry caused.
    const slotShift = (toIndex - fromIndex) * stepRef.current;
    const cached = flipBag.read(`tile-${id}`);
    if (cached) {
      flipBag.write(`tile-${id}`, { ...cached, x: cached.x + gdx });
    }
    translateX.setValue(gdx - slotShift);
    onReorderRef.current?.(toIndex);
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 7 }).start();
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
          if (!draggingRef.current) {
            cancelLongPress();
            // In manual mode, the drag IS the action — finger jitter
            // makes the original "hold-still-for-220ms" gate
            // unreachable on touch screens, where the user reports
            // dragging a tile produces no visible response. Treat
            // any past-threshold movement on a draggable tile as the
            // start of a drag so the gesture is reactive without
            // needing a perfectly still long-press first.
            if (draggableRef.current) enterDrag();
          }
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
          exitDrag(g.dx, toIndex);
        } else if (!movedRef.current && onTapRef.current) {
          onTapRef.current();
        }
      },

      onPanResponderTerminate: () => {
        cancelLongPress();
        if (draggingRef.current) exitDrag(0, null);
      },
    }),
  ).current;

  // Lift transform — translateY -8px + scale 1.06 when fully lifted.
  // Driven entirely on the native thread (useNativeDriver: true) so the
  // JS thread stays free for engine-side state updates while you drag.
  const liftedY = liftAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });
  const liftedScale = liftAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });

  // Discard-hint halo — a single absolutely-positioned overlay sized
  // to the tile, animated on opacity + scale (transform-only, no
  // per-frame paint). Hidden when `recommended` is false. Scale runs
  // from 1.05 (already a visible ring at rest) up to 1.35 at the
  // pulse peak, with opacity peaking at 0.85 — the older 1.0→1.15
  // range made the hint easy to miss because the visible ring was
  // just 15% of tile width and faded almost to zero.
  const haloScale = hintPulse.interpolate({ inputRange: [0, 1], outputRange: [1.05, 1.35] });
  const haloOpacity = hintPulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 0.35] });

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
        {recommended ? (
          <>
            <Animated.View
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width,
                height,
                // Match the tile's rendered SVG rx so the halo reads
                // as "around the tile" rather than a square frame.
                borderRadius: width * 0.18,
                backgroundColor: '#3aa999',
                opacity: haloOpacity,
                transform: [{ scale: haloScale }],
                pointerEvents: 'none',
              }}
            />
            <View
              testID="hand-tile-recommended"
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width,
                height,
                borderRadius: width * 0.18,
                borderWidth: 3,
                borderColor: '#2dd4bf',
                pointerEvents: 'none',
                // Outer glow on the static ring so the cue is obvious
                // even at the trough of the pulse — the inner halo is
                // mostly hidden behind the tile, the ring is what
                // actually reads from a glance.
                boxShadow: '0px 0px 6px rgba(45,212,191,0.8)',
              }}
            />
          </>
        ) : null}
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
