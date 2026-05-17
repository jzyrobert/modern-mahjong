import type { Seat, Wind } from '@mahjong/game-logic';
import { useState } from 'react';
import { Animated, Text, View } from 'react-native';
import type { LobbyState } from '../../state/game';
import { nameForSeat } from '../../state/game';
import { computeInitials } from '../../util';
import { PULSE_TEMPO, usePulse } from '../animations';
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
 *
 * The active-turn motion is an absolutely-positioned `ActiveHalo`
 * overlay rather than a card-level transform. An earlier version ran
 * `transform: scale 1 → 1.04` on the outer view (and toggled
 * `borderWidth` 0↔2 between states); the transform visibly grew the
 * badge each cycle and the border toggle pushed the surrounding row
 * by 4 px every time the turn rotated. Same fix as `OppHandStrip`.
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

  // The `aboutToDraw` halo shares its tone with the active-turn glow
  // (gold-on-yellow) but doesn't pulse — the user's already deciding
  // whether to claim, and a second moving border would compete for
  // attention with the `ClaimBar`.
  const cueBorder = !isActive && aboutToDraw;
  return (
    <View
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
        // Stays 2 px in every state — toggling 0↔2 between active /
        // about-to-draw / idle grew the badge by 4 px when the turn
        // rotated and shifted the desktop perimeter row by the same
        // amount every cycle. Transparent in the idle state reads
        // identically to `borderWidth: 0` without the layout cost.
        borderWidth: 2,
        borderColor: isActive || cueBorder ? '#f3c54a' : 'transparent',
      }}
    >
      {isActive ? <ActiveHalo /> : null}
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
    </View>
  );
}

/**
 * Breathing gold halo for the active-turn badge. Sits as an
 * absolutely-positioned overlay 2 px outside the card edge so its
 * opacity + scale loop is purely visual — `position: absolute`
 * siblings can't push their parent's layout and `transform` doesn't
 * reflow regardless. Symmetric 0 → peak → 0 breath via `usePulse`.
 *
 * `scaleX` / `scaleY` are derived from the measured overlay size so
 * every edge grows by the same absolute pixel amount at the breath's
 * peak. A single uniform `scale: 1.04` would grow a ~180-px-wide
 * badge by ~7 px horizontally and only ~2 px vertically; independent
 * axes keep the visual growth balanced. Same shape as
 * `OppHandStrip`'s `ActiveHalo`.
 */
function ActiveHalo() {
  const t = usePulse({ durationMs: PULSE_TEMPO.state });
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const GROWTH_PX = 3;
  const sx = size && size.w > 0 ? 1 + (GROWTH_PX * 2) / size.w : 1;
  const sy = size && size.h > 0 ? 1 + (GROWTH_PX * 2) / size.h : 1;
  const scaleX = t.interpolate({ inputRange: [0, 1], outputRange: [1, sx] });
  const scaleY = t.interpolate({ inputRange: [0, 1], outputRange: [1, sy] });
  const opacity = t.interpolate({ inputRange: [0, 1], outputRange: [0, 0.6] });
  return (
    <Animated.View
      pointerEvents="none"
      onLayout={(e) => {
        const { width, height } = e.nativeEvent.layout;
        setSize((prev) =>
          prev && prev.w === width && prev.h === height ? prev : { w: width, h: height },
        );
      }}
      style={{
        position: 'absolute',
        top: -2,
        left: -2,
        right: -2,
        bottom: -2,
        borderRadius: 16,
        borderWidth: 2,
        borderColor: '#f3c54a',
        opacity,
        transform: [{ scaleX }, { scaleY }],
      }}
    />
  );
}
