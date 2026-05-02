import { SEATS } from '@mahjong/game-logic';
import { nameForSeat, useGame } from '../state/game.js';

export function Scoreboard() {
  const state = useGame((s) => s.state);
  const lobby = useGame((s) => s.lobby);
  if (!state) return null;

  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        padding: '8px 12px',
        background: '#10141d',
        borderRadius: 6,
        fontSize: 13,
      }}
    >
      <strong>Scoreboard</strong>
      {SEATS.map((s) => (
        <span key={s}>
          {nameForSeat(lobby, s)}: <b>{state.scoreboard[s]}</b>
          {s === state.dealer ? ' (dealer)' : ''}
        </span>
      ))}
    </div>
  );
}
