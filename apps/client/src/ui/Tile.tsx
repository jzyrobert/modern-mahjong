import { type Tile as MTile, tileId, tileLabel } from '@mahjong/game-logic';
import { type MotionStyle, type Transition, motion } from 'framer-motion';
import { memo } from 'react';
import { useGame } from '../state/game.js';
import { TileGlyph } from './TileGlyph.js';

interface TileProps {
  tile: MTile;
  faceDown?: boolean | undefined;
  selected?: boolean | undefined;
  /** Slightly raise the tile (used by the drawn-tile glow + hover states). */
  raised?: boolean | undefined;
  /** Soften brightness/saturation for dead/discarded states. */
  dim?: boolean | undefined;
  onClick?: (() => void) | undefined;
  style?: MotionStyle | undefined;
  rotate?: number | undefined;
  testId?: string | undefined;
}

const SPRING: Transition = { type: 'spring', stiffness: 420, damping: 32, mass: 0.6 };
// Slower spring used during the between-hand dispense so the table-wide
// tile flight is readable instead of a 150 ms blur.
const SLOW_SPRING: Transition = { type: 'spring', stiffness: 80, damping: 18, mass: 0.8 };
const TAP = { scale: 0.94 } as const;

// 36×50 SVG reference frame; the outer button scales via CSS width/height.
const W = 36;
const H = 50;
const R = W * 0.18;

const STATIC_STYLE: MotionStyle = {
  width: 'var(--tile-w, 36px)',
  height: 'var(--tile-h, 50px)',
  display: 'block',
  padding: 0,
  margin: 0,
  border: 'none',
  background: 'transparent',
  position: 'relative',
};

/**
 * Heavy paint-tree of a tile face/back: the layered SVG (face/side/edge
 * rects + gradients + face-down centre dot + selection ring) plus the
 * `<TileGlyph>` overlay. Memoised so a `shuffling` flip on the outer
 * `Tile` (which only updates the motion-button transition prop) doesn't
 * recompute this subtree on every visible tile.
 */
const TileBody = memo(function TileBody({
  tile,
  faceDown,
  selected,
}: {
  tile: MTile;
  faceDown: boolean | undefined;
  selected: boolean | undefined;
}) {
  return (
    <>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height="100%"
        preserveAspectRatio="xMidYMid meet"
        style={{
          display: 'block',
          overflow: 'visible',
          position: 'absolute',
          inset: 0,
        }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="mj-tile-face" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.99 0.008 85)" />
            <stop offset="100%" stopColor="oklch(0.93 0.018 85)" />
          </linearGradient>
          <linearGradient id="mj-tile-side" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="oklch(0.88 0.025 85)" />
            <stop offset="100%" stopColor="oklch(0.78 0.03 85)" />
          </linearGradient>
          <linearGradient id="mj-tile-back" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--tile-back-1, oklch(0.72 0.08 200))" />
            <stop offset="100%" stopColor="var(--tile-back-2, oklch(0.62 0.09 210))" />
          </linearGradient>
        </defs>
        <rect
          x={1}
          y={H * 0.08}
          width={W - 2}
          height={H * 0.95}
          rx={R}
          fill="rgba(80,60,40,0.18)"
        />
        <rect x={0} y={H * 0.04} width={W} height={H * 0.96} rx={R} fill="url(#mj-tile-side)" />
        <rect
          x={0}
          y={0}
          width={W}
          height={H * 0.92}
          rx={R}
          fill={faceDown ? 'url(#mj-tile-back)' : 'url(#mj-tile-face)'}
        />
        <rect
          x={1.2}
          y={1.2}
          width={W - 2.4}
          height={H * 0.92 - 2.4}
          rx={R - 1}
          fill="none"
          stroke={faceDown ? 'rgba(255,255,255,0.18)' : 'oklch(0.85 0.02 85)'}
          strokeWidth="0.8"
        />
        {faceDown ? (
          <g>
            <circle
              cx={W / 2}
              cy={H * 0.46}
              r={W * 0.22}
              fill="none"
              stroke="rgba(255,255,255,0.35)"
              strokeWidth="1.2"
            />
            <circle cx={W / 2} cy={H * 0.46} r={W * 0.12} fill="rgba(255,255,255,0.18)" />
          </g>
        ) : null}
        {selected ? (
          <rect
            x={-1}
            y={-1}
            width={W + 2}
            height={H * 0.92 + 2}
            rx={R + 1}
            fill="none"
            stroke="oklch(0.72 0.14 30)"
            strokeWidth="2.5"
          />
        ) : null}
      </svg>
      {!faceDown ? (
        <span
          style={{
            position: 'absolute',
            // Constrain the glyph to the face surface (top 92% of the SVG box,
            // matching the face-rect height above).
            top: 0,
            left: 0,
            right: 0,
            bottom: '8%',
            display: 'block',
            pointerEvents: 'none',
          }}
        >
          <TileGlyph t={tile} />
        </span>
      ) : null}
    </>
  );
});

function TileComponent({
  tile,
  faceDown,
  selected,
  raised,
  dim,
  onClick,
  style,
  rotate,
  testId,
}: TileProps) {
  // Subscribing to `shuffling` here re-renders the outer motion.button
  // when the dispense starts/ends so framer-motion picks up the slower
  // transition. The heavy paint tree (`TileBody`, memoised) skips the
  // update because its own props haven't changed — that's the win.
  const shuffling = useGame((s) => s.shuffling);
  const lift = selected ? -10 : raised ? -4 : 0;
  return (
    <motion.button
      type="button"
      layoutId={`tile-${tileId(tile)}`}
      onClick={onClick}
      // Face-down tiles (opponent hands, the wall) shouldn't leak the actual
      // tile face to screen readers — announce them generically.
      aria-label={faceDown ? 'Face-down tile' : tileLabel(tile)}
      {...(onClick ? { whileTap: TAP } : {})}
      {...(testId ? { 'data-testid': testId } : {})}
      transition={shuffling ? SLOW_SPRING : SPRING}
      style={{
        ...STATIC_STYLE,
        cursor: onClick ? 'pointer' : 'default',
        rotate: rotate ?? 0,
        translateY: lift,
        filter: dim ? 'brightness(0.85) saturate(0.85)' : undefined,
        ...(style ?? {}),
      }}
    >
      <TileBody tile={tile} faceDown={faceDown} selected={selected} />
    </motion.button>
  );
}

export const Tile = memo(TileComponent);
