import { Pressable, Text, View } from 'react-native';
import { Modal } from '../Modal';
import { COLORS } from '../colors';
import { EMOTES } from './ChatBar';

interface MenuSheetProps {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onOpenLog: () => void;
  onOpenReference: () => void;
  onOpenScoring: () => void;
  onLeave: () => void;
  /** Send an emote (single emoji string) — drives the floating
   *  `<ChatBubbles>` overlay. Optional so callers that don't wire
   *  chat (e.g. older shells) can omit it; when undefined the emote
   *  row is hidden. */
  onSendChat?: ((text: string) => void) | undefined;
}

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
  onOpenScoring,
  onLeave,
  onSendChat,
}: MenuSheetProps) {
  const handle = (cb: () => void) => () => {
    onClose();
    cb();
  };
  const handleEmote = (emote: string) => {
    onSendChat?.(emote);
    onClose();
  };
  return (
    <Modal open={open} title="Menu" onClose={onClose} placement="bottom" maxWidth={520}>
      <View style={{ padding: 14, gap: 8 }}>
        {onSendChat ? <EmoteRow onSendChat={handleEmote} /> : null}
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
          icon="🏆"
          title="Scoring rules"
          hint="Every fan pattern with worked example hands."
          onPress={handle(onOpenScoring)}
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

/**
 * Six-emote row inside the menu sheet. On the desktop shell the same
 * emotes live in a persistent `<ChatBar>` along the bottom of the
 * felt; on mobile portrait there's no room for a dedicated bar, so
 * we tuck them into the menu. Tapping an emote sends it and closes
 * the sheet, mirroring how the other menu rows behave.
 */
function EmoteRow({ onSendChat }: { onSendChat: (emote: string) => void }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        padding: 10,
        borderRadius: 10,
        backgroundColor: COLORS.paperHi,
        borderColor: COLORS.hairline,
        borderWidth: 1,
      }}
    >
      <Text
        style={{
          fontSize: 11,
          fontWeight: '900',
          color: COLORS.ink3,
          letterSpacing: 0.6,
          paddingRight: 4,
        }}
      >
        EMOTE
      </Text>
      <View style={{ flex: 1, flexDirection: 'row', justifyContent: 'space-around' }}>
        {EMOTES.map((emote) => (
          <Pressable
            key={emote}
            onPress={() => onSendChat(emote)}
            accessibilityLabel={`Send ${emote}`}
            style={({ pressed }) => ({
              width: 36,
              height: 36,
              borderRadius: 10,
              alignItems: 'center',
              justifyContent: 'center',
              transform: [{ scale: pressed ? 0.92 : 1 }],
            })}
          >
            <Text style={{ fontSize: 22, lineHeight: 26 }}>{emote}</Text>
          </Pressable>
        ))}
      </View>
    </View>
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
        backgroundColor: pressed ? COLORS.creamLow : COLORS.paperHi,
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
          backgroundColor: destructive ? COLORS.accentSalmonSwatch : '#ede5d3',
          borderColor: destructive ? COLORS.accentSalmonEdge : COLORS.hairline,
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
