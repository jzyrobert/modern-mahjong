import type { Action, GameState, Tile as MTile, Seat, Wind } from '@mahjong/game-logic';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { LobbyState } from '../../state/game';
import type { FeltSkin } from '../../state/game';
import { ClaimBar } from '../ClaimBar';
import { Hand } from '../Hand';
import { ResultPanel } from '../ResultPanel';
import { Scoreboard } from '../Scoreboard';
import { PrimaryButton } from '../buttons';
import { ChatBubbles } from './ChatBubbles';
import { GameStatusBar } from './GameStatusBar';
import { MatchModals } from './MatchModals';
import { MeldStrip } from './MeldStrip';
import { OppHandStrip } from './OppHandStrip';
import { SharedDiscardPool } from './SharedDiscardPool';
import { type SortMode, SortPicker } from './SortPicker';
import type { FELT_SKINS } from './skins';

type Position = 'bottom' | 'right' | 'top' | 'left';

interface SeatPlacement {
  seat: Seat;
  position: Position;
  seatWind: Wind;
}

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
            paddingHorizontal: 12,
            paddingTop: 12,
            backgroundColor: felt.top,
          }}
        >
          <GameStatusBar
            prevailing={state.prevailingWind}
            dealerName={dealerName}
            wallCount={state.wall.length}
            isMyTurn={myTurn}
            onPress={() => setPlayersOpen(true)}
            trailing={
              <ChromeTrailing
                showCode={showCode}
                matchCode={matchCode}
                viewers={lobby?.viewers ?? null}
                onOpenMenu={() => setMenuOpen(true)}
              />
            }
          />
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
              />
              <SeatRow
                placement={byPosition.left}
                state={state}
                lobby={lobby}
                aboutToDraw={aboutToDraw && nextDrawerSeat === byPosition.left.seat}
                drawCountdown={
                  aboutToDraw && nextDrawerSeat === byPosition.left.seat ? drawCountdown : null
                }
              />
              <SeatRow
                placement={byPosition.right}
                state={state}
                lobby={lobby}
                aboutToDraw={aboutToDraw && nextDrawerSeat === byPosition.right.seat}
                drawCountdown={
                  aboutToDraw && nextDrawerSeat === byPosition.right.seat ? drawCountdown : null
                }
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
              <SharedDiscardPool
                discardOrder={state.discardOrder}
                seatToPosition={seatToPosition}
                latestId={latestDiscardId}
              />
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
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <Text
                style={{
                  fontSize: 11,
                  fontWeight: '800',
                  color: 'rgba(255,255,255,0.7)',
                  letterSpacing: 0.5,
                }}
              >
                YOUR HAND
              </Text>
              <SortPicker mode={sortMode} onChange={onSortModeChange} />
            </View>
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
          </View>

          {canTsumo ? (
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
              <PrimaryButton onPress={() => onAction({ t: 'declareWin', seat, selfDraw: true })}>
                Declare win (tsumo)
              </PrimaryButton>
            </View>
          ) : null}

          {hasClaimOption ? <ClaimBar onAction={onAction} seat={seat} /> : null}

          {state.lastResult ? (
            <ResultPanel onAction={onAction} mySeat={seat} isHost={isHost} />
          ) : null}

          {/* Floating emote bubbles overlay (absolute-positioned). */}
          <ChatBubbles seatToPosition={seatToPosition} />
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
}

function SeatRow({ placement, state, lobby, aboutToDraw, drawCountdown }: SeatRowProps) {
  const isActive = state.turn === placement.seat && state.phase === 'turn';
  const handBacks = state.hands[placement.seat].length;
  return (
    <View style={{ gap: 4 }}>
      <OppHandStrip
        seat={placement.seat}
        seatWind={placement.seatWind}
        lobby={lobby}
        handBacks={handBacks}
        isActive={isActive}
        aboutToDraw={aboutToDraw}
        drawCountdown={drawCountdown}
      />
      {state.melds[placement.seat].length > 0 ? (
        <MeldStrip melds={state.melds[placement.seat]} tileWidth={14} tileHeight={20} />
      ) : null}
    </View>
  );
}

interface ChromeTrailingProps {
  showCode: boolean;
  matchCode: string | null;
  viewers: number | null;
  onOpenMenu: () => void;
}

const TRAILING_COLORS = {
  ink: '#3a3328',
  ink3: '#918275',
  hairline: '#cdc1ad',
  red: '#b14d3a',
  green: '#58c280',
};

/**
 * Compact LIVE indicator + optional #CODE + ☰ menu button rendered
 * inside `GameStatusBar`'s trailing slot on mobile. Same content as
 * the standalone `TopBar` on desktop, but without its own pill
 * background — the parent pill already provides one.
 */
function ChromeTrailing({ showCode, matchCode, viewers, onOpenMenu }: ChromeTrailingProps) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View
        style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: TRAILING_COLORS.green }}
      />
      <Text
        style={{ fontSize: 10, fontWeight: '800', color: TRAILING_COLORS.ink, letterSpacing: 0.4 }}
      >
        LIVE
      </Text>
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
      <Pressable
        onPress={onOpenMenu}
        accessibilityLabel="Open menu"
        style={({ pressed }) => ({
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: 8,
          backgroundColor: pressed ? '#ece4d3' : 'transparent',
          borderColor: TRAILING_COLORS.hairline,
          borderWidth: 1,
        })}
      >
        <Text style={{ fontSize: 14, fontWeight: '700', color: TRAILING_COLORS.ink }}>☰</Text>
      </Pressable>
    </View>
  );
}
