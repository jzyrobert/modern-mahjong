import '@/src/polyfills';

import { TransportProvider } from '@/src/net/transport-context';
import { DiceCeremony } from '@/src/ui/DiceCeremony';
import { FlipBagProvider } from '@/src/ui/FlipBag';
import { ShuffleOverlay } from '@/src/ui/ShuffleOverlay';
import { WinCelebration } from '@/src/ui/WinCelebration';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

/**
 * Root layout. Mounts the providers every screen needs:
 * - `@/src/polyfills` (platform-split): on native, pulls in
 *   `expo-sqlite/localStorage/install` so the existing localStorage
 *   calls in `identity.ts` and `state/game.ts` survive WebView wipes /
 *   reinstalls. On web, no-ops.
 * - `SafeAreaProvider`: shared safe-area insets for all screens.
 * - `StatusBar` set to dark on the cream surface.
 * - Match-flow overlays (DiceCeremony, ShuffleOverlay, WinCelebration) —
 *   absolute-positioned, gated on engine state slices, animated with
 *   RN core `Animated` so they work in Expo Go without reanimated.
 *   Mounted at root so they layer over both `/` (lobby) and `/match`.
 * - `FlipBagProvider` — the shared rect cache used by `<FlipView>`-
 *   wrapped tiles for layoutId-style FLIP transitions (wall→hand on
 *   draw, hand→discard, discard→meld, between-hand dispense). Lives at
 *   root so a tile's identity survives across route changes (e.g. lobby
 *   → match).
 */
export default function RootLayout() {
  return (
    <View style={{ flex: 1 }}>
      <SafeAreaProvider>
        <TransportProvider>
          <FlipBagProvider>
            <StatusBar style="dark" backgroundColor="#f1eadc" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: '#f1eadc' },
              }}
            />
            <ShuffleOverlay />
            <DiceCeremony />
            <WinCelebration />
          </FlipBagProvider>
        </TransportProvider>
      </SafeAreaProvider>
    </View>
  );
}
