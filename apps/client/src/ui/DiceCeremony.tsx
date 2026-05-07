import type { OpeningRolls, Seat } from '@mahjong/game-logic';
import { SEATS } from '@mahjong/game-logic';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';
import { nameForSeat, useGame } from '../state/game';

const PIPS: Record<number, [number, number][]> = {
  1: [[2, 2]],
  2: [
    [1, 1],
    [3, 3],
  ],
  3: [
    [1, 1],
    [2, 2],
    [3, 3],
  ],
  4: [
    [1, 1],
    [1, 3],
    [3, 1],
    [3, 3],
  ],
  5: [
    [1, 1],
    [1, 3],
    [2, 2],
    [3, 1],
    [3, 3],
  ],
  6: [
    [1, 1],
    [1, 3],
    [2, 1],
    [2, 3],
    [3, 1],
    [3, 3],
  ],
};

const DISMISS_MS = 3500;

const COLORS = {
  ink: '#3a3328',
  ink3: '#918275',
  paperHi: '#fbf8f0',
  hairline: '#cdc1ad',
  red: '#b14d3a',
};

/**
 * Opening-rolls overlay. Triggered by a fresh
 * `state.openingRolls`. Auto-dismisses after `DISMISS_MS`; tap anywhere
 * on the backdrop to dismiss early. Animations are RN core `Animated`
 * (no reanimated) so it works in Expo Go.
 */
export function DiceCeremony() {
  const rolls = useGame((s) => s.state?.openingRolls);
  const dealer = useGame((s) => s.state?.dealer);
  const lobby = useGame((s) => s.lobby);
  // Honour the OS / user "reduced motion" preference — when off, the
  // overlay just snaps in / out instead of fading. The dismiss timer
  // is unchanged so users get the same on-screen duration either way.
  const animsEnabled = useGame((s) => s.settings.animations);
  const [dismissed, setDismissed] = useState(false);
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!rolls) return;
    setDismissed(false);
    if (animsEnabled) {
      Animated.timing(fade, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    } else {
      fade.setValue(1);
    }
    const timer = setTimeout(() => {
      if (animsEnabled) {
        Animated.timing(fade, { toValue: 0, duration: 250, useNativeDriver: true }).start(() =>
          setDismissed(true),
        );
      } else {
        fade.setValue(0);
        setDismissed(true);
      }
    }, DISMISS_MS);
    return () => clearTimeout(timer);
  }, [rolls, fade, animsEnabled]);

  const visible = !!rolls && !dismissed && dealer !== undefined;
  if (!visible) return null;
  const rolling = SEATS.filter((s) => rolls.dice[s]);

  return (
    <Pressable
      onPress={() => {
        if (animsEnabled) {
          Animated.timing(fade, { toValue: 0, duration: 250, useNativeDriver: true }).start(() =>
            setDismissed(true),
          );
        } else {
          fade.setValue(0);
          setDismissed(true);
        }
      }}
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(40, 30, 20, 0.5)',
        // Matches the `Modal` primitive's gutter so the dialog never
        // sits edge-to-edge on a portrait phone (a 320px iPhone SE
        // would otherwise clip the rounded corners).
        padding: 20,
        zIndex: 100,
      }}
    >
      <Animated.View
        style={{
          opacity: fade,
          backgroundColor: COLORS.paperHi,
          borderColor: COLORS.hairline,
          borderWidth: 1,
          padding: 24,
          borderRadius: 16,
          alignItems: 'center',
          // Width cap so the dialog stays compact on tablets / desktop
          // without growing absurd.
          width: '100%',
          maxWidth: 420,
          boxShadow: '0px 24px 60px rgba(0,0,0,0.2)',
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
        <Text style={{ marginTop: 6, fontSize: 11, color: COLORS.ink3 }}>
          Tap anywhere to dismiss
        </Text>
      </Animated.View>
    </Pressable>
  );
}

function Die({ value, delay }: { value: number; delay: number }) {
  const animsEnabled = useGame((s) => s.settings.animations);
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!animsEnabled) {
      t.setValue(1);
      return;
    }
    Animated.sequence([
      Animated.delay(delay),
      Animated.spring(t, { toValue: 1, friction: 6, tension: 100, useNativeDriver: true }),
    ]).start();
  }, [delay, t, animsEnabled]);
  const scale = t.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const rotate = t.interpolate({ inputRange: [0, 1], outputRange: ['-90deg', '0deg'] });
  return (
    <Animated.View
      style={{
        width: 44,
        height: 44,
        backgroundColor: '#fdfaf2',
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 8,
        padding: 6,
        boxShadow: '0px 2px 6px rgba(0,0,0,0.18)',
        flexDirection: 'row',
        flexWrap: 'wrap',
        opacity: t,
        transform: [{ scale }, { rotate }],
      }}
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
