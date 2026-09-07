import { useRef, useState } from 'react';
import { Platform, Pressable, Text, TextInput, View } from 'react-native';
import { MENU, TYPE, glass, heading } from './theme';
import { useMenuOccluder } from './useMenuOccluder';

/**
 * Lobby chrome shared by the phone + desktop layouts: the title block
 * (uppercase "Hong Kong Mahjong" label, tight display heading, 麻將
 * mark, one-line tagline) and the identity pill (avatar initials +
 * editable display name + EDIT / DONE toggle).
 */

interface TitleBlockProps {
  size?: 'lg' | 'md' | 'sm';
  align?: 'center' | 'left';
  /** Show the one-line tagline under the heading. */
  tagline?: boolean;
}

const HEADING_SIZE = { lg: 52, md: 34, sm: 24 } as const;
const MARK_SIZE = { lg: 34, md: 24, sm: 18 } as const;

/**
 * Legibility for the title copy: the hero is laid out *below* the
 * measured title block (`HeroBandSlot`) and the drift field keeps out
 * from under it, so the ground behind the copy is the void; a shadow
 * under every line covers the exception (a font swap mid-relayout). No
 * scrim — a gradient block behind the copy read as a rectangle on
 * desktop and darkened the rack's top rows on phones (round-2 critic).
 */
const TITLE_SHADOW = {
  textShadowColor: 'rgba(11,18,15,0.55)',
  textShadowOffset: { width: 0, height: 1 },
  textShadowRadius: 12,
} as const;

export function TitleBlock({ size = 'lg', align = 'center', tagline = true }: TitleBlockProps) {
  const h = HEADING_SIZE[size];
  const center = align === 'center';
  // Solid occluder: the 3D drift field fades out under the heading.
  const occluder = useMenuOccluder('solid');
  return (
    <View
      ref={occluder.ref}
      onLayout={occluder.onLayout}
      style={{
        alignSelf: center ? 'center' : 'flex-start',
        alignItems: center ? 'center' : 'flex-start',
        gap: size === 'lg' ? 10 : 6,
      }}
    >
      <Text style={[TYPE.label, TITLE_SHADOW, { color: MENU.gold }]}>Hong Kong Mahjong</Text>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'baseline',
          gap: size === 'lg' ? 16 : 10,
          flexWrap: 'wrap',
          justifyContent: center ? 'center' : 'flex-start',
        }}
      >
        <Text
          accessibilityRole="header"
          // RN-Web maps `accessibilityRole="header"` to an `<h1>` so
          // `getByRole('heading', { name: 'Modern Mahjong' })` resolves.
          style={[heading(h), TITLE_SHADOW, center ? { textAlign: 'center' } : null]}
        >
          Modern Mahjong
        </Text>
        <Text
          style={[
            TYPE.serif,
            TITLE_SHADOW,
            {
              fontSize: MARK_SIZE[size],
              lineHeight: MARK_SIZE[size] + 4,
              color: 'rgba(239,230,210,0.82)',
            },
          ]}
        >
          麻將
        </Text>
      </View>
      {tagline ? (
        <Text
          style={[
            TYPE.body,
            TITLE_SHADOW,
            {
              fontSize: size === 'lg' ? 14 : 12,
              lineHeight: size === 'lg' ? 20 : 17,
              maxWidth: 520,
              textAlign: center ? 'center' : 'left',
            },
          ]}
        >
          136 tiles · play online with friends, on the same Wi-Fi, or against bots.
        </Text>
      ) : null}
    </View>
  );
}

interface IdentityPillProps {
  name: string;
  onChangeName: (v: string) => void;
  /** Tighter paddings for the phone app bar. */
  compact?: boolean;
  /** Grow to fill the row (phone app bar). */
  grow?: boolean;
}

/**
 * Avatar + editable display name. The EDIT / DONE control focuses or
 * blurs the input; `onMouseDown` preventDefault keeps a mousedown on
 * the button from blurring the input before `onPress` reads focus.
 */
export function IdentityPill({
  name,
  onChangeName,
  compact = false,
  grow = false,
}: IdentityPillProps) {
  const initials = (name || '?').slice(0, 2).toUpperCase();
  const inputRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState(false);
  const webBlurGuard: { onMouseDown?: (e: { preventDefault?: () => void }) => void } =
    Platform.OS === 'web' ? { onMouseDown: (e) => e?.preventDefault?.() } : {};
  const onToggle = () => {
    if (inputRef.current?.isFocused()) inputRef.current.blur();
    else inputRef.current?.focus();
  };
  const avatar = compact ? 26 : 30;
  // Glass occluder: the pill is small, so a drift tile straddling it
  // would read as a smudge behind the name.
  const occluder = useMenuOccluder('glass');
  return (
    <View
      ref={occluder.ref}
      onLayout={occluder.onLayout}
      style={{
        ...glass({ quiet: true, radius: 999, flat: true }),
        borderColor: focused ? MENU.goldEdge : MENU.hairline,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingVertical: 4,
        paddingLeft: 4,
        paddingRight: 6,
        ...(grow ? { flex: 1, minWidth: 0 } : { minWidth: compact ? 180 : 220 }),
      }}
    >
      <View
        style={{
          width: avatar,
          height: avatar,
          borderRadius: 999,
          backgroundColor: MENU.goldTint,
          borderWidth: 1,
          borderColor: MENU.goldEdge,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Text style={{ color: MENU.goldHi, fontWeight: '800', fontSize: compact ? 10 : 11 }}>
          {initials}
        </Text>
      </View>
      <TextInput
        ref={inputRef}
        value={name}
        onChangeText={onChangeName}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder="Display name"
        placeholderTextColor={MENU.text3}
        accessibilityLabel="Display name"
        style={{
          fontFamily: 'Nunito',
          fontSize: 13,
          fontWeight: '700',
          color: MENU.text,
          flex: 1,
          minWidth: 0,
          padding: 0,
        }}
      />
      <Pressable
        {...webBlurGuard}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={focused ? 'Done editing display name' : 'Edit display name'}
        style={({ pressed }) => ({
          backgroundColor: focused ? MENU.gold : pressed ? MENU.fillHi : MENU.fill,
          borderRadius: 999,
          paddingHorizontal: 8,
          paddingVertical: 4,
          minHeight: 22,
          justifyContent: 'center',
        })}
      >
        <Text
          style={{
            fontSize: 10,
            fontWeight: '800',
            color: focused ? MENU.goldInk : MENU.text2,
            letterSpacing: 1.2,
          }}
        >
          {focused ? 'DONE' : 'EDIT'}
        </Text>
      </Pressable>
    </View>
  );
}

/** Small serif 麻 brand chip for app bars. */
export function BrandMark({ size = 30 }: { size?: number }) {
  const occluder = useMenuOccluder('solid');
  return (
    <View
      ref={occluder.ref}
      onLayout={occluder.onLayout}
      style={{
        width: size,
        height: size * 1.3,
        borderRadius: size * 0.22,
        backgroundColor: MENU.ivory,
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0px 4px 12px rgba(0,0,0,0.35)',
      }}
    >
      <Text
        style={[TYPE.serif, { fontSize: size * 0.68, lineHeight: size * 0.8, color: MENU.red }]}
      >
        麻
      </Text>
    </View>
  );
}
