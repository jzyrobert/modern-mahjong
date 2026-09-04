import { Pressable, Text, View } from 'react-native';
import { COLORS, PANEL_ON_FELT } from '../colors';

interface TopBarProps {
  matchCode: string | null;
  viewers: number | null;
  /** Opens the bottom-sheet menu containing Settings / Game log /
   *  Tile reference / Leave. Wired by `Match.tsx`. */
  onOpenMenu: () => void;
  /** Whether the ☰ menu is currently open. Drives the pressed /
   *  "latched" tint on the trigger so a docked panel (desktop's
   *  right-anchored `<MenuSidePanel>`) reads as being toggled from
   *  this button. Optional — mobile callers that use the bottom-
   *  sheet pattern can omit it. */
  menuOpen?: boolean;
}

/**
 * Top-right corner — Live · #CODE pill, viewer count, ☰ menu
 * button. The four individual icon buttons (settings ⚙ / game
 * log 📜 / tile reference 📖 / leave) live behind a single ☰
 * button now, surfaced via the `MenuSheet` bottom-sheet — the
 * old row clipped on a 320 px iPhone SE even with flex-wrap.
 */
export function TopBar({ matchCode, viewers, onOpenMenu, menuOpen = false }: TopBarProps) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 6,
        paddingHorizontal: 10,
        ...PANEL_ON_FELT,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.success }} />
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
        testID="open-menu"
        style={({ pressed }) => ({
          paddingHorizontal: 10,
          paddingVertical: 4,
          borderRadius: 8,
          backgroundColor: menuOpen
            ? COLORS.accentSalmonSwatch
            : pressed
              ? COLORS.creamLow
              : 'transparent',
          borderColor: menuOpen ? COLORS.red : COLORS.hairline,
          borderWidth: 1,
        })}
      >
        <Text
          style={{
            fontSize: 14,
            fontWeight: '700',
            color: menuOpen ? COLORS.red : COLORS.ink,
          }}
        >
          ☰
        </Text>
      </Pressable>
    </View>
  );
}
