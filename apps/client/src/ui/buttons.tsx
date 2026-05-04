import { type ReactNode, useState } from 'react';
import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';

interface PrimaryButtonProps {
  children: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  full?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

const PRIMARY_PADDING = { sm: 'py-1.5 px-3', md: 'py-2.5 px-4', lg: 'py-3 px-5' };
const PRIMARY_FONT = { sm: 'text-[11px]', md: 'text-[13px]', lg: 'text-[14px]' };

/**
 * Brand-red primary button with active-press visual feedback. Native
 * port of the legacy `_legacy/src/ui/buttons.tsx::PrimaryButton`.
 *
 * Active-state styling uses Pressable's pressed callback rather than
 * NativeWind's `active:` modifier so the lift transform composes
 * cleanly with the disabled gray-out below.
 */
export function PrimaryButton({
  children,
  onPress,
  disabled = false,
  full = false,
  size = 'md',
}: PrimaryButtonProps) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        opacity: disabled ? 0.6 : 1,
        transform: [{ translateY: pressed && !disabled ? -1 : 0 }],
        alignSelf: full ? 'stretch' : 'auto',
      })}
      className={`rounded-[10px] ${PRIMARY_PADDING[size]} ${
        disabled ? 'bg-stone-300' : 'bg-red active:bg-red-hot'
      }`}
    >
      <Text
        className={`text-center font-extrabold tracking-wide text-white ${PRIMARY_FONT[size]}`}
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
        opacity: disabled ? 0.5 : 1,
        alignSelf: full ? 'stretch' : 'auto',
        backgroundColor: pressed && !disabled ? 'oklch(0.97 0.01 80)' : 'white',
      })}
      className="rounded-[10px] border border-hairline px-4 py-2.5"
    >
      <Text className="text-center text-[13px] font-bold text-ink">{children}</Text>
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
      <Text className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-3">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder={placeholder}
        placeholderTextColor="oklch(0.55 0.04 60)"
        maxLength={maxLength}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        style={{
          borderColor: focused ? 'oklch(0.55 0.18 25)' : 'oklch(0.86 0.02 80)',
          backgroundColor: 'oklch(0.99 0.005 85)',
          fontFamily: mono ? 'JetBrains Mono' : 'Nunito',
          fontSize: mono ? 16 : 14,
          fontWeight: '600',
          color: 'oklch(0.25 0.04 60)',
          letterSpacing: mono ? 3 : 0,
          textTransform: mono ? 'uppercase' : 'none',
          ...(focused && {
            shadowColor: 'oklch(0.55 0.18 25)',
            shadowOpacity: 0.15,
            shadowRadius: 4,
            shadowOffset: { width: 0, height: 0 },
            elevation: 2,
          }),
        }}
        className="rounded-lg border px-3 py-2.5"
      />
      {hint ? <Text className="mt-1.5 text-[11px] text-ink-3">{hint}</Text> : null}
    </View>
  );
}
