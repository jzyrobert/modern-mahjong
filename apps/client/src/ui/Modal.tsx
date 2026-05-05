import type { ReactNode } from 'react';
import { Pressable, Modal as RNModal, Text, View } from 'react-native';

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
   */
  placement?: 'center' | 'bottom';
}

const COLORS = {
  ink: '#3a3328',
  ink3: '#918275',
  paper: '#fbf8f0',
  hairline: '#cdc1ad',
  cream: '#f1eadc',
  scrim: 'rgba(20,15,10,0.55)',
};

/**
 * Native port of `_legacy/src/ui/Modal.tsx`. Cream-paper dialog over an
 * ink scrim, title row with × close button, click-outside to dismiss,
 * back-button to dismiss on Android (via `onRequestClose`). The legacy
 * `backdrop-filter: blur` doesn't translate to RN — the scrim alpha is
 * tuned a bit darker to compensate.
 *
 * Used by `SettingsPanel`, `ScoringBreakdownModal`, and `GameLog`.
 */
export function Modal({
  open,
  title,
  onClose,
  children,
  maxWidth = 460,
  placement = 'center',
}: ModalProps) {
  const isBottom = placement === 'bottom';
  return (
    <RNModal
      visible={open}
      transparent
      animationType={isBottom ? 'slide' : 'fade'}
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        style={{
          flex: 1,
          backgroundColor: COLORS.scrim,
          justifyContent: isBottom ? 'flex-end' : 'center',
          alignItems: 'center',
          paddingTop: 20,
          paddingHorizontal: isBottom ? 0 : 20,
          paddingBottom: isBottom ? 0 : 20,
        }}
        onPress={onClose}
      >
        <Pressable
          // Eat the backdrop's onPress when the user taps inside.
          onPress={() => {}}
          style={{
            width: '100%',
            maxWidth,
            maxHeight: isBottom ? '90%' : '90%',
            backgroundColor: COLORS.paper,
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            borderBottomLeftRadius: isBottom ? 0 : 16,
            borderBottomRightRadius: isBottom ? 0 : 16,
            borderWidth: 1,
            borderColor: COLORS.hairline,
            // Bottom sheet sits flush with the viewport edge — drop
            // the bottom border so it doesn't paint a hairline above
            // the screen edge.
            ...(isBottom && { borderBottomWidth: 0 }),
            overflow: 'hidden',
            shadowColor: '#000',
            shadowOpacity: 0.18,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: isBottom ? -8 : 12 },
            elevation: 8,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              paddingHorizontal: 18,
              paddingVertical: 14,
              borderBottomWidth: 1,
              borderColor: COLORS.hairline,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '900', color: COLORS.ink }}>{title}</Text>
            <Pressable
              onPress={onClose}
              accessibilityLabel="Close"
              style={({ pressed }) => ({
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderRadius: 8,
                backgroundColor: pressed ? COLORS.cream : 'transparent',
              })}
            >
              <Text style={{ fontSize: 18, color: COLORS.ink3, fontWeight: '700' }}>×</Text>
            </Pressable>
          </View>
          {children}
        </Pressable>
      </Pressable>
    </RNModal>
  );
}
