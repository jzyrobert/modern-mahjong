import type { OpeningRolls, Seat } from '@mahjong/game-logic';
import { SEATS } from '@mahjong/game-logic';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';
import { nameForSeat, useGame } from '../state/game';

const PIPS: Record<number, [number, number][]> = {
  1: [[2, 2]],
  2: [[1, 1], [3, 3]],
  3: [[1, 1], [2, 2], [3, 3]],
  4: [[1, 1], [1, 3], [3, 1], [3, 3]],
  5: [[1, 1], [1, 3], [2, 2], [3, 1], [3, 3]],
  6: [[1, 1], [1, 3], [2, 1], [2, 3], [3, 1], [3, 3]],
};

const DISMISS_MS = 3500;

const COLORS = {
  ink: 'oklch(0.25 0.04 60)',
  ink3: 'oklch(0.55 0.04 60)',
  paperHi: 'oklch(0.99 0.005 85)',
  hairline: 'oklch(0.86 0.02 80)',
  red: 'oklch(0.55 0.18 25)',
};

/**
 * Opening-rolls modal. Native port of `_legacy/src/ui/DiceCeremony.tsx`.
 * Triggered by a fresh `state.openingRolls`. Auto-dismisses after
 * `DISMISS_MS`; tap anywhere on the backdrop to dismiss early.
 */
export function DiceCeremony() {
  const rolls = useGame((s) => s.state?.openingRolls);
  const dealer = useGame((s) => s.state?.dealer);
  const lobby = useGame((s) => s.lobby);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!rolls) return;
    setDismissed(false);
    const timer = setTimeout(() => setDismissed(true), DISMISS_MS);
    return () => clearTimeout(timer);
  }, [rolls]);

  const visible = !!rolls && !dismissed && dealer !== undefined;
  if (!visible) return null;
  const rolling = SEATS.filter((s) => rolls.dice[s]);

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
        backgroundColor: 'rgba(40, 30, 20, 0.5)',
        zIndex: 100,
      }}
    >
      <Animated.View
        entering={FadeIn.duration(250)}
        exiting={FadeOut.duration(250)}
        style={{
          backgroundColor: COLORS.paperHi,
          borderColor: COLORS.hairline,
          borderWidth: 1,
          padding: 24,
          borderRadius: 16,
          alignItems: 'center',
          minWidth: 320,
          shadowColor: '#000',
          shadowOpacity: 0.2,
          shadowRadius: 60,
          shadowOffset: { width: 0, height: 24 },
          elevation: 12,
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: '900', color: COLORS.ink, marginBottom: 16 }}>
          {rolls.fullRoll ? 'Opening rolls' : 'Dealer rolls'}
        </Text>
        <View style={{ flexDirection: 'row', gap: 24, justifyContent: 'center', flexWrap: 'wrap' }}>
          {rolling.map((seat) => {
            const pair = rolls.dice[seat];
            if (!pair) return null;
            return (
              <View key={seat} style={{ alignItems: 'center', gap: 6 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.ink3 }}>
                  {nameForSeat(lobby, seat as Seat)}
                </Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <Die value={pair[0]} delay={0} />
                  <Die value={pair[1]} delay={120} />
                </View>
                <Text style={{ fontSize: 12, fontWeight: '800', color: COLORS.ink }}>
                  {pair[0] + pair[1]}
                </Text>
              </View>
            );
          })}
        </View>
        <Text style={{ marginTop: 18, fontSize: 13, color: COLORS.ink }}>
          Dealer: seat <Text style={{ color: COLORS.red, fontWeight: '700' }}>{dealer}</Text> (
          {nameForSeat(lobby, dealer as Seat)})
        </Text>
        <Text style={{ marginTop: 6, fontSize: 11, color: COLORS.ink3 }}>Tap anywhere to dismiss</Text>
      </Animated.View>
    </Pressable>
  );
}

function Die({ value, delay }: { value: number; delay: number }) {
  const scale = useSharedValue(0.6);
  const rotate = useSharedValue(-90);
  const opacity = useSharedValue(0);

  useEffect(() => {
    scale.value = withDelay(delay, withSpring(1, { damping: 18, stiffness: 280 }));
    rotate.value = withDelay(delay, withSpring(0, { damping: 18, stiffness: 280 }));
    opacity.value = withDelay(delay, withSpring(1, { damping: 18, stiffness: 280 }));
  }, [delay, scale, rotate, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }, { rotate: `${rotate.value}deg` }],
  }));

  return (
    <Animated.View
      style={[
        {
          width: 44,
          height: 44,
          backgroundColor: '#fdfaf2',
          borderColor: COLORS.hairline,
          borderWidth: 1,
          borderRadius: 8,
          padding: 6,
          shadowColor: '#000',
          shadowOpacity: 0.18,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
          elevation: 3,
          flexDirection: 'row',
          flexWrap: 'wrap',
        },
        animatedStyle,
      ]}
    >
      {Array.from({ length: 9 }, (_, i) => {
        const row = Math.floor(i / 3) + 1;
        const col = (i % 3) + 1;
        const filled = (PIPS[value] ?? []).some(([r, c]) => r === row && c === col);
        return (
          <View
            // biome-ignore lint/suspicious/noArrayIndexKey: 3x3 grid is fixed
            key={i}
            style={{
              width: '33.33%',
              height: '33.33%',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {filled ? (
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: 4,
                  backgroundColor: COLORS.red,
                }}
              />
            ) : null}
          </View>
        );
      })}
    </Animated.View>
  );
}
