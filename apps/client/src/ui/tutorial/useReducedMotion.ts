import { useEffect, useState } from 'react';
import { useGame } from '../../state/game';

/**
 * True when motion should collapse to ≤ 120 ms and loops should sit
 * still: the user turned `settings.animations` off, or the OS asks
 * for reduced motion. Mirrors the check `SceneHost` performs for the
 * 3D layer so the DOM coach-marks and the canvas agree.
 */
export function useReducedMotion(): boolean {
  const animations = useGame((s) => s.settings.animations);
  const [osReduced, setOsReduced] = useState<boolean>(() => readOsPreference());
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setOsReduced(mq.matches);
    mq.addEventListener?.('change', onChange);
    return () => mq.removeEventListener?.('change', onChange);
  }, []);
  return !animations || osReduced;
}

function readOsPreference(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
