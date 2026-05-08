import { type Tile as MTile, type Seat, tileId } from '@mahjong/game-logic';
import { Animated, Pressable, Text, View } from 'react-native';
import { Tile } from '../Tile';
import { PULSE_TEMPO, usePulse } from '../animations';
import type { WallSlot } from './wallLayout';

/**
 * Visual wall edge for one seat. Renders the seat's still-undrawn
 * stacks as a single row of 17, where each stack reads as a vertical
 * tower of 1–2 tiles via a faux-3D treatment: a flat blue top face +
 * a cream side-face strip on the felt-facing edge whose thickness
 * encodes how tall the stack still is. This is the trick for "make a
 * top-down 2D view feel slightly 3D" — pin a side-face sliver to the
 * inner edge so the wall reads as rising up out of the felt instead
 * of laying flat as a 17×2 grid of abutted tile-backs.
 *
 *   - Full stack (`tiles: 2`)  → top face + tall side-face strip
 *     (`SIDE_FULL`) with a midpoint seam suggesting the join between
 *     the two physically-stacked tiles.
 *   - Half stack (`tiles: 1`)  → top face + half-thickness strip
 *     (`SIDE_HALF`), no seam — the upper tile has been drawn so the
 *     stack now stands one tile high.
 *   - Next-to-draw (`isNextDraw`) — same composition, wrapped in a
 *     pulse halo. An invisible FlipBag-tracked `Tile` sits on the
 *     top face so the wall→hand FLIP origin matches the visible top
 *     of the stack.
 *
 * Both 1- and 2-tile stacks share the same X/Y footprint on the felt
 * (cells reserve `tileH + SIDE_FULL` perpendicular extent and align on
 * the OUTER edge); only the side-face thickness changes. That mirrors
 * the physics of a real wall, where a half-drawn stack stays in place
 * but is shorter.
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
  /** Which edge of each stack faces the felt centre. The side-face
   *  strip pins to this edge so the wall reads as having visible
   *  vertical height from the centre's perspective. */
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
  // Cream/bone tone for the side face — matches the natural side of
  // an unfinished mahjong tile. Slightly desaturated so it reads as a
  // vertical face in indirect light vs. the blue top face in direct
  // light.
  sideFace: '#d6c290',
  sideEdge: '#8a6e3c',
  sideSeam: 'rgba(40,30,15,0.4)',
  drawHalo: '#dc9f4f',
  countBg: 'rgba(0,0,0,0.35)',
  countFg: 'rgba(255,255,255,0.85)',
};

/** Side-face strip thickness for a full 2-tile stack. */
const SIDE_FULL = 6;
/** Side-face strip thickness for a half-drawn 1-tile stack. */
const SIDE_HALF = 3;

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
  /** Layout direction for the inner stack composition. 'column' for
   *  top/bottom walls (top face above side face); 'row' for left/right
   *  walls (top face beside side face). */
  stackDir: 'row' | 'column';
  /** Which edge of the cell is "inner" (faces the felt centre). The
   *  side face pins to this edge so the wall reads as standing up
   *  off the felt with its felt-facing vertical face visible. */
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
  const isEmpty = slot.tiles === 0;
  const isFull = slot.tiles === 2;
  const sideExtent = isFull ? SIDE_FULL : SIDE_HALF;

  // Cell reserves the FULL side-face thickness so 1- and 2-tile stacks
  // share an outer baseline — their footprints on the felt are
  // identical, only the visible "height" differs. The leftover gap on
  // half-drawn stacks pads against the felt-centre side, so the
  // visible top face stays anchored to the OUTER edge of the wall.
  //
  // The side face extends the cell along the stack-perpendicular axis:
  // for `column` stacks (top/bottom walls) that's the cell's HEIGHT
  // (top face's long axis = `tileH`); for `row` stacks (left/right
  // walls, top face is rotated 90°) that's the cell's WIDTH (top
  // face's long axis = `tileW`). Using the wrong axis sized the
  // vertical-wall cells too narrow, so the side face overflowed past
  // the cell edge and got hidden under the felt centre square.
  const cellExtent = (stackDir === 'column' ? tileH : tileW) + SIDE_FULL;
  const containerStyle =
    stackDir === 'column'
      ? { width: tileW, height: cellExtent }
      : { width: cellExtent, height: tileH };

  // Drawn / dead-wall slots render as a fixed-size transparent
  // placeholder so the still-visible stacks keep their original
  // positions on the felt — the wall doesn't shrink and recenter as
  // tiles get pulled, matching the physical reality that drawn tiles
  // leave behind a vacant slot rather than scooting the row inward.
  if (isEmpty) {
    return <View style={containerStyle} />;
  }

  // Element order is always [top face, side face]; flexDirection flips
  // when the inner edge is at the START of the cell so the side face
  // still ends up on the felt-facing side.
  const flexDirection: 'row' | 'row-reverse' | 'column' | 'column-reverse' =
    stackDir === 'column'
      ? innerEdge === 'end'
        ? 'column'
        : 'column-reverse'
      : innerEdge === 'end'
        ? 'row'
        : 'row-reverse';

  // Half-stack: pad the leftover space on the inner side so the top
  // face stays at the outer edge.
  const innerPad = SIDE_FULL - sideExtent;
  const innerPadStyle =
    innerPad > 0
      ? stackDir === 'column'
        ? { width: tileW, height: innerPad }
        : { width: innerPad, height: tileH }
      : null;

  // `Tile`'s SVG locks to a 36×50 portrait viewBox; on row-stack walls
  // (left/right seats) the landscape top face needs the FLIP-source
  // Tile rotated 90° so its rect matches the visible top of the stack.
  const landscape = stackDir === 'row';

  if (slot.isNextDraw && nextDrawTile) {
    return (
      <Pressable
        onPress={onPress}
        testID={enableDrawTestId ? 'wall-draw-next' : undefined}
        style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
      >
        <PulseHalo width={containerStyle.width} height={containerStyle.height}>
          <View style={{ ...containerStyle, flexDirection }}>
            <View style={{ width: tileW, height: tileH }}>
              <TopFace width={tileW} height={tileH} />
              <View
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: tileW,
                  height: tileH,
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: 0,
                  pointerEvents: 'none',
                }}
              >
                <View style={landscape ? { transform: [{ rotate: '90deg' }] } : undefined}>
                  <Tile
                    tile={nextDrawTile}
                    flipId={`tile-${tileId(nextDrawTile)}`}
                    faceDown
                    width={landscape ? tileH : tileW}
                    height={landscape ? tileW : tileH}
                  />
                </View>
              </View>
            </View>
            <SideFace
              stackDir={stackDir}
              extent={sideExtent}
              long={tileLong(stackDir, tileW, tileH)}
              isFull={isFull}
            />
            {innerPadStyle ? <View style={innerPadStyle} /> : null}
          </View>
        </PulseHalo>
      </Pressable>
    );
  }

  return (
    <View style={{ ...containerStyle, flexDirection }}>
      <TopFace width={tileW} height={tileH} />
      <SideFace
        stackDir={stackDir}
        extent={sideExtent}
        long={tileLong(stackDir, tileW, tileH)}
        isFull={isFull}
      />
      {innerPadStyle ? <View style={innerPadStyle} /> : null}
    </View>
  );
}

/** Long-axis length of the side-face strip — perpendicular to the
 *  stack direction. For column stacks the strip runs across the
 *  tile width; for row stacks it runs across the tile height. */
function tileLong(stackDir: 'row' | 'column', tileW: number, tileH: number): number {
  return stackDir === 'column' ? tileW : tileH;
}

/**
 * Pulse halo wrapper for the next-draw stack — gold border + scale +
 * opacity loop using RN core `Animated`. Border + fill are both
 * absolute-positioned so the halo doesn't add to the wrapper's layout
 * box; the fixed-size cell would otherwise overflow into adjacent
 * cells when the stack fills it.
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
    <View>
      <View
        style={{
          position: 'absolute',
          top: -1.5,
          left: -1.5,
          right: -1.5,
          bottom: -1.5,
          borderRadius: 4,
          borderWidth: 1.5,
          borderColor: COLORS.drawHalo,
          pointerEvents: 'none',
        }}
      />
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

/**
 * Top face — the blue mahjong-back rectangle, the visible "lid" of
 * the stack as seen from above.
 */
function TopFace({ width, height }: { width: number; height: number }) {
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
    />
  );
}

interface SideFaceProps {
  /** Layout direction of the cell. 'column' = top face above, side face
   *  below (top/bottom walls); 'row' = top face left, side face right
   *  (left/right walls). */
  stackDir: 'row' | 'column';
  /** Strip thickness along the stack-perpendicular axis — encodes how
   *  tall the stack still is (full vs half). */
  extent: number;
  /** Strip length along the stack-perpendicular axis (tile width for
   *  column stacks, tile height for row stacks). */
  long: number;
  /** True for full 2-tile stacks — adds a hairline at the strip's
   *  midpoint suggesting the join between the two stacked tiles. */
  isFull: boolean;
}

/**
 * Side face — the cream/bone strip pinned to the felt-facing edge of
 * the stack, suggesting the stack's vertical height as seen from a
 * slightly-tilted top-down camera. For full 2-tile stacks, a midpoint
 * seam reads as the join between the two physically-stacked tiles.
 */
function SideFace({ stackDir, extent, long, isFull }: SideFaceProps) {
  const width = stackDir === 'column' ? long : extent;
  const height = stackDir === 'column' ? extent : long;
  const seamStyle =
    stackDir === 'column'
      ? ({ position: 'absolute', left: 0, right: 0, top: '50%', height: 0.5 } as const)
      : ({ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 0.5 } as const);
  return (
    <View
      style={{
        width,
        height,
        backgroundColor: COLORS.sideFace,
        borderColor: COLORS.sideEdge,
        borderWidth: 0.5,
      }}
    >
      {isFull ? <View style={{ ...seamStyle, backgroundColor: COLORS.sideSeam }} /> : null}
    </View>
  );
}
