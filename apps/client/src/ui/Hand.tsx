import type { Tile as MTile, Suit } from '@mahjong/game-logic';
import { sortHand, tileId } from '@mahjong/game-logic';
import { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import { useGame } from '../state/game';
import { HandTile } from './HandTile';
import type { SortMode } from './match/SortPicker';

interface HandProps {
  tiles: readonly MTile[];
  faceDown?: boolean | undefined;
  onTileClick?: ((t: MTile) => void) | undefined;
  /** Sort mode for the user's own hand. */
  sortMode?: SortMode;
  /** Engine `tileId` of the freshly-drawn tile — gets a soft glow + lift. */
  drawnTileId?: number | null;
  tileWidth?: number;
  tileHeight?: number;
}

const TILE_W_DEFAULT = 36;
const TILE_H_DEFAULT = 50;
const GAP = 4;

/**
 * Native port of `_legacy/src/ui/Hand.tsx` with Phase 5 drag-to-
 * reorder wired up via `HandTile`. Manual mode uses
 * `useGame.manualOrder` from the store; tap-to-discard still works
 * via the gesture's Tap branch (long-press is required to enter
 * drag mode, so a quick tap goes straight to `onTileClick`).
 */
export function Hand({
  tiles,
  faceDown,
  onTileClick,
  sortMode = 'suit',
  drawnTileId = null,
  tileWidth = TILE_W_DEFAULT,
  tileHeight = TILE_H_DEFAULT,
}: HandProps) {
  const manualOrder = useGame((s) => s.manualOrder);
  const setManualOrder = useGame((s) => s.setManualOrder);

  const ordered = useMemo(() => {
    if (faceDown) return [...tiles];
    if (sortMode === 'manual' && manualOrder.length > 0) {
      return manualOrderHand(tiles, manualOrder);
    }
    return orderHand(tiles, sortMode);
  }, [tiles, faceDown, sortMode, manualOrder]);

  const orderedIds = useMemo(() => ordered.map((t) => tileId(t)), [ordered]);

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

  const draggable = !faceDown && sortMode === 'manual' && !!setManualOrder;
  const step = tileWidth + GAP;

  // Face-down hands aren't used by the current Match layout (we render
  // opponents via `<OppHandStrip>` instead), so the face-down branch
  // is a thin pass-through. `rotate` is ignored for now — opponent
  // sideways hands would need separate composition.
  if (faceDown || !onTileClick) {
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
        {ordered.map((t, i) => {
          const id = tileId(t);
          return (
            <HandTile
              key={id}
              tile={t}
              index={i}
              total={ordered.length}
              step={step}
              draggable={false}
              drawnTileId={drawnTileId}
              width={tileWidth}
              height={tileHeight}
            />
          );
        })}
      </View>
    );
  }

  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: GAP }}>
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
            onTap={onTileClick ? () => onTileClick(t) : undefined}
            onReorder={(toIndex) => onReorder(i, toIndex)}
            drawnTileId={drawnTileId}
            width={tileWidth}
            height={tileHeight}
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
