import type { Action, GameState, Tile as MTile, Seat } from '@mahjong/game-logic';
import { tileId } from '@mahjong/game-logic';
import { type ReactNode, useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { LobbyState } from '../../state/game';
import type { FeltSkin } from '../../state/game';
import { ClaimBar } from '../ClaimBar';
import { Hand } from '../Hand';
import { Scoreboard } from '../Scoreboard';
import { Tile } from '../Tile';
import { PrimaryButton } from '../buttons';
import { COLORS } from '../colors';
import { TutorialTarget } from '../tutorial/TargetRegistry';
import { WALL_LOW_THRESHOLD } from './GameStatusBar';
import { MeldStrip } from './MeldStrip';
import { SeatRow, YourHandActiveHalo, YourTurnBadge } from './MobileShellShared';
import { OppDiscardColumn } from './OppDiscardColumn';
import { ReadyHandBadge } from './ReadyHandBadge';
import { type SortMode, SortPicker } from './SortPicker';
import { type Position, SEAT_COLOR } from './seatColor';
import type { SeatPlacement } from './seatPlacement';
import type { FELT_SKINS } from './skins';

// Shared chrome for every card that lives inside the landscape right
// rail, so the column reads as one cohesive sidebar instead of a
// stack of mismatched floating panels.
const RAIL_CARD = {
  backgroundColor: COLORS.paperHi,
  borderColor: COLORS.hairline,
  borderWidth: 1,
  borderRadius: 12,
  boxShadow: '0px 4px 12px rgba(0,0,0,0.08)',
} as const;
// Pre-composed style for the standard rail section (status, melds,
// own-discards). Hoisted to module scope so React doesn't allocate a
// fresh style object on every rail render.
const RAIL_SECTION_STYLE = {
  ...RAIL_CARD,
  paddingVertical: 8,
  paddingHorizontal: 10,
} as const;

type DiscardsBySeat = Record<Seat, GameState['discardOrder']>;

/** Bucket the engine's chronological discard array by seat in a single pass.
 *  All four landscape rail consumers (3 opp columns + own discards) would
 *  otherwise re-filter the full list on every render. */
function bucketDiscardsBySeat(discardOrder: GameState['discardOrder']): DiscardsBySeat {
  const buckets = { 0: [], 1: [], 2: [], 3: [] } as DiscardsBySeat;
  for (const entry of discardOrder) buckets[entry.from].push(entry);
  return buckets;
}

/** Perimeter slots used for the landscape opp-columns row, left-to-right. */
const LANDSCAPE_OPP_POSITIONS: readonly Position[] = ['left', 'top', 'right'];

interface LandscapeShellProps {
  state: GameState;
  seat: Seat;
  lobby: LobbyState | null;
  matchCode: string | null;
  felt: (typeof FELT_SKINS)[FeltSkin];
  myTurn: boolean;
  needsDraw: boolean;
  canTsumo: boolean;
  tsumoFaan: number | null;
  concealedGangTile: MTile | null;
  hasClaimOption: boolean;
  nextDrawerSeat: Seat | null;
  aboutToDraw: boolean;
  drawCountdown: number | null;
  turnCountdown: number | null;
  latestDiscardId: number | null;
  userName: string;
  userWindGlyph: string;
  userWindBg: string;
  userWindFg: string;
  drawnTileId: number | null;
  hintTileId: number | null;
  readyWaits: readonly MTile[];
  sortMode: SortMode;
  onSortModeChange: (m: SortMode) => void;
  onAction: (a: Action) => void;
  onTileTap: (t: MTile) => void;
  byPosition: Record<Position, SeatPlacement> | null;
  setPlayersOpen: (open: boolean) => void;
  setMenuOpen: (open: boolean) => void;
}

/**
 * Landscape-orientation mobile body — Scoreboard + three opponent
 * columns side-by-side as the middle (replacing the shared centre
 * pool), with a right rail hosting the status card, claim bar,
 * tsumo/gang CTAs, own melds, and a flex-grown YOUR DISCARDS card.
 * The bottom band hosts the centered hand strip + compact sort
 * cycle button.
 *
 * Renders a fragment so the parent dispatcher can host the
 * SafeAreaView + overlays + ResultPanel + MatchModals. Pairs with
 * `PortraitShell` for the alternate orientation.
 */
export function LandscapeShell({
  state,
  seat,
  lobby,
  matchCode,
  felt,
  myTurn,
  needsDraw,
  canTsumo,
  tsumoFaan,
  concealedGangTile,
  hasClaimOption,
  nextDrawerSeat,
  aboutToDraw,
  drawCountdown,
  turnCountdown,
  latestDiscardId,
  userName,
  userWindGlyph,
  userWindBg,
  userWindFg,
  drawnTileId,
  hintTileId,
  readyWaits,
  sortMode,
  onSortModeChange,
  onAction,
  onTileTap,
  byPosition,
  setPlayersOpen,
  setMenuOpen,
}: LandscapeShellProps): ReactNode {
  const viewers = lobby?.viewers ?? null;

  // Per-seat discard buckets — three landscape opp columns plus the
  // YOUR DISCARDS rail card would otherwise each re-filter the full
  // `state.discardOrder` (up to 75 tiles) on every shell render.
  const discardsBySeat = useMemo(
    () => bucketDiscardsBySeat(state.discardOrder),
    [state.discardOrder],
  );

  return (
    <>
      <View
        style={{
          flex: 1,
          minHeight: 0,
          flexDirection: 'row',
          paddingHorizontal: 12,
          paddingTop: 4,
          gap: 8,
          backgroundColor: felt.top,
        }}
      >
        <View style={{ flex: 1, minHeight: 0 }}>
          <Scoreboard />
          {byPosition ? (
            // The shared-discards TutorialTarget still needs to
            // register a rect in landscape so any tutorial halo
            // that points at the discard pool has something to
            // anchor to. Wrapping the per-opp row in it gives the
            // overlay a bounding box that covers all three
            // opponent columns.
            <TutorialTarget id="shared-discards" style={{ flex: 1, minHeight: 0, marginTop: 4 }}>
              <View
                style={{
                  flex: 1,
                  minHeight: 0,
                  flexDirection: 'row',
                  gap: 6,
                }}
              >
                {LANDSCAPE_OPP_POSITIONS.map((pos) => {
                  const placement = byPosition[pos];
                  const seatAbout = aboutToDraw && nextDrawerSeat === placement.seat;
                  return (
                    <LandscapeOppColumn
                      key={pos}
                      placement={placement}
                      state={state}
                      lobby={lobby}
                      aboutToDraw={seatAbout}
                      drawCountdown={seatAbout ? drawCountdown : null}
                      turnCountdown={turnCountdown}
                      discards={discardsBySeat[placement.seat]}
                      latestDiscardId={latestDiscardId}
                    />
                  );
                })}
              </View>
            </TutorialTarget>
          ) : null}
        </View>
        {/* Right rail — status card, claim / tsumo / melds when
            active, then a flex-grown YOUR DISCARDS card. Every
            section shares `RAIL_CARD` chrome so the column reads
            as one sidebar. */}
        <LandscapeActionRail
          state={state}
          seat={seat}
          myTurn={myTurn}
          turnCountdown={turnCountdown}
          matchCode={matchCode}
          viewers={viewers}
          userName={userName}
          userWindGlyph={userWindGlyph}
          userWindBg={userWindBg}
          userWindFg={userWindFg}
          hasClaimOption={hasClaimOption}
          canTsumo={canTsumo}
          tsumoFaan={tsumoFaan}
          concealedGangTile={concealedGangTile}
          ownDiscards={discardsBySeat[seat]}
          latestDiscardId={latestDiscardId}
          readyWaits={readyWaits}
          onAction={onAction}
          onOpenMenu={() => setMenuOpen(true)}
          onOpenPlayers={() => setPlayersOpen(true)}
        />
      </View>

      {/* Fixed bottom action zone — the claim/tsumo/melds slots are
          hosted by the right rail in landscape, so this row reduces
          to the centred hand + compact sort cycle button. */}
      <View
        style={{
          paddingHorizontal: 12,
          paddingTop: 8,
          paddingBottom: 4,
          gap: 8,
          backgroundColor: felt.top,
          borderTopColor: 'rgba(0,0,0,0.12)',
          borderTopWidth: 1,
        }}
      >
        {/* Always-rendered slot for the YOUR TURN pill — `height`
            matches the badge's intrinsic height so its absence
            doesn't collapse the bottom action zone (which would
            shove the hand row up by ~30 px the instant the turn
            rotates away, and back down the next time it returns). */}
        <View style={{ alignItems: 'center', marginBottom: 2, height: 30 }}>
          {myTurn ? <YourTurnBadge needsDraw={needsDraw} /> : null}
        </View>
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <TutorialTarget id="own-hand">
            {/* Wrapper picks up the gold breathing halo when it's the
                user's turn — opponents already have this treatment
                (OppHandStrip.ActiveHalo) so the user's hand getting
                the same cue when active makes it obvious which seat
                is on the clock. Gated on `!needsDraw` so the halo
                only fires once the user has drawn and is choosing
                what to discard — pre-draw the tile-to-discard
                action isn't yet legal and the halo would
                misleadingly cue interaction with the hand.
                `position: 'relative'` + 4 px padding give the absolute
                halo room to breathe outward by its GROWTH_PX without
                clipping. */}
            <View style={{ position: 'relative', padding: 4 }}>
              {myTurn && !needsDraw ? <YourHandActiveHalo /> : null}
              <Hand
                tiles={state.hands[seat]}
                onTileClick={myTurn && state.hasDrawn ? onTileTap : undefined}
                sortMode={sortMode}
                drawnTileId={drawnTileId}
                hintTileId={hintTileId}
              />
            </View>
          </TutorialTarget>
          <SortPicker mode={sortMode} onChange={onSortModeChange} compact />
        </View>
      </View>
    </>
  );
}

interface LandscapeOppColumnProps {
  placement: SeatPlacement;
  state: GameState;
  lobby: LobbyState | null;
  aboutToDraw: boolean;
  drawCountdown: number | null;
  turnCountdown: number | null;
  discards: GameState['discardOrder'];
  latestDiscardId: number | null;
}

/**
 * Landscape opponent column — `OppHandStrip` header on top, this
 * seat's own discard pile flex-grown below. Three sit side-by-side in
 * the landscape flex middle (replacing the shared centre pool), so
 * opponent discards live spatially next to the player who threw them.
 */
function LandscapeOppColumn({
  placement,
  state,
  lobby,
  aboutToDraw,
  drawCountdown,
  turnCountdown,
  discards,
  latestDiscardId,
}: LandscapeOppColumnProps) {
  return (
    <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      <SeatRow
        placement={placement}
        state={state}
        lobby={lobby}
        aboutToDraw={aboutToDraw}
        drawCountdown={drawCountdown}
        turnCountdown={turnCountdown}
        compact
      />
      <OppDiscardColumn
        position={placement.position}
        discards={discards}
        latestId={latestDiscardId}
      />
    </View>
  );
}

interface LandscapeActionRailProps {
  state: GameState;
  seat: Seat;
  myTurn: boolean;
  turnCountdown: number | null;
  matchCode: string | null;
  viewers: number | null;
  userName: string;
  userWindGlyph: string;
  userWindBg: string;
  userWindFg: string;
  hasClaimOption: boolean;
  canTsumo: boolean;
  tsumoFaan: number | null;
  concealedGangTile: MTile | null;
  ownDiscards: GameState['discardOrder'];
  latestDiscardId: number | null;
  /** Distinct wait faces when the user's concealed hand is at shanten 0. */
  readyWaits: readonly MTile[];
  onAction: (a: Action) => void;
  onOpenMenu: () => void;
  onOpenPlayers: () => void;
}

/**
 * Landscape-only right rail. Hosts the chrome status card, claim bar,
 * tsumo/gang CTAs, own melds, and a flex-grown YOUR DISCARDS card.
 * Every section shares `RAIL_CARD` chrome so the column reads as one
 * cohesive sidebar.
 */
function LandscapeActionRail({
  state,
  seat,
  myTurn,
  turnCountdown,
  matchCode,
  viewers,
  userName,
  userWindGlyph,
  userWindBg,
  userWindFg,
  hasClaimOption,
  canTsumo,
  tsumoFaan,
  concealedGangTile,
  ownDiscards,
  latestDiscardId,
  readyWaits,
  onAction,
  onOpenMenu,
  onOpenPlayers,
}: LandscapeActionRailProps) {
  const showCode = matchCode !== null && matchCode !== 'SOLO';
  return (
    <View style={{ width: 200, gap: 6 }}>
      <RailStatusCard
        windGlyph={userWindGlyph}
        windBg={userWindBg}
        windFg={userWindFg}
        name={userName}
        wallCount={state.wall.length}
        isMyTurn={myTurn}
        turnCountdown={myTurn ? turnCountdown : null}
        showCode={showCode}
        matchCode={matchCode}
        viewers={viewers}
        onPress={onOpenPlayers}
        onOpenMenu={onOpenMenu}
      />
      {state.melds[seat].length > 0 ? (
        <View style={RAIL_SECTION_STYLE}>
          <Text style={RAIL_SECTION_LABEL_STYLE}>YOUR MELDS</Text>
          <MeldStrip melds={state.melds[seat]} tileWidth={14} tileHeight={20} />
        </View>
      ) : null}
      {hasClaimOption ? (
        <TutorialTarget id="claim-bar">
          <ClaimBar onAction={onAction} seat={seat} orientation="landscape" />
        </TutorialTarget>
      ) : null}
      {canTsumo || concealedGangTile ? (
        <TutorialTarget id="tsumo-button">
          <View style={{ gap: 6 }}>
            {canTsumo ? (
              <PrimaryButton onPress={() => onAction({ t: 'declareWin', seat, selfDraw: true })}>
                {tsumoFaan !== null
                  ? `Declare win (tsumo, ${tsumoFaan} faan)`
                  : 'Declare win (tsumo)'}
              </PrimaryButton>
            ) : null}
            {concealedGangTile ? (
              <PrimaryButton
                onPress={() =>
                  onAction({ t: 'declareGangConcealed', seat, tile: concealedGangTile })
                }
              >
                Declare gang
              </PrimaryButton>
            ) : null}
          </View>
        </TutorialTarget>
      ) : null}
      <ReadyHandBadge waits={readyWaits} />
      <OwnDiscardsRail tiles={ownDiscards} latestId={latestDiscardId} />
    </View>
  );
}

const RAIL_SECTION_LABEL_STYLE = {
  fontSize: 9,
  fontWeight: '800' as const,
  color: COLORS.ink3,
  letterSpacing: 0.6,
  marginBottom: 4,
};

interface RailStatusCardProps {
  windGlyph: string;
  windBg: string;
  windFg: string;
  name: string;
  wallCount: number;
  isMyTurn: boolean;
  turnCountdown: number | null;
  showCode: boolean;
  matchCode: string | null;
  viewers: number | null;
  onPress: () => void;
  onOpenMenu: () => void;
}

const RAIL_STATUS_CARD_STYLE = {
  ...RAIL_CARD,
  flexDirection: 'row' as const,
  alignItems: 'center' as const,
  paddingVertical: 6,
  paddingLeft: 8,
  paddingRight: 6,
  gap: 6,
};
const RAIL_OWN_DISCARDS_STYLE = {
  ...RAIL_CARD,
  flex: 1,
  minHeight: 0,
  paddingVertical: 8,
  paddingHorizontal: 10,
};
const STATUS_LOW_WALL_RED = '#b2503b';

/**
 * Landscape-rail variant of `GameStatusBar`. Renders the same data
 * (wind glyph + name in a seat-coloured pill, wall count, your-turn
 * dot, optional #CODE / viewers, turn countdown) but in the shared
 * rail card chrome with the ☰ menu pill inline on the right edge.
 */
function RailStatusCard({
  windGlyph,
  windBg,
  windFg,
  name,
  wallCount,
  isMyTurn,
  turnCountdown,
  showCode,
  matchCode,
  viewers,
  onPress,
  onOpenMenu,
}: RailStatusCardProps) {
  const low = wallCount <= WALL_LOW_THRESHOLD;
  return (
    <View style={RAIL_STATUS_CARD_STYLE}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel="Open players panel"
        style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 6 }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            backgroundColor: windBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontFamily: 'Noto Serif TC',
              fontSize: 12,
              fontWeight: '700',
              color: windFg,
            }}
          >
            {windGlyph}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{ fontSize: 11, fontWeight: '800', color: COLORS.ink, letterSpacing: 0.3 }}
            numberOfLines={1}
          >
            {name}
          </Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 1 }}>
            <Text
              style={{
                fontSize: 10,
                fontWeight: '700',
                color: low ? STATUS_LOW_WALL_RED : COLORS.ink3,
                letterSpacing: 0.4,
              }}
            >
              {wallCount} tiles
            </Text>
            {showCode && matchCode ? (
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: '800',
                  color: COLORS.red,
                  letterSpacing: 1,
                }}
                numberOfLines={1}
              >
                #{matchCode}
              </Text>
            ) : null}
            {viewers && viewers > 0 ? (
              <Text style={{ fontSize: 10, color: COLORS.ink3, fontWeight: '600' }}>
                👁 {viewers}
              </Text>
            ) : null}
            {isMyTurn ? (
              <View
                accessibilityLabel="Your turn"
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: COLORS.redHot,
                  boxShadow: `0px 0px 4px ${COLORS.redHot}99`,
                }}
              />
            ) : null}
            {isMyTurn && turnCountdown !== null ? (
              <Text style={{ fontSize: 9, fontWeight: '800', color: COLORS.red }}>
                {turnCountdown}s
              </Text>
            ) : null}
          </View>
        </View>
      </Pressable>
      <Pressable
        onPress={onOpenMenu}
        accessibilityLabel="Open menu"
        style={({ pressed }) => ({
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 8,
          backgroundColor: pressed ? COLORS.creamLow : 'transparent',
        })}
      >
        <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.ink }}>☰</Text>
      </Pressable>
    </View>
  );
}

interface OwnDiscardsRailProps {
  /** Pre-filtered to the user's own seat by the parent shell. */
  tiles: GameState['discardOrder'];
  latestId: number | null;
}

const OWN_TILE_W = 18;
const OWN_TILE_H = 24;

/**
 * Mini strip of the user's own discards at the bottom of the rail.
 * Mostly informational — own discards aren't strategically critical —
 * but flex-grows to fill any otherwise-empty rail space below the
 * action zone.
 *
 * The tile grid is wrapped in a ScrollView so it scrolls when the
 * rail is compressed by tall siblings (e.g. YOUR MELDS wrapping to
 * 2 rows with 3+ exposed melds, or an open ClaimBar). Without this,
 * the rail's `flex: 1` clipped any overflow invisibly — late-hand
 * discards past row 2 just disappeared with no way to reach them.
 */
function OwnDiscardsRail({ tiles, latestId }: OwnDiscardsRailProps) {
  return (
    <View style={RAIL_OWN_DISCARDS_STYLE}>
      <Text style={RAIL_SECTION_LABEL_STYLE}>YOUR DISCARDS</Text>
      {tiles.length === 0 ? (
        <Text style={{ fontSize: 10, color: COLORS.ink3, fontStyle: 'italic' }}>none yet</Text>
      ) : (
        <ScrollView style={{ flex: 1, minHeight: 0 }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}>
            {tiles.map((entry, i) => {
              const id = tileId(entry.tile);
              return (
                <View
                  // biome-ignore lint/suspicious/noArrayIndexKey: discard order is stable; composite with index
                  key={`${id}-${i}`}
                  style={{
                    borderBottomColor: SEAT_COLOR.bottom,
                    borderBottomWidth: 2,
                    borderRadius: 2,
                    opacity: id === latestId ? 0.65 : 1,
                  }}
                >
                  <Tile tile={entry.tile} width={OWN_TILE_W} height={OWN_TILE_H} />
                </View>
              );
            })}
          </View>
        </ScrollView>
      )}
    </View>
  );
}
