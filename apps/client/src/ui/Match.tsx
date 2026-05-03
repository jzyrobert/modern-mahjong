import type { Action, Tile as MTile, Seat } from '@mahjong/game-logic';
import { isWinning, legalClaimsFor } from '@mahjong/game-logic';
import { useCallback, useMemo, useState } from 'react';
import { vibrateLight } from '../native/init.js';
import { INK, SANS } from '../native/theme.js';
import { isSeatHost, nameForSeat, useGame } from '../state/game.js';
import { randomSeed } from '../util.js';
import { ClaimBar } from './ClaimBar.js';
import { ResultPanel } from './ResultPanel.js';
import { RulePanel } from './RulePanel.js';
import { Scoreboard } from './Scoreboard.js';
import { Table } from './Table.js';
import { GameStatusBar } from './match/GameStatusBar.js';
import type { SortMode } from './match/SortPicker.js';
import { TopBar } from './match/TopBar.js';

interface MatchProps {
  onAction: (action: Action) => void;
  /** Match code shown in the top-right "Live · #ABC" pill. Null hides the pill. */
  matchCode: string | null;
  onLeave: () => void;
}

export function Match({ onAction, matchCode, onLeave }: MatchProps) {
  const state = useGame((s) => s.state);
  const you = useGame((s) => s.you);
  const lobby = useGame((s) => s.lobby);
  const [sortMode, setSortMode] = useState<SortMode>('suit');

  const myTurn = !!state && state.phase === 'turn' && state.turn === you;
  const seat = you !== null && you !== 'spectator' ? you : null;
  const isHost = isSeatHost(lobby, seat);
  const needsDraw = myTurn && !!state && !state.hasDrawn;

  const onDiscard = useCallback(
    (t: MTile) => {
      if (myTurn && seat !== null) {
        onAction({ t: 'discard', seat, tile: t });
        void vibrateLight();
      }
    },
    [myTurn, seat, onAction],
  );

  const wallSlices = useMemo(() => distributeWall(state?.wall ?? []), [state?.wall]);

  const onDrawNext = useMemo(
    () => (needsDraw && seat !== null ? () => onAction({ t: 'draw', seat }) : undefined),
    [needsDraw, seat, onAction],
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

  // Show the claim bar only when the seat actually has something they could
  // claim against this discard (peng / gong / chi, or a winning hu). If the
  // only legal action is `pass`, there's no decision to surface — the engine
  // will auto-pass when the claim window expires.
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

  // Tsumo (self-drawn win) is only legal when it's the player's turn, they've
  // drawn (have 14 tiles), and that hand is in a winning shape. Hide the
  // button entirely otherwise — previously it rendered always-disabled
  // outside that window, which read as "I'm broken".
  const canTsumo =
    myTurn &&
    state.hasDrawn &&
    isWinning({
      hand: state.hands[seat],
      exposedMelds: state.melds[seat].length,
      allowSpecial: state.rules.allowSevenPairs || state.rules.allowThirteenOrphans,
    });

  return (
    <div
      style={{
        position: 'relative',
        padding: 12,
        color: INK,
        fontFamily: SANS,
        // Viewport-aware tile sizing — tiles scale down on cramped landscape phones
        // and back up on desktop. The 22/30 floor keeps them tappable on tiny
        // screens while letting 14 hand tiles fit in a single row at 800x360.
        ['--tile-w' as string]: 'max(22px, 3.6vmin)',
        ['--tile-h' as string]: 'max(30px, 5vmin)',
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
        <TopBar gameId={matchCode} onLeave={onLeave} />
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
        onSortModeChange={setSortMode}
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
  // Hand back as readonly to discourage downstream mutation.
  return out as Record<Seat, readonly MTile[]>;
}
