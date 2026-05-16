import { type GameState, SEATS, type Seat, tileId } from '@mahjong/game-logic';
import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { LobbyState } from '../../state/game';
import { useGame } from '../../state/game';
import { Scoreboard } from '../Scoreboard';
import { GhostButton } from '../buttons';
import { COLORS } from '../colors';
import { WIND_GLYPH } from '../winds';
import { GameStatusBar } from './GameStatusBar';
import { OppHandStrip } from './OppHandStrip';
import { SharedDiscardPool } from './SharedDiscardPool';
import type { Position } from './seatColor';
import { type SeatPlacement, layoutFor } from './seatPlacement';
import { FELT_SKINS } from './skins';

/** Spectator's identity slot — neutral cream + brand-red glyph, since
 *  the watcher has no seat colour of their own. Surfaces the prevailing
 *  round wind + dealer name (the "front of the table" cues a spectator
 *  uses to orient themselves). */
const SPECTATOR_WIND_BG = '#ecd9b8';
const SPECTATOR_WIND_FG = COLORS.red;

interface SpectatorViewProps {
  /** Engine state at the latest delta. */
  state: GameState;
  lobby: LobbyState | null;
  matchCode: string | null;
  onLeave: () => void;
}

/**
 * Read-only watch UI. Reuses `OppHandStrip` for every seat (all hands
 * appear face-down, since a spectator has no seat) and the existing
 * `SharedDiscardPool` for the centre pile.
 *
 * Camera POV is anchored to the dealer — that's the natural "front"
 * of the table from a spectator's perspective (their wall is broken,
 * they roll dice, etc.). The four strips stack top → right → bottom →
 * left so dealer reads as "bottom" of the layout. Mobile-first;
 * desktop just gets more horizontal room.
 *
 * The state filtering is deliberately client-only for v1 — the server
 * sends the full GameState. We hide hand contents by never rendering
 * them, but a dev-tools sniff still leaks them. Adding a server-side
 * projection that wipes `hands` is a follow-up.
 */
export function SpectatorView({ state, lobby, matchCode, onLeave }: SpectatorViewProps) {
  const feltSkin = useGame((s) => s.settings.felt);
  const felt = FELT_SKINS[feltSkin];

  // POV seat — dealer anchors the four strips so the layout has a
  // stable "bottom of the table." `layoutFor` returns the positions
  // (top/right/bottom/left) relative to whichever seat is asked for.
  // Derived lookups (seat → placement, seat → position) are memoised
  // off the same `placements` array so a state delta that didn't
  // change the dealer doesn't re-allocate the maps.
  const { placementBySeat, seatToPosition } = useMemo(() => {
    const placements = layoutFor(state.dealer, state.dealer);
    const byPlacement = {} as Record<Seat, SeatPlacement>;
    const byPosition = {} as Record<Seat, Position>;
    for (const p of placements) {
      byPlacement[p.seat] = p;
      byPosition[p.seat] = p.position;
    }
    return { placementBySeat: byPlacement, seatToPosition: byPosition };
  }, [state.dealer]);

  const dealerName =
    lobby?.players.find((p) => p.seat === state.dealer)?.displayName ?? `Seat ${state.dealer}`;
  const latestDiscardId =
    state.phase === 'awaitingClaims' && state.lastDiscard ? tileId(state.lastDiscard.tile) : null;
  const showCode = matchCode !== null && matchCode !== 'SOLO';
  const viewers = lobby?.viewers ?? null;

  return (
    <View style={{ flex: 1, backgroundColor: felt.top }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: felt.top }} edges={['top', 'bottom']}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 12,
            paddingTop: 12,
            paddingBottom: 8,
          }}
        >
          <View style={{ flex: 1, minWidth: 0 }}>
            <GameStatusBar
              windGlyph={WIND_GLYPH[state.prevailingWind]}
              windBg={SPECTATOR_WIND_BG}
              windFg={SPECTATOR_WIND_FG}
              name={dealerName}
              wallCount={state.wall.length}
              isMyTurn={false}
              trailing={<WatchingBadge code={showCode ? matchCode : null} viewers={viewers} />}
            />
          </View>
          <GhostButton onPress={onLeave}>Stop watching</GhostButton>
        </View>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            padding: 12,
            gap: 10,
          }}
        >
          <Scoreboard />
          {SEATS.map((seat) => {
            const placement = placementBySeat[seat];
            const isActive = state.turn === seat && state.phase === 'turn';
            return (
              <OppHandStrip
                key={seat}
                seat={seat}
                seatWind={placement.seatWind}
                position={placement.position}
                lobby={lobby}
                melds={state.melds[seat]}
                isActive={isActive}
                aboutToDraw={false}
                turnCountdown={null}
              />
            );
          })}
          <View
            style={{
              backgroundColor: felt.bottom,
              borderColor: 'rgba(255,255,255,0.12)',
              borderWidth: 1,
              borderRadius: 12,
              padding: 8,
              minHeight: 200,
            }}
          >
            <SharedDiscardPool
              discardOrder={state.discardOrder}
              seatToPosition={seatToPosition}
              latestId={latestDiscardId}
            />
          </View>
          <ResultBanner state={state} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

interface WatchingBadgeProps {
  code: string | null;
  viewers: number | null;
}

function WatchingBadge({ code, viewers }: WatchingBadgeProps) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <View
        style={{
          paddingHorizontal: 6,
          paddingVertical: 2,
          borderRadius: 6,
          backgroundColor: '#f0e3d0',
        }}
      >
        <Text style={{ fontSize: 9, fontWeight: '900', color: '#a16b1c', letterSpacing: 1 }}>
          WATCHING
        </Text>
      </View>
      {code ? (
        <Text style={{ fontSize: 11, fontWeight: '800', color: COLORS.red, letterSpacing: 1.2 }}>
          #{code}
        </Text>
      ) : null}
      {viewers && viewers > 0 ? (
        <Text style={{ fontSize: 11, color: COLORS.ink3, fontWeight: '600' }}>👁 {viewers}</Text>
      ) : null}
    </View>
  );
}

/**
 * Compact between-hand summary for the spectator. Shows the result
 * line ("X wins for N faan" / "Drawn — wall empty") without the
 * play-restart affordances the seated `ResultPanel` carries. The
 * spectator hasn't joined a lobby roster, so winners are labelled by
 * seat number — matches the seated `ResultPanel`'s fallback.
 */
function ResultBanner({ state }: { state: GameState }) {
  if (!state.lastResult) return null;
  const r = state.lastResult;
  const label =
    r.kind === 'draw'
      ? 'Drawn — wall empty'
      : `Seat ${r.winner} ${r.selfDraw ? 'tsumo' : 'ron'} · ${r.faan} faan`;
  return (
    <View
      style={{
        paddingVertical: 10,
        paddingHorizontal: 14,
        backgroundColor: 'rgba(255,250,234,0.95)',
        borderRadius: 10,
        borderColor: '#dca84a',
        borderWidth: 1,
      }}
    >
      <Text style={{ fontSize: 13, fontWeight: '900', color: COLORS.ink, letterSpacing: 0.4 }}>
        {label}
      </Text>
    </View>
  );
}
