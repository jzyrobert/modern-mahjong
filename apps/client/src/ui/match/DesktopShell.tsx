import type { Action, Tile as MTile, Seat } from '@mahjong/game-logic';
import type { GameState } from '@mahjong/game-logic';
import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { LobbyState } from '../../state/game';
import { ClaimBar } from '../ClaimBar';
import { ResultPanel } from '../ResultPanel';
import { Scoreboard } from '../Scoreboard';
import { PrimaryButton } from '../buttons';
import { COLORS } from '../colors';
import { TutorialTarget } from '../tutorial/TargetRegistry';
// `ChatBar` import removed while the reaction system is being reworked
// (the persistent emote bar is commented out below). Re-add when the
// new reaction surface lands.
// import { ChatBar } from './ChatBar';
import { ChatBubbles } from './ChatBubbles';
import { ClaimAnnouncementToast } from './ClaimAnnouncementToast';
import { ClaimMissedToast } from './ClaimMissedToast';
import { DesktopTable } from './DesktopTable';
import { DrawTileOverlay } from './DrawTileOverlay';
import { GameStatusBar } from './GameStatusBar';
import { MatchModals } from './MatchModals';
import type { SortMode } from './SortPicker';
import { TopBar } from './TopBar';
import type { Position } from './seatColor';

interface DesktopShellProps {
  /** Validated by `Match.tsx` to be non-null + non-`'spectator'`. */
  state: GameState;
  seat: Seat;
  lobby: LobbyState | null;
  matchCode: string | null;
  isHost: boolean;
  myTurn: boolean;
  needsDraw: boolean;
  canTsumo: boolean;
  /** Faan the user would score by declaring tsumo right now — surfaced
   *  on the "Declare win" label so they can decide whether to commit.
   *  Null when `canTsumo` is false. */
  tsumoFaan: number | null;
  concealedGangTile: MTile | null;
  hasClaimOption: boolean;
  /** Seat that would draw next once claims resolve. Populated only
   *  during `awaitingClaims`. Drives the "next about to draw" gold
   *  halo on `PlayerBadge` once `aboutToDraw` is true. */
  nextDrawerSeat: Seat | null;
  /** True once the soft floor (`pendingClaims.deadlineMs`) has
   *  elapsed — the cue moment. Solo never sets it (infinite window). */
  aboutToDraw: boolean;
  /** Whole seconds remaining until `hardDeadlineMs` once `softExpiryMs`
   *  is crossed. Null before windup or in solo. */
  drawCountdown: number | null;
  /** Whole seconds remaining until the active seat's
   *  `state.turnDeadlineMs`. Null when the rule is off, in solo, or
   *  outside `phase: 'turn'`. */
  turnCountdown: number | null;
  latestDiscardId: number | null;
  userName: string;
  userWindGlyph: string;
  userWindBg: string;
  userWindFg: string;
  drawnTileId: number | null;
  /** When non-null, the user's hand highlights the matching `tileId`
   *  as the heuristic ranker's recommended discard. */
  hintTileId: number | null;
  /** Distinct wait faces when the user's concealed hand is at shanten 0
   *  (聽牌). Empty array means no badge. Computed in `Match.tsx`. */
  readyWaits: readonly MTile[];
  sortMode: SortMode;
  onSortModeChange: (m: SortMode) => void;
  onAction: (a: Action) => void;
  onLeave: () => void;
  onSendChat: (text: string) => void;
  onTileTap: (t: MTile) => void;
  /** Position lookup for `ChatBubbles`'s positioning logic. */
  seatToPosition: Record<Seat, Position>;
  /** Modal state — owned by `Match.tsx` so the modal lifetime is
   *  decoupled from the shell switch (i.e. flipping orientations
   *  doesn't slam the modals shut). */
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
 * Desktop / large-tablet match body — perimeter felt with seats around
 * the edges. Picked when the viewport clears the desktop threshold
 * checked in `Match.tsx`. The chrome (GameStatusBar + TopBar) lives
 * inside the ScrollView since horizontal real estate isn't tight on
 * desktop and the SafeAreaView already keeps it on-screen.
 *
 * Splits out of `Match.tsx` to keep that file as a thin orchestrator;
 * pairs with `MobileShell.tsx`. State + computed values are owned by
 * `Match.tsx` and passed as props.
 */
export function DesktopShell(props: DesktopShellProps) {
  const {
    state,
    seat,
    lobby,
    matchCode,
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
    onLeave,
    onSendChat,
    onTileTap,
    seatToPosition,
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

  // The desktop center HUD only shows the tsumo button (when winning)
  // or nothing. The legacy `<DrawCue>` is redundant on this layout —
  // `WallEdge` already wraps the next-draw stack with a pulsing halo
  // + the `wall-draw-next` testID + the click handler; rendering
  // `DrawCue` here too would surface a second `wall-draw-next`
  // element and break Playwright's strict locator.
  const centerHud: ReactNode =
    canTsumo || concealedGangTile ? (
      <TutorialTarget id="tsumo-button">
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {canTsumo ? (
            <PrimaryButton onPress={() => onAction({ t: 'declareWin', seat, selfDraw: true })}>
              {tsumoFaan !== null
                ? `Declare win (tsumo, ${tsumoFaan} faan)`
                : 'Declare win (tsumo)'}
            </PrimaryButton>
          ) : null}
          {concealedGangTile ? (
            <PrimaryButton
              onPress={() => onAction({ t: 'declareGangConcealed', seat, tile: concealedGangTile })}
            >
              Declare gang
            </PrimaryButton>
          ) : null}
        </View>
      </TutorialTarget>
    ) : null;

  return (
    // Outer cream View so the background extends past the bottom
    // safe-area inset (iPad home indicator on tablet-width desktop
    // shells); same pattern as `MobileShell` and `Lobby`.
    <View style={{ flex: 1, backgroundColor: COLORS.cream }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.cream }} edges={['top', 'bottom']}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            padding: 16,
            gap: 12,
            maxWidth: 1320,
            alignSelf: 'center',
            width: '100%',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 8,
            }}
          >
            <GameStatusBar
              windGlyph={userWindGlyph}
              windBg={userWindBg}
              windFg={userWindFg}
              name={userName}
              wallCount={state.wall.length}
              isMyTurn={myTurn}
              onPress={() => setPlayersOpen(true)}
            />
            <TopBar
              matchCode={matchCode}
              viewers={lobby?.viewers ?? null}
              onOpenMenu={() => setMenuOpen(true)}
              menuOpen={menuOpen}
            />
          </View>

          <Scoreboard />

          {/* DesktopTable is wrapped in a position:relative container so
              the ClaimBar V2 can sit as an absolute overlay anchored to
              the felt's right edge instead of below it. The handoff
              moved the bar off the page flow so it overlaps the right
              discard pile area — actionable but doesn't push hand
              chrome down. `pointerEvents: 'box-none'` on the wrapper
              lets taps fall through to discards underneath; the inner
              ClaimBar still receives its own. */}
          <View style={{ position: 'relative' }}>
            <DesktopTable
              mySeat={seat}
              dealer={state.dealer}
              turn={state.turn}
              phase={state.phase}
              hands={state.hands}
              melds={state.melds}
              discards={state.discards}
              scoreboard={state.scoreboard}
              lobby={lobby}
              ownHandClickable={myTurn && state.hasDrawn ? onTileTap : undefined}
              sortMode={sortMode}
              onSortModeChange={onSortModeChange}
              drawnTileId={drawnTileId}
              hintTileId={hintTileId}
              readyWaits={readyWaits}
              latestDiscardId={latestDiscardId}
              centerHud={centerHud}
              liveWallCount={state.wall.length}
              nextDrawTile={state.wall.length > 0 ? state.wall[state.wall.length - 1]! : null}
              breakPosition={state.openingRolls?.breakPosition}
              onDrawNext={needsDraw ? () => onAction({ t: 'draw', seat }) : undefined}
              needsDraw={needsDraw}
              nextDrawerSeat={nextDrawerSeat}
              aboutToDraw={aboutToDraw}
              drawCountdown={drawCountdown}
              turnCountdown={turnCountdown}
            />
            {hasClaimOption ? (
              <View
                pointerEvents="box-none"
                style={{
                  position: 'absolute',
                  right: 12,
                  top: 0,
                  bottom: 0,
                  width: 260,
                  zIndex: 10,
                  justifyContent: 'center',
                  alignItems: 'stretch',
                }}
              >
                {/* Wrap the bar in a ScrollView so a tall variant (multi-chi
                    chip picker stacking 2-3 chip rows in the vertical
                    column) stays reachable when the felt's intrinsic
                    height is short — typically at the ~768 × 600 desktop
                    threshold. Without it, content overflowing the
                    vertically-centred container would clip the bottom
                    of the column (the Pass button) and leave the user
                    unable to dismiss the claim. `flexGrow: 1 +
                    justifyContent: center` preserves the centred read
                    when content fits. */}
                <ScrollView
                  showsVerticalScrollIndicator={false}
                  style={{ maxHeight: '100%' }}
                  contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
                >
                  <TutorialTarget id="claim-bar">
                    <ClaimBar onAction={onAction} seat={seat} orientation="desktop" />
                  </TutorialTarget>
                </ScrollView>
              </View>
            ) : null}
          </View>

          {/* Persistent emote bar temporarily disabled — the reaction
              system is being reworked. Re-enable (or replace with the
              new reaction surface) once the redesign lands. */}
          {/*
          <View style={{ alignItems: 'center', paddingVertical: 4 }}>
            <ChatBar onSend={onSendChat} />
          </View>
          */}

          <ChatBubbles seatToPosition={seatToPosition} />
          <ClaimMissedToast />
          <ClaimAnnouncementToast />
        </ScrollView>

        {/* DrawTileOverlay lives OUTSIDE the ScrollView so its
            absolute-positioned wrapper anchors to the SafeAreaView at
            viewport (0, 0), not to the ScrollView's centered content
            area (which on wide viewports is offset by ((vw - 1320) /
            2) px). The overlay's translateX/Y values come from
            `measureInWindow` (viewport coords) — they have to be
            applied in a coord system that matches, otherwise the
            popup lands offset by the content-area's left padding. */}
        <DrawTileOverlay />

        {/* ResultPanel — between-hand summary, lifted out of the
            ScrollView so it overlays the felt + chrome with a scrim
            instead of sitting inline below the table. Same modal
            treatment MobileShell uses; on tall desktop windows the
            inline placement could otherwise put the "Start next
            hand" controls below the fold without a clear cue that
            interaction has paused. Wrapped in a ScrollView so a
            long winning-hand summary (especially on narrow desktop
            widths near the 768 px threshold) stays reachable. */}
        {state.lastResult ? (
          <ScrollView
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              backgroundColor: 'rgba(0,0,0,0.55)',
            }}
            contentContainerStyle={{
              flexGrow: 1,
              justifyContent: 'center',
              alignItems: 'center',
              padding: 16,
            }}
          >
            {/* Constrain the panel to ~60% of the viewport so the
                winning-hand + breakdown column doesn't sprawl across
                a 1920-px desktop. Mobile keeps the full-width
                treatment — the bounded width is desktop-only because
                the scrim renders here. `maxWidth` caps it on ultra-
                wide monitors; `minWidth` keeps the 13-tile winning
                hand row from wrapping on narrow desktops near the
                768-px breakpoint. */}
            <View style={{ width: '60%', minWidth: 480, maxWidth: 720 }}>
              <ResultPanel onAction={onAction} mySeat={seat} isHost={isHost} onLeave={onLeave} />
            </View>
          </ScrollView>
        ) : null}

        {/* MatchModals lives outside the ScrollView so its bottom
            sheets z-order above the ResultPanel overlay — matches the
            mobile-shell tree order. */}
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
          menuVariant="sidePanel"
        />
      </SafeAreaView>
    </View>
  );
}
