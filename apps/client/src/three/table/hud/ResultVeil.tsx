import type { Action, Seat } from '@mahjong/game-logic';
import { type CSSProperties, useLayoutEffect, useRef, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { ResultPanel } from '../../../ui/ResultPanel';
import { TutorialTarget } from '../../../ui/tutorial/TargetRegistry';
import { type ViewportClass, resultPanelPinsTop } from '../cameraPresets';
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
 * above it — unless that band is too short for a card
 * (`resultPanelPinsTop`), when the card pins to the *top* instead and
 * the caption docks below the spotlit score header + winning hand,
 * over the dimmed rules / buttons; landscape pins it to the left so
 * the caption side-docks on the right; desktop centres it (the caption
 * top-docks with only a few px of overlap).
 */
export function ResultVeil({ onAction, seat, isHost, onLeave, vpClass }: ResultVeilProps) {
  const portrait = vpClass === 'phone-portrait';
  const landscape = vpClass === 'phone-landscape';
  const compact = vpClass !== 'desktop';
  const { width, height } = useWindowDimensions();
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [panelH, setPanelH] = useState<number | null>(null);
  // Measure the card before paint (web): the pin decision needs its
  // height, and a card that first painted at the bottom and then jumped
  // to the top would flash.
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const measure = () => {
      const h = el.getBoundingClientRect().height;
      if (h > 0) setPanelH(h);
    };
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);
  const pinTop = portrait && resultPanelPinsTop(width, height, panelH);
  const veil: CSSProperties = {
    position: 'absolute',
    inset: 0,
    zIndex: 20,
    background: 'rgba(6,10,8,0.46)',
    backdropFilter: 'blur(3px)',
    WebkitBackdropFilter: 'blur(3px)',
    display: 'flex',
    alignItems: portrait ? (pinTop ? 'flex-start' : 'flex-end') : 'center',
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
        ref={cardRef}
        data-testid="result-veil-card"
        data-pin={pinTop ? 'top' : 'bottom'}
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
            handTileWidth={compact ? undefined : 40}
          />
        </TutorialTarget>
      </div>
    </div>
  );
}
