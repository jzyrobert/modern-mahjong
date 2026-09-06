import { SEATS, type Seat } from '@mahjong/game-logic';
import type { Tile as MTile } from '@mahjong/game-logic';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { deleteRecord, listHeaders } from '../../replay/storage';
import type { ReplayHeader } from '../../replay/types';
import { winnerOf } from '../../replay/winner';
import { useGame } from '../../state/game';
import { ReplayShelf3D } from '../../three/entry';
import { hasWebGL2, resolveRenderer } from '../../three/renderer';
import { Tile } from '../Tile';
import { type Position, SEAT_COLOR } from '../match/seatColor';
import { GlassCard } from '../menu/GlassCard';
import { LobbyBackdrop } from '../menu/LobbyBackdrop';
import { GlassButton, GoldButton, Pill } from '../menu/MenuButtons';
import { Reveal } from '../menu/Reveal';
import { WindEmblem } from '../menu/WindEmblem';
import { ChevronLeftIcon, ImportIcon, PlayIcon, TrashIcon } from '../menu/icons';
import { HOVER_TRANSITION, MENU, TYPE, glass, heading } from '../menu/theme';
import { SEAT_WIND_GLYPH } from '../winds';
import { ConfirmDeleteSheet } from './ConfirmDeleteSheet';
import { ReplayImportModal } from './ReplayImportModal';
import { summarise, summaryLine } from './summary';

/**
 * Replay library — the lobby's dark-glass theme without the 3D scene.
 * Each saved match is a glass row anchored by the winner's wind-emblem
 * tile with seat-coloured score chips and a gold ★ WON pin when the
 * local seat carried the match. Rows group into bilingual date
 * sections (`今日 · TODAY`, `以前 · EARLIER`, …).
 *
 * No new state — `listHeaders()` / `deleteRecord()` are the same
 * storage hooks the previous list used. Accessible names are kept for
 * the replay specs: heading "Replays", "← Lobby", "Import replays",
 * the `Auto-record replays: on|off` switch, `Open replay from <date>`
 * rows, "Delete replay", and the SOLO / ONLINE / LAN badges.
 */
export function ReplayLibrary() {
  const router = useRouter();
  const [headers, setHeaders] = useState<readonly ReplayHeader[]>(() => listHeaders());
  const [importOpen, setImportOpen] = useState(false);
  const autoRecord = useGame((s) => s.settings.autoRecordReplays);
  const setSettings = useGame((s) => s.setSettings);
  const { height } = useWindowDimensions();

  const refresh = useCallback(() => setHeaders(listHeaders()), []);
  const onOpenReplay = (id: string) => {
    router.push(`/replays/${id}`);
  };

  const groups = useMemo(() => groupByDate(headers), [headers]);
  const summary = useMemo(() => summarise(headers), [headers]);
  const empty = headers.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: MENU.void0 }}>
      {/* Empty shelf: no scattered backs (the shelf illustration is the
          focal object) and the warm glow aims at the centred card. */}
      <LobbyBackdrop scene={false} backs={!empty} glow={empty ? EMPTY_GLOW : undefined} />
      <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }} edges={['top', 'bottom']}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            paddingBottom: empty ? 28 : 60,
            maxWidth: 960,
            width: '100%',
            alignSelf: 'center',
            // Lets the empty state centre itself in whatever is left
            // under the header + ribbon instead of leaving a void.
            flexGrow: 1,
          }}
          showsVerticalScrollIndicator={false}
        >
          <Hero
            count={headers.length}
            summary={summary}
            onBack={() => router.replace('/')}
            onImport={() => setImportOpen(true)}
          />
          <Reveal index={0} style={{ paddingHorizontal: 20 }}>
            <AutoRecordRibbon
              enabled={autoRecord}
              onToggle={() => setSettings({ autoRecordReplays: !autoRecord })}
            />
          </Reveal>
          {empty ? (
            <View
              style={{
                flex: 1,
                justifyContent: 'center',
                paddingHorizontal: 20,
                // A focal card at the optical centre (a little above the
                // geometric middle) of the space under the ribbon, with
                // the parlour gradient showing around it. (A card that
                // filled the phone column was a full-height slab with
                // the scene a third of the way down and 200 px of dead
                // glass under the button.)
                paddingBottom: Math.round(height * 0.1),
              }}
            >
              <Reveal index={1}>
                <EmptyState onImport={() => setImportOpen(true)} />
              </Reveal>
            </View>
          ) : (
            groups.map((g, gi) =>
              g.headers.length === 0 ? null : (
                <Reveal key={g.id} index={gi + 1} style={{ paddingHorizontal: 20 }}>
                  <Section group={g}>
                    {g.headers.map((h) => (
                      <ReplayRow
                        key={h.id}
                        header={h}
                        onOpen={() => onOpenReplay(h.id)}
                        onDeleted={refresh}
                      />
                    ))}
                  </Section>
                </Reveal>
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

const HERO_PHONE_BREAKPOINT = 480;
/**
 * Width of the top-right strip the root FULLSCREEN / DISMISS chip
 * occupies on landscape phones: the glass pill (`FullscreenPrompt`,
 * 12 px pads + glyph + 10 px / 1.6-tracked label ≈ 124 px) plus its
 * 8 px margin, plus a 12 px gap — so the Import button's right edge
 * sits 12 px left of the chip instead of parked at a 236 px band.
 */
const CHIP_STRIP_W = 124 + 8 + 12;
/** Glow centre behind the centred empty-state card. */
const EMPTY_GLOW = { x: 0.5, y: 0.55 };

function Hero({
  count,
  summary,
  onBack,
  onImport,
}: {
  count: number;
  summary: { wins: number; losses: number; draws: number; streak: number };
  onBack: () => void;
  onImport: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const phone = width <= HERO_PHONE_BREAKPOINT;
  // Landscape phones (web) show the root FULLSCREEN / DISMISS chip in
  // the top-right corner (`FullscreenPrompt`: landscape && height <
  // 600). Leave that strip free instead of pushing the whole header
  // down — the Import button slides left of it and the row keeps its
  // normal top padding.
  const chipStrip = Platform.OS === 'web' && width > height && height < 600 ? CHIP_STRIP_W : 0;
  const title = (
    <View style={{ flex: 1, minWidth: 0, gap: 6 }}>
      <Text style={[TYPE.label, { color: MENU.gold }]}>Library</Text>
      <Text accessibilityRole="header" style={heading(phone ? 34 : 44)}>
        Replays
      </Text>
      <Text style={TYPE.body}>{summaryLine(count, summary)}</Text>
    </View>
  );
  // Icon + "Lobby"; the accessible name keeps the legacy "← Lobby".
  const back = (
    <GlassButton
      size="sm"
      onPress={onBack}
      accessibilityLabel="← Lobby"
      icon={<ChevronLeftIcon size={10} color={MENU.text2} />}
    >
      Lobby
    </GlassButton>
  );
  const importBtn = (
    <GoldButton
      onPress={onImport}
      size={phone ? 'md' : 'lg'}
      full={phone}
      icon={<ImportIcon size={16} color={MENU.goldInk} />}
    >
      Import replays
    </GoldButton>
  );

  if (phone) {
    return (
      <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 14, gap: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {back}
          <View style={{ flex: 1 }}>{importBtn}</View>
        </View>
        {title}
      </View>
    );
  }
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 18,
        paddingHorizontal: 20,
        paddingRight: chipStrip || 20,
        paddingTop: chipStrip ? 12 : 24,
        paddingBottom: 18,
      }}
    >
      {back}
      {title}
      <View style={{ minWidth: 200 }}>{importBtn}</View>
    </View>
  );
}

// ─── Auto-record ribbon ────────────────────────────────────────────

function AutoRecordRibbon({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="switch"
      accessibilityLabel={`Auto-record replays: ${enabled ? 'on' : 'off'}`}
      style={({ pressed }) => ({
        ...glass({ quiet: true, radius: 14 }),
        marginBottom: 6,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        ...(pressed ? { backgroundColor: 'rgba(24,34,28,0.7)' } : {}),
      })}
    >
      <View
        style={{
          width: 38,
          height: 22,
          borderRadius: 999,
          backgroundColor: enabled ? MENU.gold : MENU.fill,
          borderColor: enabled ? MENU.goldEdge : MENU.hairline,
          borderWidth: 1,
          padding: 2,
          flexDirection: 'row',
          justifyContent: enabled ? 'flex-end' : 'flex-start',
          ...HOVER_TRANSITION,
        }}
      >
        <View
          style={{
            width: 16,
            height: 16,
            borderRadius: 999,
            backgroundColor: enabled ? MENU.goldInk : MENU.text2,
          }}
        />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ fontSize: 13, fontWeight: '800', color: MENU.text }}>
          Auto-record every match
        </Text>
        <Text style={[TYPE.small, { marginTop: 2 }]}>
          {enabled
            ? 'On — saves every match on teardown. Oldest replays prune past quota.'
            : 'Off — save matches manually from the in-match menu.'}
        </Text>
      </View>
    </Pressable>
  );
}

// ─── Empty state ───────────────────────────────────────────────────

function EmptyState({ onImport }: { onImport: () => void }) {
  const { width, height } = useWindowDimensions();
  const rendererSetting = useGame((s) => s.settings.renderer);
  // Under the 3D renderer the shelf is a real scene (`ReplayShelf3D`)
  // so no classic flat tile art sits inside the 3D flow; classic and
  // native keep the SVG / `Tile` illustration.
  const shelf3d =
    Platform.OS === 'web' &&
    ReplayShelf3D !== null &&
    resolveRenderer(rendererSetting) === '3d' &&
    hasWebGL2();
  // Landscape phones are wide but short — keep the compact card there.
  const wide = width > 720 && height >= 600;
  // Phones: as wide as the card's content box allows (the 3D shelf
  // canvas is 8.6 tile widths across; 20 px card + 20 px page inset
  // each side), so the tiles are the card's focal object.
  const tileWidth = wide ? 44 : Math.max(30, Math.min(44, Math.floor((width - 80) / 8.6)));
  return (
    <GlassCard
      hover={false}
      style={{
        paddingHorizontal: wide ? 32 : 20,
        paddingTop: wide ? 26 : 18,
        paddingBottom: wide ? 26 : 20,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        marginTop: 8,
        // A focal object, not a full-width band, on wide viewports.
        maxWidth: wide ? 620 : undefined,
        width: '100%',
        alignSelf: 'center',
      }}
    >
      {shelf3d && ReplayShelf3D ? (
        <ReplayShelf3D tileWidth={tileWidth} />
      ) : (
        <ShelfIllustration tileWidth={tileWidth} />
      )}
      <Text style={{ fontSize: wide ? 18 : 16, fontWeight: '800', color: MENU.text }}>
        Nothing on the shelf yet
      </Text>
      <Text style={[TYPE.body, { textAlign: 'center', maxWidth: 420 }]}>
        Hit "Save this match" from the in-match menu, or flip auto-record on so every match records
        automatically. Replays can also be pasted in from another device.
      </Text>
      <GlassButton size="sm" onPress={onImport} icon={<ImportIcon size={14} color={MENU.text2} />}>
        Paste a replay
      </GlassButton>
    </GlassCard>
  );
}

// Placeholder for face-down tiles — only the back skin paints.
const SHELF_BACK: MTile = { kind: 'suit', suit: 'man', rank: 1, copy: 0 };
const SHELF_WINDS = ['東', '南', '西'] as const;

/**
 * The "empty shelf": a shallow arc of seven tiles resting on a soft
 * shadow pool — dim face-down backs at the ends, the three wind
 * emblems face-up in the middle. Pure decoration.
 */
function ShelfIllustration({ tileWidth }: { tileWidth: number }) {
  const tileHeight = Math.round(tileWidth * 1.32);
  const slots = [-3, -2, -1, 0, 1, 2, 3];
  return (
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'flex-end',
        height: tileHeight + 26,
        width: '100%',
        marginBottom: 2,
      }}
    >
      <View
        style={{
          position: 'absolute',
          bottom: 4,
          width: tileWidth * 6.2,
          height: tileHeight * 0.4,
          borderRadius: 999,
          backgroundColor: 'rgba(0,0,0,0.34)',
          boxShadow: '0px 6px 30px 18px rgba(0,0,0,0.34)',
        }}
      />
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 5 }}>
        {slots.map((u) => {
          const wind = SHELF_WINDS[u + 1];
          const lift = u * u * 2.2;
          if (wind) {
            return (
              <View key={u} style={{ marginBottom: lift, transform: [{ rotate: `${u * 5}deg` }] }}>
                <WindEmblem wind={wind} size={tileWidth} />
              </View>
            );
          }
          const outer = Math.abs(u) === 3;
          return (
            <View key={u} style={{ marginBottom: lift, opacity: outer ? 0.5 : 0.72 }}>
              <Tile
                tile={SHELF_BACK}
                faceDown
                width={tileWidth}
                height={tileHeight}
                rotate={u * 5}
              />
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─── Section ───────────────────────────────────────────────────────

function Section({ group, children }: { group: DateGroup; children: React.ReactNode }) {
  const matchWord = group.headers.length === 1 ? 'match' : 'matches';
  return (
    <View style={{ paddingTop: 6 }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'baseline',
          gap: 10,
          paddingTop: 14,
          paddingBottom: 8,
        }}
      >
        <Text style={[TYPE.serif, { fontSize: 15, color: MENU.goldHi }]}>{group.cn}</Text>
        <Text style={[TYPE.label, { fontSize: 10, letterSpacing: 1.8 }]}>{group.en}</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: MENU.hairlineSoft }} />
        <Text style={[TYPE.label, { fontSize: 10, letterSpacing: 1.8, color: MENU.text3 }]}>
          {group.headers.length} {matchWord}
        </Text>
      </View>
      {children}
    </View>
  );
}

// ─── Match row ─────────────────────────────────────────────────────

const JOIN_BADGE: Record<
  ReplayHeader['joinKind'],
  { label: string; tone: 'gold' | 'neutral' | 'success' }
> = {
  online: { label: 'ONLINE', tone: 'gold' },
  solo: { label: 'SOLO', tone: 'neutral' },
  lan: { label: 'LAN', tone: 'success' },
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
  const localWon = winner !== null && winner.seat === header.localSeat;
  const isDraw = winner === null;
  const badge = JOIN_BADGE[header.joinKind];
  const dateLabel = new Date(header.startedAt).toLocaleString();
  const durationLabel = formatDuration(header.durationMs);
  const positions = useMemo(() => positionMapFor(header.localSeat), [header.localSeat]);
  const [hovered, setHovered] = useState(false);
  const { width } = useWindowDimensions();
  const narrow = width < 560;

  const [confirmDelete, setConfirmDelete] = useState(false);
  const onDelete = () => setConfirmDelete(true);
  const doDelete = () => {
    setConfirmDelete(false);
    deleteRecord(header.id);
    onDeleted();
  };

  return (
    <>
      <ConfirmDeleteSheet
        open={confirmDelete}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={doDelete}
      />
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`Open replay from ${dateLabel}`}
        onHoverIn={() => setHovered(true)}
        onHoverOut={() => setHovered(false)}
        style={({ pressed }) => ({
          ...glass({ radius: 16 }),
          borderColor: localWon ? MENU.goldEdge : MENU.hairline,
          flexDirection: 'row',
          gap: 14,
          alignItems: 'stretch',
          padding: 14,
          marginBottom: 10,
          ...(pressed ? { backgroundColor: 'rgba(24,34,28,0.75)' } : {}),
          ...HOVER_TRANSITION,
          transform: [{ translateY: hovered && !pressed ? -2 : 0 }, { scale: pressed ? 0.99 : 1 }],
        })}
      >
        <View style={{ width: 60, flexShrink: 0, alignItems: 'center', gap: 6 }}>
          {winner ? (
            <WindEmblem wind={SEAT_WIND_GLYPH[winner.seat]} size={38} />
          ) : (
            <View
              style={{
                width: 38,
                height: 38 * 1.32,
                borderRadius: 6,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: MENU.fill,
                borderColor: MENU.hairline,
                borderWidth: 1,
              }}
            >
              <Text style={{ fontSize: 20, fontWeight: '800', color: MENU.text4 }}>—</Text>
            </View>
          )}
          {localWon ? <Pill tone="gold">★ WON</Pill> : isDraw ? <Pill>DRAW</Pill> : null}
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <Pill tone={badge.tone}>{badge.label}</Pill>
            <Text style={{ fontSize: 13, fontWeight: '800', color: MENU.text }}>{dateLabel}</Text>
            <View style={{ flex: 1 }} />
            <Text style={TYPE.small}>
              {header.handsPlayed} hand{header.handsPlayed === 1 ? '' : 's'} · {durationLabel}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            {SEATS.map((seat) => (
              <ScoreChip
                key={seat}
                seat={seat}
                header={header}
                position={positions[seat]}
                isWinner={winner !== null && seat === winner.seat}
              />
            ))}
          </View>
        </View>
        <View
          style={{
            flexDirection: narrow ? 'column' : 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            flexShrink: 0,
          }}
        >
          <Pressable
            onPress={onDelete}
            accessibilityRole="button"
            accessibilityLabel="Delete replay"
            hitSlop={6}
            style={({ pressed }) => ({
              width: 32,
              height: 32,
              borderRadius: 999,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: pressed ? MENU.redEdge : MENU.hairlineSoft,
              backgroundColor: pressed ? MENU.redTint : 'transparent',
            })}
          >
            <TrashIcon size={14} color={MENU.text3} />
          </Pressable>
          <View
            style={{
              width: 32,
              height: 32,
              borderRadius: 999,
              backgroundColor: MENU.goldTint,
              borderColor: MENU.goldEdge,
              borderWidth: 1,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <PlayIcon size={14} color={MENU.goldHi} />
          </View>
        </View>
      </Pressable>
    </>
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
        gap: 6,
        paddingHorizontal: 8,
        paddingVertical: 4,
        borderRadius: 999,
        backgroundColor: isWinner ? seatColor : MENU.fill,
        borderColor: isWinner ? seatColor : MENU.hairlineSoft,
        borderWidth: 1,
      }}
    >
      <Text
        style={[
          TYPE.serif,
          { fontSize: 13, lineHeight: 14, color: isWinner ? 'white' : MENU.goldHi },
        ]}
      >
        {SEAT_WIND_GLYPH[seat]}
      </Text>
      <Text
        style={{
          fontSize: 11,
          fontWeight: '800',
          letterSpacing: 0.2,
          color: isWinner ? 'white' : MENU.text2,
        }}
        numberOfLines={1}
      >
        {isYou ? `${name} (you)` : name}
      </Text>
      <Text
        style={[
          TYPE.mono,
          {
            fontWeight: '800',
            fontSize: 10,
            color: isWinner ? 'white' : score >= 0 ? '#7fd6a3' : '#e59a8b',
          },
        ]}
      >
        {sign}
        {score}
      </Text>
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

function formatDuration(ms: number): string {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}
