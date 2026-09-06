import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Platform,
  Pressable,
  Modal as RNModal,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS as SHARED_COLORS } from './colors';
import { useReducedMotion } from './tutorial/useReducedMotion';

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

/**
 * Glass sheet motion (transform / opacity only, ARCHITECTURE.md §2):
 * the scrim fades while the card rises 28 px (bottom sheet), slides in
 * 32 px (side sheet) or settles from 96 % (centred panel) over 280 ms
 * on an ease-out; leaving reverses it in 180 ms. RN's stock `slide` /
 * `fade` were the phone-shell motion pasted into the glass language
 * (round-5 settings critic). Reduced motion collapses both to ≤ 120 ms.
 * The paper variant keeps RN's animation so the classic shells render
 * as before.
 */
const GLASS_ENTER_MS = 280;
const GLASS_LEAVE_MS = 180;
const GLASS_REDUCED_MS = 120;
const GLASS_RISE_PX = 28;
const GLASS_SLIDE_PX = 32;
const GLASS_SETTLE_SCALE = 0.96;

/**
 * Drives the glass sheet's presence: `visible` keeps the RN modal
 * mounted through the leave tween; `progress` is 0 (hidden) → 1 (shown).
 */
function useGlassPresence(open: boolean, enabled: boolean, reduce: boolean) {
  const [visible, setVisible] = useState(open);
  const progress = useRef(new Animated.Value(open ? 1 : 0)).current;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `visible` is read, never a trigger — a change of `open` is the only transition
  useEffect(() => {
    if (!enabled) {
      setVisible(open);
      progress.setValue(open ? 1 : 0);
      return;
    }
    if (open) {
      setVisible(true);
      progress.setValue(0);
      const anim = Animated.timing(progress, {
        toValue: 1,
        duration: reduce ? GLASS_REDUCED_MS : GLASS_ENTER_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      });
      anim.start();
      return () => anim.stop();
    }
    if (!visible) return;
    const anim = Animated.timing(progress, {
      toValue: 0,
      duration: reduce ? GLASS_REDUCED_MS / 2 : GLASS_LEAVE_MS,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: false,
    });
    anim.start(({ finished }) => {
      if (finished) setVisible(false);
    });
    return () => anim.stop();
  }, [open, enabled, reduce]);
  return { visible, progress };
}

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
  const reduce = useReducedMotion();
  const { visible, progress } = useGlassPresence(open, glass, reduce);
  const motion = glass
    ? {
        opacity: progress,
        transform: [
          {
            translateY: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [isBottom ? GLASS_RISE_PX : 0, 0],
            }),
          },
          {
            translateX: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [isRight ? GLASS_SLIDE_PX : 0, 0],
            }),
          },
          {
            scale: progress.interpolate({
              inputRange: [0, 1],
              outputRange: [isBottom || isRight ? 1 : GLASS_SETTLE_SCALE, 1],
            }),
          },
        ],
      }
    : null;
  return (
    <RNModal
      visible={glass ? visible : open}
      transparent
      animationType={glass ? 'none' : isBottom ? 'slide' : 'fade'}
      onRequestClose={onClose}
      statusBarTranslucent
      navigationBarTranslucent
    >
      {glass ? (
        // The scrim fades with the card (the Pressable below stays
        // transparent so the tap-to-dismiss surface is unchanged).
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: COLORS.glassScrim,
            opacity: progress,
          }}
        />
      ) : null}
      <Pressable
        style={{
          flex: 1,
          backgroundColor: glass ? 'transparent' : COLORS.scrim,
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
        <Animated.View
          style={{
            width: '100%',
            maxWidth,
            maxHeight: isRight ? '100%' : '90%',
            ...(isRight && { height: '100%' }),
            ...motion,
          }}
        >
          <Pressable
            // Eat the backdrop's onPress when the user taps inside.
            onPress={() => {}}
            style={{
              // The animated wrapper carries the width / height caps; the
              // card shrinks to fit inside them.
              width: '100%',
              flexShrink: 1,
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
        </Animated.View>
      </Pressable>
    </RNModal>
  );
}
