import { type Tile as MTile, type Suit, sortHand, tileId } from '@mahjong/game-logic';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, type LayoutChangeEvent, Pressable, View } from 'react-native';
import { useGame } from '../state/game';
import { HandTile } from './HandTile';
import { Tile } from './Tile';
import type { SortMode } from './match/SortPicker';

export interface DrawCue {
  /** Engine tile shown face-down inside the ghost slot — same tile the
   *  desktop wall pulse renders, so a future FLIP from wall→ghost would
   *  have a stable identity. */
  tile: MTile;
  /** Tap handler — fires the engine `draw` action. */
  onPress: () => void;
}

interface HandProps {
  tiles: readonly MTile[];
  faceDown?: boolean | undefined;
  onTileClick?: ((t: MTile) => void) | undefined;
  /** Sort mode for the user's own hand. */
  sortMode?: SortMode;
  /** Engine `tileId` of the freshly-drawn tile — gets a soft glow + lift. */
  drawnTileId?: number | null;
  /** Engine `tileId` of the heuristic ranker's recommended discard,
   *  rendered with a distinctive teal halo so the user can spot it
   *  amongst the ordered hand. Off when the discard-hint setting is
   *  off OR it's not the user's discard turn. */
  hintTileId?: number | null;
  /** When set, append a pulsing tile-shaped slot at the end of the hand
   *  row that fires the engine `draw` action on tap. Used by the mobile
   *  shell so the draw target shares the hand's auto-fit row instead of
   *  consuming a dedicated row. */
  drawCue?: DrawCue | undefined;
  tileWidth?: number;
  tileHeight?: number;
}

const TILE_W_DEFAULT = 36;
const TILE_H_DEFAULT = 50;
// Floor on auto-fit. The 30-px choice is now driven solely by touch
// target size on Android Chrome (sub-30-px slugs miss tap registration
// reliably). `TileGlyph` itself scales fonts proportionally so the
// glyphs stay legible at any size.
const TILE_W_MIN = 30;
const GAP = 4;
const ASPECT = TILE_H_DEFAULT / TILE_W_DEFAULT; // 50/36 ≈ 1.39

/**
 * The user's own hand, with drag-to-reorder wired up via `HandTile`.
 * Manual mode uses `useGame.manualOrder` from the store; tap-to-discard
 * still works via the gesture's Tap branch (long-press is required to
 * enter drag mode, so a quick tap goes straight to `onTileClick`).
 */
export function Hand({
  tiles,
  faceDown,
  onTileClick,
  sortMode = 'suit',
  drawnTileId = null,
  hintTileId = null,
  drawCue,
  tileWidth: tileWidthProp,
  tileHeight: tileHeightProp,
}: HandProps) {
  const manualOrder = useGame((s) => s.manualOrder);
  const setManualOrder = useGame((s) => s.setManualOrder);
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerWidth(e.nativeEvent.layout.width);
  }, []);

  const ordered = useMemo(() => {
    if (faceDown) return [...tiles];
    if (sortMode === 'manual' && manualOrder.length > 0) {
      return manualOrderHand(tiles, manualOrder);
    }
    return orderHand(tiles, sortMode);
  }, [tiles, faceDown, sortMode, manualOrder]);

  const orderedIds = useMemo(() => ordered.map((t) => tileId(t)), [ordered]);

  // Slot count includes the ghost draw cue, so the auto-fit math reserves
  // its width up-front and the row doesn't reflow when needsDraw flips.
  const slotCount = ordered.length + (drawCue ? 1 : 0);

  // Scale tiles to fit the parent's measured width when the caller doesn't
  // pass an explicit size. Default 36×50; scale down to 30×42 minimum so a
  // 14-tile dealer hand fits on a single row down to roughly 360px wide.
  const fittedWidth = useMemo(() => {
    if (tileWidthProp !== undefined) return tileWidthProp;
    if (!containerWidth || slotCount === 0) return TILE_W_DEFAULT;
    const totalGap = (slotCount - 1) * GAP;
    const fit = Math.floor((containerWidth - totalGap) / slotCount);
    return Math.max(TILE_W_MIN, Math.min(TILE_W_DEFAULT, fit));
  }, [tileWidthProp, containerWidth, slotCount]);
  const fittedHeight = tileHeightProp ?? Math.round(fittedWidth * ASPECT);

  const onReorder = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      const next = orderedIds.slice();
      const [moved] = next.splice(fromIndex, 1);
      if (moved === undefined) return;
      next.splice(toIndex, 0, moved);
      setManualOrder(next);
    },
    [orderedIds, setManualOrder],
  );

  // Face-down hands aren't used by the current Match layout (we render
  // opponents via `<OppHandStrip>` instead), so the face-down/no-handler
  // path is a thin pass-through that just drops the tap + drag wiring.
  // `rotate` is ignored for now — opponent sideways hands would need
  // separate composition.
  const interactive = !faceDown && !!onTileClick;
  const draggable = interactive && sortMode === 'manual' && !!setManualOrder;
  const tileWidth = fittedWidth;
  const tileHeight = fittedHeight;
  const step = tileWidth + GAP;

  return (
    <View
      onLayout={onLayout}
      style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP, width: '100%' }}
    >
      {ordered.map((t, i) => {
        const id = tileId(t);
        return (
          <HandTile
            key={id}
            tile={t}
            index={i}
            total={ordered.length}
            step={step}
            draggable={draggable}
            onTap={interactive && onTileClick ? () => onTileClick(t) : undefined}
            onReorder={interactive ? (toIndex) => onReorder(i, toIndex) : undefined}
            drawnTileId={drawnTileId}
            recommended={hintTileId === id}
            width={tileWidth}
            height={tileHeight}
          />
        );
      })}
      {drawCue ? <DrawGhostSlot cue={drawCue} width={tileWidth} height={tileHeight} /> : null}
    </View>
  );
}

/**
 * Pulsing tile-shaped slot rendered at the end of the hand row when it's
 * the user's turn but they haven't drawn yet. Tap fires the engine
 * `draw` action. Visually shares the gold halo language of the desktop
 * shell's `WallEdge` next-to-draw cue, so the cross-shell vocabulary
 * stays consistent. Uses `useNativeDriver` for the pulse so the JS
 * thread stays free for engine ticks during animation.
 */
function DrawGhostSlot({ cue, width, height }: { cue: DrawCue; width: number; height: number }) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
        Animated.timing(t, {
          toValue: 0,
          duration: 700,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] });
  return (
    <Pressable
      onPress={cue.onPress}
      testID="wall-draw-next"
      style={({ pressed }) => ({
        opacity: pressed ? 0.85 : 1,
        borderRadius: 4,
        borderWidth: 1.5,
        borderColor: '#dc9f4f',
      })}
    >
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width,
          height,
          borderRadius: 4,
          backgroundColor: '#dc9f4f',
          opacity,
          transform: [{ scale }],
          pointerEvents: 'none',
        }}
      />
      <Tile tile={cue.tile} faceDown width={width} height={height} />
    </Pressable>
  );
}

const SUIT_ORDER: Record<Suit, number> = { man: 0, pin: 1, sou: 2 };
const HONOR_ORDER: Record<string, number> = { E: 0, S: 1, W: 2, N: 3, Z: 4, F: 5, B: 6 };

function orderHand(tiles: readonly MTile[], mode: SortMode): MTile[] {
  if (mode === 'manual') return [...tiles];
  if (mode === 'suit') return sortHand(tiles);
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

function manualOrderHand(tiles: readonly MTile[], order: readonly number[]): MTile[] {
  const indexById = new Map<number, number>();
  for (const [i, id] of order.entries()) indexById.set(id, i);
  return [...tiles].sort((a, b) => {
    const ia = indexById.get(tileId(a));
    const ib = indexById.get(tileId(b));
    if (ia === undefined && ib === undefined) return 0;
    if (ia === undefined) return 1;
    if (ib === undefined) return -1;
    return ia - ib;
  });
}
