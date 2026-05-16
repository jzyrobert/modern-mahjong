import { type Tile as MTile, type Seat, tileId } from '@mahjong/game-logic';
import { useCallback, useEffect, useRef } from 'react';
import { Animated, Easing, type LayoutChangeEvent, Pressable, Text, View } from 'react-native';
import { useGame } from '../../state/game';
import { Tile } from '../Tile';
import { PULSE_TEMPO, usePulse } from '../animations';
import type { Position } from './seatColor';
import { TILE_BACK_SKINS } from './skins';
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
  // Cream/bone tone for the side face — matches the natural side of
  // an unfinished mahjong tile. Slightly desaturated so it reads as a
  // vertical face in indirect light vs. the top face in direct light.
  // Independent of the tile-back skin: a real mahjong tile's side is
  // always the same cream regardless of which back skin's painted on
  // the top face.
  sideFace: '#d6c290',
  sideEdge: '#8a6e3c',
  sideSeam: 'rgba(40,30,15,0.4)',
  drawHalo: '#dc9f4f',
  countBg: 'rgba(0,0,0,0.35)',
  countFg: 'rgba(255,255,255,0.85)',
  // Bevel bands — pinned 1–1.5 px strips that sell the rounded lid
  // edge catching light + the recessed far edge in shadow. Same idea
  // as the NE-light bevel on the in-hand tiles (`Tile.tsx`), so the
  // wall composes with a single committed light direction.
  backLid: 'rgba(255,255,255,0.20)',
  backFar: 'rgba(0,0,0,0.18)',
  sideTop: 'rgba(255,255,255,0.16)',
  sideBottom: 'rgba(0,0,0,0.20)',
  // Neutral darker border for the top face — derived once per render
  // from the active tile-back skin's bottom stop so the silhouette
  // outline tracks the user's chosen back colour.
  topBorder: 'rgba(0,0,0,0.28)',
};

/** Side-face strip thickness for a full 2-tile stack — sized so the
 *  towers read as two tiles tall, not as a thin seam on an
 *  otherwise-flat lid. */
const SIDE_FULL = 10;
/** Side-face strip thickness for a half-drawn 1-tile stack — half the
 *  full thickness so half-drawn stacks are clearly shorter. */
const SIDE_HALF = 5;

function oppositeOf(s: Position): Position {
  return s === 'top' ? 'bottom' : s === 'bottom' ? 'top' : s === 'left' ? 'right' : 'left';
}

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
  // Single subscription per wall so the lid surface tracks the user's
  // tile-back skin. Threaded down to each `SlotCell` → `TopFace` (and
  // `NextDrawSlot`'s `TopFace`) as a prop, so the 17 leaves don't each
  // re-subscribe to the store.
  const tileBackId = useGame((s) => s.settings.tileBack);
  const backSurface = TILE_BACK_SKINS[tileBackId].top;
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <View
        style={{
          flexDirection: orient,
          gap: 1,
          // Soft drop-shadow under the whole wall so it reads as
          // sitting on the felt, not painted into it. Per-stack shadow
          // would compound across 17 cells; one wrapper shadow is
          // cheaper and visually equivalent.
          boxShadow: '0px 3px 6px rgba(0,0,0,0.22)',
        }}
      >
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
            backSurface={backSurface}
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
  /** Lid surface colour — the top stop of the user's tile-back skin.
   *  Threaded down from `WallEdge` so all 17 cells share a single
   *  store subscription. */
  backSurface: string;
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
  backSurface,
}: SlotCellProps) {
  const isEmpty = slot.tiles === 0;
  const isFull = slot.tiles === 2;

  // Animated "halfness": 0 = full 2-tile stack, 1 = half 1-tile stack.
  // Drives three things in lockstep when the engine reports the top
  // tile as drawn:
  //   - `outerPad` grows from 0 → (SIDE_FULL - SIDE_HALF), pushing the
  //     lid inward so it sits at the z=1 projection (matches a real
  //     shorter stack).
  //   - `SideFace` extent shrinks from SIDE_FULL → SIDE_HALF, so the
  //     visible front face represents only the bottom tile.
  //   - The midpoint seam fades out (no longer a join between two
  //     stacked tiles when only one remains).
  // Initial value mirrors current state so a slot mounting straight
  // into a half-drawn position (e.g. mid-hand reload) doesn't fire a
  // visible entrance animation.
  const halfProgress = useRef(new Animated.Value(isFull ? 0 : 1)).current;
  useEffect(() => {
    if (isEmpty) return;
    // Layout properties (width/height) can't run on the native driver,
    // so the timing runs on JS. Only one stack animates at a time in
    // practice (the next-to-draw stack as a tile is pulled), so the
    // JS-thread cost is negligible.
    const anim = Animated.timing(halfProgress, {
      toValue: isFull ? 0 : 1,
      duration: 280,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [isFull, isEmpty, halfProgress]);

  // Cell reserves the FULL side-face thickness so 1- and 2-tile stacks
  // share an outer baseline — their footprints on the felt are
  // identical, only the visible "height" differs. The leftover gap on
  // half-drawn stacks pads against the OUTER side of the wall (the
  // physical "missing top tile" position), so the lid drops inward to
  // the z=1 projection as the top tile is drawn.
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

  // Element order is always [outer pad, top face, side face];
  // flexDirection flips when the inner edge is at the START of the
  // cell so the side face still ends up on the felt-facing side.
  const flexDirection: 'row' | 'row-reverse' | 'column' | 'column-reverse' =
    stackDir === 'column'
      ? innerEdge === 'end'
        ? 'column'
        : 'column-reverse'
      : innerEdge === 'end'
        ? 'row'
        : 'row-reverse';

  // outerPad grows from 0 (full) to (SIDE_FULL - SIDE_HALF) (half) so
  // the lid drops inward as the stack depletes.
  const outerPadExtent = halfProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, SIDE_FULL - SIDE_HALF],
  });
  const sideExtentAnim = halfProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [SIDE_FULL, SIDE_HALF],
  });
  const seamOpacity = halfProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 0],
  });
  const outerPadStyle =
    stackDir === 'column'
      ? { width: tileW, height: outerPadExtent }
      : { width: outerPadExtent, height: tileH };

  // `Tile`'s SVG locks to a 36×50 portrait viewBox; on row-stack walls
  // (left/right seats) the landscape top face needs the FLIP-source
  // Tile rotated 90° so its rect matches the visible top of the stack.
  const landscape = stackDir === 'row';

  // Direction toward the felt centre, expressed as the cell-relative
  // edge that the SideFace pins to. Drives bevel band placement on
  // both `TopFace` (lighter band on this edge — the rounded lid
  // catching light from the camera at centre) and `SideFace` (dark
  // band on this edge — the strip's bottom, sitting on the felt).
  const feltEdge: Position =
    stackDir === 'column'
      ? innerEdge === 'end'
        ? 'bottom'
        : 'top'
      : innerEdge === 'end'
        ? 'right'
        : 'left';
  const lidEdge: Position = oppositeOf(feltEdge);

  if (slot.isNextDraw && nextDrawTile) {
    return (
      <NextDrawSlot
        nextDrawTile={nextDrawTile}
        containerStyle={containerStyle}
        flexDirection={flexDirection}
        outerPadStyle={outerPadStyle}
        tileW={tileW}
        tileH={tileH}
        feltEdge={feltEdge}
        lidEdge={lidEdge}
        landscape={landscape}
        stackDir={stackDir}
        sideExtentAnim={sideExtentAnim}
        seamOpacity={seamOpacity}
        onPress={onPress}
        enableDrawTestId={enableDrawTestId}
        backSurface={backSurface}
      />
    );
  }

  return (
    <View style={{ ...containerStyle, flexDirection }}>
      <Animated.View style={outerPadStyle} />
      <TopFace width={tileW} height={tileH} feltEdge={feltEdge} backSurface={backSurface} />
      <SideFace
        stackDir={stackDir}
        extent={sideExtentAnim}
        long={tileLong(stackDir, tileW, tileH)}
        seamOpacity={seamOpacity}
        lidEdge={lidEdge}
      />
    </View>
  );
}

/** Long-axis length of the side-face strip — perpendicular to the
 *  stack direction. For column stacks the strip runs across the
 *  tile width; for row stacks it runs across the tile height. */
interface NextDrawSlotProps {
  nextDrawTile: MTile;
  containerStyle: { width: number; height: number };
  flexDirection: 'row' | 'row-reverse' | 'column' | 'column-reverse';
  outerPadStyle: {
    width: number | Animated.AnimatedInterpolation<number>;
    height: number | Animated.AnimatedInterpolation<number>;
  };
  tileW: number;
  tileH: number;
  feltEdge: Position;
  lidEdge: Position;
  landscape: boolean;
  stackDir: 'row' | 'column';
  sideExtentAnim: Animated.AnimatedInterpolation<number>;
  seamOpacity: Animated.AnimatedInterpolation<number>;
  onPress: (() => void) | undefined;
  enableDrawTestId: boolean;
  backSurface: string;
}

/**
 * Next-to-draw slot — extracted from `SlotCell` so the wall→hand draw
 * animation has a single owner for publishing the wall's source rect.
 * Whenever the lid lays out, `measureInWindow` captures its viewport
 * rect and writes it (along with `landscape`, which marks left/right
 * walls where the wall tile is rendered rotated 90°) to
 * `useGame.wallSourceContext`. `flashDrawAnimation` snapshots that
 * field at the moment of the draw so `DrawTileOverlay` can rise from
 * the physical wall position even though the wall has already mutated
 * by the time the snapshot fires.
 */
function NextDrawSlot({
  nextDrawTile,
  containerStyle,
  flexDirection,
  outerPadStyle,
  tileW,
  tileH,
  feltEdge,
  lidEdge,
  landscape,
  stackDir,
  sideExtentAnim,
  seamOpacity,
  onPress,
  enableDrawTestId,
  backSurface,
}: NextDrawSlotProps) {
  const setWallSourceContext = useGame((s) => s.setWallSourceContext);
  const lidRef = useRef<View>(null);
  const onLayout = useCallback(
    (_e: LayoutChangeEvent) => {
      const node = lidRef.current;
      if (!node) return;
      node.measureInWindow((x, y, w, h) => {
        setWallSourceContext({ rect: { x, y, width: w, height: h }, landscape });
      });
    },
    [setWallSourceContext, landscape],
  );
  return (
    <Pressable
      onPress={onPress}
      testID={enableDrawTestId ? 'wall-draw-next' : undefined}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}
    >
      <PulseHalo width={containerStyle.width} height={containerStyle.height}>
        <View style={{ ...containerStyle, flexDirection }}>
          <Animated.View style={outerPadStyle} />
          <View
            ref={lidRef}
            onLayout={onLayout}
            collapsable={false}
            style={{ width: tileW, height: tileH }}
          >
            <TopFace width={tileW} height={tileH} feltEdge={feltEdge} backSurface={backSurface} />
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
            extent={sideExtentAnim}
            long={tileLong(stackDir, tileW, tileH)}
            seamOpacity={seamOpacity}
            lidEdge={lidEdge}
          />
        </View>
      </PulseHalo>
    </Pressable>
  );
}

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
 * the stack as seen from above. Two thin pinned-edge bands sell the
 * rounded edge: a 1.5px lighter band on the felt-facing edge (catches
 * light from the imaginary camera at the felt centre) and a 1px
 * darker band on the opposite edge (the lid's far side in shadow).
 */
function TopFace({
  width,
  height,
  feltEdge,
  backSurface,
}: { width: number; height: number; feltEdge: Position; backSurface: string }) {
  return (
    <View
      style={{
        width,
        height,
        borderRadius: 3,
        backgroundColor: backSurface,
        borderColor: COLORS.topBorder,
        borderWidth: 0.5,
        overflow: 'hidden',
      }}
    >
      <View style={edgeBandStyle(feltEdge, 1.5, COLORS.backLid)} />
      <View style={edgeBandStyle(oppositeOf(feltEdge), 1, COLORS.backFar)} />
    </View>
  );
}

/** Absolute-positioned strip pinned to one edge of a parent View. Used
 *  for the lid + far-edge bands on `TopFace` and the lid + felt bands
 *  on `SideFace`. The parent View is `overflow: hidden` so the band
 *  doesn't leak past the rounded corners. */
function edgeBandStyle(edge: Position, thickness: number, color: string) {
  const base = { position: 'absolute', backgroundColor: color, pointerEvents: 'none' } as const;
  if (edge === 'top') return { ...base, top: 0, left: 0, right: 0, height: thickness };
  if (edge === 'bottom') return { ...base, bottom: 0, left: 0, right: 0, height: thickness };
  if (edge === 'left') return { ...base, top: 0, bottom: 0, left: 0, width: thickness };
  return { ...base, top: 0, bottom: 0, right: 0, width: thickness };
}

interface SideFaceProps {
  /** Layout direction of the cell. 'column' = top face above, side face
   *  below (top/bottom walls); 'row' = top face left, side face right
   *  (left/right walls). */
  stackDir: 'row' | 'column';
  /** Strip thickness along the stack-perpendicular axis — animated by
   *  the parent's `halfProgress` so the strip shrinks smoothly when
   *  the top tile is drawn. */
  extent: Animated.AnimatedInterpolation<number>;
  /** Strip length along the stack-perpendicular axis (tile width for
   *  column stacks, tile height for row stacks). Constant per cell. */
  long: number;
  /** Midpoint seam opacity — fades from 1 (full stack: visible join
   *  between two tiles) to 0 (half stack: no join, only one tile). */
  seamOpacity: Animated.AnimatedInterpolation<number>;
  /** Which edge of the strip touches the lid (TopFace). The lighter
   *  band pins to this edge — the cream side-face catches reflected
   *  light from the lid above. The opposite edge (touching the felt)
   *  gets the darker band. */
  lidEdge: Position;
}

/**
 * Side face — the cream/bone strip pinned to the felt-facing edge of
 * the stack, suggesting the stack's vertical height as seen from a
 * slightly-tilted top-down camera. The strip extent + the seam fade
 * animate from the parent so transitions between full and half states
 * read as the top tile being lifted off rather than a hard pop.
 * Lid-side and felt-side bands sell the strip as a real recessed
 * plane under indirect light from above.
 */
function SideFace({ stackDir, extent, long, seamOpacity, lidEdge }: SideFaceProps) {
  const width = stackDir === 'column' ? long : extent;
  const height = stackDir === 'column' ? extent : long;
  const seamStyle =
    stackDir === 'column'
      ? ({ position: 'absolute', left: 0, right: 0, top: '50%', height: 0.5 } as const)
      : ({ position: 'absolute', top: 0, bottom: 0, left: '50%', width: 0.5 } as const);
  return (
    <Animated.View
      style={{
        width,
        height,
        backgroundColor: COLORS.sideFace,
        borderColor: COLORS.sideEdge,
        borderWidth: 0.5,
        overflow: 'hidden',
      }}
    >
      <View style={edgeBandStyle(lidEdge, 1, COLORS.sideTop)} />
      <View style={edgeBandStyle(oppositeOf(lidEdge), 1, COLORS.sideBottom)} />
      <Animated.View
        style={{ ...seamStyle, backgroundColor: COLORS.sideSeam, opacity: seamOpacity }}
      />
    </Animated.View>
  );
}
