import type { Tile as MTile } from '@mahjong/game-logic';
import { tileId } from '@mahjong/game-logic';
import { useContext, useEffect, useRef, useState } from 'react';
import { Animated, PanResponder, View } from 'react-native';
import { useGame } from '../state/game';
import { FlipBagContext } from './FlipBag';
import { Tile } from './Tile';
import { PULSE_TEMPO, usePulse } from './animations';

interface HandTileProps {
  tile: MTile;
  /** Index in the row — sets the drag pivot. */
  index: number;
  /** Total tiles in the row, for clamping. */
  total: number;
  /** Effective horizontal step between tiles (tile width + gap). */
  step: number;
  /** Effective vertical step between rows (tile height + gap). Used by
   *  the drag math to compute row deltas when the hand wraps onto
   *  multiple rows on narrow viewports. */
  rowStep: number;
  /** Number of tiles laid out per row by the parent's flex-wrap. Drives
   *  the source-row + target-row math. Defaults to `total` (single row)
   *  before the parent has measured its container. */
  tilesPerRow: number;
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
 *   4. While in drag mode, `translateX` follows the finger horizontally
 *      and `dragY` follows it vertically — both on the native thread,
 *      composed with the lift offset via Animated.add for translateY.
 *   5. On release in drag mode, round `dx / step` to a target column
 *      and `dy / rowStep` to a target row; combine into a target index
 *      using `tilesPerRow`, clamp to [0, total-1], spring back into
 *      the new slot, and fire `onReorder(toIndex)`. Multi-row drags
 *      (hand wraps onto two rows on narrow viewports) land on the
 *      right slot in the right row.
 *   6. If `draggable` is false, gestures fall through to the tap path
 *      only (no long-press lift).
 */
export function HandTile({
  tile,
  total,
  step,
  rowStep,
  tilesPerRow,
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
  // True while the draw-popup overlay is animating *this* tile. The
  // selector is cheap (returns `boolean` so zustand's strict-equality
  // skips re-renders for every other tile when the animation fires) —
  // when true we hide the tile face + report the slot's screen rect
  // so `DrawTileOverlay` can fly into the exact destination.
  const isAnimatingDraw = useGame(
    (s) => s.drawAnimation !== null && tileId(s.drawAnimation.tile) === id,
  );
  const setDrawAnimationSlotRect = useGame((s) => s.setDrawAnimationSlotRect);
  const containerRef = useRef<View>(null);
  // Re-measure whenever this tile becomes the animation target. Layout
  // is stable for the duration of one popup (the draw event has already
  // resolved the new tile into the hand by the time `drawAnimation`
  // ticks), so a single measure on transition is enough.
  useEffect(() => {
    if (!isAnimatingDraw || !containerRef.current) return;
    // measureInWindow returns coords in viewport space — the same space
    // `DrawTileOverlay` reads from when computing its fly translate.
    containerRef.current.measureInWindow((x, y, w, h) => {
      setDrawAnimationSlotRect({ x, y, width: w, height: h });
    });
  }, [isAnimatingDraw, setDrawAnimationSlotRect]);
  const [dragging, setDragging] = useState(false);
  const translateX = useRef(new Animated.Value(0)).current;
  // `dragY` follows the finger's vertical delta during drag; the lift
  // animation `liftedY` (-10px when fully lifted) is composed on top
  // via Animated.add. Without this the tile didn't visually move when
  // the user dragged across rows on a narrow viewport — the gesture
  // only updated translateX and ignored g.dy entirely.
  const dragY = useRef(new Animated.Value(0)).current;
  const liftAnim = useRef(new Animated.Value(0)).current; // 0 = at-rest, 1 = lifted
  const hintPulse = usePulse({ enabled: recommended, durationMs: PULSE_TEMPO.ambient });

  // Refs so the PanResponder closures see the latest values. Re-creating
  // the responder on every render breaks the active gesture mid-drag.
  const draggableRef = useRef(draggable);
  const onTapRef = useRef(onTap);
  const onReorderRef = useRef(onReorder);
  const indexRef = useRef(index);
  const totalRef = useRef(total);
  const stepRef = useRef(step);
  const rowStepRef = useRef(rowStep);
  const tilesPerRowRef = useRef(tilesPerRow);
  useEffect(() => {
    draggableRef.current = draggable;
    onTapRef.current = onTap;
    onReorderRef.current = onReorder;
    indexRef.current = index;
    totalRef.current = total;
    stepRef.current = step;
    rowStepRef.current = rowStep;
    tilesPerRowRef.current = tilesPerRow;
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

  const exitDrag = (gdx: number, gdy: number, toIndex: number | null) => {
    Animated.spring(liftAnim, { toValue: 0, useNativeDriver: true, friction: 7 }).start();
    draggingRef.current = false;
    setDragging(false);

    const fromIndex = indexRef.current;
    const willReorder = toIndex !== null && toIndex !== fromIndex;
    if (!willReorder) {
      // Snap back: no reorder fires, the tile simply springs from
      // (`gdx`, `gdy`) back to its original slot.
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 7 }).start();
      Animated.spring(dragY, { toValue: 0, useNativeDriver: true, friction: 7 }).start();
      return;
    }

    // Reorder path — coordinate with `<FlipView>` so the visual stays
    // continuous across the layout swap. Three coordinated steps:
    //
    //   1. Update the FlipBag cache for this `flipId` so it reflects
    //      where the user's finger ended up rather than the pre-drag
    //      slot. We don't need to measure — `<FlipView>` already cached
    //      the tile's pre-drag screen rect on its last onLayout, and
    //      the gesture moved the tile by (gdx, gdy). So
    //      (cached.x + gdx, cached.y + gdy) is the finger-release
    //      screen position.
    //   2. Pre-bias both `translateX` and `dragY` so the next native
    //      commit (when the parent re-renders the tile into its new
    //      flex slot) lands the tile at the finger position. Each axis
    //      uses its own slotShift: horizontal in `step` units along the
    //      target row, vertical in `rowStep` units between rows.
    //   3. Spring both translates → 0 so the tile slides from the
    //      finger into the new slot. With the cache aligned,
    //      `<FlipView>`'s post-swap onLayout sees its measured rect at
    //      the same position the cache says, the FLIP-delta is 0, so
    //      the outer springs are the only animations that run.
    const perRow = Math.max(1, tilesPerRowRef.current);
    const fromRow = Math.floor(fromIndex / perRow);
    const fromCol = fromIndex % perRow;
    const toRow = Math.floor(toIndex / perRow);
    const toCol = toIndex % perRow;
    const slotShiftX = (toCol - fromCol) * stepRef.current;
    const slotShiftY = (toRow - fromRow) * rowStepRef.current;
    const cached = flipBag.read(`tile-${id}`);
    if (cached) {
      flipBag.write(`tile-${id}`, { ...cached, x: cached.x + gdx, y: cached.y + gdy });
    }
    translateX.setValue(gdx - slotShiftX);
    dragY.setValue(gdy - slotShiftY);
    onReorderRef.current?.(toIndex);
    Animated.spring(translateX, { toValue: 0, useNativeDriver: true, friction: 7 }).start();
    Animated.spring(dragY, { toValue: 0, useNativeDriver: true, friction: 7 }).start();
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
          dragY.setValue(g.dy);
        }
      },

      onPanResponderRelease: (_e, g) => {
        cancelLongPress();
        if (draggingRef.current) {
          // Compute target index from both axes so cross-row drags
          // (hand wraps onto multiple rows on narrow viewports) land
          // on the right slot. Source (row, col) walks `perRow`-major;
          // target gets the rounded gesture deltas applied to each
          // axis, then the final index is clamped to [0, total-1] —
          // the last row may be partial, and clamping mops up drags
          // past the end.
          const perRow = Math.max(1, tilesPerRowRef.current);
          const fromRow = Math.floor(indexRef.current / perRow);
          const fromCol = indexRef.current % perRow;
          const deltaCol = Math.round(g.dx / Math.max(1, stepRef.current));
          const deltaRow = Math.round(g.dy / Math.max(1, rowStepRef.current));
          const toCol = Math.max(0, Math.min(perRow - 1, fromCol + deltaCol));
          const toRow = Math.max(0, fromRow + deltaRow);
          const toIndex = Math.max(0, Math.min(totalRef.current - 1, toRow * perRow + toCol));
          exitDrag(g.dx, g.dy, toIndex);
        } else if (!movedRef.current && onTapRef.current) {
          onTapRef.current();
        }
      },

      onPanResponderTerminate: () => {
        cancelLongPress();
        if (draggingRef.current) exitDrag(0, 0, null);
      },
    }),
  ).current;

  // Lift transform — translateY -10px + scale 1.06 when fully lifted.
  // Driven entirely on the native thread (useNativeDriver: true) so the
  // JS thread stays free for engine-side state updates while you drag.
  // Combined with `dragY` so the tile's vertical position = (lift offset
  // + finger gesture). `Animated.add` keeps the addition on the native
  // thread; without it the gesture would clobber the lift offset.
  const liftedY = liftAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });
  const translateY = Animated.add(liftedY, dragY);
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
      // The interactive surface lives on this outer Animated.View (the
      // PanResponder catches both tap and drag and routes through
      // `onTapRef` / `onReorderRef`). The inner Tile has no `onPress`,
      // so its `testID` would be silently dropped — pin the testID
      // here instead so Playwright can target it via
      // `getByTestId('own-hand-tile').click()`. We surface the testID
      // whenever this tile has any user-facing interaction wired up
      // (tap to discard OR drag to reorder), so the e2e suite can
      // find own-hand tiles even when the discard window is closed
      // (e.g. during bots' turns, when only manual reorder is live).
      testID={onTap || onReorder ? 'own-hand-tile' : undefined}
      style={{
        transform: [{ translateX }, { translateY }, { scale: liftedScale }],
        zIndex: dragging ? 10 : 0,
        // Render the slot as an invisible placeholder while the draw-
        // popup is animating this tile — the overlay carries the visual
        // for the whole pop → flip → fly sequence and reveals the tile
        // by landing on it. Opacity 0 (not display: none) keeps the
        // slot's flex width so the row layout stays stable.
        opacity: isAnimatingDraw ? 0 : 1,
      }}
    >
      <View ref={containerRef} collapsable={false}>
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
          elevation="hand"
          width={width}
          height={height}
        />
      </View>
    </Animated.View>
  );
}
