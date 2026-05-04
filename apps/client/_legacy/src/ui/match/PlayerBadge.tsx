import type { Seat, Wind } from '@mahjong/game-logic';
import { INK, RED, SANS, SEAT_COLOR, SERIF } from '../../native/theme.js';
import type { LobbyState } from '../../state/game.js';
import { nameForSeat } from '../../state/game.js';

interface PlayerBadgeProps {
  seat: Seat;
  /** Visual seat slot — drives flex direction + initials placement. */
  position: 'top' | 'left' | 'right' | 'bottom';
  /** Wind glyph for this seat (E/S/W/N relative to dealer). */
  seatWind: Wind;
  /** Lobby snapshot — used for the display name; pulls bot/disconnect status from PublicPlayer. */
  lobby: LobbyState | null;
  /** Score from `state.scoreboard[seat]`. */
  score: number;
  isActive: boolean;
}

const WIND_GLYPH: Record<Wind, string> = { E: '東', S: '南', W: '西', N: '北' };

/**
 * Per-seat badge — circular avatar with the player's initials + name + seat
 * wind glyph + cumulative score, with an active-turn glow when it's the
 * seat's turn. Ported from `/tmp/design/design/app.jsx::PlayerBadge`.
 *
 * Avatar background derives from the per-seat colour token (`SEAT_COLOR`
 * keyed by visual position, which the new mobile shell will reuse for the
 * shared discard pool's seat-color underlines).
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

  const dir =
    position === 'top'
      ? 'row'
      : position === 'left'
        ? 'row'
        : position === 'right'
          ? 'row-reverse'
          : 'row';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: dir,
        alignItems: 'center',
        gap: 10,
        padding: '6px 12px',
        borderRadius: 16,
        background: isActive
          ? 'linear-gradient(135deg, oklch(0.78 0.10 30), oklch(0.7 0.14 28))'
          : 'oklch(1 0 0 / 0.92)',
        boxShadow: isActive
          ? '0 6px 20px oklch(0.7 0.14 28 / 0.45), 0 0 0 3px oklch(0.78 0.10 30 / 0.25)'
          : '0 2px 10px rgba(0,0,0,0.08)',
        color: isActive ? 'white' : INK,
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        transition: 'all 240ms',
      }}
    >
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          background: avatarBg,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: SANS,
          fontWeight: 800,
          fontSize: 13,
          color: 'white',
          boxShadow: 'inset 0 -2px 0 rgba(0,0,0,0.18), 0 1px 3px rgba(0,0,0,0.15)',
          flexShrink: 0,
        }}
      >
        {initials}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, lineHeight: 1.1 }}>
        <div
          style={{
            fontFamily: SANS,
            fontWeight: 800,
            fontSize: 12,
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            whiteSpace: 'nowrap',
          }}
        >
          {name}
          <span
            style={{
              fontFamily: SERIF,
              fontSize: 13,
              color: isActive ? 'rgba(255,255,255,0.9)' : RED,
              fontWeight: 600,
            }}
          >
            {WIND_GLYPH[seatWind]}
          </span>
        </div>
        <div
          style={{
            fontSize: 10,
            fontWeight: 700,
            opacity: 0.7,
            fontFamily: SANS,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {score} pt
        </div>
      </div>
    </div>
  );
}

function computeInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}
