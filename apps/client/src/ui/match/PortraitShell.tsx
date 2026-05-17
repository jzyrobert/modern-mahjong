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
import { DenseOppRow, YourHandActiveHalo, YourTurnBadge } from './MobileShellShared';
import { ReadyHandBadge } from './ReadyHandBadge';
import { SharedDiscardPool } from './SharedDiscardPool';
import { type SortMode, SortPicker } from './SortPicker';
import type { Position } from './seatColor';
import type { SeatPlacement } from './seatPlacement';
import type { FELT_SKINS } from './skins';

/** Perimeter slots in HK mahjong playing order, starting from the
 *  seat that plays immediately after the user (whose seat sits at
 *  `bottom`). Play moves counter-clockwise: user → right → top →
 *  left → user. Rendering the three opponent rows in this order
 *  means the visual order matches the wind sequence regardless of
 *  who the user is: e.g. North user sees East / South / West
 *  top-to-bottom; South user sees West / North / East. Shared with
 *  `LandscapeShell` so both orientations stay in lockstep. */
const OPP_PLAYING_ORDER: readonly Position[] = ['right', 'top', 'left'];

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
  // Solo's matchCode is the placeholder `'SOLO'`; the trailing chrome
  // renders a `SOLO` badge in its place so the user still knows what
  // kind of match they're in. Online / LAN matches keep the real
  // `#CODE`.
  const showCode = matchCode !== null && matchCode !== 'SOLO';
  const viewers = lobby?.viewers ?? null;
  const hasViewers = viewers !== null && viewers > 0;
  // GameStatusBar prefixes each non-null slot prop with a vertical
  // hairline divider. Only pass the slot when it has visible content,
  // otherwise the divider renders against nothing and the bar shows a
  // stray `│` (most visible on hand 1 solo: `… ∞ │ │ SOLO`).
  const hasScores = SEATS.some((s) => state.scoreboard[s] !== 0);
  const hasTrailing = showCode || matchCode === 'SOLO' || hasViewers;
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
            inlineScores={hasScores ? <InlineScores /> : null}
            trailing={
              hasTrailing ? (
                <ChromeTrailing showCode={showCode} matchCode={matchCode} viewers={viewers} />
              ) : null
            }
          />
        </View>
        <MenuPill onPress={() => setMenuOpen(true)} />
      </View>
      <View
        style={{
          paddingHorizontal: 8,
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
            {OPP_PLAYING_ORDER.map((pos) => {
              const placement = byPosition[pos];
              const seatAbout = aboutToDraw && nextDrawerSeat === placement.seat;
              return (
                <DenseOppRow
                  key={pos}
                  placement={placement}
                  state={state}
                  lobby={lobby}
                  aboutToDraw={seatAbout}
                  drawCountdown={seatAbout ? drawCountdown : null}
                  turnCountdown={turnCountdown}
                />
              );
            })}
          </View>
        ) : null}
      </View>
      <View
        style={{
          flex: 1,
          minHeight: 0,
          // Tightened (12 → 8) so the discard pool inside can host
          // one more tile column on a ~412 CSS-wide phone. The
          // surrounding sections (opponent strips above, bottom
          // action zone below) match this horizontal margin for
          // visual consistency.
          paddingHorizontal: 8,
          // Tightened (8 → 4) so the pool sits closer to the
          // opponent strips above — saves ~4 px of dead felt
          // between the two.
          paddingTop: 4,
          // The visual gap between the pool's cream felt-bottom
          // card and the action zone's top border lives here, on
          // the pool side of the boundary. The action zone's
          // `paddingTop` stays small so its border sits close to
          // its first content row (YOUR MELDS, claim bar, hand,
          // …).
          paddingBottom: 8,
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
            // Tightened (8 → 4) for the same reason — extra
            // horizontal interior so an additional tile column
            // fits on ~412 CSS phones.
            padding: 4,
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
          // Matches the trimmed `paddingHorizontal: 8` on the
          // opponent and discard-pool sections above.
          paddingHorizontal: 8,
          // Small (4) — the breathing room between the pool and
          // the action zone is owned by the pool section's
          // `paddingBottom`, not by this one. Keeping this tight
          // means the action zone's top border sits close to its
          // first content row (YOUR MELDS / claim bar / hand)
          // rather than floating in dead felt.
          paddingTop: 4,
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
 * `#CODE` (online / LAN) or `SOLO` (offline) badge plus the viewer
 * count, rendered inside `GameStatusBar`'s trailing slot on mobile.
 * Truly code-less matches collapse this away. The ☰ menu button
 * moved out of the bar in 2026-05 — it now sits in a sibling pill
 * on the top right so the GameStatusBar stays one row tall on phone
 * widths.
 */
function ChromeTrailing({ showCode, matchCode, viewers }: ChromeTrailingProps) {
  const isSolo = matchCode === 'SOLO';
  const hasViewers = viewers !== null && viewers > 0;
  if (!showCode && !isSolo && !hasViewers) return null;
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
      {/* `SOLO` reads as an identity badge for the offline flow —
          no `#` prefix because there's nothing to share, and the
          ink3 grey instead of the red used for shareable codes
          signals "informational, not actionable". */}
      {isSolo ? (
        <Text
          style={{
            fontSize: 11,
            fontWeight: '800',
            color: TRAILING_COLORS.ink3,
            letterSpacing: 1.2,
          }}
        >
          SOLO
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
