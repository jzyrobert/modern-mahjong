import type { Action, GameState, Tile as MTile, Seat, Wind } from '@mahjong/game-logic';
import { tileId } from '@mahjong/game-logic';
import { type ReactNode, useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { LobbyState } from '../../state/game';
import type { FeltSkin } from '../../state/game';
import { ClaimBar } from '../ClaimBar';
import { Hand } from '../Hand';
import { ResultPanel } from '../ResultPanel';
import { Scoreboard } from '../Scoreboard';
import { Tile } from '../Tile';
import { PrimaryButton } from '../buttons';
import { COLORS } from '../colors';
import { TutorialTarget } from '../tutorial/TargetRegistry';
import { WIND_GLYPH } from '../winds';
import { ChatBubbles } from './ChatBubbles';
import { ClaimAnnouncementToast } from './ClaimAnnouncementToast';
import { ClaimMissedToast } from './ClaimMissedToast';
import { GameStatusBar, WALL_LOW_THRESHOLD } from './GameStatusBar';
import { MatchModals } from './MatchModals';
import { MeldStrip } from './MeldStrip';
import { OppDiscardColumn } from './OppDiscardColumn';
import { OppHandStrip } from './OppHandStrip';
import { ReadyHandBadge } from './ReadyHandBadge';
import { SharedDiscardPool } from './SharedDiscardPool';
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

interface MobileShellProps {
  state: GameState;
  seat: Seat;
  lobby: LobbyState | null;
  matchCode: string | null;
  felt: (typeof FELT_SKINS)[FeltSkin];
  isHost: boolean;
  myTurn: boolean;
  needsDraw: boolean;
  canTsumo: boolean;
  /** Faan the user would score by declaring tsumo right now — surfaced
   *  on the "Declare win" label so they can decide whether to commit.
   *  Null when `canTsumo` is false. */
  tsumoFaan: number | null;
  /** When set, the user's concealed hand has 4 copies of this face;
   *  shows a "Declare gang (concealed)" button next to the tsumo
   *  affordance. */
  concealedGangTile: MTile | null;
  hasClaimOption: boolean;
  /** Seat that would draw next once claims resolve. Drives the
   *  "next about to draw" gold halo on the next-seat's `OppHandStrip`
   *  badge. `null` outside `awaitingClaims`. */
  nextDrawerSeat: Seat | null;
  /** True once `pendingClaims.deadlineMs` has elapsed. */
  aboutToDraw: boolean;
  /** Whole seconds until `hardDeadlineMs` once `softExpiryMs` is crossed. */
  drawCountdown: number | null;
  /** Whole seconds until `state.turnDeadlineMs` for the active seat —
   *  `null` when the rule is off, in solo, or outside `phase: 'turn'`. */
  turnCountdown: number | null;
  latestDiscardId: number | null;
  dealerName: string;
  drawnTileId: number | null;
  /** When non-null, `Hand` highlights the matching `tileId` as the
   *  heuristic ranker's recommended discard. */
  hintTileId: number | null;
  /** Distinct wait faces when the user's concealed hand is at shanten
   *  0 (聽牌). Empty array → no badge rendered. */
  readyWaits: readonly MTile[];
  sortMode: SortMode;
  onSortModeChange: (m: SortMode) => void;
  onAction: (a: Action) => void;
  onLeave: () => void;
  onSendChat: (text: string) => void;
  onTileTap: (t: MTile) => void;
  /** `null` when the layout helper hasn't run (transport between
   *  hands). The shell omits the per-seat strips in that case. */
  byPosition: Record<Position, SeatPlacement> | null;
  seatToPosition: Record<Seat, Position>;
  /** True when the viewport is a landscape phone (width > height but
   *  still below the desktop threshold). Flattens the 3 opponent
   *  strips into a single horizontal row so the discard pool keeps
   *  vertical real estate — vertical-stack opp strips otherwise eat
   *  ~150 px and crush the flex middle to zero on a ~393 px landscape. */
  isLandscape: boolean;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  logOpen: boolean;
  setLogOpen: (open: boolean) => void;
  referenceOpen: boolean;
  setReferenceOpen: (open: boolean) => void;
  scoringOpen: boolean;
  setScoringOpen: (open: boolean) => void;
  playersOpen: boolean;
  setPlayersOpen: (open: boolean) => void;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
}

/**
 * Mobile / portrait match body — vertical stack of opponent hand
 * strips, shared discard pool, own hand. Picked when the viewport
 * is below the desktop threshold checked in `Match.tsx`. Splits
 * out of `Match.tsx` to keep that file as a thin orchestrator;
 * pairs with `DesktopShell.tsx`.
 *
 * The chrome row (GameStatusBar + TopBar) is pinned **above** the
 * ScrollView so it stays reachable on a 320 px iPhone SE where the
 * body content overflows. Placing the row inside the ScrollView
 * lets the browser's `overflow-anchor` adjustment scroll the chrome
 * past the top edge whenever the body grows (e.g. on the
 * waiting → rolling phase transition).
 *
 * The outer felt-coloured `View` wraps the SafeAreaView so the
 * background extends beneath the safe-area inset + below short
 * ScrollView content. Without it, on Android Chrome the area below
 * the URL-bar's retract zone shows the Stack's default cream
 * `contentStyle` through, which reads as a stripe of "white"
 * beneath the felt.
 */
export function MobileShell(props: MobileShellProps) {
  const {
    state,
    seat,
    lobby,
    matchCode,
    felt,
    isHost,
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
    dealerName,
    drawnTileId,
    hintTileId,
    readyWaits,
    sortMode,
    onSortModeChange,
    onAction,
    onLeave,
    onSendChat,
    onTileTap,
    byPosition,
    seatToPosition,
    isLandscape,
    settingsOpen,
    setSettingsOpen,
    logOpen,
    setLogOpen,
    referenceOpen,
    setReferenceOpen,
    scoringOpen,
    setScoringOpen,
    playersOpen,
    setPlayersOpen,
    menuOpen,
    setMenuOpen,
  } = props;

  // Solo's matchCode is the placeholder `'SOLO'`; hide it since the
  // pill #CODE carries no info the user can act on (no one to share
  // it with). Online / LAN matches keep the real code visible.
  const showCode = matchCode !== null && matchCode !== 'SOLO';
  const viewers = lobby?.viewers ?? null;

  // Per-seat discard buckets — three landscape opp columns plus the
  // YOUR DISCARDS rail card would otherwise each re-filter the full
  // `state.discardOrder` (up to 75 tiles) on every shell render.
  const discardsBySeat = useMemo(
    () => bucketDiscardsBySeat(state.discardOrder),
    [state.discardOrder],
  );
  return (
    <View style={{ flex: 1, backgroundColor: felt.top }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: felt.top }} edges={['top', 'bottom']}>
        {!isLandscape ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 12,
              paddingTop: 12,
              // Floor for chrome → first-row separation at the no-scroll
              // start state. The ScrollView's own `padding: 12` adds
              // more on top of this when content scrolls.
              paddingBottom: 8,
              backgroundColor: felt.top,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              <GameStatusBar
                prevailing={state.prevailingWind}
                dealerName={dealerName}
                wallCount={state.wall.length}
                isMyTurn={myTurn}
                turnCountdown={myTurn ? turnCountdown : null}
                onPress={() => setPlayersOpen(true)}
                trailing={
                  <ChromeTrailing showCode={showCode} matchCode={matchCode} viewers={viewers} />
                }
              />
            </View>
            <MenuPill onPress={() => setMenuOpen(true)} />
          </View>
        ) : null}
        {/* Portrait: fixed-top Scoreboard + vertically-stacked opp
            strips above the flex middle, which hosts the shared
            discard pool. Landscape: the opp area moves *into* the
            flex middle as 3 side-by-side columns, each with the
            strip header plus that seat's own discard column inline
            below — the shared centre pool is dropped because the
            per-opp columns already convey the same info with seat
            spatial context preserved. */}
        {isLandscape ? (
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
                <TutorialTarget
                  id="shared-discards"
                  style={{ flex: 1, minHeight: 0, marginTop: 4 }}
                >
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
              dealerName={dealerName}
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
        ) : (
          <>
            <View
              style={{
                paddingHorizontal: 12,
                paddingTop: 4,
                gap: 8,
                backgroundColor: felt.top,
              }}
            >
              <Scoreboard />
              {byPosition ? (
                <View style={{ gap: 6 }}>
                  <SeatRow
                    placement={byPosition.top}
                    state={state}
                    lobby={lobby}
                    aboutToDraw={aboutToDraw && nextDrawerSeat === byPosition.top.seat}
                    drawCountdown={
                      aboutToDraw && nextDrawerSeat === byPosition.top.seat ? drawCountdown : null
                    }
                    turnCountdown={turnCountdown}
                  />
                  <SeatRow
                    placement={byPosition.left}
                    state={state}
                    lobby={lobby}
                    aboutToDraw={aboutToDraw && nextDrawerSeat === byPosition.left.seat}
                    drawCountdown={
                      aboutToDraw && nextDrawerSeat === byPosition.left.seat ? drawCountdown : null
                    }
                    turnCountdown={turnCountdown}
                  />
                  <SeatRow
                    placement={byPosition.right}
                    state={state}
                    lobby={lobby}
                    aboutToDraw={aboutToDraw && nextDrawerSeat === byPosition.right.seat}
                    drawCountdown={
                      aboutToDraw && nextDrawerSeat === byPosition.right.seat ? drawCountdown : null
                    }
                    turnCountdown={turnCountdown}
                  />
                </View>
              ) : null}
            </View>
            <View
              style={{
                flex: 1,
                minHeight: 0,
                paddingHorizontal: 12,
                paddingTop: 8,
                backgroundColor: felt.top,
              }}
            >
              <View
                style={{
                  flex: 1,
                  backgroundColor: felt.bottom,
                  borderColor: 'rgba(255,255,255,0.12)',
                  borderWidth: 1,
                  borderRadius: 12,
                  padding: 8,
                  minHeight: 0,
                }}
              >
                <TutorialTarget id="shared-discards" style={{ flex: 1, minHeight: 0 }}>
                  <SharedDiscardPool
                    discardOrder={state.discardOrder}
                    seatToPosition={seatToPosition}
                    latestId={latestDiscardId}
                  />
                </TutorialTarget>
              </View>
            </View>
          </>
        )}

        {/* Fixed bottom action zone — own melds, sort picker, hand,
            and any active claim / tsumo / gang / result CTAs. Pinned
            so the hand strip never drifts off-screen as the discard
            pool grows. In landscape the claim/tsumo/melds slots are
            hosted by the right rail instead, so this row reduces to
            sort + hand and the hand can extend full-width. */}
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
          {!isLandscape && state.melds[seat].length > 0 ? (
            <View style={{ gap: 4 }}>
              <Text
                style={{
                  fontSize: 10,
                  fontWeight: '800',
                  color: 'rgba(255,255,255,0.7)',
                  letterSpacing: 0.5,
                }}
              >
                YOUR MELDS
              </Text>
              <MeldStrip melds={state.melds[seat]} tileWidth={14} tileHeight={20} />
            </View>
          ) : null}

          {!isLandscape && hasClaimOption ? (
            <TutorialTarget id="claim-bar">
              <ClaimBar onAction={onAction} seat={seat} />
            </TutorialTarget>
          ) : null}

          {!isLandscape && (canTsumo || concealedGangTile) ? (
            <TutorialTarget id="tsumo-button">
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                {canTsumo ? (
                  <PrimaryButton
                    onPress={() => onAction({ t: 'declareWin', seat, selfDraw: true })}
                  >
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

          {/* Portrait: SortPicker sits flush-right above the hand
              so the user can switch sort order mid-hand without
              taking their eyes off the tiles. ReadyHandBadge sits
              flush-left on the same row when the user is tenpai, so
              the badge + picker share one strip instead of pushing
              the hand down. Landscape: hand row centers the tiles
              inside the full-width bottom band with the compact sort
              cycle button flush to the hand's right edge — the
              hand+sort group is centered as one unit. */}
          {!isLandscape ? (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <ReadyHandBadge waits={readyWaits} />
              <View style={{ marginLeft: 'auto' }}>
                <SortPicker mode={sortMode} onChange={onSortModeChange} />
              </View>
            </View>
          ) : null}
          <View
            style={
              isLandscape
                ? {
                    flexDirection: 'row',
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: 8,
                  }
                : undefined
            }
          >
            <TutorialTarget id="own-hand">
              <Hand
                tiles={state.hands[seat]}
                onTileClick={myTurn && state.hasDrawn ? onTileTap : undefined}
                sortMode={sortMode}
                drawnTileId={drawnTileId}
                hintTileId={hintTileId}
                drawCue={
                  needsDraw && state.wall.length > 0
                    ? {
                        tile: state.wall[state.wall.length - 1]!,
                        onPress: () => onAction({ t: 'draw', seat }),
                      }
                    : undefined
                }
              />
            </TutorialTarget>
            {isLandscape ? (
              <SortPicker mode={sortMode} onChange={onSortModeChange} compact />
            ) : null}
          </View>
        </View>

        {/* Floating emote bubbles overlay (absolute-positioned). */}
        <ChatBubbles seatToPosition={seatToPosition} />
        <ClaimMissedToast />
        <ClaimAnnouncementToast />

        {/* ResultPanel — between-hand summary. Lifted out of the
            scrollable middle so it can overlay the felt cleanly when
            present. Wrapped in a ScrollView because in landscape (≤
            ~393 px tall) the panel's win summary + winning hand +
            rule editor + button row are taller than the viewport
            and would otherwise clip top-and-bottom with no way to
            reach the "Start next hand" button. `flexGrow: 1` on the
            content container keeps `justifyContent: 'center'`
            working when the content does fit. */}
        {state.lastResult ? (
          <ScrollView
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              top: 0,
              backgroundColor: 'rgba(0,0,0,0.55)',
            }}
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: 'center',
              padding: 16,
            }}
          >
            <ResultPanel onAction={onAction} mySeat={seat} isHost={isHost} onLeave={onLeave} />
          </ScrollView>
        ) : null}

        {/* The persistent emote bar that lives on the desktop felt is
            folded into `MenuSheet` here — see `onSendChat` below.
            Keeps the mobile body to play-relevant rows only. */}
        <MatchModals
          mySeat={seat}
          settingsOpen={settingsOpen}
          setSettingsOpen={setSettingsOpen}
          logOpen={logOpen}
          setLogOpen={setLogOpen}
          referenceOpen={referenceOpen}
          setReferenceOpen={setReferenceOpen}
          scoringOpen={scoringOpen}
          setScoringOpen={setScoringOpen}
          playersOpen={playersOpen}
          setPlayersOpen={setPlayersOpen}
          menuOpen={menuOpen}
          setMenuOpen={setMenuOpen}
          onLeave={onLeave}
          onSendChat={onSendChat}
        />
      </SafeAreaView>
    </View>
  );
}

interface SeatRowProps {
  placement: SeatPlacement;
  state: GameState;
  lobby: LobbyState | null;
  aboutToDraw: boolean;
  drawCountdown: number | null;
  turnCountdown: number | null;
  compact?: boolean;
}

function SeatRow({
  placement,
  state,
  lobby,
  aboutToDraw,
  drawCountdown,
  turnCountdown,
  compact,
}: SeatRowProps) {
  const isActive = state.turn === placement.seat && state.phase === 'turn';
  return (
    <OppHandStrip
      seat={placement.seat}
      seatWind={placement.seatWind}
      position={placement.position}
      lobby={lobby}
      melds={state.melds[placement.seat]}
      isActive={isActive}
      aboutToDraw={aboutToDraw}
      drawCountdown={drawCountdown}
      turnCountdown={isActive ? turnCountdown : null}
      compact={compact ?? false}
    />
  );
}

interface LandscapeOppColumnProps extends SeatRowProps {
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
  dealerName: string;
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
  dealerName,
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
        prevailing={state.prevailingWind}
        dealerName={dealerName}
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
          <ClaimBar onAction={onAction} seat={seat} />
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
  prevailing: Wind;
  dealerName: string;
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
 * (prevailing wind, dealer name, wall count, your-turn dot, optional
 * #CODE / viewers, turn countdown) but in the shared rail card chrome
 * with the ☰ menu pill inline on the right edge.
 */
function RailStatusCard({
  prevailing,
  dealerName,
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
            backgroundColor: '#ecd9b8',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontFamily: 'Noto Serif TC',
              fontSize: 12,
              fontWeight: '700',
              color: COLORS.red,
            }}
          >
            {WIND_GLYPH[prevailing]}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text
            style={{ fontSize: 11, fontWeight: '800', color: COLORS.ink, letterSpacing: 0.3 }}
            numberOfLines={1}
          >
            {dealerName}
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

interface ChromeTrailingProps {
  showCode: boolean;
  matchCode: string | null;
  viewers: number | null;
}

const TRAILING_COLORS = {
  ink: '#3a3328',
  ink3: '#918275',
  hairline: '#cdc1ad',
  red: '#b14d3a',
};

/**
 * Optional #CODE + viewer count rendered inside `GameStatusBar`'s
 * trailing slot on mobile for online / LAN matches. Solo and
 * code-less matches collapse this away. The ☰ menu button moved out
 * of the bar in 2026-05 — it now sits in a sibling pill on the top
 * right so the GameStatusBar stays one row tall on phone widths.
 */
function ChromeTrailing({ showCode, matchCode, viewers }: ChromeTrailingProps) {
  if (!showCode && !(viewers && viewers > 0)) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {showCode && matchCode ? (
        <Text
          style={{
            fontSize: 11,
            fontWeight: '800',
            color: TRAILING_COLORS.red,
            letterSpacing: 1.2,
          }}
        >
          #{matchCode}
        </Text>
      ) : null}
      {viewers && viewers > 0 ? (
        <Text style={{ fontSize: 11, color: TRAILING_COLORS.ink3, fontWeight: '600' }}>
          👁 {viewers}
        </Text>
      ) : null}
    </View>
  );
}

const MENU_PILL_COLORS = {
  ink: '#3a3328',
  hairline: '#cdc1ad',
};

/**
 * Standalone ☰ pill rendered next to `GameStatusBar` on mobile.
 * Hosts its own background so it can sit outside the status pill
 * — keeping the GameStatusBar a single row even with `YOUR TURN`
 * surfaced.
 */
function MenuPill({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel="Open menu"
      style={({ pressed }) => ({
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 14,
        backgroundColor: pressed ? COLORS.creamLow : 'rgba(255,255,255,0.88)',
        borderColor: MENU_PILL_COLORS.hairline,
        borderWidth: 1,
        boxShadow: '0px 4px 16px rgba(0,0,0,0.1)',
      })}
    >
      <Text style={{ fontSize: 16, fontWeight: '700', color: MENU_PILL_COLORS.ink }}>☰</Text>
    </Pressable>
  );
}
