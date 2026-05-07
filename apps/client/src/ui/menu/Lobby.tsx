import { useTransport } from '@/src/net/transport-context';
import { BOT_LABELS, generateMatchCode } from '@mahjong/protocol';
import { type ReactNode, useState } from 'react';
import { Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDisplayName, setDisplayName } from '../../identity';
import { useGame } from '../../state/game';
import { HostLanModal } from '../HostLanModal';
import { JoinLanModal } from '../JoinLanModal';
import { GhostButton, PrimaryButton, TextField } from '../buttons';
import { LobbyHeader } from './LobbyHeader';
import { LobbyPreview } from './LobbyPreview';
import { ModeCard, ModeGrid } from './ModeCard';
import { ScatteredTiles } from './ScatteredTiles';
import { BotIcon, BoxIcon, GlobeIcon, WifiIcon } from './icons';

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
  const transport = useTransport();
  const lobby = useGame((s) => s.lobby);
  // Lazy initialiser — `getDisplayName()` reads from preferences, so we
  // only want to run it on first mount, not on every render.
  const [name, setName] = useState(() => getDisplayName());
  const [code, setCode] = useState('');
  const [hostLanOpen, setHostLanOpen] = useState(false);
  const [joinLanOpen, setJoinLanOpen] = useState(false);

  // Hide the "Host LAN match" button on web — there's no embedded
  // server runtime in a browser tab, so even if the user pastes a
  // URL the host flow can't actually serve a match. The expo-lan-server
  // native module is autolinked into Android (and the iOS skeleton),
  // so any non-web target keeps the button. Joining a LAN match
  // *is* viable from a browser (the guest flow is plain WS), so the
  // "Join LAN match" button stays for everyone.
  const canHostLan = Platform.OS !== 'web';

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f1eadc' }} edges={['top']}>
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
              <Text style={{ color: '#65594c', fontWeight: '800' }}>{BOT_LABELS.simple}</Text>, and{' '}
              <Text style={{ color: '#65594c', fontWeight: '800' }}>{BOT_LABELS.passive}</Text>.
              Runs entirely on this device.
            </Text>
            <TagRow tags={[BOT_LABELS.heuristic, BOT_LABELS.simple, BOT_LABELS.passive]} />
            <ButtonRow>
              <PrimaryButton onPress={transport.joinSolo}>Play vs bots</PrimaryButton>
            </ButtonRow>
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
  );
}

function ButtonRow({ children }: { children: ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{children}</View>;
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
        backgroundColor: '#ece4d3',
        borderColor: '#cdc1ad',
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 8,
      }}
    >
      {icon}
      <Text style={{ flex: 1, fontSize: 11, color: '#918275', fontWeight: '600' }}>{children}</Text>
    </View>
  );
}
