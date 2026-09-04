import { type ReactNode, useState } from 'react';
import {
  Pressable,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import { HOVER_TRANSITION, MENU, TYPE } from './theme';

type Size = 'sm' | 'md' | 'lg';

const PAD: Record<Size, { v: number; h: number; font: number; minH: number }> = {
  sm: { v: 7, h: 12, font: 12, minH: 34 },
  md: { v: 11, h: 16, font: 13, minH: 44 },
  lg: { v: 13, h: 20, font: 14, minH: 48 },
};

interface ButtonProps {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  full?: boolean;
  size?: Size;
  accessibilityLabel?: string | undefined;
  testID?: string | undefined;
  /** Leading icon slot. */
  icon?: ReactNode | undefined;
  style?: ViewStyle | undefined;
}

interface ChromeState {
  pressed: boolean;
  hovered: boolean;
  disabled: boolean;
}

function motion({ pressed, hovered, disabled }: ChromeState): ViewStyle {
  if (disabled) return { transform: [{ scale: 1 }] };
  return {
    ...HOVER_TRANSITION,
    transform: [{ translateY: hovered && !pressed ? -1 : 0 }, { scale: pressed ? 0.97 : 1 }],
    ...(hovered && !pressed ? { filter: 'brightness(1.05)' } : {}),
  };
}

function useHover(): [boolean, { onHoverIn: () => void; onHoverOut: () => void }] {
  const [hovered, setHovered] = useState(false);
  return [hovered, { onHoverIn: () => setHovered(true), onHoverOut: () => setHovered(false) }];
}

/** Primary CTA — gold fill, ink text, 12 px radius, ≥ 44 px tall. */
export function GoldButton({
  children,
  onPress,
  disabled = false,
  full = false,
  size = 'md',
  accessibilityLabel,
  testID,
  icon,
  style,
}: ButtonProps) {
  const p = PAD[size];
  const [hovered, hoverProps] = useHover();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      {...hoverProps}
      style={({ pressed }) => ({
        backgroundColor: disabled ? 'rgba(216,168,90,0.35)' : pressed ? MENU.goldHi : MENU.gold,
        borderRadius: 12,
        minHeight: p.minH,
        paddingVertical: p.v,
        paddingHorizontal: p.h,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 8,
        opacity: disabled ? 0.7 : 1,
        alignSelf: full ? 'stretch' : 'auto',
        boxShadow: disabled ? undefined : '0px 6px 18px rgba(216,168,90,0.22)',
        ...motion({ pressed, hovered, disabled }),
        ...style,
      })}
    >
      {icon}
      <Text
        style={{
          color: MENU.goldInk,
          fontWeight: '800',
          fontSize: p.font,
          letterSpacing: 0.2,
          textAlign: 'center',
        }}
      >
        {children}
      </Text>
    </Pressable>
  );
}

/** Secondary — glass fill with a gold-tinted 1 px border. */
export function GlassButton({
  children,
  onPress,
  disabled = false,
  full = false,
  size = 'md',
  accessibilityLabel,
  testID,
  icon,
  style,
}: ButtonProps) {
  const p = PAD[size];
  const [hovered, hoverProps] = useHover();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      {...hoverProps}
      style={({ pressed }) => ({
        backgroundColor: pressed ? MENU.fillHi : MENU.fill,
        borderWidth: 1,
        borderColor: MENU.goldEdge,
        borderRadius: 12,
        minHeight: p.minH,
        paddingVertical: p.v,
        paddingHorizontal: p.h,
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'row',
        gap: 8,
        opacity: disabled ? 0.5 : 1,
        alignSelf: full ? 'stretch' : 'auto',
        ...motion({ pressed, hovered, disabled }),
        ...style,
      })}
    >
      {icon}
      <Text style={{ color: MENU.text, fontWeight: '700', fontSize: p.font, textAlign: 'center' }}>
        {children}
      </Text>
    </Pressable>
  );
}

/** Destructive — red outline, red text. */
export function DangerButton({
  children,
  onPress,
  disabled = false,
  size = 'sm',
  accessibilityLabel,
  testID,
}: ButtonProps) {
  const p = PAD[size];
  const [hovered, hoverProps] = useHover();
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      {...hoverProps}
      style={({ pressed }) => ({
        backgroundColor: pressed ? MENU.redTint : 'transparent',
        borderWidth: 1,
        borderColor: MENU.redEdge,
        borderRadius: 12,
        minHeight: p.minH,
        paddingVertical: p.v,
        paddingHorizontal: p.h,
        alignItems: 'center',
        justifyContent: 'center',
        ...motion({ pressed, hovered, disabled }),
      })}
    >
      <Text style={{ color: '#e07a66', fontWeight: '700', fontSize: p.font }}>{children}</Text>
    </Pressable>
  );
}

interface MenuTextFieldProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  maxLength?: number;
  hint?: string;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  /** Hide the visible label (the accessible name still comes from `label`). */
  hideLabel?: boolean;
  compact?: boolean;
}

/**
 * Dark text field with a gold focus ring. `accessibilityLabel` carries
 * the field name so `getByLabel('Match code')` keeps resolving.
 */
export function MenuTextField({
  label,
  value,
  onChangeText,
  placeholder,
  mono = false,
  maxLength,
  hint,
  autoCapitalize = 'none',
  hideLabel = false,
  compact = false,
}: MenuTextFieldProps) {
  const [focused, setFocused] = useState(false);
  const monoEmpty = mono && value.length === 0;
  return (
    <View>
      {hideLabel ? null : <Text style={[TYPE.label, { marginBottom: 6 }]}>{label}</Text>}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={MENU.text3}
        accessibilityLabel={label}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        style={{
          borderColor: focused ? MENU.gold : MENU.hairline,
          borderWidth: 1,
          borderRadius: 12,
          paddingVertical: compact ? 9 : 11,
          paddingHorizontal: 12,
          minHeight: compact ? 40 : 44,
          backgroundColor: focused ? 'rgba(216,168,90,0.06)' : MENU.fill,
          fontSize: mono ? 16 : 14,
          fontWeight: '700',
          fontStyle: monoEmpty ? 'italic' : 'normal',
          color: MENU.text,
          letterSpacing: mono && !monoEmpty ? 4 : 0,
          ...(mono ? TYPE.mono : {}),
          ...(focused ? { boxShadow: '0px 0px 0px 3px rgba(216,168,90,0.18)' } : {}),
        }}
      />
      {hint ? <Text style={[TYPE.small, { marginTop: 6 }]}>{hint}</Text> : null}
    </View>
  );
}

/** Small uppercase pill (tags, status). */
export function Pill({
  children,
  tone = 'neutral',
}: { children: ReactNode; tone?: 'neutral' | 'gold' | 'success' | 'red' }) {
  const bg =
    tone === 'gold'
      ? MENU.goldTint
      : tone === 'success'
        ? MENU.successTint
        : tone === 'red'
          ? MENU.redTint
          : MENU.fill;
  const fg =
    tone === 'gold'
      ? MENU.goldHi
      : tone === 'success'
        ? '#7fd6a3'
        : tone === 'red'
          ? '#e59a8b'
          : MENU.text2;
  const edge =
    tone === 'gold'
      ? MENU.goldEdge
      : tone === 'success'
        ? 'rgba(58,160,102,0.4)'
        : tone === 'red'
          ? MENU.redEdge
          : MENU.hairline;
  return (
    <View
      style={{
        backgroundColor: bg,
        borderColor: edge,
        borderWidth: 1,
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 3,
        alignSelf: 'flex-start',
      }}
    >
      <Text style={{ fontSize: 10, fontWeight: '800', letterSpacing: 1.2, color: fg }}>
        {children}
      </Text>
    </View>
  );
}
