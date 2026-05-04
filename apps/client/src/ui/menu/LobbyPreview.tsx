import { SEATS } from '@mahjong/game-logic';
import { Text, View, useWindowDimensions } from 'react-native';
import type { LobbyState } from '../../state/game';

interface LobbyPreviewProps {
  lobby: LobbyState;
  matchCode: string | null;
}

const WIND_GLYPH = ['東', '南', '西', '北'] as const;

/**
 * Live preview of the four-seat lobby. Native port of
 * `_legacy/src/ui/menu/LobbyPreview.tsx` — same wind glyphs, same seat
 * cards, same connection-status pills. Auto-fit grid replaced with a
 * `useWindowDimensions`-driven flex-wrap so on narrow phones the four
 * seats reflow to 2×2 instead of overflowing.
 */
export function LobbyPreview({ lobby, matchCode }: LobbyPreviewProps) {
  const { width } = useWindowDimensions();
  const players = SEATS.map((seat) => lobby.players.find((p) => p.seat === seat) ?? null);
  // ≥620px → 4 cols (1fr each); below → 2 cols. Matches the legacy
  // `repeat(auto-fit, minmax(140px, 1fr))` semantics.
  const cardBasis = width >= 620 ? '23%' : '47%';

  return (
    <View
      style={{
        marginTop: 20,
        backgroundColor: 'oklch(0.99 0.005 85)',
        borderColor: 'oklch(0.86 0.02 80)',
        borderWidth: 1,
        borderRadius: 14,
        padding: 18,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
          gap: 12,
          flexWrap: 'wrap',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: 'oklch(0.65 0.18 145)',
            }}
          />
          <Text style={{ fontSize: 14, fontWeight: '900', color: 'oklch(0.25 0.04 60)' }}>
            In lobby
          </Text>
          <Text style={{ fontSize: 11, color: 'oklch(0.55 0.04 60)', fontWeight: '700' }}>
            · waiting for players
          </Text>
        </View>
        {matchCode ? (
          <View
            style={{
              backgroundColor: 'oklch(0.95 0.02 85)',
              borderColor: 'oklch(0.86 0.02 80)',
              borderWidth: 1,
              borderRadius: 8,
              paddingVertical: 4,
              paddingHorizontal: 10,
            }}
          >
            <Text
              style={{
                fontFamily: 'JetBrains Mono',
                fontSize: 13,
                fontWeight: '800',
                letterSpacing: 3,
                color: 'oklch(0.25 0.04 60)',
              }}
            >
              {matchCode}
            </Text>
          </View>
        ) : null}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {SEATS.map((seat) => {
          const p = players[seat];
          return (
            <View
              key={seat}
              style={{
                flexBasis: cardBasis,
                flexGrow: 1,
                backgroundColor: p ? 'oklch(0.95 0.02 85)' : 'transparent',
                borderColor: 'oklch(0.86 0.02 80)',
                borderWidth: 1,
                borderStyle: p ? 'solid' : 'dashed',
                borderRadius: 10,
                padding: 10,
                gap: 6,
                minHeight: 76,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text
                  style={{
                    fontFamily: 'Noto Serif TC',
                    fontSize: 16,
                    color: 'oklch(0.55 0.18 25)',
                    fontWeight: '700',
                  }}
                >
                  {WIND_GLYPH[seat]}
                </Text>
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: '800',
                    color: 'oklch(0.55 0.04 60)',
                    letterSpacing: 0.6,
                  }}
                >
                  SEAT {seat}
                </Text>
              </View>
              {p ? (
                <>
                  <Text
                    style={{
                      fontSize: 13,
                      fontWeight: '800',
                      color: 'oklch(0.25 0.04 60)',
                      lineHeight: 16,
                    }}
                  >
                    {p.displayName}
                  </Text>
                  <StatusPill kind={p.isBot ? 'bot' : p.connected ? 'online' : 'offline'} />
                </>
              ) : (
                <Text
                  style={{
                    fontSize: 12,
                    color: 'oklch(0.55 0.04 60)',
                    fontStyle: 'italic',
                    fontWeight: '600',
                  }}
                >
                  Open seat…
                </Text>
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function StatusPill({ kind }: { kind: 'bot' | 'online' | 'offline' }) {
  const palette =
    kind === 'bot'
      ? { color: 'oklch(0.5 0.1 280)', bg: 'oklch(0.95 0.04 280)', label: 'Bot' }
      : kind === 'online'
        ? { color: 'oklch(0.45 0.15 145)', bg: 'oklch(0.95 0.06 145)', label: 'Online' }
        : { color: 'oklch(0.55 0.04 60)', bg: 'oklch(0.95 0.02 85)', label: 'Disconnected' };
  return (
    <View
      style={{
        backgroundColor: palette.bg,
        borderRadius: 4,
        paddingVertical: 2,
        paddingHorizontal: 6,
        alignSelf: 'flex-start',
      }}
    >
      <Text
        style={{
          fontSize: 9,
          fontWeight: '800',
          letterSpacing: 0.5,
          color: palette.color,
        }}
      >
        {palette.label.toUpperCase()}
      </Text>
    </View>
  );
}
