import { Pressable, Text, View } from 'react-native';

interface TopBarProps {
  matchCode: string | null;
  viewers: number | null;
  /** Opens the bottom-sheet menu containing Settings / Game log /
   *  Tile reference / Leave. Wired by `Match.tsx`. */
  onOpenMenu: () => void;
}

const COLORS = {
  ink: '#3a3328',
  ink3: '#918275',
  paperHi: '#fbf8f0',
  hairline: '#cdc1ad',
  red: '#b14d3a',
  green: '#58c280',
};

/**
 * Top-right corner — Live · #CODE pill, viewer count, ☰ menu
 * button. The four individual icon buttons (settings ⚙ / game
 * log 📜 / tile reference 📖 / leave) live behind a single ☰
 * button now, surfaced via the `MenuSheet` bottom-sheet — the
 * old row clipped on a 320 px iPhone SE even with flex-wrap.
 */
export function TopBar({ matchCode, viewers, onOpenMenu }: TopBarProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 16,
        backgroundColor: 'rgba(255,255,255,0.88)',
        boxShadow: '0px 3px 12px rgba(0,0,0,0.08)',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.green }} />
        <Text style={{ fontSize: 10, fontWeight: '800', color: COLORS.ink, letterSpacing: 0.4 }}>
          LIVE
        </Text>
        {matchCode ? (
          <Text style={{ fontSize: 11, fontWeight: '800', color: COLORS.red, letterSpacing: 1.2 }}>
            #{matchCode}
          </Text>
        ) : null}
      </View>
      {viewers && viewers > 0 ? (
        <Text style={{ fontSize: 11, color: COLORS.ink3, fontWeight: '600' }}>👁 {viewers}</Text>
      ) : null}
      <Pressable
        onPress={onOpenMenu}
        accessibilityLabel="Open menu"
        style={({ pressed }) => ({
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: 8,
          backgroundColor: pressed ? '#ece4d3' : 'transparent',
          borderColor: COLORS.hairline,
          borderWidth: 1,
        })}
      >
        <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.ink }}>☰</Text>
      </Pressable>
    </View>
  );
}
