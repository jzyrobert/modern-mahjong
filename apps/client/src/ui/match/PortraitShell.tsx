import {
  type Action,
  type GameState,
  type Tile as MTile,
  SEATS,
  type Seat,
  seatWindFor,
} from '@mahjong/game-logic';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import type { LobbyState } from '../../state/game';
import type { FeltSkin } from '../../state/game';
import { useGame } from '../../state/game';
import { ClaimBar } from '../ClaimBar';
import { Hand } from '../Hand';
import { PrimaryButton } from '../buttons';
import { COLORS, PANEL_ON_FELT } from '../colors';
import { TutorialTarget } from '../tutorial/TargetRegistry';
import { WIND_GLYPH } from '../winds';
import { GameStatusBar } from './GameStatusBar';
import { MeldStrip } from './MeldStrip';
import { YourHandActiveHalo, YourTurnBadge } from './MobileShellShared';
import { ReadyHandBadge } from './ReadyHandBadge';
import { SharedDiscardPool } from './SharedDiscardPool';
import { type SortMode, SortPicker } from './SortPicker';
import { oppIdentity } from './oppIdentity';
import { type Position, SEAT_COLOR } from './seatColor';
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
 * Portrait-orientation mobile body — top chrome row (combined status
 * pill with inline per-seat scores + ☰ pill), three transparent
 * `DenseOppRow` strips, shared centre discard pool, then the action
 * band (melds / claim bar / tsumo / sort picker / own hand). The
 * standalone `Scoreboard` card is no longer rendered here — its
 * content lives inside the status pill's `inlineScores` slot.
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
            inlineScores={<InlineScores />}
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
        {/* Opponent strips — transparent dense rows (~28 px each) so the
         *  shared discard pool gains the ~60 px previously consumed by
         *  the OppHandStrip cream cards. Bot label sits next to the
         *  name, before the flex spacer, so countdowns stay right-aligned
         *  without competing for prominence with the player identity. */}
        {byPosition ? (
          <View style={{ flexDirection: 'column', gap: 3 }}>
            <DenseOppRow
              placement={byPosition.top}
              state={state}
              lobby={lobby}
              aboutToDraw={aboutToDraw && nextDrawerSeat === byPosition.top.seat}
              drawCountdown={
                aboutToDraw && nextDrawerSeat === byPosition.top.seat ? drawCountdown : null
              }
              turnCountdown={turnCountdown}
            />
            <DenseOppRow
              placement={byPosition.left}
              state={state}
              lobby={lobby}
              aboutToDraw={aboutToDraw && nextDrawerSeat === byPosition.left.seat}
              drawCountdown={
                aboutToDraw && nextDrawerSeat === byPosition.left.seat ? drawCountdown : null
              }
              turnCountdown={turnCountdown}
            />
            <DenseOppRow
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
            {/* Compact YOUR TURN pill (smaller font + width) so it
                shares the row with the slim SortPicker on a 393-px
                portrait viewport without wrapping. */}
            {myTurn ? <YourTurnBadge needsDraw={needsDraw} compact /> : null}
            <ReadyHandBadge waits={readyWaits} />
          </View>
          <View style={{ marginLeft: 'auto' }}>
            {/* Slim segmented picker — shrunk padding + smaller font
                vs. the desktop variant; keeps the three-way affordance
                (suit / num / manual) without collapsing to the
                landscape's single cycle button. */}
            <SortPicker mode={sortMode} onChange={onSortModeChange} slim />
          </View>
        </View>
        <TutorialTarget id="own-hand">
          {/* Wrapper picks up the gold breathing halo when it's the
              user's turn — opponents already have this treatment
              (OppHandStrip.ActiveHalo) so the user's hand getting
              the same cue when active makes it obvious which seat
              is on the clock. Gated on `!needsDraw` so the halo
              only fires once the user has drawn and is choosing
              what to discard — pre-draw the tile-to-discard action
              isn't yet legal and the halo would misleadingly cue
              interaction with the hand. `position: 'relative'` + 4
              px padding give the absolute halo room to breathe
              outward by its GROWTH_PX without clipping. */}
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
 * Inline per-seat score chips rendered inside the GameStatusBar pill,
 * replacing the standalone `Scoreboard` card. Each chip shows the
 * seat's relative wind glyph (anchored to the dealer) and the signed
 * score; the dealer's chip is red, others fade to ink2. Mirrors the
 * "skip when every score is 0" behaviour from `Scoreboard` so the
 * row doesn't carry redundant zeros at the start of a hand. Reads
 * from zustand directly so the host PortraitShell doesn't have to
 * thread scores through props.
 */
function InlineScores() {
  const state = useGame((s) => s.state);
  if (!state) return null;
  const allZero = SEATS.every((s) => state.scoreboard[s] === 0);
  if (allZero) return null;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {SEATS.map((s) => {
        const isDealer = s === state.dealer;
        const seatWind = seatWindFor(state.dealer, s);
        const score = state.scoreboard[s];
        const sign = score >= 0 ? '+' : '';
        return (
          <View key={s} style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
            <Text
              style={{
                fontFamily: 'Noto Serif TC',
                fontSize: 11,
                fontWeight: '700',
                color: isDealer ? COLORS.red : COLORS.ink2,
              }}
            >
              {WIND_GLYPH[seatWind]}
            </Text>
            <Text
              style={{
                fontSize: 10,
                fontWeight: '800',
                color: isDealer ? COLORS.red : COLORS.ink2,
              }}
            >
              {sign}
              {score}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

interface DenseOppRowProps {
  placement: SeatPlacement;
  state: GameState;
  lobby: LobbyState | null;
  aboutToDraw: boolean;
  drawCountdown: number | null;
  turnCountdown: number | null;
}

/**
 * Transparent, single-line opponent row used by the densified portrait
 * layout (Match Alt A). Drops the cream `OppHandStrip` card to ~28 px
 * tall so the shared discard pool's `flex: 1` recovers ~60 px of
 * vertical space across the three opp rows.
 *
 * Active state: subtle red-tinted background + matching border + soft
 * glow. Border stays 1 px in both states so the row doesn't shift by
 * a pixel when the turn rotates.
 *
 * Bot label sits LEFT of the flex spacer next to the name (not
 * right-aligned), so countdowns stay anchored at the right edge
 * without competing with the player identity.
 */
function DenseOppRow({
  placement,
  state,
  lobby,
  aboutToDraw,
  drawCountdown,
  turnCountdown,
}: DenseOppRowProps) {
  const { name, botLabel } = oppIdentity(lobby, placement.seat);
  const seatColor = SEAT_COLOR[placement.position];
  const isActive = state.turn === placement.seat && state.phase === 'turn';
  const meldsForSeat = state.melds[placement.seat];

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: 22,
        gap: 8,
        // Padding stays constant so the row doesn't grow when active —
        // toggling it would shift every neighbour by 12 × 4 px on each
        // turn rotation. The inactive row keeps the same inset; the
        // active visual is carried entirely by background + border colour
        // + box-shadow.
        paddingHorizontal: 6,
        paddingVertical: 2,
        backgroundColor: isActive ? 'rgba(219,93,74,0.16)' : 'transparent',
        borderWidth: 1,
        borderColor: isActive ? 'rgba(219,93,74,0.38)' : 'transparent',
        borderRadius: 8,
        boxShadow: isActive ? '0px 0px 10px rgba(219,93,74,0.28)' : 'none',
      }}
    >
      {/* 3-px seat-colour bar — stays in the seat palette (jade /
          mauve / sky) in every state. The active-turn signal is
          carried by the red halo + tint, not the bar — the user
          asked specifically to keep the bar seat-coloured because a
          red bar duplicates the halo's job and reads as "this seat
          *is* red" rather than "this seat is on the move". */}
      <View
        style={{
          width: 3,
          alignSelf: 'stretch',
          borderRadius: 2,
          backgroundColor: seatColor,
        }}
      />
      <Text
        style={{
          fontFamily: 'Noto Serif TC',
          fontSize: 11,
          fontWeight: '700',
          color: isActive ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.65)',
        }}
      >
        {WIND_GLYPH[placement.seatWind]}
      </Text>
      {/* Fixed-width name slot so the bot-status chip starts at the
          same x-position on every row, regardless of name length —
          a free-flowing layout left the (Easy)/(Passive) chip
          ragged when one seat was "Yu" and another was "Haru".
          Width sized to the widest entry in `BOT_NAME_POOL`
          (capped at <= 4 chars by design): "Haru" / "Vera" / "Niko"
          measure ~28-30 px at 12-px bold Inter, so 44 px holds them
          with a small breathing margin. Rare long human display
          names truncate via `numberOfLines={1}`. If a longer name
          ever joins the pool, bump this and update the pool's
          length-cap comment in lockstep. */}
      <View style={{ width: 44 }}>
        <Text
          style={{
            fontSize: 12,
            fontWeight: '800',
            color: isActive ? 'white' : 'rgba(255,255,255,0.88)',
          }}
          numberOfLines={1}
        >
          {name}
        </Text>
      </View>
      {botLabel ? (
        <Text
          style={{
            fontSize: 9,
            fontWeight: '700',
            color: isActive ? 'rgba(255,255,255,0.55)' : 'rgba(255,255,255,0.36)',
          }}
        >
          {botLabel}
        </Text>
      ) : null}
      <View style={{ flex: 1 }} />
      {isActive && turnCountdown !== null ? (
        <Text style={{ fontSize: 9, fontWeight: '900', color: 'rgba(255,255,255,0.9)' }}>
          {turnCountdown}s left
        </Text>
      ) : null}
      {!isActive && aboutToDraw && drawCountdown !== null ? (
        <Text style={{ fontSize: 9, fontWeight: '800', color: COLORS.gold }}>
          drawing in {drawCountdown}s
        </Text>
      ) : null}
      {meldsForSeat.length > 0 ? (
        <MeldStrip melds={meldsForSeat} tileWidth={10} tileHeight={15} showKindLabel={false} />
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
