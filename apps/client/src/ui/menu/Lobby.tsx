import { useTransport } from '@/src/net/transport-context';
import { BOT_LABELS, generateMatchCode } from '@mahjong/protocol';
import { useRouter } from 'expo-router';
import { type ReactNode, useEffect, useState } from 'react';
import { ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDisplayName, setDisplayName } from '../../identity';
import { listHeaders } from '../../replay/storage';
import { useGame } from '../../state/game';
import { LESSON_ORDER } from '../../state/tutorial';
import { BrowseLobbyModal } from '../BrowseLobbyModal';
import { JoinLanModal } from '../JoinLanModal';
import { LessonGrid, LessonProgress, lessonProgressLabel, useLessonItems } from './LessonPicker';
import { LobbyBackdrop } from './LobbyBackdrop';
import { BrandMark, IdentityPill, TitleBlock } from './LobbyHeader';
import { LobbyPreview } from './LobbyPreview';
import { GlassButton, GoldButton, MenuTextField, Pill } from './MenuButtons';
import { MobileLobby, useIsPhoneViewport } from './MobileLobby';
import { Columns, ModeCard } from './ModeCard';
import { Reveal } from './Reveal';
import { BotIcon, BoxIcon, GlobeIcon, PlayIcon, TutorialIcon, WifiIcon } from './icons';
import { MENU, TYPE } from './theme';
import { useLanHost } from './useLanHost';
import { useMenuOccluder } from './useMenuOccluder';

/**
 * Top-level menu screen (route `/`). Phone-class viewports (either
 * dimension ≤ 480 px) get `<MobileLobby>`; tablets and desktops get the
 * `DesktopLobby` below: a centred title block over the 3D hero backdrop
 * (`LobbyBackdrop` → `Menu3DBackdrop` when the renderer resolves to
 * `'3d'`), then glass mode cards in independent columns.
 *
 * Every accessible name the legacy Playwright suite relies on is kept:
 * heading "Modern Mahjong", "Match code" field, "Join match" / "Create
 * new match" / "Browse open lobbies", "Play vs bots", "Join LAN match",
 * "Open library", and the `Start|Replay <lesson>` lesson buttons.
 */
export function Lobby() {
  const { isPhone, isLandscape } = useIsPhoneViewport();
  if (isPhone) return <MobileLobby isLandscape={isLandscape} />;
  return <DesktopLobby />;
}

function DesktopLobby() {
  const router = useRouter();
  const transport = useTransport();
  const { width, height } = useWindowDimensions();
  const lobby = useGame((s) => s.lobby);
  const lessons = useLessonItems();
  const completedCount = lessons.filter((l) => l.done).length;
  // Lazy initialiser — `getDisplayName()` reads from preferences.
  const [name, setName] = useState(() => getDisplayName());
  const [code, setCode] = useState('');
  const [joinLanOpen, setJoinLanOpen] = useState(false);
  const [browseLobbiesOpen, setBrowseLobbiesOpen] = useState(false);
  const [replayCount, setReplayCount] = useState(0);
  const { canHostLan, hostStatus, hostError, onHostLan } = useLanHost(transport);

  useEffect(() => {
    setReplayCount(listHeaders().length);
  }, []);

  const columns = width >= 960 ? 3 : 2;
  // Reserve the upper ~38 % for the hero: the title block sits at the
  // top of this band and the fan renders in the space below it (its
  // anchor is `heroAnchor` → y ≈ 0.33 on wide viewports). Together
  // with the single-line footer this keeps a 1440 × 900 lobby fold-free.
  const heroMinHeight = Math.max(300, Math.round(height * 0.38));
  const inlineFooter = width >= 1280;

  const onlineCard = (
    <ModeCard
      accent
      title="Online match"
      subtitle="Play with friends over the internet"
      icon={<GlobeIcon color={MENU.goldHi} />}
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
      />
      <GoldButton
        full
        onPress={() => code && transport.joinOnline(code)}
        disabled={code.length !== 5}
        occlude
      >
        Join match
      </GoldButton>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <GlassButton
          style={{ flex: 1 }}
          onPress={() => {
            const fresh = generateMatchCode();
            setCode(fresh);
            transport.joinOnline(fresh);
          }}
        >
          Create new match
        </GlassButton>
        <GlassButton style={{ flex: 1 }} onPress={() => setBrowseLobbiesOpen(true)}>
          Browse open lobbies
        </GlassButton>
      </View>
      <OnlineConnectionStatus />
    </ModeCard>
  );

  const practiceCard = (
    <ModeCard
      title="Practice vs bots"
      subtitle="Single device · no connection"
      icon={<BotIcon color={MENU.text} />}
      testID="mode-practice"
    >
      <Text style={TYPE.body}>
        Three opponents at varying skill. Runs entirely on this device — pick their skill in the
        lobby.
      </Text>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
        <Pill tone="gold">{BOT_LABELS.heuristic}</Pill>
        <Pill>{BOT_LABELS.simple}</Pill>
        <Pill>{BOT_LABELS.passive}</Pill>
      </View>
      <GoldButton full onPress={transport.joinSolo} occlude>
        Play vs bots
      </GoldButton>
    </ModeCard>
  );

  const tutorialCard = (
    <ModeCard
      title="Tutorial"
      subtitle={lessonProgressLabel(completedCount, LESSON_ORDER.length)}
      icon={<TutorialIcon color={MENU.text} />}
      style={GROW}
      testID="mode-tutorial"
    >
      <LessonProgress done={completedCount} total={LESSON_ORDER.length} />
      <LessonGrid items={lessons} onStart={(id) => transport.joinSoloTutorial(id)} columns={2} />
    </ModeCard>
  );

  const lanCard = (
    <ModeCard
      quiet
      title="LAN / offline"
      subtitle="Same-Wi-Fi matches"
      icon={<WifiIcon color={MENU.text} />}
      style={columns === 3 ? GROW : undefined}
      testID="mode-lan"
    >
      <Text style={TYPE.body}>
        {canHostLan
          ? 'Four-player matches over local Wi-Fi. Host shares the URL; guests paste it into any browser on the same network.'
          : 'Paste the host’s URL to join a match on your Wi-Fi. Hosting needs the Android app.'}
      </Text>
      <InlineHint icon={<BoxIcon color={MENU.text2} />}>
        Works offline. No accounts. No data leaves your network.
      </InlineHint>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {canHostLan ? (
          <GoldButton onPress={onHostLan} disabled={hostStatus === 'starting'}>
            {hostStatus === 'starting' ? 'Starting host…' : 'Host LAN match'}
          </GoldButton>
        ) : null}
        <GlassButton onPress={() => setJoinLanOpen(true)}>Join LAN match</GlassButton>
      </View>
      {hostError ? (
        <Text style={{ fontSize: 12, color: '#e59a8b', fontWeight: '700', lineHeight: 16 }}>
          {hostError}
        </Text>
      ) : null}
    </ModeCard>
  );

  const replaysCard = (
    <ModeCard
      quiet
      title="Replays"
      subtitle="Watch saved matches with the scrubber"
      icon={<PlayIcon color={MENU.text} />}
      style={GROW}
      testID="mode-replays"
    >
      <Text style={TYPE.body}>
        {replayCount > 0
          ? `${replayCount} saved replay${replayCount === 1 ? '' : 's'}. Step through any past hand and see every player's tiles.`
          : 'No replays yet. Hit "Save this match" from the in-match menu, or flip on auto-record.'}
      </Text>
      <GlassButton onPress={() => router.push('/replays')}>Open library</GlassButton>
    </ModeCard>
  );

  // Independent column stacks — a tall Tutorial card doesn't stretch
  // its neighbours' *content*. The first card of every column shares
  // stagger slot 0 so the Online / Practice / Tutorial titles line up
  // during the entrance (the lobby-layout spec measures them
  // mid-animation). The last card of every column grows (`GROW`) so
  // the three columns share one bottom line instead of ending ragged.
  const stacks: ReactNode[][] =
    columns === 3
      ? [
          [
            <Reveal key="online" index={0}>
              {onlineCard}
            </Reveal>,
            <Reveal key="replays" index={1} style={GROW}>
              {replaysCard}
            </Reveal>,
          ],
          [
            <Reveal key="practice" index={0}>
              {practiceCard}
            </Reveal>,
            <Reveal key="lan" index={1} style={GROW}>
              {lanCard}
            </Reveal>,
          ],
          [
            <Reveal key="tutorial" index={0} style={GROW}>
              {tutorialCard}
            </Reveal>,
          ],
        ]
      : [
          [
            <Reveal key="online" index={0}>
              {onlineCard}
            </Reveal>,
            <Reveal key="tutorial" index={1} style={GROW}>
              {tutorialCard}
            </Reveal>,
          ],
          [
            <Reveal key="practice" index={0}>
              {practiceCard}
            </Reveal>,
            <Reveal key="lan" index={1}>
              {lanCard}
            </Reveal>,
            <Reveal key="replays" index={2} style={GROW}>
              {replaysCard}
            </Reveal>,
          ],
        ];

  return (
    <View style={{ flex: 1, backgroundColor: MENU.void0 }}>
      <LobbyBackdrop />
      <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }} edges={['top', 'bottom']}>
        <ScrollView
          style={{ flex: 1, backgroundColor: 'transparent' }}
          contentContainerStyle={{ paddingBottom: 24 }}
        >
          <View
            style={{
              minHeight: heroMinHeight,
              paddingTop: 20,
              paddingHorizontal: 24,
              maxWidth: 1120,
              width: '100%',
              alignSelf: 'center',
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
              }}
            >
              <BrandMark size={26} />
              <IdentityPill
                name={name}
                onChangeName={(v) => {
                  setName(v);
                  setDisplayName(v);
                }}
              />
            </View>
            <View style={{ alignItems: 'center', marginTop: 26 }}>
              <TitleBlock size="lg" align="center" />
            </View>
          </View>

          <Columns columns={stacks} gap={14} />

          {lobby ? (
            <View
              style={{ maxWidth: 1120, width: '100%', alignSelf: 'center', paddingHorizontal: 24 }}
            >
              <LobbyPreview lobby={lobby} matchCode={null} />
            </View>
          ) : null}
          <Footer inline={inlineFooter} />
        </ScrollView>
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
          onJoin={(matchCode, opts) => {
            transport.joinOnline(matchCode, opts);
          }}
        />
      </SafeAreaView>
    </View>
  );
}

/** Grow-to-fill style for the last card of a desktop column. */
const GROW = { flex: 1 } as const;

const CREDIT_SOUND = 'Sound by みんなの創作支援サイトＴスタ';
const CREDIT_ASSETS = 'Procedural tiles & felt · CC0 assets only · open source';

/** Credit lines under the cards — sound licence + the CC0 asset policy.
 *  Registers as a `solid` occluder so no drift tile crosses the copy. */
export function Footer({
  compact = false,
  align = 'center',
  inline = false,
}: { compact?: boolean; align?: 'center' | 'left' | 'right'; inline?: boolean }) {
  const items = align === 'center' ? 'center' : align === 'left' ? 'flex-start' : 'flex-end';
  const occluder = useMenuOccluder('solid');
  return (
    <View
      ref={occluder.ref}
      onLayout={occluder.onLayout}
      style={{
        alignSelf: items,
        alignItems: items,
        gap: 4,
        marginTop: compact ? 18 : 24,
        paddingHorizontal: compact ? 12 : 24,
      }}
    >
      {inline ? (
        <Text style={[TYPE.small, { textAlign: align }]}>
          {CREDIT_SOUND} · {CREDIT_ASSETS}
        </Text>
      ) : (
        <>
          <Text style={[TYPE.small, { textAlign: align }]}>{CREDIT_SOUND}</Text>
          <Text style={[TYPE.small, { textAlign: align }]}>{CREDIT_ASSETS}</Text>
        </>
      )}
    </View>
  );
}

/**
 * Inline status line under the Online match buttons: "Connecting…"
 * while the WebSocket opens, and a "Couldn't reach server" hint once it
 * closes without delivering a state.
 */
export function OnlineConnectionStatus({ compact = false }: { compact?: boolean }) {
  const transport = useTransport();
  const state = useGame((s) => s.state);
  if (transport.status === 'idle' || state) return null;
  if (transport.status === 'connecting') {
    return (
      <Text style={[TYPE.small, { color: MENU.text2 }]}>
        Connecting to {transport.resolvedHost}…
      </Text>
    );
  }
  if (transport.status === 'closed') {
    return (
      <View style={{ gap: 2 }}>
        <Text style={{ fontSize: compact ? 11 : 12, color: '#e59a8b', fontWeight: '800' }}>
          Couldn't reach the match server.
        </Text>
        <Text style={TYPE.small}>
          Tried {transport.resolvedHost || '(no host)'}.{' '}
          {compact ? null : (
            <>
              Make sure{' '}
              <Text style={[TYPE.mono, { color: MENU.text2 }]}>
                pnpm --filter @mahjong/server dev
              </Text>{' '}
              is running, or set EXPO_PUBLIC_SERVER_URL.
            </>
          )}
        </Text>
      </View>
    );
  }
  return null;
}

export function InlineHint({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: MENU.fill,
        borderColor: MENU.hairlineSoft,
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 10,
        paddingVertical: 8,
      }}
    >
      {icon}
      <Text style={[TYPE.small, { flex: 1 }]}>{children}</Text>
    </View>
  );
}
