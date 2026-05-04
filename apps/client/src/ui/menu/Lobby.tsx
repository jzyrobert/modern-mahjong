import { generateMatchCode } from '@mahjong/protocol';
import { type ReactNode, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getDisplayName, setDisplayName } from '../../identity';
import { useTransport } from '../../net/transport-context';
import { useGame } from '../../state/game';
import { GhostButton, PrimaryButton, TextField } from '../buttons';
import { LobbyPreview } from './LobbyPreview';
import { WindEmblem } from './WindEmblem';
import { BotIcon, BoxIcon, GlobeIcon, WifiIcon } from './icons';

/**
 * Top-level menu screen. Native port of `_legacy/src/ui/Lobby.tsx`.
 * Hero with the wind emblem + bilingual title, three mode cards
 * (Online / Practice / LAN), and a live `LobbyPreview` of the current
 * `useGame.lobby` once the user has joined a match.
 *
 * The decorative `<ScatteredTiles />` background and the LAN modals
 * (`HostLanModal` / `JoinLanModal`) are deferred — `ScatteredTiles`
 * comes back in Phase 6 (animations), the LAN modals in Phase 8 (LAN
 * native modules). For Phase 3 the LAN buttons surface an Alert
 * explaining the deferral.
 */
export function Lobby() {
  const transport = useTransport();
  const lobby = useGame((s) => s.lobby);
  // Lazy initialiser — `getDisplayName()` reads from preferences, so we
  // only want to run it on first mount, not on every render.
  const [name, setName] = useState(() => getDisplayName());
  const [code, setCode] = useState('');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f1eadc' }} edges={['top']}>
    <ScrollView
      style={{ flex: 1, backgroundColor: '#f1eadc' }}
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
        </ModeCard>

        <ModeCard
          title="Practice vs bots"
          subtitle="Single device · no connection"
          icon={<BotIcon color="#65594c" />}
        >
          <Text style={{ fontSize: 12, color: '#918275', lineHeight: 18 }}>
            Three opponents at varying skill —{' '}
            <Text style={{ color: '#65594c', fontWeight: '800' }}>heuristic</Text>
            ,{' '}
            <Text style={{ color: '#65594c', fontWeight: '800' }}>simple</Text>
            , and{' '}
            <Text style={{ color: '#65594c', fontWeight: '800' }}>passive</Text>
            . Runs entirely on this device.
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
            Four-player matches over local Wi-Fi. Host shares the URL; guests paste it into any
            browser on the same network.
          </Text>
          <InlineHint icon={<BoxIcon color="#918275" />}>
            Works offline. No accounts. No data leaves your network.
          </InlineHint>
          <ButtonRow>
            <PrimaryButton onPress={() => Alert.alert('Coming soon', 'LAN host requires the native bridge — Phase 8 of the Expo port.')}>
              Host LAN match
            </PrimaryButton>
            <GhostButton onPress={() => Alert.alert('Coming soon', 'LAN join requires the native bridge — Phase 8 of the Expo port.')}>
              Join LAN match
            </GhostButton>
          </ButtonRow>
        </ModeCard>
      </ModeGrid>

      {lobby ? (
        <View style={{ maxWidth: 1080, width: '100%', alignSelf: 'center', paddingHorizontal: 28 }}>
          <LobbyPreview lobby={lobby} matchCode={null} />
        </View>
      ) : null}
    </ScrollView>
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
  const { width } = useWindowDimensions();
  // Match the legacy `repeat(auto-fit, minmax(280px, 1fr))` — at ≥920px
  // three columns fit, otherwise stack.
  const direction = width >= 920 ? 'row' : 'column';
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
          flexDirection: direction,
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
      <Text style={{ flex: 1, fontSize: 11, color: '#918275', fontWeight: '600' }}>
        {children}
      </Text>
    </View>
  );
}
