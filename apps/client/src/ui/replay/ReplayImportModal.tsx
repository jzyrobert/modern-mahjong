import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Text, TextInput, View, useWindowDimensions } from 'react-native';
import { tryImportRecord } from '../../replay/exportImport';
import { useGame } from '../../state/game';
import { GlassSheet } from '../menu/GlassSheet';
import { GlassButton, GoldButton } from '../menu/MenuButtons';
import { MENU, TYPE } from '../menu/theme';

interface ReplayImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

/**
 * Paste-JSON import flow. The replay format is just `JSON.stringify` of
 * a `ReplayRecord`, so the user can copy it from one device's clipboard
 * (via the export action), paste here on another, and import. A fresh
 * id is assigned on import so duplicates don't collide; a lightweight
 * envelope check covers the common malformed-paste case.
 */
export function ReplayImportModal({ open, onClose, onImported }: ReplayImportModalProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const replayQuota = useGame((s) => s.settings.replayQuota);
  const narrow = useWindowDimensions().width < 400;

  const onPasteFromClipboard = async () => {
    try {
      const fromClip = await Clipboard.getStringAsync();
      if (fromClip) setText(fromClip);
    } catch (e) {
      setError(`Clipboard read failed: ${(e as Error).message}`);
    }
  };

  const onImport = () => {
    setError(null);
    const result = tryImportRecord(text, replayQuota);
    if (result.kind === 'ok') {
      setText('');
      onImported();
      return;
    }
    setError(result.error);
  };

  const onCancel = () => {
    setText('');
    setError(null);
    onClose();
  };

  return (
    <GlassSheet open={open} title="Import replay" onClose={onCancel} maxWidth={560}>
      <View style={{ padding: 16, gap: 12 }}>
        <Text style={TYPE.body}>
          Paste a JSON-encoded replay below. Replays exported from another device (or another
          install) work as long as the engine version matches.
        </Text>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          numberOfLines={6}
          placeholder='{"header":{...},"frames":[...],"bookmarks":[...]}'
          placeholderTextColor={MENU.text3}
          accessibilityLabel="Paste replay JSON"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            borderColor: focused ? MENU.gold : MENU.hairline,
            borderWidth: 1,
            borderRadius: 12,
            padding: 12,
            backgroundColor: MENU.fill,
            color: MENU.text,
            ...TYPE.mono,
            fontSize: 11,
            lineHeight: 16,
            minHeight: 140,
            textAlignVertical: 'top',
          }}
        />
        {error ? (
          <View
            style={{
              backgroundColor: MENU.redTint,
              borderColor: MENU.redEdge,
              borderWidth: 1,
              borderRadius: 10,
              padding: 10,
            }}
          >
            <Text style={{ fontSize: 12, color: '#e59a8b', fontWeight: '700', lineHeight: 16 }}>
              {error}
            </Text>
          </View>
        ) : null}
        {/* Narrow phones: the paste chip takes its own row so Cancel +
            the gold Import stay together on the last line (a wrapped row
            orphaned Import under the other two at 360 px). */}
        <View
          style={{
            flexDirection: narrow ? 'column' : 'row',
            gap: 8,
            alignItems: narrow ? 'stretch' : 'center',
          }}
        >
          <View style={{ flexDirection: 'row' }}>
            <GlassButton size="sm" onPress={onPasteFromClipboard}>
              Paste from clipboard
            </GlassButton>
          </View>
          {narrow ? null : <View style={{ flex: 1 }} />}
          <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}>
            <GlassButton size="sm" onPress={onCancel}>
              Cancel
            </GlassButton>
            <GoldButton size="sm" onPress={onImport} disabled={text.trim().length === 0}>
              Import
            </GoldButton>
          </View>
        </View>
      </View>
    </GlassSheet>
  );
}
