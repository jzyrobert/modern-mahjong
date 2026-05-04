import type { Seat, Wind } from '@mahjong/game-logic';
import { useEffect, useRef } from 'react';
import { Animated, Easing, Text, View } from 'react-native';
import type { LobbyState } from '../../state/game';
import { nameForSeat } from '../../state/game';

interface PlayerBadgeProps {
  seat: Seat;
  /** Visual seat slot — drives flex direction + accent color. */
  position: 'top' | 'left' | 'right' | 'bottom';
  /** Wind glyph for this seat (E/S/W/N relative to dealer). */
  seatWind: Wind;
  /** Lobby snapshot — drives display name lookup. */
  lobby: LobbyState | null;
  /** Score from `state.scoreboard[seat]`. */
  score: number;
  isActive: boolean;
}

const WIND_GLYPH: Record<Wind, string> = { E: '東', S: '南', W: '西', N: '北' };

const SEAT_COLOR: Record<'top' | 'left' | 'right' | 'bottom', string> = {
  bottom: '#de7660',
  right: '#5db698',
  top: '#c581b7',
  left: '#729fc6',
};

const COLORS = {
  ink: '#3a3328',
  red: '#b14d3a',
  redHot: '#db5d4a',
  paperHi: 'rgba(255,255,255,0.92)',
};

/**
 * Per-seat badge — coloured avatar circle with player initials, display
 * name, seat-wind glyph, and cumulative score. Active-turn glow applies
 * when it's the seat's turn. Native port of
 * `_legacy/src/ui/match/PlayerBadge.tsx`.
 *
 * The legacy gradient + backdrop-filter blur become a solid red
 * background + scaled shadow on active — RN doesn't support
 * `backdrop-filter`, and the gradient lookup wasn't carrying its weight.
 */
export function PlayerBadge({
  seat,
  position,
  seatWind,
  lobby,
  score,
  isActive,
}: PlayerBadgeProps) {
  const name = nameForSeat(lobby, seat);
  const initials = computeInitials(name);
  const avatarBg = SEAT_COLOR[position];

  // Soft scale pulse while active — driven on the native thread so it
  // doesn't compete with engine-side state updates. Interpolated up to
  // 1.04 over 1.4s with easeInOut, looping. Stops cleanly when the seat
  // is no longer active.
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
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });

  return (
    <Animated.View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 14,
        backgroundColor: isActive ? COLORS.redHot : COLORS.paperHi,
        shadowColor: isActive ? COLORS.redHot : '#000',
        shadowOpacity: isActive ? 0.45 : 0.1,
        shadowRadius: isActive ? 12 : 6,
        shadowOffset: { width: 0, height: 4 },
        elevation: isActive ? 6 : 2,
        borderWidth: isActive ? 2 : 0,
        borderColor: isActive ? '#f3c54a' : 'transparent',
        transform: isActive ? [{ scale }] : undefined,
      }}
    >
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 15,
          backgroundColor: avatarBg,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOpacity: 0.18,
          shadowRadius: 2,
          shadowOffset: { width: 0, height: 1 },
          elevation: 2,
        }}
      >
        <Text style={{ color: 'white', fontWeight: '800', fontSize: 12 }}>{initials}</Text>
      </View>
      <View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Text
            numberOfLines={1}
            style={{
              fontWeight: '800',
              fontSize: 12,
              color: isActive ? 'white' : COLORS.ink,
              maxWidth: 110,
            }}
          >
            {name}
          </Text>
          <Text
            style={{
              fontFamily: 'Noto Serif TC',
              fontSize: 13,
              color: isActive ? 'rgba(255,255,255,0.9)' : COLORS.red,
              fontWeight: '700',
            }}
          >
            {WIND_GLYPH[seatWind]}
          </Text>
        </View>
        <Text
          style={{
            fontSize: 10,
            fontWeight: '700',
            color: isActive ? 'rgba(255,255,255,0.85)' : 'rgba(58,51,40,0.7)',
          }}
        >
          {score} pt
        </Text>
      </View>
    </Animated.View>
  );
}

function computeInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
