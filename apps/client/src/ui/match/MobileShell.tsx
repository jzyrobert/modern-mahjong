import type { Action, GameState, Tile as MTile, Seat } from '@mahjong/game-logic';
import { Pressable, ScrollView, Text, View } from 'react-native';
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
  return (
    <View style={{ flex: 1, backgroundColor: felt.top }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: felt.top }} edges={['top']}>
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
          <View style={{ flex: 1, minWidth: 0 }}>
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
          </View>
          <MenuPill onPress={() => setMenuOpen(true)} />
        </View>
        <ScrollView
          style={{ flex: 1, backgroundColor: felt.top }}
          contentContainerStyle={{ padding: 12, paddingTop: 12, gap: 12 }}
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

          {state.discardOrder.length > 0 ? (
            <View
              style={{
                backgroundColor: felt.bottom,
                borderColor: 'rgba(255,255,255,0.12)',
                borderWidth: 1,
                borderRadius: 12,
                padding: 8,
                gap: 6,
              }}
            >
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: '800',
                  color: 'rgba(255,255,255,0.7)',
                  letterSpacing: 0.5,
                }}
              >
                DISCARDS
              </Text>
              <TutorialTarget id="shared-discards">
                <SharedDiscardPool
                  discardOrder={state.discardOrder}
                  seatToPosition={seatToPosition}
                  latestId={latestDiscardId}
                />
              </TutorialTarget>
            </View>
          ) : null}

          {state.melds[seat].length > 0 ? (
            <View style={{ gap: 4 }}>
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: '800',
                  color: 'rgba(255,255,255,0.7)',
                  letterSpacing: 0.5,
                }}
              >
                YOUR MELDS
              </Text>
              <MeldStrip melds={state.melds[seat]} />
            </View>
          ) : null}

          <View style={{ gap: 6 }}>
            {/* "YOUR HAND" label dropped — the three SortPicker buttons
                (SUIT / NUMBER / MANUAL) are self-describing, the hand
                strip is the bottom-most row of the layout, and the
                label was eating ~16 px before the SortPicker itself
                even rendered. Wrapping flex row dropped along with
                it: only one child remained. */}
            <View style={{ alignSelf: 'flex-end' }}>
              <SortPicker mode={sortMode} onChange={onSortModeChange} />
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

          {canTsumo ? (
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <PrimaryButton onPress={() => onAction({ t: 'declareWin', seat, selfDraw: true })}>
                Declare win (tsumo)
              </PrimaryButton>
            </View>
          ) : null}

          {hasClaimOption ? (
            <TutorialTarget id="claim-bar">
              <ClaimBar onAction={onAction} seat={seat} />
            </TutorialTarget>
          ) : null}

          {state.lastResult ? (
            <ResultPanel onAction={onAction} mySeat={seat} isHost={isHost} />
          ) : null}

          {/* Floating emote bubbles overlay (absolute-positioned). */}
          <ChatBubbles seatToPosition={seatToPosition} />
          <ClaimMissedToast />
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
        </ScrollView>
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
}

function SeatRow({
  placement,
  state,
  lobby,
  aboutToDraw,
  drawCountdown,
  turnCountdown,
}: SeatRowProps) {
  const isActive = state.turn === placement.seat && state.phase === 'turn';
  return (
    <OppHandStrip
      seat={placement.seat}
      seatWind={placement.seatWind}
      lobby={lobby}
      melds={state.melds[placement.seat]}
      isActive={isActive}
      aboutToDraw={aboutToDraw}
      drawCountdown={drawCountdown}
      turnCountdown={isActive ? turnCountdown : null}
    />
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
