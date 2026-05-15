import { SEATS, type Seat } from '@mahjong/game-logic';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { deleteRecord, listHeaders } from '../../replay/storage';
import type { ReplayHeader } from '../../replay/types';
import { useGame } from '../../state/game';
import { GhostButton, PrimaryButton } from '../buttons';
import { COLORS, SUCCESS_PILL } from '../colors';
import { type Position, SEAT_COLOR } from '../match/seatColor';
import { LobbyWatermark } from '../menu/LobbyWatermark';
import { WindEmblem } from '../menu/WindEmblem';
import { SEAT_WIND_GLYPH } from '../winds';
import { ReplayImportModal } from './ReplayImportModal';

/**
 * Replay library — "Trophy shelf" redesign. Each saved match shows
 * up as a row anchored by the winner's wind-emblem tile (same SVG
 * shape the lobby hero uses) with seat-coloured score chips and a
 * gold ★ WON pin when the local seat carried the match. Rows are
 * grouped into bilingual date sections (`今日 · TODAY`, `以前 ·
 * EARLIER`, …) computed from each header's `startedAt`. The lobby's
 * `<LobbyWatermark>` (rotated `中` glyph) sits behind everything on
 * viewports wide enough to fit it (≥ 560 px) so the page reads as
 * the same atmospheric surface the lobby does.
 *
 * No new state — `listHeaders()` / `deleteRecord()` are the same
 * storage hooks the previous list used. The auto-record toggle still
 * lives inside this file because it's library-only chrome.
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

  const groups = useMemo(() => groupByDate(headers), [headers]);
  const summary = useMemo(() => summarise(headers), [headers]);

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.cream }}>
      <LobbyWatermark />
      <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }} edges={['top', 'bottom']}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 60 }}
          showsVerticalScrollIndicator={false}
        >
          <Hero
            count={headers.length}
            summary={summary}
            onBack={() => router.replace('/')}
            onImport={() => setImportOpen(true)}
          />
          <AutoRecordRibbon
            enabled={autoRecord}
            onToggle={() => setSettings({ autoRecordReplays: !autoRecord })}
          />
          {headers.length === 0 ? (
            <EmptyState />
          ) : (
            groups.map((g) =>
              g.headers.length === 0 ? null : (
                <Section key={g.id} group={g}>
                  {g.headers.map((h) => (
                    <ReplayRow
                      key={h.id}
                      header={h}
                      onOpen={() => onOpenReplay(h.id)}
                      onDeleted={refresh}
                    />
                  ))}
                </Section>
              ),
            )
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

// ─── Hero ──────────────────────────────────────────────────────────

function Hero({
  count,
  summary,
  onBack,
  onImport,
}: {
  count: number;
  summary: { wins: number; losses: number; streak: number };
  onBack: () => void;
  onImport: () => void;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 18,
        flexWrap: 'wrap',
        paddingHorizontal: 20,
        paddingTop: 20,
        paddingBottom: 14,
      }}
    >
      <GhostButton onPress={onBack}>← Lobby</GhostButton>
      <View style={{ flex: 1, minWidth: 0 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            gap: 14,
            flexWrap: 'wrap',
          }}
        >
          <Text
            accessibilityRole="header"
            style={{
              fontSize: 36,
              fontWeight: '900',
              color: COLORS.ink,
              letterSpacing: -0.5,
              lineHeight: 36,
            }}
          >
            Replays
          </Text>
          <Text
            style={{
              fontFamily: 'Noto Serif TC',
              fontWeight: '700',
              fontSize: 28,
              color: COLORS.red,
              lineHeight: 28,
            }}
          >
            戰績
          </Text>
        </View>
        <Text
          style={{
            marginTop: 6,
            fontSize: 13,
            fontWeight: '600',
            color: COLORS.ink3,
          }}
        >
          {summaryLine(count, summary)}
        </Text>
      </View>
      <PrimaryButton onPress={onImport}>Import…</PrimaryButton>
    </View>
  );
}

function summaryLine(
  count: number,
  summary: { wins: number; losses: number; streak: number },
): string {
  if (count === 0) return 'No replays saved yet.';
  const matchWord = count === 1 ? 'match' : 'matches';
  const winsLossesPart =
    summary.wins + summary.losses === 0
      ? null
      : `${summary.wins} win${summary.wins === 1 ? '' : 's'}, ${summary.losses} loss${
          summary.losses === 1 ? '' : 'es'
        }`;
  const streakPart = summary.streak >= 2 ? `longest streak ${summary.streak}` : null;
  return [`${count} saved ${matchWord}`, winsLossesPart, streakPart]
    .filter((s): s is string => s !== null)
    .join(' · ');
}

// ─── Auto-record ribbon ────────────────────────────────────────────

function AutoRecordRibbon({
  enabled,
  onToggle,
}: {
  enabled: boolean;
  onToggle: () => void;
}) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityLabel={`Auto-record replays: ${enabled ? 'on' : 'off'}`}
      style={({ pressed }) => ({
        marginHorizontal: 20,
        marginBottom: 8,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderRadius: 12,
        backgroundColor: pressed ? COLORS.creamLow : COLORS.paperHi,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        boxShadow: '0px 2px 6px rgba(0,0,0,0.04)',
      })}
    >
      <View
        style={{
          width: 34,
          height: 18,
          borderRadius: 9,
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
            width: 14,
            height: 14,
            borderRadius: 7,
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
            ? 'On — saves every match on teardown. Oldest replays prune past quota.'
            : 'Off — save matches manually from the in-match menu.'}
        </Text>
      </View>
    </Pressable>
  );
}

// ─── Empty state ───────────────────────────────────────────────────

function EmptyState() {
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 6 }}>
      <Text style={{ fontSize: 12, color: COLORS.ink3, fontWeight: '600', lineHeight: 18 }}>
        Hit "Save this match" from the in-match menu, or flip auto-record on so every match records
        automatically.
      </Text>
    </View>
  );
}

// ─── Section ───────────────────────────────────────────────────────

function Section({
  group,
  children,
}: {
  group: DateGroup;
  children: React.ReactNode;
}) {
  const matchWord = group.headers.length === 1 ? 'match' : 'matches';
  return (
    <View style={{ paddingHorizontal: 20, paddingTop: 6 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'baseline',
          gap: 10,
          paddingTop: 14,
          paddingBottom: 8,
        }}
      >
        <Text
          style={{
            fontFamily: 'Noto Serif TC',
            fontStyle: 'italic',
            fontWeight: '700',
            fontSize: 14,
            color: COLORS.red,
          }}
        >
          {group.cn}
        </Text>
        <Text
          style={{
            fontSize: 10,
            fontWeight: '900',
            letterSpacing: 1.6,
            color: COLORS.ink3,
          }}
        >
          {group.en}
        </Text>
        <View style={{ flex: 1, height: 1, backgroundColor: COLORS.hairline, opacity: 0.5 }} />
        <Text
          style={{
            fontSize: 10,
            fontWeight: '900',
            letterSpacing: 1.6,
            color: COLORS.ink3,
          }}
        >
          {group.headers.length} {matchWord.toUpperCase()}
        </Text>
      </View>
      {children}
    </View>
  );
}

// ─── Match row ─────────────────────────────────────────────────────

const JOIN_BADGE: Record<ReplayHeader['joinKind'], { label: string; fg: string; bg: string }> = {
  online: { label: 'ONLINE', fg: '#735aa3', bg: '#e1d3ed' },
  solo: { label: 'SOLO', fg: COLORS.ink2, bg: COLORS.creamLow },
  lan: { label: 'LAN', fg: '#2d8645', bg: '#c2e2c5' },
};

const WIN_BADGE = {
  fg: '#9a6e0e',
  bg: '#fff5dc',
  edge: '#e2c587',
};

function ReplayRow({
  header,
  onOpen,
  onDeleted,
}: {
  header: ReplayHeader;
  onOpen: () => void;
  onDeleted: () => void;
}) {
  const winner = winnerOf(header);
  const localWon = winner.seat === header.localSeat;
  const badge = JOIN_BADGE[header.joinKind];
  const dateLabel = new Date(header.startedAt).toLocaleString();
  const durationLabel = formatDuration(header.durationMs);
  const positions = useMemo(() => positionMapFor(header.localSeat), [header.localSeat]);

  const onDelete = () => {
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (!window.confirm('Delete this replay?')) return;
    }
    deleteRecord(header.id);
    onDeleted();
  };

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Open replay from ${dateLabel}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        gap: 18,
        alignItems: 'stretch',
        padding: 14,
        marginBottom: 10,
        borderRadius: 14,
        backgroundColor: pressed ? COLORS.creamLow : COLORS.paperHi,
        borderColor: localWon ? WIN_BADGE.edge : COLORS.hairline,
        borderWidth: 1,
        boxShadow: '0px 2px 6px rgba(0,0,0,0.04)',
      })}
    >
      <View
        style={{
          width: 64,
          flexShrink: 0,
          alignItems: 'center',
          gap: 6,
        }}
      >
        <WindEmblem wind={SEAT_WIND_GLYPH[winner.seat]} size={40} />
        {localWon ? (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 3,
              backgroundColor: WIN_BADGE.bg,
              borderColor: WIN_BADGE.edge,
              borderWidth: 1,
              paddingHorizontal: 5,
              paddingVertical: 1,
              borderRadius: 4,
            }}
          >
            <Text
              style={{
                fontSize: 9,
                fontWeight: '900',
                color: WIN_BADGE.fg,
                letterSpacing: 0.4,
              }}
            >
              ★ WON
            </Text>
          </View>
        ) : null}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <View
            style={{
              backgroundColor: badge.bg,
              paddingHorizontal: 7,
              paddingVertical: 2,
              borderRadius: 4,
            }}
          >
            <Text
              style={{
                fontSize: 9,
                fontWeight: '900',
                letterSpacing: 0.6,
                color: badge.fg,
              }}
            >
              {badge.label}
            </Text>
          </View>
          <Text style={{ fontSize: 13, fontWeight: '900', color: COLORS.ink }}>{dateLabel}</Text>
          <View style={{ flex: 1 }} />
          <Text
            style={{
              fontSize: 11,
              fontWeight: '600',
              color: COLORS.ink3,
              letterSpacing: 0.2,
            }}
          >
            {header.handsPlayed} hand{header.handsPlayed === 1 ? '' : 's'} · {durationLabel}
          </Text>
        </View>
        <View
          style={{
            flexDirection: 'row',
            gap: 6,
            flexWrap: 'wrap',
          }}
        >
          {SEATS.map((seat) => (
            <ScoreChip
              key={seat}
              seat={seat}
              header={header}
              position={positions[seat]}
              isWinner={seat === winner.seat}
            />
          ))}
        </View>
      </View>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
        }}
      >
        <Pressable
          onPress={onDelete}
          accessibilityLabel="Delete replay"
          hitSlop={6}
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
        <View
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            backgroundColor: COLORS.creamLow,
            borderColor: COLORS.hairline,
            borderWidth: 1,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ fontSize: 14, fontWeight: '800', color: COLORS.ink2 }}>›</Text>
        </View>
      </View>
    </Pressable>
  );
}

function ScoreChip({
  seat,
  header,
  position,
  isWinner,
}: {
  seat: Seat;
  header: ReplayHeader;
  position: Position;
  isWinner: boolean;
}) {
  const player = header.players[seat];
  const score = header.finalScoreboard[seat] ?? 0;
  const isYou = header.localSeat === seat;
  const name = player?.displayName ?? `Seat ${seat}`;
  const sign = score >= 0 ? '+' : '';
  const seatColor = SEAT_COLOR[position];
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 7,
        backgroundColor: isWinner ? seatColor : COLORS.creamLow,
        borderColor: isWinner ? seatColor : COLORS.hairline,
        borderWidth: 1,
      }}
    >
      <Text
        style={{
          fontFamily: 'Noto Serif TC',
          fontWeight: '700',
          fontSize: 13,
          lineHeight: 13,
          color: isWinner ? 'white' : COLORS.red,
        }}
      >
        {SEAT_WIND_GLYPH[seat]}
      </Text>
      <Text
        style={{
          fontSize: 11,
          fontWeight: '800',
          letterSpacing: 0.2,
          color: isWinner ? 'white' : COLORS.ink2,
        }}
        numberOfLines={1}
      >
        {isYou ? `${name} (you)` : name}
      </Text>
      <View
        style={{
          paddingHorizontal: 5,
          paddingVertical: 1,
          borderRadius: 4,
          backgroundColor: isWinner ? 'rgba(255,255,255,0.25)' : 'white',
        }}
      >
        <Text
          style={{
            fontFamily: 'Courier',
            fontWeight: '800',
            fontSize: 10,
            color: isWinner ? 'white' : score >= 0 ? SUCCESS_PILL.fg : COLORS.red,
          }}
        >
          {sign}
          {score}
        </Text>
      </View>
    </View>
  );
}

// ─── Helpers ───────────────────────────────────────────────────────

interface DateGroup {
  id: 'TODAY' | 'YESTERDAY' | 'THIS_WEEK' | 'EARLIER';
  cn: string;
  en: string;
  headers: ReplayHeader[];
}

const GROUP_ORDER: DateGroup['id'][] = ['TODAY', 'YESTERDAY', 'THIS_WEEK', 'EARLIER'];
const GROUP_CN: Record<DateGroup['id'], string> = {
  TODAY: '今日',
  YESTERDAY: '昨天',
  THIS_WEEK: '本週',
  EARLIER: '以前',
};

function groupByDate(headers: readonly ReplayHeader[]): DateGroup[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const buckets: Record<DateGroup['id'], ReplayHeader[]> = {
    TODAY: [],
    YESTERDAY: [],
    THIS_WEEK: [],
    EARLIER: [],
  };
  for (const h of headers) {
    const d = new Date(h.startedAt);
    const dayStart = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const days = Math.round((today - dayStart) / 86_400_000);
    let id: DateGroup['id'];
    if (days <= 0) id = 'TODAY';
    else if (days === 1) id = 'YESTERDAY';
    else if (days <= 6) id = 'THIS_WEEK';
    else id = 'EARLIER';
    buckets[id].push(h);
  }
  return GROUP_ORDER.map((id) => ({
    id,
    cn: GROUP_CN[id],
    en: id.replace('_', ' '),
    headers: buckets[id],
  }));
}

function winnerOf(header: ReplayHeader): { seat: Seat; score: number } {
  let bestSeat: Seat = 0;
  let bestScore = header.finalScoreboard[0] ?? 0;
  for (const seat of SEATS) {
    const score = header.finalScoreboard[seat] ?? 0;
    if (score > bestScore) {
      bestSeat = seat;
      bestScore = score;
    }
  }
  return { seat: bestSeat, score: bestScore };
}

const POSITION_CYCLE: readonly Position[] = ['bottom', 'right', 'top', 'left'];
function positionMapFor(localSeat: Seat | 'spectator'): Record<Seat, Position> {
  const anchor: Seat = localSeat !== 'spectator' ? localSeat : 0;
  return {
    0: POSITION_CYCLE[(0 - anchor + 4) % 4]!,
    1: POSITION_CYCLE[(1 - anchor + 4) % 4]!,
    2: POSITION_CYCLE[(2 - anchor + 4) % 4]!,
    3: POSITION_CYCLE[(3 - anchor + 4) % 4]!,
  };
}

function summarise(headers: readonly ReplayHeader[]): {
  wins: number;
  losses: number;
  streak: number;
} {
  let wins = 0;
  let losses = 0;
  let bestStreak = 0;
  let currentStreak = 0;
  // headers come back from listHeaders() most-recent-first; walk in
  // chronological order so the streak counter counts consecutive wins.
  const chrono = [...headers].reverse();
  for (const h of chrono) {
    if (h.localSeat === 'spectator') continue;
    const winner = winnerOf(h);
    if (winner.seat === h.localSeat) {
      wins++;
      currentStreak++;
      if (currentStreak > bestStreak) bestStreak = currentStreak;
    } else {
      losses++;
      currentStreak = 0;
    }
  }
  return { wins, losses, streak: bestStreak };
}

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}
