import { INK, INK_3, RED, SANS } from '../../native/theme.js';

interface TopBarProps {
  /** Match code shown in the live pill — e.g. `A7K2`. Pass null to hide. */
  gameId: string | null;
  onSettings?: () => void;
  onLog?: () => void;
  onLeave: () => void;
}

/**
 * Top-right cluster on the live table — live pill (game id), settings
 * cog (stub), and a Leave button that closes the current match. Ported
 * from `/tmp/design/design/app.jsx::TopBar`.
 *
 * The viewer count from the design is omitted: the server doesn't track
 * spectator connections yet — see the "Spectator viewer count" entry in
 * TODO.md → Design port follow-ups.
 */
export function TopBar({ gameId, onSettings, onLog, onLeave }: TopBarProps) {
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
        </div>
      ) : null}
      {onLog ? (
        <button
          type="button"
          onClick={onLog}
          aria-label="Game log"
          title="Game log"
          style={{
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
          }}
        >
          📜
        </button>
      ) : null}
      <button
        type="button"
        onClick={onSettings}
        aria-label="Settings"
        title="Settings"
        disabled={!onSettings}
        style={{
          width: 38,
          height: 38,
          borderRadius: 12,
          background: 'oklch(1 0 0 / 0.92)',
          border: 'none',
          boxShadow: '0 2px 10px rgba(0,0,0,0.08)',
          cursor: onSettings ? 'pointer' : 'not-allowed',
          opacity: onSettings ? 1 : 0.5,
          fontSize: 16,
          color: INK,
          fontFamily: SANS,
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
