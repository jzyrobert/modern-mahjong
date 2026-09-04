import type { ReactNode } from 'react';
import { Platform, Pressable, Modal as RNModal, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS as SHARED_COLORS } from './colors';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Optional max-width for the dialog content (default 460). */
  maxWidth?: number;
  /**
   * Where the dialog sits inside the scrim:
   *   - `'center'` (default): traditional centered card with a 20 px
   *     gutter on every side.
   *   - `'bottom'`: bottom-sheet pattern — card anchors to the
   *     viewport's bottom edge (scrim padding clears top + sides
   *     only), bottom corners flush with the viewport, top corners
   *     rounded. Used for mobile-first surfaces where the relevant
   *     buttons sit near the user's thumb.
   *   - `'right'`: side-sheet pattern — full-height card docked to the
   *     right edge, left corners rounded. Used on wide viewports so a
   *     long-form panel (Settings) reads next to the ☰ trigger and
   *     leaves the table visible.
   */
  placement?: 'center' | 'bottom' | 'right';
  /**
   * Chrome theme. `'paper'` (default) is the cream dialog the classic
   * sheets were designed on. `'glass'` is the dark frosted panel of the
   * 3D render layer's HUD language (blurred backdrop on web, a denser
   * tint on native where `backdrop-filter` doesn't exist).
   */
  variant?: 'paper' | 'glass';
}

const COLORS = {
  ...SHARED_COLORS,
  // Scrim is the only Modal-specific accent — sits between the
  // backdrop tap surface and the dialog body, tuned a bit darker
  // than a typical 0.4-alpha black to compensate for the missing
  // backdrop-filter blur.
  scrim: 'rgba(20,15,10,0.55)',
  glassScrim: 'rgba(4,8,6,0.5)',
  // Dense enough that muted text (0.56 white) clears 4.5:1 even when the
  // blurred backdrop is a bright felt.
  glassBg: Platform.OS === 'web' ? 'rgba(14,20,17,0.76)' : 'rgba(14,20,17,0.94)',
  glassBorder: 'rgba(255,255,255,0.12)',
  glassText: 'rgba(255,255,255,0.92)',
  glassText2: 'rgba(255,255,255,0.62)',
};

// `backdrop-filter` isn't in RN's style typings but react-native-web
// forwards it verbatim; native ignores the spread entirely.
const WEB_BLUR: ViewStyle | null =
  Platform.OS === 'web'
    ? ({
        backdropFilter: 'blur(16px) saturate(140%)',
        WebkitBackdropFilter: 'blur(16px) saturate(140%)',
      } as unknown as ViewStyle)
    : null;

/**
 * Cream-paper (or dark-glass) dialog over an ink scrim, title row with
 * × close button, click-outside to dismiss, back-button to dismiss on
 * Android (via `onRequestClose`), Escape on web. The legacy
 * `backdrop-filter: blur` only exists on web — the paper scrim alpha is
 * tuned a bit darker to compensate elsewhere.
 *
 * Used by `SettingsPanel` (glass, bottom / right), `ScoringBreakdownModal`,
 * `GameLog` and `MenuSheet` (paper).
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  maxWidth = 460,
  placement = 'center',
  variant = 'paper',
}: ModalProps) {
  const isBottom = placement === 'bottom';
  const isRight = placement === 'right';
  const glass = variant === 'glass';
  const insets = useSafeAreaInsets();
  return (
    <RNModal
      visible={open}
      transparent
      animationType={isBottom ? 'slide' : 'fade'}
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      <Pressable
        style={{
          flex: 1,
          backgroundColor: glass ? COLORS.glassScrim : COLORS.scrim,
          flexDirection: isRight ? 'row' : 'column',
          justifyContent: isBottom || isRight ? 'flex-end' : 'center',
          alignItems: isRight ? 'stretch' : 'center',
          // The scrim deliberately ignores insets — it covers the nav
          // bar / status bar strip too so the whole screen dims. The
          // sheet card below handles its own bottom inset.
          paddingTop: isBottom || isRight ? 0 : 20,
          paddingHorizontal: isBottom || isRight ? 0 : 20,
          paddingBottom: isBottom || isRight ? 0 : 20,
        }}
        onPress={onClose}
      >
        <Pressable
          // Eat the backdrop's onPress when the user taps inside.
          onPress={() => {}}
          style={{
            width: '100%',
            maxWidth,
            maxHeight: isRight ? '100%' : '90%',
            ...(isRight && { height: '100%' }),
            backgroundColor: glass ? COLORS.glassBg : COLORS.paperHi,
            ...(glass && WEB_BLUR),
            borderTopLeftRadius: 16,
            borderTopRightRadius: isRight ? 0 : 16,
            borderBottomLeftRadius: isBottom ? 0 : 16,
            borderBottomRightRadius: isBottom || isRight ? 0 : 16,
            borderWidth: 1,
            borderColor: glass ? COLORS.glassBorder : COLORS.hairline,
            // Sheets sit flush with a viewport edge — drop the border
            // on that edge so it doesn't paint a hairline above it.
            ...(isBottom && { borderBottomWidth: 0 }),
            ...(isRight && { borderRightWidth: 0, borderTopWidth: 0, borderBottomWidth: 0 }),
            overflow: 'hidden',
            boxShadow: glass
              ? '0px 12px 40px rgba(0,0,0,0.35)'
              : isBottom
                ? '0px -8px 24px rgba(0,0,0,0.18)'
                : '0px 12px 24px rgba(0,0,0,0.18)',
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 18,
              paddingVertical: glass ? 12 : 14,
              paddingTop: isRight && glass ? Math.max(12, insets.top) : glass ? 12 : 14,
              borderBottomWidth: 1,
              borderColor: glass ? 'rgba(255,255,255,0.08)' : COLORS.hairline,
            }}
          >
            <Text
              style={{
                fontSize: glass ? 17 : 16,
                fontWeight: glass ? '800' : '900',
                letterSpacing: glass ? -0.3 : 0,
                color: glass ? COLORS.glassText : COLORS.ink,
              }}
            >
              {title}
            </Text>
            <Pressable
              onPress={onClose}
              accessibilityLabel="Close"
              accessibilityRole="button"
              style={({ pressed }) =>
                glass
                  ? {
                      width: 32,
                      height: 32,
                      borderRadius: 16,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: pressed
                        ? 'rgba(255,255,255,0.16)'
                        : 'rgba(255,255,255,0.08)',
                      borderWidth: 1,
                      borderColor: COLORS.glassBorder,
                    }
                  : {
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      borderRadius: 8,
                      backgroundColor: pressed ? COLORS.cream : 'transparent',
                    }
              }
            >
              <Text
                style={{
                  fontSize: 18,
                  lineHeight: glass ? 20 : undefined,
                  color: glass ? 'rgba(255,255,255,0.85)' : COLORS.ink3,
                  fontWeight: '700',
                }}
              >
                ×
              </Text>
            </Pressable>
          </View>
          {children}
          {/* `navigationBarTranslucent` lets the modal extend behind
              the system nav bar so the scrim dims that strip too —
              the trade is that the sheet's tail end would sit under
              the nav bar. The spacer keeps the sheet bg flush with
              the viewport edge but pushes interactive content up by
              the nav-bar inset so the last row stays tappable. On
              devices without a soft nav bar `insets.bottom` is 0 and
              this collapses out. */}
          {(isBottom || isRight) && insets.bottom > 0 ? (
            <View style={{ height: insets.bottom }} />
          ) : null}
        </Pressable>
      </Pressable>
    </RNModal>
  );
}
