import { useTransport } from '@/src/net/transport-context';
import {
  type Action,
  type Tile as MTile,
  SEATS,
  type Seat,
  hasMeaningfulClaim,
  isWinning,
  nextSeat,
  rankDiscards,
  sameFace,
  tileId,
} from '@mahjong/game-logic';
import { BOT_LABELS, type BotKind, type PublicPlayer } from '@mahjong/protocol';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isSeatHost, useGame } from '../state/game';
import { randomSeed } from '../util';
import { RulePanel } from './RulePanel';
import { GhostButton, PrimaryButton } from './buttons';
import { COLORS } from './colors';
import { DesktopShell } from './match/DesktopShell';
import { MobileShell } from './match/MobileShell';
import type { SortMode } from './match/SortPicker';
import type { Position } from './match/seatColor';
import { type SeatPlacement, layoutFor } from './match/seatPlacement';
import { FELT_SKINS } from './match/skins';
import { useDeadlineCrossed, useSecondsUntil } from './match/useClaimCue';
import { LobbyPreview } from './menu/LobbyPreview';
import { SEAT_WIND_GLYPH } from './winds';

/**
 * Viewport thresholds above which the Match screen renders the
 * `DesktopShell` (felt with seats around the perimeter) instead of
 * the vertical-stack `MobileShell`. Both axes must clear the
 * threshold:
 *   - width ≥ 768  → iPad mini portrait passes (768×1024).
 *   - height ≥ 600 → keeps phones in landscape (~430 tall) on the
 *                    mobile shell, where vertical space is too tight
 *                    for top opp + felt + own hand stacked.
 */
const DESKTOP_WIDTH = 768;
const DESKTOP_HEIGHT = 600;

/**
 * Live-match orchestrator. Owns the per-match React state (modal
 * toggles, sort mode), validates `state` + `seat`, computes the
 * derived turn-flow flags, and hands everything off to one of two
 * shells:
 *
 *   - `<DesktopShell>` (width ≥ DESKTOP_WIDTH, height ≥ DESKTOP_HEIGHT)
 *     — perimeter felt with seats around the edges.
 *   - `<MobileShell>` — vertical stack of opponent hand strips,
 *     shared discard pool, own hand. Picked for everything below
 *     the threshold.
 *
 * The pre-game `state.phase === 'waiting'` lobby and the stranded
 * "no active match" recovery screen are platform-agnostic and
 * rendered here directly.
 */
export function Match() {
  const router = useRouter();
  const transport = useTransport();
  const state = useGame((s) => s.state);
  const lobby = useGame((s) => s.lobby);
  const you = useGame((s) => s.you);
  const drawnTileId = useGame((s) => s.drawnTileId);
  const settings = useGame((s) => s.settings);
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const isDesktop = viewportWidth >= DESKTOP_WIDTH && viewportHeight >= DESKTOP_HEIGHT;
  const initialSort: SortMode = settings.autoSort ? 'suit' : 'manual';
  const [sortMode, setSortMode] = useState<SortMode>(initialSort);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [playersOpen, setPlayersOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const felt = FELT_SKINS[settings.felt];
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

  // Discard hint — runs the same `rankDiscards` scorer the
  // `heuristicBot` uses against the user's hand and surfaces the top
  // pick's tileId. The shells pass it through to `Hand` → `HandTile`
  // which renders a teal halo on the matching tile. Returns null
  // unless the toggle is on AND it's the user's own discard turn
  // (after the draw). Hoisted above the early returns below so
  // `useMemo` is called unconditionally on every render — React
  // forbids hooks behind conditional returns.
  const hintTileId = useMemo<number | null>(() => {
    if (!settings.discardHint) return null;
    if (!state || seat === null) return null;
    if (state.phase !== 'turn' || state.turn !== seat || !state.hasDrawn) return null;
    const allowSpecial = state.rules.allowSevenPairs || state.rules.allowThirteenOrphans;
    const ranked = rankDiscards({
      hand: state.hands[seat],
      exposedMelds: state.melds[seat].length,
      allowSpecial,
      yakuhai: { dealer: state.dealer, prevailingWind: state.prevailingWind, seat },
      // No safety scorer here — the hint should match the bot's
      // *strategic* pick rather than shadowing whichever opponent's
      // discard pool happens to be largest mid-hand.
    });
    const best = ranked[0];
    if (!best) return null;
    const concrete = state.hands[seat].find((t) => sameFace(t, best.tile));
    return concrete ? tileId(concrete) : null;
  }, [settings.discardHint, state, seat]);

  // "Next player about to draw" cue. Hooks run unconditionally on
  // every render (Rules of Hooks); we just gate the values they
  // observe on whether we're in `awaitingClaims`. Solo leaves the
  // deadline fields unset, so the hooks stay inert in that case.
  const claimDeadline =
    state?.phase === 'awaitingClaims' ? (state.pendingClaims?.deadlineMs ?? null) : null;
  const claimSoftExpiry =
    state?.phase === 'awaitingClaims' ? (state.pendingClaims?.softExpiryMs ?? null) : null;
  const claimHardDeadline =
    state?.phase === 'awaitingClaims' ? (state.pendingClaims?.hardDeadlineMs ?? null) : null;
  const aboutToDraw = useDeadlineCrossed(claimDeadline);
  const inWindup = useDeadlineCrossed(claimSoftExpiry);
  const drawCountdown = useSecondsUntil(inWindup ? claimHardDeadline : null);

  if (!state || seat === null) {
    // Two reasons we can land here without a usable game:
    //   1. We just opened a transport and the first `state` message
    //      hasn't arrived yet — show a short "Waiting…" placeholder.
    //   2. The user reloaded the tab (or deep-linked) directly into
    //      `/match` with no live transport. Solo / LAN matches don't
    //      survive a reload (no server-side session to reconnect to),
    //      so we'd otherwise hang on the placeholder forever. Detect
    //      `status === 'idle'` (no join ever happened in this tab) and
    //      surface an explicit recovery screen instead.
    const stranded = transport.status === 'idle' && !transport.hasTransport;
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.cream }} edges={['top']}>
        <View
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            gap: 12,
          }}
        >
          {stranded ? (
            <>
              <Text
                accessibilityRole="header"
                style={{
                  fontSize: 22,
                  fontWeight: '900',
                  color: COLORS.ink,
                  textAlign: 'center',
                }}
              >
                No active match
              </Text>
              <Text
                style={{
                  color: COLORS.ink3,
                  fontSize: 14,
                  textAlign: 'center',
                  maxWidth: 360,
                }}
              >
                This match isn't available anymore — practice and LAN matches don't survive a
                reload, and the original session has ended. Head back to the main menu to start a
                new one.
              </Text>
              <PrimaryButton onPress={() => router.replace('/')}>Back to main menu</PrimaryButton>
            </>
          ) : (
            <Text style={{ color: COLORS.ink3 }}>Waiting for the game to start…</Text>
          )}
        </View>
      </SafeAreaView>
    );
  }

  if (state.phase === 'waiting') {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.cream }} edges={['top']}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 24, maxWidth: 760, alignSelf: 'center', width: '100%' }}
        >
          <Text
            accessibilityRole="header"
            style={{ fontSize: 28, fontWeight: '900', color: COLORS.ink }}
          >
            Lobby
          </Text>
          <Text style={{ marginTop: 4, marginBottom: 12, fontSize: 13, color: COLORS.ink3 }}>
            {isHost
              ? 'Share the match code with friends. Start when everyone is ready.'
              : 'Waiting for the host to start the match.'}
          </Text>
          {lobby ? <LobbyPreview lobby={lobby} matchCode={transport.matchCode} /> : null}
          {lobby && isHost && seat !== null ? (
            <LobbySeatControls
              players={lobby.players}
              mySeat={seat}
              isSolo={transport.matchCode === 'SOLO'}
              onSeat={transport.seatBot}
              onUnseat={transport.unseatBot}
            />
          ) : null}
          <RulePanel rules={state.rules} isHost={isHost} onAction={onAction} />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <PrimaryButton
              // Mirror the server's all-seats-filled gate so the host
              // gets a disabled button instead of a silent error.
              disabled={!isHost || !allSeatsFilled(lobby)}
              // No explicit dealer — engine derives it from the
              // opening dice roll (highest sum wins; ties go to the
              // lowest-indexed seat). Subsequent hands rotate via
              // `nextDealer(state)` from `ResultPanel`'s "Start next
              // hand" button. Hardcoding `dealer: 0` here was the bug
              // that made the user always dealer regardless of dice.
              onPress={() => onAction({ t: 'startHand', seed: randomSeed() })}
            >
              Start match
            </PrimaryButton>
            <GhostButton onPress={onLeave}>Leave</GhostButton>
          </View>
          {isHost && !allSeatsFilled(lobby) ? (
            <Text style={{ marginTop: 6, fontSize: 12, color: COLORS.ink3 }}>
              Fill every seat with a player or a bot before starting.
            </Text>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Playing state. Compute turn-flow flags + claim availability,
  // then hand off to the appropriate shell.
  const myTurn = state.phase === 'turn' && state.turn === seat;
  const needsDraw = myTurn && !state.hasDrawn;
  const allowSpecial = state.rules.allowSevenPairs || state.rules.allowThirteenOrphans;

  const showClaim =
    state.phase === 'awaitingClaims' &&
    state.lastDiscard !== undefined &&
    state.lastDiscard.from !== seat;
  // Use the engine's `hasMeaningfulClaim` predicate as the single source
  // of truth — it's the same one the `discard` reducer uses to pre-fill
  // `submitted`, so the client never sees a "phantom" bar for a seat
  // the engine has already auto-passed.
  const hasClaimOption =
    showClaim &&
    state.lastDiscard !== undefined &&
    hasMeaningfulClaim(state, seat, state.lastDiscard.tile);

  const nextDrawerSeat: Seat | null =
    state.phase === 'awaitingClaims' && state.lastDiscard ? nextSeat(state.lastDiscard.from) : null;

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

  const sharedProps = {
    state,
    seat,
    lobby,
    matchCode: transport.matchCode,
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
    onSortModeChange: setSortMode,
    onAction,
    onLeave,
    onSendChat: transport.sendChat,
    onTileTap,
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
  } as const;

  if (isDesktop) {
    return <DesktopShell {...sharedProps} />;
  }

  return <MobileShell {...sharedProps} felt={felt} byPosition={byPosition} />;
}

/** Mirrors the server's `startHand` SEATS gate. */
function allSeatsFilled(lobby: { players: readonly PublicPlayer[] } | null): boolean {
  if (!lobby) return false;
  for (const seat of SEATS) {
    const p = lobby.players.find((x) => x.seat === seat);
    if (!p) return false;
    if (!p.connected && !p.isBot) return false;
  }
  return true;
}

// Picker rows in lobby-row order (Easy → Standard → Smart). `label`
// pulls from the canonical `BOT_LABELS` map in `@mahjong/protocol` so
// it stays in lockstep with `botDisplayName(kind)` everywhere else.
const BOT_KIND_OPTIONS: ReadonlyArray<{ kind: BotKind; label: string; hint: string }> = [
  {
    kind: 'passive',
    label: BOT_LABELS.passive,
    hint: 'Discards the last drawn tile, never claims.',
  },
  { kind: 'simple', label: BOT_LABELS.simple, hint: 'Drops the most isolated tile.' },
  {
    kind: 'heuristic',
    label: BOT_LABELS.heuristic,
    hint: 'Minimises shanten + claims to improve.',
  },
];

interface LobbySeatControlsProps {
  players: readonly PublicPlayer[];
  mySeat: Seat;
  isSolo: boolean;
  onSeat: (seat: Seat, kind: BotKind) => void;
  onUnseat: (seat: Seat) => void;
}

/**
 * Host's lobby controls — segmented Easy/Standard/Smart picker per
 * non-self, non-human-occupied seat, with a Remove button for online/LAN
 * (solo always has three bots in seats 1..3).
 */
function LobbySeatControls({ players, mySeat, isSolo, onSeat, onUnseat }: LobbySeatControlsProps) {
  // A bot reports `connected: true` (solo bots are "connected" to the
  // in-process loop), so the human predicate is connected-and-not-bot.
  const editable = players.filter(
    (p) => p.seat !== null && p.seat !== mySeat && (p.isBot || !p.connected),
  );
  if (editable.length === 0) return null;
  return (
    <View
      style={{
        marginTop: 12,
        backgroundColor: COLORS.paperHi,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 14,
        padding: 14,
        gap: 10,
      }}
    >
      <Text style={{ fontSize: 14, fontWeight: '900', color: COLORS.ink }}>Bot skill</Text>
      <Text style={{ fontSize: 12, color: COLORS.ink3, marginTop: -4 }}>
        {isSolo
          ? "Tune each opponent's strategy. Saved across sessions."
          : 'Fill empty seats with bots, or swap a bot’s strategy.'}
      </Text>
      {editable.map((p) => {
        const seat = p.seat as Seat;
        return (
          <View
            key={seat}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4, minWidth: 70 }}>
              <Text
                style={{
                  fontFamily: 'Noto Serif TC',
                  fontSize: 16,
                  color: '#b14d3a',
                  fontWeight: '700',
                }}
              >
                {SEAT_WIND_GLYPH[seat]}
              </Text>
              <Text style={{ fontSize: 11, fontWeight: '800', color: COLORS.ink3 }}>
                SEAT {seat}
              </Text>
            </View>
            <View
              style={{
                flexDirection: 'row',
                flex: 1,
                minWidth: 220,
                backgroundColor: '#ece4d3',
                borderRadius: 8,
                padding: 2,
              }}
            >
              {BOT_KIND_OPTIONS.map((opt) => {
                const active = p.botKind === opt.kind;
                return (
                  <Pressable
                    key={opt.kind}
                    onPress={() => onSeat(seat, opt.kind)}
                    accessibilityLabel={`Set seat ${seat} to ${opt.label}`}
                    style={({ pressed }) => ({
                      flex: 1,
                      paddingVertical: 6,
                      borderRadius: 6,
                      alignItems: 'center',
                      backgroundColor: active ? '#fbe5d9' : pressed ? '#dfd4bc' : 'transparent',
                    })}
                  >
                    <Text
                      style={{
                        fontSize: 12,
                        fontWeight: active ? '900' : '600',
                        color: active ? '#b14d3a' : COLORS.ink,
                        letterSpacing: 0.4,
                      }}
                    >
                      {opt.label.toUpperCase()}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {!isSolo && p.isBot ? (
              <Pressable
                onPress={() => onUnseat(seat)}
                accessibilityLabel={`Remove bot from seat ${seat}`}
                hitSlop={8}
                style={({ pressed }) => ({
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: COLORS.hairline,
                  backgroundColor: pressed ? '#dfd4bc' : 'transparent',
                })}
              >
                <Text style={{ fontSize: 12, fontWeight: '800', color: COLORS.ink3 }}>REMOVE</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}
