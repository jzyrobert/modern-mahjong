import { useTransport } from '@/src/net/transport-context';
import { generateMatchCode } from '@mahjong/protocol';
import { type ReactNode, useState } from 'react';
import { Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDisplayName, setDisplayName } from '../../identity';
import { useGame } from '../../state/game';
import { HostLanModal } from '../HostLanModal';
import { JoinLanModal } from '../JoinLanModal';
import { GhostButton, PrimaryButton, TextField } from '../buttons';
import { LobbyPreview } from './LobbyPreview';
import { ScatteredTiles } from './ScatteredTiles';
import { WindEmblem } from './WindEmblem';
import { BotIcon, BoxIcon, GlobeIcon, WifiIcon } from './icons';

/**
 * Top-level menu screen. Native port of `_legacy/src/ui/Lobby.tsx`.
 * Hero with the wind emblem + bilingual title, three mode cards
 * (Online / Practice / LAN), `<ScatteredTiles />` decoration, and a
 * live `LobbyPreview` of the current `useGame.lobby` once the user
 * has joined a match.
 *
 * `HostLanModal` / `JoinLanModal` open from the LAN card's two
 * buttons. The host modal will populate its URL automatically once
 * the LanServer Expo native module is available (a dev client build);
 * until then the user pastes their own host address.
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
        <TopBar
          name={name}
          onChangeName={(v) => {
            setName(v);
            setDisplayName(v);
          }}
        />
        <Hero />
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
              <Text style={{ color: '#65594c', fontWeight: '800' }}>heuristic</Text>,{' '}
              <Text style={{ color: '#65594c', fontWeight: '800' }}>simple</Text>, and{' '}
              <Text style={{ color: '#65594c', fontWeight: '800' }}>passive</Text>. Runs entirely on
              this device.
            </Text>
            <TagRow tags={['Heuristic', 'Simple', 'Passive']} />
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

function TopBar({ name, onChangeName }: { name: string; onChangeName: (v: string) => void }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingVertical: 20,
        paddingHorizontal: 28,
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            backgroundColor: '#506a51',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontFamily: 'Noto Serif TC',
              color: '#d8a85a',
              fontSize: 18,
              fontWeight: '700',
              lineHeight: 18,
            }}
          >
            麻
          </Text>
        </View>
        <Text
          style={{
            fontWeight: '900',
            fontSize: 14,
            color: '#3a3328',
            letterSpacing: 0.3,
          }}
        >
          Modern Mahjong
        </Text>
      </View>

      <IdentityCard name={name} onChange={onChangeName} />
    </View>
  );
}

function Hero() {
  return (
    <View
      style={{
        alignItems: 'center',
        gap: 12,
        paddingVertical: 12,
        paddingHorizontal: 28,
        paddingBottom: 28,
      }}
    >
      <WindEmblem wind="東" size={84} />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'baseline',
          gap: 14,
          flexWrap: 'wrap',
          justifyContent: 'center',
          marginTop: 6,
        }}
      >
        <Text
          accessibilityRole="header"
          // RN-Web maps `accessibilityRole="header"` to `<h1 role="heading">`,
          // which Playwright's `getByRole('heading', { name: ... })`
          // expects. The smaller brand mark in `TopBar` stays a plain
          // Text since there's only one h1 per route.
          style={{
            fontWeight: '900',
            fontSize: 36,
            color: '#3a3328',
            letterSpacing: -0.5,
            lineHeight: 36,
          }}
        >
          Modern Mahjong
        </Text>
        <Text
          style={{
            fontFamily: 'Noto Serif TC',
            fontWeight: '700',
            fontSize: 28,
            color: '#b14d3a',
            lineHeight: 28,
          }}
        >
          麻雀
        </Text>
      </View>
      <Text
        style={{
          fontSize: 14,
          fontWeight: '600',
          color: '#918275',
          maxWidth: 580,
          textAlign: 'center',
          lineHeight: 21,
        }}
      >
        Hong Kong rules · 136 tiles · play online with friends, on the same Wi-Fi, or against bots.
      </Text>
    </View>
  );
}

function ModeGrid({ children }: { children: ReactNode }) {
  // Equivalent of the legacy `repeat(auto-fit, minmax(280px, 1fr))`:
  // row + wrap with each child `flex: 1 1 0; min-width: 280`. Children
  // grow to fill available width, wrapping to a new row whenever
  // another 280px-min card no longer fits — so on portrait phones each
  // card occupies its own full-width row, and on desktop three fit
  // side-by-side. The earlier column-direction branch combined wrap
  // with `flex-basis: 0` on children and produced overlapping cards on
  // narrow viewports.
  return (
    <View
      style={{
        maxWidth: 1080,
        width: '100%',
        alignSelf: 'center',
        paddingHorizontal: 28,
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap: 14,
        }}
      >
        {children}
      </View>
    </View>
  );
}

function IdentityCard({ name, onChange }: { name: string; onChange: (v: string) => void }) {
  const initials = (name || '?').slice(0, 2).toUpperCase();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#fbf8f0',
        borderColor: '#cdc1ad',
        borderWidth: 1,
        borderRadius: 10,
        paddingVertical: 6,
        paddingLeft: 6,
        paddingRight: 10,
      }}
    >
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: 7,
          backgroundColor: '#c66b58',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: 'white', fontWeight: '800', fontSize: 12 }}>{initials}</Text>
      </View>
      <TextInput
        value={name}
        onChangeText={onChange}
        placeholder="Display name"
        placeholderTextColor="#918275"
        style={{
          fontFamily: 'Nunito',
          fontSize: 13,
          fontWeight: '700',
          color: '#3a3328',
          width: 140,
          padding: 0,
        }}
      />
    </View>
  );
}

interface ModeCardProps {
  title: string;
  subtitle: string;
  icon: ReactNode;
  accent?: boolean;
  children: ReactNode;
}

function ModeCard({ title, subtitle, icon, accent = false, children }: ModeCardProps) {
  return (
    <View
      style={{
        backgroundColor: '#fbf8f0',
        borderColor: accent ? '#ec9275' : '#cdc1ad',
        borderWidth: 1,
        borderRadius: 16,
        padding: 22,
        gap: 12,
        flexBasis: 0,
        flexGrow: 1,
        minWidth: 280,
        // Drop-shadow approximated for native via shadow* + elevation.
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.04,
        shadowRadius: 6,
        elevation: 2,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View
          style={{
            width: 40,
            height: 40,
            borderRadius: 10,
            backgroundColor: accent ? '#fbe5d9' : '#ede5d3',
            borderColor: accent ? '#d8b09f' : '#cdc1ad',
            borderWidth: 1,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: 16, fontWeight: '900', color: '#3a3328', lineHeight: 18 }}>
            {title}
          </Text>
          <Text
            style={{
              fontSize: 12,
              color: '#918275',
              marginTop: 2,
              fontWeight: '600',
            }}
          >
            {subtitle}
          </Text>
        </View>
        {accent ? <RecommendedBadge /> : null}
      </View>
      {children}
    </View>
  );
}

function RecommendedBadge() {
  return (
    <View
      style={{
        backgroundColor: '#fbe5d9',
        borderColor: '#d8b09f',
        borderWidth: 1,
        borderRadius: 6,
        paddingHorizontal: 7,
        paddingVertical: 3,
      }}
    >
      <Text
        style={{
          color: '#b14d3a',
          fontSize: 9,
          fontWeight: '900',
          letterSpacing: 0.7,
        }}
      >
        RECOMMENDED
      </Text>
    </View>
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
