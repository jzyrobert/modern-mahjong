import { type Tile as MTile, tileId } from '@mahjong/game-logic';
import { motion } from 'framer-motion';
import { Tile } from './Tile.js';

interface WallProps {
  /** This seat's slice of the live wall, in engine draw order. `tiles[0]` is the next to draw. */
  tiles: readonly MTile[];
  /** When set, the next tile pulses + becomes clickable. */
  onDrawNext?: (() => void) | undefined;
  /** 1 = single row (seat-side walls); 2 = stacked (the player's own wall). Default 2. */
  rows?: 1 | 2;
  /**
   * Cap on how many face-down tiles we render. The full wall can be 80+ tiles
   * — laying every one out would blow past the viewport on phones.
   */
  visibleTiles?: number;
  /** Whether to render the "N left" count badge. Default true. */
  showCount?: boolean;
}

const DEFAULT_VISIBLE_TILES = 16;
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

const WALL_TILE_VARS = {
  // Walls render with smaller tiles than hands — ~half-scale, so 16 face-down
  // tiles fit even on a landscape phone.
  ['--tile-w' as string]: 'max(16px, 2.6vmin)',
  ['--tile-h' as string]: 'max(22px, 3.6vmin)',
};

/**
 * Visible wall component. Rendered four times around the table — one per
 * seat, displaying that seat's slice of the live wall (`state.wall`
 * distributed by index modulo 4 so the dealer's slice is `[0,4,8,...]`,
 * which keeps draw order stable).
 *
 * Each face-down tile is a real `Tile` (with the engine's `tileId`-based
 * `layoutId`), so when a tile leaves the wall to a player's hand
 * framer-motion animates the transition for free.
 *
 * The full mechanical shuffle/dispense between hands (tiles flowing into
 * the center pile and back out into the new walls) still wants a
 * state-machine pause between hands — see TODO.md.
 */
export function Wall({
  tiles,
  onDrawNext,
  rows = 2,
  visibleTiles = DEFAULT_VISIBLE_TILES,
  showCount = true,
}: WallProps) {
  if (tiles.length === 0) {
    return <div style={{ fontSize: 11, opacity: 0.6 }}>Wall empty</div>;
  }
  const visible = tiles.slice(0, visibleTiles);
  if (rows === 1) {
    return (
      <div
        style={{
          ...WALL_TILE_VARS,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <WallRow tiles={visible} onDrawNext={onDrawNext} />
        {showCount && <CountBadge count={tiles.length} />}
      </div>
    );
  }
  const half = Math.ceil(visible.length / 2);
  const top = visible.slice(0, half);
  const bottom = visible.slice(half);
  return (
    <div
      style={{
        ...WALL_TILE_VARS,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <WallRow tiles={top} onDrawNext={onDrawNext} />
      {bottom.length > 0 && <WallRow tiles={bottom} />}
      {showCount && <CountBadge count={tiles.length} />}
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

function CountBadge({ count }: { count: number }) {
  return (
    <span style={{ fontSize: 11, opacity: 0.7, fontVariantNumeric: 'tabular-nums' }}>
      {count} left
    </span>
  );
}
