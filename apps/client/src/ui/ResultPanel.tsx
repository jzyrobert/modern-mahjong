import type { Action, Seat } from '@mahjong/game-logic';
import { nextDealer } from '@mahjong/game-logic';
import { useGame } from '../state/game.js';
import { randomSeed } from '../util.js';
import { RulePanel } from './RulePanel.js';

interface ResultPanelProps {
  onAction: (a: Action) => void;
  mySeat: Seat;
  isHost: boolean;
}

export function ResultPanel({ onAction, mySeat, isHost }: ResultPanelProps) {
  const state = useGame((s) => s.state)!;
  const r = state.lastResult!;
  const dealerForNext = nextDealer(state);
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
      <RulePanel rules={state.rules} isHost={isHost} onAction={onAction} />
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          disabled={!isHost}
          onClick={() => onAction({ t: 'startHand', seed: randomSeed(), dealer: dealerForNext })}
        >
          Start next hand
        </button>{' '}
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          (you are seat {mySeat}; next dealer will be seat {dealerForNext})
        </span>
      </div>
    </div>
  );
}
