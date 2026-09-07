import type { ReactNode } from 'react';
import { Pressable, Modal as RNModal, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MENU, glass } from './theme';

interface GlassSheetProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  maxWidth?: number;
  placement?: 'center' | 'bottom';
}

/**
 * Dark-glass dialog for the menu + replay surfaces (the shared
 * `ui/Modal` stays cream for the match). Same contract: scrim tap and
 * the × button (accessibilityLabel "Close") dismiss; Android back
 * dismisses via `onRequestClose`.
 */
export function GlassSheet({
  open,
  title,
  onClose,
  children,
  maxWidth = 480,
  placement = 'center',
}: GlassSheetProps) {
  const isBottom = placement === 'bottom';
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
          backgroundColor: 'rgba(4,8,6,0.6)',
          justifyContent: isBottom ? 'flex-end' : 'center',
          alignItems: 'center',
          padding: isBottom ? 0 : 20,
        }}
        onPress={onClose}
      >
        <Pressable
          onPress={() => {}}
          style={{
            ...glass({ radius: 20 }),
            backgroundColor: MENU.glassSolid,
            width: '100%',
            maxWidth,
            maxHeight: '90%',
            overflow: 'hidden',
            ...(isBottom
              ? { borderBottomLeftRadius: 0, borderBottomRightRadius: 0, borderBottomWidth: 0 }
              : {}),
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
              borderColor: MENU.hairlineSoft,
            }}
          >
            <Text style={{ fontSize: 16, fontWeight: '800', color: MENU.text }}>{title}</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={({ pressed }) => ({
                width: 32,
                height: 32,
                borderRadius: 999,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? MENU.fillHi : MENU.fill,
                borderWidth: 1,
                borderColor: MENU.hairline,
              })}
            >
              <Text style={{ fontSize: 16, color: MENU.text2, fontWeight: '700', lineHeight: 18 }}>
                ×
              </Text>
            </Pressable>
          </View>
          {children}
          {isBottom && insets.bottom > 0 ? <View style={{ height: insets.bottom }} /> : null}
        </Pressable>
      </Pressable>
    </RNModal>
  );
}
