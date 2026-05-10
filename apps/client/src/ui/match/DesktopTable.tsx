import type { Tile as MTile, Meld, Phase, Seat } from '@mahjong/game-logic';
import type { ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';
import type { LobbyState } from '../../state/game';
import { useGame } from '../../state/game';
import { Hand } from '../Hand';
import { TutorialTarget } from '../tutorial/TargetRegistry';
import { MeldStrip } from './MeldStrip';
import { PlayerBadge } from './PlayerBadge';
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
  back1: '#7fa9c1',
  back2: '#5a8cb0',
};

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
  latestDiscardId,
  centerHud,
  liveWallCount,
  nextDrawTile,
  breakPosition,
  onDrawNext,
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

  // `innerEdge` tells `WallEdge` which side of each stack faces the
  // felt centre. Half-drawn stacks collapse against this edge so the
  // wall reads as receding inward, matching a physical 2-tile-high
  // row where "the top one is gone" = the tile farther from the
  // table centre is missing first.
  const innerEdgeFor = (position: Position): 'start' | 'end' => {
    if (position === 'top') return 'end'; // inner = bottom of column
    if (position === 'bottom') return 'start'; // inner = top of column
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
        ownHandClickable={ownHandClickable}
        score={scoreboard[byPos.bottom.seat]}
        lobby={lobby}
        isActive={turn === byPos.bottom.seat && phase === 'turn'}
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
      <FaceDownStrip count={handCount} orient={orient} dims={dims} />
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
  ownHandClickable?: ((t: MTile) => void) | undefined;
  score: number;
  lobby: LobbyState | null;
  isActive: boolean;
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
  ownHandClickable,
  score,
  lobby,
  isActive,
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
      </View>
      <TutorialTarget id="own-hand">
        <Hand
          tiles={hand}
          onTileClick={ownHandClickable}
          sortMode={sortMode}
          drawnTileId={drawnTileId}
          hintTileId={hintTileId}
        />
      </TutorialTarget>
    </View>
  );
}

interface FaceDownStripProps {
  count: number;
  orient: 'horizontal' | 'vertical';
  dims: DesktopDims;
}

function FaceDownStrip({ count, orient, dims }: FaceDownStripProps) {
  const W = orient === 'horizontal' ? dims.oppFaceDownH.w : dims.oppFaceDownV.w;
  const H = orient === 'horizontal' ? dims.oppFaceDownH.h : dims.oppFaceDownV.h;
  return (
    <View
      style={{
        flexDirection: orient === 'horizontal' ? 'row' : 'column',
        gap: 2,
        flexWrap: 'wrap',
        justifyContent: 'center',
      }}
    >
      {Array.from({ length: count }, (_, i) => (
        <View
          // biome-ignore lint/suspicious/noArrayIndexKey: count-bound, position-stable
          key={i}
          style={{
            width: W,
            height: H,
            borderRadius: 2,
            backgroundColor: COLORS.back1,
            borderColor: COLORS.back2,
            borderWidth: 1,
          }}
        />
      ))}
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
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{centerHud}</View>
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
    </View>
  );
}
