import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

interface UsePulseOptions {
  /**
   * When false, the pulse stops and the value snaps back to 0.
   * Defaults to true (always-on pulse — used by transient overlays
   * like the wall halo, the WinCelebration emblem, the draw-cue
   * ghost slot). Set this for conditional pulses keyed on state
   * (e.g. `isActive` for the active-turn glow on PlayerBadge /
   * OppHandStrip, `recommended` for the discard-hint halo on
   * HandTile).
   */
  enabled?: boolean;
  /**
   * Half-period of the pulse in ms — the time spent fading from 0
   * to 1 (or 1 to 0). Total cycle is `2 * durationMs`. Defaults to
   * 700 ms which is what the active-turn pulses use; the
   * win-celebration emblem and the discard-hint halo nudge it up
   * to 800 ms for a slightly slower / softer cadence.
   */
  durationMs?: number;
}

/**
 * Looping 0 → 1 → 0 pulse driven on the native thread. Six UI
 * surfaces (the wall next-draw halo, the hand draw-cue ghost slot,
 * the discard-hint tile halo on HandTile, the WinCelebration
 * emblem, the active-turn pulse on PlayerBadge, and the same
 * active-turn pulse on OppHandStrip) all shared an identical
 * `Animated.loop(Animated.sequence([up, down]))` block with
 * `Easing.inOut(Easing.ease)` and `useNativeDriver: true`. This
 * hook factors out the boilerplate.
 *
 * Returns a stable `Animated.Value` callers can `interpolate()` for
 * scale, opacity, rotate — same pattern they were using before
 * extraction. Cleanup stops the loop on unmount or when `enabled`
 * flips to false; `enabled: false` also resets the value to 0 so
 * the next "on" cycle starts from the same zero state.
 */
export function usePulse({ enabled = true, durationMs = 700 }: UsePulseOptions = {}) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!enabled) {
      value.stopAnimation();
      value.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, {
          toValue: 1,
          duration: durationMs,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
        Animated.timing(value, {
          toValue: 0,
          duration: durationMs,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [enabled, durationMs, value]);
  return value;
}
