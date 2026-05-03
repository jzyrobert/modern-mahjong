import type { Action, Tile as MTile, Seat } from '@mahjong/game-logic';
import { isWinning, legalClaimsFor, tileId } from '@mahjong/game-logic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { vibrateLight } from '../native/init.js';
import { INK, SANS } from '../native/theme.js';
import { isSeatHost, nameForSeat, useGame } from '../state/game.js';
import { randomSeed } from '../util.js';
import { useMediaQuery } from '../util/useMediaQuery.js';
import { ClaimBar } from './ClaimBar.js';
import { MobileMatch } from './MobileMatch.js';
import { ResultPanel } from './ResultPanel.js';
import { RulePanel } from './RulePanel.js';
import { Scoreboard } from './Scoreboard.js';
import { Table } from './Table.js';
import { GameLog } from './match/GameLog.js';
import { GameStatusBar } from './match/GameStatusBar.js';
import { SettingsPanel } from './match/SettingsPanel.js';
import type { SortMode } from './match/SortPicker.js';
import { TopBar } from './match/TopBar.js';
import { FELT_SKINS, TILE_BACK_SKINS } from './match/skins.js';

interface MatchProps {
  onAction: (action: Action) => void;
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
export function Match({ onAction, matchCode, onLeave }: MatchProps) {
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

  if (!state || seat === null) {
    return <div>Waiting for the game to start…</div>;
  }

  if (state.phase === 'waiting') {
    return (
      <div style={{ padding: 24, color: INK, fontFamily: SANS, maxWidth: 560 }}>
        <h2>Lobby</h2>
        <p>You are seated as seat {seat}. Hit start when everyone has joined.</p>
        <RulePanel rules={state.rules} isHost={isHost} onAction={onAction} />
        <button
          type="button"
          disabled={!isHost}
          onClick={() => onAction({ t: 'startHand', seed: randomSeed(), dealer: 0 })}
        >
          Start match
        </button>
        {!isHost && (
          <p style={{ fontSize: 12, opacity: 0.6, marginTop: 8 }}>
            Waiting for the host to start the match.
          </p>
        )}
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
    </>
  );

  if (isMobileLandscape) {
    return (
      <>
        <MobileMatch
          onAction={onAction}
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
        matchCode={matchCode}
        onLeave={onLeave}
        seat={seat}
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
  matchCode: string | null;
  onLeave: () => void;
  seat: Seat;
  sortMode: SortMode;
  onSortModeChange: (mode: SortMode) => void;
  onOpenSettings: () => void;
  onOpenLog: () => void;
}

function DesktopMatchBody({
  onAction,
  matchCode,
  onLeave,
  seat,
  sortMode,
  onSortModeChange,
  onOpenSettings,
  onOpenLog,
}: DesktopMatchBodyProps) {
  const state = useGame((s) => s.state)!;
  const you = useGame((s) => s.you);
  const lobby = useGame((s) => s.lobby);
  const settings = useGame((s) => s.settings);
  const drawnTileId = useGame((s) => s.drawnTileId);

  const myTurn = state.phase === 'turn' && state.turn === you;
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

  const wallSlices = useMemo(() => distributeWall(state.wall), [state.wall]);

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

  // While someone is deciding whether to claim, pulse the live tile in the
  // discarder's pile so claimers can track which tile is on offer.
  const latestDiscardId =
    state.phase === 'awaitingClaims' && state.lastDiscard ? tileId(state.lastDiscard.tile) : null;

  return (
    <div
      style={{
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
      }}
    >
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
          onLeave={onLeave}
          onSettings={onOpenSettings}
          onLog={onOpenLog}
        />
      </div>
      <Scoreboard />
      <Table
        mySeat={seat}
        dealer={state.dealer}
        turn={state.turn}
        scoreboard={state.scoreboard}
        hands={state.hands}
        discards={state.discards}
        wallSlices={wallSlices}
        lobby={lobby}
        ownHandClickable={myTurn ? onDiscard : undefined}
        onDrawNext={onDrawNext}
        sortMode={sortMode}
        onSortModeChange={onSortModeChange}
        latestDiscardId={latestDiscardId}
        drawnTileId={drawnTileId}
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

/**
 * Split the live wall into per-seat slices by index modulo 4. Keeping the
 * draw order stable across seats means seat 0's slice is `[wall[0], wall[4],
 * wall[8], …]` — so the next-to-draw tile is always `slice[0]` on the
 * dealer's wall.
 */
function distributeWall(wall: readonly MTile[]): Record<Seat, readonly MTile[]> {
  const out: Record<Seat, MTile[]> = { 0: [], 1: [], 2: [], 3: [] };
  for (const [i, tile] of wall.entries()) {
    out[(i % 4) as Seat].push(tile);
  }
  return out as Record<Seat, readonly MTile[]>;
}
