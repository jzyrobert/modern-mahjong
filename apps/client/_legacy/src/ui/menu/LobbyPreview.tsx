import { SEATS } from '@mahjong/game-logic';
import { CREAM, HAIRLINE, INK, INK_3, MONO, PAPER_HI, RED, SERIF } from '../../native/theme.js';
import type { LobbyState } from '../../state/game.js';

interface LobbyPreviewProps {
  lobby: LobbyState;
  matchCode: string | null;
}

const WIND_GLYPH = ['東', '南', '西', '北'] as const;

/**
 * Live preview of the four-seat lobby — wind glyph per seat, the player's
 * display name + connection status pill, dashed empty-seat boxes for open
 * slots. Ported from `/tmp/design/design/menu.jsx::LobbyPreview` and bound
 * to the engine's `LobbyState`.
 */
export function LobbyPreview({ lobby, matchCode }: LobbyPreviewProps) {
  const players = SEATS.map((seat) => lobby.players.find((p) => p.seat === seat) ?? null);

  return (
    <div
      style={{
        marginTop: 20,
        background: PAPER_HI,
        border: `1px solid ${HAIRLINE}`,
        borderRadius: 14,
        padding: 18,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: 'oklch(0.65 0.18 145)',
              flexShrink: 0,
            }}
          />
          <div style={{ fontSize: 14, fontWeight: 900, color: INK, whiteSpace: 'nowrap' }}>
            In lobby
          </div>
          <div style={{ fontSize: 11, color: INK_3, fontWeight: 700, whiteSpace: 'nowrap' }}>
            · waiting for players
          </div>
        </div>
        {matchCode ? (
          <div
            style={{
              fontFamily: MONO,
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: 3,
              color: INK,
              background: CREAM,
              padding: '4px 10px',
              borderRadius: 8,
              border: `1px solid ${HAIRLINE}`,
            }}
          >
            {matchCode}
          </div>
        ) : null}
      </div>

      <div
        style={{
          display: 'grid',
          // Auto-fit so the four cards reflow to 2×2 on narrow viewports
          // (e.g. ~360px phones) instead of overflowing their fixed
          // ~80px-wide boxes. On ≥620px the row stays as four columns.
          gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
          gap: 8,
        }}
      >
        {SEATS.map((seat) => {
          const p = players[seat];
          return (
            <div
              key={seat}
              style={{
                background: p ? CREAM : 'transparent',
                border: `1px ${p ? 'solid' : 'dashed'} ${HAIRLINE}`,
                borderRadius: 10,
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                gap: 6,
                minHeight: 76,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontFamily: SERIF, fontSize: 16, color: RED, fontWeight: 700 }}>
                  {WIND_GLYPH[seat]}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 800,
                    color: INK_3,
                    textTransform: 'uppercase',
                    letterSpacing: 0.6,
                  }}
                >
                  Seat {seat}
                </span>
              </div>
              {p ? (
                <>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 800,
                      color: INK,
                      wordBreak: 'break-word',
                      lineHeight: 1.2,
                    }}
                  >
                    {p.displayName}
                  </div>
                  <StatusPill kind={p.isBot ? 'bot' : p.connected ? 'online' : 'offline'} />
                </>
              ) : (
                <div style={{ fontSize: 12, color: INK_3, fontStyle: 'italic', fontWeight: 600 }}>
                  Open seat…
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusPill({ kind }: { kind: 'bot' | 'online' | 'offline' }) {
  const palette =
    kind === 'bot'
      ? { color: 'oklch(0.5 0.1 280)', bg: 'oklch(0.95 0.04 280)', label: 'Bot' }
      : kind === 'online'
        ? { color: 'oklch(0.45 0.15 145)', bg: 'oklch(0.95 0.06 145)', label: 'Online' }
        : { color: INK_3, bg: CREAM, label: 'Disconnected' };
  return (
    <div
      style={{
        fontSize: 9,
        fontWeight: 800,
        letterSpacing: 0.5,
        textTransform: 'uppercase',
        color: palette.color,
        background: palette.bg,
        padding: '2px 6px',
        borderRadius: 4,
      }}
    >
      {palette.label}
    </div>
  );
}
