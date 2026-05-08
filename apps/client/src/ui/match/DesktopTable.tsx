import type { Tile as MTile, Meld, Phase, Seat } from '@mahjong/game-logic';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import type { LobbyState } from '../../state/game';
import { useGame } from '../../state/game';
import { Hand } from '../Hand';
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
}: DesktopTableProps) {
  const feltSkin = useGame((s) => s.settings.felt);
  const felt = FELT_SKINS[feltSkin];
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
    const tileW = orient === 'row' ? WALL_TILE_W : WALL_TILE_H;
    const tileH = orient === 'row' ? WALL_TILE_H : WALL_TILE_W;
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
    return (
      <OpponentArea
        key={p.seat}
        placement={p}
        handCount={hands[p.seat].length}
        melds={melds[p.seat]}
        isActive={turn === p.seat && phase === 'turn'}
        lobby={lobby}
        score={scoreboard[p.seat]}
        orient={orient}
        aboutToDraw={isNextDrawer}
        drawCountdown={isNextDrawer ? (drawCountdown ?? null) : null}
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
        <View style={{ width: 140, justifyContent: 'center', gap: 6 }}>
          {renderOpp(byPos.left, 'vertical')}
        </View>

        <FeltFrame
          topWall={renderWall(byPos.top.seat, 'top', 'row', false, false)}
          bottomWall={renderWall(byPos.bottom.seat, 'bottom', 'row', false, true)}
          leftWall={renderWall(byPos.left.seat, 'left', 'column', false, false)}
          rightWall={renderWall(byPos.right.seat, 'right', 'column', true, false)}
        >
          <CenterDiscards
            byPos={byPos}
            discards={discards}
            latestDiscardId={latestDiscardId}
            centerHud={centerHud}
            bgColor={felt.bottom}
          />
        </FeltFrame>

        <View style={{ width: 140, justifyContent: 'center', gap: 6 }}>
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
      />
    </View>
  );
}

// Wall + square geometry. `WALL_TILE_W` × `WALL_TILE_H` are the
// per-tile dimensions for a horizontal wall (top/bottom). Vertical
// walls (left/right) swap them so the tile is on its side, and the
// effective wall length stays the same. With 17 stacks of `WALL_TILE_W`
// + 16 × 1px gaps, every wall is exactly `SQUARE_SIZE` long, so the
// inner discard square fits perfectly inside the four walls.
//
// Bumped from 14×20 → 18×26 to expand the inner felt: the previous
// 254×254 square stopped fitting four ~18-tile discard piles plus
// the centre HUD around round 14, with the bottom pile spilling
// onto the felt border. 18×26 produces a 322×322 inner square,
// enough headroom for full-length piles + a small HUD column with
// the same 17-stack wall geometry.
const WALL_TILE_W = 18;
const WALL_TILE_H = 26;
const SQUARE_SIZE = 17 * WALL_TILE_W + 16;
// Inner content area inside `CenterDiscards` after `padding: 12`
// gutters on each axis. Used to derive the per-pile max extents
// below so each pile knows how flat it should wrap.
const INNER_CONTENT = SQUARE_SIZE - 24;
// Side-pile cell width. Wider than half-of-`INNER_CONTENT` minus the
// HUD lane would allow, but the HUD lane is empty 99 % of the time
// (only renders during a tsumo opportunity), so giving the side
// piles real breathing room is the better default.
const SIDE_CELL_WIDTH = 130;
// Top/bottom horizontal piles wrap into the full inner width.
const TOP_BOTTOM_PILE_MAX_W = INNER_CONTENT;
// Left/right vertical piles cap their height so a long run wraps
// into a flatter shape. 4 stacked tiles ≈ 128 px (32 px per tile-
// plus-gap), matching the height available between the top + bottom
// piles in `CenterDiscards`.
const SIDE_PILE_MAX_H = 4 * 32;

interface FeltFrameProps {
  topWall: ReactNode;
  bottomWall: ReactNode;
  leftWall: ReactNode;
  rightWall: ReactNode;
  /** The square inner content (typically `<CenterDiscards>`). Forced to
   *  `SQUARE_SIZE × SQUARE_SIZE` so the four walls visually frame it. */
  children: ReactNode;
}

/**
 * Square felt frame — the four walls hug a `SQUARE_SIZE × SQUARE_SIZE`
 * inner block of discards / centre HUD, mimicking the physical layout
 * where the walls form a ring around the playing area.
 */
function FeltFrame({ topWall, bottomWall, leftWall, rightWall, children }: FeltFrameProps) {
  return (
    <View style={{ alignItems: 'center', gap: 4 }}>
      <View style={{ alignItems: 'center' }}>{topWall}</View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {leftWall}
        <View style={{ width: SQUARE_SIZE, height: SQUARE_SIZE }}>{children}</View>
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
      />
      <FaceDownStrip count={handCount} orient={orient} />
      {melds.length > 0 ? (
        <View style={{ alignSelf: 'center' }}>
          <MeldStrip melds={melds} tileWidth={14} tileHeight={20} />
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
        />
        <SortPicker mode={sortMode} onChange={onSortModeChange} />
      </View>
      <Hand
        tiles={hand}
        onTileClick={ownHandClickable}
        sortMode={sortMode}
        drawnTileId={drawnTileId}
        hintTileId={hintTileId}
      />
    </View>
  );
}

interface FaceDownStripProps {
  count: number;
  orient: 'horizontal' | 'vertical';
}

function FaceDownStrip({ count, orient }: FaceDownStripProps) {
  const W = orient === 'horizontal' ? 14 : 16;
  const H = orient === 'horizontal' ? 20 : 14;
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
}: CenterDiscardsProps) {
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: bgColor,
        borderRadius: 16,
        padding: 12,
        borderColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        gap: 8,
      }}
    >
      <View style={{ alignItems: 'center' }}>
        <SeatDiscardPile
          tiles={discards[byPos.top.seat]}
          rotate={180}
          latestId={latestDiscardId}
          maxExtent={TOP_BOTTOM_PILE_MAX_W}
        />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: SIDE_CELL_WIDTH, alignItems: 'center' }}>
          <SeatDiscardPile
            tiles={discards[byPos.left.seat]}
            rotate={90}
            latestId={latestDiscardId}
            maxExtent={SIDE_PILE_MAX_H}
          />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{centerHud}</View>
        <View style={{ width: SIDE_CELL_WIDTH, alignItems: 'center' }}>
          <SeatDiscardPile
            tiles={discards[byPos.right.seat]}
            rotate={-90}
            latestId={latestDiscardId}
            maxExtent={SIDE_PILE_MAX_H}
          />
        </View>
      </View>
      <View style={{ alignItems: 'center' }}>
        <SeatDiscardPile
          tiles={discards[byPos.bottom.seat]}
          rotate={0}
          latestId={latestDiscardId}
          maxExtent={TOP_BOTTOM_PILE_MAX_W}
        />
      </View>
    </View>
  );
}
