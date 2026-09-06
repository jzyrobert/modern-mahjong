import { Text, View } from 'react-native';
import { GlassSheet } from '../menu/GlassSheet';
import { DangerButton, GlassButton } from '../menu/MenuButtons';
import { TYPE } from '../menu/theme';

/**
 * Glass "delete this replay?" confirmation, shared by the library rows
 * and the player's chrome. Replaces the browser `confirm()` so the
 * decision happens in the parlour's language (and on native, where
 * `window.confirm` never existed).
 */
export function ConfirmDeleteSheet({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <GlassSheet open={open} title="Delete replay?" onClose={onCancel} maxWidth={420}>
      <View style={{ padding: 16, gap: 14 }}>
        <Text style={TYPE.body}>
          This removes the recording from your library. There is no undo — export it first if you
          want to keep a copy.
        </Text>
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
          <GlassButton size="sm" onPress={onCancel}>
            Cancel
          </GlassButton>
          <DangerButton size="sm" onPress={onConfirm} accessibilityLabel="Delete">
            Delete
          </DangerButton>
        </View>
      </View>
    </GlassSheet>
  );
}
