import type { Wind } from '@mahjong/game-logic';
import { INK, INK_3, MONO, RED, SANS, SERIF } from '../../native/theme.js';

interface GameStatusBarProps {
  prevailing: Wind;
  dealerName: string;
  /** Live wall tile count from `state.wall.length`. */
  wallCount: number;
  isMyTurn: boolean;
}

const WIND_NAME: Record<Wind, string> = {
  E: 'EAST',
  S: 'SOUTH',
  W: 'WEST',
  N: 'NORTH',
};

/**
 * Top-center pill on the live table — prevailing wind glyph in a paper
 * roundel, round + dealer name, live wall count with a depletion bar, and
 * a "your turn" pulse when the local player is on the move. Ported from
 * `/tmp/design/design/app.jsx::GameStatusBar`. Bound to engine state.
 */
const WIND_GLYPH: Record<Wind, string> = { E: '東', S: '南', W: '西', N: '北' };

// Typical post-deal live wall is ~70 tiles; depletion bar uses that as 100%.
const WALL_FULL = 70;
const LOW_THRESHOLD = 14;

export function GameStatusBar({ prevailing, dealerName, wallCount, isMyTurn }: GameStatusBarProps) {
  const pct = Math.max(0, Math.min(100, (wallCount / WALL_FULL) * 100));
  const low = wallCount <= LOW_THRESHOLD;
  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        padding: '7px 14px 7px 10px',
        borderRadius: 16,
        background: 'oklch(1 0 0 / 0.88)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
        fontFamily: SANS,
        fontSize: 11,
        fontWeight: 800,
        color: INK,
        whiteSpace: 'nowrap',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 26,
          height: 26,
          borderRadius: '50%',
          background:
            'radial-gradient(circle at 35% 30%, oklch(0.95 0.02 85), oklch(0.85 0.05 85))',
          fontFamily: SERIF,
          fontSize: 14,
          fontWeight: 700,
          color: RED,
        }}
      >
        {WIND_GLYPH[prevailing]}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, lineHeight: 1 }}>
        <span style={{ letterSpacing: 0.5 }}>{WIND_NAME[prevailing]} ROUND</span>
        <span
          style={{
            fontSize: 9,
            fontWeight: 700,
            color: INK_3,
            letterSpacing: 0.4,
            fontFamily: MONO,
          }}
        >
          {dealerName} dealing
        </span>
      </div>
      <span aria-hidden style={{ opacity: 0.3 }}>
        │
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
        <span
          style={{
            fontSize: 10,
            letterSpacing: 0.4,
            color: low ? 'oklch(0.55 0.18 30)' : INK,
          }}
        >
          {wallCount} tiles in wall
        </span>
        <div
          style={{
            width: 90,
            height: 4,
            borderRadius: 2,
            background: 'oklch(0.92 0.012 85)',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${pct}%`,
              height: '100%',
              background: low
                ? 'linear-gradient(90deg, oklch(0.7 0.18 30), oklch(0.65 0.2 25))'
                : 'linear-gradient(90deg, oklch(0.78 0.12 150), oklch(0.68 0.14 145))',
              transition: 'width 400ms',
            }}
          />
        </div>
      </div>
      {isMyTurn ? (
        <>
          <span aria-hidden style={{ opacity: 0.3 }}>
            │
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: RED }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: 'oklch(0.65 0.2 28)',
                boxShadow: '0 0 8px oklch(0.65 0.2 28)',
              }}
            />
            YOUR TURN
          </span>
        </>
      ) : null}
    </div>
  );
}
