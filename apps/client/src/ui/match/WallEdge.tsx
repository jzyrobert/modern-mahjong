import type { Tile as MTile, Seat } from '@mahjong/game-logic';
import { motion } from 'framer-motion';
import { Tile } from '../Tile.js';

/**
 * Visual wall edge for one seat. Renders the seat's physical 36-tile
 * wall (real Hong Kong mahjong has 4 walls × 18 stacks × 2 tiles = 144
 * tiles total — we show one row of 36 per seat) with regions classified
 * by the dice break and the engine's draw progress:
 *
 *   - `live`  — face-down, drawable
 *   - `dead`  — face-down, dimmed (kong replacements; never drawn except
 *                on a kong declaration)
 *   - `drawn` — empty (the tile already left this slot on its way to a
 *                hand)
 *
 * The slot whose status is `nextDraw` gets the existing pulse halo +
 * the engine's actual next-to-draw `Tile` (so the wall→hand layoutId
 * animation still works for that one slot). All other slots are
 * placeholder face-down rectangles — sufficient since the player can't
 * tell tile faces from the back anyway.
 *
 * The break direction wraps onto the next wall (counter-clockwise) when
 * the count exceeds the current wall — see `Table.tsx`'s dice helpers.
 */

export type SlotStatus = 'live' | 'dead' | 'drawn' | 'nextDraw';

interface WallEdgeProps {
  /** 36-element status map for this seat's wall, slot 0 = leftmost. */
  slots: readonly SlotStatus[];
  /** Engine `Tile` for the next-to-draw slot, used as the FLIP source. */
  nextDrawTile?: MTile | null | undefined;
  /** Click handler when the next-to-draw slot is on this seat's wall. */
  onDrawNext?: (() => void) | undefined;
  /** Hide the count badge entirely (used for opponents). */
  showCount?: boolean | undefined;
  /** Total live remaining tiles for the count badge. */
  liveCount: number;
  /** Reverse the slot rendering order — used so left/right walls draw in the same physical direction after rotation. */
  reverse?: boolean | undefined;
  /** Test harness signal for the click target — proxies to the existing `wall-draw-next` testId. */
  enableDrawTestId?: boolean | undefined;
  /** Visual seat key — drives the absolute key for animations. */
  seatKey: Seat;
}

const PULSE_HALO_ANIMATE = {
  scale: [1, 1.18, 1],
  opacity: [0.6, 0, 0.6],
};
const PULSE_TRANSITION = {
  duration: 1.4,
  repeat: Number.POSITIVE_INFINITY,
  ease: 'easeInOut',
} as const;

const WALL_TILE_VARS: React.CSSProperties = {
  ['--tile-w' as string]: 'max(16px, 2.6vmin)',
  ['--tile-h' as string]: 'max(22px, 3.6vmin)',
};

export function WallEdge({
  slots,
  nextDrawTile,
  onDrawNext,
  showCount = true,
  liveCount,
  reverse = false,
  enableDrawTestId,
  seatKey,
}: WallEdgeProps) {
  const ordered = reverse ? [...slots].reverse() : slots;
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
      <div style={{ display: 'flex', gap: 1 }}>
        {ordered.map((status, i) => (
          <SlotCell
            // biome-ignore lint/suspicious/noArrayIndexKey: slot positions are fixed (36 slots per seat); index IS the canonical identity here
            key={`${seatKey}-${i}`}
            status={status}
            nextDrawTile={status === 'nextDraw' ? (nextDrawTile ?? null) : null}
            onClick={status === 'nextDraw' ? onDrawNext : undefined}
            enableDrawTestId={enableDrawTestId && status === 'nextDraw'}
          />
        ))}
      </div>
      {showCount ? (
        <span
          style={{
            fontSize: 11,
            opacity: 0.7,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {liveCount} left
        </span>
      ) : null}
    </div>
  );
}

interface SlotCellProps {
  status: SlotStatus;
  nextDrawTile: MTile | null;
  onClick?: (() => void) | undefined;
  enableDrawTestId?: boolean | undefined;
}

function SlotCell({ status, nextDrawTile, onClick, enableDrawTestId }: SlotCellProps) {
  if (status === 'drawn') {
    // Empty space — keeps the wall length consistent so subsequent
    // live tiles don't reflow when more are drawn.
    return (
      <span
        aria-hidden
        style={{
          width: 'var(--tile-w, 16px)',
          height: 'var(--tile-h, 22px)',
          display: 'inline-block',
        }}
      />
    );
  }

  if (status === 'nextDraw' && nextDrawTile) {
    return (
      <span style={{ position: 'relative', display: 'inline-block' }}>
        <motion.span
          aria-hidden="true"
          animate={PULSE_HALO_ANIMATE}
          transition={PULSE_TRANSITION}
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: 6,
            background: '#f3c54a',
            pointerEvents: 'none',
          }}
        />
        <Tile
          tile={nextDrawTile}
          faceDown
          onClick={onClick}
          testId={enableDrawTestId ? 'wall-draw-next' : undefined}
        />
      </span>
    );
  }

  // live or dead — placeholder face-down rectangle. We render a real
  // Tile for live so the back gradient skins still apply uniformly.
  // Dead wall uses dim opacity so the player can read the boundary.
  return <PlaceholderBack status={status} />;
}

function PlaceholderBack({ status }: { status: SlotStatus }) {
  const dim = status === 'dead';
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 'var(--tile-w, 16px)',
        height: 'var(--tile-h, 22px)',
        borderRadius: 4,
        background:
          'linear-gradient(180deg, var(--tile-back-1, oklch(0.72 0.08 200)), var(--tile-back-2, oklch(0.62 0.09 210)))',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.25), inset 0 -1px 0 rgba(0,0,0,0.2)',
        border: '0.5px solid oklch(0.45 0.06 215 / 0.6)',
        opacity: dim ? 0.45 : 1,
      }}
    />
  );
}
