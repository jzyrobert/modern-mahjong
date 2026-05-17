import { useTransport } from '@/src/net/transport-context';
import {
  type Action,
  type Tile as MTile,
  type Seat,
  hasMeaningfulClaim,
  isWinning,
  nextSeat,
  rankDiscards,
  sameFace,
  scoreHand,
  seatWindFor,
  tileId,
  waitTiles,
} from '@mahjong/game-logic';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { isSeatHost, nameForSeat, useGame } from '../state/game';
import { PrimaryButton } from './buttons';
import { COLORS } from './colors';
import { orderHand } from './handSort';
import { DesktopShell } from './match/DesktopShell';
import { LobbyView } from './match/LobbyView';
import { MobileShell } from './match/MobileShell';
import type { SortMode } from './match/SortPicker';
import { SpectatorView } from './match/SpectatorView';
import { type Position, SEAT_COLOR } from './match/seatColor';
import { type SeatPlacement, layoutFor } from './match/seatPlacement';
import { FELT_SKINS } from './match/skins';
import { useDeadlineCrossed, useSecondsUntil } from './match/useClaimCue';
import { WIND_GLYPH } from './winds';

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
 * derived turn-flow flags, and hands everything off to one of three
 * presentational shells:
 *
 *   - `<SpectatorView>` when the server routed this connection into
 *     the viewer pool (`you === 'spectator'`).
 *   - `<LobbyView>` for the pre-game waiting room
 *     (`state.phase === 'waiting'`).
 *   - `<DesktopShell>` (width ≥ DESKTOP_WIDTH, height ≥ DESKTOP_HEIGHT)
 *     — perimeter felt with seats around the edges.
 *   - `<MobileShell>` — vertical stack of opponent hand strips, shared
 *     discard pool, own hand. Picked for everything below the threshold.
 *
 * The stranded "no active match" recovery screen is rendered inline
 * because it has no other natural home.
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
  // Landscape phones still hit `MobileShell` (height < DESKTOP_HEIGHT
  // keeps them off the perimeter-felt desktop layout, which needs more
  // vertical room than ~430 px to render the seats around the felt).
  // The vertical stack of 3 opponent strips eats ~150 px on its own,
  // which on a 393 px-tall landscape viewport leaves zero room for the
  // discard pool. `isLandscape` lets `MobileShell` flatten the opponent
  // strips into a single horizontal row so the discard pane gets real
  // vertical real estate.
  const isLandscape = !isDesktop && viewportWidth > viewportHeight;
  // Always start a fresh match in suit-sorted mode. The SortPicker is
  // visible immediately so the user can flip to NUMBER / MANUAL the
  // moment they want a different order — no need for a separate "auto
  // sort" setting whose only effect was choosing between this default
  // and an initial MANUAL.
  const [sortMode, setSortMode] = useState<SortMode>('suit');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [referenceOpen, setReferenceOpen] = useState(false);
  const [scoringOpen, setScoringOpen] = useState(false);
  const [playersOpen, setPlayersOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const felt = FELT_SKINS[settings.felt];
  const seat = you !== null && you !== 'spectator' ? you : null;
  const isHost = isSeatHost(lobby, seat);

  // Seed `manualOrder` with the currently-displayed hand on the
  // suit/number → manual transition so the first render after the
  // mode change preserves whatever the user was just looking at,
  // instead of snapping back to engine order. Once `manualOrder` is
  // non-empty, `Hand.tsx`'s drag handler maintains it from there.
  const onSortModeChange = (next: SortMode) => {
    if (next === 'manual' && sortMode !== 'manual' && seat !== null && state) {
      const ordered = orderHand(state.hands[seat], sortMode);
      useGame.getState().setManualOrder(ordered.map((t) => tileId(t)));
    }
    setSortMode(next);
  };

  const onAction = (action: Action) => transport.send(action);
  const onLeave = () => {
    // Order matters: navigate first, *then* tear the transport down.
    // `app/match.tsx`'s reload-survival effect re-runs whenever
    // `transport` or the URL params change. If we cleared the
    // transport first, the next render would see `hasTransport=false`
    // with `params.code` still set, and the effect would auto-rejoin
    // the user back into the match they just left. Replacing the
    // route first batches the URL change with the transport reset, so
    // by the time the effect would re-run, `params.code` is `undefined`
    // (and `MatchRoute` is unmounting anyway).
    router.replace('/');
    transport.leave();
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

  // Ready-hand (聽牌) waits — when the user's concealed hand is at
  // shanten 0, surface the faces that would complete it. Rendered
  // above the user's hand as a gold pill by both shells
  // (`ReadyHandBadge`); empty array → no badge.
  //
  // Only meaningful when the user is between turns (13 tiles, between
  // their discard and next draw). After they've drawn (14 tiles), the
  // tsumo button already covers the win path, so we suppress the
  // badge to avoid bait — a 0-shanten 14-tile shape doesn't tell the
  // user what to do.
  //
  // `waitTiles` is ~34 shanten calls. The memo keys on a stable
  // tileId-string for the hand so unrelated state deltas (opponent
  // draws/discards during `awaitingClaims`, other-seat turns) don't
  // re-run it — only changes to the user's own hand shape do.
  const showReadyWaits =
    !!state &&
    seat !== null &&
    (state.phase === 'awaitingClaims' || (state.phase === 'turn' && !state.hasDrawn));
  const readyHand = showReadyWaits ? state!.hands[seat!] : null;
  const readyHandKey = readyHand ? readyHand.map(tileId).join(',') : '';
  const readyMeldCount = readyHand ? state!.melds[seat!].length : 0;
  const readyAllowSpecial =
    !!state && (state.rules.allowSevenPairs || state.rules.allowThirteenOrphans);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `readyHandKey` is the stable identity for the hand contents; depending on `readyHand` itself would re-fire on every state delta even when the user's hand is unchanged.
  const readyWaits = useMemo<MTile[]>(() => {
    if (!readyHand) return [];
    return waitTiles({
      hand: readyHand,
      exposedMelds: readyMeldCount,
      allowSpecial: readyAllowSpecial,
    });
  }, [readyHandKey, readyMeldCount, readyAllowSpecial]);

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
  // Per-turn countdown — gated on `phase === 'turn'` AND the engine
  // actually setting `turnDeadlineMs` (turn timer disabled / solo
  // both leave it undefined).
  const turnDeadline = state?.phase === 'turn' ? (state.turnDeadlineMs ?? null) : null;
  const turnCountdown = useSecondsUntil(turnDeadline);

  // Tsumo + concealed-gang derivations. Hoisted above the early returns
  // below so the `useMemo` calls run unconditionally on every render
  // (Rules of Hooks); guards inside return `null` when the engine state
  // isn't a playing one. `tsumoFaan` previews the score on the Declare-
  // win button; `concealedGangTile` toggles the Declare-gang button
  // when the user holds four of a face on their draw turn. Both ran
  // unmemoised on every Match render previously, paying O(n²) on the
  // concealed-gang scan each WS delta.
  const tsumoState = state && seat !== null ? state : null;
  const tsumoSeat = seat;
  const canTsumoMemo =
    !!tsumoState &&
    tsumoSeat !== null &&
    state?.phase === 'turn' &&
    state.turn === tsumoSeat &&
    state.hasDrawn &&
    state.drewThisTurn;
  const tsumoFaan = useMemo<number | null>(() => {
    if (!canTsumoMemo || !tsumoState || tsumoSeat === null) return null;
    const allowSpecial = tsumoState.rules.allowSevenPairs || tsumoState.rules.allowThirteenOrphans;
    if (
      !isWinning({
        hand: tsumoState.hands[tsumoSeat],
        exposedMelds: tsumoState.melds[tsumoSeat].length,
        allowSpecial,
      })
    ) {
      return null;
    }
    const hand = tsumoState.hands[tsumoSeat];
    const winningTile = hand[hand.length - 1];
    if (!winningTile) return null;
    return scoreHand({ state: tsumoState, winner: tsumoSeat, winningTile, selfDraw: true }).faan;
  }, [canTsumoMemo, tsumoState, tsumoSeat]);
  const concealedGangTile = useMemo<MTile | null>(() => {
    if (!tsumoState || tsumoSeat === null) return null;
    if (tsumoState.phase !== 'turn' || tsumoState.turn !== tsumoSeat || !tsumoState.hasDrawn) {
      return null;
    }
    const hand = tsumoState.hands[tsumoSeat];
    for (const candidate of hand) {
      let count = 0;
      for (const t of hand) if (sameFace(t, candidate)) count++;
      if (count >= 4) return candidate;
    }
    return null;
  }, [tsumoState, tsumoSeat]);

  // Spectator branch — `you === 'spectator'` means the server routed
  // this connection into the viewer pool (either because seats were
  // full at hello time, or the user explicitly opted to watch via the
  // lobby browser). Render the read-only `SpectatorView` instead of
  // the playing shell. Falls through to the stranded/waiting screen
  // when state hasn't arrived yet.
  if (you === 'spectator' && state) {
    return (
      <SpectatorView
        state={state}
        lobby={lobby}
        matchCode={transport.matchCode}
        onLeave={onLeave}
      />
    );
  }

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
      // Outer cream View extends the background past the bottom
      // safe-area inset (Android software nav, iOS home indicator)
      // so scrolling doesn't reveal the Stack's default content
      // background as a stripe. Same pattern as `MobileShell`.
      <View style={{ flex: 1, backgroundColor: COLORS.cream }}>
        <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.cream }} edges={['top', 'bottom']}>
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
                  This match isn't available anymore — the original session has ended or the link
                  doesn't carry enough info to restore it. Head back to the main menu to start a new
                  one.
                </Text>
                <PrimaryButton onPress={() => router.replace('/')}>Back to main menu</PrimaryButton>
              </>
            ) : (
              <Text style={{ color: COLORS.ink3 }}>Waiting for the game to start…</Text>
            )}
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (state.phase === 'waiting') {
    return (
      <LobbyView
        rules={state.rules}
        lobby={lobby}
        seat={seat}
        isHost={isHost}
        matchCode={transport.matchCode}
        joinInfo={transport.joinInfo}
        onAction={onAction}
        onLeave={onLeave}
        onSeatBot={transport.seatBot}
        onUnseatBot={transport.unseatBot}
      />
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
  //
  // Also hide the bar once the seat has submitted (peng, chi, pass,
  // etc.). Without this, V2's polished card invites a second tap that
  // would overwrite the prior claim (e.g. peng → pass), and the user
  // would silently lose priority on a tile they could have claimed.
  // The engine has a re-submission guard too, but the UI gate avoids
  // surfacing an IllegalActionError toast for a tap that looked
  // legitimate.
  const alreadySubmitted = state.pendingClaims?.submitted[seat] !== undefined;
  const hasClaimOption =
    showClaim &&
    state.lastDiscard !== undefined &&
    !alreadySubmitted &&
    hasMeaningfulClaim(state, seat, state.lastDiscard.tile);

  const nextDrawerSeat: Seat | null =
    state.phase === 'awaitingClaims' && state.lastDiscard ? nextSeat(state.lastDiscard.from) : null;

  // `drewThisTurn` rules out chi/peng-claimed shapes — those set
  // `hasDrawn: true` so the claimer must discard, but no real draw
  // happened. The engine's `declareWin(selfDraw: true)` now rejects
  // those (otherwise a low-faan hu could be passed, chi'd, and
  // re-declared as tsumo for the 自摸 +1 faan bonus); gating the
  // button match keeps the UI honest.
  const canTsumo =
    myTurn &&
    state.hasDrawn &&
    state.drewThisTurn &&
    isWinning({
      hand: state.hands[seat],
      exposedMelds: state.melds[seat].length,
      allowSpecial,
    });
  // `tsumoFaan` / `concealedGangTile` are memoised above the early
  // returns — see `useMemo` block at ~L235.

  const latestDiscardId =
    state.phase === 'awaitingClaims' && state.lastDiscard ? tileId(state.lastDiscard.tile) : null;

  const onTileTap = (t: MTile) => {
    if (myTurn && state.hasDrawn) {
      onAction({ t: 'discard', seat, tile: t });
    }
  };

  // Identity rendered in the GameStatusBar pill — the user's own
  // display name, seat-relative wind glyph, and seat colour. The user
  // is always rendered at the bottom-position seat slot, so the
  // accent colour is fixed to `SEAT_COLOR.bottom`; the glyph rotates
  // with dealer changes (`seatWindFor` returns the user's wind
  // relative to whoever currently sits East). White-on-coral keeps
  // the glyph legible against the user's accent.
  const userName = nameForSeat(lobby, seat);
  const userWindGlyph = WIND_GLYPH[seatWindFor(state.dealer, seat)];
  const userWindBg = SEAT_COLOR.bottom;
  const userWindFg = 'white';

  const sharedProps = {
    state,
    seat,
    lobby,
    matchCode: transport.matchCode,
    isHost,
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
    scoringOpen,
    setScoringOpen,
    playersOpen,
    setPlayersOpen,
    menuOpen,
    setMenuOpen,
  } as const;

  if (isDesktop) {
    return <DesktopShell {...sharedProps} />;
  }

  return (
    <MobileShell {...sharedProps} felt={felt} byPosition={byPosition} isLandscape={isLandscape} />
  );
}
