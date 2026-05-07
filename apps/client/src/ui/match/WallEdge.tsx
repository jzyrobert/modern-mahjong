import { type Tile as MTile, type Seat, tileId } from '@mahjong/game-logic';
import type { ReactNode } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import { Tile } from '../Tile';
import { PULSE_TEMPO, usePulse } from '../animations';
import type { WallSlot } from './wallLayout';

/**
 * Visual wall edge for one seat. Renders the seat's still-undrawn
 * stacks as a single row of tile-backs whose perpendicular extent
 * encodes how many tiles each stack still holds — matching how a real
 * Hong Kong wall (17 stacks × 2 tiles per side) reads from the
 * player's seat, not as two separate rows of tiles but as one row of
 * variable-height stacks receding into the table as draws happen.
 *
 *   - Full stack (`tiles: 2`)  → tile-back at full 2-tile depth, with
 *     a faint seam hairline at the midpoint so the "two physical
 *     tiles abutting" reading isn't lost.
 *   - Half stack (`tiles: 1`)  → tile-back at one-tile depth, pinned
 *     to the inner edge (closer to the felt centre) — so the wall
 *     visibly recedes as the outer tiles get drawn.
 *   - Next-to-draw (`isNextDraw`) — the inner-half slot renders the
 *     engine's real next `Tile` (face-down) so the wall→hand FLIP
 *     via `FlipBag` has a real tile object to track. A pulse halo
 *     signals "your draw."
 *
 * The dead wall is not rendered separately — it's part of the
 * engine's state but never visible at a real table.
 */

interface WallEdgeProps {
  /** Visible stacks for this seat — already filtered to undrawn ones. */
  slots: readonly WallSlot[];
  /** Engine `Tile` for the next-to-draw stack, used as the FLIP source. */
  nextDrawTile?: MTile | null | undefined;
  /** Click handler when the next-to-draw slot is on this seat's wall. */
  onDrawNext?: (() => void) | undefined;
  /** Render order: when true, slot 0 stays visually rightmost. Used for
   *  the right-side wall so the break math reads consistently across
   *  seats once the column is rotated. */
  reverse?: boolean | undefined;
  /** Stack orientation — horizontal row (top/bottom seats) or vertical
   *  column (left/right seats). The pillbox direction flips to match. */
  orient: 'row' | 'column';
  /** Which edge of each stack faces the felt centre. Half-drawn stacks
   *  collapse against this edge so the wall reads as receding from the
   *  middle, matching a physical 2-high row where the top tile is gone
   *  but the bottom (closer to the centre) remains. */
  innerEdge: 'start' | 'end';
  /** Tile width. Defaults to 14 — matches OppHandStrip face-down tiles. */
  tileW?: number;
  /** Tile height. Defaults to 20. */
  tileH?: number;
  /** Live tiles still in the wall. Renders a small badge on the user's
   *  wall when set; opponent walls pass undefined to hide it. */
  liveCount?: number | undefined;
  /** Test harness signal for the click target. Proxies to the existing
   *  `wall-draw-next` testID so the existing solo-match e2e keeps
   *  working. */
  enableDrawTestId?: boolean | undefined;
  seatKey: Seat;
}

const COLORS = {
  back1: '#7fa9c1',
  back2: '#5a8cb0',
  backEdge: 'rgba(50,80,100,0.6)',
  drawHalo: '#dc9f4f',
  countBg: 'rgba(0,0,0,0.35)',
  countFg: 'rgba(255,255,255,0.85)',
};

export function WallEdge({
  slots,
  nextDrawTile,
  onDrawNext,
  reverse = false,
  orient,
  innerEdge,
  tileW = 14,
  tileH = 20,
  liveCount,
  enableDrawTestId,
  seatKey,
}: WallEdgeProps) {
  const ordered = reverse ? [...slots].reverse() : slots;
  const stackDir = orient === 'row' ? 'column' : 'row';
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <View style={{ flexDirection: orient, gap: 1 }}>
        {ordered.map((slot, i) => (
          <SlotCell
            // biome-ignore lint/suspicious/noArrayIndexKey: order-stable per seat
            key={`${seatKey}-${i}`}
            slot={slot}
            stackDir={stackDir}
            innerEdge={innerEdge}
            tileW={tileW}
            tileH={tileH}
            nextDrawTile={slot.isNextDraw ? (nextDrawTile ?? null) : null}
            onPress={slot.isNextDraw ? onDrawNext : undefined}
            enableDrawTestId={enableDrawTestId === true && slot.isNextDraw}
          />
        ))}
      </View>
      {liveCount !== undefined ? (
        <View
          style={{
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderRadius: 8,
            backgroundColor: COLORS.countBg,
          }}
        >
          <Text style={{ color: COLORS.countFg, fontSize: 10, fontWeight: '700' }}>
            {liveCount} left
          </Text>
        </View>
      ) : null}
    </View>
  );
}

interface SlotCellProps {
  slot: WallSlot;
  /** Layout direction for the inner pillbox. 'row' = stacked horizontally
   *  (used when the wall row is vertical); 'column' = stacked vertically
   *  (used when the wall row is horizontal). */
  stackDir: 'row' | 'column';
  /** Which edge of the cell is "inner" (faces the felt centre). Half-
   *  drawn stacks render their single tile against this edge, so a
   *  phys-mahjong-style "the top one is gone" reads correctly. */
  innerEdge: 'start' | 'end';
  tileW: number;
  tileH: number;
  nextDrawTile: MTile | null;
  onPress?: (() => void) | undefined;
  enableDrawTestId: boolean;
}

function SlotCell({
  slot,
  stackDir,
  innerEdge,
  tileW,
  tileH,
  nextDrawTile,
  onPress,
  enableDrawTestId,
}: SlotCellProps) {
  // Cell reserves the full 2-tile depth so wall stacks of varying height
  // share a common outer baseline — matching a physical 17×2 row that
  // recedes from the outer edge inward as tiles are drawn.
  const containerStyle =
    stackDir === 'column'
      ? { width: tileW, height: tileH * 2 + 1 }
      : { width: tileW * 2 + 1, height: tileH };
  const justifyContent = innerEdge === 'end' ? ('flex-end' as const) : ('flex-start' as const);
  // Stack rectangle's perpendicular extent — full cell for a 2-tile
  // stack (the side of two physical tiles), half for a half-drawn one.
  const stackPerp = slot.tiles === 2 ? tileH * 2 + 1 : tileH;
  const stackBackW = stackDir === 'column' ? tileW : stackPerp;
  const stackBackH = stackDir === 'column' ? stackPerp : tileH;

  if (slot.isNextDraw && nextDrawTile) {
    // Two children for the next-draw cell: a static outer-half back
    // (only when the stack is full) and the FlipBag-tracked Tile +
    // pulse halo at the inner half. The Tile must stay at one-tile
    // dimensions so the wall→hand FLIP animation lands at the right
    // hand-tile size.
    const tiles: ReactNode[] = [];
    if (slot.tiles === 2) {
      tiles.push(
        <StackBack key="outer" width={tileW} height={tileH} doubled={false} stackDir={stackDir} />,
      );
    }
    tiles.push(
      <Pressable
        key="inner"
        onPress={onPress}
        testID={enableDrawTestId ? 'wall-draw-next' : undefined}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      >
        <PulseHalo width={tileW} height={tileH}>
          <Tile
            tile={nextDrawTile}
            flipId={`tile-${tileId(nextDrawTile)}`}
            faceDown
            width={tileW}
            height={tileH}
          />
        </PulseHalo>
      </Pressable>,
    );
    const ordered = innerEdge === 'end' ? tiles : [...tiles].reverse();
    return (
      <View
        style={{
          ...containerStyle,
          flexDirection: stackDir,
          justifyContent,
          gap: 1,
        }}
      >
        {ordered}
      </View>
    );
  }

  // Static stack — one rectangle pinned to the inner edge, depth
  // varying with the tile count. A subtle seam line at the midpoint
  // of 2-tile stacks reads as the join between the two physical
  // tiles without forking the wall into a second visual row.
  return (
    <View
      style={{
        ...containerStyle,
        flexDirection: stackDir,
        justifyContent,
      }}
    >
      <StackBack
        width={stackBackW}
        height={stackBackH}
        doubled={slot.tiles === 2}
        stackDir={stackDir}
      />
    </View>
  );
}

/**
 * Pulse halo wrapper for the next-draw stack — gold border + scale +
 * opacity loop using RN core `Animated`. Replaces the framer-motion
 * `motion.span animate={PULSE_HALO_ANIMATE}` from the legacy build.
 * Compositor-only properties (transform + opacity), `useNativeDriver`
 * so the JS thread stays free during animation.
 */
function PulseHalo({
  width,
  height,
  children,
}: { width: number; height: number; children: React.ReactNode }) {
  const t = usePulse({ durationMs: PULSE_TEMPO.urgent });
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] });
  return (
    <View
      style={{
        borderRadius: 4,
        borderWidth: 1.5,
        borderColor: COLORS.drawHalo,
      }}
    >
      <Animated.View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width,
          height,
          borderRadius: 4,
          backgroundColor: COLORS.drawHalo,
          opacity,
          transform: [{ scale }],
          pointerEvents: 'none',
        }}
      />
      {children}
    </View>
  );
}

interface StackBackProps {
  width: number;
  height: number;
  /** True for full 2-tile stacks — adds a faint seam hairline through
   *  the middle perpendicular to the stack height, suggesting two
   *  physical tiles abutting without splitting the wall into two
   *  visual rows. */
  doubled: boolean;
  /** Stack height direction — drives seam orientation. 'column' stacks
   *  rise vertically (top/bottom walls), so the seam runs horizontally;
   *  'row' stacks extend horizontally (left/right walls), seam runs
   *  vertically. */
  stackDir: 'row' | 'column';
}

/**
 * One wall stack rendered as a single tile-back rectangle. Sized by
 * the caller to either one-tile depth (half-drawn) or two-tile depth
 * (full); `doubled` overlays a hairline at the midpoint so a 2-tile
 * stack is distinguishable from a really-tall 1-tile stack at a
 * glance — without rendering as two separate tile-backs (which read
 * as a second wall row).
 */
function StackBack({ width, height, doubled, stackDir }: StackBackProps) {
  return (
    <View
      style={{
        width,
        height,
        borderRadius: 3,
        backgroundColor: COLORS.back1,
        borderColor: COLORS.backEdge,
        borderWidth: 0.5,
      }}
    >
      {doubled ? (
        <View
          style={
            stackDir === 'column'
              ? {
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: '50%',
                  height: 1,
                  backgroundColor: 'rgba(0,0,0,0.22)',
                }
              : {
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: '50%',
                  width: 1,
                  backgroundColor: 'rgba(0,0,0,0.22)',
                }
          }
        />
      ) : null}
    </View>
  );
}
