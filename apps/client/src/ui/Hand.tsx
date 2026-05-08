import { type Tile as MTile, tileId } from '@mahjong/game-logic';
import { useCallback, useMemo, useState } from 'react';
import { Animated, type LayoutChangeEvent, Pressable, View } from 'react-native';
import { useGame } from '../state/game';
import { HandTile } from './HandTile';
import { Tile } from './Tile';
import { PULSE_TEMPO, usePulse } from './animations';
import { manualOrderHand, orderHand } from './handSort';
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
  //
  // `tappable` (= can discard) and `draggable` (= can manual-reorder)
  // are independent: tap requires `onTileClick`, which Match.tsx only
  // sets during the user's discard window (`myTurn && hasDrawn`); drag
  // is purely a client-side reorder that should work whenever the user
  // is in manual sort mode, regardless of whose turn it is. The
  // earlier gate folded both into a single `interactive` flag and
  // refused to drag outside the discard window, which broke organising
  // your hand while bots were playing — the user couldn't sort their
  // tiles unless they happened to be on their own move.
  const tappable = !faceDown && !!onTileClick;
  const draggable = !faceDown && sortMode === 'manual' && !!setManualOrder;
  const tileWidth = fittedWidth;
  const tileHeight = fittedHeight;
  const step = tileWidth + GAP;
  const rowStep = tileHeight + GAP;
  // `tilesPerRow` matches the parent flex-wrap layout exactly: each
  // row fits `floor((containerWidth + GAP) / step)` tiles before the
  // next one wraps (the trailing GAP is "spent" only between tiles, so
  // we add one back to the budget when computing capacity). Falls back
  // to `slotCount` when the layout hasn't measured yet so the source
  // tile is treated as part of a single row — drag math then collapses
  // to the legacy horizontal-only behaviour for that first paint.
  const tilesPerRow =
    containerWidth && step > 0
      ? Math.max(1, Math.floor((containerWidth + GAP) / step))
      : Math.max(1, slotCount);

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
            rowStep={rowStep}
            tilesPerRow={tilesPerRow}
            draggable={draggable}
            onTap={tappable && onTileClick ? () => onTileClick(t) : undefined}
            onReorder={draggable ? (toIndex) => onReorder(i, toIndex) : undefined}
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
  const t = usePulse({ durationMs: PULSE_TEMPO.urgent });
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
