import type { Action, Seat } from '@mahjong/game-logic';
import { nextDealer } from '@mahjong/game-logic';
import { useState } from 'react';
import { HAIRLINE, PAPER } from '../native/theme.js';
import { useGame } from '../state/game.js';
import { randomSeed } from '../util.js';
import { RulePanel } from './RulePanel.js';
import { ScoringBreakdownModal } from './ScoringBreakdownModal.js';

interface ResultPanelProps {
  onAction: (a: Action) => void;
  mySeat: Seat;
  isHost: boolean;
}

export function ResultPanel({ onAction, mySeat, isHost }: ResultPanelProps) {
  const state = useGame((s) => s.state)!;
  const r = state.lastResult!;
  const dealerForNext = nextDealer(state);
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  return (
    <div
      style={{
        marginTop: 16,
        padding: 12,
        background: PAPER,
        border: `1px solid ${HAIRLINE}`,
        borderRadius: 6,
      }}
    >
      {r.kind === 'win' ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <strong>Seat {r.winner} wins!</strong>
            <span>
              {r.faan} faan ({r.selfDraw ? 'self-draw' : `from seat ${r.from}`})
            </span>
            <button
              type="button"
              onClick={() => setBreakdownOpen(true)}
              style={{ marginLeft: 'auto' }}
            >
              Scoring breakdown
            </button>
          </div>
          <ScoringBreakdownModal
            open={breakdownOpen}
            onClose={() => setBreakdownOpen(false)}
            result={r}
            faanMin={state.rules.faanMin}
          />
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
