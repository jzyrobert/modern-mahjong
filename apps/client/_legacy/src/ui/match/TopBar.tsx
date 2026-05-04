import type { CSSProperties } from 'react';
import { INK, INK_3, RED, SANS } from '../../native/theme.js';

const iconBtnStyle: CSSProperties = {
  width: 38,
  height: 38,
  borderRadius: 12,
  background: 'oklch(1 0 0 / 0.92)',
  border: 'none',
  boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
  cursor: 'pointer',
  fontSize: 16,
  color: INK,
  fontFamily: SANS,
};

interface TopBarProps {
  /** Match code shown in the live pill — e.g. `A7K2`. Pass null to hide. */
  gameId: string | null;
  /** Spectator count from `useGame.lobby.viewers`. Hidden when 0 or null. */
  viewers?: number | null;
  onSettings?: () => void;
  onLog?: () => void;
  /**
   * Toggle the browser's fullscreen mode. Wired only by the mobile shell
   * (the desktop window is already large enough that the toggle would be
   * noise) and only when the Fullscreen API is supported.
   */
  onFullscreen?: () => void;
  /** Whether the browser is currently in fullscreen — drives the icon. */
  fullscreenActive?: boolean;
  onLeave: () => void;
}

/**
 * Top-right cluster on the live table — live pill (game id + spectator
 * count), settings cog, game log, optional fullscreen toggle (mobile),
 * and a Leave button. Ported from `/tmp/design/design/app.jsx::TopBar`.
 */
export function TopBar({
  gameId,
  viewers,
  onSettings,
  onLog,
  onFullscreen,
  fullscreenActive,
  onLeave,
}: TopBarProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {gameId ? (
        <div
          style={{
            padding: '6px 12px',
            borderRadius: 14,
            background: 'oklch(1 0 0 / 0.85)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
            fontFamily: SANS,
            fontSize: 11,
            fontWeight: 700,
            color: INK_3,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            whiteSpace: 'nowrap',
          }}
        >
          <span
            aria-hidden
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'oklch(0.7 0.18 145)',
              boxShadow: '0 0 6px oklch(0.7 0.18 145)',
            }}
          />
          <span>Live · #{gameId}</span>
          {viewers !== null && viewers !== undefined && viewers > 0 ? (
            <>
              <span aria-hidden style={{ opacity: 0.5 }}>
                ·
              </span>
              <span title={`${viewers} watching`}>👁 {viewers}</span>
            </>
          ) : null}
        </div>
      ) : null}
      {onLog ? (
        <button
          type="button"
          onClick={onLog}
          aria-label="Game log"
          title="Game log"
          style={iconBtnStyle}
        >
          📜
        </button>
      ) : null}
      {onFullscreen ? (
        <button
          type="button"
          onClick={onFullscreen}
          aria-label={fullscreenActive ? 'Exit fullscreen' : 'Enter fullscreen'}
          aria-pressed={fullscreenActive}
          title={fullscreenActive ? 'Exit fullscreen' : 'Fullscreen'}
          style={iconBtnStyle}
        >
          {fullscreenActive ? '⤓' : '⛶'}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onSettings}
        aria-label="Settings"
        title="Settings"
        disabled={!onSettings}
        style={{
          ...iconBtnStyle,
          cursor: onSettings ? 'pointer' : 'not-allowed',
          opacity: onSettings ? 1 : 0.5,
        }}
      >
        ⚙
      </button>
      <button
        type="button"
        onClick={onLeave}
        style={{
          padding: '9px 14px',
          borderRadius: 12,
          background: 'oklch(0.96 0.04 25 / 0.9)',
          border: 'none',
          boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
          cursor: 'pointer',
          fontFamily: SANS,
          fontWeight: 800,
          fontSize: 12,
          color: RED,
        }}
      >
        Leave
      </button>
    </div>
  );
}
