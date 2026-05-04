import type { ReactNode } from 'react';
import { Pressable, Modal as RNModal, Text, View } from 'react-native';

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Optional max-width for the dialog content (default 460). */
  maxWidth?: number;
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
export function Modal({ open, title, onClose, children, maxWidth = 460 }: ModalProps) {
  return (
    <RNModal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable
        style={{
          flex: 1,
          backgroundColor: COLORS.scrim,
          justifyContent: 'center',
          alignItems: 'center',
          padding: 20,
        }}
        onPress={onClose}
      >
        <Pressable
          // Eat the backdrop's onPress when the user taps inside.
          onPress={() => {}}
          style={{
            width: '100%',
            maxWidth,
            maxHeight: '90%',
            backgroundColor: COLORS.paper,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: COLORS.hairline,
            overflow: 'hidden',
            shadowColor: '#000',
            shadowOpacity: 0.18,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 12 },
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
