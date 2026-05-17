import type { Action, GameState, Tile as MTile, Seat } from '@mahjong/game-logic';
import { seatWindFor } from '@mahjong/game-logic';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { nameForSeat } from '../../state/game';
import type { LobbyState } from '../../state/game';
import type { FeltSkin } from '../../state/game';
import { ClaimBar } from '../ClaimBar';
import { Hand } from '../Hand';
import { Tile } from '../Tile';
import { PrimaryButton } from '../buttons';
import { COLORS, PANEL_ON_FELT } from '../colors';
import { TutorialTarget } from '../tutorial/TargetRegistry';
import { WIND_GLYPH, WIND_NAME } from '../winds';
import { STATUS_LOW_WALL_RED, WALL_LOW_THRESHOLD } from './GameStatusBar';
import { MeldStrip } from './MeldStrip';
import {
  DenseOppRow,
  OPP_PLAYING_ORDER,
  YourHandActiveHalo,
  YourTurnBadge,
} from './MobileShellShared';
import { SharedDiscardPool } from './SharedDiscardPool';
import { type SortMode, SortPicker } from './SortPicker';
import { type Position, SEAT_COLOR } from './seatColor';
import type { SeatPlacement } from './seatPlacement';
import type { FELT_SKINS } from './skins';

/** Right-rail width — fixed so the SharedDiscardPool's flex middle
 *  doesn't reflow when the rail's content changes (claim takeover,
 *  tsumo CTA appearing, melds growing). 190 px matches the Alt D
 *  handoff spec. */
const RAIL_WIDTH = 190;

const RAIL_CARD = {
  backgroundColor: COLORS.paperHi,
  borderColor: COLORS.hairline,
  borderWidth: 1,
  borderRadius: 12,
  boxShadow: '0px 4px 12px rgba(0,0,0,0.08)',
} as const;

const RAIL_SECTION_LABEL_STYLE = {
  fontSize: 9,
  fontWeight: '800' as const,
  color: COLORS.ink3,
  letterSpacing: 0.6,
  marginBottom: 4,
};

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
 * Landscape-orientation mobile body — "Match Alt D" layout.
 *
 *   ┌─ chrome row ─────────────────────────────────────────────────┐
 *   │ ☰  [Top opp][Left opp][Right opp]                            │
 *   ├──────────────────────────────────────────────┬───────────────┤
 *   │                                              │               │
 *   │   SharedDiscardPool                          │   Right rail  │
 *   │   (Order / Player toggle, unified            │   (InfoRail   │
 *   │    centre pool with seat-coloured            │    or full-   │
 *   │    underlines)                               │    height     │
 *   │                                              │    ClaimBar)  │
 *   ├──────────────────────────────────────────────┴───────────────┤
 *   │       [Hand tiles × 13 + drawn]   [⇅ SUIT picker]            │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * The previous landscape layout stacked a `Scoreboard` card + 3
 * opponent columns (each with their own per-seat discard pile) on
 * the left. Match Alt D collapses the per-seat discards into the
 * shared centre pool (`SharedDiscardPool`, the same component portrait
 * uses) and folds the per-seat identity info into the chrome row's
 * `DenseOppRow` strips at the top. The right rail switches between an
 * `LandscapeInfoRail` (self identity + round state + own melds +
 * tenpai/empty) and a full-height `ClaimBar` when a claim window is
 * open.
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
}: LandscapeShellProps): ReactNode {
  const viewers = lobby?.viewers ?? null;
  const dealerName = nameForSeat(lobby, state.dealer);

  return (
    <>
      {/* Top chrome row — ☰ menu pill on the left, three equal-flex
          DenseOppRow strips for the opponent identities. Replaces the
          previous landscape `Scoreboard` + `OppHandStrip` headers
          above the opp discard columns. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingTop: 6,
          paddingBottom: 4,
          gap: 6,
        }}
      >
        <Pressable
          onPress={() => setMenuOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="Open menu"
          style={({ pressed }) => ({
            paddingHorizontal: 10,
            paddingVertical: 6,
            ...PANEL_ON_FELT,
            ...(pressed ? { backgroundColor: COLORS.creamLow } : null),
          })}
        >
          <Text style={{ fontSize: 15, fontWeight: '700', color: COLORS.ink }}>☰</Text>
        </Pressable>
        {byPosition ? (
          <View style={{ flex: 1, flexDirection: 'row', gap: 6 }}>
            {OPP_PLAYING_ORDER.map((pos) => {
              const placement = byPosition[pos];
              const seatAbout = aboutToDraw && nextDrawerSeat === placement.seat;
              return (
                <View key={pos} style={{ flex: 1, minWidth: 0 }}>
                  <DenseOppRow
                    placement={placement}
                    state={state}
                    lobby={lobby}
                    aboutToDraw={seatAbout}
                    drawCountdown={seatAbout ? drawCountdown : null}
                    turnCountdown={turnCountdown}
                  />
                </View>
              );
            })}
          </View>
        ) : null}
      </View>

      {/* Middle — flex row: SharedDiscardPool (left, flex:1) +
          fixed-width right rail. The InfoRail collapses into a
          full-height ClaimBar when a claim window is open. */}
      <View
        style={{
          flex: 1,
          minHeight: 0,
          flexDirection: 'row',
          paddingHorizontal: 12,
          paddingTop: 2,
          paddingBottom: 4,
          gap: 8,
          backgroundColor: felt.top,
        }}
      >
        <View
          style={{
            flex: 1,
            minHeight: 0,
            backgroundColor: felt.bottom,
            borderColor: 'rgba(255,255,255,0.12)',
            borderWidth: 1,
            borderRadius: 12,
            padding: 6,
            // Relative parent for the absolute-positioned tsumo /
            // gang overlay below — the overlay anchors over the
            // discard pool's lower edge so it sits above the hand
            // row visually without competing for InfoRail space.
            position: 'relative',
          }}
        >
          <TutorialTarget id="shared-discards" style={{ flex: 1, minHeight: 0 }}>
            <SharedDiscardPool
              discardOrder={state.discardOrder}
              seatToPosition={seatToPosition}
              latestId={latestDiscardId}
            />
          </TutorialTarget>
          {canTsumo || concealedGangTile ? (
            <TutorialTarget
              id="tsumo-button"
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                bottom: 8,
                alignItems: 'center',
                pointerEvents: 'box-none',
              }}
            >
              <View
                pointerEvents="box-none"
                style={{
                  flexDirection: 'row',
                  gap: 8,
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                }}
              >
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
        </View>
        <View style={{ width: RAIL_WIDTH, minHeight: 0 }}>
          {hasClaimOption ? (
            <TutorialTarget id="claim-bar" style={{ flex: 1, minHeight: 0 }}>
              <ClaimBar onAction={onAction} seat={seat} orientation="landscape" />
            </TutorialTarget>
          ) : (
            <LandscapeInfoRail
              state={state}
              seat={seat}
              myTurn={myTurn}
              turnCountdown={turnCountdown}
              userName={userName}
              userWindGlyph={userWindGlyph}
              matchCode={matchCode}
              viewers={viewers}
              dealerName={dealerName}
              readyWaits={readyWaits}
              onOpenPlayers={() => setPlayersOpen(true)}
            />
          )}
        </View>
      </View>

      {/* Bottom action zone — YOUR TURN pill flush-left of the hand
          row when active, hand centred via flex, compact sort picker
          flush-right. The claim / tsumo / melds slots live in the
          right rail in landscape, so this row stays minimal. */}
      <View
        style={{
          paddingHorizontal: 12,
          paddingTop: 6,
          paddingBottom: 4,
          gap: 6,
          backgroundColor: felt.top,
          borderTopColor: 'rgba(0,0,0,0.12)',
          borderTopWidth: 1,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
          }}
        >
          {/* Left slot — YOUR TURN pill or empty spacer matched to the
              compact sort picker on the right so the hand stays
              centred on the row regardless of whether the pill is
              showing. */}
          {/* Left/right slot widths are 88px each — deliberately
              narrower than `YOUR_TURN_BADGE_WIDTH` (160) so the
              non-compact YourTurnBadge can overflow its slot if
              needed without pushing the hand off-centre. The 88px
              floor matches the compact SortPicker pill's outer
              width on the right, so both sides reserve the same
              space and the hand stays centred whether or not the
              badge / picker has visible content. */}
          <View style={{ minWidth: 88, alignItems: 'flex-start' }}>
            {myTurn ? <YourTurnBadge needsDraw={needsDraw} /> : null}
          </View>
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
            <TutorialTarget id="own-hand">
              {/* `position: 'relative'` + 4 px padding give the
                  absolute halo room to breathe outward by GROWTH_PX
                  without clipping. */}
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
          <View style={{ minWidth: 88, alignItems: 'flex-end' }}>
            <SortPicker mode={sortMode} onChange={onSortModeChange} compact />
          </View>
        </View>
      </View>
    </>
  );
}

interface LandscapeInfoRailProps {
  state: GameState;
  seat: Seat;
  myTurn: boolean;
  turnCountdown: number | null;
  userName: string;
  userWindGlyph: string;
  matchCode: string | null;
  viewers: number | null;
  dealerName: string;
  readyWaits: readonly MTile[];
  onOpenPlayers: () => void;
}

/**
 * Idle right-rail content — cream card with four stacked sections:
 *
 *  1. Self player card — coral bar + user's wind glyph + name +
 *     #CODE / SOLO badge (or viewer count). Tappable, opens the
 *     players sheet.
 *  2. ROUND — prevailing wind ring with localised name, wall depth
 *     (red when low), and dealer name.
 *  3. YOUR MELDS — small inline `MeldStrip` of the user's exposed
 *     melds (only rendered when melds.length > 0).
 *  4. Bottom — either:
 *       - the TENPAI · WAITING ON pill with wait-tile glyphs when the
 *         user is on the move and shanten 0, or
 *       - empty (no scores here — the player card's #CODE already
 *         carries the game context per the Alt D spec).
 *
 * Claim windows hide this rail entirely (see the parent shell) and
 * replace it with the full-height `ClaimBar` so the user's attention
 * belongs on the claim decision.
 */
function LandscapeInfoRail({
  state,
  seat,
  myTurn,
  turnCountdown,
  userName,
  userWindGlyph,
  matchCode,
  viewers,
  dealerName,
  readyWaits,
  onOpenPlayers,
}: LandscapeInfoRailProps) {
  const showCode = matchCode !== null && matchCode !== 'SOLO';
  const isSolo = matchCode === 'SOLO';
  const hasViewers = viewers !== null && viewers > 0;
  const lowWall = state.wall.length <= WALL_LOW_THRESHOLD;
  const ownMelds = state.melds[seat];
  const prevailingGlyph = WIND_GLYPH[state.prevailingWind];
  const prevailingName = WIND_NAME[state.prevailingWind];
  const userSeatWind = seatWindFor(state.dealer, seat);
  return (
    <ScrollView
      style={{
        ...RAIL_CARD,
        flex: 1,
        minHeight: 0,
      }}
      contentContainerStyle={{
        padding: 8,
        gap: 8,
      }}
      showsVerticalScrollIndicator={false}
    >
      {/* Self player card */}
      <Pressable
        onPress={onOpenPlayers}
        accessibilityRole="button"
        accessibilityLabel="Open players panel"
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingVertical: 6,
          paddingHorizontal: 8,
          backgroundColor: pressed ? COLORS.cream : COLORS.creamLow,
          borderRadius: 8,
          borderWidth: 1,
          borderColor: COLORS.hairline,
        })}
      >
        {/* Coral seat-bar — the user always sits at the bottom-position,
            so the bar reads the user's own seat colour. */}
        <View
          style={{
            width: 3,
            alignSelf: 'stretch',
            borderRadius: 2,
            backgroundColor: SEAT_COLOR.bottom,
          }}
        />
        <Text
          style={{
            fontFamily: 'Noto Serif TC',
            fontSize: 12,
            fontWeight: '700',
            color: COLORS.red,
          }}
        >
          {userWindGlyph}
        </Text>
        <Text
          style={{ fontSize: 12, fontWeight: '800', color: COLORS.ink, flex: 1, minWidth: 0 }}
          numberOfLines={1}
        >
          {userName}
        </Text>
        {myTurn ? (
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
        {myTurn ? (
          <Text
            accessibilityLabel={
              turnCountdown !== null
                ? `${turnCountdown} seconds left in your turn`
                : 'No turn timer'
            }
            style={{ fontSize: 10, fontWeight: '800', color: COLORS.red }}
          >
            {turnCountdown !== null ? `${turnCountdown}s` : '∞'}
          </Text>
        ) : null}
        {showCode ? (
          <Text
            style={{ fontSize: 10, fontWeight: '800', color: COLORS.red, letterSpacing: 1 }}
            numberOfLines={1}
          >
            #{matchCode}
          </Text>
        ) : null}
        {isSolo ? (
          <Text style={{ fontSize: 10, fontWeight: '800', color: COLORS.ink3, letterSpacing: 1 }}>
            SOLO
          </Text>
        ) : null}
        {hasViewers ? (
          <Text style={{ fontSize: 10, color: COLORS.ink3, fontWeight: '600' }}>👁 {viewers}</Text>
        ) : null}
      </Pressable>

      {/* ROUND section */}
      <View style={{ gap: 4 }}>
        <Text style={RAIL_SECTION_LABEL_STYLE}>ROUND</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
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
              {prevailingGlyph}
            </Text>
          </View>
          <Text style={{ fontSize: 10, fontWeight: '700', color: COLORS.ink }}>
            {prevailingName} round
          </Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: COLORS.ink3 }}>Wall</Text>
          <Text
            style={{
              fontSize: 10,
              fontWeight: '800',
              color: lowWall ? STATUS_LOW_WALL_RED : COLORS.ink,
            }}
          >
            {state.wall.length} tiles
          </Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: COLORS.ink3 }}>Dealer</Text>
          <Text style={{ fontSize: 10, fontWeight: '800', color: COLORS.red }} numberOfLines={1}>
            {dealerName}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ fontSize: 10, fontWeight: '700', color: COLORS.ink3 }}>Your seat</Text>
          <Text style={{ fontSize: 10, fontWeight: '800', color: COLORS.ink, letterSpacing: 0.4 }}>
            {WIND_GLYPH[userSeatWind]} {WIND_NAME[userSeatWind]}
          </Text>
        </View>
      </View>

      {/* YOUR MELDS section — only when there's something to show. */}
      {ownMelds.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={RAIL_SECTION_LABEL_STYLE}>YOUR MELDS</Text>
          <MeldStrip melds={ownMelds} tileWidth={14} tileHeight={20} showKindLabel={false} />
        </View>
      ) : null}

      {/* Bottom section — tenpai waiting-on tiles when applicable.
          Empty when neither: the spec deliberately leaves this slot
          blank rather than backfill it with scores, since the
          player card's #CODE already carries enough game context.
          Tsumo / gang CTAs live as an absolute overlay above the
          discard pool in the parent shell, NOT in this rail — they
          need to read as time-critical actions over the centre of
          the table, not stacked at the bottom of an info card. */}
      {myTurn && readyWaits.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={RAIL_SECTION_LABEL_STYLE}>TENPAI · WAITING ON</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 3 }}>
            {readyWaits.map((tile, i) => (
              <Tile
                // biome-ignore lint/suspicious/noArrayIndexKey: ready-wait set is positional, deduped upstream
                key={i}
                tile={tile}
                width={16}
                height={22}
              />
            ))}
          </View>
        </View>
      ) : null}
    </ScrollView>
  );
}
