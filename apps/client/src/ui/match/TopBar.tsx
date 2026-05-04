import { Pressable, Text, View } from 'react-native';

interface TopBarProps {
  matchCode: string | null;
  viewers: number | null;
  onLeave: () => void;
}

const COLORS = {
  ink: 'oklch(0.25 0.04 60)',
  ink3: 'oklch(0.55 0.04 60)',
  paperHi: 'oklch(0.99 0.005 85)',
  hairline: 'oklch(0.86 0.02 80)',
  red: 'oklch(0.55 0.18 25)',
  green: 'oklch(0.7 0.14 150)',
};

/**
 * Top-right corner — Live · #CODE pill, viewer count, Leave button.
 * Compact native port; the legacy SettingsPanel + GameLog + Fullscreen
 * buttons are deferred to a later sub-phase.
 */
export function TopBar({ matchCode, viewers, onLeave }: TopBarProps) {
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
        shadowColor: '#000',
        shadowOpacity: 0.08,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 3 },
        elevation: 3,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <View
          style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.green }}
        />
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
        onPress={onLeave}
        style={({ pressed }) => ({
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: 8,
          backgroundColor: pressed ? 'oklch(0.95 0.02 85)' : 'transparent',
          borderColor: COLORS.hairline,
          borderWidth: 1,
        })}
      >
        <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.ink }}>Leave</Text>
      </Pressable>
    </View>
  );
}
