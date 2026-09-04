import { type Tile as MTile, tileId } from '@mahjong/game-logic';
import { TileGlyph } from '../../../ui/TileGlyph';
import { TutorialTarget } from '../../../ui/tutorial/TargetRegistry';
import { tileName } from './HitTargets';
import { GLASS, glassStyle } from './glass';

/** Thumbnail size, CSS px (a 36 : 50 face). */
export const RAIL_TILE_W = 24;
export const RAIL_TILE_H = 33;

export interface HandRailProps {
  /** The user's concealed hand in display order (drawn tile last). */
  hand: readonly MTile[];
  drawnTileId: number | null;
  /** The user has to draw: the rail ends in a gold draw pill. */
  needsDraw: boolean;
  onShowHand: () => void;
  onDraw: () => void;
}

/**
 * The phone-landscape river zoom's hand: a one-row rail of face
 * thumbnails in the footer's centre slot while the 3D hand stands out
 * of frame below it. The zoom used to be withdrawn the moment the turn
 * came round — exactly when the player has to read the rivers to pick
 * a safe discard (round-4 #1) — so instead the zoom stays and the rail
 * keeps the hand legible; tapping the rail (or the ✕ in the chrome)
 * brings the table back, and nothing here discards. When the player
 * has to draw, the rail carries the draw control (the wall's next
 * stack may be off-frame while zoomed) under the classic
 * `wall-draw-next` id, so the tutorial and the e2e suite keep their
 * hook. Claim windows and declare CTAs still end the zoom — those want
 * the real hand and the claim strip.
 */
export function HandRail({ hand, drawnTileId, needsDraw, onShowHand, onDraw }: HandRailProps) {
  return (
    <div
      data-testid="hand-rail"
      style={{
        display: 'inline-flex',
        alignItems: 'stretch',
        gap: 6,
        pointerEvents: 'none',
        maxWidth: '100%',
        minWidth: 0,
      }}
    >
      <button
        type="button"
        aria-label="Show the hand"
        onClick={onShowHand}
        className="mj-glass-btn"
        style={glassStyle({
          display: 'inline-flex',
          alignItems: 'center',
          gap: 2,
          padding: '3px 6px',
          borderRadius: 12,
          minHeight: 40,
          cursor: 'zoom-out',
          pointerEvents: 'auto',
          minWidth: 0,
          overflow: 'hidden',
        })}
      >
        {hand.map((t) => {
          const id = tileId(t);
          const drawn = id === drawnTileId;
          return (
            <span
              key={id}
              data-testid="hand-rail-tile"
              title={tileName(t)}
              aria-hidden="true"
              style={{
                width: RAIL_TILE_W,
                height: RAIL_TILE_H,
                marginLeft: drawn ? 6 : 0,
                borderRadius: 3,
                background: 'linear-gradient(180deg, #f6efdf 0%, #e9dfc8 100%)',
                border: drawn ? '1px solid rgba(216,168,90,0.9)' : '1px solid rgba(0,0,0,0.35)',
                boxShadow: drawn ? '0 0 8px rgba(216,168,90,0.7)' : '0 1px 2px rgba(0,0,0,0.35)',
                boxSizing: 'border-box',
                overflow: 'hidden',
                flexShrink: 0,
                display: 'block',
              }}
            >
              <TileGlyph t={t} width={RAIL_TILE_W - 2} />
            </span>
          );
        })}
      </button>
      {needsDraw ? (
        <TutorialTarget id="wall-draw">
          <button
            type="button"
            data-testid="wall-draw-next"
            aria-label="Draw next tile"
            onClick={onDraw}
            className="mj-glass-btn"
            style={glassStyle({
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              padding: '0 14px 0 11px',
              minHeight: 40,
              borderRadius: 12,
              cursor: 'pointer',
              pointerEvents: 'auto',
              background: 'rgba(216,168,90,0.16)',
              border: '1px solid rgba(216,168,90,0.6)',
              color: GLASS.gold,
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: 1.4,
              textTransform: 'uppercase',
              whiteSpace: 'nowrap',
            })}
          >
            <span
              aria-hidden="true"
              className="mj-pulse"
              style={{
                width: 7,
                height: 7,
                borderRadius: 4,
                background: GLASS.gold,
                boxShadow: '0 0 8px rgba(216,168,90,0.9)',
              }}
            />
            Draw
          </button>
        </TutorialTarget>
      ) : null}
    </div>
  );
}
