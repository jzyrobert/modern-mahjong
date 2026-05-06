import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import { useGame } from '../../state/game';

const TOAST_DURATION_MS = 3_500;

const COLORS = {
  panel: 'rgba(58,51,40,0.92)',
  border: '#dc9f4f',
  text: '#fbf8f0',
};

/**
 * Brief toast that flashes when a claim attempt loses the race —
 * either a server `PHASE` error after the hard fallback fired, or
 * (future) a `claimsResolved` event that didn't crown the user.
 *
 * Sourced off `useGame.claimMissedSeq`: each increment shows the
 * toast, fades it out after `TOAST_DURATION_MS`, and we hold a
 * countdown ref so consecutive flashes restart the timer cleanly.
 *
 * Pinned to the top of the felt with absolute positioning so it
 * floats over the table without re-flowing the layout (the
 * `ClaimBar` is still in flight when this fires; we don't want to
 * push it down).
 */
export function ClaimMissedToast() {
  const seq = useGame((s) => s.claimMissedSeq);
  const [visible, setVisible] = useState(false);
  const opacity = useRef(new Animated.Value(0)).current;
  const dismissHandle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSeq = useRef(seq);

  useEffect(() => {
    if (seq === lastSeq.current) return;
    lastSeq.current = seq;
    setVisible(true);
    Animated.timing(opacity, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
      easing: Easing.out(Easing.ease),
    }).start();
    if (dismissHandle.current !== null) clearTimeout(dismissHandle.current);
    dismissHandle.current = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
        easing: Easing.in(Easing.ease),
      }).start(() => setVisible(false));
    }, TOAST_DURATION_MS);
    return () => {
      if (dismissHandle.current !== null) clearTimeout(dismissHandle.current);
    };
  }, [seq, opacity]);

  if (!visible) return null;
  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 12,
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 50,
      }}
    >
      <Animated.View
        style={{
          opacity,
          backgroundColor: COLORS.panel,
          borderColor: COLORS.border,
          borderWidth: 1,
          borderRadius: 10,
          paddingVertical: 8,
          paddingHorizontal: 14,
          boxShadow: '0px 4px 12px rgba(0,0,0,0.25)',
        }}
      >
        <Text style={{ color: COLORS.text, fontWeight: '700', fontSize: 13 }}>
          Claim missed — round already resolved
        </Text>
      </Animated.View>
    </View>
  );
}
