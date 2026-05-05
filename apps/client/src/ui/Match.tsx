import { useTransport } from '@/src/net/transport-context';
import type { BotKind } from '@mahjong/bots';
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
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isSeatHost, useGame } from '../state/game';
import { RulePanel } from './RulePanel';
import { GhostButton, PrimaryButton } from './buttons';
import { DesktopShell } from './match/DesktopShell';
import { MobileShell } from './match/MobileShell';
import type { SortMode } from './match/SortPicker';
import { FELT_SKINS } from './match/skins';
import { LobbyPreview } from './menu/LobbyPreview';

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

type Position = 'bottom' | 'right' | 'top' | 'left';
interface SeatPlacement {
  seat: Seat;
  position: Position;
  seatWind: Wind;
}

const COLORS = {
  cream: '#f1eadc',
  ink: '#3a3328',
  ink3: '#918275',
  paperHi: '#fbf8f0',
  hairline: '#cdc1ad',
};

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
          {transport.matchCode === 'SOLO' && lobby ? (
            <SoloBotSkillPicker skills={settings.botSkills} onChange={transport.setSoloBotSkill} />
          ) : null}
          <RulePanel rules={state.rules} isHost={isHost} onAction={onAction} />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <PrimaryButton
              disabled={!isHost}
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
    latestDiscardId,
    dealerName,
    drawnTileId,
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
  // Test override hatch: Playwright sets `__MAHJONG_TEST_SEED__` via
  // `addInitScript` before navigation so the dice roll (and thus the
  // dealer pick) is deterministic. Production / dev never sets it,
  // so the fallback is the regular `Math.random`-driven seed.
  if (typeof window !== 'undefined') {
    const override = (window as unknown as { __MAHJONG_TEST_SEED__?: number })
      .__MAHJONG_TEST_SEED__;
    if (typeof override === 'number') return override;
  }
  return Math.floor(Math.random() * 0xffffffff);
}

const BOT_KINDS: ReadonlyArray<{ kind: BotKind; label: string; hint: string }> = [
  { kind: 'passive', label: 'Easy', hint: 'Discards the last drawn tile, never claims.' },
  { kind: 'simple', label: 'Standard', hint: 'Drops the most isolated tile.' },
  { kind: 'heuristic', label: 'Smart', hint: 'Minimises shanten + claims to improve.' },
];
const SEAT_WIND_GLYPH = ['東', '南', '西', '北'] as const;

interface SoloBotSkillPickerProps {
  skills: readonly [BotKind, BotKind, BotKind];
  onChange: (seat: 1 | 2 | 3, kind: BotKind) => void;
}

/**
 * Per-bot skill picker — only rendered for solo matches in the
 * waiting room. Three rows (one per bot seat 1..3); each row offers a
 * three-way segmented control between Easy / Standard / Smart. The
 * picker writes through `transport.setSoloBotSkill` to the live
 * solo transport (which re-emits the lobby with the new bot name)
 * AND through `useGame.settings.botSkills` so the next solo match
 * remembers the choice across reloads.
 */
function SoloBotSkillPicker({ skills, onChange }: SoloBotSkillPickerProps) {
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
        Tune each opponent's strategy. Saved across sessions.
      </Text>
      {([1, 2, 3] as const).map((seat) => (
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
            <Text style={{ fontSize: 11, fontWeight: '800', color: COLORS.ink3 }}>SEAT {seat}</Text>
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
            {BOT_KINDS.map((opt) => {
              const active = skills[seat - 1] === opt.kind;
              return (
                <Pressable
                  key={opt.kind}
                  onPress={() => onChange(seat, opt.kind)}
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
        </View>
      ))}
    </View>
  );
}
