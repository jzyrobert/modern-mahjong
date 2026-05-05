import { Pressable, Text, View } from 'react-native';

interface TopBarProps {
  matchCode: string | null;
  viewers: number | null;
  onLeave: () => void;
  /** Optional — if provided, renders a "⚙" button that opens the
   *  in-match SettingsPanel. Match.tsx wires this to local state.
   *  Pre-game lobby renders TopBar without it. */
  onOpenSettings?: () => void;
  /** Optional — if provided, renders a "📜" button that opens the
   *  GameLog modal listing the recent engine events. */
  onOpenLog?: () => void;
  /** Optional — if provided, renders a "📖" button that opens the
   *  136-tile reference bottom-sheet. */
  onOpenReference?: () => void;
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
 * Top-right corner — Live · #CODE pill, viewer count, Settings button,
 * Leave button. The legacy GameLog + Fullscreen buttons are deferred
 * (still queued in TODO.md's Expo migration follow-ups).
 */
export function TopBar({
  matchCode,
  viewers,
  onLeave,
  onOpenSettings,
  onOpenLog,
  onOpenReference,
}: TopBarProps) {
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
      {onOpenReference ? (
        <Pressable
          onPress={onOpenReference}
          accessibilityLabel="Open tile reference"
          style={({ pressed }) => ({
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 8,
            backgroundColor: pressed ? '#ece4d3' : 'transparent',
            borderColor: COLORS.hairline,
            borderWidth: 1,
          })}
        >
          <Text style={{ fontSize: 13, color: COLORS.ink }}>📖</Text>
        </Pressable>
      ) : null}
      {onOpenLog ? (
        <Pressable
          onPress={onOpenLog}
          accessibilityLabel="Open game log"
          style={({ pressed }) => ({
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 8,
            backgroundColor: pressed ? '#ece4d3' : 'transparent',
            borderColor: COLORS.hairline,
            borderWidth: 1,
          })}
        >
          <Text style={{ fontSize: 13, color: COLORS.ink }}>📜</Text>
        </Pressable>
      ) : null}
      {onOpenSettings ? (
        <Pressable
          onPress={onOpenSettings}
          accessibilityLabel="Open settings"
          style={({ pressed }) => ({
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 8,
            backgroundColor: pressed ? '#ece4d3' : 'transparent',
            borderColor: COLORS.hairline,
            borderWidth: 1,
          })}
        >
          <Text style={{ fontSize: 13, color: COLORS.ink }}>⚙</Text>
        </Pressable>
      ) : null}
      <Pressable
        onPress={onLeave}
        style={({ pressed }) => ({
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: 8,
          backgroundColor: pressed ? '#ece4d3' : 'transparent',
          borderColor: COLORS.hairline,
          borderWidth: 1,
        })}
      >
        <Text style={{ fontSize: 11, fontWeight: '700', color: COLORS.ink }}>Leave</Text>
      </Pressable>
    </View>
  );
}
