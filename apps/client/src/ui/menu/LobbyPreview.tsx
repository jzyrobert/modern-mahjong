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
        backgroundColor: '#fbf8f0',
        borderColor: '#cdc1ad',
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
              backgroundColor: '#44ad60',
            }}
          />
          <Text style={{ fontSize: 14, fontWeight: '900', color: '#3a3328' }}>In lobby</Text>
          <Text style={{ fontSize: 11, color: '#918275', fontWeight: '700' }}>
            · waiting for players
          </Text>
        </View>
        {matchCode ? (
          <View
            style={{
              backgroundColor: '#ece4d3',
              borderColor: '#cdc1ad',
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
                color: '#3a3328',
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
                backgroundColor: p ? '#ece4d3' : 'transparent',
                borderColor: '#cdc1ad',
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
                    color: '#b14d3a',
                    fontWeight: '700',
                  }}
                >
                  {WIND_GLYPH[seat]}
                </Text>
                <Text
                  style={{
                    fontSize: 10,
                    fontWeight: '800',
                    color: '#918275',
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
                      color: '#3a3328',
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
                    color: '#918275',
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
      ? { color: '#735aa3', bg: '#e1d3ed', label: 'Bot' }
      : kind === 'online'
        ? { color: '#2d8645', bg: '#c2e2c5', label: 'Online' }
        : { color: '#918275', bg: '#ece4d3', label: 'Disconnected' };
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
