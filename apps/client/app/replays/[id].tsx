import { exportRecordToClipboard } from '@/src/replay/exportImport';
import { PlaybackProvider } from '@/src/replay/playback';
import { deleteRecord, loadRecord } from '@/src/replay/storage';
import type { ReplayRecord } from '@/src/replay/types';
import { GhostButton, PrimaryButton } from '@/src/ui/buttons';
import { COLORS } from '@/src/ui/colors';
import { ReplayPlayer } from '@/src/ui/replay/ReplayPlayer';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * `/replays/[id]` route — load the record by id and mount the
 * `<ReplayPlayer>` inside a `PlaybackProvider`. Loading is synchronous
 * (it's just a localStorage read) so a missing-record fallback covers
 * the only failure mode: deep-linking to an id that no longer exists.
 */
export default function ReplayDetail() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const id = typeof params.id === 'string' ? params.id : null;
  const record = useMemo<ReplayRecord | null>(() => (id ? loadRecord(id) : null), [id]);
  const [exportLabel, setExportLabel] = useState<string | null>(null);

  // Reset transient UI state if the user navigates between replays.
  useEffect(() => {
    setExportLabel(null);
  }, []);

  if (!record) {
    return (
      <View style={{ flex: 1, backgroundColor: COLORS.cream }}>
        <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.cream }} edges={['top']}>
          <View
            style={{
              flex: 1,
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
              gap: 12,
            }}
          >
            <Text
              accessibilityRole="header"
              style={{ fontSize: 22, fontWeight: '900', color: COLORS.ink }}
            >
              Replay not found
            </Text>
            <Text
              style={{
                color: COLORS.ink3,
                fontSize: 14,
                textAlign: 'center',
                maxWidth: 320,
              }}
            >
              The replay link points at an id that's no longer in your library — it may have been
              deleted or pruned past your quota.
            </Text>
            <PrimaryButton onPress={() => router.replace('/replays')}>
              Back to library
            </PrimaryButton>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const onExport = async () => {
    try {
      const bytes = await exportRecordToClipboard(record);
      setExportLabel(`Copied ${formatBytes(bytes)} to clipboard`);
      setTimeout(() => setExportLabel(null), 2400);
    } catch (e) {
      setExportLabel(`Copy failed: ${(e as Error).message}`);
    }
  };

  const onDelete = () => {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (!window.confirm('Delete this replay?')) return;
    }
    deleteRecord(record.header.id);
    router.replace('/replays');
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.cream }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.cream }} edges={['top']}>
        <PlaybackProvider record={record}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 12,
              paddingTop: 8,
            }}
          >
            <GhostButton onPress={() => router.replace('/replays')}>← Library</GhostButton>
            <View style={{ flex: 1 }} />
            {exportLabel ? (
              <View
                style={{
                  paddingHorizontal: 8,
                  paddingVertical: 4,
                  borderRadius: 6,
                  backgroundColor: COLORS.creamLow,
                  borderColor: COLORS.hairline,
                  borderWidth: 1,
                }}
              >
                <Text style={{ fontSize: 11, color: COLORS.ink3, fontWeight: '700' }}>
                  {exportLabel}
                </Text>
              </View>
            ) : null}
            <Pressable
              onPress={onExport}
              accessibilityLabel="Export replay JSON"
              style={({ pressed }) => ({
                paddingHorizontal: 10,
                paddingVertical: 8,
                borderRadius: 8,
                borderColor: COLORS.hairline,
                borderWidth: 1,
                backgroundColor: pressed ? COLORS.cream : 'white',
              })}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.ink }}>Export</Text>
            </Pressable>
            <Pressable
              onPress={onDelete}
              accessibilityLabel="Delete replay"
              style={({ pressed }) => ({
                paddingHorizontal: 10,
                paddingVertical: 8,
                borderRadius: 8,
                borderColor: COLORS.accentSalmonEdge,
                borderWidth: 1,
                backgroundColor: pressed ? COLORS.accentSalmonSwatch : 'white',
              })}
            >
              <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.red }}>Delete</Text>
            </Pressable>
          </View>
          <ReplayPlayer />
        </PlaybackProvider>
      </SafeAreaView>
    </View>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
