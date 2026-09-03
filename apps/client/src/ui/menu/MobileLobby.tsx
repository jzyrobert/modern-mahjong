import { useTransport } from '@/src/net/transport-context';
import { BOT_LABELS, generateMatchCode } from '@mahjong/protocol';
import { useRouter } from 'expo-router';
import { type ReactNode, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDisplayName, setDisplayName } from '../../identity';
import { listHeaders } from '../../replay/storage';
import type { ReplayHeader } from '../../replay/types';
import { useGame } from '../../state/game';
import { LESSON_ORDER } from '../../state/tutorial';
import { BrowseLobbyModal } from '../BrowseLobbyModal';
import { JoinLanModal } from '../JoinLanModal';
import { useIsLandscape } from '../useOrientation';
import { GlassCard } from './GlassCard';
import { GlassSheet } from './GlassSheet';
import { LessonProgress, LessonRail, useLessonItems } from './LessonPicker';
import { Footer, InlineHint, OnlineConnectionStatus } from './Lobby';
import { LobbyBackdrop } from './LobbyBackdrop';
import { BrandMark, IdentityPill, TitleBlock } from './LobbyHeader';
import { LobbyPreview } from './LobbyPreview';
import { GlassButton, GoldButton, MenuTextField } from './MenuButtons';
import { CardHeader, IconSwatch, ModeCard } from './ModeCard';
import { Reveal } from './Reveal';
import {
  BotIcon,
  BoxIcon,
  ChevronRightIcon,
  GlobeIcon,
  PlayIcon,
  TutorialIcon,
  WifiIcon,
} from './icons';
import { replaySubtitleFor, summariseReplays } from './replaySubtitle';
import { HOVER_TRANSITION, MENU, TYPE, glass } from './theme';
import { useLanHost } from './useLanHost';

/**
 * Phone-class lobby. Portrait: sticky glass app bar (identity pill +
 * brand mark), title block over the hero band, then the Online and
 * Practice cards and three secondary rows (Tutorial expands inline to
 * a horizontal lesson rail, LAN expands inline, Replays navigates).
 * Landscape: a title column on the left with the cards + rows in a
 * denser grid on the right; Tutorial / LAN open glass sheets because
 * the inline expansion is taller than a 412 px viewport.
 *
 * Phone cards use `borderRadius: 12` as an inline style — the
 * lobby-layout spec walks up from each row title to its 12 px-radius
 * ancestor to assert the rows stack without overlap.
 */
const PHONE_RADIUS = 12;

interface MobileLobbyProps {
  isLandscape: boolean;
}

export function MobileLobby({ isLandscape }: MobileLobbyProps) {
  const router = useRouter();
  const transport = useTransport();
  const { height } = useWindowDimensions();
  const lobby = useGame((s) => s.lobby);
  const lessons = useLessonItems();
  const completedCount = lessons.filter((l) => l.done).length;
  const [name, setName] = useState(() => getDisplayName());
  const [code, setCode] = useState('');
  const [joinLanOpen, setJoinLanOpen] = useState(false);
  const [browseLobbiesOpen, setBrowseLobbiesOpen] = useState(false);
  const [headers, setHeaders] = useState<readonly ReplayHeader[]>([]);
  const [expandedRow, setExpandedRow] = useState<'tutorial' | 'lan' | null>(null);
  const [openSheet, setOpenSheet] = useState<'tutorial' | 'lan' | null>(null);
  const { canHostLan, hostStatus, hostError, onHostLan } = useLanHost(transport);

  useEffect(() => {
    setHeaders(listHeaders());
  }, []);

  const toggle = (row: 'tutorial' | 'lan') => {
    if (isLandscape) setOpenSheet((s) => (s === row ? null : row));
    else setExpandedRow((r) => (r === row ? null : row));
  };

  const replaySummary = summariseReplays(headers);
  const replaySubtitle = replaySubtitleFor(
    headers.length,
    replaySummary.wins,
    replaySummary.streak,
    isLandscape,
  );
  const tutorialSubtitle = isLandscape
    ? `${completedCount}/${LESSON_ORDER.length} lessons`
    : `${completedCount}/${LESSON_ORDER.length} lessons · tap to pick one`;
  const lanSubtitle = isLandscape ? 'Same Wi-Fi' : 'Same Wi-Fi · no accounts';

  const startLesson = (id: string) => {
    setOpenSheet(null);
    setExpandedRow(null);
    transport.joinSoloTutorial(id);
  };

  const tutorialBody = (
    <View style={{ gap: 10 }}>
      <LessonProgress done={completedCount} total={LESSON_ORDER.length} />
      <LessonRail items={lessons} onStart={startLesson} gutter={14} />
    </View>
  );

  const lanBody = (
    <>
      <Text style={TYPE.body}>
        Four-player matches over local Wi-Fi. Host shares a URL; guests paste it into any browser on
        the same network.
      </Text>
      <InlineHint icon={<BoxIcon color={MENU.text3} />}>
        Works offline. No accounts. No data leaves your network.
      </InlineHint>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {canHostLan ? (
          <GoldButton size="sm" onPress={onHostLan} disabled={hostStatus === 'starting'}>
            {hostStatus === 'starting' ? 'Starting host…' : 'Host LAN match'}
          </GoldButton>
        ) : null}
        <GlassButton size="sm" onPress={() => setJoinLanOpen(true)}>
          Join LAN match
        </GlassButton>
      </View>
      {hostError ? (
        <Text style={{ fontSize: 12, color: '#e59a8b', fontWeight: '700', lineHeight: 16 }}>
          {hostError}
        </Text>
      ) : null}
    </>
  );

  const onlineCard = (
    <ModeCard
      accent
      compact
      radius={PHONE_RADIUS}
      title="Online match"
      subtitle="Play with friends over the internet"
      icon={<GlobeIcon color={MENU.goldHi} size={18} />}
      style={isLandscape ? { flex: 1 } : undefined}
      testID="mode-online"
    >
      <MenuTextField
        label="Match code"
        value={code}
        onChangeText={(v) => setCode(v.toUpperCase())}
        placeholder="ABCDE"
        mono
        maxLength={5}
        autoCapitalize="characters"
        compact
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        <GoldButton
          size="sm"
          onPress={() => code && transport.joinOnline(code)}
          disabled={code.length !== 5}
          style={{ flexGrow: 1 }}
        >
          Join match
        </GoldButton>
        <GlassButton
          size="sm"
          onPress={() => {
            const fresh = generateMatchCode();
            setCode(fresh);
            transport.joinOnline(fresh);
          }}
        >
          Create
        </GlassButton>
        <GlassButton size="sm" onPress={() => setBrowseLobbiesOpen(true)}>
          Browse
        </GlassButton>
      </View>
      <OnlineConnectionStatus compact />
    </ModeCard>
  );

  const practiceCard = (
    <ModeCard
      compact
      radius={PHONE_RADIUS}
      title="Practice vs bots"
      subtitle={isLandscape ? 'vs bots · offline' : 'Single device · no connection'}
      icon={<BotIcon color={MENU.text} size={18} />}
      style={isLandscape ? { flex: 1 } : undefined}
      testID="mode-practice"
    >
      <Text style={[TYPE.small, { lineHeight: 16 }]}>
        Three bots —{' '}
        <Text style={{ color: MENU.text2, fontWeight: '800' }}>{BOT_LABELS.heuristic}</Text>,{' '}
        <Text style={{ color: MENU.text2, fontWeight: '800' }}>{BOT_LABELS.simple}</Text>, and{' '}
        <Text style={{ color: MENU.text2, fontWeight: '800' }}>{BOT_LABELS.passive}</Text>. Runs
        offline.
      </Text>
      {isLandscape ? <View style={{ flex: 1 }} /> : null}
      <GoldButton size="sm" onPress={transport.joinSolo} full={!isLandscape}>
        Play vs bots
      </GoldButton>
    </ModeCard>
  );

  const tutorialRow = (
    <SecondaryRow
      icon={<TutorialIcon color={MENU.text} size={18} />}
      title="Tutorial"
      subtitle={tutorialSubtitle}
      onPress={() => toggle('tutorial')}
      testID="mode-tutorial"
    />
  );
  const lanRow = (
    <SecondaryRow
      icon={<WifiIcon color={MENU.text} size={18} />}
      title="LAN / offline"
      subtitle={lanSubtitle}
      onPress={() => toggle('lan')}
      testID="mode-lan"
    />
  );
  const replaysRow = (
    <SecondaryRow
      icon={<PlayIcon color={MENU.text} size={18} />}
      title="Replays"
      subtitle={replaySubtitle}
      onPress={() => router.push('/replays')}
      testID="mode-replays"
    />
  );

  const modals = (
    <>
      <GlassSheet
        open={openSheet === 'tutorial'}
        title="Tutorial"
        onClose={() => setOpenSheet(null)}
      >
        <View style={{ padding: 14, gap: 10 }}>
          <Text style={TYPE.cardSubtitle}>
            {completedCount}/{LESSON_ORDER.length} lessons complete · tap a lesson to start
          </Text>
          {tutorialBody}
        </View>
      </GlassSheet>
      <GlassSheet
        open={openSheet === 'lan'}
        title="LAN / offline"
        onClose={() => setOpenSheet(null)}
      >
        <ScrollView contentContainerStyle={{ padding: 14, gap: 10 }}>{lanBody}</ScrollView>
      </GlassSheet>
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
    </>
  );

  const onChangeName = (v: string) => {
    setName(v);
    setDisplayName(v);
  };

  if (isLandscape) {
    return (
      <View style={{ flex: 1, backgroundColor: MENU.void0 }}>
        <LobbyBackdrop />
        <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }} edges={['top', 'bottom']}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ padding: 12, paddingBottom: 20 }}
          >
            <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
              <View style={{ width: '30%', minWidth: 220, gap: 14, paddingTop: 2 }}>
                <IdentityPill name={name} onChangeName={onChangeName} compact grow />
                <View style={{ paddingLeft: 4 }}>
                  <TitleBlock size="sm" align="left" tagline={false} />
                </View>
              </View>
              <View style={{ flex: 1, minWidth: 0, gap: 10 }}>
                <Reveal index={0}>
                  <View style={{ flexDirection: 'row', gap: 10, alignItems: 'stretch' }}>
                    {onlineCard}
                    {practiceCard}
                  </View>
                </Reveal>
                <Reveal index={1}>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <View style={{ flex: 1, minWidth: 0 }}>{tutorialRow}</View>
                    <View style={{ flex: 1, minWidth: 0 }}>{lanRow}</View>
                    <View style={{ flex: 1, minWidth: 0 }}>{replaysRow}</View>
                  </View>
                </Reveal>
                {lobby ? <LobbyPreview lobby={lobby} matchCode={null} /> : null}
              </View>
            </View>
            <Footer compact />
          </ScrollView>
          {modals}
        </SafeAreaView>
      </View>
    );
  }

  // Portrait: leave the band under the title clear for the 3D hero.
  const heroMinHeight = Math.max(200, Math.round(height * 0.3));
  return (
    <View style={{ flex: 1, backgroundColor: MENU.void0 }}>
      <LobbyBackdrop />
      <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }} edges={['top', 'bottom']}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: 24 }}
          stickyHeaderIndices={[0]}
        >
          <AppBar name={name} onChangeName={onChangeName} />
          <View style={{ minHeight: heroMinHeight, paddingHorizontal: 16, paddingTop: 18 }}>
            <TitleBlock size="md" align="left" />
          </View>
          <View style={{ padding: 12, gap: 10 }}>
            <Reveal index={0}>{onlineCard}</Reveal>
            <Reveal index={1}>{practiceCard}</Reveal>
            <Reveal index={2}>
              {expandedRow === 'tutorial' ? (
                <ExpandedCard
                  icon={<TutorialIcon color={MENU.text} size={18} />}
                  title="Tutorial"
                  subtitle={`${completedCount}/${LESSON_ORDER.length} complete · swipe for more`}
                  onCollapse={() => toggle('tutorial')}
                >
                  {tutorialBody}
                </ExpandedCard>
              ) : (
                tutorialRow
              )}
            </Reveal>
            <Reveal index={3}>
              {expandedRow === 'lan' ? (
                <ExpandedCard
                  icon={<WifiIcon color={MENU.text} size={18} />}
                  title="LAN / offline"
                  subtitle={lanSubtitle}
                  onCollapse={() => toggle('lan')}
                >
                  {lanBody}
                </ExpandedCard>
              ) : (
                lanRow
              )}
            </Reveal>
            <Reveal index={4}>{replaysRow}</Reveal>
            {lobby ? <LobbyPreview lobby={lobby} matchCode={null} /> : null}
            <Footer compact />
          </View>
        </ScrollView>
        {modals}
      </SafeAreaView>
    </View>
  );
}

// ─── App bar (portrait) ─────────────────────────────────────────────

function AppBar({ name, onChangeName }: { name: string; onChangeName: (v: string) => void }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 8,
        ...glass({ quiet: true, radius: 0, flat: true }),
        borderWidth: 0,
        borderBottomWidth: 1,
        borderBottomColor: MENU.hairlineSoft,
      }}
    >
      <IdentityPill name={name} onChangeName={onChangeName} compact grow />
      <BrandMark size={22} />
    </View>
  );
}

// ─── Secondary row ──────────────────────────────────────────────────

interface SecondaryRowProps {
  icon: ReactNode;
  title: string;
  subtitle: string;
  onPress: () => void;
  testID?: string;
}

/** Tappable quiet-glass row (Tutorial / LAN collapsed, Replays). */
function SecondaryRow({ icon, title, subtitle, onPress, testID }: SecondaryRowProps) {
  const [hovered, setHovered] = useState(false);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      testID={testID}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => ({
        ...glass({ quiet: true, radius: PHONE_RADIUS }),
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 10,
        minHeight: 56,
        ...(pressed ? { backgroundColor: 'rgba(24,34,28,0.7)' } : {}),
        ...HOVER_TRANSITION,
        transform: [{ translateY: hovered && !pressed ? -1 : 0 }, { scale: pressed ? 0.98 : 1 }],
      })}
    >
      <IconSwatch icon={icon} size={34} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 14, fontWeight: '800', color: MENU.text, lineHeight: 17 }}>
          {title}
        </Text>
        <Text
          style={[TYPE.cardSubtitle, { fontSize: 11, lineHeight: 14, marginTop: 1 }]}
          numberOfLines={1}
        >
          {subtitle}
        </Text>
      </View>
      <ChevronRightIcon size={11} color={MENU.text3} />
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

function ExpandedCard({ icon, title, subtitle, onCollapse, children }: ExpandedCardProps) {
  return (
    <GlassCard
      radius={PHONE_RADIUS}
      style={{ paddingHorizontal: 14, paddingVertical: 12, gap: 12 }}
    >
      <Pressable
        onPress={onCollapse}
        accessibilityRole="button"
        accessibilityLabel={`Collapse ${title}`}
      >
        <CardHeader
          icon={icon}
          title={title}
          subtitle={subtitle}
          compact
          trailing={
            <View style={{ transform: [{ rotate: '90deg' }] }}>
              <ChevronRightIcon size={11} color={MENU.text3} />
            </View>
          }
        />
      </Pressable>
      {children}
    </GlassCard>
  );
}

// ─── Phone-class viewport classifier (consumed by Lobby.tsx) ────────

/**
 * True when the short edge of the viewport is at most 480 px. Catches
 * both portrait and landscape phones; tablets and desktops fall to the
 * desktop layout. `isLandscape` comes from the shared `useIsLandscape`
 * hook (matchMedia on web — soft-keyboard safe).
 */
export function useIsPhoneViewport(): { isPhone: boolean; isLandscape: boolean } {
  const { width, height } = useWindowDimensions();
  const isLandscape = useIsLandscape();
  return { isPhone: Math.min(width, height) <= 480, isLandscape };
}
