import type { Action, GameState, Tile as MTile, Seat } from '@mahjong/game-logic';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { LobbyState } from '../../state/game';
import type { FeltSkin } from '../../state/game';
import { ClaimBar } from '../ClaimBar';
import { Hand } from '../Hand';
import { Scoreboard } from '../Scoreboard';
import { PrimaryButton } from '../buttons';
import { COLORS, PANEL_ON_FELT } from '../colors';
import { TutorialTarget } from '../tutorial/TargetRegistry';
import { GameStatusBar } from './GameStatusBar';
import { MeldStrip } from './MeldStrip';
import { SeatRow, YourHandActiveHalo, YourTurnBadge } from './MobileShellShared';
import { ReadyHandBadge } from './ReadyHandBadge';
import { SharedDiscardPool } from './SharedDiscardPool';
import { type SortMode, SortPicker } from './SortPicker';
import type { Position } from './seatColor';
import type { SeatPlacement } from './seatPlacement';
import type { FELT_SKINS } from './skins';

interface PortraitShellProps {
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
  seatToPosition: Record<Seat, Position>;
  setPlayersOpen: (open: boolean) => void;
  setMenuOpen: (open: boolean) => void;
}

/**
 * Portrait-orientation mobile body — top chrome row (status bar + ☰
 * pill), Scoreboard + three vertically-stacked opponent hand strips,
 * shared centre discard pool, then the action band (melds / claim
 * bar / tsumo / sort picker / own hand).
 *
 * Renders a fragment so the parent dispatcher can host the
 * SafeAreaView + overlays + ResultPanel + MatchModals. Pairs with
 * `LandscapeShell` for the alternate orientation, and with
 * `DesktopShell` for the perimeter-felt layout above the desktop
 * viewport threshold.
 */
export function PortraitShell({
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
  seatToPosition,
  setPlayersOpen,
  setMenuOpen,
}: PortraitShellProps): ReactNode {
  // Solo's matchCode is the placeholder `'SOLO'`; hide it since the
  // pill #CODE carries no info the user can act on (no one to share
  // it with). Online / LAN matches keep the real code visible.
  const showCode = matchCode !== null && matchCode !== 'SOLO';
  const viewers = lobby?.viewers ?? null;
  return (
    <>
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
            windGlyph={userWindGlyph}
            windBg={userWindBg}
            windFg={userWindFg}
            name={userName}
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
      <View
        style={{
          paddingHorizontal: 12,
          paddingTop: 4,
          gap: 8,
          backgroundColor: felt.top,
        }}
      >
        {/* Scoreboard is loaded directly by zustand consumers via
         *  useGame, so it doesn't need any props from here. */}
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

      {/* Fixed bottom action zone — own melds, sort picker, hand,
          and any active claim / tsumo / gang / result CTAs. Pinned
          so the hand strip never drifts off-screen as the discard
          pool grows. */}
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
            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
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

        {/* SortPicker sits flush-right above the hand so the user can
            switch sort order mid-hand without taking their eyes off
            the tiles. ReadyHandBadge sits flush-left on the same row
            when the user is tenpai, so the badge + picker share one
            strip instead of pushing the hand down. */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            flexWrap: 'wrap',
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            {myTurn ? <YourTurnBadge needsDraw={needsDraw} /> : null}
            <ReadyHandBadge waits={readyWaits} />
          </View>
          <View style={{ marginLeft: 'auto' }}>
            <SortPicker mode={sortMode} onChange={onSortModeChange} />
          </View>
        </View>
        <TutorialTarget id="own-hand">
          {/* Wrapper picks up the gold breathing halo when it's the
              user's turn — opponents already have this treatment
              (OppHandStrip.ActiveHalo) so the user's hand getting
              the same cue when active makes it obvious which seat
              is on the clock. `position: 'relative'` + 4 px padding
              give the absolute halo room to breathe outward by its
              GROWTH_PX without clipping. */}
          <View style={{ position: 'relative', padding: 4 }}>
            {myTurn ? <YourHandActiveHalo /> : null}
            <Hand
              tiles={state.hands[seat]}
              onTileClick={myTurn && state.hasDrawn ? onTileTap : undefined}
              sortMode={sortMode}
              drawnTileId={drawnTileId}
              hintTileId={hintTileId}
            />
          </View>
        </TutorialTarget>
      </View>
    </>
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
        ...PANEL_ON_FELT,
        ...(pressed ? { backgroundColor: COLORS.creamLow } : null),
      })}
    >
      <Text style={{ fontSize: 16, fontWeight: '700', color: COLORS.ink }}>☰</Text>
    </Pressable>
  );
}
