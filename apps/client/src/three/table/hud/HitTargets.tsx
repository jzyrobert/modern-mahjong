import { type Tile as MTile, tileId } from '@mahjong/game-logic';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react';
import type { SortMode } from '../../../ui/match/SortPicker';
import { TutorialTarget } from '../../../ui/tutorial/TargetRegistry';
import {
  DRAG_HOLD_MS,
  type Pt,
  exceedsDragThreshold,
  keyboardMoveIndex,
  moveIndex,
  nearestSlotIndex,
  slotsFromRects,
} from '../dragReorder';
import type { ScreenRect } from '../picking';

/**
 * Transparent DOM hit-targets projected from world space. The
 * buttons carry the same `data-testid`s / accessible names the classic
 * shells use (`own-hand-tile`, `hand-tile-recommended`,
 * `wall-draw-next`) so Playwright and screen readers keep working;
 * their rects are written imperatively from the render loop through
 * the `HitTargetsHandle` so React never re-renders per frame.
 *
 * The `TutorialTarget` wrappers (`own-hand`, `wall-draw`,
 * `shared-discards`) take their rects from React state instead —
 * the registry measures RN Views, so those need real layout.
 */
export interface HudRects {
  ownHand: ScreenRect | null;
  wallDraw: ScreenRect | null;
  river: ScreenRect | null;
  /** Union of every river's tiles. */
  discards: ScreenRect | null;
  /** Screen y of the centre plate's near edge (band floor while rivers are empty). */
  plateBottom: number | null;
  /** Screen y of the far rail's top edge (portrait toasts overlap it). */
  farRailTop: number | null;
  /** Screen y of the far seat's rack top edge (portrait toasts stop above it). */
  farRowTop: number | null;
  /** Screen y of the near rail's bottom edge (portrait floor shadow). */
  nearRailBottom: number | null;
  /** Screen y of the near river's last row's far edge at the portrait river scale — the block's bottom while zoomed (toast slot). */
  riverBlockBottom: number | null;
}

export interface HitTargetsHandle {
  /**
   * Write a tile button's rect (CSS px). `null` hides it. `settled` is
   * the rect of the tile's slot (its flight / spring destination) —
   * drag-to-reorder resolves the pointer against these so the slots
   * stay put while the tiles are still re-flowing.
   */
  setTileRect(id: number, rect: ScreenRect | null, settled?: ScreenRect | null): void;
  setWallRect(rect: ScreenRect | null): void;
}

interface HitTargetsProps {
  hand: readonly MTile[];
  hintTileId: number | null;
  drawnTileId: number | null;
  canDiscard: boolean;
  onTileTap: (t: MTile) => void;
  onHover: (id: number | null) => void;
  /**
   * Drag-to-reorder. `onReorder` receives the full display order (every
   * hand tile id) — the classic `Hand.onReorder` → `setManualOrder`
   * contract. A drag started in SUIT / NUMBER mode first flips the
   * segment to MANUAL through `onSortModeChange`, then reorders.
   * `onDrag` mirrors the carried tile into the scene (canvas CSS px;
   * `null` ends the drag).
   */
  sortMode: SortMode;
  onSortModeChange: (m: SortMode) => void;
  onReorder: (ids: readonly number[]) => void;
  onDrag: (id: number | null, x: number, y: number) => void;
  nextDrawTile: MTile | null;
  needsDraw: boolean;
  onDraw: () => void;
  rects: HudRects;
  /**
   * Portrait: tapping the river region toggles the camera between the
   * full table and a river-block zoom. Undefined = region is inert.
   */
  onRiverTap?: (() => void) | undefined;
  riverZoomed?: boolean | undefined;
  /**
   * Skip the projected draw target (and its tutorial anchor): the river
   * zoom hosts the draw control in the landscape hand rail / the
   * portrait tray (`DrawPill`) under the same `wall-draw-next` id.
   */
  wallHidden?: boolean | undefined;
}

export function tileName(t: MTile): string {
  if (t.kind === 'suit') {
    const suit = t.suit === 'man' ? 'man' : t.suit === 'pin' ? 'pin' : 'sou';
    return `${t.rank} ${suit}`;
  }
  switch (t.honor) {
    case 'E':
      return 'East wind';
    case 'S':
      return 'South wind';
    case 'W':
      return 'West wind';
    case 'N':
      return 'North wind';
    case 'Z':
      return 'Red dragon';
    case 'F':
      return 'Green dragon';
    default:
      return 'White dragon';
  }
}

const MIN_TOUCH = 44;

function applyRect(
  el: HTMLElement | null,
  rect: ScreenRect | null,
  minH = MIN_TOUCH,
  minW = 0,
): ScreenRect | null {
  if (!el) return null;
  if (!rect) {
    el.style.display = 'none';
    return null;
  }
  const h = Math.max(minH, rect.height);
  const w = Math.max(minW, rect.width);
  const top = rect.top + rect.height - h;
  const left = rect.left - (w - rect.width) / 2;
  el.style.display = 'block';
  el.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
  el.style.width = `${w.toFixed(1)}px`;
  el.style.height = `${h.toFixed(1)}px`;
  return { left, top, width: w, height: h };
}

function rectStyle(r: ScreenRect | null) {
  return r
    ? { position: 'absolute' as const, left: r.left, top: r.top, width: r.width, height: r.height }
    : { position: 'absolute' as const, left: 0, top: 0, width: 0, height: 0 };
}

/**
 * One press on a hand tile. Armed on pointerdown; `active` once the
 * pointer has travelled `DRAG_START_PX` (or a touch has held for
 * `DRAG_HOLD_MS`), from which point the click that follows the release
 * is swallowed so a drag never discards. `order` / `centres` are the
 * slots as they stood when the drag started — the set of slot positions
 * does not change while a tile is carried (same tile count), so the
 * pointer is resolved against a stable grid while the tiles re-flow.
 *
 * The move / up listeners live on `window`, not the button: every
 * reorder re-keys the buttons into the new display order, and moving a
 * node in the DOM releases its pointer capture (and would end a drag
 * after the first slot).
 */
interface DragState {
  id: number;
  pointerId: number;
  startX: number;
  startY: number;
  active: boolean;
  order: readonly number[];
  centres: Pt[];
  holdTimer: ReturnType<typeof setTimeout> | null;
  el: HTMLButtonElement;
  /** Detach the window listeners the press installed. */
  detach: () => void;
}

export const HitTargets = forwardRef<HitTargetsHandle, HitTargetsProps>(function HitTargets(
  {
    hand,
    hintTileId,
    drawnTileId,
    canDiscard,
    onTileTap,
    onHover,
    sortMode,
    onSortModeChange,
    onReorder,
    onDrag,
    nextDrawTile,
    needsDraw,
    onDraw,
    rects,
    onRiverTap,
    riverZoomed = false,
    wallHidden = false,
  },
  ref,
) {
  const rootEl = useRef<HTMLDivElement | null>(null);
  const tileEls = useRef(new Map<number, HTMLButtonElement>());
  const settledRects = useRef(new Map<number, ScreenRect>());
  const wallEl = useRef<HTMLButtonElement | null>(null);
  const drag = useRef<DragState | null>(null);
  const suppressClick = useRef(false);
  // Latest props for the pointer handlers (bound once per render is
  // fine, but the drag reads them across many events).
  const live = useRef({
    hand,
    drawnTileId,
    sortMode,
    onSortModeChange,
    onReorder,
    onDrag,
    onHover,
  });
  live.current = {
    hand,
    drawnTileId,
    sortMode,
    onSortModeChange,
    onReorder,
    onDrag,
    onHover,
  };
  useImperativeHandle(
    ref,
    () => ({
      setTileRect(id, rect, settled) {
        // Tiles project ≥ 44 px wide on every preset; the floor only
        // kicks in on very narrow phones, where neighbours may overlap
        // by a few px rather than leave a sub-44 px target.
        applyRect(tileEls.current.get(id) ?? null, rect, MIN_TOUCH, MIN_TOUCH);
        const s = settled ?? rect;
        if (s) settledRects.current.set(id, s);
        else settledRects.current.delete(id);
      },
      setWallRect(rect) {
        applyRect(wallEl.current, rect, 0);
      },
    }),
    [],
  );

  /** Pointer position in canvas CSS px (the space the rects live in). */
  const toLocal = useCallback((clientX: number, clientY: number): Pt => {
    const r = rootEl.current?.getBoundingClientRect();
    return { x: clientX - (r?.left ?? 0), y: clientY - (r?.top ?? 0) };
  }, []);

  /** Slots of the current hand from their settled rects, display order. */
  const currentSlots = useCallback(() => {
    const entries: { id: number; rect: ScreenRect }[] = [];
    for (const t of live.current.hand) {
      const id = tileId(t);
      const rect = settledRects.current.get(id);
      if (rect) entries.push({ id, rect });
    }
    return slotsFromRects(entries);
  }, []);

  const endDrag = useCallback(() => {
    const d = drag.current;
    if (!d) return;
    if (d.holdTimer !== null) clearTimeout(d.holdTimer);
    drag.current = null;
    d.detach();
    d.el.style.cursor = '';
    try {
      if (d.el.hasPointerCapture(d.pointerId)) d.el.releasePointerCapture(d.pointerId);
    } catch {
      // Capture already gone (pointercancel / element detached).
    }
    if (d.active) live.current.onDrag(null, 0, 0);
  }, []);

  /** Enter drag mode: MANUAL sort first, then carry the tile. */
  const activate = useCallback(
    (d: DragState, p: Pt) => {
      if (d.active) return;
      d.active = true;
      suppressClick.current = true;
      if (d.holdTimer !== null) {
        clearTimeout(d.holdTimer);
        d.holdTimer = null;
      }
      if (live.current.sortMode !== 'manual') live.current.onSortModeChange('manual');
      const slots = currentSlots();
      d.order = slots.order;
      d.centres = slots.centres;
      d.el.style.cursor = 'grabbing';
      live.current.onDrag(d.id, p.x, p.y);
    },
    [currentSlots],
  );

  const carry = useCallback((d: DragState, p: Pt) => {
    live.current.onDrag(d.id, p.x, p.y);
    const from = d.order.indexOf(d.id);
    const to = nearestSlotIndex(d.centres, p);
    if (from < 0 || to < 0 || to === from) return;
    const next = moveIndex(d.order, from, to);
    if (next !== d.order) {
      d.order = next;
      live.current.onReorder(next);
    }
  }, []);

  // The carried tile left the hand (claim / hand end) — drop the drag.
  useEffect(() => {
    const d = drag.current;
    if (d && !hand.some((t) => tileId(t) === d.id)) endDrag();
  }, [hand, endDrag]);
  useEffect(() => endDrag, [endDrag]);

  const onTilePointerDown = (e: React.PointerEvent<HTMLButtonElement>, id: number) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (drag.current) endDrag();
    suppressClick.current = false;
    // The drawn tile always sits last (with its gap) in the 3D row, so it
    // has no other slot to be carried to; a press on it stays a tap.
    if (live.current.hand.length < 2 || id === live.current.drawnTileId) return;
    const el = e.currentTarget;
    const p = toLocal(e.clientX, e.clientY);
    const onMove = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      const q = toLocal(ev.clientX, ev.clientY);
      if (!d.active) {
        if (!exceedsDragThreshold(q.x - d.startX, q.y - d.startY)) return;
        activate(d, q);
      }
      carry(d, q);
    };
    const onEnd = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d || ev.pointerId !== d.pointerId) return;
      endDrag();
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    const d: DragState = {
      id,
      pointerId: e.pointerId,
      startX: p.x,
      startY: p.y,
      active: false,
      order: [],
      centres: [],
      holdTimer: null,
      el,
      detach: () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onEnd);
        window.removeEventListener('pointercancel', onEnd);
      },
    };
    drag.current = d;
    try {
      // Keeps a mouse drag alive past the window's edge; the drag itself
      // does not depend on it (see `DragState`).
      el.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events carry no active pointer.
    }
    if (e.pointerType === 'touch') {
      d.holdTimer = setTimeout(() => {
        d.holdTimer = null;
        if (drag.current === d) activate(d, { x: d.startX, y: d.startY });
      }, DRAG_HOLD_MS);
    }
  };
  const onTileClick = (t: MTile) => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    onTileTap(t);
  };
  /** Keyboard fallback: Alt / Shift + Arrow moves the focused tile one slot. */
  const onTileKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, id: number) => {
    if (!(e.altKey || e.shiftKey)) return;
    const key = e.key;
    if (key !== 'ArrowLeft' && key !== 'ArrowRight' && key !== 'ArrowUp' && key !== 'ArrowDown')
      return;
    if (id === live.current.drawnTileId) return;
    const slots = currentSlots();
    const from = slots.order.indexOf(id);
    const to = keyboardMoveIndex(slots.centres, from, key);
    e.preventDefault();
    if (to === null) return;
    if (live.current.sortMode !== 'manual') live.current.onSortModeChange('manual');
    live.current.onReorder(moveIndex(slots.order, from, to));
  };

  return (
    <div ref={rootEl} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {/* Tutorial anchors (measured by the registry). */}
      <TutorialTarget id="own-hand" style={rectStyle(rects.ownHand)}>
        <div style={{ width: '100%', height: '100%' }} />
      </TutorialTarget>
      {rects.river ? (
        <TutorialTarget id="shared-discards" style={rectStyle(rects.river)}>
          {onRiverTap ? (
            <button
              type="button"
              data-testid="shared-discards-region"
              aria-label={riverZoomed ? 'Show the full table' : 'Zoom into the discards'}
              aria-pressed={riverZoomed}
              onClick={onRiverTap}
              className="mj-hit"
              style={{
                display: 'block',
                width: '100%',
                height: '100%',
                padding: 0,
                margin: 0,
                border: 0,
                background: 'transparent',
                cursor: 'zoom-in',
                pointerEvents: 'auto',
                touchAction: 'manipulation',
                WebkitTapHighlightColor: 'transparent',
              }}
            />
          ) : (
            <div data-testid="shared-discards-region" style={{ width: '100%', height: '100%' }} />
          )}
        </TutorialTarget>
      ) : null}
      {needsDraw && nextDrawTile && !wallHidden ? (
        <TutorialTarget id="wall-draw" style={rectStyle(rects.wallDraw)}>
          <div style={{ width: '100%', height: '100%' }} />
        </TutorialTarget>
      ) : null}

      {hand.map((t) => {
        const id = tileId(t);
        const hinted = hintTileId === id;
        return (
          <button
            key={id}
            type="button"
            ref={(el) => {
              if (el) tileEls.current.set(id, el);
              else tileEls.current.delete(id);
            }}
            data-testid="own-hand-tile"
            data-tile-id={id}
            aria-label={`${tileName(t)}${id === drawnTileId ? ', just drawn' : ''}${canDiscard ? ', tap to discard' : ''}${id === drawnTileId ? '' : ', drag to reorder'}`}
            aria-keyshortcuts={id === drawnTileId ? undefined : 'Shift+ArrowLeft Shift+ArrowRight'}
            className="mj-hit"
            onClick={() => onTileClick(t)}
            onPointerDown={(e) => onTilePointerDown(e, id)}
            onContextMenu={(e) => {
              if (drag.current) e.preventDefault();
            }}
            onKeyDown={(e) => onTileKeyDown(e, id)}
            onPointerEnter={() => {
              if (!drag.current?.active) onHover(id);
            }}
            onPointerLeave={() => {
              if (!drag.current?.active) onHover(null);
            }}
            onFocus={() => onHover(id)}
            onBlur={() => onHover(null)}
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              display: 'none',
              padding: 0,
              margin: 0,
              border: 0,
              background: 'transparent',
              cursor: canDiscard ? 'pointer' : 'default',
              pointerEvents: 'auto',
              borderRadius: 6,
              // The table never scrolls under a hand tile: claim the
              // gesture outright so a touch drag reorders instead of
              // panning, and no long-press callout / text selection.
              touchAction: 'none',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {hinted ? (
              // Zero-visual marker: the hint itself is scene geometry
              // (`TableScene.hintFrame`, aligned to the tile's pose by
              // construction); this span only keeps the shared testid
              // the classic shell's `HandTile` exposes.
              <span
                data-testid="hand-tile-recommended"
                aria-hidden="true"
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
              />
            ) : null}
          </button>
        );
      })}

      {needsDraw && nextDrawTile && !wallHidden ? (
        <button
          type="button"
          ref={wallEl}
          data-testid="wall-draw-next"
          aria-label="Draw next tile"
          className="mj-hit"
          onClick={onDraw}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            display: 'none',
            padding: 0,
            border: 0,
            background: 'transparent',
            cursor: 'pointer',
            pointerEvents: 'auto',
            borderRadius: 6,
            minWidth: 30,
            minHeight: 30,
          }}
        />
      ) : null}
    </div>
  );
});
