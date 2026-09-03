import { useEffect, useRef, useState } from 'react';
import type { TargetRect } from './TargetRegistry';

/**
 * Two smoothing layers between the registry's raw rect writes and the
 * overlay's paint:
 *
 *   - `useFollowedRect` — the halo. Exponentially eases the displayed
 *     rect toward the live one on `requestAnimationFrame` (half-life
 *     ~60 ms) so a target that jumps or glides (the 3D camera easing,
 *     a hand row reflowing) reads as a smooth pan rather than a
 *     teleport. Snaps under reduced motion and whenever the rect
 *     appears / disappears.
 *   - `useSettledRect` — the caption card. Trailing-debounces the
 *     live rect by `delayMs` so a continuously moving target repositions
 *     the card once, when it comes to rest, instead of jittering the
 *     card every frame. Snaps on step change and on null ↔ rect
 *     transitions so a fresh step never waits for the debounce.
 */
const HALF_LIFE_S = 0.06;
const EPSILON_PX = 0.3;

export function useFollowedRect(
  target: TargetRect | null,
  reducedMotion: boolean,
): TargetRect | null {
  const [shown, setShown] = useState<TargetRect | null>(target);
  const shownRef = useRef<TargetRect | null>(target);
  const targetRef = useRef(target);
  targetRef.current = target;

  useEffect(() => {
    const from = shownRef.current;
    if (!target || !from || reducedMotion) {
      shownRef.current = target;
      setShown(target);
      return;
    }
    if (sameRect(from, target)) return;
    let raf = 0;
    let last = performance.now();
    const cur = { ...from };
    const tick = (now: number) => {
      const goal = targetRef.current;
      if (!goal) {
        shownRef.current = null;
        setShown(null);
        return;
      }
      const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      last = now;
      const k = 1 - 2 ** (-dt / HALF_LIFE_S);
      cur.x += (goal.x - cur.x) * k;
      cur.y += (goal.y - cur.y) * k;
      cur.w += (goal.w - cur.w) * k;
      cur.h += (goal.h - cur.h) * k;
      const done =
        Math.abs(goal.x - cur.x) < EPSILON_PX &&
        Math.abs(goal.y - cur.y) < EPSILON_PX &&
        Math.abs(goal.w - cur.w) < EPSILON_PX &&
        Math.abs(goal.h - cur.h) < EPSILON_PX;
      const next = done ? goal : { x: cur.x, y: cur.y, w: cur.w, h: cur.h };
      shownRef.current = next;
      setShown(next);
      if (!done) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, reducedMotion]);

  return shown;
}

export function useSettledRect(
  target: TargetRect | null,
  stepKey: string,
  delayMs = 140,
): TargetRect | null {
  const [settled, setSettled] = useState<TargetRect | null>(target);
  const settledRef = useRef<TargetRect | null>(target);
  const keyRef = useRef(stepKey);

  useEffect(() => {
    const keyChanged = keyRef.current !== stepKey;
    keyRef.current = stepKey;
    if (keyChanged || target === null || settledRef.current === null) {
      settledRef.current = target;
      setSettled(target);
      return;
    }
    if (sameRect(settledRef.current, target)) return;
    const id = setTimeout(() => {
      settledRef.current = target;
      setSettled(target);
    }, delayMs);
    return () => clearTimeout(id);
  }, [target, stepKey, delayMs]);

  return settled;
}

function sameRect(a: TargetRect, b: TargetRect): boolean {
  return (
    Math.abs(a.x - b.x) < 0.5 &&
    Math.abs(a.y - b.y) < 0.5 &&
    Math.abs(a.w - b.w) < 0.5 &&
    Math.abs(a.h - b.h) < 0.5
  );
}
