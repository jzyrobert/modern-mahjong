import type { Action, Tile as MTile } from '@mahjong/game-logic';
import { useCallback, useMemo } from 'react';
import { useGame } from '../state/game.js';
import { randomSeed } from '../util.js';
import { ClaimBar } from './ClaimBar.js';
import { ResultPanel } from './ResultPanel.js';
import { Table } from './Table.js';

interface MatchProps {
  onAction: (action: Action) => void;
}

export function Match({ onAction }: MatchProps) {
  const state = useGame((s) => s.state);
  const you = useGame((s) => s.you);

  const myTurn = !!state && state.phase === 'turn' && state.turn === you;
  const seat = you !== null && you !== 'spectator' ? you : null;

  const onDiscard = useCallback(
    (t: MTile) => {
      if (myTurn && seat !== null) onAction({ t: 'discard', seat, tile: t });
    },
    [myTurn, seat, onAction],
  );

  const centerHud = useMemo(() => {
    if (!state) return null;
    return (
      <div>
        <div>Wall: {state.wall.length}</div>
        <div>Turn: seat {state.turn}</div>
        <div>{state.prevailingWind} round</div>
      </div>
    );
  }, [state]);

  if (!state || seat === null) {
    return <div>Waiting for the game to start…</div>;
  }

  if (state.phase === 'waiting') {
    return (
      <div style={{ padding: 24, color: '#eee', fontFamily: 'system-ui, sans-serif' }}>
        <h2>Lobby</h2>
        <p>You are seated as seat {seat}. Hit start when everyone has joined.</p>
        <button
          type="button"
          onClick={() => onAction({ t: 'startHand', seed: randomSeed(), dealer: 0 })}
        >
          Start match
        </button>
      </div>
    );
  }

  const showClaim = state.phase === 'awaitingClaims' && state.lastDiscard?.from !== seat;

  return (
    <div style={{ padding: 12, color: '#eee', fontFamily: 'system-ui, sans-serif' }}>
      <Table
        mySeat={seat}
        hands={state.hands}
        discards={state.discards}
        ownHandClickable={myTurn ? onDiscard : undefined}
        centerHud={centerHud}
      />
      <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
        <button
          type="button"
          onClick={() => onAction({ t: 'draw', seat })}
          disabled={!myTurn || state.hasDrawn}
        >
          Draw
        </button>
        <button
          type="button"
          onClick={() => onAction({ t: 'declareWin', seat, selfDraw: true })}
          disabled={!myTurn || !state.hasDrawn}
        >
          Declare win (tsumo)
        </button>
      </div>
      {showClaim && <ClaimBar onAction={onAction} seat={seat} />}
      {state.lastResult && <ResultPanel onAction={onAction} mySeat={seat} />}
    </div>
  );
}
