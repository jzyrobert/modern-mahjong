import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { nameForSeat, useGame } from '../state/game';

const DISMISS_MS = 3500;

const COLORS = {
  ink: 'oklch(0.25 0.04 60)',
  ink3: 'oklch(0.55 0.04 60)',
  paperHi: 'oklch(0.99 0.005 85)',
  hairline: 'oklch(0.86 0.02 80)',
  red: 'oklch(0.55 0.18 25)',
  gold: 'oklch(0.78 0.14 80)',
};

/**
 * Celebratory overlay on `state.lastResult.kind === 'win'`. Native
 * port of `_legacy/src/ui/WinCelebration.tsx`. Auto-dismisses after
 * `DISMISS_MS` (or on tap). Confetti dots fly from top to bottom; the
 * 和 emblem pulses + rocks subtly.
 */
export function WinCelebration() {
  const result = useGame((s) => s.state?.lastResult);
  const lobby = useGame((s) => s.lobby);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!result) return;
    setDismissed(false);
    const timer = setTimeout(() => setDismissed(true), DISMISS_MS);
    return () => clearTimeout(timer);
  }, [result]);

  const visible = !!result && result.kind === 'win' && !dismissed;
  const win = result && result.kind === 'win' ? result : null;
  if (!visible || !win) return null;

  return (
    <Pressable
      onPress={() => setDismissed(true)}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(40, 30, 20, 0.55)',
        zIndex: 110,
      }}
    >
      <Animated.View
        entering={FadeIn.duration(250)}
        exiting={FadeOut.duration(250)}
        style={{
          backgroundColor: COLORS.paperHi,
          borderColor: COLORS.hairline,
          borderWidth: 1,
          borderRadius: 24,
          paddingVertical: 40,
          paddingHorizontal: 56,
          minWidth: 340,
          alignItems: 'center',
          shadowColor: '#000',
          shadowOpacity: 0.3,
          shadowRadius: 60,
          shadowOffset: { width: 0, height: 24 },
          elevation: 16,
        }}
      >
        <PulseEmblem />
        <Text
          style={{
            fontSize: 12,
            fontWeight: '800',
            letterSpacing: 1.4,
            color: COLORS.gold,
            marginBottom: 8,
          }}
        >
          WINNER
        </Text>
        <Text
          style={{
            fontSize: 22,
            fontWeight: '900',
            color: COLORS.ink,
            marginBottom: 12,
            textAlign: 'center',
          }}
        >
          {nameForSeat(lobby, win.winner)}
        </Text>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            gap: 6,
            backgroundColor: '#fbe5d9',
            borderColor: '#e8a890',
            borderWidth: 1,
            borderRadius: 12,
            paddingVertical: 8,
            paddingHorizontal: 16,
            marginBottom: 14,
          }}
        >
          <Text style={{ fontFamily: 'Noto Serif TC', fontSize: 28, fontWeight: '700', color: COLORS.red }}>
            {win.faan}
          </Text>
          <Text style={{ fontFamily: 'Noto Serif TC', fontSize: 16, color: COLORS.red, fontWeight: '600' }}>
            番
          </Text>
          <Text style={{ fontSize: 12, fontWeight: '800', color: COLORS.ink, marginLeft: 4 }}>faan</Text>
        </View>
        <Text style={{ fontSize: 13, color: COLORS.ink3, fontWeight: '600' }}>
          {win.selfDraw ? '自摸 · self-draw' : `Won off seat ${win.from}`}
        </Text>
        <Text style={{ fontSize: 10, color: COLORS.ink3, marginTop: 18, opacity: 0.6 }}>
          Tap anywhere to dismiss
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function PulseEmblem() {
  const scale = useSharedValue(1);
  const rot = useSharedValue(-3);
  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.12, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        withTiming(1, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
    rot.value = withRepeat(
      withSequence(
        withTiming(3, { duration: 800, easing: Easing.inOut(Easing.ease) }),
        withTiming(-3, { duration: 800, easing: Easing.inOut(Easing.ease) }),
      ),
      -1,
      false,
    );
  }, [scale, rot]);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }, { rotate: `${rot.value}deg` }],
  }));
  return (
    <Animated.View style={[{ marginBottom: 8 }, animatedStyle]}>
      <Text
        style={{
          fontFamily: 'Noto Serif TC',
          fontSize: 96,
          lineHeight: 96,
          color: COLORS.red,
          fontWeight: '700',
        }}
      >
        和
      </Text>
    </Animated.View>
  );
}
