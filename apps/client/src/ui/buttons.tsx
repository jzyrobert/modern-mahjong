import { type ReactNode, useState } from 'react';
import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';

interface PrimaryButtonProps {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  full?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const PRIMARY_PADDING: Record<'sm' | 'md' | 'lg', { vertical: number; horizontal: number }> = {
  sm: { vertical: 6, horizontal: 12 },
  md: { vertical: 10, horizontal: 16 },
  lg: { vertical: 12, horizontal: 20 },
};
const PRIMARY_FONT: Record<'sm' | 'md' | 'lg', number> = { sm: 11, md: 13, lg: 14 };

const COLORS = {
  red: 'oklch(0.55 0.18 25)',
  redHot: 'oklch(0.62 0.2 28)',
  ink: 'oklch(0.25 0.04 60)',
  hairline: 'oklch(0.86 0.02 80)',
  paper: 'oklch(0.97 0.01 80)',
  paperHi: 'oklch(0.99 0.005 85)',
  ink3: 'oklch(0.55 0.04 60)',
};

/**
 * Brand-red primary button with active-press visual feedback. Native
 * port of the legacy `_legacy/src/ui/buttons.tsx::PrimaryButton`.
 */
export function PrimaryButton({
  children,
  onPress,
  disabled = false,
  full = false,
  size = 'md',
}: PrimaryButtonProps) {
  const padding = PRIMARY_PADDING[size];
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        backgroundColor: disabled ? 'oklch(0.85 0.02 60)' : pressed ? COLORS.redHot : COLORS.red,
        borderRadius: 10,
        paddingVertical: padding.vertical,
        paddingHorizontal: padding.horizontal,
        opacity: disabled ? 0.6 : 1,
        transform: [{ translateY: pressed && !disabled ? -1 : 0 }],
        alignSelf: full ? 'stretch' : 'auto',
      })}
    >
      <Text
        style={{
          color: 'white',
          fontWeight: '800',
          fontSize: PRIMARY_FONT[size],
          letterSpacing: 0.3,
          textAlign: 'center',
        }}
      >
        {children}
      </Text>
    </Pressable>
  );
}

interface GhostButtonProps {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  full?: boolean;
}

/**
 * Cream-paper ghost button with hairline border. Native port of the
 * legacy `_legacy/src/ui/buttons.tsx::GhostButton`.
 */
export function GhostButton({
  children,
  onPress,
  disabled = false,
  full = false,
}: GhostButtonProps) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        backgroundColor: pressed && !disabled ? COLORS.paper : 'white',
        borderColor: COLORS.hairline,
        borderWidth: 1,
        borderRadius: 10,
        paddingVertical: 10,
        paddingHorizontal: 16,
        opacity: disabled ? 0.5 : 1,
        alignSelf: full ? 'stretch' : 'auto',
      })}
    >
      <Text
        style={{
          color: COLORS.ink,
          fontWeight: '700',
          fontSize: 13,
          textAlign: 'center',
        }}
      >
        {children}
      </Text>
    </Pressable>
  );
}

interface TextFieldProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  maxLength?: number;
  hint?: string;
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoCorrect?: boolean;
}

/**
 * Cream-paper text input with a focused brand-red ring. Native port of
 * `_legacy/src/ui/buttons.tsx::TextField`. The focused ring is driven
 * by local `useState(focused)` rather than CSS `:focus-visible` since
 * RN's TextInput doesn't expose pseudo-classes.
 */
export function TextField({
  label,
  value,
  onChangeText,
  placeholder,
  mono = false,
  maxLength,
  hint,
  autoCapitalize = 'none',
  autoCorrect = false,
}: TextFieldProps) {
  const [focused, setFocused] = useState(false);
  return (
    <View>
      <Text
        style={{
          marginBottom: 6,
          fontSize: 11,
          fontWeight: '700',
          color: COLORS.ink3,
          letterSpacing: 0.6,
        }}
      >
        {label.toUpperCase()}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor={COLORS.ink3}
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        style={{
          borderColor: focused ? COLORS.red : COLORS.hairline,
          borderWidth: 1,
          borderRadius: 8,
          paddingVertical: 10,
          paddingHorizontal: 12,
          backgroundColor: COLORS.paperHi,
          fontSize: mono ? 16 : 14,
          fontWeight: '600',
          color: COLORS.ink,
          letterSpacing: mono ? 3 : 0,
          ...(focused && {
            shadowColor: COLORS.red,
            shadowOpacity: 0.15,
            shadowRadius: 4,
            shadowOffset: { width: 0, height: 0 },
            elevation: 2,
          }),
        }}
      />
      {hint ? (
        <Text style={{ marginTop: 6, fontSize: 11, color: COLORS.ink3 }}>{hint}</Text>
      ) : null}
    </View>
  );
}
