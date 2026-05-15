import type { Tile as MTile, Meld, Phase, Seat } from '@mahjong/game-logic';
import type { ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';
import type { LobbyState } from '../../state/game';
import { useGame } from '../../state/game';
import { Hand } from '../Hand';
import { TutorialTarget } from '../tutorial/TargetRegistry';
import { MeldStrip } from './MeldStrip';
import { YourHandActiveHalo, YourTurnBadge } from './MobileShellShared';
import { PlayerBadge } from './PlayerBadge';
import { ReadyHandBadge } from './ReadyHandBadge';
import { SeatDiscardPile } from './SeatDiscardPile';
import { type SortMode, SortPicker } from './SortPicker';
import { WallEdge } from './WallEdge';
import type { Position } from './seatColor';
import { type SeatPlacement, layoutFor } from './seatPlacement';
import { FELT_SKINS } from './skins';
import { LIVE_WALL_TILES, computeWallLayout } from './wallLayout';

interface DesktopTableProps {
  mySeat: Seat;
  dealer: Seat;
  turn: Seat;
  phase: Phase;
  hands: Record<Seat, MTile[]>;
  melds: Record<Seat, Meld[]>;
  discards: Record<Seat, MTile[]>;
  scoreboard: Record<Seat, number>;
  lobby: LobbyState | null;
  /** Click own-hand tile to discard (only on my turn after draw). */
  ownHandClickable?: ((t: MTile) => void) | undefined;
  sortMode: SortMode;
  onSortModeChange: (m: SortMode) => void;
  drawnTileId: number | null;
  /** When non-null, the bottom seat's `Hand` highlights this `tileId`
   *  as the recommended discard. */
  hintTileId: number | null;
  /** Distinct wait faces when the user's concealed hand is at shanten
   *  0. Empty means no badge is shown. */
  readyWaits: readonly MTile[];
  /** Tile currently in the claim window — gets a gold halo. */
  latestDiscardId: number | null;
  /** Slotted into the table's center cell (e.g. wall count, draw cue, tsumo button). */
  centerHud?: ReactNode;
  /** Live tiles still in the engine wall — drives the per-seat WallEdge
   *  count badge + status (drawn vs live stacks). */
  liveWallCount: number;
  /** Engine `Tile` at the next-to-draw position. Renders on top of the
   *  next-draw stack so the wall→hand FLIP has a real tile to track
   *  through `FlipBag`. */
  nextDrawTile: MTile | null;
  /** Sum of the opening dice from `state.openingRolls.breakPosition`.
   *  Drives which seat's wall is broken; when undefined (e.g. before
   *  `startHand` populates it), every wall renders as fully-live. */
  breakPosition: number | undefined;
  /** Click handler for the user's draw on the next-draw stack. Only
   *  attached when it's the user's turn before draw — otherwise the
   *  next-draw cell is decorative. */
  onDrawNext?: (() => void) | undefined;
  /** True when it's the user's turn AND they haven't drawn yet. Drives
   *  the YOUR TURN pill copy (`· DRAW` vs `· DISCARD`) above the user's
   *  own hand. */
  needsDraw: boolean;
  /** Seat that would draw next once claims resolve. Drives the gold
   *  "about to draw" halo on the matching badge. */
  nextDrawerSeat?: Seat | null;
  /** True once the soft floor has elapsed; gates the halo. */
  aboutToDraw?: boolean;
  /** Whole seconds until the hard fallback. Renders next to the cue. */
  drawCountdown?: number | null;
  /** Whole seconds until `state.turnDeadlineMs` for the active seat —
   *  rendered as "Ns left" inside `PlayerBadge`. Null when the rule
   *  is off, in solo, or outside `phase: 'turn'`. */
  turnCountdown?: number | null;
}

const COLORS = {
  feltEdge: 'rgba(216,168,90,0.45)',
  // Mahjong-back blue for the visible top of an opponent's hand tile —
  // same hex as `WallEdge`'s TopFace so the felt reads as one cohesive
  // top-down view with consistent surface tone across walls + hands.
  back1: '#7fa9c1',
  back2: '#5a8cb0',
  backEdge: 'rgba(50,80,100,0.6)',
  // Cream/bone side face — the strip pinned to the player-facing edge
  // of each opp hand tile, suggesting the tile's vertical depth in
  // the same way `WallEdge` uses it for wall stacks.
  sideFace: '#d6c290',
  sideEdge: '#8a6e3c',
  // Pinned bevel bands — the rounded lid edge catching reflected light
  // from above and the opposite edge sitting in shadow. Same NE-light
  // direction as the wall + the in-hand `Tile.tsx`, so all three
  // surfaces compose under one committed light model.
  backLid: 'rgba(255,255,255,0.20)',
  backFar: 'rgba(0,0,0,0.18)',
  sideTop: 'rgba(255,255,255,0.16)',
  sideBottom: 'rgba(0,0,0,0.20)',
};

/** Thickness of the cream side strip pinned to each opp tile's player-
 *  facing edge. Smaller than the wall's `SIDE_FULL = 10` because opp
 *  hand tiles are individual pieces (no stacked second tile to
 *  account for), and the strip should read as a thin lip rather than
 *  a full half-tile height. */
const OPP_TILE_SIDE_THICK = 3;

function oppositePosition(p: Position): Position {
  return p === 'top' ? 'bottom' : p === 'bottom' ? 'top' : p === 'left' ? 'right' : 'left';
}

/** Absolute-positioned 1 px strip pinned to one edge of a parent View.
 *  Powers the lid / far-edge bevels on `FaceDownTile`'s top + side
 *  faces. Mirrors the same helper in `WallEdge.tsx`; kept local here
 *  rather than shared to keep this module self-contained. */
function edgeBandStyle(edge: Position, thickness: number, color: string) {
  const base = {
    position: 'absolute' as const,
    backgroundColor: color,
    pointerEvents: 'none' as const,
  };
  if (edge === 'top') return { ...base, top: 0, left: 0, right: 0, height: thickness };
  if (edge === 'bottom') return { ...base, bottom: 0, left: 0, right: 0, height: thickness };
  if (edge === 'left') return { ...base, top: 0, bottom: 0, left: 0, width: thickness };
  return { ...base, top: 0, bottom: 0, right: 0, width: thickness };
}

/**
 * Desktop-shell table layout. Used when the viewport is wider than a
 * phone (≥ 768px). Renders a felt-green table with the user at the
 * bottom and three opponents at top/left/right; per-seat discard piles
 * fill the center. Stays in pure React Native primitives so it works
 * on both Expo Web and tablet-sized native targets.
 *
 * Notable simplifications vs the legacy build (queued, not blocking):
 *   - Opponent face-down strips are unrotated; tile backs are visually
 *     symmetric so the seat orientation reads from position alone.
 */
export function DesktopTable({
  mySeat,
  dealer,
  turn,
  phase,
  hands,
  melds,
  discards,
  scoreboard,
  lobby,
  ownHandClickable,
  sortMode,
  onSortModeChange,
  drawnTileId,
  hintTileId,
  readyWaits,
  latestDiscardId,
  centerHud,
  liveWallCount,
  nextDrawTile,
  breakPosition,
  onDrawNext,
  needsDraw,
  nextDrawerSeat,
  aboutToDraw,
  drawCountdown,
  turnCountdown,
}: DesktopTableProps) {
  const feltSkin = useGame((s) => s.settings.felt);
  const felt = FELT_SKINS[feltSkin];
  const { width: viewportWidth } = useWindowDimensions();
  const dims = dimsForViewport(viewportWidth);
  const placements = layoutFor(mySeat, dealer);
  const byPos: Record<Position, SeatPlacement> = {
    bottom: placements[0]!,
    right: placements[1]!,
    top: placements[2]!,
    left: placements[3]!,
  };

  const wallLayout = computeWallLayout({
    dealer,
    breakPosition,
    drawn: Math.max(0, LIVE_WALL_TILES - liveWallCount),
    allowDraw: onDrawNext !== undefined,
  });

  // `innerEdge` tells `WallEdge` which side of each stack the visible
  // SideFace strip pins to. The strip is the "rising up off the felt"
  // depth cue, so it should land on the side of the wall the local
  // player can plausibly see — i.e. between the lid and the player's
  // own seat. For the top, left, and right walls that's the
  // felt-centre-facing side (which is also the player-facing side
  // from the south seat's POV). For the BOTTOM wall, felt-centre is
  // *away* from the player, so we anchor the lid at the felt-centre
  // edge and put the side strip on the player-facing side instead.
  // Without this, the bottom wall reads "inverted" from the others
  // — lid close to the player, side strip on the far side — which is
  // the back of the wall, not the front.
  //
  // Half-drawn stacks always collapse against the strip side so the
  // lid stays anchored against the OUTER edge.
  const innerEdgeFor = (position: Position): 'start' | 'end' => {
    if (position === 'top') return 'end'; // inner = bottom of column
    if (position === 'bottom') return 'end'; // inner = bottom of column (player-facing)
    if (position === 'left') return 'end'; // inner = right of row
    return 'start'; // right wall: inner = left of row
  };

  const renderWall = (
    seat: Seat,
    position: Position,
    orient: 'row' | 'column',
    reverse: boolean,
    isMe: boolean,
  ) => {
    // Vertical walls (left/right seats) render their tiles on their
    // side so the wall length matches the horizontal walls — see
    // FRAME constants below for the math.
    const tileW = orient === 'row' ? dims.wallTileW : dims.wallTileH;
    const tileH = orient === 'row' ? dims.wallTileH : dims.wallTileW;
    return (
      <WallEdge
        seatKey={seat}
        slots={wallLayout.slots[seat]}
        orient={orient}
        reverse={reverse}
        innerEdge={innerEdgeFor(position)}
        tileW={tileW}
        tileH={tileH}
        nextDrawTile={wallLayout.nextDrawSeat === seat ? nextDrawTile : null}
        onDrawNext={wallLayout.nextDrawSeat === seat ? onDrawNext : undefined}
        enableDrawTestId={wallLayout.nextDrawSeat === seat}
        liveCount={isMe ? liveWallCount : undefined}
      />
    );
  };

  const renderOpp = (p: SeatPlacement, orient: 'horizontal' | 'vertical') => {
    const isNextDrawer = aboutToDraw === true && nextDrawerSeat === p.seat;
    const isActive = turn === p.seat && phase === 'turn';
    return (
      <OpponentArea
        key={p.seat}
        placement={p}
        handCount={hands[p.seat].length}
        melds={melds[p.seat]}
        isActive={isActive}
        lobby={lobby}
        score={scoreboard[p.seat]}
        orient={orient}
        aboutToDraw={isNextDrawer}
        drawCountdown={isNextDrawer ? (drawCountdown ?? null) : null}
        turnCountdown={isActive ? (turnCountdown ?? null) : null}
        dims={dims}
      />
    );
  };

  return (
    <View
      style={{
        flex: 1,
        minHeight: 600,
        padding: 12,
        backgroundColor: felt.top,
        borderRadius: 24,
        borderWidth: 4,
        borderColor: COLORS.feltEdge,
        boxShadow: '0px 12px 32px rgba(0,0,0,0.18)',
        gap: 8,
        // Subtle forward tilt so the top wall recedes and the bottom
        // hand reads as closer — amplifies the bevel + stack depth
        // already baked into `Tile.tsx` and `WallEdge.tsx`. Stable for
        // the lifetime of the table mount, so `FlipBag`'s cached
        // screen rects stay valid.
        transform: [{ perspective: 2000 }, { rotateX: '6deg' }],
      }}
    >
      {/* Top opponent row */}
      <View style={{ alignItems: 'center', gap: 6 }}>{renderOpp(byPos.top, 'horizontal')}</View>

      {/* Middle row: left opp | wall-framed square | right opp */}
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
        }}
      >
        <View style={{ width: dims.oppOuterWidth, justifyContent: 'center', gap: 6 }}>
          {renderOpp(byPos.left, 'vertical')}
        </View>

        {/* `reverse` flips slot order so slot 16 of every wall lands at
            its seat's player-perspective right end (= the dice-counted
            "right end" in `wallLayout.ts`). With each player facing the
            felt centre, that's RIGHT-of-screen for East (bottom), TOP for
            South (right), LEFT for West (top), BOTTOM for North (left).
            The two walls whose slot-0/16 axis runs opposite to the
            screen-natural flow (top + right) get `reverse=true`; the
            other two stay false. Keeps both the dead-wall extent and
            the live-draw cursor continuous around all four corners. */}
        <FeltFrame
          topWall={renderWall(byPos.top.seat, 'top', 'row', true, false)}
          bottomWall={renderWall(byPos.bottom.seat, 'bottom', 'row', false, true)}
          leftWall={renderWall(byPos.left.seat, 'left', 'column', false, false)}
          rightWall={renderWall(byPos.right.seat, 'right', 'column', true, false)}
          squareSize={dims.squareSize}
        >
          <CenterDiscards
            byPos={byPos}
            discards={discards}
            latestDiscardId={latestDiscardId}
            centerHud={centerHud}
            bgColor={felt.bottom}
            dims={dims}
          />
        </FeltFrame>

        <View style={{ width: dims.oppOuterWidth, justifyContent: 'center', gap: 6 }}>
          {renderOpp(byPos.right, 'vertical')}
        </View>
      </View>

      {/* Bottom: my area */}
      <MyArea
        placement={byPos.bottom}
        hand={hands[byPos.bottom.seat]}
        melds={melds[byPos.bottom.seat]}
        sortMode={sortMode}
        onSortModeChange={onSortModeChange}
        drawnTileId={drawnTileId}
        hintTileId={hintTileId}
        readyWaits={readyWaits}
        ownHandClickable={ownHandClickable}
        score={scoreboard[byPos.bottom.seat]}
        lobby={lobby}
        isActive={turn === byPos.bottom.seat && phase === 'turn'}
        needsDraw={needsDraw}
        aboutToDraw={aboutToDraw === true && nextDrawerSeat === byPos.bottom.seat}
        drawCountdown={
          aboutToDraw === true && nextDrawerSeat === byPos.bottom.seat
            ? (drawCountdown ?? null)
            : null
        }
        turnCountdown={
          turn === byPos.bottom.seat && phase === 'turn' ? (turnCountdown ?? null) : null
        }
      />
    </View>
  );
}

/**
 * Geometry for the desktop felt at a given viewport scale. The
 * baseline (`scale = 1`) is the previous fixed-pixel layout — 18×26
 * wall tiles, a 322×322 felt, 130 px side cells. Scale eases up
 * with the viewport so larger windows render proportionally larger
 * tiles + walls + discards, instead of leaving the felt as a small
 * island in a sea of cream gutter on a 4K monitor.
 */
interface DesktopDims {
  scale: number;
  wallTileW: number;
  wallTileH: number;
  squareSize: number;
  innerContent: number;
  /** Width reserved for each side-pile column (left + right). */
  sideCellWidth: number;
  /** Max width for top/bottom horizontal piles before they wrap. */
  topBottomPileMaxW: number;
  /** Max height for left/right vertical piles before they wrap. */
  sidePileMaxH: number;
  /** Per-tile width for discard piles. Step = `discardTileW + 2`. */
  discardTileW: number;
  /** Per-tile height for discard piles. Step = `discardTileH + 2`. */
  discardTileH: number;
  /** Face-down opponent strip per-tile dims, by orient. Horizontal
   *  (top seat) tiles render upright; vertical (left/right) tiles
   *  render rotated, so the W/H swap. */
  oppFaceDownH: { w: number; h: number };
  oppFaceDownV: { w: number; h: number };
  /** MeldStrip per-tile dims, opponent vs. self. */
  oppMeldTileW: number;
  oppMeldTileH: number;
  /** Outer width reserved for each side opponent column (the box
   *  containing PlayerBadge + face-down strip + meld strip). */
  oppOuterWidth: number;
}

function dimsForViewport(viewportWidth: number): DesktopDims {
  // Linear ramp from 1.0 at 1280 px wide (Playwright + standard
  // Desktop Chrome's default viewport — keeps the existing baseline
  // exactly) up to 1.6 at 2400 px wide. Clamped at both ends so
  // narrow desktops (768–1280) and ultra-wide monitors (>2400)
  // both stay sensible.
  const scale = Math.min(1.6, Math.max(1, 1 + ((viewportWidth - 1280) / (2400 - 1280)) * 0.6));
  const wallTileW = Math.round(18 * scale);
  const wallTileH = Math.round(26 * scale);
  const squareSize = 17 * wallTileW + 16;
  const innerContent = squareSize - 24;
  const sideCellWidth = Math.round(130 * scale);
  const discardTileW = Math.round(22 * scale);
  const discardTileH = Math.round(30 * scale);
  return {
    scale,
    wallTileW,
    wallTileH,
    squareSize,
    innerContent,
    sideCellWidth,
    topBottomPileMaxW: innerContent,
    sidePileMaxH: Math.round(4 * (discardTileH + 2)),
    discardTileW,
    discardTileH,
    oppFaceDownH: { w: Math.round(14 * scale), h: Math.round(20 * scale) },
    oppFaceDownV: { w: Math.round(16 * scale), h: Math.round(14 * scale) },
    oppMeldTileW: Math.round(14 * scale),
    oppMeldTileH: Math.round(20 * scale),
    oppOuterWidth: Math.round(140 * scale),
  };
}

interface FeltFrameProps {
  topWall: ReactNode;
  bottomWall: ReactNode;
  leftWall: ReactNode;
  rightWall: ReactNode;
  /** Inner felt edge length — driven by the per-viewport scale so
   *  larger windows render a proportionally larger frame. */
  squareSize: number;
  /** The square inner content (typically `<CenterDiscards>`). Forced
   *  to `squareSize × squareSize` so the four walls visually frame it. */
  children: ReactNode;
}

/**
 * Square felt frame — the four walls hug a `squareSize × squareSize`
 * inner block of discards / centre HUD, mimicking the physical layout
 * where the walls form a ring around the playing area.
 */
function FeltFrame({
  topWall,
  bottomWall,
  leftWall,
  rightWall,
  squareSize,
  children,
}: FeltFrameProps) {
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <View style={{ alignItems: 'center' }}>{topWall}</View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {leftWall}
        <View style={{ width: squareSize, height: squareSize }}>{children}</View>
        {rightWall}
      </View>
      <View style={{ alignItems: 'center' }}>{bottomWall}</View>
    </View>
  );
}

interface OpponentAreaProps {
  placement: SeatPlacement;
  handCount: number;
  melds: Meld[];
  isActive: boolean;
  lobby: LobbyState | null;
  score: number;
  /** horizontal = top seat row of tiles; vertical = left/right seat column. */
  orient: 'horizontal' | 'vertical';
  aboutToDraw: boolean;
  drawCountdown: number | null;
  turnCountdown: number | null;
  dims: DesktopDims;
}

function OpponentArea({
  placement,
  handCount,
  melds,
  isActive,
  lobby,
  score,
  orient,
  aboutToDraw,
  drawCountdown,
  turnCountdown,
  dims,
}: OpponentAreaProps) {
  return (
    <View
      style={{
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
      }}
    >
      <PlayerBadge
        seat={placement.seat}
        position={placement.position}
        seatWind={placement.seatWind}
        lobby={lobby}
        score={score}
        isActive={isActive}
        aboutToDraw={aboutToDraw}
        drawCountdown={drawCountdown}
        turnCountdown={turnCountdown}
      />
      <FaceDownStrip count={handCount} orient={orient} dims={dims} position={placement.position} />
      {melds.length > 0 ? (
        <View style={{ alignSelf: 'center' }}>
          <MeldStrip melds={melds} tileWidth={dims.oppMeldTileW} tileHeight={dims.oppMeldTileH} />
        </View>
      ) : null}
    </View>
  );
}

interface MyAreaProps {
  placement: SeatPlacement;
  hand: MTile[];
  melds: Meld[];
  sortMode: SortMode;
  onSortModeChange: (m: SortMode) => void;
  drawnTileId: number | null;
  hintTileId: number | null;
  readyWaits: readonly MTile[];
  ownHandClickable?: ((t: MTile) => void) | undefined;
  score: number;
  lobby: LobbyState | null;
  isActive: boolean;
  /** True when it's the user's turn AND they haven't drawn yet — drives
   *  the YOUR TURN pill copy. */
  needsDraw: boolean;
  aboutToDraw: boolean;
  drawCountdown: number | null;
  turnCountdown: number | null;
}

function MyArea({
  placement,
  hand,
  melds,
  sortMode,
  onSortModeChange,
  drawnTileId,
  hintTileId,
  readyWaits,
  ownHandClickable,
  score,
  lobby,
  isActive,
  needsDraw,
  aboutToDraw,
  drawCountdown,
  turnCountdown,
}: MyAreaProps) {
  return (
    <View style={{ alignItems: 'center', gap: 6 }}>
      {melds.length > 0 ? <MeldStrip melds={melds} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <PlayerBadge
          seat={placement.seat}
          position="bottom"
          seatWind={placement.seatWind}
          lobby={lobby}
          score={score}
          isActive={isActive}
          aboutToDraw={aboutToDraw}
          drawCountdown={drawCountdown}
          turnCountdown={turnCountdown}
        />
        <SortPicker mode={sortMode} onChange={onSortModeChange} />
        <ReadyHandBadge waits={readyWaits} />
        {isActive ? <YourTurnBadge needsDraw={needsDraw} /> : null}
      </View>
      <TutorialTarget id="own-hand">
        {/* Wrapper picks up the gold breathing halo when it's the user's
            turn — opponents' `PlayerBadge` already gets the parallel
            active-turn glow, so mirroring it on the user's own hand
            closes the "which seat is on the clock" gap on desktop.
            `position: 'relative'` + 4 px padding give the absolute halo
            room to breathe outward by its GROWTH_PX without clipping. */}
        <View style={{ position: 'relative', padding: 4 }}>
          {isActive ? <YourHandActiveHalo /> : null}
          <Hand
            tiles={hand}
            onTileClick={ownHandClickable}
            sortMode={sortMode}
            drawnTileId={drawnTileId}
            hintTileId={hintTileId}
          />
        </View>
      </TutorialTarget>
    </View>
  );
}

interface FaceDownStripProps {
  count: number;
  orient: 'horizontal' | 'vertical';
  dims: DesktopDims;
  /** Seat position of the opponent — drives which edge of each tile
   *  the side strip pins to so the cream face always sits between the
   *  tile's top face and the player at the bottom seat. */
  position: Position;
}

function FaceDownStrip({ count, orient, dims, position }: FaceDownStripProps) {
  const W = orient === 'horizontal' ? dims.oppFaceDownH.w : dims.oppFaceDownV.w;
  const H = orient === 'horizontal' ? dims.oppFaceDownH.h : dims.oppFaceDownV.h;
  // Each opp tile sits on its short edge in the strip, back facing the
  // player. The cream side strip pins to whichever cell edge points
  // toward the player at the bottom seat, mirroring `WallEdge`'s
  // "felt-centre-facing strip" trick so the row reads as upright pieces
  // rather than flat painted rectangles.
  //
  //   top opp    (north)  → strip on the BOTTOM edge of the cell
  //   left opp   (west)   → strip on the RIGHT edge of the cell
  //   right opp  (east)   → strip on the LEFT edge of the cell
  //   (bottom is the user; never reaches this strip)
  const playerFacingEdge: Position =
    position === 'top' ? 'bottom' : position === 'left' ? 'right' : 'left';
  return (
    <View
      style={{
        flexDirection: orient === 'horizontal' ? 'row' : 'column',
        gap: 2,
        flexWrap: 'wrap',
        justifyContent: 'center',
        // Wrapper drop-shadow so the whole strip reads as sitting on
        // the felt — same one-shadow-for-the-row trick `WallEdge`
        // uses for its 17-stack row (per-tile shadows would compound
        // visually and over-darken the felt under a 13-tile hand).
        boxShadow: '0px 3px 6px rgba(0,0,0,0.22)',
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <FaceDownTile
          // biome-ignore lint/suspicious/noArrayIndexKey: count-bound, position-stable
          key={i}
          width={W}
          height={H}
          playerFacingEdge={playerFacingEdge}
          orient={orient}
        />
      ))}
    </View>
  );
}

interface FaceDownTileProps {
  width: number;
  height: number;
  playerFacingEdge: Position;
  orient: 'horizontal' | 'vertical';
}

/**
 * One face-down opponent tile, rendered as a `WallEdge`-style top face
 * + side strip composition. The top face is the blue tile-back as seen
 * from above; the cream side strip pins to the player-facing edge to
 * suggest the tile has vertical depth (it's standing on its short
 * edge in the opp's hand, not laying flat). Two pinned bevel bands on
 * each face sell the rounded edge under the same NE-light direction
 * the wall + in-hand `Tile.tsx` already commit to.
 */
function FaceDownTile({ width, height, playerFacingEdge, orient }: FaceDownTileProps) {
  const SIDE = OPP_TILE_SIDE_THICK;
  const isHorizontal = orient === 'horizontal';
  // Cell extent: top face + side strip stacked along the player-facing
  // axis. Horizontal strips (top opp) grow the cell's HEIGHT; vertical
  // strips (left / right opps) grow the cell's WIDTH.
  const cellW = isHorizontal ? width : width + SIDE;
  const cellH = isHorizontal ? height + SIDE : height;
  // Cell composition: [topFace, sideFace] under a flex direction that
  // lands the side strip on the player-facing edge regardless of seat.
  // For the top opp the strip belongs BELOW the top face → `column`.
  // For the left opp the strip belongs to the RIGHT → `row` (so the
  // top face is on the left, abutting the opp's badge). For the right
  // opp the strip belongs to the LEFT → `row-reverse` (top face on
  // the right, strip facing the felt centre).
  const flexDirection: 'row' | 'row-reverse' | 'column' | 'column-reverse' = isHorizontal
    ? playerFacingEdge === 'bottom'
      ? 'column'
      : 'column-reverse'
    : playerFacingEdge === 'right'
      ? 'row'
      : 'row-reverse';
  return (
    <View style={{ width: cellW, height: cellH, flexDirection }}>
      <View
        style={{
          width,
          height,
          borderRadius: 2,
          backgroundColor: COLORS.back1,
          borderColor: COLORS.backEdge,
          borderWidth: 0.5,
          overflow: 'hidden',
        }}
      >
        {/* Lid catching light on the player-facing edge (rounded lid
            edge nearest the camera at the player seat) + darker band
            on the opposite edge (lid's far side, in shadow). */}
        <View style={edgeBandStyle(playerFacingEdge, 1, COLORS.backLid)} />
        <View style={edgeBandStyle(oppositePosition(playerFacingEdge), 0.75, COLORS.backFar)} />
      </View>
      <View
        style={{
          width: isHorizontal ? width : SIDE,
          height: isHorizontal ? SIDE : height,
          backgroundColor: COLORS.sideFace,
          borderColor: COLORS.sideEdge,
          borderWidth: 0.5,
          overflow: 'hidden',
        }}
      >
        {/* Lid-edge of the strip (the edge touching the top face above)
            catches reflected light; the player-facing edge sits in
            shadow on the felt. */}
        <View style={edgeBandStyle(oppositePosition(playerFacingEdge), 0.75, COLORS.sideTop)} />
        <View style={edgeBandStyle(playerFacingEdge, 0.75, COLORS.sideBottom)} />
      </View>
    </View>
  );
}

interface CenterDiscardsProps {
  byPos: Record<Position, SeatPlacement>;
  discards: Record<Seat, MTile[]>;
  latestDiscardId: number | null;
  centerHud?: ReactNode;
  /** Inner well background — the felt skin's darker `bottom` stop, so
   *  the centre area reads as recessed from the surrounding felt. */
  bgColor: string;
  dims: DesktopDims;
}

/**
 * 3×3 inner grid emulated via flex rows. Each non-corner cell holds the
 * matching seat's discard pile; the centre cell is the centerHud
 * (typically a wall-count + draw-cue stack).
 */
function CenterDiscards({
  byPos,
  discards,
  latestDiscardId,
  centerHud,
  bgColor,
  dims,
}: CenterDiscardsProps) {
  const tileProps = { tileW: dims.discardTileW, tileH: dims.discardTileH } as const;
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: bgColor,
        borderRadius: 16,
        padding: 12,
        borderColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        // `space-between` so the three rows hug the top, middle, and
        // bottom of the inner felt instead of bunching up at the top —
        // a real-table reading where each seat's discards "build out"
        // from their own edge of the playing area inward.
        justifyContent: 'space-between',
      }}
    >
      <View style={{ alignItems: 'center' }}>
        <SeatDiscardPile
          tiles={discards[byPos.top.seat]}
          rotate={180}
          latestId={latestDiscardId}
          maxExtent={dims.topBottomPileMaxW}
          {...tileProps}
        />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: dims.sideCellWidth, alignItems: 'center' }}>
          <SeatDiscardPile
            tiles={discards[byPos.left.seat]}
            rotate={90}
            latestId={latestDiscardId}
            maxExtent={dims.sidePileMaxH}
            {...tileProps}
          />
        </View>
        <View style={{ flex: 1 }} />
        <View style={{ width: dims.sideCellWidth, alignItems: 'center' }}>
          <SeatDiscardPile
            tiles={discards[byPos.right.seat]}
            rotate={-90}
            latestId={latestDiscardId}
            maxExtent={dims.sidePileMaxH}
            {...tileProps}
          />
        </View>
      </View>
      <View style={{ alignItems: 'center' }}>
        <TutorialTarget id="shared-discards">
          <SeatDiscardPile
            tiles={discards[byPos.bottom.seat]}
            rotate={0}
            latestId={latestDiscardId}
            maxExtent={dims.topBottomPileMaxW}
            {...tileProps}
          />
        </TutorialTarget>
      </View>
      {/* Rendered as an absolute overlay rather than a child of the
          middle flex cell — that cell's cross-axis width clamped the
          tsumo button below its intrinsic width and the lesson halo
          only covered half of it. `box-none` keeps the discard piles
          beneath tappable. */}
      {centerHud ? (
        <View
          pointerEvents="box-none"
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {centerHud}
        </View>
      ) : null}
    </View>
  );
}
