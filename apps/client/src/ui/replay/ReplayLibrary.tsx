import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { deleteRecord, listHeaders } from '../../replay/storage';
import type { ReplayHeader } from '../../replay/types';
import { useGame } from '../../state/game';
import { GhostButton, PrimaryButton } from '../buttons';
import { COLORS } from '../colors';
import { ReplayImportModal } from './ReplayImportModal';

const JOIN_BADGE: Record<ReplayHeader['joinKind'], string> = {
  online: 'ONLINE',
  solo: 'SOLO',
  lan: 'LAN',
};

const JOIN_COLOR: Record<ReplayHeader['joinKind'], string> = {
  online: '#6a5292',
  solo: COLORS.ink2,
  lan: '#3a8a6a',
};

/**
 * Replay library — list of saved replays, most-recent-first. Tap a row
 * to open the player. Header has back-to-lobby + import-from-JSON.
 * `refresh()` re-reads after a delete or import.
 */
export function ReplayLibrary() {
  const router = useRouter();
  const [headers, setHeaders] = useState<readonly ReplayHeader[]>(() => listHeaders());
  const [importOpen, setImportOpen] = useState(false);
  const autoRecord = useGame((s) => s.settings.autoRecordReplays);
  const setSettings = useGame((s) => s.setSettings);

  const refresh = useCallback(() => setHeaders(listHeaders()), []);

  const onOpenReplay = (id: string) => {
    router.push(`/replays/${id}`);
  };

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.cream }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.cream }} edges={['top']}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: 16, paddingTop: 14 }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              marginBottom: 12,
            }}
          >
            <GhostButton onPress={() => router.replace('/')}>← Lobby</GhostButton>
            <View style={{ flex: 1 }} />
            <PrimaryButton onPress={() => setImportOpen(true)}>Import…</PrimaryButton>
          </View>
          <Text
            accessibilityRole="header"
            style={{ fontSize: 24, fontWeight: '900', color: COLORS.ink }}
          >
            Replays
          </Text>
          <Text style={{ marginTop: 4, marginBottom: 12, fontSize: 12, color: COLORS.ink3 }}>
            {headers.length === 0
              ? 'No replays saved yet. Hit "Save this match" from the in-match menu, or flip auto-record on so every match records automatically.'
              : `${headers.length} saved replay${headers.length === 1 ? '' : 's'}.`}
          </Text>

          <AutoRecordToggle
            enabled={autoRecord}
            onToggle={() => setSettings({ autoRecordReplays: !autoRecord })}
          />

          {headers.length === 0 ? null : (
            <View style={{ gap: 8, marginTop: 12 }}>
              {headers.map((h) => (
                <ReplayRow
                  key={h.id}
                  header={h}
                  onOpen={() => onOpenReplay(h.id)}
                  onDeleted={refresh}
                />
              ))}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
      <ReplayImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          setImportOpen(false);
          refresh();
        }}
      />
    </View>
  );
}

function AutoRecordToggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityLabel={`Auto-record replays: ${enabled ? 'on' : 'off'}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: pressed ? COLORS.creamLow : COLORS.paperHi,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 10,
        padding: 14,
      })}
    >
      <View
        style={{
          width: 36,
          height: 20,
          borderRadius: 10,
          backgroundColor: enabled ? COLORS.green : COLORS.creamLow,
          borderColor: COLORS.hairline,
          borderWidth: 1,
          padding: 1,
          flexDirection: 'row',
          justifyContent: enabled ? 'flex-end' : 'flex-start',
        }}
      >
        <View
          style={{
            width: 16,
            height: 16,
            borderRadius: 8,
            backgroundColor: 'white',
            borderColor: COLORS.hairline,
            borderWidth: 1,
          }}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13, fontWeight: '900', color: COLORS.ink }}>
          Auto-record every match
        </Text>
        <Text style={{ fontSize: 11, color: COLORS.ink3, fontWeight: '600', marginTop: 2 }}>
          {enabled
            ? 'Every match auto-saves on teardown. Oldest replays prune past your quota.'
            : 'Off — save matches manually from the in-match menu.'}
        </Text>
      </View>
    </Pressable>
  );
}

function ReplayRow({
  header,
  onOpen,
  onDeleted,
}: {
  header: ReplayHeader;
  onOpen: () => void;
  onDeleted: () => void;
}) {
  const onDelete = () => {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (!window.confirm('Delete this replay?')) return;
    }
    deleteRecord(header.id);
    onDeleted();
  };
  const dateLabel = new Date(header.startedAt).toLocaleString();
  const durationLabel = formatDuration(header.durationMs);
  const opponentNames = describeOpponents(header);
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Open replay from ${dateLabel}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: 10,
        backgroundColor: pressed ? COLORS.creamLow : COLORS.paperHi,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 10,
        padding: 12,
      })}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <View
            style={{
              backgroundColor: JOIN_COLOR[header.joinKind],
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 4,
            }}
          >
            <Text
              style={{
                fontSize: 9,
                color: 'white',
                fontWeight: '900',
                letterSpacing: 0.6,
              }}
            >
              {JOIN_BADGE[header.joinKind]}
            </Text>
          </View>
          <Text style={{ fontSize: 13, fontWeight: '900', color: COLORS.ink }}>{dateLabel}</Text>
        </View>
        <Text style={{ fontSize: 12, color: COLORS.ink2 }}>{opponentNames}</Text>
        <Text style={{ fontSize: 11, color: COLORS.ink3, fontWeight: '600' }}>
          {header.handsPlayed} hand{header.handsPlayed === 1 ? '' : 's'} · {durationLabel} · final{' '}
          {scoreboardLabel(header)}
        </Text>
      </View>
      <Pressable
        onPress={onDelete}
        accessibilityLabel="Delete replay"
        hitSlop={8}
        style={({ pressed }) => ({
          width: 32,
          height: 32,
          borderRadius: 6,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: pressed ? COLORS.creamPressed : 'transparent',
        })}
      >
        <Text style={{ fontSize: 18, color: COLORS.ink3 }}>×</Text>
      </Pressable>
    </Pressable>
  );
}

function describeOpponents(header: ReplayHeader): string {
  const local = header.localSeat;
  const names: string[] = [];
  for (const seat of [0, 1, 2, 3] as const) {
    const meta = header.players[seat];
    if (!meta) continue;
    const isYou = local === seat;
    if (isYou) names.push(`${meta.displayName} (you)`);
    else names.push(meta.displayName);
  }
  return names.join(' · ');
}

function scoreboardLabel(header: ReplayHeader): string {
  const entries = [0, 1, 2, 3].map((s) => header.finalScoreboard[s as 0 | 1 | 2 | 3] ?? 0);
  return entries.map((v) => (v >= 0 ? `+${v}` : `${v}`)).join(' / ');
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}
