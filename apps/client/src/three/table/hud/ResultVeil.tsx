import type { Action, Seat } from '@mahjong/game-logic';
import type { ReactNode } from 'react';
import { ResultPanel } from '../../../ui/ResultPanel';
import { TutorialTarget } from '../../../ui/tutorial/TargetRegistry';
import { glassStyle } from './glass';

interface ResultVeilProps {
  onAction: (a: Action) => void;
  seat: Seat;
  isHost: boolean;
  onLeave: () => void;
  compact: boolean;
  children?: ReactNode;
}

/**
 * Between-hand summary: dim + blur veil over the (revealed) table and
 * a centred glass card hosting the existing `ResultPanel` logic.
 */
export function ResultVeil({ onAction, seat, isHost, onLeave, compact }: ResultVeilProps) {
  return (
    <div
      className="mj-hud-fade"
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 20,
        background: 'rgba(6,10,8,0.42)',
        backdropFilter: 'blur(3px)',
        WebkitBackdropFilter: 'blur(3px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: compact ? 12 : 24,
        overflowY: 'auto',
        pointerEvents: 'auto',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={glassStyle({
          width: compact ? '100%' : '60%',
          minWidth: compact ? 0 : 480,
          maxWidth: compact ? 560 : 720,
          maxHeight: '100%',
          overflowY: 'auto',
          padding: compact ? 10 : 16,
          borderRadius: 20,
          background: 'rgba(14,20,17,0.78)',
        })}
      >
        <TutorialTarget id="result-panel">
          <ResultPanel onAction={onAction} mySeat={seat} isHost={isHost} onLeave={onLeave} />
        </TutorialTarget>
      </div>
    </div>
  );
}
