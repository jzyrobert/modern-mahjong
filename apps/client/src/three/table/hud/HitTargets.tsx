import { type Tile as MTile, tileId } from '@mahjong/game-logic';
import { forwardRef, useImperativeHandle, useRef } from 'react';
import { TutorialTarget } from '../../../ui/tutorial/TargetRegistry';
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
  /** Union of the near wall's stacks (rel 0) — HUD anchors avoid it. */
  nearWall: ScreenRect | null;
  /** Union of every river's tiles. */
  discards: ScreenRect | null;
  /** Screen y of the centre plate's near edge (band floor while rivers are empty). */
  plateBottom: number | null;
}

export interface HitTargetsHandle {
  /** Write a tile button's rect (CSS px). `null` hides it. */
  setTileRect(id: number, rect: ScreenRect | null): void;
  setWallRect(rect: ScreenRect | null): void;
}

interface HitTargetsProps {
  hand: readonly MTile[];
  hintTileId: number | null;
  drawnTileId: number | null;
  canDiscard: boolean;
  onTileTap: (t: MTile) => void;
  onHover: (id: number | null) => void;
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
): void {
  if (!el) return;
  if (!rect) {
    el.style.display = 'none';
    return;
  }
  const h = Math.max(minH, rect.height);
  const w = Math.max(minW, rect.width);
  const top = rect.top + rect.height - h;
  const left = rect.left - (w - rect.width) / 2;
  el.style.display = 'block';
  el.style.transform = `translate(${left.toFixed(1)}px, ${top.toFixed(1)}px)`;
  el.style.width = `${w.toFixed(1)}px`;
  el.style.height = `${h.toFixed(1)}px`;
}

function rectStyle(r: ScreenRect | null) {
  return r
    ? { position: 'absolute' as const, left: r.left, top: r.top, width: r.width, height: r.height }
    : { position: 'absolute' as const, left: 0, top: 0, width: 0, height: 0 };
}

export const HitTargets = forwardRef<HitTargetsHandle, HitTargetsProps>(function HitTargets(
  {
    hand,
    hintTileId,
    drawnTileId,
    canDiscard,
    onTileTap,
    onHover,
    nextDrawTile,
    needsDraw,
    onDraw,
    rects,
    onRiverTap,
    riverZoomed = false,
  },
  ref,
) {
  const tileEls = useRef(new Map<number, HTMLButtonElement>());
  const wallEl = useRef<HTMLButtonElement | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      setTileRect(id, rect) {
        // Tiles project ≥ 44 px wide on every preset; the floor only
        // kicks in on very narrow phones, where neighbours may overlap
        // by a few px rather than leave a sub-44 px target.
        applyRect(tileEls.current.get(id) ?? null, rect, MIN_TOUCH, MIN_TOUCH);
      },
      setWallRect(rect) {
        applyRect(wallEl.current, rect, 0);
      },
    }),
    [],
  );
  return (
    <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
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
      {needsDraw && nextDrawTile ? (
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
            aria-label={`${tileName(t)}${id === drawnTileId ? ', just drawn' : ''}${canDiscard ? ', tap to discard' : ''}`}
            className="mj-hit"
            onClick={() => onTileTap(t)}
            onPointerEnter={() => onHover(id)}
            onPointerLeave={() => onHover(null)}
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
              touchAction: 'manipulation',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {hinted ? (
              <span
                data-testid="hand-tile-recommended"
                aria-hidden="true"
                className="mj-pulse"
                style={{
                  position: 'absolute',
                  left: -2,
                  right: -2,
                  top: -2,
                  bottom: 10,
                  borderRadius: 6,
                  border: '2px solid #2dd4bf',
                  boxShadow: '0 0 10px rgba(45,212,191,0.75)',
                  pointerEvents: 'none',
                }}
              />
            ) : null}
          </button>
        );
      })}

      {needsDraw && nextDrawTile ? (
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
