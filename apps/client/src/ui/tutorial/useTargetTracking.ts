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

/**
 * @param snapKey Step identity. When it changes the displayed rect is
 *   the live one on that very render — no ease from the previous step's
 *   target. The ease used to start from wherever the last step's ring
 *   was and advance on `requestAnimationFrame`; on a starved renderer
 *   (software GL, a busy tab) the next animation frame is the next
 *   *painted* frame, up to a second away, and the ring sat on the
 *   previous target while the card was already placed for the new one.
 */
export function useFollowedRect(
  target: TargetRect | null,
  reducedMotion: boolean,
  snapKey = '',
): TargetRect | null {
  const [shown, setShown] = useState<TargetRect | null>(target);
  const shownRef = useRef<TargetRect | null>(target);
  const targetRef = useRef(target);
  targetRef.current = target;
  const keyRef = useRef(snapKey);
  const rafRef = useRef(0);
  const lastRef = useRef(0);
  // Derived at render time so the first paint of a new step already
  // rings its target; the effect below then commits the same rect.
  const snapped = keyRef.current !== snapKey;

  useEffect(() => {
    const goal = target;
    if (snapped || !goal || !shownRef.current || reducedMotion) {
      keyRef.current = snapKey;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      if (shownRef.current !== goal) {
        shownRef.current = goal;
        setShown(goal);
      }
      return;
    }
    if (sameRect(shownRef.current, goal)) return;
    // One loop follows `targetRef` until it lands; a target that moves
    // again mid-flight only changes the goal. Restarting the loop per
    // target identity cancelled the pending frame each time, and a
    // registry re-writing its rect every render could starve it.
    if (rafRef.current) return;
    lastRef.current = performance.now();
    const tick = (now: number) => {
      rafRef.current = 0;
      const to = targetRef.current;
      const from = shownRef.current;
      if (!to || !from) {
        shownRef.current = to;
        setShown(to);
        return;
      }
      // Wall-clock, unclamped: on a starved renderer frames can be
      // 500 ms+ apart, and a clamped step eased the ring over seconds.
      // With the real dt a long gap simply lands the ring on the goal.
      const dt = Math.max(0, (now - lastRef.current) / 1000);
      lastRef.current = now;
      const k = 1 - 2 ** (-dt / HALF_LIFE_S);
      const cur = {
        x: from.x + (to.x - from.x) * k,
        y: from.y + (to.y - from.y) * k,
        w: from.w + (to.w - from.w) * k,
        h: from.h + (to.h - from.h) * k,
      };
      const done =
        Math.abs(to.x - cur.x) < EPSILON_PX &&
        Math.abs(to.y - cur.y) < EPSILON_PX &&
        Math.abs(to.w - cur.w) < EPSILON_PX &&
        Math.abs(to.h - cur.h) < EPSILON_PX;
      const next = done ? to : cur;
      shownRef.current = next;
      setShown(next);
      if (!done) rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [target, reducedMotion, snapKey, snapped]);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    },
    [],
  );

  return snapped ? target : shown;
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
