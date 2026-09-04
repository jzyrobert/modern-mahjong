import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import type { TargetRect } from './TargetRegistry';
import { findFocusRect } from './chromeRects';
import { HALO_PAD, focusRect } from './placement';
import type { TargetFocus, TutorialTargetId } from './types';

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
      // Wall-clock, unclamped: on a starved renderer (software GL, a
      // busy tab) frames can be 500 ms+ apart, and a clamped step eased
      // the ring from the previous step's target over several seconds.
      // With the real dt a long gap simply lands the ring on the goal.
      const dt = Math.max(0, (now - last) / 1000);
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

/** How often the focus descendant is re-read while the outer rect is
 *  still (the winning-hand row wrapping to two lines a frame later). */
const FOCUS_RESCAN_MS = 250;

/**
 * Clip the live target rect to the step's focus band (`focusRect`),
 * reading the descendant from the DOM on web. Recomputed whenever the
 * outer rect moves and on a slow interval in between; the result is
 * deduped so callers re-render only when the band actually changes.
 * Native (no DOM) and steps without a focus pass the rect through.
 */
export function useFocusedRect(
  target: TargetRect | null,
  targetId: TutorialTargetId | null,
  focus: TargetFocus | null,
  originNode: () => { getBoundingClientRect(): { left: number; top: number } } | null,
): TargetRect | null {
  const canScan = Platform.OS === 'web' && typeof document !== 'undefined';
  const enabled = canScan && focus !== null && targetId !== null && target !== null;
  // Latest inputs, read by the interval without re-arming it.
  const inputs = useRef({ target, targetId, focus, originNode, enabled });
  inputs.current = { target, targetId, focus, originNode, enabled };
  const compute = useCallback(
    (t: TargetRect | null, id: TutorialTargetId | null, f: TargetFocus | null) => {
      const i = inputs.current;
      if (!i.enabled || !t || !id || !f) return t;
      const o = i.originNode()?.getBoundingClientRect();
      const found = findFocusRect(document, id, f, { x: o?.left ?? 0, y: o?.top ?? 0 });
      return focusRect(t, found?.through ?? null, HALO_PAD, found?.from ?? null);
    },
    [],
  );
  const latest = useCallback(() => {
    const i = inputs.current;
    return compute(i.target, i.targetId, i.focus);
  }, [compute]);
  const [focused, setFocused] = useState<TargetRect | null>(latest);
  const focusedRef = useRef(focused);
  const write = useCallback((next: TargetRect | null) => {
    const prev = focusedRef.current;
    if (prev === next || (prev && next && sameRect(prev, next))) return;
    focusedRef.current = next;
    setFocused(next);
  }, []);
  // Recompute whenever the outer rect (or the step) changes so the halo
  // and the band never disagree for a frame; keep polling in between.
  useEffect(() => {
    write(compute(target, targetId, focus));
  }, [target, targetId, focus, compute, write]);
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => write(latest()), FOCUS_RESCAN_MS);
    return () => clearInterval(id);
  }, [enabled, latest, write]);
  return enabled ? focused : target;
}
