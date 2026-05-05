import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { nameForSeat, useGame } from '../state/game';

const DISMISS_MS = 3500;

const COLORS = {
  ink: '#3a3328',
  ink3: '#918275',
  paperHi: '#fbf8f0',
  hairline: '#cdc1ad',
  red: '#b14d3a',
  gold: '#d8a85a',
};

/**
 * Celebratory overlay on `state.lastResult.kind === 'win'`. Auto-dismisses after
 * `DISMISS_MS` (or on tap). The 和 emblem pulses + rocks subtly via RN
 * core `Animated` (no reanimated, so it works in Expo Go).
 */
export function WinCelebration() {
  const result = useGame((s) => s.state?.lastResult);
  const lobby = useGame((s) => s.lobby);
  const [dismissed, setDismissed] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!result) return;
    setDismissed(false);
    Animated.timing(fade, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    const timer = setTimeout(() => {
      Animated.timing(fade, { toValue: 0, duration: 250, useNativeDriver: true }).start(() =>
        setDismissed(true),
      );
    }, DISMISS_MS);
    return () => clearTimeout(timer);
  }, [result, fade]);

  const visible = !!result && result.kind === 'win' && !dismissed;
  const win = result && result.kind === 'win' ? result : null;
  if (!visible || !win) return null;

  return (
    <Pressable
      onPress={() => {
        Animated.timing(fade, { toValue: 0, duration: 250, useNativeDriver: true }).start(() =>
          setDismissed(true),
        );
      }}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(40, 30, 20, 0.55)',
        // Gutter so the celebration card never sits edge-to-edge on a
        // 320 px portrait phone.
        padding: 20,
        zIndex: 110,
      }}
    >
      <Animated.View
        style={{
          opacity: fade,
          backgroundColor: COLORS.paperHi,
          borderColor: COLORS.hairline,
          borderWidth: 1,
          borderRadius: 24,
          paddingVertical: 40,
          // Horizontal padding shrinks below ~360 wide so the inner
          // content (winner name + faan readout) keeps a real gutter
          // even on iPhone SE-class viewports. The earlier hard
          // `paddingHorizontal: 56` + `minWidth: 340` overflowed.
          paddingHorizontal: 32,
          width: '100%',
          maxWidth: 420,
          alignItems: 'center',
          boxShadow: '0px 24px 60px rgba(0,0,0,0.3)',
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
          <Text
            style={{
              fontFamily: 'Noto Serif TC',
              fontSize: 28,
              fontWeight: '700',
              color: COLORS.red,
            }}
          >
            {win.faan}
          </Text>
          <Text
            style={{
              fontFamily: 'Noto Serif TC',
              fontSize: 16,
              color: COLORS.red,
              fontWeight: '600',
            }}
          >
            番
          </Text>
          <Text style={{ fontSize: 12, fontWeight: '800', color: COLORS.ink, marginLeft: 4 }}>
            faan
          </Text>
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
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(t, {
          toValue: 1,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(t, {
          toValue: 0,
          duration: 800,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [t]);
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] });
  const rotate = t.interpolate({ inputRange: [0, 1], outputRange: ['-3deg', '3deg'] });
  return (
    <Animated.View style={{ marginBottom: 8, transform: [{ scale }, { rotate }] }}>
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
