import type { Action, Seat } from '@mahjong/game-logic';
import type { CSSProperties } from 'react';
import { useGame } from '../../../state/game';
import { LESSONS, useTutorial } from '../../../state/tutorial';
import { ResultPanel } from '../../../ui/ResultPanel';
import { TutorialTarget } from '../../../ui/tutorial/TargetRegistry';
import type { ViewportClass } from '../cameraPresets';
import { GLASS, glassStyle } from './glass';

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
 *
 * A win stamps a gold 和 seal onto the card's corner (`WinStamp`) — the
 * 3D renderer's celebration, replacing the classic full-screen cream
 * card that used to pop over this veil. Lessons that stage a result on
 * every example step (`Lesson.suppressWinCelebration`) skip the stamp,
 * the same rule the classic celebration follows.
 */
export function ResultVeil({ onAction, seat, isHost, onLeave, vpClass }: ResultVeilProps) {
  const portrait = vpClass === 'phone-portrait';
  const result = useGame((s) => s.state?.lastResult);
  const activeLessonId = useTutorial((s) => s.active?.lessonId ?? null);
  const suppressed = activeLessonId
    ? (LESSONS[activeLessonId]?.suppressWinCelebration ?? false)
    : false;
  const win = result?.kind === 'win' && !suppressed;
  const winKey =
    result?.kind === 'win' ? `${result.winner}:${result.faan}:${result.selfDraw ? 1 : 0}` : '';
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
          border: win ? '1px solid rgba(216,168,90,0.6)' : '1px solid rgba(216,168,90,0.35)',
          boxShadow: win
            ? '0 0 0 3px rgba(216,168,90,0.12), 0 0 48px rgba(216,168,90,0.22), 0 12px 40px rgba(0,0,0,0.35)'
            : GLASS.shadow,
          position: 'relative',
        })}
      >
        {win ? <WinStamp key={winKey} compact={compact} /> : null}
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

/**
 * Gold 和 seal in the card's top-right corner: a lacquer-red disc with a
 * gold ring and the serif glyph, stamped down (scale 1.7 → 1, −8° tilt)
 * as the card fades in. Transform-only CSS keyframes — the seal is
 * opaque from its first frame, so a stalled compositor never shows the
 * card without it; `prefers-reduced-motion` and the animations setting
 * collapse it to the resting pose via `mj-win-stamp` (see `HUD_CSS`).
 */
function WinStamp({ compact }: { compact: boolean }) {
  const reduced = useGame((s) => !s.settings.animations);
  const size = compact ? 64 : 88;
  return (
    <div
      data-testid="win-stamp"
      aria-label="Winning hand"
      className={reduced ? undefined : 'mj-win-stamp'}
      style={{
        position: 'absolute',
        top: compact ? 8 : 14,
        right: compact ? 10 : 18,
        width: size,
        height: size,
        borderRadius: size / 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(circle at 50% 40%, #b8503a 0%, #8f3628 100%)',
        border: '2px solid rgba(216,168,90,0.9)',
        boxShadow:
          '0 0 0 4px rgba(14,20,17,0.85), 0 0 0 5px rgba(216,168,90,0.45), 0 10px 30px rgba(0,0,0,0.45), inset 0 0 18px rgba(0,0,0,0.35)',
        transform: 'rotate(-8deg)',
        pointerEvents: 'none',
        zIndex: 2,
      }}
    >
      <span
        style={{
          fontFamily: GLASS.serif,
          fontWeight: 700,
          fontSize: Math.round(size * 0.58),
          lineHeight: 1,
          color: '#f3d9a0',
          textShadow: '0 1px 0 rgba(0,0,0,0.35)',
        }}
      >
        和
      </span>
    </div>
  );
}
