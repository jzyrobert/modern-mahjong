import { Pressable, Text, View } from 'react-native';
import { Modal } from '../Modal';

interface MenuSheetProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenLog: () => void;
  onOpenReference: () => void;
  onLeave: () => void;
}

const COLORS = {
  ink: '#3a3328',
  ink3: '#918275',
  paperHi: '#fbf8f0',
  hairline: '#cdc1ad',
  red: '#b14d3a',
};

interface MenuRowProps {
  icon: string;
  title: string;
  hint: string;
  onPress: () => void;
  destructive?: boolean;
}

/**
 * Bottom-sheet ☰ menu that consolidates the per-match utilities —
 * Settings / Game log / Tile reference / Leave — into one entry
 * point on the `TopBar`. Replaces the four individual icon
 * buttons that used to live there. On a 320 px iPhone SE the
 * row of icon buttons clipped Leave even with flex-wrap; collapsing
 * them into a single ☰ button frees the slot and matches the
 * design's `app-mobile.jsx` reference for the menu pane.
 *
 * Each row in the sheet calls back to `Match.tsx`'s individual
 * `setSettingsOpen` / `setLogOpen` / `setReferenceOpen` /
 * `onLeave` handlers, then immediately closes the menu so the
 * downstream sheet/modal opens cleanly.
 */
export function MenuSheet({
  open,
  onClose,
  onOpenSettings,
  onOpenLog,
  onOpenReference,
  onLeave,
}: MenuSheetProps) {
  const handle = (cb: () => void) => () => {
    onClose();
    cb();
  };
  return (
    <Modal open={open} title="Menu" onClose={onClose} placement="bottom" maxWidth={520}>
      <View style={{ padding: 14, gap: 8 }}>
        <MenuRow
          icon="⚙"
          title="Settings"
          hint="Felt, tile back, sound, animations."
          onPress={handle(onOpenSettings)}
        />
        <MenuRow
          icon="📜"
          title="Game log"
          hint="Recent engine events for this hand."
          onPress={handle(onOpenLog)}
        />
        <MenuRow
          icon="📖"
          title="Tile reference"
          hint="All 136 tiles grouped by suit + honors."
          onPress={handle(onOpenReference)}
        />
        <MenuRow
          icon="←"
          title="Leave match"
          hint="Disconnects and returns to the lobby."
          onPress={handle(onLeave)}
          destructive
        />
      </View>
    </Modal>
  );
}

function MenuRow({ icon, title, hint, onPress, destructive }: MenuRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 14,
        borderRadius: 10,
        backgroundColor: pressed ? '#ece4d3' : COLORS.paperHi,
        borderColor: COLORS.hairline,
        borderWidth: 1,
      })}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: destructive ? '#fbe5d9' : '#ede5d3',
          borderColor: destructive ? '#d8b09f' : COLORS.hairline,
          borderWidth: 1,
        }}
      >
        <Text style={{ fontSize: 16, color: destructive ? COLORS.red : COLORS.ink }}>{icon}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text
          style={{
            fontSize: 14,
            fontWeight: '900',
            color: destructive ? COLORS.red : COLORS.ink,
          }}
        >
          {title}
        </Text>
        <Text style={{ fontSize: 11, color: COLORS.ink3, fontWeight: '600', marginTop: 2 }}>
          {hint}
        </Text>
      </View>
    </Pressable>
  );
}
