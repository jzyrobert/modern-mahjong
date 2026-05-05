import { Text, TextInput, View } from 'react-native';
import { WindEmblem } from './WindEmblem';

interface LobbyHeaderProps {
  name: string;
  onChangeName: (v: string) => void;
}

const COLORS = {
  ink: '#3a3328',
  ink3: '#918275',
  red: '#b14d3a',
  felt: '#506a51',
  goldOnFelt: '#d8a85a',
  paperHi: '#fbf8f0',
  hairline: '#cdc1ad',
  avatarBg: '#c66b58',
};

/**
 * Lobby chrome — small brand mark + display-name input on the left,
 * giant wind emblem + bilingual title in the centre. Split out of
 * `Lobby.tsx` so the screen body reads as a top-down composition
 * (`<LobbyHeader>` → `<ModeGrid>` → `<LobbyPreview>`) without 100 lines
 * of presentation noise inline.
 */
export function LobbyHeader({ name, onChangeName }: LobbyHeaderProps) {
  return (
    <>
      <BrandRow name={name} onChangeName={onChangeName} />
      <Hero />
    </>
  );
}

function BrandRow({ name, onChangeName }: LobbyHeaderProps) {
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
            backgroundColor: COLORS.felt,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text
            style={{
              fontFamily: 'Noto Serif TC',
              color: COLORS.goldOnFelt,
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
            color: COLORS.ink,
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

function IdentityCard({ name, onChange }: { name: string; onChange: (v: string) => void }) {
  const initials = (name || '?').slice(0, 2).toUpperCase();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: COLORS.paperHi,
        borderColor: COLORS.hairline,
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
          backgroundColor: COLORS.avatarBg,
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
        placeholderTextColor={COLORS.ink3}
        style={{
          fontFamily: 'Nunito',
          fontSize: 13,
          fontWeight: '700',
          color: COLORS.ink,
          width: 140,
          padding: 0,
        }}
      />
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
          // RN-Web maps `accessibilityRole="header"` to `<h1
          // role="heading">`, which Playwright's `getByRole('heading',
          // { name: ... })` expects. The smaller brand mark in
          // `BrandRow` stays a plain Text since there's only one h1
          // per route.
          style={{
            fontWeight: '900',
            fontSize: 36,
            color: COLORS.ink,
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
            color: COLORS.red,
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
          color: COLORS.ink3,
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
