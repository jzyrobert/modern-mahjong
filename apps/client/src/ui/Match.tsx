import type { Action, Tile as MTile } from '@mahjong/game-logic';
import { motion } from 'framer-motion';
import { useCallback, useMemo } from 'react';
import { vibrateLight } from '../native/init.js';
import { TILE_BACK_BG } from '../native/theme.js';
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

  const centerHud = useMemo(() => {
    if (!state) return null;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
        <div>Wall: {state.wall.length}</div>
        <div>Turn: seat {state.turn}</div>
        <div>{state.prevailingWind} round</div>
        {needsDraw && seat !== null && <DrawTile onDraw={() => onAction({ t: 'draw', seat })} />}
      </div>
    );
  }, [state, needsDraw, seat, onAction]);

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
        // and back up on desktop. The 28/40 floor keeps them tappable on tiny screens.
        ['--tile-w' as string]: 'max(28px, 4.4vmin)',
        ['--tile-h' as string]: 'max(40px, 6.2vmin)',
      }}
    >
      <Scoreboard />
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
 * Clickable face-down tile shown in the center HUD when it's the local
 * player's turn and they haven't drawn yet. Replaces the older "Draw"
 * button — surfacing the action on the wall reads more naturally and
 * frees a row of vertical space on landscape mobile.
 */
function DrawTile({ onDraw }: { onDraw: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onDraw}
      aria-label="Draw a tile"
      whileTap={{ scale: 0.94 }}
      animate={{ boxShadow: ['0 0 0 0 #f3c54a99', '0 0 0 10px #f3c54a00', '0 0 0 0 #f3c54a99'] }}
      transition={{ duration: 1.4, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
      style={{
        width: 'var(--tile-w, 36px)',
        height: 'var(--tile-h, 50px)',
        background: TILE_BACK_BG,
        borderRadius: 6,
        border: '2px solid #f3c54a',
        cursor: 'pointer',
        padding: 0,
      }}
    />
  );
}
