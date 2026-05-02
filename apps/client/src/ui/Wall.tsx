import { type Tile as MTile, tileId } from '@mahjong/game-logic';
import { motion } from 'framer-motion';
import { Tile } from './Tile.js';

interface WallProps {
  /** The remaining live wall, in engine draw order. `tiles[0]` is the next to draw. */
  tiles: readonly MTile[];
  /** When set, the next tile pulses + becomes clickable. */
  onDrawNext?: (() => void) | undefined;
}

const VISIBLE_TILES = 16;
// Pulse is implemented as a scale+opacity halo overlay rather than a
// box-shadow keyframe — keeps the animation transform/opacity only so
// the compositor can run it without per-frame paint. See docs/PERF.md.
const PULSE_HALO_ANIMATE = {
  scale: [1, 1.18, 1],
  opacity: [0.6, 0, 0.6],
};
const PULSE_TRANSITION = {
  duration: 1.4,
  repeat: Number.POSITIVE_INFINITY,
  ease: 'easeInOut',
} as const;

/**
 * Visible center "wall" — replaces the older floating draw-tile + plain
 * "Wall: 69" HUD text. Renders up to {@link VISIBLE_TILES} face-down tiles
 * in two rows so the wall feels like an actual mahjong stack, plus the
 * live remaining-count badge.
 *
 * Each face-down tile is a real `Tile` (with the engine's `tileId`-based
 * `layoutId`), so when a tile leaves the wall to a player's hand
 * framer-motion animates the transition for free.
 *
 * v1 doesn't render walls along all four table edges or animate the
 * mechanical shuffle/dispense between hands — those land as a follow-up
 * once the engine grows a "between-hand pause" phase. See TODO.md.
 */
export function Wall({ tiles, onDrawNext }: WallProps) {
  if (tiles.length === 0) {
    return <div style={{ fontSize: 12, opacity: 0.6 }}>Wall empty</div>;
  }
  const visible = tiles.slice(0, VISIBLE_TILES);
  const half = Math.ceil(visible.length / 2);
  const top = visible.slice(0, half);
  const bottom = visible.slice(half);
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
        // Walls render with smaller tiles than hands — ~half-scale, so 16
        // face-down tiles fit even on a landscape phone.
        ['--tile-w' as string]: 'max(16px, 2.6vmin)',
        ['--tile-h' as string]: 'max(22px, 3.6vmin)',
      }}
    >
      <WallRow tiles={top} onDrawNext={onDrawNext} />
      {bottom.length > 0 && <WallRow tiles={bottom} />}
      <div style={{ fontSize: 11, opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>
        {tiles.length} left
      </div>
    </div>
  );
}

function WallRow({
  tiles,
  onDrawNext,
}: {
  tiles: readonly MTile[];
  onDrawNext?: (() => void) | undefined;
}) {
  return (
    <div style={{ display: 'flex', gap: 1 }}>
      {tiles.map((t, i) => {
        const isNextDraw = i === 0 && onDrawNext !== undefined;
        if (isNextDraw) {
          return (
            <div key={tileId(t)} style={{ position: 'relative', display: 'inline-block' }}>
              <motion.div
                animate={PULSE_HALO_ANIMATE}
                transition={PULSE_TRANSITION}
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  inset: 0,
                  borderRadius: 6,
                  background: '#f3c54a',
                  pointerEvents: 'none',
                }}
              />
              <Tile tile={t} faceDown onClick={onDrawNext} testId="wall-draw-next" />
            </div>
          );
        }
        return <Tile key={tileId(t)} tile={t} faceDown />;
      })}
    </div>
  );
}
