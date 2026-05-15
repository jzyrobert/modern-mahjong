import { type Tile as MTile, tileId } from '@mahjong/game-logic';
import { useCallback, useMemo, useState } from 'react';
import { type LayoutChangeEvent, View } from 'react-native';
import { useGame } from '../state/game';
import { HandTile } from './HandTile';
import { manualOrderHand, orderHand } from './handSort';
import type { SortMode } from './match/SortPicker';

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
  tileWidth: tileWidthProp,
  tileHeight: tileHeightProp,
}: HandProps) {
  const manualOrder = useGame((s) => s.manualOrder);
  const setManualOrder = useGame((s) => s.setManualOrder);
  // While the centre-of-felt draw popup is in its hold/flip phases the
  // freshly-drawn tile is in `state.hands[you]` (the engine put it
  // there as soon as the `drew` event arrived) but shouldn't appear in
  // the rendered row yet — otherwise the row instantly widens to make
  // space, which the user perceives as the gap opening "too early". By
  // filtering the matching `tileId` out of `ordered` while
  // `drawAnimation.phase === 'hold'`, siblings stay tight; when the
  // overlay's progress listener flips phase to `'fly'` at FLIP_END,
  // the tile re-enters `ordered`, the row re-flows, FlipBag slides
  // siblings aside, and the popup begins descending into the gap
  // that's opening to receive it.
  const holdingTileId = useGame((s) =>
    s.drawAnimation && s.drawAnimation.phase === 'hold' ? tileId(s.drawAnimation.tile) : null,
  );
  const [containerWidth, setContainerWidth] = useState<number | null>(null);
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerWidth(e.nativeEvent.layout.width);
  }, []);

  const ordered = useMemo(() => {
    let base: MTile[];
    if (faceDown) base = [...tiles];
    else if (sortMode === 'manual' && manualOrder.length > 0)
      base = manualOrderHand(tiles, manualOrder);
    else base = orderHand(tiles, sortMode);
    if (holdingTileId !== null) {
      return base.filter((t) => tileId(t) !== holdingTileId);
    }
    return base;
  }, [tiles, faceDown, sortMode, manualOrder, holdingTileId]);

  const orderedIds = useMemo(() => ordered.map((t) => tileId(t)), [ordered]);

  // Scale tiles to fit the parent's measured width when the caller doesn't
  // pass an explicit size. Default 36×50; scale down to 30×42 minimum so a
  // 14-tile dealer hand fits on a single row down to roughly 360px wide.
  const fittedWidth = useMemo(() => {
    if (tileWidthProp !== undefined) return tileWidthProp;
    if (!containerWidth || ordered.length === 0) return TILE_W_DEFAULT;
    const totalGap = (ordered.length - 1) * GAP;
    const fit = Math.floor((containerWidth - totalGap) / ordered.length);
    return Math.max(TILE_W_MIN, Math.min(TILE_W_DEFAULT, fit));
  }, [tileWidthProp, containerWidth, ordered.length]);
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
  // to `ordered.length` when the layout hasn't measured yet so the
  // source tile is treated as part of a single row — drag math then
  // collapses to the legacy horizontal-only behaviour for that first
  // paint.
  const tilesPerRow =
    containerWidth && step > 0
      ? Math.max(1, Math.floor((containerWidth + GAP) / step))
      : Math.max(1, ordered.length);

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
    </View>
  );
}
