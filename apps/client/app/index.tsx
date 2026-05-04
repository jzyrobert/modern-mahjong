import { Text, View } from 'react-native';

/**
 * Phase 1 placeholder. Confirms the Expo Router + NativeWind toolchain
 * boots end-to-end without any of the legacy web UI mounted. Phase 3
 * replaces this with the real lobby (`Lobby.tsx` port).
 */
export default function Index() {
  return (
    <View className="flex-1 items-center justify-center bg-cream">
      <Text className="text-3xl font-extrabold text-ink">Modern Mahjong</Text>
      <Text className="mt-2 text-sm text-ink-3">Expo migration · Phase 1</Text>
    </View>
  );
}
