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
import { ChatBar } from './ChatBar';
import { ChatBubbles } from './ChatBubbles';
import { ClaimMissedToast } from './ClaimMissedToast';
import { DesktopTable } from './DesktopTable';
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
  dealerName: string;
  drawnTileId: number | null;
  /** When non-null, the user's hand highlights the matching `tileId`
   *  as the heuristic ranker's recommended discard. */
  hintTileId: number | null;
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
  const centerHud: ReactNode = canTsumo ? (
    <PrimaryButton onPress={() => onAction({ t: 'declareWin', seat, selfDraw: true })}>
      Declare win (tsumo)
    </PrimaryButton>
  ) : null;

  return (
    // Outer cream View so the background extends past the bottom
    // safe-area inset (iPad home indicator on tablet-width desktop
    // shells); same pattern as `MobileShell` and `Lobby`.
    <View style={{ flex: 1, backgroundColor: COLORS.cream }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.cream }} edges={['top']}>
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
              prevailing={state.prevailingWind}
              dealerName={dealerName}
              wallCount={state.wall.length}
              isMyTurn={myTurn}
              onPress={() => setPlayersOpen(true)}
            />
            <TopBar
              matchCode={matchCode}
              viewers={lobby?.viewers ?? null}
              onOpenMenu={() => setMenuOpen(true)}
            />
          </View>

          <Scoreboard />

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
            latestDiscardId={latestDiscardId}
            centerHud={centerHud}
            liveWallCount={state.wall.length}
            nextDrawTile={state.wall.length > 0 ? state.wall[state.wall.length - 1]! : null}
            breakPosition={state.openingRolls?.breakPosition}
            onDrawNext={needsDraw ? () => onAction({ t: 'draw', seat }) : undefined}
            nextDrawerSeat={nextDrawerSeat}
            aboutToDraw={aboutToDraw}
            drawCountdown={drawCountdown}
            turnCountdown={turnCountdown}
          />

          {hasClaimOption ? (
            <TutorialTarget id="claim-bar">
              <ClaimBar onAction={onAction} seat={seat} />
            </TutorialTarget>
          ) : null}

          <View style={{ alignItems: 'center', paddingVertical: 4 }}>
            <ChatBar onSend={onSendChat} />
          </View>

          {state.lastResult ? (
            <ResultPanel onAction={onAction} mySeat={seat} isHost={isHost} />
          ) : null}

          <ChatBubbles seatToPosition={seatToPosition} />
          <ClaimMissedToast />
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
          />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
