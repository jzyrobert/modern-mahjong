import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { useGame } from '../state/game';

const SHUFFLE_MS = 1700;
const SPIN_COUNT = 12;
const RADIUS = 80;

/**
 * Between-hand shuffle ceremony. Native port of
 * `_legacy/src/ui/ShuffleOverlay.tsx`. Triggered by a fresh `seed`
 * landing in `useGame.state` — sets the store's `shuffling` flag and
 * fans 12 face-down tile tokens out from centre while the wall is
 * being rebuilt for the next hand. RN core `Animated` (no reanimated)
 * so it works in Expo Go.
 */
export function ShuffleOverlay() {
  const seed = useGame((s) => s.state?.seed);
  const setShuffling = useGame((s) => s.setShuffling);
  const lastSeed = useRef<number | undefined>(undefined);
  const [active, setActive] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (seed === undefined) return;
    if (lastSeed.current !== undefined && lastSeed.current !== seed) {
      setActive(true);
      setShuffling(true);
      Animated.timing(fade, { toValue: 1, duration: 200, useNativeDriver: true }).start();
      const timer = setTimeout(() => {
        Animated.timing(fade, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
          setActive(false);
          setShuffling(false);
        });
      }, SHUFFLE_MS);
      lastSeed.current = seed;
      return () => clearTimeout(timer);
    }
    lastSeed.current = seed;
  }, [seed, setShuffling, fade]);

  if (!active) return null;
  return (
    <Animated.View
      pointerEvents="none"
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
        opacity: fade,
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
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const delay = index * 25;
    Animated.sequence([
      Animated.delay(delay),
      Animated.timing(t, {
        toValue: 1,
        duration: SHUFFLE_MS,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  }, [index, t]);

  const tx = t.interpolate({ inputRange: [0, 1], outputRange: [0, targetX] });
  const ty = t.interpolate({ inputRange: [0, 1], outputRange: [0, targetY] });
  const rot = t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <Animated.View
      style={{
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
        opacity: t,
        transform: [{ translateX: tx }, { translateY: ty }, { rotate: rot }],
      }}
    />
  );
}
