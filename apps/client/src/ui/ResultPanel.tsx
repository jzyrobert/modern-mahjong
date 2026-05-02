import type { Action, Seat } from '@mahjong/game-logic';
import { nextSeat } from '@mahjong/game-logic';
import { useGame } from '../state/game.js';
import { randomSeed } from '../util.js';

interface ResultPanelProps {
  onAction: (a: Action) => void;
  mySeat: Seat;
}

export function ResultPanel({ onAction, mySeat }: ResultPanelProps) {
  const state = useGame((s) => s.state)!;
  const r = state.lastResult!;
  // Dealer rotation: the dealer keeps the seat if they won, otherwise rotation continues CCW.
  const nextDealer: Seat =
    r.kind === 'win' && r.winner === state.dealer ? state.dealer : nextSeat(state.dealer);
  return (
    <div style={{ marginTop: 16, padding: 12, background: '#1d2538', borderRadius: 6 }}>
      {r.kind === 'win' ? (
        <>
          <strong>Seat {r.winner} wins!</strong> {r.faan} faan (
          {r.selfDraw ? 'self-draw' : `from seat ${r.from}`}).
          <ul>
            {r.reasons.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </>
      ) : (
        <strong>Drawn game (wall empty)</strong>
      )}
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          onClick={() => onAction({ t: 'startHand', seed: randomSeed(), dealer: nextDealer })}
        >
          Start next hand
        </button>{' '}
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          (you are seat {mySeat}; next dealer will be seat {nextDealer})
        </span>
      </div>
    </div>
  );
}
