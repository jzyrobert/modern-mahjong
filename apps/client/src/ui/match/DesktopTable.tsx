import {
  type Tile as MTile,
  type Meld,
  type Phase,
  type Seat,
  WINDS,
  type Wind,
  acrossSeat,
  nextSeat,
  prevSeat,
} from '@mahjong/game-logic';
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
import { FELT_SKINS } from './skins';
import { LIVE_WALL_TILES, computeWallLayout } from './wallLayout';

type Position = 'top' | 'right' | 'bottom' | 'left';

interface SeatPlacement {
  seat: Seat;
  position: Position;
  seatWind: Wind;
}

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
  /** Tile currently in the claim window — gets a gold halo. */
  latestDiscardId: number | null;
  /** Slotted into the table's center cell (e.g. wall count, draw cue, tsumo button). */
  centerHud?: ReactNode;
  /** Live tiles still in the engine wall — drives the per-seat WallEdge
   *  count badge + status (drawn vs live stacks). */
  liveWallCount: number;
  /** Engine `Tile` at the next-to-draw position. Renders on top of the
   *  next-draw stack so future Phase 6 wall→hand FLIPs have a real tile
   *  to track. */
  nextDrawTile: MTile | null;
  /** Sum of the opening dice from `state.openingRolls.breakPosition`.
   *  Drives which seat's wall is broken; when undefined (e.g. before
   *  `startHand` populates it), every wall renders as fully-live. */
  breakPosition: number | undefined;
  /** Click handler for the user's draw on the next-draw stack. Only
   *  attached when it's the user's turn before draw — otherwise the
   *  next-draw cell is decorative. */
  onDrawNext?: (() => void) | undefined;
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
 * fill the center. Restores the visual language of the legacy
 * `_legacy/src/ui/Table.tsx` while staying in pure React Native
 * primitives so it works on both Expo Web and tablet-sized native
 * targets.
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
  latestDiscardId,
  centerHud,
  liveWallCount,
  nextDrawTile,
  breakPosition,
  onDrawNext,
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

  const renderWall = (seat: Seat, orient: 'row' | 'column', reverse: boolean, isMe: boolean) => (
    <WallEdge
      seatKey={seat}
      slots={wallLayout.slots[seat]}
      orient={orient}
      reverse={reverse}
      nextDrawTile={wallLayout.nextDrawSeat === seat ? nextDrawTile : null}
      onDrawNext={wallLayout.nextDrawSeat === seat ? onDrawNext : undefined}
      enableDrawTestId={wallLayout.nextDrawSeat === seat}
      liveCount={isMe ? liveWallCount : undefined}
    />
  );

  const renderOpp = (p: SeatPlacement, orient: 'horizontal' | 'vertical') => (
    <OpponentArea
      key={p.seat}
      placement={p}
      handCount={hands[p.seat].length}
      melds={melds[p.seat]}
      isActive={turn === p.seat && phase === 'turn'}
      lobby={lobby}
      score={scoreboard[p.seat]}
      orient={orient}
      wall={renderWall(
        p.seat,
        orient === 'horizontal' ? 'row' : 'column',
        p.position === 'right',
        false,
      )}
    />
  );

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
        shadowColor: '#000',
        shadowOpacity: 0.18,
        shadowRadius: 32,
        shadowOffset: { width: 0, height: 12 },
        elevation: 6,
        gap: 8,
      }}
    >
      {/* Top opponent row */}
      <View style={{ alignItems: 'center', gap: 6 }}>{renderOpp(byPos.top, 'horizontal')}</View>

      {/* Middle row: left opp | center pile | right opp */}
      <View style={{ flex: 1, flexDirection: 'row', gap: 12 }}>
        <View style={{ width: 140, justifyContent: 'center', gap: 6 }}>
          {renderOpp(byPos.left, 'vertical')}
        </View>

        <View style={{ flex: 1, justifyContent: 'center' }}>
          <CenterDiscards
            byPos={byPos}
            discards={discards}
            latestDiscardId={latestDiscardId}
            centerHud={centerHud}
            bgColor={felt.bottom}
          />
        </View>

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
        ownHandClickable={ownHandClickable}
        score={scoreboard[byPos.bottom.seat]}
        lobby={lobby}
        isActive={turn === byPos.bottom.seat && phase === 'turn'}
        wall={renderWall(byPos.bottom.seat, 'row', false, true)}
      />
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
  /** Pre-rendered `WallEdge` for this seat — sits between the badge and
   *  the discards (i.e. on the inner-table side of the seat). */
  wall: ReactNode;
}

function OpponentArea({
  placement,
  handCount,
  melds,
  isActive,
  lobby,
  score,
  orient,
  wall,
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
      />
      <FaceDownStrip count={handCount} orient={orient} />
      {melds.length > 0 ? (
        <View style={{ alignSelf: 'center' }}>
          <MeldStrip melds={melds} tileWidth={14} tileHeight={20} />
        </View>
      ) : null}
      {wall}
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
  ownHandClickable?: ((t: MTile) => void) | undefined;
  score: number;
  lobby: LobbyState | null;
  isActive: boolean;
  wall: ReactNode;
}

function MyArea({
  placement,
  hand,
  melds,
  sortMode,
  onSortModeChange,
  drawnTileId,
  ownHandClickable,
  score,
  lobby,
  isActive,
  wall,
}: MyAreaProps) {
  return (
    <View style={{ alignItems: 'center', gap: 6 }}>
      {wall}
      {melds.length > 0 ? <MeldStrip melds={melds} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <PlayerBadge
          seat={placement.seat}
          position="bottom"
          seatWind={placement.seatWind}
          lobby={lobby}
          score={score}
          isActive={isActive}
        />
        <SortPicker mode={sortMode} onChange={onSortModeChange} />
      </View>
      <Hand
        tiles={hand}
        onTileClick={ownHandClickable}
        sortMode={sortMode}
        drawnTileId={drawnTileId}
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
        backgroundColor: bgColor,
        borderRadius: 16,
        padding: 12,
        borderColor: 'rgba(255,255,255,0.08)',
        borderWidth: 1,
        gap: 8,
        minHeight: 220,
      }}
    >
      <View style={{ alignItems: 'center' }}>
        <SeatDiscardPile tiles={discards[byPos.top.seat]} rotate={180} latestId={latestDiscardId} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ width: 110, alignItems: 'center' }}>
          <SeatDiscardPile
            tiles={discards[byPos.left.seat]}
            rotate={90}
            latestId={latestDiscardId}
          />
        </View>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>{centerHud}</View>
        <View style={{ width: 110, alignItems: 'center' }}>
          <SeatDiscardPile
            tiles={discards[byPos.right.seat]}
            rotate={-90}
            latestId={latestDiscardId}
          />
        </View>
      </View>
      <View style={{ alignItems: 'center' }}>
        <SeatDiscardPile
          tiles={discards[byPos.bottom.seat]}
          rotate={0}
          latestId={latestDiscardId}
        />
      </View>
    </View>
  );
}

function layoutFor(mySeat: Seat, dealer: Seat): SeatPlacement[] {
  return [
    { seat: mySeat, position: 'bottom', seatWind: seatWindFor(dealer, mySeat) },
    { seat: nextSeat(mySeat), position: 'right', seatWind: seatWindFor(dealer, nextSeat(mySeat)) },
    {
      seat: acrossSeat(mySeat),
      position: 'top',
      seatWind: seatWindFor(dealer, acrossSeat(mySeat)),
    },
    { seat: prevSeat(mySeat), position: 'left', seatWind: seatWindFor(dealer, prevSeat(mySeat)) },
  ];
}

function seatWindFor(dealer: Seat, seat: Seat): Wind {
  const offset = (seat - dealer + 4) % 4;
  return WINDS[offset]!;
}
