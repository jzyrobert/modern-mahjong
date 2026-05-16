import { useTransport } from '@/src/net/transport-context';
import { SEATS, type Seat } from '@mahjong/game-logic';
import { BOT_LABELS, generateMatchCode } from '@mahjong/protocol';
import { useRouter } from 'expo-router';
import { type ReactNode, useEffect, useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDisplayName, setDisplayName } from '../../identity';
import {
  isLanServerAvailable,
  advertise as lanAdvertise,
  start as lanStart,
  stop as lanStop,
  unadvertise as lanUnadvertise,
} from '../../native/lan-server';
import { startLanHostBridge, stopLanHostBridge } from '../../net/lan-host-bridge';
import { listHeaders } from '../../replay/storage';
import type { ReplayHeader } from '../../replay/types';
import { useGame } from '../../state/game';
import { LESSONS, LESSON_ORDER } from '../../state/tutorial';
import { BrowseLobbyModal } from '../BrowseLobbyModal';
import { JoinLanModal } from '../JoinLanModal';
import { Modal } from '../Modal';
import { COLORS as SHARED_COLORS } from '../colors';
import { LobbyPreview } from './LobbyPreview';
import { WindEmblem } from './WindEmblem';
import { BotIcon, BoxIcon, GlobeIcon, PlayIcon, TutorialIcon, WifiIcon } from './icons';

/**
 * Mobile-only lobby — replaces the legacy `<Lobby>`'s hero + 280-px
 * `ModeGrid` cards with a denser app-bar-led layout that fits the
 * primary actions (Online + Practice) above the iPhone-SE fold
 * (~568 px viewport height) without scrolling.
 *
 * Dispatched from `Lobby.tsx` when `Math.min(width, height) <= 480` so
 * both portrait (393×852-ish) and landscape (852×393-ish) phones land
 * here; wider viewports keep the existing desktop layout.
 *
 * Visual spec lives in the design handoff zip (lobby-mobile-v2.jsx +
 * README) — every dimension, colour, and typography choice traces
 * back there. Helpers (AppBar / SecondaryRow / Tutorial+LAN sheet
 * pair) all live in this one file: they're shared only within this
 * component and splitting would add file-count without simplifying
 * review.
 *
 * Live state — `code`, `name`, `lobby`, `tutorialsCompleted`,
 * `replayCount`, `hostStatus` — mirrors `Lobby.tsx` so the existing
 * `useTransport()` integration carries over unchanged.
 */

// Embedded LAN server port — kept in sync with Lobby.tsx.
const HOST_PORT = 7777;

const COLORS = {
  ...SHARED_COLORS,
  // Avatar square colour from the design tokens (not in the shared
  // palette since only the identity pill uses it).
  avatarBg: '#c66b58',
  // Accent border for the Online card — slightly hotter than the
  // salmon edge so it reads from across the row.
  accentBorder: '#ec9275',
  // Neutral icon-swatch background for non-accent cards.
  neutralSwatch: '#ede5d3',
};

interface MobileLobbyProps {
  /** When false the parent `<Lobby>` rendered the desktop layout
   *  instead. Kept as a single prop so the parent owns viewport
   *  classification and this component stays presentational. */
  isLandscape: boolean;
}

export function MobileLobby({ isLandscape }: MobileLobbyProps) {
  const router = useRouter();
  const transport = useTransport();
  const lobby = useGame((s) => s.lobby);
  const tutorialsCompleted = useGame((s) => s.settings.tutorialsCompleted);
  const completedCount = LESSON_ORDER.reduce(
    (acc, id) => acc + (tutorialsCompleted.includes(id) ? 1 : 0),
    0,
  );
  const [name, setName] = useState(() => getDisplayName());
  const [code, setCode] = useState('');
  const [hostStatus, setHostStatus] = useState<null | 'starting' | string>(null);
  const [joinLanOpen, setJoinLanOpen] = useState(false);
  const [browseLobbiesOpen, setBrowseLobbiesOpen] = useState(false);
  const [headers, setHeaders] = useState<readonly ReplayHeader[]>([]);
  // Inline-expanded row identity (portrait only) — landscape uses
  // modal sheets via `openSheet` because the inline expansion is
  // taller than a 393-px landscape viewport.
  const [expandedRow, setExpandedRow] = useState<'tutorial' | 'lan' | null>(null);
  const [openSheet, setOpenSheet] = useState<'tutorial' | 'lan' | null>(null);

  useEffect(() => {
    setHeaders(listHeaders());
  }, []);

  const canHostLan = Platform.OS !== 'web' && isLanServerAvailable();

  // Host handler — identical to `Lobby.tsx`. Kept inline since
  // duplicating it is cheaper than extracting a shared module that
  // both lobbies pull from (the legacy one is going away once this
  // ships everywhere, but until then the redesign and the desktop
  // path can diverge cleanly).
  const onHostLan = async () => {
    if (hostStatus === 'starting') return;
    setHostStatus('starting');
    try {
      stopLanHostBridge();
      await lanUnadvertise().catch((err) =>
        console.warn('MobileLobby.onHostLan: lanUnadvertise failed', err),
      );
      await lanStop().catch((err) =>
        console.warn('MobileLobby.onHostLan: lanStop (pre-start) failed', err),
      );
      const res = await lanStart({ port: HOST_PORT });
      const hostUrl = res.addresses[0];
      if (!hostUrl) {
        await lanStop().catch((err) =>
          console.warn('MobileLobby.onHostLan: lanStop (rollback) failed', err),
        );
        setHostStatus('No LAN address found — are you on Wi-Fi?');
        return;
      }
      startLanHostBridge();
      const serviceName = getDisplayName() || 'Modern Mahjong host';
      lanAdvertise({ serviceName, port: res.port }).catch((err) =>
        console.warn('MobileLobby.onHostLan: lanAdvertise failed', err),
      );
      const matchCode = generateMatchCode();
      transport.joinLan(hostUrl, matchCode);
      setHostStatus(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setHostStatus(`Couldn't start the embedded server: ${msg}`);
    }
  };

  const onToggleTutorial = () => {
    if (isLandscape) {
      setOpenSheet((s) => (s === 'tutorial' ? null : 'tutorial'));
    } else {
      setExpandedRow((r) => (r === 'tutorial' ? null : 'tutorial'));
    }
  };
  const onToggleLan = () => {
    if (isLandscape) {
      setOpenSheet((s) => (s === 'lan' ? null : 'lan'));
    } else {
      setExpandedRow((r) => (r === 'lan' ? null : 'lan'));
    }
  };

  const replaySummary = summariseReplays(headers);
  const replaySubtitle = replaySubtitleFor(
    headers.length,
    replaySummary.wins,
    replaySummary.streak,
    isLandscape,
  );
  const tutorialSubtitle = `${completedCount}/${LESSON_ORDER.length} lessons · tap to start`;
  const lanSubtitle = isLandscape ? 'Same Wi-Fi' : 'Same Wi-Fi · no accounts';

  // Tutorial card / sheet body — same lesson list either way, so
  // factor it once and reuse.
  const tutorialBody = (
    <View style={{ gap: 4 }}>
      {LESSON_ORDER.map((id) => {
        const lesson = LESSONS[id];
        if (!lesson) return null;
        const done = tutorialsCompleted.includes(id);
        return (
          <LessonRow
            key={id}
            title={lesson.title}
            blurb={lesson.blurb}
            done={done}
            onPress={() => {
              setOpenSheet(null);
              setExpandedRow(null);
              transport.joinSoloTutorial(id);
            }}
          />
        );
      })}
    </View>
  );

  // LAN card / sheet body.
  const lanBody = (
    <>
      <Text style={{ fontSize: 12, color: COLORS.ink3, fontWeight: '600', lineHeight: 18 }}>
        Four-player matches over local Wi-Fi. Host shares a URL; guests paste it into any browser on
        the same network.
      </Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: COLORS.creamLow,
          borderColor: COLORS.hairline,
          borderWidth: 1,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 8,
        }}
      >
        <BoxIcon color={COLORS.ink3} />
        <Text style={{ flex: 1, fontSize: 11, color: COLORS.ink3, fontWeight: '600' }}>
          Works offline. No accounts. No data leaves your network.
        </Text>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {canHostLan ? (
          <CompactPrimary
            onPress={onHostLan}
            disabled={hostStatus === 'starting'}
            label={hostStatus === 'starting' ? 'Starting host…' : 'Host LAN match'}
          />
        ) : null}
        <CompactGhost onPress={() => setJoinLanOpen(true)} label="Join LAN match" />
      </View>
      {typeof hostStatus === 'string' && hostStatus !== 'starting' ? (
        <Text style={{ fontSize: 12, color: COLORS.red, fontWeight: '700', lineHeight: 16 }}>
          {hostStatus}
        </Text>
      ) : null}
    </>
  );

  const onlineCard = (
    <PrimaryModeCard
      accent
      title="Online match"
      subtitle="Play with friends over the internet"
      icon={<GlobeIcon color={COLORS.red} size={18} />}
      badge="RECOMMENDED"
    >
      <View>
        <Text style={[fieldLabelStyle, { marginBottom: 4 }]}>MATCH CODE</Text>
        <MatchCodeInput value={code} onChangeText={(v) => setCode(v.toUpperCase())} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <CompactPrimary
          label="Join match"
          onPress={() => code && transport.joinOnline(code)}
          disabled={code.length !== 5}
        />
        <CompactGhost
          label="Create"
          onPress={() => {
            const fresh = generateMatchCode();
            setCode(fresh);
            transport.joinOnline(fresh);
          }}
        />
        <CompactGhost label="Browse" onPress={() => setBrowseLobbiesOpen(true)} />
      </View>
      <OnlineConnectionStatus />
    </PrimaryModeCard>
  );

  const practiceCard = (
    <PrimaryModeCard
      title="Practice vs bots"
      subtitle={isLandscape ? 'vs bots · offline' : 'Single device · no connection'}
      icon={<BotIcon color={COLORS.ink2} size={18} />}
    >
      <Text style={{ fontSize: 11, color: COLORS.ink3, fontWeight: '600', lineHeight: 16 }}>
        Three bots —{' '}
        <Text style={{ color: COLORS.ink2, fontWeight: '800' }}>{BOT_LABELS.heuristic}</Text>,{' '}
        <Text style={{ color: COLORS.ink2, fontWeight: '800' }}>{BOT_LABELS.simple}</Text>, and{' '}
        <Text style={{ color: COLORS.ink2, fontWeight: '800' }}>{BOT_LABELS.passive}</Text>. Runs
        offline.
      </Text>
      <View style={{ flexDirection: 'row' }}>
        <CompactPrimary label="Play vs bots" onPress={transport.joinSolo} />
      </View>
    </PrimaryModeCard>
  );

  return (
    <View style={{ flex: 1, backgroundColor: COLORS.cream }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.cream }} edges={['top', 'bottom']}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 28 }}
          // The app bar is the first child — stickyHeaderIndices keeps
          // it pinned at the top while the content scrolls beneath.
          // Works on both RN-Web and native targets.
          stickyHeaderIndices={[0]}
        >
          <AppBar
            name={name}
            onChangeName={(v) => {
              setName(v);
              setDisplayName(v);
            }}
          />
          {isLandscape ? (
            <View style={{ padding: 12, gap: 10 }}>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>{onlineCard}</View>
                <View style={{ flex: 1, minWidth: 0 }}>{practiceCard}</View>
              </View>
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <SecondaryRow
                    icon={<TutorialIcon color={COLORS.ink2} size={18} />}
                    title="Tutorial"
                    subtitle={`${completedCount}/${LESSON_ORDER.length} lessons`}
                    onPress={onToggleTutorial}
                    trailing={<ProgressDots done={completedCount} total={LESSON_ORDER.length} />}
                  />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <SecondaryRow
                    icon={<WifiIcon color={COLORS.ink2} size={18} />}
                    title="LAN / offline"
                    subtitle="Same Wi-Fi"
                    onPress={onToggleLan}
                  />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <SecondaryRow
                    icon={<PlayIcon color={COLORS.ink2} size={18} />}
                    title="Replays"
                    subtitle={replaySubtitle}
                    onPress={() => router.push('/replays')}
                  />
                </View>
              </View>
              {lobby ? <LobbyPreview lobby={lobby} matchCode={null} /> : null}
            </View>
          ) : (
            <View style={{ padding: 12, gap: 10 }}>
              {onlineCard}
              {practiceCard}
              {expandedRow === 'tutorial' ? (
                <ExpandedCard
                  icon={<TutorialIcon color={COLORS.ink2} size={18} />}
                  title="Tutorial"
                  subtitle={`${completedCount}/${LESSON_ORDER.length} complete · tap a lesson to start`}
                  onCollapse={onToggleTutorial}
                >
                  {tutorialBody}
                </ExpandedCard>
              ) : (
                <SecondaryRow
                  icon={<TutorialIcon color={COLORS.ink2} size={18} />}
                  title="Tutorial"
                  subtitle={tutorialSubtitle}
                  onPress={onToggleTutorial}
                  trailing={<ProgressDots done={completedCount} total={LESSON_ORDER.length} />}
                />
              )}
              {expandedRow === 'lan' ? (
                <ExpandedCard
                  icon={<WifiIcon color={COLORS.ink2} size={18} />}
                  title="LAN / offline"
                  subtitle={lanSubtitle}
                  onCollapse={onToggleLan}
                >
                  {lanBody}
                </ExpandedCard>
              ) : (
                <SecondaryRow
                  icon={<WifiIcon color={COLORS.ink2} size={18} />}
                  title="LAN / offline"
                  subtitle={lanSubtitle}
                  onPress={onToggleLan}
                />
              )}
              <SecondaryRow
                icon={<PlayIcon color={COLORS.ink2} size={18} />}
                title="Replays"
                subtitle={replaySubtitle}
                onPress={() => router.push('/replays')}
              />
              {lobby ? <LobbyPreview lobby={lobby} matchCode={null} /> : null}
              <Text
                style={{
                  fontSize: 10,
                  color: COLORS.ink3,
                  fontWeight: '600',
                  textAlign: 'center',
                  marginTop: 4,
                }}
              >
                Hong Kong rules · 136 tiles
              </Text>
            </View>
          )}
        </ScrollView>
        {/* Landscape modal sheets — see Modal.tsx for the slide/fade. */}
        <Modal
          open={openSheet === 'tutorial'}
          title="Tutorial"
          onClose={() => setOpenSheet(null)}
          placement="center"
          maxWidth={480}
        >
          <ScrollView contentContainerStyle={{ padding: 14, gap: 8 }}>{tutorialBody}</ScrollView>
        </Modal>
        <Modal
          open={openSheet === 'lan'}
          title="LAN / offline"
          onClose={() => setOpenSheet(null)}
          placement="center"
          maxWidth={480}
        >
          <ScrollView contentContainerStyle={{ padding: 14, gap: 10 }}>{lanBody}</ScrollView>
        </Modal>
        <JoinLanModal
          open={joinLanOpen}
          onClose={() => setJoinLanOpen(false)}
          onJoin={(hostUrl, matchCode) => {
            setJoinLanOpen(false);
            transport.joinLan(hostUrl, matchCode);
          }}
        />
        <BrowseLobbyModal
          open={browseLobbiesOpen}
          onClose={() => setBrowseLobbiesOpen(false)}
          onJoin={(matchCode, opts) => transport.joinOnline(matchCode, opts)}
        />
      </SafeAreaView>
    </View>
  );
}

// ─── App bar ────────────────────────────────────────────────────────

interface AppBarProps {
  name: string;
  onChangeName: (v: string) => void;
}

/**
 * Compact sticky top bar — identity pill on the left (avatar +
 * editable name + EDIT label), brand mark on the right (wind emblem
 * + "Modern Mahjong" / "麻將"). Replaces the legacy `<LobbyHeader>`
 * hero which ate ~280 px of vertical real estate before the first
 * mode card. Held in place by the parent ScrollView's
 * `stickyHeaderIndices={[0]}` so it stays pinned during scroll.
 */
function AppBar({ name, onChangeName }: AppBarProps) {
  const initials = (name || '?').slice(0, 2).toUpperCase();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 14,
        paddingVertical: 10,
        backgroundColor: 'rgba(241,234,220,0.92)',
        borderBottomColor: COLORS.hairline,
        borderBottomWidth: 1,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 7,
          backgroundColor: COLORS.paperHi,
          borderColor: COLORS.hairline,
          borderWidth: 1,
          borderRadius: 8,
          paddingVertical: 4,
          paddingHorizontal: 8,
          paddingLeft: 4,
          flex: 1,
          minWidth: 0,
        }}
      >
        <View
          style={{
            width: 26,
            height: 26,
            borderRadius: 6,
            backgroundColor: COLORS.avatarBg,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text style={{ color: 'white', fontWeight: '800', fontSize: 11 }}>{initials}</Text>
        </View>
        <TextInput
          value={name}
          onChangeText={onChangeName}
          placeholder="Display name"
          placeholderTextColor={COLORS.ink3}
          style={{
            fontFamily: 'Nunito',
            fontSize: 13,
            fontWeight: '700',
            color: COLORS.ink,
            flex: 1,
            minWidth: 0,
            padding: 0,
          }}
        />
        <View
          style={{
            backgroundColor: COLORS.creamLow,
            borderRadius: 4,
            paddingHorizontal: 6,
            paddingVertical: 2,
          }}
        >
          <Text
            style={{
              fontSize: 10,
              fontWeight: '800',
              color: COLORS.ink3,
              letterSpacing: 0.4,
            }}
          >
            EDIT
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
        <WindEmblem wind="東" size={22} />
        <View>
          {/* `accessibilityRole="header"` so Playwright's
              `getByRole('heading', { name: 'Modern Mahjong' })` finds
              the brand mark — the test specs use that selector to wait
              for the lobby to settle before clicking through. Renders
              an `<h1>` via RN-Web. */}
          <Text
            accessibilityRole="header"
            style={{ fontSize: 13, fontWeight: '900', color: COLORS.ink, lineHeight: 14 }}
          >
            Modern Mahjong
          </Text>
          <Text
            style={{
              fontFamily: 'Noto Serif TC',
              fontSize: 13,
              fontWeight: '700',
              color: COLORS.red,
              lineHeight: 14,
              marginTop: 2,
            }}
          >
            麻將
          </Text>
        </View>
      </View>
    </View>
  );
}

// ─── Primary mode card ──────────────────────────────────────────────

interface PrimaryModeCardProps {
  accent?: boolean;
  title: string;
  subtitle: string;
  icon: ReactNode;
  /** Renders a RECOMMENDED pill next to the title — only set on
   *  the accent card (Online). */
  badge?: string;
  children: ReactNode;
}

/**
 * Mobile-tighter version of `ModeCard` — 12×14 padding instead of
 * 22, 32×32 icon swatch instead of 40, 15 px title instead of 16.
 * Kept local rather than parameterising `ModeCard` because the
 * mobile redesign is the only consumer at this size and the desktop
 * card's chrome shouldn't drift toward the mobile spec.
 */
function PrimaryModeCard({
  accent = false,
  title,
  subtitle,
  icon,
  badge,
  children,
}: PrimaryModeCardProps) {
  return (
    <View
      style={{
        backgroundColor: COLORS.paperHi,
        borderColor: accent ? COLORS.accentBorder : COLORS.hairline,
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 10,
        boxShadow: '0px 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            backgroundColor: accent ? COLORS.accentSalmonSwatch : COLORS.neutralSwatch,
            borderColor: accent ? COLORS.accentSalmonEdge : COLORS.hairline,
            borderWidth: 1,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <Text
              style={{
                fontSize: 15,
                fontWeight: '900',
                color: COLORS.ink,
                lineHeight: 17,
              }}
            >
              {title}
            </Text>
            {badge ? <RecommendedBadge label={badge} /> : null}
          </View>
          <Text
            style={{
              fontSize: 11,
              color: COLORS.ink3,
              fontWeight: '600',
              marginTop: 1,
            }}
          >
            {subtitle}
          </Text>
        </View>
      </View>
      {children}
    </View>
  );
}

function RecommendedBadge({ label }: { label: string }) {
  return (
    <View
      style={{
        backgroundColor: COLORS.accentSalmonSwatch,
        borderColor: COLORS.accentSalmonEdge,
        borderWidth: 1,
        borderRadius: 5,
        paddingHorizontal: 6,
        paddingVertical: 2,
      }}
    >
      <Text style={{ fontSize: 8, fontWeight: '900', letterSpacing: 0.7, color: COLORS.red }}>
        {label}
      </Text>
    </View>
  );
}

// ─── Secondary row ──────────────────────────────────────────────────

interface SecondaryRowProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  onPress: () => void;
  /** Optional trailing slot (used for Tutorial progress dots). The
   *  chevron is always rendered after this. */
  trailing?: ReactNode;
}

/**
 * Single tappable row used for Tutorial-collapsed, LAN-collapsed,
 * and Replays. Same chrome as `PrimaryModeCard` minus the body
 * children — when the row needs to "expand" the consumer swaps it
 * for `<ExpandedCard>` instead of toggling internal state.
 */
function SecondaryRow({ icon, title, subtitle, onPress, trailing }: SecondaryRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        backgroundColor: pressed ? COLORS.cream : COLORS.paperHi,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 10,
        boxShadow: '0px 1px 3px rgba(0,0,0,0.04)',
      })}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          backgroundColor: COLORS.neutralSwatch,
          borderColor: COLORS.hairline,
          borderWidth: 1,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 13, fontWeight: '900', color: COLORS.ink, lineHeight: 16 }}>
          {title}
        </Text>
        <Text
          style={{ fontSize: 11, color: COLORS.ink3, fontWeight: '600', marginTop: 1 }}
          numberOfLines={1}
        >
          {subtitle}
        </Text>
      </View>
      {trailing}
      <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.ink3 }}>›</Text>
    </Pressable>
  );
}

// ─── Inline-expanded card (portrait only) ───────────────────────────

interface ExpandedCardProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  onCollapse: () => void;
  children: ReactNode;
}

/**
 * Portrait-only inline expansion — same chrome as `SecondaryRow` plus
 * a content body underneath. Chevron rotates 90° to signal the row
 * is open; tap the header to collapse.
 */
function ExpandedCard({ icon, title, subtitle, onCollapse, children }: ExpandedCardProps) {
  return (
    <View
      style={{
        backgroundColor: COLORS.paperHi,
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        gap: 10,
        boxShadow: '0px 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      <Pressable
        onPress={onCollapse}
        accessibilityRole="button"
        accessibilityLabel={`Collapse ${title}`}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
      >
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            backgroundColor: COLORS.neutralSwatch,
            borderColor: COLORS.hairline,
            borderWidth: 1,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 13, fontWeight: '900', color: COLORS.ink, lineHeight: 16 }}>
            {title}
          </Text>
          <Text style={{ fontSize: 11, color: COLORS.ink3, fontWeight: '600', marginTop: 1 }}>
            {subtitle}
          </Text>
        </View>
        <Text
          style={{
            fontSize: 18,
            fontWeight: '700',
            color: COLORS.ink3,
            transform: [{ rotate: '90deg' }],
          }}
        >
          ›
        </Text>
      </Pressable>
      {children}
    </View>
  );
}

// ─── Lesson row ─────────────────────────────────────────────────────

interface LessonRowProps {
  title: string;
  blurb: string;
  done: boolean;
  onPress: () => void;
}

/**
 * Compact lesson row used inside both the inline-expanded Tutorial
 * card (portrait) and the Tutorial modal sheet (landscape). Done
 * lessons render with a green ✓ in a filled circle; pending lessons
 * show a hairline-outlined transparent circle.
 */
function LessonRow({ title, blurb, done, onPress }: LessonRowProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${done ? 'Replay' : 'Start'} ${title}`}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 8,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: pressed ? COLORS.creamLow : COLORS.cream,
        borderColor: COLORS.hairline,
        borderWidth: 1,
      })}
    >
      <View
        style={{
          width: 18,
          height: 18,
          borderRadius: 9,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: done ? COLORS.success : 'transparent',
          borderWidth: done ? 0 : 1,
          borderColor: COLORS.hairline,
        }}
      >
        {done ? <Text style={{ fontSize: 10, fontWeight: '900', color: '#fff' }}>✓</Text> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 12, fontWeight: '800', color: COLORS.ink, lineHeight: 14 }}>
          {title}
        </Text>
        <Text style={{ fontSize: 10, color: COLORS.ink3, fontWeight: '600', marginTop: 1 }}>
          {blurb}
        </Text>
      </View>
      <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.ink3 }}>›</Text>
    </Pressable>
  );
}

// ─── Match code input ───────────────────────────────────────────────

interface MatchCodeInputProps {
  value: string;
  onChangeText: (v: string) => void;
}

/**
 * Compact match-code input — the only place in the mobile lobby that
 * uses monospace. Renders a focused brand-red ring via local
 * `useState(focused)` since `TextInput` doesn't surface :focus to
 * RN-Web's stylesheet.
 */
function MatchCodeInput({ value, onChangeText }: MatchCodeInputProps) {
  const [focused, setFocused] = useState(false);
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      maxLength={5}
      autoCapitalize="characters"
      autoCorrect={false}
      placeholder="ABCDE"
      placeholderTextColor={COLORS.ink3}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      // `accessibilityLabel` is what RN-Web emits as `aria-label`,
      // so Playwright specs that find this input via
      // `page.getByLabel('Match code')` (the same selector the
      // desktop `TextField` exposes via its `label` prop) keep
      // working on the mobile lobby.
      accessibilityLabel="Match code"
      style={{
        fontFamily: 'JetBrains Mono',
        fontSize: 16,
        fontWeight: '700',
        color: COLORS.ink,
        letterSpacing: 3,
        backgroundColor: COLORS.paperHi,
        borderColor: focused ? COLORS.red : COLORS.hairline,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        ...(focused && { boxShadow: '0px 0px 0px 3px rgba(177,77,58,0.15)' }),
      }}
    />
  );
}

const fieldLabelStyle = {
  fontSize: 10,
  fontWeight: '800' as const,
  color: COLORS.ink3,
  letterSpacing: 0.6,
};

// ─── Compact CTAs ───────────────────────────────────────────────────

/**
 * Tighter primary CTA tuned for the mobile lobby — 8/14 padding and
 * 12 px text vs. `PrimaryButton`'s 10/16/13. Sizing matches the
 * design tokens exactly; doing it inline rather than adding another
 * size to `PrimaryButton` keeps the desktop CTA shape untouched.
 */
function CompactPrimary({
  label,
  onPress,
  disabled = false,
}: { label: string; onPress?: () => void; disabled?: boolean }) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        backgroundColor: disabled ? '#c9c1b3' : pressed ? '#d05746' : COLORS.red,
        borderRadius: 8,
        paddingHorizontal: 14,
        paddingVertical: 8,
        opacity: disabled ? 0.6 : 1,
        transform: [{ translateY: pressed && !disabled ? -1 : 0 }],
      })}
    >
      <Text
        style={{
          color: 'white',
          fontWeight: '800',
          fontSize: 12,
          letterSpacing: 0.3,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function CompactGhost({ label, onPress }: { label: string; onPress?: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => ({
        backgroundColor: pressed ? COLORS.cream : 'white',
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 14,
        paddingVertical: 8,
      })}
    >
      <Text style={{ color: COLORS.ink, fontWeight: '700', fontSize: 12 }}>{label}</Text>
    </Pressable>
  );
}

// ─── Progress dots ──────────────────────────────────────────────────

function ProgressDots({ done, total }: { done: number; total: number }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {Array.from({ length: total }, (_, i) => (
        <View
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed-length count, dot order is positional
          key={i}
          style={{
            width: 8,
            height: 8,
            borderRadius: 4,
            backgroundColor: i < done ? COLORS.success : COLORS.creamLow,
            borderColor: i < done ? 'transparent' : COLORS.hairline,
            borderWidth: i < done ? 0 : 1,
          }}
        />
      ))}
    </View>
  );
}

// ─── Replay subtitle ────────────────────────────────────────────────

/**
 * Reuses the same per-header summary the existing `ReplayLibrary`
 * uses ("wins / losses / streak"). Kept local rather than imported
 * from `ReplayLibrary.tsx` to avoid coupling a menu screen to a
 * replay-library implementation detail; the function below is the
 * mobile-lobby's subtitle formatter only.
 */
function summariseReplays(headers: readonly ReplayHeader[]): { wins: number; streak: number } {
  let wins = 0;
  let currentStreak = 0;
  let bestStreak = 0;
  const chrono = [...headers].reverse();
  for (const h of chrono) {
    if (h.localSeat === 'spectator') continue;
    const winnerSeat = winnerSeatOf(h);
    if (winnerSeat === h.localSeat) {
      wins++;
      currentStreak++;
      if (currentStreak > bestStreak) bestStreak = currentStreak;
    } else {
      currentStreak = 0;
    }
  }
  return { wins, streak: bestStreak };
}

/** Seat with the highest final score for a replay header. Mirrors
 *  the local `winnerOf` in `ReplayLibrary.tsx`; the two surfaces
 *  agreeing matters more than DRY here — replays don't change
 *  often, and a shared module would couple a menu screen to the
 *  library's implementation. */
function winnerSeatOf(header: ReplayHeader): Seat {
  let bestSeat: Seat = 0;
  let bestScore = header.finalScoreboard[0] ?? 0;
  for (const seat of SEATS) {
    const score = header.finalScoreboard[seat] ?? 0;
    if (score > bestScore) {
      bestSeat = seat;
      bestScore = score;
    }
  }
  return bestSeat;
}

function replaySubtitleFor(
  count: number,
  wins: number,
  streak: number,
  isLandscape: boolean,
): string {
  if (count === 0) return 'No saved matches yet';
  if (isLandscape) return `${count} saved · ${wins} wins`;
  const parts = [`${count} saved`, `${wins} wins`];
  if (streak >= 2) parts.push(`longest streak ${streak}`);
  return parts.join(' · ');
}

// ─── Online connection status (carried over from Lobby.tsx) ─────────

function OnlineConnectionStatus() {
  const transport = useTransport();
  const state = useGame((s) => s.state);
  if (transport.status === 'idle' || state) return null;
  if (transport.status === 'connecting') {
    return (
      <Text style={{ fontSize: 11, color: COLORS.ink3, fontWeight: '700' }}>
        Connecting to {transport.resolvedHost}…
      </Text>
    );
  }
  if (transport.status === 'closed') {
    return (
      <View style={{ gap: 2 }}>
        <Text style={{ fontSize: 11, color: COLORS.red, fontWeight: '800' }}>
          Couldn't reach the match server.
        </Text>
        <Text style={{ fontSize: 10, color: COLORS.ink3, fontWeight: '600', lineHeight: 14 }}>
          Tried {transport.resolvedHost || '(no host)'}.
        </Text>
      </View>
    );
  }
  return null;
}

// ─── Phone-class viewport classifier (consumed by Lobby.tsx) ────────

/**
 * True when the short edge of the viewport is at most 480 px. Catches
 * both portrait (393×852 → short=393) and landscape (852×393 →
 * short=393) phones; tablets and desktops fall to the legacy
 * `<Lobby>` layout.
 *
 * Hook lives here so the dispatch site in `Lobby.tsx` stays a single
 * import — the viewport classification is a presentational concern.
 */
export function useIsPhoneViewport(): { isPhone: boolean; isLandscape: boolean } {
  const { width, height } = useWindowDimensions();
  return {
    isPhone: Math.min(width, height) <= 480,
    isLandscape: width > height,
  };
}
