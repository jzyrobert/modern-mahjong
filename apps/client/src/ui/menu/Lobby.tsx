import { useTransport } from '@/src/net/transport-context';
import { BOT_LABELS, generateMatchCode } from '@mahjong/protocol';
import { useRouter } from 'expo-router';
import { type ReactNode, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDisplayName, setDisplayName } from '../../identity';
import { listHeaders } from '../../replay/storage';
import { useGame } from '../../state/game';
import { LESSONS, LESSON_ORDER } from '../../state/tutorial';
import { HostLanModal } from '../HostLanModal';
import { JoinLanModal } from '../JoinLanModal';
import { GhostButton, PrimaryButton, TextField } from '../buttons';
import { COLORS } from '../colors';
import { LobbyHeader } from './LobbyHeader';
import { LobbyPreview } from './LobbyPreview';
import { LobbyWatermark } from './LobbyWatermark';
import { ModeCard, ModeGrid } from './ModeCard';
import { ScatteredTiles } from './ScatteredTiles';
import { BotIcon, BoxIcon, GlobeIcon, PlayIcon, TutorialIcon, WifiIcon } from './icons';

/**
 * Top-level menu screen. Hero with the wind emblem + bilingual title
 * (`<LobbyHeader>`), three mode cards (Online / Practice / LAN) inside
 * `<ModeGrid>`, `<ScatteredTiles />` background, and a live
 * `LobbyPreview` of the current `useGame.lobby` once the user has
 * joined a match.
 *
 * `HostLanModal` / `JoinLanModal` open from the LAN card. On Android
 * dev/preview/production builds the host modal auto-populates its URL
 * via the autolinked `expo-lan-server` module; web / iOS / Expo Go
 * fall through to manual entry.
 */
export function Lobby() {
  const router = useRouter();
  const transport = useTransport();
  const lobby = useGame((s) => s.lobby);
  const tutorialsCompleted = useGame((s) => s.settings.tutorialsCompleted);
  // The lobby Tutorial card lists every lesson in `LESSON_ORDER`,
  // each row tappable. Completed lessons render with a checkmark;
  // any lesson can be (re-)launched at any time. Tracking the
  // count here drives the card's progress subtitle.
  const completedCount = LESSON_ORDER.reduce(
    (acc, id) => acc + (tutorialsCompleted.includes(id) ? 1 : 0),
    0,
  );
  // Lazy initialiser — `getDisplayName()` reads from preferences, so we
  // only want to run it on first mount, not on every render.
  const [name, setName] = useState(() => getDisplayName());
  const [code, setCode] = useState('');
  const [hostLanOpen, setHostLanOpen] = useState(false);
  const [joinLanOpen, setJoinLanOpen] = useState(false);
  const [replayCount, setReplayCount] = useState(0);

  // Refresh replay count on mount and when the user comes back to the
  // lobby after recording one.
  useEffect(() => {
    setReplayCount(listHeaders().length);
  }, []);

  // Hide the "Host LAN match" button on web — there's no embedded
  // server runtime in a browser tab, so even if the user pastes a
  // URL the host flow can't actually serve a match. The expo-lan-server
  // native module is autolinked into Android (and the iOS skeleton),
  // so any non-web target keeps the button. Joining a LAN match
  // *is* viable from a browser (the guest flow is plain WS), so the
  // "Join LAN match" button stays for everyone.
  const canHostLan = Platform.OS !== 'web';

  return (
    // Outer cream-coloured View wraps the SafeAreaView so the
    // background extends beneath the bottom safe-area inset (Android
    // software nav, iOS home indicator). Without it, scrolling reveals
    // a dark stripe below the lobby content where the Stack's default
    // `contentStyle` shows through. Mirrors the same pattern in
    // `MobileShell.tsx`.
    <View style={{ flex: 1, backgroundColor: '#f1eadc' }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f1eadc' }} edges={['top']}>
        <LobbyWatermark />
        <ScatteredTiles />
        <ScrollView
          style={{ flex: 1, backgroundColor: 'transparent' }}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          <LobbyHeader
            name={name}
            onChangeName={(v) => {
              setName(v);
              setDisplayName(v);
            }}
          />
          <ModeGrid>
            <ModeCard
              accent
              title="Online match"
              subtitle="Play with friends over the internet"
              icon={<GlobeIcon color="#b14d3a" />}
            >
              <TextField
                label="Match code"
                value={code}
                onChangeText={(v) => setCode(v.toUpperCase())}
                placeholder="ABCDE"
                mono
                maxLength={5}
                autoCapitalize="characters"
              />
              <ButtonRow>
                <PrimaryButton
                  onPress={() => code && transport.joinOnline(code)}
                  disabled={code.length !== 5}
                >
                  Join match
                </PrimaryButton>
                <GhostButton
                  onPress={() => {
                    const fresh = generateMatchCode();
                    setCode(fresh);
                    transport.joinOnline(fresh);
                  }}
                >
                  Create new match
                </GhostButton>
              </ButtonRow>
              <OnlineConnectionStatus />
            </ModeCard>

            <ModeCard
              title="Practice vs bots"
              subtitle="Single device · no connection"
              icon={<BotIcon color="#65594c" />}
            >
              <Text style={{ fontSize: 12, color: '#918275', lineHeight: 18 }}>
                Three opponents at varying skill —{' '}
                <Text style={{ color: '#65594c', fontWeight: '800' }}>{BOT_LABELS.heuristic}</Text>,{' '}
                <Text style={{ color: '#65594c', fontWeight: '800' }}>{BOT_LABELS.simple}</Text>,
                and{' '}
                <Text style={{ color: '#65594c', fontWeight: '800' }}>{BOT_LABELS.passive}</Text>.
                Runs entirely on this device.
              </Text>
              <TagRow tags={[BOT_LABELS.heuristic, BOT_LABELS.simple, BOT_LABELS.passive]} />
              <ButtonRow>
                <PrimaryButton onPress={transport.joinSolo}>Play vs bots</PrimaryButton>
              </ButtonRow>
            </ModeCard>

            <ModeCard
              title="Tutorial"
              subtitle={
                completedCount === 0
                  ? 'New here? Pick any lesson to begin'
                  : completedCount === LESSON_ORDER.length
                    ? `All ${LESSON_ORDER.length} lessons complete`
                    : `${completedCount}/${LESSON_ORDER.length} lessons done`
              }
              icon={<TutorialIcon color="#65594c" />}
            >
              <View style={{ gap: 6 }}>
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
                      onPress={() => transport.joinSoloTutorial(id)}
                    />
                  );
                })}
              </View>
            </ModeCard>

            <ModeCard
              title="LAN / offline"
              subtitle="Same-Wi-Fi matches"
              icon={<WifiIcon color="#65594c" />}
            >
              <Text style={{ fontSize: 12, color: '#918275', lineHeight: 18 }}>
                {canHostLan
                  ? 'Four-player matches over local Wi-Fi. Host shares the URL; guests paste it into any browser on the same network.'
                  : 'Join an in-progress LAN match by pasting the host’s URL. Hosting needs the native app — install the Android build to host one yourself.'}
              </Text>
              <InlineHint icon={<BoxIcon color="#918275" />}>
                Works offline. No accounts. No data leaves your network.
              </InlineHint>
              <ButtonRow>
                {canHostLan ? (
                  <PrimaryButton onPress={() => setHostLanOpen(true)}>Host LAN match</PrimaryButton>
                ) : null}
                <GhostButton onPress={() => setJoinLanOpen(true)}>Join LAN match</GhostButton>
              </ButtonRow>
            </ModeCard>

            <ModeCard
              title="Replays"
              subtitle="Watch saved matches with the scrubber"
              icon={<PlayIcon color="#65594c" />}
            >
              <Text style={{ fontSize: 12, color: '#918275', lineHeight: 18 }}>
                {replayCount > 0
                  ? `${replayCount} saved replay${replayCount === 1 ? '' : 's'}. Step through any past hand and see every player's tiles.`
                  : 'No replays yet. Hit "Save this match" from the in-match menu, or flip on auto-record.'}
              </Text>
              <ButtonRow>
                <PrimaryButton onPress={() => router.push('/replays')}>Open library</PrimaryButton>
              </ButtonRow>
            </ModeCard>
          </ModeGrid>

          {lobby ? (
            <View
              style={{ maxWidth: 1080, width: '100%', alignSelf: 'center', paddingHorizontal: 28 }}
            >
              <LobbyPreview lobby={lobby} matchCode={null} />
            </View>
          ) : null}
        </ScrollView>
        <HostLanModal
          open={hostLanOpen}
          onClose={() => setHostLanOpen(false)}
          onHosted={(hostUrl, matchCode) => {
            setHostLanOpen(false);
            transport.joinLan(hostUrl, matchCode);
          }}
        />
        <JoinLanModal
          open={joinLanOpen}
          onClose={() => setJoinLanOpen(false)}
          onJoin={(hostUrl, matchCode) => {
            setJoinLanOpen(false);
            transport.joinLan(hostUrl, matchCode);
          }}
        />
      </SafeAreaView>
    </View>
  );
}

function ButtonRow({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>;
}

interface LessonRowProps {
  title: string;
  blurb: string;
  done: boolean;
  onPress: () => void;
}

/**
 * Single tappable row inside the lobby's Tutorial card. Shows a
 * checkmark when the lesson is in `tutorialsCompleted`. Tapping
 * always launches the lesson — completed lessons can be replayed
 * any time, fresh ones can be started in any order.
 */
function LessonRow({ title, blurb, done, onPress }: LessonRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${done ? 'Replay' : 'Start'} ${title}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 8,
        paddingHorizontal: 10,
        borderRadius: 8,
        backgroundColor: pressed ? COLORS.creamLow : COLORS.cream,
        borderWidth: 1,
        borderColor: COLORS.hairline,
      })}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: done ? COLORS.green : 'transparent',
          borderWidth: done ? 0 : 1,
          borderColor: COLORS.hairline,
        }}
      >
        {done ? <Text style={{ fontSize: 12, fontWeight: '900', color: '#fff' }}>✓</Text> : null}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={{ fontSize: 13, fontWeight: '800', color: COLORS.ink }}>{title}</Text>
        <Text style={{ fontSize: 11, color: COLORS.ink3, marginTop: 1 }}>{blurb}</Text>
      </View>
    </Pressable>
  );
}

function TagRow({ tags }: { tags: readonly string[] }) {
  return (
    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
      {tags.map((t) => (
        <View
          key={t}
          style={{
            backgroundColor: '#e8def0',
            borderColor: '#c9bbe0',
            borderWidth: 1,
            borderRadius: 6,
            paddingHorizontal: 7,
            paddingVertical: 3,
          }}
        >
          <Text
            style={{
              fontSize: 10,
              fontWeight: '800',
              letterSpacing: 0.4,
              color: '#6a5292',
            }}
          >
            {t}
          </Text>
        </View>
      ))}
    </View>
  );
}

/**
 * Inline status line under the Online match buttons. Shows "Connecting…"
 * while the WebSocket is opening, and a "Couldn't reach server" hint
 * with the resolved host once it closes without delivering a state.
 * Without this, a failed connection looks identical to a button that
 * did nothing.
 */
function OnlineConnectionStatus() {
  const transport = useTransport();
  const state = useGame((s) => s.state);
  // Once a state arrives, the lobby route navigates away — but render a
  // placeholder space-reserver so the card doesn't flicker its layout.
  if (transport.status === 'idle' || state) return null;

  if (transport.status === 'connecting') {
    return (
      <Text style={{ fontSize: 12, color: '#918275', fontWeight: '700' }}>
        Connecting to {transport.resolvedHost}…
      </Text>
    );
  }
  if (transport.status === 'closed') {
    return (
      <View style={{ gap: 2 }}>
        <Text style={{ fontSize: 12, color: '#b14d3a', fontWeight: '800' }}>
          Couldn't reach the match server.
        </Text>
        <Text style={{ fontSize: 11, color: '#918275', fontWeight: '600', lineHeight: 16 }}>
          Tried {transport.resolvedHost || '(no host)'}. Make sure{' '}
          <Text style={{ fontFamily: 'Nunito', fontWeight: '800', color: '#65594c' }}>
            pnpm --filter @mahjong/server dev
          </Text>{' '}
          is running, or set EXPO_PUBLIC_SERVER_URL.
        </Text>
      </View>
    );
  }
  return null;
}

function InlineHint({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
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
      {icon}
      <Text style={{ flex: 1, fontSize: 11, color: COLORS.ink3, fontWeight: '600' }}>
        {children}
      </Text>
    </View>
  );
}
