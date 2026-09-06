/**
 * Minimal spring + easing helpers for the render loop. No GSAP / no
 * react-native-reanimated — every tile flight, camera move and HUD-
 * adjacent pulse is an explicit function of `t` evaluated in
 * `loop.ts`. Keep this file dependency-free (also used by unit tests).
 */

export type Ease = (t: number) => number;

export const easeOutCubic: Ease = (t) => 1 - (1 - t) ** 3;
export const easeInCubic: Ease = (t) => t * t * t;
export const easeInOutCubic: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const easeOutBack: Ease = (t) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
};
export const easeOutQuint: Ease = (t) => 1 - (1 - t) ** 5;
export const linear: Ease = (t) => t;

export const clamp01 = (t: number): number => (t < 0 ? 0 : t > 1 ? 1 : t);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Critically-damped spring step (frame-rate independent). Mutates and
 * returns `s`. `halfLife` is the time in seconds for the remaining
 * distance to halve — 0.08 s reads snappy, 0.18 s reads floaty.
 */
export interface SpringState {
  value: number;
  velocity: number;
}

export function springStep(
  s: SpringState,
  target: number,
  dt: number,
  halfLife = 0.1,
  epsilon = 1e-3,
): boolean {
  // Exponential smoothing on the value with damped velocity — cheap,
  // stable for variable dt, no overshoot.
  const k = 1 - 2 ** (-dt / halfLife);
  const next = s.value + (target - s.value) * k;
  s.velocity = dt > 0 ? (next - s.value) / dt : 0;
  s.value = next;
  if (Math.abs(target - s.value) < epsilon && Math.abs(s.velocity) < epsilon * 10) {
    s.value = target;
    s.velocity = 0;
    return false;
  }
  return true;
}

/** A timed tween: `progress(now)` in [0, 1]; `done(now)` when past end. */
export interface Timed {
  start: number;
  duration: number;
  ease: Ease;
}

export function timed(start: number, duration: number, ease: Ease = easeOutCubic): Timed {
  return { start, duration, ease };
}

export function progress(tw: Timed, now: number): number {
  if (tw.duration <= 0) return 1;
  return tw.ease(clamp01((now - tw.start) / tw.duration));
}

export function done(tw: Timed, now: number): boolean {
  return now >= tw.start + tw.duration;
}

/** Reduced-motion: collapse every duration to at most `cap` ms. */
export function motionDuration(ms: number, reducedMotion: boolean, cap = 120): number {
  return reducedMotion ? Math.min(ms, cap) : ms;
}
