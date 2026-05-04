import type { Tile as MTile, Suit } from '@mahjong/game-logic';
import { sortHand, tileId } from '@mahjong/game-logic';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Tile } from './Tile.js';
import type { SortMode } from './match/SortPicker.js';

interface HandProps {
  tiles: readonly MTile[];
  faceDown?: boolean | undefined;
  onTileClick?: ((t: MTile) => void) | undefined;
  rotate?: number | undefined;
  /**
   * Sort mode for the user's own hand. Opponent face-down hands ignore this
   * and always render in engine order. Defaults to 'suit'.
   */
  sortMode?: SortMode;
  /**
   * Engine `tileId` of the just-drawn tile (driven by `useGame.drawnTileId`).
   * When this matches a tile in the row, that tile gets a soft gold drop-
   * shadow glow + lift to mark it as the freshly drawn tile.
   */
  drawnTileId?: number | null;
  /**
   * Persisted manual order (tileIds). Ignored unless `sortMode === 'manual'`.
   * Tiles not in this list fall to the end of the row in engine order.
   */
  manualOrder?: readonly number[] | undefined;
  /** Commit a new manual order (after a drag drop). */
  onReorder?: ((ids: number[]) => void) | undefined;
}

const LONG_PRESS_MS = 220;
const TAP_TOLERANCE_PX = 6;
const POST_DRAG_CLICK_SUPPRESS_MS = 250;

interface PointerDragState {
  id: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
}

export function Hand({
  tiles,
  faceDown,
  onTileClick,
  rotate,
  sortMode = 'suit',
  drawnTileId = null,
  manualOrder,
  onReorder,
}: HandProps) {
  const ordered = useMemo(() => {
    if (faceDown) return [...tiles];
    if (sortMode === 'manual' && manualOrder && manualOrder.length > 0) {
      return manualOrderHand(tiles, manualOrder);
    }
    return orderHand(tiles, sortMode);
  }, [tiles, faceDown, sortMode, manualOrder]);

  const draggable = !faceDown && sortMode === 'manual' && !!onReorder;

  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const [pointerDrag, setPointerDrag] = useState<PointerDragState | null>(null);
  const rowRef = useRef<HTMLDivElement | null>(null);
  // Set right before a drag commits or cancels — `handleTileClick` checks
  // this and ignores synthetic clicks that fire from the same pointer
  // gesture, so a long-press drag on touch doesn't also trigger a discard.
  const dragEndedAtRef = useRef<number>(0);

  const orderedIds = useMemo(() => ordered.map((t) => tileId(t)), [ordered]);

  const commitReorder = (fromId: number, toId: number) => {
    if (fromId === toId) return;
    const idx = orderedIds.slice();
    const fromIdx = idx.indexOf(fromId);
    const toIdx = idx.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = idx.splice(fromIdx, 1);
    if (moved === undefined) return;
    idx.splice(toIdx, 0, moved);
    onReorder?.(idx);
  };

  const finishDrag = () => {
    dragEndedAtRef.current = Date.now();
    setDraggingId(null);
    setDragOverId(null);
    setPointerDrag(null);
  };

  const handleTileClick = (t: MTile) => {
    if (Date.now() - dragEndedAtRef.current < POST_DRAG_CLICK_SUPPRESS_MS) return;
    onTileClick?.(t);
  };

  return (
    <div
      ref={rowRef}
      style={{
        display: 'flex',
        gap: 4,
        flexWrap: 'wrap',
        alignItems: 'flex-end',
        // Block native scrolling under the hand row when manual drag is
        // active so a long-press-and-drag on touch doesn't pan the page.
        touchAction: draggable ? 'none' : 'auto',
      }}
    >
      {ordered.map((t) => {
        const id = tileId(t);
        const isDrawn = !faceDown && drawnTileId === id;
        const isDragging = draggingId === id;
        const isDragOver = dragOverId === id && draggingId !== id;
        const pointerOffset =
          pointerDrag && pointerDrag.id === id
            ? { x: pointerDrag.x - pointerDrag.startX, y: pointerDrag.y - pointerDrag.startY }
            : null;
        return (
          <TileWrapper
            key={id}
            tile={t}
            tileIdValue={id}
            faceDown={faceDown}
            rotate={rotate}
            onClick={onTileClick ? () => handleTileClick(t) : undefined}
            isDrawn={isDrawn}
            draggable={draggable}
            isDragging={isDragging}
            isDragOver={isDragOver}
            pointerOffset={pointerOffset}
            onDragStartTile={() => setDraggingId(id)}
            onDragEnterTile={() => {
              if (draggingId !== null && draggingId !== id) setDragOverId(id);
            }}
            onDragEndTile={finishDrag}
            onDropTile={(fromId) => {
              commitReorder(fromId, id);
              finishDrag();
            }}
            onPointerDragStart={(clientX, clientY) => {
              setDraggingId(id);
              setPointerDrag({ id, startX: clientX, startY: clientY, x: clientX, y: clientY });
            }}
            onPointerDragMove={(clientX, clientY) => {
              setPointerDrag((prev) =>
                prev && prev.id === id ? { ...prev, x: clientX, y: clientY } : prev,
              );
              // Hit-test against everything except the dragging tile so the
              // floating tile doesn't "snap to itself" while the pointer
              // hovers over its own translated bounding box.
              const target = closestTileId(rowRef.current, clientX, clientY, id);
              if (target !== null && target !== id) setDragOverId(target);
            }}
            onPointerDragCommit={() => {
              const overId = dragOverId;
              if (overId !== null && overId !== id) commitReorder(id, overId);
              finishDrag();
            }}
            onPointerDragCancel={finishDrag}
          />
        );
      })}
    </div>
  );
}

interface TileWrapperProps {
  tile: MTile;
  tileIdValue: number;
  faceDown?: boolean | undefined;
  rotate?: number | undefined;
  onClick?: (() => void) | undefined;
  isDrawn?: boolean;
  draggable?: boolean;
  isDragging?: boolean;
  isDragOver?: boolean;
  /** Pixel offset from the tile's natural position while the pointer is dragging it. */
  pointerOffset?: { x: number; y: number } | null;
  onDragStartTile?: (() => void) | undefined;
  onDragEnterTile?: (() => void) | undefined;
  onDragEndTile?: (() => void) | undefined;
  onDropTile?: ((fromId: number) => void) | undefined;
  onPointerDragStart?: ((clientX: number, clientY: number) => void) | undefined;
  onPointerDragMove?: ((clientX: number, clientY: number) => void) | undefined;
  onPointerDragCommit?: (() => void) | undefined;
  onPointerDragCancel?: (() => void) | undefined;
}

function TileWrapper({
  tile,
  tileIdValue,
  faceDown,
  rotate,
  onClick,
  isDrawn,
  draggable,
  isDragging,
  isDragOver,
  pointerOffset,
  onDragStartTile,
  onDragEnterTile,
  onDragEndTile,
  onDropTile,
  onPointerDragStart,
  onPointerDragMove,
  onPointerDragCommit,
  onPointerDragCancel,
}: TileWrapperProps) {
  // Tracks the in-flight long-press gesture so we can abort it on unmount.
  // Without this, a tile that unmounts while the user is still touching it
  // (claim resolves, route change, etc.) leaves the document-level pointer
  // listeners attached and pins this component's closures in memory.
  const gestureRef = useRef<{ abort: AbortController; timer: number } | null>(null);
  useEffect(
    () => () => {
      const g = gestureRef.current;
      if (g) {
        window.clearTimeout(g.timer);
        g.abort.abort();
        gestureRef.current = null;
      }
    },
    [],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggable) return;
    if (e.pointerType === 'mouse') return; // mouse uses HTML5 dnd
    // Cancel any prior in-flight gesture before starting a new one.
    const prior = gestureRef.current;
    if (prior) {
      window.clearTimeout(prior.timer);
      prior.abort.abort();
    }
    const startX = e.clientX;
    const startY = e.clientY;
    const ac = new AbortController();
    let armed = false;
    const armTimer = window.setTimeout(() => {
      armed = true;
      onPointerDragStart?.(startX, startY);
    }, LONG_PRESS_MS);
    gestureRef.current = { abort: ac, timer: armTimer };

    const cleanup = () => {
      window.clearTimeout(armTimer);
      ac.abort();
      if (gestureRef.current?.abort === ac) gestureRef.current = null;
    };
    const onMove = (ev: PointerEvent) => {
      if (!armed) {
        if (
          Math.abs(ev.clientX - startX) > TAP_TOLERANCE_PX ||
          Math.abs(ev.clientY - startY) > TAP_TOLERANCE_PX
        ) {
          // The user moved before the threshold — they're scrolling, not
          // dragging. Cancel the long-press timer so the gesture stays a tap.
          cleanup();
        }
        return;
      }
      ev.preventDefault();
      onPointerDragMove?.(ev.clientX, ev.clientY);
    };
    const onUp = () => {
      if (armed) onPointerDragCommit?.();
      // Otherwise, do nothing — the synthetic click will fire on the
      // button below and `Hand.handleTileClick` will run.
      cleanup();
    };
    const onCancel = () => {
      onPointerDragCancel?.();
      cleanup();
    };
    document.addEventListener('pointermove', onMove, { signal: ac.signal });
    document.addEventListener('pointerup', onUp, { signal: ac.signal });
    document.addEventListener('pointercancel', onCancel, { signal: ac.signal });
  };

  const isPointerDragging = pointerOffset !== null && pointerOffset !== undefined;
  const wrapperStyle: React.CSSProperties = {
    display: 'inline-block',
    position: 'relative',
    cursor: draggable ? (isDragging ? 'grabbing' : 'grab') : undefined,
    // Pointer-driven drag lifts the tile + makes it follow the finger;
    // HTML5 mouse drag uses the browser's own ghost image, so we ghost
    // the original at 0.4 opacity instead of moving it.
    opacity: isDragging && !isPointerDragging ? 0.4 : 1,
    transition: isPointerDragging ? 'none' : 'opacity 0.12s, margin 0.15s',
    marginLeft: isDragOver ? 10 : 0,
    transform: isPointerDragging
      ? `translate3d(${pointerOffset.x}px, ${pointerOffset.y}px, 0) scale(1.08)`
      : undefined,
    zIndex: isPointerDragging ? 50 : undefined,
    // Keep the dragged tile out of hit-tests so the row's pointermove
    // listener still fires on the tiles underneath; pointer drives via
    // a document listener anyway.
    pointerEvents: isPointerDragging ? 'none' : undefined,
    filter: isPointerDragging
      ? 'drop-shadow(0 8px 16px rgba(0,0,0,0.3)) drop-shadow(0 2px 4px rgba(0,0,0,0.18))'
      : undefined,
  };
  if (isDrawn && !isPointerDragging) {
    wrapperStyle.filter =
      'drop-shadow(0 0 8px oklch(0.78 0.16 75 / 0.7)) drop-shadow(0 2px 3px rgba(0,0,0,0.18))';
  }

  return (
    <div
      data-mh-tile="1"
      data-mh-id={tileIdValue}
      style={wrapperStyle}
      draggable={draggable || undefined}
      onDragStart={
        draggable
          ? (e) => {
              try {
                e.dataTransfer.setData('text/plain', String(tileIdValue));
                e.dataTransfer.effectAllowed = 'move';
              } catch {
                /* dataTransfer unavailable — drag still works via parent state */
              }
              onDragStartTile?.();
            }
          : undefined
      }
      onDragEnter={
        draggable
          ? (e) => {
              e.preventDefault();
              onDragEnterTile?.();
            }
          : undefined
      }
      onDragOver={
        draggable
          ? (e) => {
              e.preventDefault();
              if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            }
          : undefined
      }
      onDrop={
        draggable
          ? (e) => {
              e.preventDefault();
              const raw = e.dataTransfer.getData('text/plain');
              const fromId = Number.parseInt(raw, 10);
              if (Number.isFinite(fromId)) onDropTile?.(fromId);
            }
          : undefined
      }
      onDragEnd={draggable ? () => onDragEndTile?.() : undefined}
      onPointerDown={draggable ? handlePointerDown : undefined}
    >
      {isDragOver ? (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: -6,
            top: 2,
            bottom: 2,
            width: 2,
            background: 'oklch(0.65 0.16 30)',
            borderRadius: 1,
            boxShadow: '0 0 6px oklch(0.65 0.16 30 / 0.7)',
            pointerEvents: 'none',
          }}
        />
      ) : null}
      <Tile
        tile={tile}
        faceDown={faceDown}
        rotate={rotate}
        onClick={onClick}
        raised={isDrawn}
        testId={onClick ? 'own-hand-tile' : undefined}
      />
    </div>
  );
}

const SUIT_ORDER: Record<Suit, number> = { man: 0, pin: 1, sou: 2 };
const HONOR_ORDER: Record<string, number> = { E: 0, S: 1, W: 2, N: 3, Z: 4, F: 5, B: 6 };

function orderHand(tiles: readonly MTile[], mode: SortMode): MTile[] {
  if (mode === 'manual') return [...tiles];
  if (mode === 'suit') return sortHand(tiles);
  // 'num' — numeric rank first, suit as tiebreak; honors stay grouped at the end.
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
    // Tiles not in `order` (e.g. just drew a fresh one before appendEvents
    // fired) fall to the end and keep their engine relative order.
    if (ia === undefined && ib === undefined) return 0;
    if (ia === undefined) return 1;
    if (ib === undefined) return -1;
    return ia - ib;
  });
}

function closestTileId(
  row: HTMLElement | null,
  clientX: number,
  clientY: number,
  excludeId: number | null = null,
): number | null {
  if (!row) return null;
  const els = Array.from(row.querySelectorAll<HTMLElement>('[data-mh-tile="1"]'));
  let bestId: number | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const el of els) {
    const raw = el.getAttribute('data-mh-id');
    if (raw === null) continue;
    const id = Number.parseInt(raw, 10);
    if (!Number.isFinite(id)) continue;
    if (excludeId !== null && id === excludeId) continue;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const d = Math.hypot(clientX - cx, clientY - cy);
    if (d < bestDist) {
      bestDist = d;
      bestId = id;
    }
  }
  return bestId;
}
