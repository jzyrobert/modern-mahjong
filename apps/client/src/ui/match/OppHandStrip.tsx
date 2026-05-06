import type { Seat, Wind } from '@mahjong/game-logic';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import type { LobbyState } from '../../state/game';

interface OppHandStripProps {
  seat: Seat;
  seatWind: Wind;
  lobby: LobbyState | null;
  /** Number of face-down tiles to render. */
  handBacks: number;
  /** Highlight when this seat is on the move. */
  isActive: boolean;
  /** Set when this seat would draw next once claims resolve AND the
   *  soft floor (`pendingClaims.deadlineMs`) has elapsed. Surfaces a
   *  gold halo + scale pulse so the mobile felt mirrors the desktop
   *  PlayerBadge cue. Default false. */
  aboutToDraw?: boolean;
  /** Whole seconds until the hard fallback once `softExpiryMs` is
   *  crossed. Renders next to the name as "drawing in Ns" when set. */
  drawCountdown?: number | null;
}

const WIND_GLYPH: Record<Wind, string> = { E: '東', S: '南', W: '西', N: '北' };

const COLORS = {
  ink: '#3a3328',
  ink3: '#918275',
  paperHi: '#fbf8f0',
  hairline: '#cdc1ad',
  red: '#b14d3a',
  redHot: '#db5d4a',
  gold: '#f3c54a',
  tileBack1: '#7fa9c1',
  tileBack2: '#5a8cb0',
};

/**
 * Compact opponent strip — wind glyph + display name + a row of
 * miniature face-down tile rectangles. Active-turn picks up a red
 * fill + scale pulse (mirrors the desktop `PlayerBadge`); the
 * "next about to draw" cue is a static gold halo so the two
 * highlights don't fight for attention.
 */
export function OppHandStrip({
  seat,
  seatWind,
  lobby,
  handBacks,
  isActive,
  aboutToDraw = false,
  drawCountdown = null,
}: OppHandStripProps) {
  const player = lobby?.players.find((p) => p.seat === seat);
  const name = player?.displayName ?? `Seat ${seat}`;
  const isBot = player?.isBot ?? false;

  // Mirror PlayerBadge's pulse — driven on the native thread so it
  // doesn't compete with engine updates for the JS thread.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!isActive) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 700,
          useNativeDriver: true,
          easing: Easing.inOut(Easing.ease),
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [isActive, pulse]);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });

  // `aboutToDraw` only surfaces when this seat is *not* the current
  // turn (it's the "next" seat). Active-turn cue takes priority.
  const cueBorder = !isActive && aboutToDraw;

  return (
    <Animated.View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: isActive ? COLORS.redHot : COLORS.paperHi,
        borderColor: isActive ? COLORS.gold : cueBorder ? COLORS.gold : COLORS.hairline,
        borderWidth: isActive || cueBorder ? 2 : 1,
        borderRadius: 10,
        paddingVertical: 6,
        paddingHorizontal: 10,
        boxShadow: isActive
          ? `0px 4px 12px ${COLORS.redHot}73`
          : cueBorder
            ? '0px 0px 8px rgba(243,197,74,0.5)'
            : 'none',
        transform: isActive ? [{ scale }] : undefined,
      }}
    >
      <View style={{ alignItems: 'center', minWidth: 64 }}>
        <Text
          style={{
            fontFamily: 'Noto Serif TC',
            fontSize: 14,
            color: isActive ? 'white' : COLORS.red,
            fontWeight: '700',
          }}
        >
          {WIND_GLYPH[seatWind]}
        </Text>
        <Text
          style={{
            fontSize: 10,
            fontWeight: '800',
            color: isActive ? 'white' : COLORS.ink,
          }}
          numberOfLines={1}
        >
          {name}
        </Text>
        {isBot ? (
          <Text
            style={{
              fontSize: 8,
              color: isActive ? 'rgba(255,255,255,0.85)' : COLORS.ink3,
              fontWeight: '700',
            }}
          >
            BOT
          </Text>
        ) : null}
        {cueBorder && drawCountdown !== null ? (
          <Text style={{ fontSize: 8, fontWeight: '800', color: COLORS.red }} numberOfLines={1}>
            drawing in {drawCountdown}s
          </Text>
        ) : null}
      </View>
      <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>
        {Array.from({ length: handBacks }, (_, i) => (
          <View
            // biome-ignore lint/suspicious/noArrayIndexKey: position is fixed per index
            key={i}
            style={{
              width: 12,
              height: 16,
              borderRadius: 2,
              backgroundColor: COLORS.tileBack1,
              borderColor: COLORS.tileBack2,
              borderWidth: 1,
            }}
          />
        ))}
      </View>
    </Animated.View>
  );
}
