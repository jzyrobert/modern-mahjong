import { type ReactNode, useEffect, useRef } from 'react';
import { Animated, Easing, Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import { useGame } from '../../state/game';

interface RevealProps {
  /** Stagger slot — each slot delays the entrance by 60 ms. */
  index?: number;
  style?: ViewStyle | undefined;
  children: ReactNode;
}

const DURATION_MS = 400;
const STAGGER_MS = 60;
const LIFT_PX = 12;

/** OS-level reduced-motion query (web only; native reads the setting). */
export function prefersReducedMotion(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return false;
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  } catch {
    return false;
  }
}

/**
 * Entrance choreography for lobby cards: translateY 12 → 0 + opacity
 * 0 → 1 over 400 ms (transform / opacity only), staggered by `index`.
 * Collapses to an instant show when `settings.animations` is off or
 * the OS asks for reduced motion.
 *
 * Web drives it with a CSS animation (`animationKeyframes`, compiled by
 * RN-web into a stylesheet rule) so the compositor runs it even while
 * the main thread is busy hydrating the bundle on a cold start — a
 * JS-driven `Animated.timing` stalled there and left cards transparent
 * for seconds. Native keeps the `Animated` path (no CSS).
 *
 * Every wrapper carries `data-reveal` so the screenshot verifier can
 * wait for the stagger to finish (`waitForSettled` in shot.mjs) instead
 * of sleeping.
 */
export function Reveal({ index = 0, style, children }: RevealProps) {
  const animations = useGame((s) => s.settings.animations);
  const reduce = !animations || prefersReducedMotion();
  if (Platform.OS === 'web') {
    return (
      <View
        {...REVEAL_DATASET}
        style={[
          style,
          reduce ? webStyles.shown : webStyles.reveal,
          reduce ? null : ({ animationDelay: `${index * STAGGER_MS}ms` } as ViewStyle),
        ]}
      >
        {children}
      </View>
    );
  }
  return (
    <NativeReveal index={index} style={style} reduce={reduce}>
      {children}
    </NativeReveal>
  );
}

function NativeReveal({
  index,
  style,
  reduce,
  children,
}: RevealProps & { index: number; reduce: boolean }) {
  const v = useRef(new Animated.Value(reduce ? 1 : 0)).current;

  useEffect(() => {
    if (reduce) {
      v.setValue(1);
      return;
    }
    const anim = Animated.timing(v, {
      toValue: 1,
      duration: DURATION_MS,
      delay: index * STAGGER_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [v, index, reduce]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: v,
          transform: [
            { translateY: v.interpolate({ inputRange: [0, 1], outputRange: [LIFT_PX, 0] }) },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}

/** `dataSet` is an RN-web prop (→ `data-*` attributes); it isn't in the
 *  RN typings, so it's spread through an untyped object. */
const REVEAL_DATASET = (Platform.OS === 'web' ? { dataSet: { reveal: 'in' } } : {}) as Record<
  string,
  never
>;

// `animationKeyframes` is web-only and only honoured through
// `StyleSheet.create` (RN-web compiles it to a @keyframes rule); the
// typings don't know it, hence the cast.
const webStyles = StyleSheet.create({
  reveal: {
    opacity: 1,
    animationKeyframes: {
      '0%': { opacity: 0, transform: `translateY(${LIFT_PX}px)` },
      '100%': { opacity: 1, transform: 'translateY(0px)' },
    },
    animationDuration: `${DURATION_MS}ms`,
    animationTimingFunction: 'cubic-bezier(0.33, 1, 0.68, 1)',
    animationFillMode: 'both',
  } as ViewStyle,
  shown: { opacity: 1 },
});
