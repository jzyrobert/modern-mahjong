import { useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { useGame } from '../state/game';

const SHUFFLE_MS = 1700;
const SPIN_COUNT = 12;
const RADIUS = 80;

/**
 * Between-hand shuffle ceremony. Native port of
 * `_legacy/src/ui/ShuffleOverlay.tsx`. Triggered by a fresh `seed`
 * landing in `useGame.state` — sets the store's `shuffling` flag so
 * Tile transitions can choose a slower spring (Phase 6 polish), and
 * fans 12 face-down tile tokens out from centre while the wall is
 * being rebuilt for the next hand.
 */
export function ShuffleOverlay() {
  const seed = useGame((s) => s.state?.seed);
  const setShuffling = useGame((s) => s.setShuffling);
  const lastSeed = useRef<number | undefined>(undefined);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (seed === undefined) return;
    if (lastSeed.current !== undefined && lastSeed.current !== seed) {
      setActive(true);
      setShuffling(true);
      const timer = setTimeout(() => {
        setActive(false);
        setShuffling(false);
      }, SHUFFLE_MS);
      lastSeed.current = seed;
      return () => clearTimeout(timer);
    }
    lastSeed.current = seed;
  }, [seed, setShuffling]);

  if (!active) return null;
  return (
    <Animated.View
      pointerEvents="none"
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(200)}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(241, 234, 220, 0.78)',
        zIndex: 90,
      }}
    >
      <View style={{ width: 220, height: 220 }}>
        {Array.from({ length: SPIN_COUNT }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: position is fixed per index
          <SpinningTile key={i} index={i} />
        ))}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              color: '#403c33',
              fontSize: 13,
              fontWeight: '800',
              letterSpacing: 0.6,
            }}
          >
            Shuffling…
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

function SpinningTile({ index }: { index: number }) {
  const angle = (index / SPIN_COUNT) * Math.PI * 2;
  const targetX = Math.cos(angle) * RADIUS;
  const targetY = Math.sin(angle) * RADIUS;
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const rot = useSharedValue(0);
  const opacity = useSharedValue(0);

  useEffect(() => {
    const config = { duration: SHUFFLE_MS, easing: Easing.inOut(Easing.ease) };
    const delay = index * 25;
    tx.value = withDelay(delay, withTiming(targetX, config));
    ty.value = withDelay(delay, withTiming(targetY, config));
    rot.value = withDelay(delay, withTiming(360, config));
    opacity.value = withDelay(delay, withTiming(1, { duration: 200 }));
  }, [index, targetX, targetY, tx, ty, rot, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { rotate: `${rot.value}deg` }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          left: '50%',
          top: '50%',
          marginLeft: -16,
          marginTop: -22,
          width: 32,
          height: 44,
          borderRadius: 4,
          backgroundColor: '#7fa9c1',
          borderColor: '#cdc1ad',
          borderWidth: 1,
          shadowColor: '#000',
          shadowOpacity: 0.25,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
          elevation: 4,
        },
        animatedStyle,
      ]}
    />
  );
}
