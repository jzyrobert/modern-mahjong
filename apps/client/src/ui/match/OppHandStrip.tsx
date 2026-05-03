import type { Seat, Wind } from '@mahjong/game-logic';
import { INK, INK_3, PAPER_HI, RED, SANS, SEAT_COLOR, SERIF } from '../../native/theme.js';
import type { LobbyState } from '../../state/game.js';
import { nameForSeat } from '../../state/game.js';

interface OppHandStripProps {
  seat: Seat;
  position: 'top' | 'left' | 'right';
  seatWind: Wind;
  lobby: LobbyState | null;
  /** Number of face-down tiles still in the opponent's hand. */
  handBacks: number;
  isActive: boolean;
}

const WIND_GLYPH: Record<Wind, string> = { E: '東', S: '南', W: '西', N: '北' };

/**
 * Compact horizontal pill showing an opponent's seat on the mobile shell.
 * Avatar + name + seat-wind + face-down hand-tile count, with an
 * active-turn glow. Ported from
 * `/tmp/design/design/app-mobile.jsx::OppHandStrip` (the meld-tile preview
 * sub-row is queued — see TODO.md → "Reserved meld strip").
 */
export function OppHandStrip({
  seat,
  position,
  seatWind,
  lobby,
  handBacks,
  isActive,
}: OppHandStripProps) {
  const name = nameForSeat(lobby, seat);
  const initials = computeInitials(name);
  const avatarBg = SEAT_COLOR[position];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        background: isActive ? PAPER_HI : 'oklch(0.94 0.01 80 / 0.85)',
        border: isActive ? `1.5px solid ${RED}` : '1px solid oklch(0.86 0.02 80)',
        borderRadius: 12,
        padding: '5px 8px',
        boxShadow: isActive ? '0 0 12px oklch(0.55 0.18 25 / 0.3)' : '0 1px 2px rgba(0,0,0,0.06)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
      }}
    >
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: '50%',
          background: avatarBg,
          color: 'white',
          fontWeight: 800,
          fontSize: 9,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: isActive
            ? `0 0 0 2px oklch(0.95 0.02 85), 0 0 0 3px ${RED}`
            : '0 1px 2px rgba(0,0,0,0.2)',
          flexShrink: 0,
          fontFamily: SANS,
        }}
      >
        {initials}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 0, lineHeight: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 10,
            fontWeight: 800,
            color: INK,
            whiteSpace: 'nowrap',
            fontFamily: SANS,
          }}
        >
          {name}{' '}
          <span style={{ color: INK_3, fontFamily: SERIF, fontWeight: 700 }}>
            {WIND_GLYPH[seatWind]}
          </span>
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 3,
            marginTop: 2,
            fontSize: 9,
            fontWeight: 700,
            color: 'oklch(0.45 0.05 200)',
            background: 'oklch(0.95 0.02 200)',
            padding: '1px 5px',
            borderRadius: 4,
            whiteSpace: 'nowrap',
            alignSelf: 'flex-start',
            fontFamily: SANS,
          }}
        >
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: 5,
              height: 7,
              borderRadius: 1,
              background: 'linear-gradient(180deg, oklch(0.62 0.07 195), oklch(0.5 0.09 200))',
            }}
          />
          {handBacks}
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
