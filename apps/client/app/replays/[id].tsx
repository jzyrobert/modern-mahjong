import '@/src/replay/fixture';

import { exportRecordToClipboard } from '@/src/replay/exportImport';
import { PlaybackProvider } from '@/src/replay/playback';
import { deleteRecord, loadRecord } from '@/src/replay/storage';
import type { ReplayRecord } from '@/src/replay/types';
import { useGame } from '@/src/state/game';
import { hasWebGL2, resolveRenderer } from '@/src/three/renderer';
import { COLORS } from '@/src/ui/colors';
import { GlassCard } from '@/src/ui/menu/GlassCard';
import { LobbyBackdrop } from '@/src/ui/menu/LobbyBackdrop';
import { GoldButton } from '@/src/ui/menu/MenuButtons';
import { MENU, TYPE, heading } from '@/src/ui/menu/theme';
import { ConfirmDeleteSheet } from '@/src/ui/replay/ConfirmDeleteSheet';
import { ReplayPlayer } from '@/src/ui/replay/ReplayPlayer';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * `/replays/[id]` route — load the record by id and mount the
 * `<ReplayPlayer>` inside a `PlaybackProvider`. Loading is synchronous
 * (it's just a localStorage read) so a missing-record fallback covers
 * the only failure mode: deep-linking to an id that no longer exists.
 *
 * Under the 3D renderer (web, WebGL2) the player is the glass one: the
 * page sits on the parlour void and the route's actions (back / export
 * / delete) ride in the player's chrome row. The classic renderer keeps
 * the paper shell and its header unchanged. `?frame=<n>` (or
 * `frame=end`) opens on a visible frame — the screenshot recipes use it.
 */
export default function ReplayDetail() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const id = typeof params.id === 'string' ? params.id : null;
  const record = useMemo<ReplayRecord | null>(() => (id ? loadRecord(id) : null), [id]);
  const initialCursor = useMemo(() => parseFrameParam(params.frame), [params.frame]);
  const [exportLabel, setExportLabel] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rendererSetting = useGame((s) => s.settings.renderer);
  const glass = Platform.OS === 'web' && resolveRenderer(rendererSetting) === '3d' && hasWebGL2();

  if (!record) return <NotFound onBack={() => router.replace('/replays')} />;

  const onExport = async () => {
    try {
      const bytes = await exportRecordToClipboard(record);
      setExportLabel(`Copied ${formatBytes(bytes)} to clipboard`);
      setTimeout(() => setExportLabel(null), 2400);
    } catch (e) {
      setExportLabel(`Copy failed: ${(e as Error).message}`);
    }
  };

  const doDelete = () => {
    deleteRecord(record.header.id);
    router.replace('/replays');
  };

  if (glass) {
    return (
      <View style={{ flex: 1, backgroundColor: MENU.void0 }} testID="replay-route-glass">
        <LobbyBackdrop scene={false} backs={false} glow={{ x: 0.5, y: 0.4 }} />
        <PlaybackProvider record={record} initialCursor={initialCursor}>
          <ReplayPlayer
            theme="glass"
            actions={{
              onBack: () => router.replace('/replays'),
              onExport,
              onDelete: () => setConfirmDelete(true),
              exportLabel,
            }}
          />
        </PlaybackProvider>
        <ConfirmDeleteSheet
          open={confirmDelete}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={doDelete}
        />
      </View>
    );
  }

  const onDelete = () => {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (!window.confirm('Delete this replay?')) return;
    }
    doDelete();
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.cream }} edges={['top', 'bottom']}>
      <PlaybackProvider record={record} initialCursor={initialCursor}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: 12,
            paddingVertical: 8,
          }}
        >
          <Pressable
            onPress={() => router.replace('/replays')}
            accessibilityRole="button"
            style={({ pressed }) => ({
              paddingHorizontal: 10,
              paddingVertical: 8,
              borderRadius: 8,
              borderColor: COLORS.hairline,
              borderWidth: 1,
              backgroundColor: pressed ? COLORS.cream : 'white',
            })}
          >
            <Text style={{ fontSize: 12, fontWeight: '700', color: COLORS.ink }}>← Library</Text>
          </Pressable>
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
  );
}

/** Glass card on the void — the library's language, whichever renderer. */
function NotFound({ onBack }: { onBack: () => void }) {
  return (
    <View style={{ flex: 1, backgroundColor: MENU.void0 }} testID="replay-not-found">
      <LobbyBackdrop scene={false} backs={false} glow={{ x: 0.5, y: 0.45 }} />
      <SafeAreaView
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}
        edges={['top', 'bottom']}
      >
        <GlassCard
          hover={false}
          style={{ padding: 24, gap: 12, alignItems: 'center', maxWidth: 420 }}
        >
          <Text style={[TYPE.label, { color: MENU.gold }]}>Replays</Text>
          <Text accessibilityRole="header" style={heading(26)}>
            Replay not found
          </Text>
          <Text style={[TYPE.body, { textAlign: 'center' }]}>
            The replay link points at an id that's no longer in your library — it may have been
            deleted or pruned past your quota.
          </Text>
          <GoldButton onPress={onBack} style={{ marginTop: 4 }}>
            Back to library
          </GoldButton>
        </GlassCard>
      </SafeAreaView>
    </View>
  );
}

/** `?frame=12` → 11 (1-based in the URL, like the counter); `frame=end` → the last frame. */
export function parseFrameParam(raw: unknown): number | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (typeof v !== 'string' || v.length === 0) return undefined;
  if (v === 'end' || v === 'last') return Number.POSITIVE_INFINITY;
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n) - 1) : undefined;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
