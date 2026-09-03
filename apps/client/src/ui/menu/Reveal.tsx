import { type ReactNode, useEffect, useRef } from 'react';
import { Animated, Easing, Platform, type ViewStyle } from 'react-native';
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
 */
export function Reveal({ index = 0, style, children }: RevealProps) {
  const animations = useGame((s) => s.settings.animations);
  const reduce = !animations || prefersReducedMotion();
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
      useNativeDriver: false,
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
