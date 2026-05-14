import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { startShuffle } from '../sound';
import { useGame } from '../state/game';
import { useFadeInOut } from './animations';

const SHUFFLE_MS = 1700;
const SPIN_COUNT = 12;
const RADIUS = 80;

/**
 * Between-hand shuffle ceremony. Triggered by a fresh `seed`
 * landing in `useGame.state` — sets the store's `shuffling` flag and
 * fans 12 face-down tile tokens out from centre while the wall is
 * being rebuilt for the next hand. RN core `Animated` (no reanimated)
 * so it works in Expo Go.
 *
 * The outer fade-in / fade-out goes through the shared
 * `useFadeInOut` hook so the overlay snaps in / out when the user
 * has disabled animations via `useGame.settings.animations` (the
 * SHUFFLE_MS lifecycle still elapses so the engine's seed swap
 * lands cleanly either way).
 */
export function ShuffleOverlay() {
  const seed = useGame((s) => s.state?.seed);
  const phase = useGame((s) => s.state?.phase);
  const setShuffling = useGame((s) => s.setShuffling);
  const lastSeed = useRef<number | undefined>(undefined);
  const [active, setActive] = useState(false);
  const { fade, fadeOut } = useFadeInOut({ visible: active, durationMs: 200 });

  useEffect(() => {
    // Reset the cached seed in two cases so a "fresh" first hand
    // never trips the shuffle:
    //   - `seed === undefined`: state was cleared (user left a
    //     match). The overlay is mounted at the root layout so its
    //     ref otherwise persists across leave / rejoin.
    //   - `phase === 'waiting'`: lobby state. `emptyState`'s seed
    //     is 0; without this gate, the lobby seed → first
    //     `startHand` seed transition would always trigger a
    //     shuffle on hand one of every match.
    if (seed === undefined || phase === 'waiting') {
      lastSeed.current = undefined;
      return;
    }
    if (lastSeed.current !== undefined && lastSeed.current !== seed) {
      setActive(true);
      setShuffling(true);
      const stopShuffleSound = startShuffle();
      const timer = setTimeout(() => {
        fadeOut(() => {
          setActive(false);
          setShuffling(false);
        });
      }, SHUFFLE_MS);
      lastSeed.current = seed;
      return () => {
        clearTimeout(timer);
        // Fade the slice out early if the overlay tears down before
        // the natural 2 s end (e.g. the user navigated away mid-
        // shuffle). No-op once the slice has already retired.
        stopShuffleSound();
      };
    }
    lastSeed.current = seed;
  }, [seed, phase, setShuffling, fadeOut]);

  if (!active) return null;
  return (
    <Animated.View
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
        pointerEvents: 'none',
      }}
    >
      <View style={{ width: 220, height: 220 }}>
        {Array.from({ length: SPIN_COUNT }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: position is fixed per index
          <SpinningTile key={i} index={i} />
        ))}
        <View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: 'none',
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
  const animsEnabled = useGame((s) => s.settings.animations);
  const angle = (index / SPIN_COUNT) * Math.PI * 2;
  const targetX = Math.cos(angle) * RADIUS;
  const targetY = Math.sin(angle) * RADIUS;
  const t = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animsEnabled) {
      // Reduced-motion path — snap each token straight to its final
      // ring position. Visual still reads as "tiles fanned around the
      // wall" so the user knows shuffling is happening.
      t.setValue(1);
      return;
    }
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
  }, [index, t, animsEnabled]);

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
        boxShadow: '0px 2px 6px rgba(0,0,0,0.25)',
        opacity: t,
        transform: [{ translateX: tx }, { translateY: ty }, { rotate: rot }],
      }}
    />
  );
}
