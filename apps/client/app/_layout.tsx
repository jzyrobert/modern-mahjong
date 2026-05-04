import 'expo-sqlite/localStorage/install';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { TransportProvider } from '@/src/net/transport-context';
import { DiceCeremony } from '@/src/ui/DiceCeremony';
import { ShuffleOverlay } from '@/src/ui/ShuffleOverlay';
import { WinCelebration } from '@/src/ui/WinCelebration';

/**
 * Root layout. Mounts the providers every screen needs:
 * - `expo-sqlite/localStorage/install` polyfill: side-effect import that
 *   makes `localStorage.getItem/setItem` durable on native, so existing
 *   `identity.ts` and `state/game.ts` calls survive WebView wipes / app
 *   reinstalls without a separate native-preferences mirror.
 * - `GestureHandlerRootView`: required at the root for
 *   `react-native-gesture-handler` (used in Phase 5 for hand reorder).
 * - `SafeAreaProvider`: shared safe-area insets for all screens.
 * - `StatusBar` set to dark on the cream surface.
 *
 * Screen overlays (DiceCeremony, ShuffleOverlay, WinCelebration) will be
 * mounted here too once they're ported in Phase 6.
 */
export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <TransportProvider>
          <StatusBar style="dark" backgroundColor="#f1eadc" />
          <View style={{ flex: 1 }}>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: '#f1eadc' },
              }}
            />
            {/* Phase 6 overlay layer — sits above every route. Each
             * overlay self-gates on its own zustand-driven trigger:
             * `state.seed` change for ShuffleOverlay, `state.openingRolls`
             * for DiceCeremony, `state.lastResult.kind === 'win'` for
             * WinCelebration. */}
            <ShuffleOverlay />
            <DiceCeremony />
            <WinCelebration />
          </View>
        </TransportProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
