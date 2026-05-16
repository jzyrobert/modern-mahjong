import { useTransport } from '@/src/net/transport-context';
import { BOT_LABELS, generateMatchCode } from '@mahjong/protocol';
import { useRouter } from 'expo-router';
import { type ReactNode, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
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
import { useGame } from '../../state/game';
import { LESSONS, LESSON_ORDER } from '../../state/tutorial';
import { BrowseLobbyModal } from '../BrowseLobbyModal';
import { JoinLanModal } from '../JoinLanModal';
import { GhostButton, PrimaryButton, TextField } from '../buttons';
import { COLORS } from '../colors';
import { LobbyHeader } from './LobbyHeader';
import { LobbyPreview } from './LobbyPreview';
import { LobbyWatermark } from './LobbyWatermark';
import { MobileLobby, useIsPhoneViewport } from './MobileLobby';
import { ModeCard, ModeGrid } from './ModeCard';
import { ScatteredTiles } from './ScatteredTiles';
import { BotIcon, BoxIcon, GlobeIcon, PlayIcon, TutorialIcon, WifiIcon } from './icons';

// Embedded NanoHTTPD port the host's LAN server listens on. Matches the
// legacy LanServer convention so any prior copy-pasted URLs from the
// mobile app keep working. The native module falls back to a free port
// if 7777 is already taken — the resolved port is what we read back
// from `start()`.
const HOST_PORT = 7777;

/**
 * Top-level menu screen. Hero with the wind emblem + bilingual title
 * (`<LobbyHeader>`), three mode cards (Online / Practice / LAN) inside
 * `<ModeGrid>`, `<ScatteredTiles />` background, and a live
 * `LobbyPreview` of the current `useGame.lobby` once the user has
 * joined a match.
 *
 * The LAN card's "Host LAN match" button starts the embedded
 * NanoHTTPD server (via the autolinked `expo-lan-server` module) and
 * calls `transport.joinLan` immediately, so the host always takes
 * seat 0. Previously the host went through a modal interstitial,
 * which left a window during which a guest who already had the match
 * code could connect first and claim seat 0 — see the regression note
 * on `onHostLan` below. The lobby's `<LanInviteCard>` surfaces the
 * shareable URL with copy/share buttons once the host lands in the
 * pre-game waiting room.
 */
export function Lobby() {
  // Phone-class viewports (either dimension ≤ 480 px) get the
  // denser app-bar-led `<MobileLobby>` redesign. Tablets and
  // desktops fall through to the legacy hero + ModeGrid layout.
  // Classification is made by `useIsPhoneViewport()` so the
  // breakpoint logic lives next to the consumer.
  const { isPhone, isLandscape } = useIsPhoneViewport();
  if (isPhone) return <MobileLobby isLandscape={isLandscape} />;
  return <DesktopLobby />;
}

function DesktopLobby() {
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
  // null = idle, 'starting' = lanStart in flight, string = error blurb
  const [hostStatus, setHostStatus] = useState<null | 'starting' | string>(null);
  const [joinLanOpen, setJoinLanOpen] = useState(false);
  const [browseLobbiesOpen, setBrowseLobbiesOpen] = useState(false);
  const [replayCount, setReplayCount] = useState(0);

  // Refresh replay count on mount and when the user comes back to the
  // lobby after recording one.
  useEffect(() => {
    setReplayCount(listHeaders().length);
  }, []);

  // Hide the "Host LAN match" button when the embedded server module
  // isn't loadable. That covers web (no NanoHTTPD runtime in a browser
  // tab) and Expo Go (third-party native modules don't ship there).
  // Android dev/preview/production builds autolink `expo-lan-server`
  // so `isLanServerAvailable()` returns true and the host can start a
  // real server. Joining a LAN match is plain WS and works everywhere,
  // so the "Join LAN match" button stays unconditional.
  const canHostLan = Platform.OS !== 'web' && isLanServerAvailable();

  // Click handler for "Host LAN match". Starts the embedded server,
  // wires the in-process MatchSession bridge, advertises on mDNS, and
  // immediately joins the LAN as the host so the host always takes
  // seat 0. The join is part of the same async block as `lanStart` so
  // a guest who already has the match code can't slip in between
  // server-live and host-joined and steal seat 0.
  //
  // Errors (EADDRINUSE on a stale server, iOS skeleton "not
  // implemented", network race) surface as an inline blurb under the
  // button via `hostStatus`. Caller doesn't need to await — the
  // transport's `joinLan` triggers the route change to /match via
  // `app/index.tsx` once the first server message arrives.
  const onHostLan = async () => {
    if (hostStatus === 'starting') return;
    setHostStatus('starting');
    try {
      // Defensive cleanup before bringing up a fresh server. If the user
      // got here via "Leave" from a previous LAN match, `transport.leave`
      // already disposed the bridge + stopped the server. But a back-
      // navigation or app-state hiccup can leave the bridge wired to a
      // half-dead server — and the new `lanStart` then opens onto a port
      // the kernel hasn't quite released, so the host's own WS upgrades
      // and immediately drops with no obvious cause. Calling these here
      // is idempotent (`stopServer` in the Kotlin module no-ops when
      // there's no server; `stopLanHostBridge` no-ops when there's no
      // active bridge) and ensures `lanStart` always lands on a known-
      // clean state.
      stopLanHostBridge();
      // Pre-start cleanup is best-effort: both calls no-op when
      // there's nothing to tear down. A native-side error here is
      // surfaced via console (not the inline blurb) so it doesn't
      // mask the real failure if `lanStart` itself goes on to throw.
      await lanUnadvertise().catch((err) => console.warn('onHostLan: lanUnadvertise failed', err));
      await lanStop().catch((err) => console.warn('onHostLan: lanStop (pre-start) failed', err));

      const res = await lanStart({ port: HOST_PORT });
      const hostUrl = res.addresses[0];
      if (!hostUrl) {
        // Roll back the server we just started so the next attempt
        // doesn't hit EADDRINUSE; log if even the rollback fails.
        await lanStop().catch((err) => console.warn('onHostLan: lanStop (rollback) failed', err));
        setHostStatus('No LAN address found — are you on Wi-Fi?');
        return;
      }
      startLanHostBridge();
      const serviceName = getDisplayName() || 'Modern Mahjong host';
      // Advertise is best-effort — failure here silently disables
      // mDNS discovery from guests, but the manually-shared URL
      // still works. Log so a regression in mDNS isn't invisible.
      lanAdvertise({ serviceName, port: res.port }).catch((err) =>
        console.warn('onHostLan: lanAdvertise failed', err),
      );
      const matchCode = generateMatchCode();
      transport.joinLan(hostUrl, matchCode);
      setHostStatus(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setHostStatus(`Couldn't start the embedded server: ${msg}`);
    }
  };

  return (
    // Outer cream-coloured View wraps the SafeAreaView so the
    // background extends beneath the bottom safe-area inset (Android
    // software nav, iOS home indicator). Without it, scrolling reveals
    // a dark stripe below the lobby content where the Stack's default
    // `contentStyle` shows through. Mirrors the same pattern in
    // `MobileShell.tsx`.
    <View style={{ flex: 1, backgroundColor: '#f1eadc' }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: '#f1eadc' }} edges={['top', 'bottom']}>
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
                <GhostButton onPress={() => setBrowseLobbiesOpen(true)}>
                  Browse open lobbies
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
                  <PrimaryButton onPress={onHostLan} disabled={hostStatus === 'starting'}>
                    {hostStatus === 'starting' ? 'Starting host…' : 'Host LAN match'}
                  </PrimaryButton>
                ) : null}
                <GhostButton onPress={() => setJoinLanOpen(true)}>Join LAN match</GhostButton>
              </ButtonRow>
              {typeof hostStatus === 'string' && hostStatus !== 'starting' ? (
                <Text style={{ fontSize: 12, color: '#b14d3a', fontWeight: '700', lineHeight: 16 }}>
                  {hostStatus}
                </Text>
              ) : null}
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
          <Text
            style={{
              marginTop: 24,
              textAlign: 'center',
              fontSize: 11,
              color: COLORS.ink3,
              fontWeight: '600',
            }}
          >
            Sound by みんなの創作支援サイトＴスタ
          </Text>
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
