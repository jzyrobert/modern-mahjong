import { useCallback, useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import { useGame } from '../state/game';

/**
 * Pulse tempos by purpose. A flat 700 ms across every loop reads as
 * "the UI is alive" but doesn't signal what kind of attention each
 * cue wants. Three tiers:
 *
 *   - `urgent` (450 ms): "act now" cues — the wall next-draw halo
 *     and the in-hand draw-cue ghost slot. Sharper rhythm pushes
 *     the user toward action.
 *   - `state` (700 ms, default): ambient "this is happening"
 *     indicators — active-turn pulse on player badges and opponent
 *     hand strips. Acknowledges without demanding.
 *   - `ambient` (1100 ms): slow advisory or celebratory cues —
 *     discard-hint halo on a recommended tile, win-emblem rock.
 *     Felt rather than read.
 */
export const PULSE_TEMPO = {
  urgent: 450,
  state: 700,
  ambient: 1100,
} as const;

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

interface UseFadeInOutOptions {
  /**
   * When `visible` flips from false to true the hook fades in to
   * opacity 1 (or snaps if `settings.animations` is off). The
   * fade-out is intentionally a manual call (`fadeOut(callback)`)
   * because the typical caller pattern interleaves the fade-out
   * with a `setDismissed(true)` flag whose timing it controls
   * directly.
   */
  visible: boolean;
  /** Fade duration when animations are on. Defaults to 250 ms. */
  durationMs?: number;
}

/**
 * Fade-in on visibility, manual fade-out for dismissal.
 *
 * Both `<DiceCeremony>` and `<WinCelebration>` repeated the same
 * Animated.timing(fade, { toValue: 0/1, duration: 250 }) plumbing
 * three times each — fade-in on `visible`, fade-out from the
 * auto-dismiss timer, fade-out from the tap-dismiss handler. This
 * hook returns the value and a single `fadeOut(onComplete)` helper
 * that runs the right Animated path or snaps when the user has
 * disabled animations via `useGame.settings.animations`.
 *
 * Caller still owns the `dismissed` state + the auto-dismiss
 * `setTimeout` because the lifecycle (fade-in then wait then
 * fade-out then unmount) needs the caller's setState to land
 * after the animation completes.
 */
export function useFadeInOut({ visible, durationMs = 250 }: UseFadeInOutOptions) {
  const animsEnabled = useGame((s) => s.settings.animations);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;
    if (animsEnabled) {
      Animated.timing(fade, { toValue: 1, duration: durationMs, useNativeDriver: true }).start();
    } else {
      fade.setValue(1);
    }
  }, [visible, animsEnabled, durationMs, fade]);

  const fadeOut = useCallback(
    (onComplete?: () => void) => {
      if (animsEnabled) {
        Animated.timing(fade, {
          toValue: 0,
          duration: durationMs,
          useNativeDriver: true,
        }).start(() => onComplete?.());
      } else {
        fade.setValue(0);
        onComplete?.();
      }
    },
    [animsEnabled, durationMs, fade],
  );

  return { fade, fadeOut };
}
