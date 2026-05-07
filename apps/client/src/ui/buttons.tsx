import { type ReactNode, useState } from 'react';
import { Pressable, Text, TextInput, type TextInputProps, View } from 'react-native';
import { COLORS as SHARED_COLORS } from './colors';

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
  ...SHARED_COLORS,
  // PrimaryButton's pressed state uses a slightly less-saturated red
  // than the shared `redHot` (which is tuned for the YOUR-TURN dot
  // and ClaimMissedToast border). On a paper-coloured CTA button the
  // shared hue read as too hot — kept this local override + shifted
  // by ~6% saturation so the pressed state still feels distinct
  // without overpowering the surrounding chrome.
  redHot: '#d05746',
};

/**
 * Brand-red primary button with active-press visual feedback.
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
      // accessibilityRole + accessibilityState surface the right ARIA
      // attributes through RN-Web (`role="button"`, `aria-disabled`) so
      // Playwright's `getByRole('button', { name })` and assistive tech
      // can find the control. Without these the Pressable renders as a
      // plain `<div>`.
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      style={({ pressed }) => ({
        backgroundColor: disabled ? '#c9c1b3' : pressed ? COLORS.redHot : COLORS.red,
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
 * Cream-paper ghost button with hairline border.
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
      accessibilityRole="button"
      accessibilityState={{ disabled }}
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
 * Cream-paper text input with a focused brand-red ring. The focused ring is driven
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
        // `accessibilityLabel` flows to RN-Web as `aria-label`, which
        // is what Playwright's `getByLabel('Match code')` resolves to
        // in the absence of a real `<label>` element. The visible
        // `<Text>` above is purely decorative — without this, screen
        // readers would announce only the placeholder.
        accessibilityLabel={label}
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
            boxShadow: `0px 0px 4px ${COLORS.red}26`,
          }),
        }}
      />
      {hint ? <Text style={{ marginTop: 6, fontSize: 11, color: COLORS.ink3 }}>{hint}</Text> : null}
    </View>
  );
}
