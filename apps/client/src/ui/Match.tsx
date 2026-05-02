import type { Action, Tile as MTile, Seat } from '@mahjong/game-logic';
import { useCallback, useMemo } from 'react';
import { vibrateLight } from '../native/init.js';
import { isSeatHost, useGame } from '../state/game.js';
import { randomSeed } from '../util.js';
import { ClaimBar } from './ClaimBar.js';
import { ResultPanel } from './ResultPanel.js';
import { RulePanel } from './RulePanel.js';
import { Scoreboard } from './Scoreboard.js';
import { Table } from './Table.js';

interface MatchProps {
  onAction: (action: Action) => void;
}

export function Match({ onAction }: MatchProps) {
  const state = useGame((s) => s.state);
  const you = useGame((s) => s.you);
  const lobby = useGame((s) => s.lobby);

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

  const centerHud = useMemo(() => {
    if (!state) return null;
    return (
      <div style={{ fontSize: 11, opacity: 0.6, lineHeight: 1.4 }}>
        Turn: seat {state.turn}
        <br />
        {state.prevailingWind} round
      </div>
    );
  }, [state]);

  if (!state || seat === null) {
    return <div>Waiting for the game to start…</div>;
  }

  if (state.phase === 'waiting') {
    return (
      <div
        style={{ padding: 24, color: '#eee', fontFamily: 'system-ui, sans-serif', maxWidth: 560 }}
      >
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

  const showClaim = state.phase === 'awaitingClaims' && state.lastDiscard?.from !== seat;

  return (
    <div
      style={{
        padding: 12,
        color: '#eee',
        fontFamily: 'system-ui, sans-serif',
        // Viewport-aware tile sizing — tiles scale down on cramped landscape phones
        // and back up on desktop. The 22/30 floor keeps them tappable on tiny
        // screens while letting 14 hand tiles fit in a single row at 800x360.
        ['--tile-w' as string]: 'max(22px, 3.6vmin)',
        ['--tile-h' as string]: 'max(30px, 5vmin)',
      }}
    >
      <Scoreboard />
      <Table
        mySeat={seat}
        hands={state.hands}
        discards={state.discards}
        wallSlices={wallSlices}
        ownHandClickable={myTurn ? onDiscard : undefined}
        onDrawNext={onDrawNext}
        centerHud={centerHud}
      />
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => onAction({ t: 'declareWin', seat, selfDraw: true })}
          disabled={!myTurn || !state.hasDrawn}
        >
          Declare win (tsumo)
        </button>
      </div>
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
