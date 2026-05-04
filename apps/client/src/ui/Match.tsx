import {
  type Action,
  type Tile as MTile,
  type Seat,
  WINDS,
  type Wind,
  acrossSeat,
  isWinning,
  legalClaimsFor,
  nextSeat,
  prevSeat,
  tileId,
} from '@mahjong/game-logic';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTransport } from '../net/transport-context';
import { isSeatHost, useGame } from '../state/game';
import { ClaimBar } from './ClaimBar';
import { Hand } from './Hand';
import { ResultPanel } from './ResultPanel';
import { RulePanel } from './RulePanel';
import { Scoreboard } from './Scoreboard';
import { Tile } from './Tile';
import { GhostButton, PrimaryButton } from './buttons';
import { ChatBar } from './match/ChatBar';
import { ChatBubbles } from './match/ChatBubbles';
import { GameStatusBar } from './match/GameStatusBar';
import { MeldStrip } from './match/MeldStrip';
import { OppHandStrip } from './match/OppHandStrip';
import { SharedDiscardPool } from './match/SharedDiscardPool';
import { SortPicker, type SortMode } from './match/SortPicker';
import { TopBar } from './match/TopBar';
import { LobbyPreview } from './menu/LobbyPreview';

type Position = 'bottom' | 'right' | 'top' | 'left';
interface SeatPlacement {
  seat: Seat;
  position: Position;
  seatWind: Wind;
}

const COLORS = {
  cream: '#f1eadc',
  ink: 'oklch(0.25 0.04 60)',
  ink3: 'oklch(0.55 0.04 60)',
  paper: 'oklch(0.97 0.01 80)',
  paperHi: 'oklch(0.99 0.005 85)',
  hairline: 'oklch(0.86 0.02 80)',
  felt: 'oklch(0.4 0.05 145)',
};

/**
 * Live-match orchestrator. Native port of `_legacy/src/ui/Match.tsx`
 * + the playing-state body from `_legacy/src/ui/MobileMatch.tsx`.
 * Layout is vertically stacked (simpler than the absolutely-positioned
 * landscape-mobile shell from the legacy build) — fits the dev-client
 * portrait orientation we run on emulator and is straightforward to
 * extend with animations in Phase 6.
 */
export function Match() {
  const router = useRouter();
  const transport = useTransport();
  const state = useGame((s) => s.state);
  const lobby = useGame((s) => s.lobby);
  const you = useGame((s) => s.you);
  const drawnTileId = useGame((s) => s.drawnTileId);
  const settings = useGame((s) => s.settings);
  const initialSort: SortMode = settings.autoSort ? 'suit' : 'manual';
  const [sortMode, setSortMode] = useState<SortMode>(initialSort);
  const seat = you !== null && you !== 'spectator' ? you : null;
  const isHost = isSeatHost(lobby, seat);

  const onAction = (action: Action) => transport.send(action);
  const onLeave = () => {
    transport.leave();
    router.replace('/');
  };

  const placements = useMemo(
    () => (state && seat !== null ? layoutFor(seat, state.dealer) : null),
    [state, seat],
  );
  const byPosition = useMemo(() => {
    if (!placements) return null;
    const m = {} as Record<Position, SeatPlacement>;
    for (const p of placements) m[p.position] = p;
    return m;
  }, [placements]);
  const seatToPosition = useMemo(() => {
    const m: Record<Seat, Position> = { 0: 'bottom', 1: 'bottom', 2: 'bottom', 3: 'bottom' };
    if (placements) for (const p of placements) m[p.seat] = p.position;
    return m;
  }, [placements]);

  if (!state || seat === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text style={{ color: COLORS.ink3 }}>Waiting for the game to start…</Text>
      </View>
    );
  }

  if (state.phase === 'waiting') {
    return (
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        style={{ flex: 1, backgroundColor: COLORS.cream }}
        contentContainerStyle={{ padding: 24, maxWidth: 760, alignSelf: 'center', width: '100%' }}
      >
        <Text style={{ fontSize: 28, fontWeight: '900', color: COLORS.ink }}>Lobby</Text>
        <Text style={{ marginTop: 4, marginBottom: 12, fontSize: 13, color: COLORS.ink3 }}>
          {isHost
            ? 'Share the match code with friends. Start when everyone is ready.'
            : 'Waiting for the host to start the match.'}
        </Text>
        {lobby ? <LobbyPreview lobby={lobby} matchCode={transport.matchCode} /> : null}
        <RulePanel rules={state.rules} isHost={isHost} onAction={onAction} />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <PrimaryButton
            disabled={!isHost}
            onPress={() => onAction({ t: 'startHand', seed: randomSeed(), dealer: 0 })}
          >
            Start match
          </PrimaryButton>
          <GhostButton onPress={onLeave}>Leave</GhostButton>
        </View>
      </ScrollView>
    );
  }

  // Playing state. Compute turn-flow flags + claim availability.
  const myTurn = state.phase === 'turn' && state.turn === seat;
  const needsDraw = myTurn && !state.hasDrawn;
  const allowSpecial = state.rules.allowSevenPairs || state.rules.allowThirteenOrphans;

  const showClaim =
    state.phase === 'awaitingClaims' && state.lastDiscard !== undefined && state.lastDiscard.from !== seat;
  // We rely on `ClaimBar` itself to compute the legal kinds + always show
  // `hu` / `pass`; here we only decide whether the bar appears at all.
  const hasClaimOption =
    showClaim &&
    (legalClaimsFor(state, seat).some((k) => k !== 'pass') ||
      (state.lastDiscard !== undefined &&
        isWinning({
          hand: [...state.hands[seat], state.lastDiscard.tile],
          exposedMelds: state.melds[seat].length,
          allowSpecial,
        })));

  const canTsumo =
    myTurn &&
    state.hasDrawn &&
    isWinning({
      hand: state.hands[seat],
      exposedMelds: state.melds[seat].length,
      allowSpecial,
    });

  const latestDiscardId =
    state.phase === 'awaitingClaims' && state.lastDiscard ? tileId(state.lastDiscard.tile) : null;

  const onTileTap = (t: MTile) => {
    if (myTurn && state.hasDrawn) {
      onAction({ t: 'discard', seat, tile: t });
    }
  };

  const dealerName =
    lobby?.players.find((p) => p.seat === state.dealer)?.displayName ?? `Seat ${state.dealer}`;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      style={{ flex: 1, backgroundColor: COLORS.cream }}
      contentContainerStyle={{ padding: 12, gap: 12 }}
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
        />
        <TopBar matchCode={transport.matchCode} viewers={lobby?.viewers ?? null} onLeave={onLeave} />
      </View>

      <Scoreboard />

      {byPosition ? (
        <View style={{ gap: 6 }}>
          <SeatRow placement={byPosition.top} state={state} lobby={lobby} />
          <SeatRow placement={byPosition.left} state={state} lobby={lobby} />
          <SeatRow placement={byPosition.right} state={state} lobby={lobby} />
        </View>
      ) : null}

      <View
        style={{
          backgroundColor: 'oklch(0.94 0.04 145 / 0.15)',
          borderColor: COLORS.hairline,
          borderWidth: 1,
          borderRadius: 12,
          padding: 8,
          gap: 6,
        }}
      >
        <Text
          style={{ fontSize: 11, fontWeight: '800', color: COLORS.ink3, letterSpacing: 0.5 }}
        >
          DISCARDS
        </Text>
        <SharedDiscardPool
          discardOrder={state.discardOrder}
          seatToPosition={seatToPosition}
          latestId={latestDiscardId}
        />
      </View>

      {state.melds[seat].length > 0 ? (
        <View style={{ gap: 4 }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: COLORS.ink3, letterSpacing: 0.5 }}>
            YOUR MELDS
          </Text>
          <MeldStrip melds={state.melds[seat]} />
        </View>
      ) : null}

      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Text style={{ fontSize: 11, fontWeight: '800', color: COLORS.ink3, letterSpacing: 0.5 }}>
            YOUR HAND
          </Text>
          <SortPicker mode={sortMode} onChange={setSortMode} />
        </View>
        <Hand
          tiles={state.hands[seat]}
          onTileClick={myTurn && state.hasDrawn ? onTileTap : undefined}
          sortMode={sortMode}
          drawnTileId={drawnTileId}
        />
      </View>

      <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        {needsDraw && state.wall.length > 0 ? (
          <DrawCue
            tile={state.wall[state.wall.length - 1]!}
            onPress={() => onAction({ t: 'draw', seat })}
          />
        ) : null}
        {canTsumo ? (
          <PrimaryButton onPress={() => onAction({ t: 'declareWin', seat, selfDraw: true })}>
            Declare win (tsumo)
          </PrimaryButton>
        ) : null}
      </View>

      {hasClaimOption ? <ClaimBar onAction={onAction} seat={seat} /> : null}

      <View style={{ alignItems: 'center', paddingVertical: 4 }}>
        <ChatBar onSend={transport.sendChat} />
      </View>

      {state.lastResult ? (
        <ResultPanel onAction={onAction} mySeat={seat} isHost={isHost} />
      ) : null}

      {/* Floating emote bubbles overlay (absolute-positioned). */}
      <ChatBubbles seatToPosition={seatToPosition} />
    </ScrollView>
  );
}

interface SeatRowProps {
  placement: SeatPlacement;
  state: NonNullable<ReturnType<typeof useGame.getState>['state']>;
  lobby: ReturnType<typeof useGame.getState>['lobby'];
}

function SeatRow({ placement, state, lobby }: SeatRowProps) {
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
      />
      {state.melds[placement.seat].length > 0 ? (
        <MeldStrip melds={state.melds[placement.seat]} tileWidth={14} tileHeight={20} />
      ) : null}
    </View>
  );
}

function DrawCue({ tile, onPress }: { tile: MTile; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      testID="wall-draw-next"
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 10,
        backgroundColor: pressed ? 'oklch(0.95 0.02 85)' : 'white',
        borderColor: 'oklch(0.78 0.16 75)',
        borderWidth: 2,
      })}
    >
      <Tile tile={tile} faceDown width={28} height={38} />
      <Text style={{ fontSize: 13, fontWeight: '800', color: 'oklch(0.55 0.18 25)' }}>Draw</Text>
    </Pressable>
  );
}

function layoutFor(mySeat: Seat, dealer: Seat): SeatPlacement[] {
  return [
    { seat: mySeat, position: 'bottom', seatWind: seatWindFor(dealer, mySeat) },
    {
      seat: nextSeat(mySeat),
      position: 'right',
      seatWind: seatWindFor(dealer, nextSeat(mySeat)),
    },
    {
      seat: acrossSeat(mySeat),
      position: 'top',
      seatWind: seatWindFor(dealer, acrossSeat(mySeat)),
    },
    {
      seat: prevSeat(mySeat),
      position: 'left',
      seatWind: seatWindFor(dealer, prevSeat(mySeat)),
    },
  ];
}

function seatWindFor(dealer: Seat, seat: Seat): Wind {
  const offset = (seat - dealer + 4) % 4;
  return WINDS[offset]!;
}

function randomSeed(): number {
  return Math.floor(Math.random() * 0xffffffff);
}
