import type { Action, GameState, Tile as MTile, Seat } from '@mahjong/game-logic';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { LobbyState } from '../../state/game';
import type { FeltSkin } from '../../state/game';
import { ClaimBar } from '../ClaimBar';
import { Hand } from '../Hand';
import { ResultPanel } from '../ResultPanel';
import { Scoreboard } from '../Scoreboard';
import { PrimaryButton } from '../buttons';
import { COLORS } from '../colors';
import { TutorialTarget } from '../tutorial/TargetRegistry';
import { ChatBubbles } from './ChatBubbles';
import { ClaimMissedToast } from './ClaimMissedToast';
import { GameStatusBar } from './GameStatusBar';
import { MatchModals } from './MatchModals';
import { MeldStrip } from './MeldStrip';
import { OppDiscardColumn } from './OppDiscardColumn';
import { OppHandStrip } from './OppHandStrip';
import { SharedDiscardPool } from './SharedDiscardPool';
import { type SortMode, SortPicker } from './SortPicker';
import type { Position } from './seatColor';
import type { SeatPlacement } from './seatPlacement';
import type { FELT_SKINS } from './skins';

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

  // Mobile chrome: a single GameStatusBar pill that absorbs the LIVE
  // indicator, optional match code, and ☰ menu button via the
  // `trailing` slot. Two pills (GameStatusBar + standalone TopBar)
  // wrapped onto separate rows on phone-class viewports — see
  // `match-chrome-portrait.spec.ts`. Solo's matchCode is the
  // placeholder string `'SOLO'`; we hide it here since #SOLO carries
  // no info the user can act on (no one to share it with). For online
  // / LAN matches the actual code stays visible.
  const showCode = matchCode !== null && matchCode !== 'SOLO';
  const chromeStatus = (
    <GameStatusBar
      prevailing={state.prevailingWind}
      dealerName={dealerName}
      wallCount={state.wall.length}
      isMyTurn={myTurn}
      turnCountdown={myTurn ? turnCountdown : null}
      onPress={() => setPlayersOpen(true)}
      trailing={
        <ChromeTrailing
          showCode={showCode}
          matchCode={matchCode}
          viewers={lobby?.viewers ?? null}
        />
      }
    />
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
              // Minimum gap below the chrome row so the first scrollable
              // row (`SeatRow` / `OppHandStrip`) doesn't visually butt up
              // against it. The ScrollView's own `padding: 12` adds more
              // on top of this when content scrolls; this floor keeps the
              // chrome → first-row separation honest at the no-scroll
              // start state too.
              paddingBottom: 8,
              backgroundColor: felt.top,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>{chromeStatus}</View>
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
                    <LandscapeOppColumn
                      placement={byPosition.left}
                      state={state}
                      lobby={lobby}
                      aboutToDraw={aboutToDraw && nextDrawerSeat === byPosition.left.seat}
                      drawCountdown={
                        aboutToDraw && nextDrawerSeat === byPosition.left.seat
                          ? drawCountdown
                          : null
                      }
                      turnCountdown={turnCountdown}
                      latestDiscardId={latestDiscardId}
                    />
                    <LandscapeOppColumn
                      placement={byPosition.top}
                      state={state}
                      lobby={lobby}
                      aboutToDraw={aboutToDraw && nextDrawerSeat === byPosition.top.seat}
                      drawCountdown={
                        aboutToDraw && nextDrawerSeat === byPosition.top.seat ? drawCountdown : null
                      }
                      turnCountdown={turnCountdown}
                      latestDiscardId={latestDiscardId}
                    />
                    <LandscapeOppColumn
                      placement={byPosition.right}
                      state={state}
                      lobby={lobby}
                      aboutToDraw={aboutToDraw && nextDrawerSeat === byPosition.right.seat}
                      drawCountdown={
                        aboutToDraw && nextDrawerSeat === byPosition.right.seat
                          ? drawCountdown
                          : null
                      }
                      turnCountdown={turnCountdown}
                      latestDiscardId={latestDiscardId}
                    />
                  </View>
                </TutorialTarget>
              ) : null}
            </View>
            {/* Right rail — chrome status pill at the top (replacing
                the portrait shell's full-width top bar) plus the
                action zone below. In portrait everything sits above
                the hand which steals vertical from the discard pool;
                landscape moves it to a thumb-friendly column so the
                hand strip can extend full-width below. */}
            <LandscapeActionRail
              state={state}
              seat={seat}
              hasClaimOption={hasClaimOption}
              canTsumo={canTsumo}
              tsumoFaan={tsumoFaan}
              concealedGangTile={concealedGangTile}
              onAction={onAction}
              chromeStatus={chromeStatus}
              onOpenMenu={() => setMenuOpen(true)}
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

          {/* The SortPicker sits flush-right above the hand so the
              user can switch sort order mid-hand without taking their
              eyes off the tiles. In landscape the segmented picker
              collapses to a single cycle button — landscape gives the
              user the discoverability they already had on the portrait
              hand-zone bar in earlier sessions. */}
          <View style={{ alignSelf: 'flex-end' }}>
            <SortPicker mode={sortMode} onChange={onSortModeChange} compact={isLandscape} />
          </View>
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
        </View>

        {/* Floating emote bubbles overlay (absolute-positioned). */}
        <ChatBubbles seatToPosition={seatToPosition} />
        <ClaimMissedToast />

        {/* ResultPanel — between-hand summary. Lifted out of the
            scrollable middle so it can overlay the felt cleanly when
            present; the panel handles its own bottom-aligned layout. */}
        {state.lastResult ? (
          <View
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              top: 0,
              justifyContent: 'center',
              padding: 16,
              backgroundColor: 'rgba(0,0,0,0.55)',
            }}
            pointerEvents="box-none"
          >
            <ResultPanel onAction={onAction} mySeat={seat} isHost={isHost} onLeave={onLeave} />
          </View>
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
  latestDiscardId: number | null;
}

/**
 * Landscape opponent column — `OppHandStrip` header at the top with
 * this seat's own discard pile flex-grown below it. Three of these
 * sit side-by-side in the landscape flex middle (replacing the
 * shared centre discard pool), so opponent discards live spatially
 * next to the player who threw them — closer to a physical mahjong
 * table than the chronological centre pool.
 */
function LandscapeOppColumn({
  placement,
  state,
  lobby,
  aboutToDraw,
  drawCountdown,
  turnCountdown,
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
        seat={placement.seat}
        position={placement.position}
        discardOrder={state.discardOrder}
        latestId={latestDiscardId}
      />
    </View>
  );
}

interface LandscapeActionRailProps {
  state: GameState;
  seat: Seat;
  hasClaimOption: boolean;
  canTsumo: boolean;
  tsumoFaan: number | null;
  concealedGangTile: MTile | null;
  onAction: (a: Action) => void;
  /** Pre-rendered status pill (prevailing wind / dealer / wall count /
   *  your-turn dot). The shell folds the portrait shell's top chrome
   *  bar into the rail in landscape so the band above the discard
   *  area can disappear entirely. */
  chromeStatus: ReactNode;
  onOpenMenu: () => void;
}

/**
 * Landscape-only right-edge column for the chrome status pill, the
 * claim bar, tsumo/gang CTAs, and own melds. In portrait these stack
 * above the hand, which is fine because the hand row only needs
 * ~50 px of width margin; in landscape the same stack would steal
 * half the discard area's height for buttons that the user only
 * touches a few times per hand. Moving them to a thumb-friendly
 * right rail lets the discard columns extend down to the hand strip
 * uninterrupted.
 */
function LandscapeActionRail({
  state,
  seat,
  hasClaimOption,
  canTsumo,
  tsumoFaan,
  concealedGangTile,
  onAction,
  chromeStatus,
  onOpenMenu,
}: LandscapeActionRailProps) {
  return (
    <View style={{ width: 200, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ flex: 1, minWidth: 0 }}>{chromeStatus}</View>
        <MenuPill onPress={onOpenMenu} />
      </View>
      {state.melds[seat].length > 0 ? (
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
