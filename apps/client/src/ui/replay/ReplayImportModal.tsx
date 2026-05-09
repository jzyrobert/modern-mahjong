import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { tryImportRecord } from '../../replay/exportImport';
import { useGame } from '../../state/game';
import { Modal } from '../Modal';
import { GhostButton, PrimaryButton } from '../buttons';
import { COLORS } from '../colors';

interface ReplayImportModalProps {
  open: boolean;
  onClose: () => void;
  onImported: () => void;
}

/**
 * Paste-JSON import flow. The replay format is just `JSON.stringify` of
 * a `ReplayRecord`, so the user can copy it from one device's clipboard
 * (via the export action), paste here on another, and import. We assign
 * a fresh id on import so duplicates don't collide; we don't validate
 * with zod yet (the Action / GameState shapes are deeply nested and
 * the engine catches malformed states at render time anyway). A
 * lightweight envelope check covers the common case.
 */
export function ReplayImportModal({ open, onClose, onImported }: ReplayImportModalProps) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const replayQuota = useGame((s) => s.settings.replayQuota);

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
    <Modal open={open} title="Import replay" onClose={onCancel} maxWidth={560}>
      <View style={{ padding: 16, gap: 12 }}>
        <Text style={{ fontSize: 12, color: COLORS.ink3, lineHeight: 18 }}>
          Paste a JSON-encoded replay below. Replays exported from another device (or another
          install) work as long as the engine version matches.
        </Text>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          numberOfLines={6}
          placeholder='{"header":{...},"frames":[...],"bookmarks":[...]}'
          placeholderTextColor={COLORS.ink3}
          accessibilityLabel="Paste replay JSON"
          style={{
            borderColor: COLORS.hairline,
            borderWidth: 1,
            borderRadius: 8,
            padding: 10,
            backgroundColor: COLORS.paperHi,
            color: COLORS.ink,
            fontFamily: 'Courier',
            fontSize: 11,
            minHeight: 120,
            textAlignVertical: 'top',
          }}
        />
        {error ? (
          <View
            style={{
              backgroundColor: COLORS.accentSalmonSwatch,
              borderColor: COLORS.accentSalmonEdge,
              borderWidth: 1,
              borderRadius: 6,
              padding: 8,
            }}
          >
            <Text style={{ fontSize: 11, color: COLORS.red, fontWeight: '700' }}>{error}</Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <GhostButton onPress={onPasteFromClipboard}>Paste from clipboard</GhostButton>
          <View style={{ flex: 1 }} />
          <GhostButton onPress={onCancel}>Cancel</GhostButton>
          <PrimaryButton onPress={onImport} disabled={text.trim().length === 0}>
            Import
          </PrimaryButton>
        </View>
      </View>
    </Modal>
  );
}
