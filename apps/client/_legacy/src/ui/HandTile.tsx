import type { Tile as MTile } from '@mahjong/game-logic';
import { useEffect, useRef } from 'react';
import { Tile } from './Tile.js';

const LONG_PRESS_MS = 220;
const TAP_TOLERANCE_PX = 6;

export interface HandTileProps {
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

/**
 * One tile inside a `Hand` row. Wraps the underlying `Tile` with the
 * pointer-driven long-press drag (touch) + HTML5 drag (mouse) used by the
 * manual reorder mode, plus the drawn-tile glow and drop-target indicator.
 *
 * Drag state lives on the parent `Hand`; this component receives callbacks
 * and renders the visual feedback. Long-press gestures are tracked in a ref
 * with an `AbortController` so an unmount mid-press tears down the document
 * pointer listeners cleanly.
 */
export function HandTile({
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
}: HandTileProps) {
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
