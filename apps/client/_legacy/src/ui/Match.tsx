import type { Action, GameState, Tile as MTile, Seat } from '@mahjong/game-logic';
import {
  acrossSeat,
  isWinning,
  legalClaimsFor,
  nextSeat,
  prevSeat,
  tileId,
} from '@mahjong/game-logic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { vibrateLight } from '../native/init.js';
import { INK, SANS } from '../native/theme.js';
import {
  type LobbyState,
  type UserSettings,
  isSeatHost,
  nameForSeat,
  useGame,
} from '../state/game.js';
import { randomSeed } from '../util.js';
import { useMediaQuery } from '../util/useMediaQuery.js';
import { ClaimBar } from './ClaimBar.js';
import { MobileMatch } from './MobileMatch.js';
import { ResultPanel } from './ResultPanel.js';
import { RulePanel } from './RulePanel.js';
import { Scoreboard } from './Scoreboard.js';
import { Table } from './Table.js';
import { GhostButton, PrimaryButton } from './buttons.js';
import { ChatBar } from './match/ChatBar.js';
import { ChatBubbles } from './match/ChatBubbles.js';
import { GameLog } from './match/GameLog.js';
import { GameStatusBar } from './match/GameStatusBar.js';
import { SettingsPanel } from './match/SettingsPanel.js';
import type { SortMode } from './match/SortPicker.js';
import { TopBar } from './match/TopBar.js';
import { FELT_SKINS, TILE_BACK_SKINS } from './match/skins.js';
import { LobbyPreview } from './menu/LobbyPreview.js';

interface MatchProps {
  onAction: (action: Action) => void;
  /** Send a chat / emote over the live transport. */
  onChat: (text: string) => void;
  /** Match code shown in the top-right "Live · #ABC" pill. Null hides the pill. */
  matchCode: string | null;
  onLeave: () => void;
}

const MOBILE_LANDSCAPE_QUERY = '(max-width: 900px) and (orientation: landscape)';
const PORTRAIT_PHONE_QUERY = '(max-width: 700px) and (orientation: portrait)';

/**
 * Top-level live-match orchestrator. Owns the SortPicker mode + Settings
 * panel state, and picks between the desktop shell (this file's
 * DesktopMatchBody) and the mobile shell (`MobileMatch`) based on
 * viewport. Portrait phone viewports get a "rotate your device" prompt
 * (a simplified portrait shell is queued in TODO.md).
 */
export function Match({ onAction, onChat, matchCode, onLeave }: MatchProps) {
  const state = useGame((s) => s.state);
  const you = useGame((s) => s.you);
  const lobby = useGame((s) => s.lobby);
  const settings = useGame((s) => s.settings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const initialSort: SortMode = settings.autoSort ? 'suit' : 'manual';
  const [sortMode, setSortMode] = useState<SortMode>(initialSort);

  const isMobileLandscape = useMediaQuery(MOBILE_LANDSCAPE_QUERY);
  const isPortraitPhone = useMediaQuery(PORTRAIT_PHONE_QUERY);

  // If autoSort flips on while a match is in progress, snap the local sort
  // mode back to 'suit' so the user immediately sees the preference take
  // effect — otherwise the toggle would silently no-op until the next hand.
  useEffect(() => {
    if (settings.autoSort) setSortMode('suit');
  }, [settings.autoSort]);

  const seat = you !== null && you !== 'spectator' ? you : null;
  const isHost = isSeatHost(lobby, seat);

  const onTurnTimeoutChange = useCallback(
    (turnTimeoutMs: number) => onAction({ t: 'setRules', rules: { turnTimeoutMs } }),
    [onAction],
  );

  // Seat-to-visual-position map (drives `ChatBubbles` anchoring + the
  // mobile shared-discard pool's per-seat colour underline). The user is
  // always at the bottom; the others rotate via nextSeat / acrossSeat /
  // prevSeat. Memoised so a stable reference can flow into memoised
  // children without churning on every render.
  const seatToPosition = useMemo<Record<Seat, 'bottom' | 'right' | 'top' | 'left'>>(() => {
    const m: Record<Seat, 'bottom' | 'right' | 'top' | 'left'> = {
      0: 'bottom',
      1: 'bottom',
      2: 'bottom',
      3: 'bottom',
    };
    if (seat === null) return m;
    m[seat] = 'bottom';
    m[nextSeat(seat)] = 'right';
    m[acrossSeat(seat)] = 'top';
    m[prevSeat(seat)] = 'left';
    return m;
  }, [seat]);

  if (!state || seat === null) {
    return <div>Waiting for the game to start…</div>;
  }

  if (state.phase === 'waiting') {
    return (
      <div
        style={{
          padding: 24,
          color: INK,
          fontFamily: SANS,
          maxWidth: 760,
          margin: '0 auto',
        }}
      >
        <h2 style={{ margin: '0 0 4px', fontWeight: 900 }}>Lobby</h2>
        <p style={{ margin: '0 0 12px', fontSize: 13, opacity: 0.7 }}>
          {isHost
            ? 'Share the match code with friends. Start when everyone is ready.'
            : 'Waiting for the host to start the match.'}
        </p>
        {lobby ? <LobbyPreview lobby={lobby} matchCode={matchCode} /> : null}
        <RulePanel rules={state.rules} isHost={isHost} onAction={onAction} />
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <PrimaryButton
            disabled={!isHost}
            onClick={() => onAction({ t: 'startHand', seed: randomSeed(), dealer: 0 })}
          >
            Start match
          </PrimaryButton>
          <GhostButton onClick={onLeave}>Leave</GhostButton>
        </div>
      </div>
    );
  }

  if (isPortraitPhone) {
    return <PortraitFallback />;
  }

  const overlays = (
    <>
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        isHost={isHost}
        turnTimeoutMs={state.rules.turnTimeoutMs}
        onTurnTimeoutChange={onTurnTimeoutChange}
      />
      <GameLog open={logOpen} onClose={() => setLogOpen(false)} />
      <ChatBubbles seatToPosition={seatToPosition} />
    </>
  );

  if (isMobileLandscape) {
    return (
      <>
        <MobileMatch
          onAction={onAction}
          onChat={onChat}
          matchCode={matchCode}
          onLeave={onLeave}
          sortMode={sortMode}
          onSortModeChange={setSortMode}
          onOpenSettings={() => setSettingsOpen(true)}
          onOpenLog={() => setLogOpen(true)}
        />
        {overlays}
      </>
    );
  }

  return (
    <>
      <DesktopMatchBody
        onAction={onAction}
        onChat={onChat}
        matchCode={matchCode}
        onLeave={onLeave}
        seat={seat}
        state={state}
        lobby={lobby}
        settings={settings}
        sortMode={sortMode}
        onSortModeChange={setSortMode}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenLog={() => setLogOpen(true)}
      />
      {overlays}
    </>
  );
}

interface DesktopMatchBodyProps {
  onAction: (action: Action) => void;
  onChat: (text: string) => void;
  matchCode: string | null;
  onLeave: () => void;
  seat: Seat;
  /** Current engine state — already non-null-validated by the parent. */
  state: GameState;
  lobby: LobbyState | null;
  settings: UserSettings;
  sortMode: SortMode;
  onSortModeChange: (mode: SortMode) => void;
  onOpenSettings: () => void;
  onOpenLog: () => void;
}

function DesktopMatchBody({
  onAction,
  onChat,
  matchCode,
  onLeave,
  seat,
  state,
  lobby,
  settings,
  sortMode,
  onSortModeChange,
  onOpenSettings,
  onOpenLog,
}: DesktopMatchBodyProps) {
  const drawnTileId = useGame((s) => s.drawnTileId);
  const manualOrder = useGame((s) => s.manualOrder);
  const setManualOrder = useGame((s) => s.setManualOrder);

  const myTurn = state.phase === 'turn' && state.turn === seat;
  const isHost = isSeatHost(lobby, seat);
  const needsDraw = myTurn && !state.hasDrawn;

  const onDiscard = useCallback(
    (t: MTile) => {
      if (myTurn) {
        onAction({ t: 'discard', seat, tile: t });
        void vibrateLight();
      }
    },
    [myTurn, seat, onAction],
  );

  const onDrawNext = useMemo(
    () => (needsDraw ? () => onAction({ t: 'draw', seat }) : undefined),
    [needsDraw, seat, onAction],
  );

  const showClaim = (() => {
    if (state.phase !== 'awaitingClaims') return false;
    if (!state.lastDiscard || state.lastDiscard.from === seat) return false;
    const legal = legalClaimsFor(state, seat).filter((k) => k !== 'pass');
    if (legal.length > 0) return true;
    const handPlusTile = [...state.hands[seat], state.lastDiscard.tile];
    return isWinning({
      hand: handPlusTile,
      exposedMelds: state.melds[seat].length,
      allowSpecial: state.rules.allowSevenPairs || state.rules.allowThirteenOrphans,
    });
  })();

  const canTsumo =
    myTurn &&
    state.hasDrawn &&
    isWinning({
      hand: state.hands[seat],
      exposedMelds: state.melds[seat].length,
      allowSpecial: state.rules.allowSevenPairs || state.rules.allowThirteenOrphans,
    });

  const felt = FELT_SKINS[settings.felt];
  const tileBack = TILE_BACK_SKINS[settings.tileBack];

  // Stable reference for the CSS-var bag — avoids re-creating the style
  // object every render so a future `React.memo`-wrapped Table consumer
  // wouldn't have it defeated by inline-prop churn.
  const containerStyle = useMemo(
    (): React.CSSProperties => ({
      position: 'relative',
      padding: 12,
      color: INK,
      fontFamily: SANS,
      ['--tile-w' as string]: 'max(22px, 3.6vmin)',
      ['--tile-h' as string]: 'max(30px, 5vmin)',
      ['--felt-1' as string]: felt.top,
      ['--felt-2' as string]: felt.bottom,
      ['--tile-back-1' as string]: tileBack.top,
      ['--tile-back-2' as string]: tileBack.bottom,
    }),
    [felt.top, felt.bottom, tileBack.top, tileBack.bottom],
  );

  // While someone is deciding whether to claim, pulse the live tile in the
  // discarder's pile so claimers can track which tile is on offer.
  const latestDiscardId =
    state.phase === 'awaitingClaims' && state.lastDiscard ? tileId(state.lastDiscard.tile) : null;

  return (
    <div style={containerStyle}>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'center',
          gap: 12,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <GameStatusBar
          prevailing={state.prevailingWind}
          dealerName={nameForSeat(lobby, state.dealer)}
          wallCount={state.wall.length}
          isMyTurn={myTurn}
        />
        <TopBar
          gameId={matchCode}
          viewers={lobby?.viewers ?? null}
          onLeave={onLeave}
          onSettings={onOpenSettings}
          onLog={onOpenLog}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
        <ChatBar onSend={onChat} />
      </div>
      <Scoreboard />
      <Table
        mySeat={seat}
        dealer={state.dealer}
        turn={state.turn}
        scoreboard={state.scoreboard}
        hands={state.hands}
        discards={state.discards}
        lobby={lobby}
        ownHandClickable={myTurn ? onDiscard : undefined}
        onDrawNext={onDrawNext}
        sortMode={sortMode}
        onSortModeChange={onSortModeChange}
        latestDiscardId={latestDiscardId}
        drawnTileId={drawnTileId}
        manualOrder={manualOrder}
        onReorder={setManualOrder}
        breakPosition={state.openingRolls?.breakPosition}
        liveWallCount={state.wall.length}
        nextDrawTile={state.wall.length > 0 ? state.wall[state.wall.length - 1] : null}
      />
      {canTsumo && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => onAction({ t: 'declareWin', seat, selfDraw: true })}>
            Declare win (tsumo)
          </button>
        </div>
      )}
      {showClaim && <ClaimBar onAction={onAction} seat={seat} />}
      {state.lastResult && <ResultPanel onAction={onAction} mySeat={seat} isHost={isHost} />}
    </div>
  );
}

function PortraitFallback() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        textAlign: 'center',
        fontFamily: SANS,
        color: INK,
      }}
    >
      <div style={{ maxWidth: 320 }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🔄</div>
        <h2 style={{ margin: '0 0 8px', fontWeight: 900 }}>Rotate your device</h2>
        <p style={{ margin: 0, fontSize: 14, opacity: 0.7 }}>
          Modern Mahjong is built for landscape on phones. A simplified portrait shell is on the
          roadmap — for now, please rotate to landscape to play.
        </p>
      </div>
    </div>
  );
}
