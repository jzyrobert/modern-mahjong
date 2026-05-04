import type { Seat, Wind } from '@mahjong/game-logic';
import { Text, View } from 'react-native';
import type { LobbyState } from '../../state/game';

interface OppHandStripProps {
  seat: Seat;
  seatWind: Wind;
  lobby: LobbyState | null;
  /** Number of face-down tiles to render. */
  handBacks: number;
  /** Highlight when this seat is on the move. */
  isActive: boolean;
}

const WIND_GLYPH: Record<Wind, string> = { E: '東', S: '南', W: '西', N: '北' };

const COLORS = {
  ink: 'oklch(0.25 0.04 60)',
  ink3: 'oklch(0.55 0.04 60)',
  paperHi: 'oklch(0.99 0.005 85)',
  hairline: 'oklch(0.86 0.02 80)',
  red: 'oklch(0.55 0.18 25)',
  tileBack1: '#7fa9c1',
  tileBack2: '#5a8cb0',
};

/**
 * Compact opponent strip — wind glyph + display name + a row of
 * miniature face-down tile rectangles. Native port of
 * `_legacy/src/ui/match/OppHandStrip.tsx`. Skips the active-turn glow
 * pulse (Phase 6) for now in favour of a static border tint.
 */
export function OppHandStrip({ seat, seatWind, lobby, handBacks, isActive }: OppHandStripProps) {
  const player = lobby?.players.find((p) => p.seat === seat);
  const name = player?.displayName ?? `Seat ${seat}`;
  const isBot = player?.isBot ?? false;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: COLORS.paperHi,
        borderColor: isActive ? COLORS.red : COLORS.hairline,
        borderWidth: isActive ? 2 : 1,
        borderRadius: 10,
        paddingVertical: 6,
        paddingHorizontal: 10,
      }}
    >
      <View style={{ alignItems: 'center', minWidth: 64 }}>
        <Text style={{ fontFamily: 'Noto Serif TC', fontSize: 14, color: COLORS.red, fontWeight: '700' }}>
          {WIND_GLYPH[seatWind]}
        </Text>
        <Text style={{ fontSize: 10, fontWeight: '800', color: COLORS.ink }} numberOfLines={1}>
          {name}
        </Text>
        {isBot ? (
          <Text style={{ fontSize: 8, color: COLORS.ink3, fontWeight: '700' }}>BOT</Text>
        ) : null}
      </View>
      <View style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>
        {Array.from({ length: handBacks }, (_, i) => (
          <View
            // biome-ignore lint/suspicious/noArrayIndexKey: position is fixed per index
            key={i}
            style={{
              width: 12,
              height: 16,
              borderRadius: 2,
              backgroundColor: COLORS.tileBack1,
              borderColor: COLORS.tileBack2,
              borderWidth: 1,
            }}
          />
        ))}
      </View>
    </View>
  );
}
