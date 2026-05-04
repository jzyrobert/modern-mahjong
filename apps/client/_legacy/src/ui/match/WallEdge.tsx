import type { Tile as MTile, Seat } from '@mahjong/game-logic';
import { motion } from 'framer-motion';
import { Tile } from '../Tile.js';

/**
 * Visual wall edge for one seat. Renders the seat's physical wall as 17
 * stacks (real Hong Kong mahjong has 4 walls × 17 stacks × 2 tiles = 136
 * tiles total). Each stack is drawn as a 2-tile-tall pillbox; status
 * comes from the dice break and the engine's draw progress:
 *
 *   - `live`  — face-down, drawable (full 2-tile stack)
 *   - `dead`  — face-down, dimmed (kong replacements; never drawn except
 *               on a kong declaration)
 *   - `drawn` — empty (both tiles already left this stack on their way
 *               to a hand)
 *
 * The slot whose status is `nextDraw` gets the existing pulse halo +
 * the engine's actual next-to-draw `Tile` rendered as the **top** of
 * the stack (the order tiles are physically taken). All other slots
 * are placeholder face-down rectangles — sufficient since the player
 * can't tell tile faces from the back anyway.
 *
 * The break direction wraps onto the next wall (counter-clockwise) when
 * the count exceeds the current wall — see `wallLayout.ts`.
 */

export type SlotStatus = 'live' | 'dead' | 'drawn' | 'nextDraw';

interface WallEdgeProps {
  /** 17-element status map for this seat's wall, slot 0 = leftmost. */
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

// Wall tiles match the opponent hand sizing (`max(16px, 2.6vmin)` × `max(22px, 3.6vmin)`)
// so the four walls and the face-down opponent hands look consistent.
// `WALL_LENGTH` / `WALL_THICKNESS` in `Table.tsx` must stay in sync.
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
      <div style={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
        {ordered.map((status, i) => (
          <SlotCell
            // biome-ignore lint/suspicious/noArrayIndexKey: slot positions are fixed (17 stacks per seat); index IS the canonical identity here
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

const STACK_STYLE: React.CSSProperties = {
  display: 'inline-flex',
  flexDirection: 'column',
  gap: 1,
};

function SlotCell({ status, nextDrawTile, onClick, enableDrawTestId }: SlotCellProps) {
  if (status === 'drawn') {
    // Empty 2-tile-tall span keeps row geometry stable so live stacks
    // don't reflow as more are drawn.
    return (
      <span
        aria-hidden
        style={{
          width: 'var(--tile-w, 16px)',
          height: 'calc(2 * var(--tile-h, 22px) + 1px)',
          display: 'inline-block',
        }}
      />
    );
  }

  if (status === 'nextDraw' && nextDrawTile) {
    // Top of the stack is the next tile that physically gets taken; the
    // bottom remains a placeholder until the next draw.
    return (
      <span style={STACK_STYLE}>
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
        <PlaceholderBack status="live" />
      </span>
    );
  }

  // live or dead — render as a 2-tile-tall placeholder stack. Dead wall
  // uses dim opacity so the player can read the boundary.
  return (
    <span style={STACK_STYLE}>
      <PlaceholderBack status={status} />
      <PlaceholderBack status={status} />
    </span>
  );
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
