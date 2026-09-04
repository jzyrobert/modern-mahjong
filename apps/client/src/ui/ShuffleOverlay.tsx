import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, View, useWindowDimensions } from 'react-native';
import { startShuffle } from '../sound';
import { useGame } from '../state/game';
import { resolveRenderer } from '../three/renderer';
import { useFadeInOut } from './animations';

const SHUFFLE_MS = 1700;
const SPIN_COUNT = 12;

declare global {
  // eslint-disable-next-line no-var
  var __MAHJONG_TEST_SHUFFLE_MS__: number | undefined;
}

/**
 * How long the ceremony (and the store's `shuffling` flag) lasts. Test
 * seam: `__MAHJONG_TEST_SHUFFLE_MS__` stretches it so a screenshot on a
 * software rasteriser can land inside the window; the app runs 1.7 s.
 */
function shuffleMs(): number {
  const v = globalThis.__MAHJONG_TEST_SHUFFLE_MS__;
  return typeof v === 'number' && v > 0 ? v : SHUFFLE_MS;
}
const RADIUS = 80;

/**
 * Between-hand shuffle ceremony. Triggered by a fresh `seed`
 * landing in `useGame.state` — sets the store's `shuffling` flag and
 * plays the shuffle sound while the wall is being rebuilt for the next
 * hand. RN core `Animated` (no reanimated) so it works in Expo Go.
 *
 * Two looks, one lifecycle:
 *   - classic renderer: the cream scrim with 12 face-down tile tokens
 *     fanning out from the centre;
 *   - Three.js renderer: the table itself animates the shuffle (the
 *     choreographer dispenses every tile out of the walls on slow
 *     springs while `shuffling` is true), so the overlay is only a
 *     small glass "洗牌 · shuffling" pill in the chrome band at the
 *     top — no scrim, no second animation in the middle of the table,
 *     and clear of the opening-rolls card that opens over the centre
 *     at the same moment.
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
  const rendererSetting = useGame((s) => s.settings.renderer);
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
      }, shuffleMs());
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
  // Picked per render (the same rule `DiceCeremony` uses) so a renderer
  // switch mid-session takes effect on the next shuffle.
  if (resolveRenderer(rendererSetting) === '3d') return <GlassShufflePill fade={fade} />;
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

/**
 * Three.js renderer: a glass pill — 洗牌 in gold serif, a pulsing gold
 * dot and the SHUFFLING micro-label — while the 3D table redistributes
 * the tiles underneath. No scrim: the dispense is the ceremony. It sits
 * in the top chrome band, centred, where the shells keep the toast slot
 * (desktop: between the status pill and the menu cluster; phone
 * portrait: under the seat strip; phone landscape: under the chrome
 * row), so the between-hand dice card over the centre never covers it.
 * The dot's pulse is skipped under reduced motion.
 */
function GlassShufflePill({ fade }: { fade: Animated.Value }) {
  const animsEnabled = useGame((s) => s.settings.animations);
  const { width, height } = useWindowDimensions();
  const landscapePhone = width > height && height < 600;
  const portraitPhone = !landscapePhone && width < 768;
  // Portrait: under the chrome (12 + 44) and the 34 px seat strip;
  // desktop: centred in the 44 px chrome row. Landscape: the chrome
  // row's free run right of the far seat's badge and left of the
  // fullscreen prompt (the shells' toast slot) — the far wall's top row
  // sits directly under the chrome there, so nothing may hang below it.
  const top = landscapePhone ? 4 : portraitPhone ? 12 + 44 + 8 + 34 + 8 : 24;
  const slot = landscapePhone
    ? { left: '50%' as const, marginLeft: 60, right: 140, alignItems: 'flex-start' as const }
    : { left: 0, right: 0, alignItems: 'center' as const };
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animsEnabled) {
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 520,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 520,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animsEnabled, pulse]);
  const dotOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] });
  return (
    <Animated.View
      testID="shuffle-pill"
      style={{
        position: 'absolute',
        ...slot,
        top,
        zIndex: 90,
        opacity: fade,
        pointerEvents: 'none',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingVertical: 6,
          paddingLeft: 14,
          paddingRight: 18,
          borderRadius: 999,
          backgroundColor: 'rgba(14,20,17,0.82)',
          borderWidth: 1,
          borderColor: 'rgba(216,168,90,0.6)',
          boxShadow:
            '0px 0px 0px 3px rgba(216,168,90,0.14), 0px 0px 28px rgba(216,168,90,0.25), 0px 12px 40px rgba(0,0,0,0.45)',
        }}
      >
        <Text
          style={{
            fontFamily: 'Noto Serif TC',
            fontSize: 22,
            lineHeight: 28,
            fontWeight: '700',
            color: '#d8a85a',
          }}
        >
          洗牌
        </Text>
        <Animated.View
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: '#d8a85a',
            opacity: dotOpacity,
            boxShadow: '0px 0px 10px rgba(216,168,90,0.9)',
          }}
        />
        <Text
          style={{
            fontSize: 11,
            fontWeight: '800',
            letterSpacing: 2.2,
            textTransform: 'uppercase',
            color: 'rgba(255,255,255,0.92)',
          }}
        >
          Shuffling
        </Text>
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
