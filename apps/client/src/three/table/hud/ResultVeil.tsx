import type { Action, Seat } from '@mahjong/game-logic';
import type { CSSProperties } from 'react';
import { ResultPanel } from '../../../ui/ResultPanel';
import { TutorialTarget } from '../../../ui/tutorial/TargetRegistry';
import type { ViewportClass } from '../cameraPresets';
import { glassStyle } from './glass';

interface ResultVeilProps {
  onAction: (a: Action) => void;
  seat: Seat;
  isHost: boolean;
  onLeave: () => void;
  vpClass: ViewportClass;
}

/**
 * Between-hand summary: dim + blur veil over the (revealed) table and
 * a glass card hosting the existing `ResultPanel` logic in its glass
 * theme.
 *
 * Placement is deliberate about the tutorial coach-mark: the scoring
 * lessons anchor their caption to `result-panel`, and the overlay
 * docks the caption at whichever screen edge has more room. Portrait
 * pins the card to the bottom so the caption lands in the clear band
 * above it; landscape pins it to the left so the caption side-docks
 * on the right; desktop centres it (the caption top-docks with only a
 * few px of overlap).
 */
export function ResultVeil({ onAction, seat, isHost, onLeave, vpClass }: ResultVeilProps) {
  const portrait = vpClass === 'phone-portrait';
  const landscape = vpClass === 'phone-landscape';
  const compact = vpClass !== 'desktop';
  const veil: CSSProperties = {
    position: 'absolute',
    inset: 0,
    zIndex: 20,
    background: 'rgba(6,10,8,0.46)',
    backdropFilter: 'blur(3px)',
    WebkitBackdropFilter: 'blur(3px)',
    display: 'flex',
    alignItems: portrait ? 'flex-end' : 'center',
    justifyContent: landscape ? 'flex-start' : 'center',
    padding: compact ? 12 : 24,
    pointerEvents: 'auto',
    boxSizing: 'border-box',
  };
  const card: CSSProperties = landscape
    ? { width: 'min(480px, 58%)', maxHeight: '100%' }
    : portrait
      ? { width: '100%', maxWidth: 560, maxHeight: '86%' }
      : { width: '60%', minWidth: 480, maxWidth: 720, maxHeight: '100%' };
  return (
    <div className="mj-hud-fade" style={veil}>
      <div
        data-testid="result-veil-card"
        style={glassStyle({
          ...card,
          overflowY: 'auto',
          padding: compact ? 6 : 12,
          borderRadius: 20,
          background: 'rgba(14,20,17,0.82)',
          border: '1px solid rgba(216,168,90,0.35)',
        })}
      >
        <TutorialTarget id="result-panel">
          <ResultPanel
            onAction={onAction}
            mySeat={seat}
            isHost={isHost}
            onLeave={onLeave}
            theme="glass"
            compact={compact}
          />
        </TutorialTarget>
      </div>
    </div>
  );
}
