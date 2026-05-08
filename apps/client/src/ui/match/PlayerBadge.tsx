import type { Seat, Wind } from '@mahjong/game-logic';
import { Animated, Text, View } from 'react-native';
import type { LobbyState } from '../../state/game';
import { nameForSeat } from '../../state/game';
import { computeInitials } from '../../util';
import { usePulse } from '../animations';
import { COLORS as SHARED_COLORS } from '../colors';
import { WIND_GLYPH } from '../winds';
import { type Position, SEAT_COLOR } from './seatColor';

interface PlayerBadgeProps {
  seat: Seat;
  /** Visual seat slot — drives flex direction + accent color. */
  position: Position;
  /** Wind glyph for this seat (E/S/W/N relative to dealer). */
  seatWind: Wind;
  /** Lobby snapshot — drives display name lookup. */
  lobby: LobbyState | null;
  /** Score from `state.scoreboard[seat]`. */
  score: number;
  isActive: boolean;
  /** Set when this seat would draw next once claims resolve AND the
   *  soft floor (`pendingClaims.deadlineMs`) has elapsed. Surfaces a
   *  gold halo so the table reads as "claims about to close, draw
   *  imminent". Default false. */
  aboutToDraw?: boolean;
  /** Whole seconds until the hard fallback once `softExpiryMs` is
   *  crossed. When non-null, renders next to the badge name as
   *  "drawing in Ns". Null before windup or in solo. */
  drawCountdown?: number | null;
  /** Whole seconds until `state.turnDeadlineMs`. When this seat is
   *  active and the rule is on, renders below the name as "Ns left".
   *  Null when the rule is off, in solo, or this seat isn't active. */
  turnCountdown?: number | null;
}

const COLORS = {
  ...SHARED_COLORS,
  // PlayerBadge's idle background is a translucent white rather than
  // the shared opaque `paperHi` so the badge reads as floating over
  // the felt instead of carved into it. Stays a local override since
  // no other surface wants this exact alpha.
  paperHi: 'rgba(255,255,255,0.92)',
};

/**
 * Per-seat badge — coloured avatar circle with player initials, display
 * name, seat-wind glyph, and cumulative score. Active-turn glow applies
 * when it's the seat's turn.
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
  aboutToDraw = false,
  drawCountdown = null,
  turnCountdown = null,
}: PlayerBadgeProps) {
  const name = nameForSeat(lobby, seat);
  const initials = computeInitials(name);
  const avatarBg = SEAT_COLOR[position];

  // Soft scale pulse while active — driven on the native thread so it
  // doesn't compete with engine-side state updates. Stops cleanly when
  // the seat is no longer active.
  const pulse = usePulse({ enabled: isActive });
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] });

  // The `aboutToDraw` halo shares its tone with the active-turn glow
  // (gold-on-yellow) but doesn't pulse — the user's already deciding
  // whether to claim, and a second moving border would compete for
  // attention with the `ClaimBar`.
  const cueBorder = !isActive && aboutToDraw;
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
        boxShadow: isActive
          ? `0px 4px 12px ${COLORS.redHot}73`
          : cueBorder
            ? '0px 0px 8px rgba(243,197,74,0.5)'
            : '0px 4px 6px rgba(0,0,0,0.1)',
        borderWidth: isActive || cueBorder ? 2 : 0,
        borderColor: isActive || cueBorder ? '#f3c54a' : 'transparent',
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
          boxShadow: '0px 1px 2px rgba(0,0,0,0.18)',
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
          {drawCountdown !== null && cueBorder
            ? `drawing in ${drawCountdown}s`
            : isActive && turnCountdown !== null
              ? `${turnCountdown}s left`
              : `${score} pt`}
        </Text>
      </View>
    </Animated.View>
  );
}
