import { Text, TextInput, View, useWindowDimensions } from 'react-native';
import { COLORS as SHARED_COLORS } from '../colors';
import { WindEmblem } from './WindEmblem';

// Phone-class viewports get a tighter hero so the brand mark + tagline
// stop eating ~280 px of vertical real estate before the user sees a
// mode card. 480 px matches the breakpoint LobbyPreview already uses
// for its 2-col vs 4-col seat grid (≥620 there, but 480 is the cutoff
// where the hero starts to feel oversized).
const PHONE_BREAKPOINT = 480;

interface LobbyHeaderProps {
  name: string;
  onChangeName: (v: string) => void;
}

const COLORS = {
  ...SHARED_COLORS,
  // Avatar circle background — a slightly darker / more saturated
  // red-orange than the shared `red` so the initials read as a
  // distinct accent rather than blending into the wind emblem
  // glyph above it.
  avatarBg: '#c66b58',
};

/**
 * Lobby chrome — display-name input on the top left, giant wind emblem
 * + bilingual title in the centre. Split out of `Lobby.tsx` so the
 * screen body reads as a top-down composition (`<LobbyHeader>` →
 * `<ModeGrid>` → `<LobbyPreview>`) without 100 lines of presentation
 * noise inline.
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
  const { width } = useWindowDimensions();
  const phone = width <= PHONE_BREAKPOINT;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'flex-start',
        paddingVertical: phone ? 12 : 20,
        paddingHorizontal: phone ? 16 : 28,
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
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
  const { width } = useWindowDimensions();
  const phone = width <= PHONE_BREAKPOINT;
  // Phone-tuned values shave ~140 px off the hero — emblem from 84 to
  // 56, title from 36 to 24, paddings tightened — so the first mode
  // card lands above the 568 px iPhone-SE fold without scrolling.
  const emblemSize = phone ? 56 : 84;
  const titleSize = phone ? 24 : 36;
  const subtitleSize = phone ? 18 : 28;
  const taglineSize = phone ? 12 : 14;
  return (
    <View
      style={{
        alignItems: 'center',
        gap: phone ? 6 : 12,
        paddingVertical: phone ? 6 : 12,
        paddingHorizontal: phone ? 16 : 28,
        paddingBottom: phone ? 14 : 28,
      }}
    >
      <WindEmblem wind="東" size={emblemSize} />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'baseline',
          gap: phone ? 8 : 14,
          flexWrap: 'wrap',
          justifyContent: 'center',
          marginTop: phone ? 0 : 6,
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
            fontSize: titleSize,
            color: COLORS.ink,
            letterSpacing: -0.5,
            lineHeight: titleSize,
          }}
        >
          Modern Mahjong
        </Text>
        <Text
          style={{
            fontFamily: 'Noto Serif TC',
            fontWeight: '700',
            fontSize: subtitleSize,
            color: COLORS.red,
            lineHeight: subtitleSize,
          }}
        >
          麻雀
        </Text>
      </View>
      <Text
        style={{
          fontSize: taglineSize,
          fontWeight: '600',
          color: COLORS.ink3,
          maxWidth: 580,
          textAlign: 'center',
          lineHeight: taglineSize * 1.45,
        }}
      >
        Hong Kong rules · 136 tiles · play online with friends, on the same Wi-Fi, or against bots.
      </Text>
    </View>
  );
}
